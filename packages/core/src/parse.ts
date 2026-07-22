import luaparse from "luaparse";
import type { Chunk } from "luaparse";

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

function isLuaparseSyntaxError(
  error: unknown,
): error is Error & { line: number; column: number } {
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
    });
  } catch (error) {
    if (isLuaparseSyntaxError(error)) {
      throw new ParseError(error.message, error.line, error.column);
    }
    throw error;
  }
}
