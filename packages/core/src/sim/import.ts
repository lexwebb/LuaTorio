import type { CircuitEntity, CircuitGraph, CombinatorKind, WireColor } from "../combinators.js";

export type { WireColor } from "../combinators.js";

export type ConnectorSide = "in" | "out";

export interface NetEndpoint {
  entityId: string;
  side: ConnectorSide;
  /** Raw Factorio `defines.wire_connector_id` (1–4 for combinator red/green in/out). */
  connector: number;
}

export interface CircuitNet {
  color: WireColor;
  members: NetEndpoint[];
}

export interface ImportedCircuit {
  entities: CircuitEntity[];
  nets: CircuitNet[];
  inputs: Array<{ signal: string; entityId: string }>;
  outputs: Array<{ signal: string; entityId: string }>;
}

export class BlueprintImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlueprintImportError";
  }
}

/** Factorio 2.0 combinator wire connector ids (matches `layout.ts`). */
export const WIRE_CONNECTOR = {
  redIn: 1,
  greenIn: 2,
  redOut: 3,
  greenOut: 4,
} as const;

const SUPPORTED_NAMES = new Set([
  "constant-combinator",
  "arithmetic-combinator",
  "decider-combinator",
]);

function connectorColor(connector: number): WireColor {
  switch (connector) {
    case WIRE_CONNECTOR.redIn:
    case WIRE_CONNECTOR.redOut:
      return "red";
    case WIRE_CONNECTOR.greenIn:
    case WIRE_CONNECTOR.greenOut:
      return "green";
    default:
      throw new BlueprintImportError(`unsupported wire connector id ${connector}`);
  }
}

function connectorSide(connector: number): ConnectorSide {
  if (connector === WIRE_CONNECTOR.redOut || connector === WIRE_CONNECTOR.greenOut) {
    return "out";
  }
  return "in";
}

/** Factorio constants have one connector: they both drive and observe the net. */
function endpointsFor(kind: CombinatorKind, entityId: string, connector: number): NetEndpoint[] {
  if (kind === "constant") {
    return [
      { entityId, side: "out", connector },
      { entityId, side: "in", connector },
    ];
  }
  return [{ entityId, side: connectorSide(connector), connector }];
}

function kindFromName(name: string): CombinatorKind {
  switch (name) {
    case "constant-combinator":
      return "constant";
    case "arithmetic-combinator":
      return "arithmetic";
    case "decider-combinator":
      return "decider";
    default:
      throw new BlueprintImportError(`unsupported entity '${name}'`);
  }
}

function asSignalName(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function inferOutputSignal(
  kind: CombinatorKind,
  controlBehavior: Record<string, unknown>,
  fallbackId: string,
): string {
  switch (kind) {
    case "arithmetic": {
      const cond = controlBehavior.arithmetic_conditions as
        | { output_signal?: { name?: unknown } }
        | undefined;
      return asSignalName(cond?.output_signal?.name) ?? fallbackId;
    }
    case "decider": {
      const cond = controlBehavior.decider_conditions as
        | { outputs?: Array<{ signal?: { name?: unknown } }> }
        | undefined;
      return asSignalName(cond?.outputs?.[0]?.signal?.name) ?? fallbackId;
    }
    case "constant": {
      const sections = controlBehavior.sections as
        | { sections?: Array<{ filters?: Array<{ name?: unknown }> }> }
        | undefined;
      return asSignalName(sections?.sections?.[0]?.filters?.[0]?.name) ?? fallbackId;
    }
  }
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  find(id: string): string {
    const p = this.parent.get(id);
    if (p === undefined) {
      this.parent.set(id, id);
      return id;
    }
    if (p !== id) {
      const root = this.find(p);
      this.parent.set(id, root);
      return root;
    }
    return id;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) {
      this.parent.set(ra, rb);
    }
  }
}

function endpointKey(entityNumber: number, connector: number): string {
  return `${entityNumber}:${connector}`;
}

interface EndpointMeta {
  color: WireColor;
  entityId: string;
  connector: number;
  kind: CombinatorKind;
}

function buildNets(
  wires: ReadonlyArray<[number, number, number, number]>,
  entityByNumber: ReadonlyMap<number, CircuitEntity>,
): CircuitNet[] {
  const uf = new UnionFind();
  const meta = new Map<string, EndpointMeta>();

  function touch(entityNumber: number, connector: number): void {
    const entity = entityByNumber.get(entityNumber);
    if (entity === undefined) {
      throw new BlueprintImportError(`wire references missing entity_number ${entityNumber}`);
    }
    const key = endpointKey(entityNumber, connector);
    const color = connectorColor(connector);
    const existing = meta.get(key);
    if (existing !== undefined && existing.color !== color) {
      throw new BlueprintImportError(`connector ${key} has conflicting colors`);
    }
    meta.set(key, { color, entityId: entity.id, connector, kind: entity.kind });
    uf.find(key);
  }

  for (const [a, ca, b, cb] of wires) {
    touch(a, ca);
    touch(b, cb);
    const colorA = connectorColor(ca);
    const colorB = connectorColor(cb);
    if (colorA !== colorB) {
      throw new BlueprintImportError(`wire joins ${colorA} to ${colorB}`);
    }
    uf.union(endpointKey(a, ca), endpointKey(b, cb));
  }

  const groups = new Map<string, { color: WireColor; members: NetEndpoint[] }>();
  for (const [key, info] of meta) {
    const root = uf.find(key);
    const group = groups.get(root) ?? { color: info.color, members: [] };
    group.members.push(...endpointsFor(info.kind, info.entityId, info.connector));
    groups.set(root, group);
  }

  return [...groups.values()];
}

