import { useEffect, useMemo, useState } from "react";
import { probeSim, runSimulate, type SimEntityRead, type SimOutcome } from "../lib/simulate.js";
import { CircuitCanvas } from "./CircuitCanvas.js";

export interface SimulatePanelProps {
  source: string;
  /** Bumps when the user clicks Simulate so we re-run even if source is unchanged. */
  runToken: number;
}

const DEFAULT_TICKS = 12;

const SPEEDS_MS = [
  { id: "slow", label: "0.5×", ms: 800 },
  { id: "norm", label: "1×", ms: 400 },
  { id: "fast", label: "2×", ms: 200 },
] as const;

/** placeId → list of editable signal rows for an `input_from` bag. */
type EntityBagRow = { id: string; signal: string; count: number };
type EntityBagRows = Record<string, EntityBagRow[]>;

let bagRowSeq = 0;
function nextBagRowId(): string {
  bagRowSeq += 1;
  return `bag-row-${bagRowSeq}`;
}

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

function defaultEntityBagRows(reads: SimEntityRead[]): EntityBagRows {
  const next: EntityBagRows = {};
  for (const read of reads) {
    next[read.placeId] = [{ id: nextBagRowId(), signal: "iron-plate", count: 42 }];
  }
  return next;
}

function rowsToEntityInputs(rows: EntityBagRows): Record<string, Record<string, number>> {
  const bags: Record<string, Record<string, number>> = {};
  for (const [placeId, entries] of Object.entries(rows)) {
    const bag: Record<string, number> = {};
    for (const entry of entries) {
      const signal = entry.signal.trim();
      if (signal.length === 0) {
        continue;
      }
      bag[signal] = (bag[signal] ?? 0) + entry.count;
    }
    bags[placeId] = bag;
  }
  return bags;
}

function patchBagRow(
  prev: EntityBagRows,
  placeId: string,
  rowId: string,
  patch: Partial<Pick<EntityBagRow, "signal" | "count">>,
): EntityBagRows {
  return {
    ...prev,
    [placeId]: (prev[placeId] ?? []).map((entry) =>
      entry.id === rowId ? { ...entry, ...patch } : entry,
    ),
  };
}

function bagsEqual(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? 0) !== (right[key] ?? 0)) {
      return false;
    }
  }
  return true;
}

