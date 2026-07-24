import {
  analyze,
  layout,
  lower,
  lowerToCombinators,
  optimize,
  parse,
  ParseError,
  SemanticError,
  simulate,
  type CircuitGraph,
  type LaidOutCircuit,
  type SimulateResult,
  type SpatialPlace,
} from "@luatorio/core";

export interface SimIdle {
  status: "idle";
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
}

/** Lower source through optimize; machine I/O places are returned but intentionally not simulated. */
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

/** Input signal names for the Simulate panel, or a failure if source does not lower. */
export function probeSimInputs(
  source: string,
): { status: "ok"; signals: string[] } | SimFailure {
  try {
    const graph = buildGraph(source);
    return { status: "ok", signals: graph.inputs.map((port) => port.signal) };
  } catch (error) {
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
}

/**
 * Build graph → layered layout (canvas) → simulate with per-entity bags for the inspector.
 */
export function runSimulate(source: string, opts: RunSimulateOptions): SimOutcome {
  try {
    const { graph, places } = buildGraphAndPlaces(source);
    const laidOut = layout(graph, { arrangement: "layered" });
    const result = simulate(graph, {
      ticks: Math.max(1, Math.min(opts.ticks, 256)),
      inputs: opts.inputs,
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
    };
  } catch (error) {
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
}
