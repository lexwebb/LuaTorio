import type { CircuitEntity, CircuitGraph, CombinatorKind, WireEdge } from "./combinators.js";

/** A `CircuitEntity` with a blueprint position and `entity_number` assigned (#9). */
export interface PlacedEntity extends CircuitEntity {
  entity_number: number;
  position: { x: number; y: number };
}

/**
 * A Factorio 2.0 blueprint `wires` entry: `[src_entity_number, src_connector, dst_entity_number,
 * dst_connector]`. Connector ids are `defines.wire_connector_id` values (see `GREEN_WIRE_*`
 * below); v1 only ever emits green wires (#8's `WireEdge.color` is always `"green"`).
 */
export type FactorioWire = [number, number, number, number];

export interface LaidOutCircuit {
  entities: PlacedEntity[];
  wires: FactorioWire[];
  outputs: CircuitGraph["outputs"];
  inputs: CircuitGraph["inputs"];
}

/**
 * Factorio 2.0 `defines.wire_connector_id` green-wire values. Undocumented on the (stale)
 * blueprint-string-format wiki page; reverse-engineered at
 * https://wiki.factorio.com/Talk:Blueprint_string_format:
 *
 *   circuit_green = 2, combinator_input_green = 2, combinator_output_green = 4
 *
 * A single-connection-point entity (a constant combinator) only ever exposes connector 2 —
 * numerically the same id as a two-sided combinator's *input* side, since both just mean "the
 * entity's one/first connection point". Two-sided combinators (arithmetic/decider) additionally
 * expose a distinct *output*-side connector, 4.
 */
const GREEN_WIRE_INPUT = 2;
const GREEN_WIRE_OUTPUT = 4;

/** 2-tile spacing between successive entities' x positions, per the layout design (#9). */
const X_SPACING = 2;

/** Green-wire connector id for `kind` on the given endpoint side of a `WireEdge`. */
function greenConnector(kind: CombinatorKind, side: "from" | "to"): number {
  // Only a two-sided combinator's producing ("from") side uses the distinct output connector;
  // every other case (constant combinators, and any "to"/consuming side) uses connector 2.
  return kind !== "constant" && side === "from" ? GREEN_WIRE_OUTPUT : GREEN_WIRE_INPUT;
}

/**
 * Orders `entities` topologically (producers before consumers) via Kahn's algorithm, breaking
 * ties by each entity's original index for determinism. Inputs (no incoming wires) and other
 * sources naturally sort first; output boundary markers (#8) and other sinks naturally sort
 * last — giving the "inputs near left, outputs near right" placement the design calls for
 * without any special-casing of `graph.inputs`/`graph.outputs`.
 */
function topologicalOrder(entities: CircuitEntity[], wires: WireEdge[]): CircuitEntity[] {
  const originalIndex = new Map(entities.map((entity, index) => [entity.id, index]));
  const incoming = new Map(entities.map((entity) => [entity.id, 0]));
  const outgoing = new Map<string, string[]>(entities.map((entity) => [entity.id, []]));
  for (const wire of wires) {
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
 * `WireEdge`s into `FactorioWire` tuples (#9). Entities are placed in topological order along a
 * single row (y = 0), `X_SPACING` tiles apart — see `topologicalOrder` for why this alone
 * satisfies "inputs left, outputs right". Blueprint string encoding is out of scope — see #10.
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
