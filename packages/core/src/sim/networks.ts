import type { CircuitEntity, CircuitGraph, WireEdge } from "../combinators.js";

/**
 * For each consumer entity id, the producer entity ids whose outputs feed its input
 * (`WireEdge.from` → `WireEdge.to`).
 */
export function producersByConsumer(wires: readonly WireEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const wire of wires) {
    const list = map.get(wire.to);
    if (list === undefined) {
      map.set(wire.to, [wire.from]);
    } else {
      list.push(wire.from);
    }
  }
  return map;
}

/**
 * Topological order of non-latch entities for combinational evaluation within a tick.
 * Edges into or out of `role: "latch"` are ignored for ordering (latch Q is available all
 * tick; D is sampled at the edge). Same cycle-break idea as `layout.ts`.
 */
export function combinationalOrder(graph: CircuitGraph): CircuitEntity[] {
  const latchIds = new Set<string>();
  for (const entity of graph.entities) {
    if (entity.role === "latch") {
      latchIds.add(entity.id);
    }
  }

  const combo = graph.entities.filter((entity) => entity.role !== "latch");
  const originalIndex = new Map(combo.map((entity, index) => [entity.id, index]));
  const incoming = new Map(combo.map((entity) => [entity.id, 0]));
  const outgoing = new Map<string, string[]>(combo.map((entity) => [entity.id, []]));

  for (const wire of graph.wires) {
    if (latchIds.has(wire.to) || latchIds.has(wire.from)) {
      continue;
    }
    if (!incoming.has(wire.to) || !outgoing.has(wire.from)) {
      continue;
    }
    outgoing.get(wire.from)?.push(wire.to);
    incoming.set(wire.to, (incoming.get(wire.to) ?? 0) + 1);
  }

  const byId = new Map(combo.map((entity) => [entity.id, entity]));
  const ready = combo.filter((entity) => incoming.get(entity.id) === 0).map((e) => e.id);
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

  if (order.length !== combo.length) {
    // Residual cycles among combo entities — fall back to declaration order.
    return combo;
  }
  return order;
}
