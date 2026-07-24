import type { Diagnostic } from "@codemirror/lint";
import { Text } from "@codemirror/state";
import { analyze, parse, ParseError, SemanticError } from "@luatorio/core";

/**
 * Map LuaTorio parse/analyze failures to CodeMirror lint diagnostics.
 * Fail-fast: at most one diagnostic (first error), matching the compiler.
 */
export function diagnose(source: string): Diagnostic[] {
  if (source.trim().length === 0) {
    return [];
  }

  try {
    analyze(parse(source));
    return [];
  } catch (error) {
    if (error instanceof ParseError || error instanceof SemanticError) {
      return [errorToDiagnostic(source, error.message, error.line, error.column)];
    }
    return [
      {
        from: 0,
        to: Math.max(1, Math.min(source.length, 1)),
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

function errorToDiagnostic(
  source: string,
  message: string,
  line: number,
  column: number,
): Diagnostic {
  const doc = Text.of(source.split(/\n/u));
  if (doc.length === 0) {
    return { from: 0, to: 0, severity: "error", message };
  }
  const lineNumber = Number.isFinite(line) && line >= 1 ? Math.min(line, doc.lines) : 1;
  const lineInfo = doc.line(lineNumber);
  // luaparse locations: line is 1-based; column is 0-based.
  const col = Number.isFinite(column) && column >= 0 ? column : 0;
  let from = Math.min(lineInfo.from + col, lineInfo.to);
  let to = from;
  while (to < lineInfo.to && !/\s/.test(source.charAt(to))) {
    to += 1;
  }
  if (to <= from) {
    // Prefer extending forward on the line; otherwise step one char back.
    if (from < lineInfo.to) {
      to = from + 1;
    } else if (from > 0) {
      from -= 1;
      to = from + 1;
    } else {
      to = Math.min(1, doc.length);
    }
  }
  return { from, to, severity: "error", message };
}
