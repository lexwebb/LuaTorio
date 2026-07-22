import type { Chunk } from "luaparse";
import luaparse from "luaparse";

export type { Chunk };

export class ParseError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = "ParseError";
    this.line = line;
    this.column = column;
  }
}

function isLuaparseSyntaxError(error: unknown): error is Error & { line: number; column: number } {
  return (
    error instanceof Error &&
    typeof (error as { line?: unknown }).line === "number" &&
    typeof (error as { column?: unknown }).column === "number"
  );
}

export function parse(source: string): Chunk {
  try {
    return luaparse.parse(source, {
      locations: true,
      luaVersion: "5.3",
      // luaparse's default "none" encoding mode discards StringLiteral.value (leaves it
      // null) and only keeps `raw`. Signal names (input()/output() string literals) are
      // read from `.value` during semantic analysis, so decode strings properly.
      encodingMode: "pseudo-latin1",
    });
  } catch (error) {
    if (isLuaparseSyntaxError(error)) {
      throw new ParseError(error.message, error.line, error.column);
    }
    throw error;
  }
}
