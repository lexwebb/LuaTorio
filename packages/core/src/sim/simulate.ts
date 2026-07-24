import type { CircuitEntity, CircuitGraph } from "../combinators.js";
import type { ColoredInputs } from "./colors.js";
import { mergeBags } from "./colors.js";
import { evalConstant, evalEntity, isEmptyConstant } from "./eval.js";
import {
  coloredInputBags,
  combinationalOrder,
  producersByConsumer,
  producersByConsumerColor,
} from "./networks.js";
import { bagGet, bagSet, emptyBag, type SignalBag, toInt32 } from "./signals.js";

/**
 * Simulation timing model.
 * Spatial `place()` entities are not combinators; `input_from` uses sim-only phantoms
 * (`CircuitGraph.entityReads`) so bags can be injected without modeling logistics.
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
  /**
   * Injected onto `input_from` / `entity_read` phantoms each tick (by place id → signal bag).
   * Still not a logistics-network sim — stand-in for chest contents on the wire.
   */
  entityInputs?:
    | Record<string, Record<string, number>>
    | ((tick: number) => Record<string, Record<string, number>>);
  /** Timing model. Default `"factorio"`. */
  mode?: SimulateMode;
  /** When true, each tick includes every entity's output signal bag (playground inspector). */
  entityOutputs?: boolean;
}

export interface SimulateTick {
  /** Named output-port values after this tick (see delay note on `simulate`). */
  outputs: Record<string, number>;
  /** Present when `entityOutputs: true` — entity id → signal name → count. */
  entities?: Record<string, Record<string, number>>;
}

export interface SimulateResult {
  ticks: SimulateTick[];
}

function resolveTickValue<T extends Record<string, unknown>>(
  value: T | ((tick: number) => T) | undefined,
  tick: number,
): T {
  if (value === undefined) {
    return {} as T;
  }
  return typeof value === "function" ? value(tick) : value;
}

function inputBags(
  entityId: string,
  producersColor: ReadonlyMap<string, { red: string[]; green: string[] }>,
  outputs: ReadonlyMap<string, SignalBag>,
): ColoredInputs {
  return coloredInputBags(entityId, producersColor, outputs);
}

/** Merged bag for output-port sampling (ports still read the summed network). */
function sumProducerBags(
  entityId: string,
  producersColor: ReadonlyMap<string, { red: string[]; green: string[] }>,
  outputs: ReadonlyMap<string, SignalBag>,
): SignalBag {
  const colored = inputBags(entityId, producersColor, outputs);
  return mergeBags(colored.red, colored.green);
}

