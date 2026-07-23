import type {
  CircuitEntity,
  CircuitGraph,
  CombinatorKind,
  WireColor,
  WireEdge,
} from "./combinators.js";

/** A `CircuitEntity` with a blueprint position and `entity_number` assigned. */
export interface PlacedEntity extends CircuitEntity {
  entity_number: number;
  position: { x: number; y: number };
}

/**
 * A Factorio 2.0 blueprint `wires` entry: `[src_entity_number, src_connector, dst_entity_number,
 * dst_connector]`. Connector ids are `defines.wire_connector_id` values.
 */
export type FactorioWire = [number, number, number, number];

export interface LaidOutCircuit {
  entities: PlacedEntity[];
  wires: FactorioWire[];
  outputs: CircuitGraph["outputs"];
  inputs: CircuitGraph["inputs"];
}

export type LayoutArrangement = "row" | "layered";

export interface LayoutOptions {
  /**
   * - `row` (default): topo left-to-right on y=0 — stable for blueprint emit / goldens.
   * - `layered`: rank by combo depth, stack within a column — clearer for the web canvas.
   */
  arrangement?: LayoutArrangement;
}

const RED_WIRE_INPUT = 1;
const GREEN_WIRE_INPUT = 2;
const RED_WIRE_OUTPUT = 3;
const GREEN_WIRE_OUTPUT = 4;

/** Tile spacing between successive columns (and rows in layered mode). */
const X_SPACING = 2;
const Y_SPACING = 2;

/** Wire connector id for `kind` on the given endpoint side of a colored `WireEdge`. */
function wireConnector(kind: CombinatorKind, side: "from" | "to", color: WireColor): number {
  const isOut = kind !== "constant" && side === "from";
  if (color === "red") {
    return isOut ? RED_WIRE_OUTPUT : RED_WIRE_INPUT;
  }
  return isOut ? GREEN_WIRE_OUTPUT : GREEN_WIRE_INPUT;
}

/**
 * Orders `entities` topologically via Kahn's algorithm. Edges into `role: "latch"` entities
 * are ignored for ordering so memory feedback cycles can still place; those feedback wires
 * are still emitted afterward. Non-latch cycles still throw.
 */
function topologicalOrder(entities: CircuitEntity[], wires: WireEdge[]): CircuitEntity[] {
  const originalIndex = new Map(entities.map((entity, index) => [entity.id, index]));
  const latchIds = new Set<string>();
  for (const entity of entities) {
    if (entity.role === "latch") {
      latchIds.add(entity.id);
    }
  }

  const incoming = new Map(entities.map((entity) => [entity.id, 0]));
  const outgoing = new Map<string, string[]>(entities.map((entity) => [entity.id, []]));
  for (const wire of wires) {
    if (latchIds.has(wire.to)) {
      continue;
    }
    outgoing.get(wire.from)?.push(wire.to);
    incoming.set(wire.to, (incoming.get(wire.to) ?? 0) + 1);
  }

  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const ready = entities.filter((entity) => incoming.get(entity.id) === 0).map((e) => e.id);
  const order: CircuitEntity[] = [];

  while (ready.length > 0) {
    ready.sort((a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0));
    const id = ready.shift() as string;
    order.push(byId.get(id) as CircuitEntity);
    for (const next of outgoing.get(id) ?? []) {
      const remaining = (incoming.get(next) ?? 0) - 1;
      incoming.set(next, remaining);
      if (remaining === 0) {
        ready.push(next);
      }
    }
  }

  if (order.length !== entities.length) {
    throw new Error("layout: circuit graph contains a cycle");
  }
  return order;
}

/** Longest-path rank ignoring edges into latches (same cycle break as topo). */
function layeredRanks(entities: CircuitEntity[], wires: WireEdge[]): Map<string, number> {
  const latchIds = new Set(
    entities.filter((entity) => entity.role === "latch").map((entity) => entity.id),
  );
  const preds = new Map<string, string[]>(entities.map((entity) => [entity.id, []]));
  for (const wire of wires) {
    if (latchIds.has(wire.to)) {
      continue;
    }
    preds.get(wire.to)?.push(wire.from);
  }

  const order = topologicalOrder(entities, wires);
  const rank = new Map<string, number>();
  for (const entity of order) {
    let best = 0;
    for (const from of preds.get(entity.id) ?? []) {
      best = Math.max(best, (rank.get(from) ?? 0) + 1);
    }
    // Inputs / sources stay in column 0; latches prefer a column after their combo feeders
    // when they only have feedback edges (preds empty under the latch break).
    if (entity.role === "latch" && best === 0) {
      best = 1;
    }
    rank.set(entity.id, best);
  }
  return rank;
}

function assignPositions(
  ordered: CircuitEntity[],
  ranks: Map<string, number> | undefined,
): PlacedEntity[] {
  if (ranks === undefined) {
    return ordered.map((entity, index) => ({
      ...entity,
      entity_number: index + 1,
      position: { x: index * X_SPACING, y: 0 },
    }));
  }

  // Keep `__o*` output placeholders in a column past the combo cone (canvas L→R).
  const outputIds = new Set(
    ordered.filter((entity) => entity.id.startsWith("__o")).map((entity) => entity.id),
  );
  let maxComboRank = 0;
  for (const [id, r] of ranks) {
    if (!outputIds.has(id)) {
      maxComboRank = Math.max(maxComboRank, r);
    }
  }
  const outRank = maxComboRank + 1;
  for (const id of outputIds) {
    ranks.set(id, outRank);
  }

  const byRank = new Map<number, CircuitEntity[]>();
  for (const entity of ordered) {
    const r = ranks.get(entity.id) ?? 0;
    const list = byRank.get(r) ?? [];
    list.push(entity);
    byRank.set(r, list);
  }

  const placed: PlacedEntity[] = [];
  let number = 1;
  const sortedRanks = [...byRank.keys()].sort((a, b) => a - b);
  for (const r of sortedRanks) {
    const column = byRank.get(r) ?? [];
    column.forEach((entity, row) => {
      placed.push({
        ...entity,
        entity_number: number,
        position: { x: r * X_SPACING, y: row * Y_SPACING },
      });
      number += 1;
    });
  }
  return placed;
}

/**
 * Assigns positions and Factorio `entity_number`s to a `CircuitGraph` and rewrites its
 * `WireEdge`s into `FactorioWire` tuples. Default `row` placement matches historical emit.
 * Use `arrangement: "layered"` for the playground canvas.
 */
export function layout(graph: CircuitGraph, options?: LayoutOptions): LaidOutCircuit {
  const arrangement = options?.arrangement ?? "row";
  const ordered = topologicalOrder(graph.entities, graph.wires);
  const ranks = arrangement === "layered" ? layeredRanks(graph.entities, graph.wires) : undefined;

  const entities =
    arrangement === "layered"
      ? assignPositions(ordered, ranks)
      : ordered.map((entity, index) => ({
          ...entity,
          entity_number: index + 1,
          position: { x: index * X_SPACING, y: 0 },
        }));

  const entityNumberById = new Map(entities.map((entity) => [entity.id, entity.entity_number]));
  const kindById = new Map(entities.map((entity) => [entity.id, entity.kind]));

  const wires: FactorioWire[] = graph.wires.map((wire) => [
    entityNumberById.get(wire.from) as number,
    wireConnector(kindById.get(wire.from) as CombinatorKind, "from", wire.color),
    entityNumberById.get(wire.to) as number,
    wireConnector(kindById.get(wire.to) as CombinatorKind, "to", wire.color),
  ]);

  return { entities, wires, outputs: graph.outputs, inputs: graph.inputs };
}
