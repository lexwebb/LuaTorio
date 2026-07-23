import { ParseError, SemanticError, compile } from "@luatorio/core";

export interface CompileIdle {
  status: "idle";
}

export interface CompileSuccess {
  status: "success";
  /** Deflate+base64 encoded blueprint string (what you paste into Factorio). */
  blueprint: string;
  /** Pretty-printable JSON serialization of the same blueprint plan. */
  json: string;
  stats: { combinators: number; wires: number };
}

export interface CompileFailure {
  status: "error";
  message: string;
  line: number | undefined;
  column: number | undefined;
}

export type CompileOutcome = CompileIdle | CompileSuccess | CompileFailure;

/**
 * Compiles `source` via `@luatorio/core` twice (once plain, once with `json: true`) so every
 * output view mode (blueprint string / JSON / stats) has data ready without recompiling when
 * the user just toggles the view — only an explicit Compile click re-runs this.
 */
export function runCompile(source: string): CompileOutcome {
  try {
    const plain = compile(source, { json: false });
    const asJson = compile(source, { json: true });
    return { status: "success", blueprint: plain.blueprint, json: asJson.blueprint, stats: plain.stats };
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