/**
 * Seed latch Q from non-empty constants wired directly into the latch.
 * Emitter places `memory.init` literals that way; their filter signal names are the literal
 * ids (not the memory signal), so we take the constant's count as the initial value of the
 * latch's `outputSignal`. Multi-signal fused clocks set `latchSeeds` instead.
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
    const bag = emptyBag();
    if (entity.latchSeeds !== undefined) {
      for (const [signal, count] of Object.entries(entity.latchSeeds)) {
        bagSet(bag, signal, count);
      }
      outputs.set(entity.id, bag);
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

/** Write multi-signal bags onto `entity_read` phantoms (keyed by place id). */
function applyEntityInputInjection(
  graph: CircuitGraph,
  entityById: ReadonlyMap<string, CircuitEntity>,
  outputs: Map<string, SignalBag>,
  entityValues: Record<string, Record<string, number>>,
): void {
  for (const read of graph.entityReads ?? []) {
    const entity = entityById.get(read.entityId);
    if (entity === undefined) {
      continue;
    }
    const bag = emptyBag();
    const injected = entityValues[read.placeId];
    if (injected !== undefined) {
      for (const [signal, count] of Object.entries(injected)) {
        if (count !== 0) {
          bagSet(bag, signal, count);
        }
      }
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

function producerIdsFor(
  entityId: string,
  producersColor: ReadonlyMap<string, { red: string[]; green: string[] }>,
): string[] {
  const colored = producersColor.get(entityId);
  if (colored === undefined) {
    return [];
  }
  return [...colored.red, ...colored.green];
}

function readOutputPort(
  port: { signal: string; entityId: string },
  producersColor: ReadonlyMap<string, { red: string[]; green: string[] }>,
  outputs: ReadonlyMap<string, SignalBag>,
  entityById: ReadonlyMap<string, CircuitEntity>,
): number {
  const net = sumProducerBags(port.entityId, producersColor, outputs);
  if (net.has(port.signal)) {
    return bagGet(net, port.signal);
  }
  // EACH/catalog bags: absent recipe name is 0 (do not rename another recipe onto this port).
  const fromEachBag = producerIdsFor(port.entityId, producersColor).some(
    (id) => entityById.get(id)?.outputSignal === "signal-each",
  );
  if (fromEachBag) {
    return 0;
  }
  // Prefer the producer's declared output signal (fused clocks also emit `__run`, etc.).
  for (const id of producerIdsFor(port.entityId, producersColor)) {
    const sig = entityById.get(id)?.outputSignal;
    if (sig !== undefined && net.has(sig)) {
      return bagGet(net, sig);
    }
  }
  // Legacy single-signal rename: producer emits on a temp/branch id, port asks for user name.
  let sum = 0;
  for (const count of net.values()) {
    sum = toInt32(sum + count);
  }
  return sum;
}

function sampleOutputs(
  graph: CircuitGraph,
  producersColor: ReadonlyMap<string, { red: string[]; green: string[] }>,
  outputs: ReadonlyMap<string, SignalBag>,
  entityById: ReadonlyMap<string, CircuitEntity>,
): Record<string, number> {
  const tickOutputs: Record<string, number> = {};
  for (const port of graph.outputs) {
    tickOutputs[port.signal] = readOutputPort(port, producersColor, outputs, entityById);
  }
  return tickOutputs;
}

/** Non-latch, non-constant entities (combinational cone under settle-then-clock). */

function snapshotEntityOutputs(
  graph: CircuitGraph,
  outputs: ReadonlyMap<string, SignalBag>,
): Record<string, Record<string, number>> {
  const snap: Record<string, Record<string, number>> = {};
  for (const entity of graph.entities) {
    const bag = outputs.get(entity.id);
    const rec: Record<string, number> = {};
    if (bag !== undefined) {
      for (const [name, count] of bag) {
        rec[name] = count;
      }
    }
    snap[entity.id] = rec;
  }
  return snap;
}

function pushTick(
  ticks: SimulateTick[],
  graph: CircuitGraph,
  producersColor: ReadonlyMap<string, { red: string[]; green: string[] }>,
  outputs: ReadonlyMap<string, SignalBag>,
  entityById: ReadonlyMap<string, CircuitEntity>,
  entityOutputs: boolean | undefined,
): void {
  const tick: SimulateTick = {
    outputs: sampleOutputs(graph, producersColor, outputs, entityById),
  };
  if (entityOutputs) {
    tick.entities = snapshotEntityOutputs(graph, outputs);
  }
  ticks.push(tick);
}

function comboEntities(graph: CircuitGraph): CircuitEntity[] {
  return graph.entities.filter((entity) => entity.kind !== "constant" && entity.role !== "latch");
}

function latchEntitiesOf(graph: CircuitGraph): CircuitEntity[] {
  return graph.entities.filter((entity) => entity.role === "latch");
}

/** Upper bound on combo micro-steps needed to propagate through the non-latch cone. */
export function comboSettleDepth(graph: CircuitGraph): number {
  return comboEntities(graph).length;
}

function parallelUpdate(
  entities: readonly CircuitEntity[],
  producersColor: ReadonlyMap<string, { red: string[]; green: string[] }>,
  outputs: Map<string, SignalBag>,
): void {
  const next = new Map<string, SignalBag>();
  for (const entity of entities) {
    next.set(entity.id, evalEntity(entity, inputBags(entity.id, producersColor, outputs)));
  }
  for (const [id, bag] of next) {
    outputs.set(id, bag);
  }
}

/** Shared entity maps, producer index, and seeded output bags for one simulation run. */
function initSim(graph: CircuitGraph) {
  const entityById = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const producers = producersByConsumer(graph.wires);
  const producersColor = producersByConsumerColor(graph.wires);
  const inputEntityIds = new Set([
    ...graph.inputs.map((port) => port.entityId),
    ...(graph.entityReads ?? []).map((read) => read.entityId),
  ]);
  const outputs = new Map<string, SignalBag>();
  for (const entity of graph.entities) {
    outputs.set(entity.id, emptyBag());
  }
  refreshConstants(graph, outputs, inputEntityIds);
  seedLatchOutputs(graph, entityById, producers, outputs);
  return { entityById, producers, producersColor, inputEntityIds, outputs };
}

function injectTickInputs(
  graph: CircuitGraph,
  entityById: ReadonlyMap<string, CircuitEntity>,
  outputs: Map<string, SignalBag>,
  opts: SimulateOptions,
  tick: number,
): void {
  applyInputInjection(graph, entityById, outputs, resolveTickValue(opts.inputs, tick));
  applyEntityInputInjection(graph, entityById, outputs, resolveTickValue(opts.entityInputs, tick));
}

function simulateLatchSync(graph: CircuitGraph, opts: SimulateOptions): SimulateResult {
  const { entityById, producersColor, inputEntityIds, outputs } = initSim(graph);
  const comboOrder = combinationalOrder(graph);
  const latches = latchEntitiesOf(graph);
  const ticks: SimulateTick[] = [];

  for (let tick = 0; tick < opts.ticks; tick += 1) {
    injectTickInputs(graph, entityById, outputs, opts, tick);
    refreshConstants(graph, outputs, inputEntityIds);

    for (const entity of comboOrder) {
      if (entity.kind === "constant" || entity.role === "latch") {
        continue;
      }
      outputs.set(entity.id, evalEntity(entity, inputBags(entity.id, producersColor, outputs)));
    }

    for (const latch of latches) {
      outputs.set(latch.id, evalEntity(latch, inputBags(latch.id, producersColor, outputs)));
    }

    pushTick(ticks, graph, producersColor, outputs, entityById, opts.entityOutputs);
  }

  return { ticks };
}

/**
 * True Factorio: every non-constant combinator double-buffers in parallel each API tick.
 */
function simulateFactorioParallel(graph: CircuitGraph, opts: SimulateOptions): SimulateResult {
  const { entityById, producersColor, inputEntityIds, outputs } = initSim(graph);
  const delayed = graph.entities.filter((entity) => entity.kind !== "constant");
  const ticks: SimulateTick[] = [];

  for (let tick = 0; tick < opts.ticks; tick += 1) {
    injectTickInputs(graph, entityById, outputs, opts, tick);
    refreshConstants(graph, outputs, inputEntityIds);
    parallelUpdate(delayed, producersColor, outputs);
    pushTick(ticks, graph, producersColor, outputs, entityById, opts.entityOutputs);
  }

  return { ticks };
}

/**
 * Factorio delays on the combo cone (micro-steps), then clock all latches once per API tick.
 */
function simulateFactorio(graph: CircuitGraph, opts: SimulateOptions): SimulateResult {
  const { entityById, producersColor, inputEntityIds, outputs } = initSim(graph);
  const combos = comboEntities(graph);
  const latches = latchEntitiesOf(graph);
  const depth = combos.length;
  const ticks: SimulateTick[] = [];

  for (let tick = 0; tick < opts.ticks; tick += 1) {
    injectTickInputs(graph, entityById, outputs, opts, tick);
    refreshConstants(graph, outputs, inputEntityIds);

    for (let step = 0; step < depth; step += 1) {
      parallelUpdate(combos, producersColor, outputs);
    }
    parallelUpdate(latches, producersColor, outputs);

    pushTick(ticks, graph, producersColor, outputs, entityById, opts.entityOutputs);
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
