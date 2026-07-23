import { useEffect, useMemo, useState } from "react";
import { probeSimInputs, runSimulate, type SimOutcome } from "../lib/simulate.js";
import { CircuitCanvas } from "./CircuitCanvas.js";

export interface SimulatePanelProps {
  source: string;
  /** Bumps when the user clicks Simulate so we re-run even if source is unchanged. */
  runToken: number;
}

const DEFAULT_TICKS = 12;

function tickRowKey(tickIndex: number, outputs: Record<string, number>): string {
  return `${tickIndex}:${JSON.stringify(outputs)}`;
}

/** Sensible demo defaults so while_count / adder aren't stuck at all-zeros. */
function defaultInputValue(signal: string): number {
  const name = signal.toLowerCase();
  if (name === "signal-l" || name.includes("lim") || name.endsWith("-l")) {
    return 5;
  }
  if (name.endsWith("-a") || name === "signal-a") {
    return 3;
  }
  if (name.endsWith("-b") || name === "signal-b") {
    return 7;
  }
  return 0;
}

/** Input editors, tick control, circuit canvas, and per-tick output table. */
export function SimulatePanel({ source, runToken }: SimulatePanelProps) {
  const [ticks, setTicks] = useState(DEFAULT_TICKS);
  const [inputValues, setInputValues] = useState<Record<string, number>>({});
  const [outcome, setOutcome] = useState<SimOutcome>({ status: "idle" });

  const discoveredInputs = useMemo(() => {
    const probed = probeSimInputs(source);
    return probed.status === "ok" ? probed.signals : [];
  }, [source]);

  // Reset inputs whenever the program's input set changes (new example / edit).
  useEffect(() => {
    const next: Record<string, number> = {};
    for (const signal of discoveredInputs) {
      next[signal] = defaultInputValue(signal);
    }
    setInputValues(next);
  }, [discoveredInputs, source]);

  useEffect(() => {
    void runToken;
    const inputs: Record<string, number> = {};
    for (const signal of discoveredInputs) {
      inputs[signal] = inputValues[signal] ?? defaultInputValue(signal);
    }
    setOutcome(runSimulate(source, { ticks, inputs }));
  }, [source, ticks, inputValues, discoveredInputs, runToken]);

  if (outcome.status === "idle") {
    return (
      <div className="sim-panel">
        <p className="sim-muted">Running simulation…</p>
      </div>
    );
  }

  if (outcome.status === "error") {
    const location =
      outcome.line !== undefined && outcome.column !== undefined
        ? ` (line ${outcome.line}, column ${outcome.column})`
        : "";
    return (
      <div className="sim-panel">
        <div className="output-pane output-pane-error">
          <pre>
            {outcome.message}
            {location}
          </pre>
        </div>
      </div>
    );
  }

  const outputKeys =
    outcome.outputSignals.length > 0
      ? outcome.outputSignals
      : Object.keys(outcome.result.ticks[0]?.outputs ?? {});

  const lastTick = outcome.result.ticks[outcome.result.ticks.length - 1];
  const allOutputsZero =
    lastTick !== undefined && outputKeys.every((key) => (lastTick.outputs[key] ?? 0) === 0);
  const allInputsZero =
    discoveredInputs.length > 0 &&
    discoveredInputs.every((signal) => (inputValues[signal] ?? 0) === 0);

  return (
    <div className="sim-panel">
      <div className="sim-controls">
        <label className="sim-field">
          <span>Ticks</span>
          <input
            type="number"
            min={1}
            max={256}
            value={ticks}
            onChange={(event) => setTicks(Number(event.target.value) || 1)}
          />
        </label>
        {discoveredInputs.map((signal) => (
          <label key={signal} className="sim-field">
            <span>{signal}</span>
            <input
              type="number"
              value={inputValues[signal] ?? 0}
              onChange={(event) =>
                setInputValues((prev) => ({
                  ...prev,
                  [signal]: Number(event.target.value) || 0,
                }))
              }
            />
          </label>
        ))}
      </div>

      {allInputsZero && allOutputsZero ? (
        <p className="sim-hint">
          Outputs are all 0 because every input is 0. For <code>while_count</code>, set{" "}
          <strong>signal-L</strong> to something like <strong>5</strong> (loop upper bound). For{" "}
          <code>adder</code>, try A=3 and B=7. Free-running <code>counter</code> needs no inputs.
        </p>
      ) : null}

      {lastTick !== undefined ? (
        <p className="sim-muted">
          After {outcome.result.ticks.length} tick
          {outcome.result.ticks.length === 1 ? "" : "s"}:{" "}
          {outputKeys.map((key) => `${key}=${lastTick.outputs[key] ?? 0}`).join(", ") ||
            "(no outputs)"}
        </p>
      ) : null}

      <CircuitCanvas laidOut={outcome.laidOut} />

      <div className="sim-table-wrap">
        <table className="sim-table">
          <thead>
            <tr>
              <th>Tick</th>
              {outputKeys.map((key) => (
                <th key={key}>{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {outcome.result.ticks.map((tick, tickIndex) => (
              <tr key={tickRowKey(tickIndex, tick.outputs)}>
                <td>{tickIndex + 1}</td>
                {outputKeys.map((key) => (
                  <td key={key}>{tick.outputs[key] ?? 0}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="sim-icon-disclaimer">
        Combinator icons © Wube Software — vendored for this non-commercial fan playground only; not
        for redistribution. See <code>factorio-icons/NOTICE</code>.
      </p>
    </div>
  );
}
