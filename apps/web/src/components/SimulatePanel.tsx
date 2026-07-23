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

/** Input editors, tick control, circuit canvas, and per-tick output table. */
export function SimulatePanel({ source, runToken }: SimulatePanelProps) {
  const [ticks, setTicks] = useState(DEFAULT_TICKS);
  const [inputValues, setInputValues] = useState<Record<string, number>>({});
  const [outcome, setOutcome] = useState<SimOutcome>({ status: "idle" });

  const discoveredInputs = useMemo(() => {
    const probed = probeSimInputs(source);
    return probed.status === "ok" ? probed.signals : [];
  }, [source]);

  useEffect(() => {
    setInputValues((prev) => {
      const next = { ...prev };
      for (const signal of discoveredInputs) {
        if (next[signal] === undefined) {
          next[signal] = 0;
        }
      }
      return next;
    });
  }, [discoveredInputs]);

  useEffect(() => {
    void runToken;
    const inputs: Record<string, number> = {};
    for (const signal of discoveredInputs) {
      inputs[signal] = inputValues[signal] ?? 0;
    }
    setOutcome(runSimulate(source, { ticks, inputs }));
  }, [source, ticks, inputValues, discoveredInputs, runToken]);

  if (outcome.status === "idle") {
    return <p className="sim-muted">Running simulation…</p>;
  }

  if (outcome.status === "error") {
    const location =
      outcome.line !== undefined && outcome.column !== undefined
        ? ` (line ${outcome.line}, column ${outcome.column})`
        : "";
    return (
      <div className="output-pane output-pane-error">
        <pre>
          {outcome.message}
          {location}
        </pre>
      </div>
    );
  }

  const outputKeys =
    outcome.outputSignals.length > 0
      ? outcome.outputSignals
      : Object.keys(outcome.result.ticks[0]?.outputs ?? {});

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