/** Mark latches when a net ties an entity's out back to its in (self-feedback). */
function applyLatchHeuristic(entities: CircuitEntity[], nets: readonly CircuitNet[]): void {
  const selfFeedback = new Set<string>();
  for (const net of nets) {
    const ins = new Set<string>();
    const outs = new Set<string>();
    for (const member of net.members) {
      if (member.side === "in") {
        ins.add(member.entityId);
      } else {
        outs.add(member.entityId);
      }
    }
    for (const id of ins) {
      if (outs.has(id)) {
        selfFeedback.add(id);
      }
    }
  }
  for (const entity of entities) {
    if (entity.kind !== "constant" && selfFeedback.has(entity.id) && entity.role === undefined) {
      entity.role = "latch";
    }
  }
}

interface BlueprintEntityJson {
  entity_number?: number;
  name?: string;
  control_behavior?: Record<string, unknown>;
}

interface BlueprintPlanJson {
  blueprint?: {
    entities?: BlueprintEntityJson[];
    wires?: Array<[number, number, number, number]>;
  };
}

/**
 * Import a Factorio blueprint plan (decoded JSON) into an undirected-net circuit.
 * Supports constant / arithmetic / decider only.
 */
export function fromBlueprint(
  plan: unknown,
  opts?: {
    inputs?: Array<{ signal: string; entityId: string }>;
    outputs?: Array<{ signal: string; entityId: string }>;
  },
): ImportedCircuit {
  if (plan === null || typeof plan !== "object" || !("blueprint" in plan)) {
    throw new BlueprintImportError("expected a Blueprint plan object");
  }
  const blueprint = (plan as BlueprintPlanJson).blueprint;
  const rawEntities = blueprint?.entities ?? [];
  const wires = blueprint?.wires ?? [];

  const entities: CircuitEntity[] = [];
  const entityByNumber = new Map<number, CircuitEntity>();

  for (const raw of rawEntities) {
    const entityNumber = raw.entity_number;
    const name = raw.name;
    if (typeof entityNumber !== "number" || typeof name !== "string") {
      throw new BlueprintImportError("entity missing entity_number or name");
    }
    if (!SUPPORTED_NAMES.has(name)) {
      throw new BlueprintImportError(
        `unsupported entity '${name}' (selector/logistic — see #39 / gaps)`,
      );
    }
    const kind = kindFromName(name);
    const id = String(entityNumber);
    const control_behavior = raw.control_behavior ?? {};
    const entity: CircuitEntity = {
      id,
      kind,
      name,
      control_behavior,
      outputSignal: inferOutputSignal(kind, control_behavior, id),
    };
    entities.push(entity);
    entityByNumber.set(entityNumber, entity);
  }

  const nets = buildNets(wires, entityByNumber);
  applyLatchHeuristic(entities, nets);

  return {
    entities,
    nets,
    inputs: opts?.inputs ?? [],
    outputs: opts?.outputs ?? [],
  };
}

/**
 * Bridge from the directed emit graph to undirected nets (green only today).
 * Preserves `role` / ids so compiled programs can share the imported simulator.
 */
export function fromCircuitGraph(graph: CircuitGraph): ImportedCircuit {
  const entities = graph.entities.map((entity) => ({ ...entity }));
  const numberById = new Map(entities.map((entity, index) => [entity.id, index + 1]));
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));

  const wires: Array<[number, number, number, number]> = [];
  for (const wire of graph.wires) {
    const fromNum = numberById.get(wire.from);
    const toNum = numberById.get(wire.to);
    if (fromNum === undefined || toNum === undefined) {
      throw new BlueprintImportError("fromCircuitGraph: wire endpoint missing entity");
    }
    const isConst = entityById.get(wire.from)?.kind === "constant";
    const fromConnector =
      wire.color === "red"
        ? isConst
          ? WIRE_CONNECTOR.redIn
          : WIRE_CONNECTOR.redOut
        : isConst
          ? WIRE_CONNECTOR.greenIn
          : WIRE_CONNECTOR.greenOut;
    const toConnector = wire.color === "red" ? WIRE_CONNECTOR.redIn : WIRE_CONNECTOR.greenIn;
    wires.push([fromNum, fromConnector, toNum, toConnector]);
  }

  const byNumber = new Map(entities.map((entity, index) => [index + 1, entity]));
  const nets = buildNets(wires, byNumber);
  applyLatchHeuristic(entities, nets);

  return {
    entities,
    nets,
    inputs: graph.inputs.map((port) => ({ ...port })),
    outputs: graph.outputs.map((port) => ({ ...port })),
  };
}
