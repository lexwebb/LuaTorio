import { useEffect, useMemo, useState } from "react";
import {
  type ImportPort,
  type ImportRunOutcome,
  importFixtures,
  runImportSimulate,
} from "../lib/import-sim.js";

const DEFAULT_TICKS = 12;

type OutputRow = ImportPort & { id: string };

let portRowSeq = 0;
function nextPortRowId(): string {
  portRowSeq += 1;
  return `import-port-${portRowSeq}`;
}

function toRows(ports: ImportPort[]): OutputRow[] {
  return ports.map((port) => ({ ...port, id: nextPortRowId() }));
}

function tickRowKey(tickIndex: number, outputs: Record<string, number>): string {
  return `${tickIndex}:${JSON.stringify(outputs)}`;
}

/** Paste / fixture → importBlueprint → simulateImported (combinators only). */
export function ImportPanel() {
  const defaultFixture = importFixtures.find((f) => f.id === "static-mul") ?? importFixtures[0];
  const [blueprintText, setBlueprintText] = useState(defaultFixture?.planJson ?? "");
  const [fixtureId, setFixtureId] = useState(defaultFixture?.id ?? "");
  const [ticks, setTicks] = useState(DEFAULT_TICKS);
  const [outputs, setOutputs] = useState<OutputRow[]>(() => toRows(defaultFixture?.outputs ?? []));
  const [inputValues, setInputValues] = useState<Record<string, number>>(
    defaultFixture?.inputs ?? {},
  );
  const [outcome, setOutcome] = useState<ImportRunOutcome>({ status: "idle" });
  const [runToken, setRunToken] = useState(0);

  const inputSignals = useMemo(() => Object.keys(inputValues).sort(), [inputValues]);

  useEffect(() => {
    const fixture = importFixtures.find((f) => f.id === fixtureId);
    if (fixture === undefined) {
      return;
    }
    setBlueprintText(fixture.planJson);
    setOutputs(toRows(fixture.outputs));
    setInputValues({ ...fixture.inputs });
  }, [fixtureId]);

  useEffect(() => {
    void runToken;
    setOutcome(
      runImportSimulate({
        blueprintText,
        ticks,
        inputs: inputValues,
        outputs,
      }),
    );
  }, [blueprintText, ticks, inputValues, outputs, runToken]);

  const outputKeys =
    outcome.status === "success"
      ? outcome.circuit.outputs.length > 0
        ? outcome.circuit.outputs.map((port) => port.signal)
        : Object.keys(outcome.result.ticks[0]?.outputs ?? {})
      : [];

  return (
    <div className="import-panel">
      <p className="sim-muted">
        Paste a Factorio blueprint string or JSON plan. Only constant / arithmetic / decider /
        selector (count|select) combinators are supported — chests, assemblers, and other machines
        are rejected.
      </p>

      <div className="sim-controls">
        <label className="sim-field sim-field-inline">
          <span>Fixture</span>
          <select value={fixtureId} onChange={(event) => setFixtureId(event.target.value)}>
            {importFixtures.map((fixture) => (
              <option key={fixture.id} value={fixture.id}>
                {fixture.label}
              </option>
            ))}
          </select>
        </label>
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
        <button
          type="button"
          className="toolbar-button toolbar-button-primary"
          onClick={() => setRunToken((token) => token + 1)}
        >
          Run import
        </button>
      </div>

      <label className="import-paste">
        <span className="sim-muted">Blueprint string or JSON</span>
        <textarea
          value={blueprintText}
          onChange={(event) => setBlueprintText(event.target.value)}
          spellCheck={false}
          rows={10}
        />
      </label>

      <div className="import-ports">
        <div className="sim-entity-bag-title">Output ports (signal → entity number)</div>
        {outputs.map((port) => (
          <div key={port.id} className="sim-entity-bag-row">
            <input
              type="text"
              className="sim-entity-signal"
              value={port.signal}
              placeholder="signal-C"
              onChange={(event) => {
                const signal = event.target.value;
                setOutputs((prev) =>
                  prev.map((row) => (row.id === port.id ? { ...row, signal } : row)),
                );
              }}
            />
            <input
              type="text"
              className="sim-entity-signal"
              value={port.entityId}
              placeholder="3"
              onChange={(event) => {
                const entityId = event.target.value;
                setOutputs((prev) =>
                  prev.map((row) => (row.id === port.id ? { ...row, entityId } : row)),
                );
              }}
            />
          </div>
        ))}
        <button
          type="button"
          className="toolbar-button"
          onClick={() =>
            setOutputs((prev) => [...prev, { id: nextPortRowId(), signal: "", entityId: "" }])
          }
        >
          + output port
        </button>
      </div>

      {inputSignals.length > 0 ? (
        <div className="sim-controls">
          {inputSignals.map((signal) => (
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
      ) : null}

      {outcome.status === "idle" ? <p className="sim-muted">Import idle…</p> : null}

      {outcome.status === "error" ? (
        <div className="output-pane output-pane-error">
          <pre>{outcome.message}</pre>
        </div>
      ) : null}

      {outcome.status === "success" ? (
        <>
          <p className="sim-muted">
            Imported {outcome.circuit.entities.length} entities, {outcome.circuit.nets.length} nets.
            {outputKeys.length === 0
              ? " Add an output port (signal + entity number) to sample the trace."
              : ""}
          </p>
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
        </>
      ) : null}
    </div>
  );
}
