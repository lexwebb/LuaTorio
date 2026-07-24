import { analyze } from "./analyze.js";
import { lowerToCombinators } from "./combinators.js";
import { emitBlueprint } from "./emit.js";
import { layout } from "./layout.js";
import { lower } from "./lower.js";
import { optimize } from "./optimize.js";
import { parse } from "./parse.js";

export interface CompileOptions {
  name?: string;
  optimize?: boolean;
  json?: boolean;
}

export interface CompileResult {
  blueprint: string;
  stats: {
    combinators: number;
    places: number;
    wires: number;
  };
  warnings: string[];
}

/**
 * Compiles LuaTorio v1 source into a Factorio blueprint: `parse` -> `analyze` -> `lower` ->
 * `optimize` (unless `options.optimize === false`) -> `lowerToCombinators` -> `layout` ->
 * `emitBlueprint`. `ParseError`/`SemanticError` from the front end propagate to the caller
 * unchanged; there are no warnings in v1 (the field exists for forward compatibility).
 */
export function compile(source: string, options?: CompileOptions): CompileResult {
  const ast = parse(source);
  const program = analyze(ast);
  const module = lower(program);
  const optimized = options?.optimize === false ? module : optimize(module);
  const graph = lowerToCombinators(optimized);
  const laidOut = layout(graph);
  const { blueprint, stats } = emitBlueprint(laidOut, {
    ...(options?.name !== undefined ? { name: options.name } : {}),
    ...(options?.json !== undefined ? { json: options.json } : {}),
    ...(optimized.places !== undefined ? { places: optimized.places } : {}),
  });

  return { blueprint, stats, warnings: [] };
}

export type {
  AnalyzedExpr,
  AnalyzedPlace,
  AnalyzedProgram,
  AnalyzedStatement,
  PlaceableEntity,
} from "./analyze.js";
export { analyze, SemanticError } from "./analyze.js";
export type {
  CircuitEntity,
  CircuitGraph,
  CombinatorKind,
  WireColor,
  WireEdge,
} from "./combinators.js";
export { lowerToCombinators, redWire, signalLabelMap } from "./combinators.js";
export type { EmitOptions, EmitResult } from "./emit.js";
export { emitBlueprint } from "./emit.js";
export type { IRModule, IRNode, SpatialPlace } from "./ir.js";
export type { MemoryStoreMatch } from "./ir-match.js";
export {
  fusedCmpForSelect,
  isBooleanOrSelect,
  isBooleanValued,
  isStickyClearSelect,
  literalValueOf,
  matchAndOrMux,
  matchEnableHold,
  matchMemoryStore,
  memDeltaLiteral,
  memPlusDelta,
  soleUseCmp,
  useAtMost,
} from "./ir-match.js";
export type {
  FactorioWire,
  LaidOutCircuit,
  LayoutArrangement,
  LayoutOptions,
  PlacedEntity,
} from "./layout.js";
export { layout } from "./layout.js";
export { lower } from "./lower.js";
export { optimize } from "./optimize.js";
export type { Chunk } from "./parse.js";
export { ParseError, parse } from "./parse.js";
export type {
  CircuitNet,
  ConnectorSide,
  ImportedCircuit,
  NetEndpoint,
} from "./sim/import.js";
export {
  BlueprintImportError,
  fromBlueprint,
  fromCircuitGraph,
  importBlueprint,
  WIRE_CONNECTOR,
} from "./sim/import.js";
export type { ReferenceOptions, ReferenceResult } from "./sim/reference.js";
export { reference } from "./sim/reference.js";
export type {
  SimulateMode,
  SimulateOptions,
  SimulateResult,
  SimulateTick,
} from "./sim/simulate.js";
export { comboSettleDepth, simulate } from "./sim/simulate.js";
export { simulateImported } from "./sim/simulate-imported.js";
