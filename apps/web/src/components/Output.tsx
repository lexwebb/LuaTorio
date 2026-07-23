import { useMemo } from "react";
import type { CompileOutcome } from "../lib/compile.js";
import type { ViewMode } from "../lib/share.js";

export interface OutputProps {
  outcome: CompileOutcome;
  viewMode: ViewMode;
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Renders the compile result (blueprint string / JSON / stats) or a ParseError/SemanticError. */
export function Output({ outcome, viewMode }: OutputProps) {
  const body = useMemo(() => {
    if (outcome.status === "idle") {
      return "Click Compile to see the result here.";
    }
    if (outcome.status === "error") {
      const location =
        outcome.line !== undefined && outcome.column !== undefined
          ? ` (line ${outcome.line}, column ${outcome.column})`
          : "";
      return `${outcome.message}${location}`;
    }
    switch (viewMode) {
      case "blueprint":
        return outcome.blueprint;
      case "json":
        return prettyJson(outcome.json);
      case "stats":
        return JSON.stringify(outcome.stats, null, 2);
      default:
        return "";
    }
  }, [outcome, viewMode]);

  return (
    <div className={`output-pane${outcome.status === "error" ? " output-pane-error" : ""}`}>
      <pre>{body}</pre>
    </div>
  );
}
