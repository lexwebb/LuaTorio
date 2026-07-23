import type { CircuitEntity, CircuitGraph } from "../combinators.js";
import { evalConstant, evalEntity, isEmptyConstant } from "./eval.js";
import { combinationalOrder, producersByConsumer } from "./networks.js";
import { bagGet, bagSet, emptyBag, type SignalBag, toInt32 } from "./signals.js";

export interface SimulateOptions {
  ticks: number;
  /** Injected onto input-port placeholder entities each tick (by user signal name). */
  inputs?: Record<string, number> | ((tick: number) => Record<string, number>);
}

export interface SimulateTick {
  /** Named output-port values after this tick (see delay note on `simulate`). */
  outputs: Record<string, number>;
}

export interface SimulateResult {
  ticks: SimulateTick[];
}

function resolveInputs(inputs: SimulateOptions["inputs"], tick: number): Record<string, number> {
  if (inputs === undefined) {
    return {};
  }
  return typeof inputs === "function" ? inputs(tick) : inputs;
}

function sumProducerBags(
  entityId: string,
  producers: ReadonlyMap<string, string[]>,
  outputs: ReadonlyMap<string, SignalBag>,
): SignalBag {
  const input = emptyBag();
  for (const from of producers.get(entityId) ?? []) {
    const bag = outputs.get(from);
    if (bag === undefined) {
      continue;
    }
    for (const [name, count] of bag) {
      bagSet(input, name, toInt32(bagGet(input, name) + count));
    }
  }
  return input;
}

/**
 * Seed latch Q from non-empty constants wired directly into the latch.
 * Emitter places `memory.init` literals that way; their filter signal names are the literal
 * ids (not the memory signal), so we take the constant's count as the initial value of the
 * latch's `outputSignal`.
 */
function seedLatchOutputs(
  graph: CircuitGraph,
  entityById: ReadonlyMap<string, CircuitEntity>,
  producers: ReadonlyMap<string, string[]>,
  outputs: Map<string, SignalBag>,
): void {
  for (const entity of graph.entities) {
    if (entity.role !== "latch") {
      continue;
    }
    let seed = 0;
    let found = false;
    for (const from of producers.get(entity.id) ?? []) {
      const producer = entityById.get(from);
      if (producer === undefined || producer.kind !== "constant" || isEmptyConstant(producer)) {
        continue;
      }
      for (const count of evalConstant(producer).values()) {
        seed = toInt32(seed + count);
        found = true;
      }
    }
    const bag = emptyBag();
    if (found) {
      bagSet(bag, entity.outputSignal, seed);
    }
    outputs.set(entity.id, bag);
  }
}

function applyInputInjection(
  graph: CircuitGraph,
  entityById: ReadonlyMap<string, CircuitEntity>,
  outputs: Map<string, SignalBag>,
  inputValues: Record<string, number>,
): void {
  for (const port of graph.inputs) {
    const entity = entityById.get(port.entityId);
    if (entity === undefined) {
      continue;
    }
    const bag = emptyBag();
    const value = inputValues[port.signal];
    if (value !== undefined) {
      // Downstream combinators reference the input *node id* as the wire signal
      // (`first_signal: __t1`), while `outputSignal` is the Lua-facing name (signal-A).
      // Emit under both so control_behavior and human traces agree.
      bagSet(bag, entity.id, value);
      bagSet(bag, entity.outputSignal, value);
    }
    outputs.set(entity.id, bag);
  }
}

function refreshConstants(
  graph: CircuitGraph,
  outputs: Map<string, SignalBag>,
  inputEntityIds: ReadonlySet<string>,
): void {
  for (const entity of graph.entities) {
    if (entity.kind !== "constant" || inputEntityIds.has(entity.id)) {
      continue;
    }
    outputs.set(entity.id, evalConstant(entity));
  }
}

/**
 * Read an output marker's value. Wires usually carry a temp/memory signal id, while
 * `port.signal` is the Lua-facing name used as the trace key — prefer an exact match on
 * the input network, otherwise the sole (or summed) count on that network.
 */
function readOutputPort(
  port: { signal: string; entityId: string },
  producers: ReadonlyMap<string, string[]>,
  outputs: ReadonlyMap<string, SignalBag>,
): number {
  const net = sumProducerBags(port.entityId, producers, outputs);
  const named = bagGet(net, port.signal);
  if (named !== 0 || net.has(port.signal)) {
    return named;
  }
  let sum = 0;
  for (const count of net.values()) {
    sum = toInt32(sum + count);
  }
  return sum;
}

/**
 * Tick-accurate green-wire simulator for a pre-layout `CircuitGraph`.
 *
 * ## Delay model (latch-synchronous)
 *
 * Factorio gives every combinator a 1-tick delay. Our emitter puts **combinational** depth
 * (arith/decider gates, `+1`, cmp, mux sides) in series with each `role: "latch"` memory
 * cell. Interpreting every entity as registered would multi-tick each source-level assign
 * and break clocked `while`/`for` desugar (and free-running `x=x+1`).
 *
 * This MVP therefore treats:
 * - `role: "latch"` — **1-tick** registers (Q holds; D sampled at tick end)
 * - all other arithmetic/decider — **combinational** within the tick (topo order)
 * - constants / input placeholders — continuous drive
 *
 * ## Traces
 *
 * Each tick: inject inputs → eval combinational logic from current latch Q → update
 * latch Q ← D → sample `graph.outputs` (marker input networks).
 *
 * Free-running `x=x+1` from 0: after `t` ticks, `signal-A === t`.
 * Clocked loops: one body iteration per tick while `__run ∧ cond` (matching `lower.ts`).
 */
export function simulate(graph: CircuitGraph, opts: SimulateOptions): SimulateResult {
  const entityById = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const producers = producersByConsumer(graph.wires);
  const comboOrder = combinationalOrder(graph);
  const inputEntityIds = new Set(graph.inputs.map((port) => port.entityId));
  const latchEntities = graph.entities.filter((entity) => entity.role === "latch");

  const outputs = new Map<string, SignalBag>();
  for (const entity of graph.entities) {
    outputs.set(entity.id, emptyBag());
  }

  refreshConstants(graph, outputs, inputEntityIds);
  seedLatchOutputs(graph, entityById, producers, outputs);

  const ticks: SimulateTick[] = [];

  for (let tick = 0; tick < opts.ticks; tick += 1) {
    applyInputInjection(graph, entityById, outputs, resolveInputs(opts.inputs, tick));
    refreshConstants(graph, outputs, inputEntityIds);

    for (const entity of comboOrder) {
      if (entity.kind === "constant" || entity.role === "latch") {
        continue;
      }
      outputs.set(entity.id, evalEntity(entity, sumProducerBags(entity.id, producers, outputs)));
    }

    for (const latch of latchEntities) {
      outputs.set(latch.id, evalEntity(latch, sumProducerBags(latch.id, producers, outputs)));
    }

    const tickOutputs: Record<string, number> = {};
    for (const port of graph.outputs) {
      tickOutputs[port.signal] = readOutputPort(port, producers, outputs);
    }
    ticks.push({ outputs: tickOutputs });
  }

  return { ticks };
}
