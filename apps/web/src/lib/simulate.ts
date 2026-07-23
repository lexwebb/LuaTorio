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
  simulate,
} from "@luatorio/core";

export interface SimIdle {
  status: "idle";
}

export interface SimSuccess {
  status: "success";
  graph: CircuitGraph;
  laidOut: LaidOutCircuit;
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

/** Lower source to a combinator graph (optimized), same path as compile before layout/emit. */
export function buildGraph(source: string): CircuitGraph {
  return lowerToCombinators(optimize(lower(analyze(parse(source)))));
}

/** Input signal names for the Simulate panel, or a failure if source does not lower. */
export function probeSimInputs(source: string): { status: "ok"; signals: string[] } | SimFailure {
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
 * Build graph → layout → simulate. Used by the Simulate view so validation does not depend
 * on the blueprint string path.
 */
export function runSimulate(source: string, opts: RunSimulateOptions): SimOutcome {
  try {
    const graph = buildGraph(source);
    const laidOut = layout(graph);
    const result = simulate(graph, {
      ticks: Math.max(1, Math.min(opts.ticks, 256)),
      inputs: opts.inputs,
    });
    return {
      status: "success",
      graph,
      laidOut,
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
