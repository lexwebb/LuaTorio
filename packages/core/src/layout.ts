import type { CircuitEntity, CircuitGraph, CombinatorKind, WireEdge } from "./combinators.js";

/** A `CircuitEntity` with a blueprint position and `entity_number` assigned. */
export interface PlacedEntity extends CircuitEntity {
  entity_number: number;
  position: { x: number; y: number };
}

/**
 * A Factorio 2.0 blueprint `wires` entry: `[src_entity_number, src_connector, dst_entity_number,
 * dst_connector]`. Connector ids are `defines.wire_connector_id` values (see `GREEN_WIRE_*`
 * below); v1/v2 phase 1 only ever emits green wires.
 */
export type FactorioWire = [number, number, number, number];

export interface LaidOutCircuit {
  entities: PlacedEntity[];
  wires: FactorioWire[];
  outputs: CircuitGraph["outputs"];
  inputs: CircuitGraph["inputs"];
}

const GREEN_WIRE_INPUT = 2;
const GREEN_WIRE_OUTPUT = 4;

/** 2-tile spacing between successive entities' x positions. */
const X_SPACING = 2;

/** Green-wire connector id for `kind` on the given endpoint side of a `WireEdge`. */
function greenConnector(kind: CombinatorKind, side: "from" | "to"): number {
  return kind !== "constant" && side === "from" ? GREEN_WIRE_OUTPUT : GREEN_WIRE_INPUT;
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
    // Break cycles at latch sinks: do not count wires that target a latch for Kahn degree.
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
      if (remaining === 0) ready.push(next);
    }
  }

  if (order.length !== entities.length) {
    throw new Error("layout: circuit graph contains a cycle");
  }
  return order;
}

/**
 * Assigns positions and Factorio `entity_number`s to a `CircuitGraph` and rewrites its
 * `WireEdge`s into `FactorioWire` tuples. Entities are placed in topological order along a
 * single row (y = 0), `X_SPACING` tiles apart. Feedback wires into latches are retained.
 */
export function layout(graph: CircuitGraph): LaidOutCircuit {
  const ordered = topologicalOrder(graph.entities, graph.wires);

  const entityNumberById = new Map(ordered.map((entity, index) => [entity.id, index + 1]));
  const kindById = new Map(ordered.map((entity) => [entity.id, entity.kind]));

  const entities: PlacedEntity[] = ordered.map((entity, index) => ({
    ...entity,
    entity_number: index + 1,
    position: { x: index * X_SPACING, y: 0 },
  }));

  const wires: FactorioWire[] = graph.wires.map((wire) => [
    entityNumberById.get(wire.from) as number,
    greenConnector(kindById.get(wire.from) as CombinatorKind, "from"),
    entityNumberById.get(wire.to) as number,
    greenConnector(kindById.get(wire.to) as CombinatorKind, "to"),
  ]);

  return { entities, wires, outputs: graph.outputs, inputs: graph.inputs };
}
