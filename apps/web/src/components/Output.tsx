import { useMemo } from "react";
import type { CompileOutcome } from "../lib/compile.js";
import type { ViewMode } from "../lib/share.js";
import { ImportPanel } from "./ImportPanel.js";
import { SimulatePanel } from "./SimulatePanel.js";

export interface OutputProps {
  outcome: CompileOutcome;
  viewMode: ViewMode;
  source: string;
  simRunToken: number;
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function compileBody(outcome: CompileOutcome, viewMode: ViewMode): string {
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
}

/** Renders compile result views, Simulate, or foreign blueprint Import. */
export function Output({ outcome, viewMode, source, simRunToken }: OutputProps) {
  const body = useMemo(() => compileBody(outcome, viewMode), [outcome, viewMode]);

  if (viewMode === "simulate") {
    return <SimulatePanel source={source} runToken={simRunToken} />;
  }

  if (viewMode === "import") {
    return <ImportPanel />;
  }

  return (
    <div className={`output-pane${outcome.status === "error" ? " output-pane-error" : ""}`}>
      <pre>{body}</pre>
    </div>
  );
}
