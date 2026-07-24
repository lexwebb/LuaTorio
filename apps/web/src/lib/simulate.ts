import {
  analyze,
  type CircuitGraph,
  type LaidOutCircuit,
  layout,
  lower,
  lowerToCombinators,
  optimize,
  ParseError,
  parse,
  SemanticError,
  type SimulateResult,
  type SpatialPlace,
  simulate,
} from "@luatorio/core";

export interface SimIdle {
  status: "idle";
}

export interface SimEntityRead {
  placeId: string;
  entityId: string;
  /** Factorio entity name, e.g. logistic-chest-storage. */
  name: string;
}

export interface SimSuccess {
  status: "success";
  graph: CircuitGraph;
  laidOut: LaidOutCircuit;
  /** Absolute-coordinate `place()` entities (not part of the combinator graph). */
  places: SpatialPlace[];
  result: SimulateResult;
  inputSignals: string[];
  outputSignals: string[];
  entityReads: SimEntityRead[];
}

export interface SimFailure {
  status: "error";
  message: string;
  line: number | undefined;
  column: number | undefined;
}

export type SimOutcome = SimIdle | SimSuccess | SimFailure;

export interface RunSimulateOptions {
  ticks: number;
  inputs: Record<string, number>;
  /** Place id → signal bag for `input_from` phantoms. */
  entityInputs?: Record<string, Record<string, number>>;
}

function asSimFailure(error: unknown): SimFailure {
  if (error instanceof ParseError || error instanceof SemanticError) {
    return { status: "error", message: error.message, line: error.line, column: error.column };
  }
  return {
    status: "error",
    message: error instanceof Error ? error.message : String(error),
    line: undefined,
    column: undefined,
  };
}

/** Lower source through optimize; machine I/O places are returned for canvas + bag inject. */
export function buildGraphAndPlaces(source: string): {
  graph: CircuitGraph;
  places: SpatialPlace[];
} {
  const module = optimize(lower(analyze(parse(source))));
  return {
    graph: lowerToCombinators(module),
    places: module.places ?? [],
  };
}

/** Lower source to a combinator graph (optimized), same path as compile before layout/emit. */
export function buildGraph(source: string): CircuitGraph {
  return buildGraphAndPlaces(source).graph;
}

function entityReadsFor(graph: CircuitGraph, places: SpatialPlace[]): SimEntityRead[] {
  const placeById = new Map(places.map((place) => [place.id, place]));
  return (graph.entityReads ?? []).map((read) => ({
    placeId: read.placeId,
    entityId: read.entityId,
    name: placeById.get(read.placeId)?.name ?? read.placeId,
  }));
}

/** Probe input ports and `input_from` bag editors without running the simulator. */
export function probeSim(
  source: string,
): { status: "ok"; signals: string[]; reads: SimEntityRead[] } | SimFailure {
  try {
    const { graph, places } = buildGraphAndPlaces(source);
    return {
      status: "ok",
      signals: graph.inputs.map((port) => port.signal),
      reads: entityReadsFor(graph, places),
    };
  } catch (error) {
    return asSimFailure(error);
  }
}

/**
 * Build graph → layered layout (canvas) → simulate with per-entity bags for the inspector.
 */
export function runSimulate(source: string, opts: RunSimulateOptions): SimOutcome {
  try {
    const { graph, places } = buildGraphAndPlaces(source);
    const laidOut = layout(graph, { arrangement: "layered" });
    const entityReads = entityReadsFor(graph, places);
    const result = simulate(graph, {
      ticks: Math.max(1, Math.min(opts.ticks, 256)),
      inputs: opts.inputs,
      entityInputs: opts.entityInputs,
      entityOutputs: true,
    });
    return {
      status: "success",
      graph,
      laidOut,
      places,
      result,
      inputSignals: graph.inputs.map((port) => port.signal),
      outputSignals: graph.outputs.map((port) => port.signal),
      entityReads,
    };
  } catch (error) {
    return asSimFailure(error);
  }
}
