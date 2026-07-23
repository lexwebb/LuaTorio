import type { CircuitEntity } from "../combinators.js";
import { evalConstant, evalEntity, isEmptyConstant } from "./eval.js";
import type { ImportedCircuit } from "./import.js";
import { bagGet, bagSet, emptyBag, type SignalBag, toInt32 } from "./signals.js";
import type { SimulateOptions, SimulateResult, SimulateTick } from "./simulate.js";

function resolveInputs(inputs: SimulateOptions["inputs"], tick: number): Record<string, number> {
  if (inputs === undefined) {
    return {};
  }
  return typeof inputs === "function" ? inputs(tick) : inputs;
}

/** Visit every `out` member on nets attached to this entity's `in` side. */
function forEachProducerOnInputNets(
  entityId: string,
  circuit: ImportedCircuit,
  visit: (producerId: string) => void,
): void {
  for (const net of circuit.nets) {
    if (!net.members.some((m) => m.entityId === entityId && m.side === "in")) {
      continue;
    }
    for (const member of net.members) {
      if (member.side === "out") {
        visit(member.entityId);
      }
    }
  }
}

/** Sum output bags of every `out` member on nets attached to this entity's `in` side. */
function sumInputNets(
  entityId: string,
  circuit: ImportedCircuit,
  outputs: ReadonlyMap<string, SignalBag>,
): SignalBag {
  const input = emptyBag();
  forEachProducerOnInputNets(entityId, circuit, (producerId) => {
    const bag = outputs.get(producerId);
    if (bag === undefined) {
      return;
    }
    for (const [name, count] of bag) {
      bagSet(input, name, toInt32(bagGet(input, name) + count));
    }
  });
  return input;
}

/**
 * Seed latch Q from non-empty constants that share an input net with the latch.
 * Same semantics as directed `seedLatchOutputs`.
 */
function seedLatchOutputs(
  circuit: ImportedCircuit,
  entityById: ReadonlyMap<string, CircuitEntity>,
  outputs: Map<string, SignalBag>,
): void {
  for (const entity of circuit.entities) {
    if (entity.role !== "latch") {
      continue;
    }
    let seed = 0;
    let found = false;
    forEachProducerOnInputNets(entity.id, circuit, (producerId) => {
      const producer = entityById.get(producerId);
      if (producer === undefined || producer.kind !== "constant" || isEmptyConstant(producer)) {
        return;
      }
      for (const count of evalConstant(producer).values()) {
        seed = toInt32(seed + count);
        found = true;
      }
    });
    const bag = emptyBag();
    if (found) {
      bagSet(bag, entity.outputSignal, seed);
    }
    outputs.set(entity.id, bag);
  }
}