/** Input editors, playback, layered canvas, inspector, and per-tick output table. */
export function SimulatePanel({ source, runToken }: SimulatePanelProps) {
  const [ticks, setTicks] = useState(DEFAULT_TICKS);
  const [inputValues, setInputValues] = useState<Record<string, number>>({});
  const [entityBagRows, setEntityBagRows] = useState<EntityBagRows>({});
  const [outcome, setOutcome] = useState<SimOutcome>({ status: "idle" });
  const [currentTick, setCurrentTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedId, setSpeedId] = useState<(typeof SPEEDS_MS)[number]["id"]>("norm");
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const { discoveredInputs, discoveredEntityReads } = useMemo(() => {
    const probed = probeSim(source);
    if (probed.status !== "ok") {
      return { discoveredInputs: [] as string[], discoveredEntityReads: [] as SimEntityRead[] };
    }
    return {
      discoveredInputs: probed.signals,
      discoveredEntityReads: probed.reads,
    };
  }, [source]);

  useEffect(() => {
    const next: Record<string, number> = {};
    for (const signal of discoveredInputs) {
      next[signal] = defaultInputValue(signal);
    }
    setInputValues(next);
    setEntityBagRows(defaultEntityBagRows(discoveredEntityReads));
  }, [discoveredInputs, discoveredEntityReads]);

  useEffect(() => {
    void runToken;
    const inputs: Record<string, number> = {};
    for (const signal of discoveredInputs) {
      inputs[signal] = inputValues[signal] ?? defaultInputValue(signal);
    }
    setPlaying(false);
    setCurrentTick(0);
    setOutcome(
      runSimulate(source, {
        ticks,
        inputs,
        entityInputs: rowsToEntityInputs(entityBagRows),
      }),
    );
  }, [source, ticks, inputValues, entityBagRows, discoveredInputs, runToken]);

  // Only drop selection when the program identity changes (not on tick/input tweaks).
  useEffect(() => {
    void source;
    void runToken;
    setSelectedId(undefined);
  }, [source, runToken]);

  const speedMs = SPEEDS_MS.find((s) => s.id === speedId)?.ms ?? 400;

  useEffect(() => {
    if (!playing || outcome.status !== "success") {
      return;
    }
    const max = outcome.result.ticks.length - 1;
    if (max < 0) {
      return;
    }
    const id = window.setInterval(() => {
      setCurrentTick((tick) => {
        if (tick >= max) {
          setPlaying(false);
          return tick;
        }
        return tick + 1;
      });
    }, speedMs);
    return () => window.clearInterval(id);
  }, [playing, speedMs, outcome]);

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

  const tickCount = outcome.result.ticks.length;
  const safeTick = Math.min(currentTick, Math.max(0, tickCount - 1));
  const viewTick = outcome.result.ticks[safeTick];
  const prevTick = safeTick > 0 ? outcome.result.ticks[safeTick - 1] : undefined;

  const activeIds = new Set<string>();
  if (viewTick?.entities !== undefined) {
    for (const [id, bag] of Object.entries(viewTick.entities)) {
      if (!bagsEqual(bag, prevTick?.entities?.[id])) {
        activeIds.add(id);
      }
    }
  }

  const entityBags = viewTick?.entities;

  const allOutputsZero =
    viewTick !== undefined && outputKeys.every((key) => (viewTick.outputs[key] ?? 0) === 0);
  const allInputsZero =
    discoveredInputs.length > 0 &&
    discoveredInputs.every((signal) => (inputValues[signal] ?? 0) === 0);
  const hasEntityReads = discoveredEntityReads.length > 0;

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

      {hasEntityReads ? (
        <div className="sim-entity-bags">
          <p className="sim-muted">
            Chest bags for <code>input_from</code> (injected each tick — not a logistics network
            sim):
          </p>
          {discoveredEntityReads.map((read) => {
            const rows = entityBagRows[read.placeId] ?? [];
            return (
              <div key={read.placeId} className="sim-entity-bag">
                <div className="sim-entity-bag-title">
                  {read.name} <span className="sim-muted">({read.placeId})</span>
                </div>
                {rows.map((row) => (
                  <div key={row.id} className="sim-entity-bag-row">
                    <input
                      type="text"
                      className="sim-entity-signal"
                      value={row.signal}
                      placeholder="iron-plate"
                      onChange={(event) => {
                        const signal = event.target.value;
                        setEntityBagRows((prev) =>
                          patchBagRow(prev, read.placeId, row.id, { signal }),
                        );
                      }}
                    />
                    <input
                      type="number"
                      value={row.count}
                      onChange={(event) => {
                        const count = Number(event.target.value) || 0;
                        setEntityBagRows((prev) =>
                          patchBagRow(prev, read.placeId, row.id, { count }),
                        );
                      }}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() =>
                    setEntityBagRows((prev) => ({
                      ...prev,
                      [read.placeId]: [
                        ...(prev[read.placeId] ?? []),
                        { id: nextBagRowId(), signal: "", count: 0 },
                      ],
                    }))
                  }
                >
                  + signal
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="sim-playback">
        <button
          type="button"
          className="toolbar-button"
          onClick={() => {
            setPlaying(false);
            setCurrentTick(0);
          }}
        >
          ⏮ Reset
        </button>
        <button
          type="button"
          className="toolbar-button"
          disabled={safeTick <= 0}
          onClick={() => {
            setPlaying(false);
            setCurrentTick((t) => Math.max(0, t - 1));
          }}
        >
          ◀ Step
        </button>
        <button
          type="button"
          className="toolbar-button toolbar-button-primary"
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          className="toolbar-button"
          disabled={safeTick >= tickCount - 1}
          onClick={() => {
            setPlaying(false);
            setCurrentTick((t) => Math.min(tickCount - 1, t + 1));
          }}
        >
          Step ▶
        </button>
        <label className="sim-field sim-field-inline">
          <span>Speed</span>
          <select
            value={speedId}
            onChange={(event) => setSpeedId(event.target.value as typeof speedId)}
          >
            {SPEEDS_MS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="sim-field sim-field-grow">
          <span>
            Tick {safeTick + 1} / {tickCount}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(0, tickCount - 1)}
            value={safeTick}
            onChange={(event) => {
              setPlaying(false);
              setCurrentTick(Number(event.target.value));
            }}
          />
        </label>
      </div>

      {allInputsZero && allOutputsZero && !hasEntityReads ? (
        <p className="sim-hint">
          Outputs are all 0 because every input is 0. For <code>while_count</code>, set{" "}
          <strong>signal-L</strong> to something like <strong>5</strong>.
        </p>
      ) : null}

      {viewTick !== undefined ? (
        <p className="sim-muted">
          Viewing tick {safeTick + 1}:{" "}
          {outputKeys.map((key) => `${key}=${viewTick.outputs[key] ?? 0}`).join(", ") ||
            "(no outputs)"}
        </p>
      ) : null}

      <CircuitCanvas
        laidOut={outcome.laidOut}
        places={outcome.places}
        selectedId={selectedId}
        onSelect={setSelectedId}
        entityBags={entityBags}
        activeIds={activeIds}
      />

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
              <tr
                key={tickRowKey(tickIndex, tick.outputs)}
                className={tickIndex === safeTick ? "is-current-tick" : undefined}
                onClick={() => {
                  setPlaying(false);
                  setCurrentTick(tickIndex);
                }}
              >
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
        for redistribution. See <code>factorio-icons/NOTICE</code>. Layout uses layered placement
        for the canvas (blueprint emit still uses a single row).
      </p>
    </div>
  );
}
