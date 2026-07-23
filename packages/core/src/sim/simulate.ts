import type { CircuitEntity, CircuitGraph } from "../combinators.js";
import { evalConstant, evalEntity, isEmptyConstant } from "./eval.js";
import { combinationalOrder, producersByConsumer } from "./networks.js";
import { bagGet, bagSet, emptyBag, type SignalBag, toInt32 } from "./signals.js";

/**
 * Simulation timing model.
 * - `"factorio"` (default): each non-latch combinator has 1-tick delay; within one API tick the
 *   combo cone settles (up to depth micro-steps), then `role: "latch"` clocks once. Matches
 *   Factorio per-combinator latency while preserving synchronous language `tick()` semantics.
 * - `"factorio-parallel"`: every non-constant combinator updates in parallel each API tick
 *   (literal Factorio sandbox; compiled loops need emit depth 0 between latches).
 * - `"latch-sync"`: **@deprecated** legacy bridge — combo combinational same-tick; only latches delay.
 */
export type SimulateMode = "factorio" | "factorio-parallel" | "latch-sync";

export interface SimulateOptions {
  ticks: number;
  /** Injected onto input-port placeholder entities each tick (by user signal name). */
  inputs?: Record<string, number> | ((tick: number) => Record<string, number>);
  /** Timing model. Default `"factorio"`. */
  mode?: SimulateMode;
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

function sampleOutputs(
  graph: CircuitGraph,
  producers: ReadonlyMap<string, string[]>,
  outputs: ReadonlyMap<string, SignalBag>,
): Record<string, number> {
  const tickOutputs: Record<string, number> = {};
  for (const port of graph.outputs) {
    tickOutputs[port.signal] = readOutputPort(port, producers, outputs);
  }
  return tickOutputs;
}

/** Non-latch, non-constant entities (combinational cone under settle-then-clock). */
function comboEntities(graph: CircuitGraph): CircuitEntity[] {
  return graph.entities.filter((entity) => entity.kind !== "constant" && entity.role !== "latch");
}

function latchEntitiesOf(graph: CircuitGraph): CircuitEntity[] {
  return graph.entities.filter((entity) => entity.role === "latch");
}

/** Upper bound on combo micro-steps needed to propagate through the non-latch cone. */
export function comboSettleDepth(graph: CircuitGraph): number {
  const n = comboEntities(graph).length;
  return n === 0 ? 0 : n;
}

function parallelUpdate(
  entities: readonly CircuitEntity[],
  producers: ReadonlyMap<string, string[]>,
  outputs: Map<string, SignalBag>,
): void {
  const next = new Map<string, SignalBag>();
  for (const entity of entities) {
    next.set(entity.id, evalEntity(entity, sumProducerBags(entity.id, producers, outputs)));
  }
  for (const [id, bag] of next) {
    outputs.set(id, bag);
  }
}

function simulateLatchSync(graph: CircuitGraph, opts: SimulateOptions): SimulateResult {
  const entityById = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const producers = producersByConsumer(graph.wires);
  const comboOrder = combinationalOrder(graph);
  const inputEntityIds = new Set(graph.inputs.map((port) => port.entityId));
  const latches = latchEntitiesOf(graph);

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

    for (const latch of latches) {
      outputs.set(latch.id, evalEntity(latch, sumProducerBags(latch.id, producers, outputs)));
    }

    ticks.push({ outputs: sampleOutputs(graph, producers, outputs) });
  }

  return { ticks };
}

/**
 * True Factorio: every non-constant combinator double-buffers in parallel each API tick.
 */
function simulateFactorioParallel(graph: CircuitGraph, opts: SimulateOptions): SimulateResult {
  const entityById = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const producers = producersByConsumer(graph.wires);
  const inputEntityIds = new Set(graph.inputs.map((port) => port.entityId));
  const delayed = graph.entities.filter((entity) => entity.kind !== "constant");

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
    parallelUpdate(delayed, producers, outputs);
    ticks.push({ outputs: sampleOutputs(graph, producers, outputs) });
  }

  return { ticks };
}

/**
 * Factorio delays on the combo cone (micro-steps), then clock all latches once per API tick.
 */
function simulateFactorio(graph: CircuitGraph, opts: SimulateOptions): SimulateResult {
  const entityById = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const producers = producersByConsumer(graph.wires);
  const inputEntityIds = new Set(graph.inputs.map((port) => port.entityId));
  const combos = comboEntities(graph);
  const latches = latchEntitiesOf(graph);
  const depth = comboSettleDepth(graph);

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

    for (let step = 0; step < depth; step += 1) {
      parallelUpdate(combos, producers, outputs);
    }
    parallelUpdate(latches, producers, outputs);

    ticks.push({ outputs: sampleOutputs(graph, producers, outputs) });
  }

  return { ticks };
}

/**
 * Tick-accurate green-wire simulator for a pre-layout `CircuitGraph`.
 *
 * Default `mode: "factorio"` applies 1-tick delay to each non-latch combinator while settling
 * the combo cone before clocking `role: "latch"` memories once per API tick (language clock).
 * Use `factorio-parallel` for a pure every-combinator-every-tick sandbox.
 */
export function simulate(graph: CircuitGraph, opts: SimulateOptions): SimulateResult {
  const mode = opts.mode ?? "factorio";
  switch (mode) {
    case "latch-sync":
      return simulateLatchSync(graph, opts);
    case "factorio-parallel":
      return simulateFactorioParallel(graph, opts);
    case "factorio":
      return simulateFactorio(graph, opts);
    default: {
      const unreachable: never = mode;
      throw new Error(`simulate: unknown mode '${String(unreachable)}'`);
    }
  }
}