function applyInputInjection(
  circuit: ImportedCircuit,
  entityById: ReadonlyMap<string, CircuitEntity>,
  outputs: Map<string, SignalBag>,
  inputValues: Record<string, number>,
): void {
  for (const port of circuit.inputs) {
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
  circuit: ImportedCircuit,
  outputs: Map<string, SignalBag>,
  inputEntityIds: ReadonlySet<string>,
): void {
  for (const entity of circuit.entities) {
    if (entity.kind !== "constant" || inputEntityIds.has(entity.id)) {
      continue;
    }
    outputs.set(entity.id, evalConstant(entity));
  }
}

function readOutputPort(
  port: { signal: string; entityId: string },
  circuit: ImportedCircuit,
  outputs: ReadonlyMap<string, SignalBag>,
): number {
  const net = sumInputNets(port.entityId, circuit, outputs);
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
  circuit: ImportedCircuit,
  outputs: ReadonlyMap<string, SignalBag>,
): Record<string, number> {
  const tickOutputs: Record<string, number> = {};
  for (const port of circuit.outputs) {
    tickOutputs[port.signal] = readOutputPort(port, circuit, outputs);
  }
  return tickOutputs;
}

function comboEntities(circuit: ImportedCircuit): CircuitEntity[] {
  return circuit.entities.filter((entity) => entity.kind !== "constant" && entity.role !== "latch");
}

function latchEntitiesOf(circuit: ImportedCircuit): CircuitEntity[] {
  return circuit.entities.filter((entity) => entity.role === "latch");
}

function sequentialUpdate(
  entities: readonly CircuitEntity[],
  circuit: ImportedCircuit,
  outputs: Map<string, SignalBag>,
): void {
  for (const entity of entities) {
    outputs.set(entity.id, evalEntity(entity, sumInputNets(entity.id, circuit, outputs)));
  }
}

function parallelUpdate(
  entities: readonly CircuitEntity[],
  circuit: ImportedCircuit,
  outputs: Map<string, SignalBag>,
): void {
  const next = new Map<string, SignalBag>();
  for (const entity of entities) {
    next.set(entity.id, evalEntity(entity, sumInputNets(entity.id, circuit, outputs)));
  }
  for (const [id, bag] of next) {
    outputs.set(id, bag);
  }
}

function initSim(circuit: ImportedCircuit) {
  const entityById = new Map(circuit.entities.map((entity) => [entity.id, entity]));
  const inputEntityIds = new Set(circuit.inputs.map((port) => port.entityId));
  const outputs = new Map<string, SignalBag>();
  for (const entity of circuit.entities) {
    outputs.set(entity.id, emptyBag());
  }
  refreshConstants(circuit, outputs, inputEntityIds);
  seedLatchOutputs(circuit, entityById, outputs);
  return { entityById, inputEntityIds, outputs };
}

function simulateLatchSync(circuit: ImportedCircuit, opts: SimulateOptions): SimulateResult {
  const { entityById, inputEntityIds, outputs } = initSim(circuit);
  const latches = latchEntitiesOf(circuit);
  const combos = comboEntities(circuit);
  const ticks: SimulateTick[] = [];

  for (let tick = 0; tick < opts.ticks; tick += 1) {
    applyInputInjection(circuit, entityById, outputs, resolveInputs(opts.inputs, tick));
    refreshConstants(circuit, outputs, inputEntityIds);

    // Combinational pass: iterate depth times (no topo order on undirected nets).
    for (let step = 0; step < combos.length; step += 1) {
      sequentialUpdate(combos, circuit, outputs);
    }
    sequentialUpdate(latches, circuit, outputs);

    ticks.push({ outputs: sampleOutputs(circuit, outputs) });
  }

  return { ticks };
}

function simulateFactorioParallel(circuit: ImportedCircuit, opts: SimulateOptions): SimulateResult {
  const { entityById, inputEntityIds, outputs } = initSim(circuit);
  const delayed = circuit.entities.filter((entity) => entity.kind !== "constant");
  const ticks: SimulateTick[] = [];

  for (let tick = 0; tick < opts.ticks; tick += 1) {
    applyInputInjection(circuit, entityById, outputs, resolveInputs(opts.inputs, tick));
    refreshConstants(circuit, outputs, inputEntityIds);
    parallelUpdate(delayed, circuit, outputs);
    ticks.push({ outputs: sampleOutputs(circuit, outputs) });
  }

  return { ticks };
}

function simulateFactorio(circuit: ImportedCircuit, opts: SimulateOptions): SimulateResult {
  const { entityById, inputEntityIds, outputs } = initSim(circuit);
  const combos = comboEntities(circuit);
  const latches = latchEntitiesOf(circuit);
  const depth = combos.length;
  const ticks: SimulateTick[] = [];

  for (let tick = 0; tick < opts.ticks; tick += 1) {
    applyInputInjection(circuit, entityById, outputs, resolveInputs(opts.inputs, tick));
    refreshConstants(circuit, outputs, inputEntityIds);

    for (let step = 0; step < depth; step += 1) {
      parallelUpdate(combos, circuit, outputs);
    }
    parallelUpdate(latches, circuit, outputs);

    ticks.push({ outputs: sampleOutputs(circuit, outputs) });
  }

  return { ticks };
}

/**
 * Tick-accurate simulator for an undirected-net `ImportedCircuit` (foreign blueprints).
 * Timing modes match `simulate` on directed graphs.
 */
export function simulateImported(circuit: ImportedCircuit, opts: SimulateOptions): SimulateResult {
  const mode = opts.mode ?? "factorio";
  switch (mode) {
    case "latch-sync":
      return simulateLatchSync(circuit, opts);
    case "factorio-parallel":
      return simulateFactorioParallel(circuit, opts);
    case "factorio":
      return simulateFactorio(circuit, opts);
    default: {
      const unreachable: never = mode;
      throw new Error(`simulateImported: unknown mode '${String(unreachable)}'`);
    }
  }
}
