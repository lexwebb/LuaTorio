import {
  BlueprintImportError,
  type ImportedCircuit,
  importBlueprint,
  type SimulateResult,
  simulateImported,
} from "@luatorio/core";

export interface ImportPort {
  signal: string;
  entityId: string;
}

export interface ImportFixture {
  id: string;
  label: string;
  /** Decoded blueprint JSON plan text. */
  planJson: string;
  /** Suggested output ports for the fixture. */
  outputs: ImportPort[];
  /** Suggested input injections (signal → count). */
  inputs: Record<string, number>;
}

const fixtureModules = import.meta.glob("../../../../packages/core/src/sim/fixtures/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const FIXTURE_META: Record<
  string,
  { label: string; outputs: ImportPort[]; inputs: Record<string, number> }
> = {
  "static-mul": {
    label: "Static mul (6×7 → C)",
    outputs: [{ signal: "signal-C", entityId: "3" }],
    inputs: {},
  },
  "free-counter": {
    label: "Free-running counter",
    outputs: [{ signal: "signal-A", entityId: "2" }],
    inputs: {},
  },
  "cookbook-8-clock": {
    label: "Cookbook clock",
    outputs: [{ signal: "signal-A", entityId: "2" }],
    inputs: {},
  },
  "cookbook-1-math": {
    label: "Cookbook 1 math (EACH÷EACH)",
    outputs: [],
    inputs: {},
  },
  "cookbook-3-filter-include": {
    label: "Cookbook 3 filter include",
    outputs: [],
    inputs: {},
  },
};

export const importFixtures: ImportFixture[] = Object.entries(fixtureModules)
  .map(([path, plan]) => {
    const fileName = path.split("/").pop() ?? path;
    const id = fileName.replace(/\.json$/, "");
    const meta = FIXTURE_META[id] ?? { label: id, outputs: [], inputs: {} };
    return {
      id,
      label: meta.label,
      planJson: JSON.stringify(plan, null, 2),
      outputs: meta.outputs,
      inputs: meta.inputs,
    };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

export type ImportRunOutcome =
  | { status: "idle" }
  | {
      status: "success";
      circuit: ImportedCircuit;
      result: SimulateResult;
    }
  | { status: "error"; message: string };

export interface RunImportOptions {
  blueprintText: string;
  ticks: number;
  inputs: Record<string, number>;
  outputs: ImportPort[];
  /** Optional input ports for inject (empty constant pads). */
  inputPorts?: ImportPort[];
}

/** Decode + import + simulate a pasted Factorio blueprint (combinators only). */
export function runImportSimulate(opts: RunImportOptions): ImportRunOutcome {
  try {
    const outputs = opts.outputs.filter(
      (port) => port.signal.trim().length > 0 && port.entityId.trim().length > 0,
    );
    const inputPorts = (opts.inputPorts ?? []).filter(
      (port) => port.signal.trim().length > 0 && port.entityId.trim().length > 0,
    );
    const circuit = importBlueprint(opts.blueprintText, {
      inputs: inputPorts,
      outputs,
    });
    const result = simulateImported(circuit, {
      ticks: Math.max(1, Math.min(opts.ticks, 256)),
      inputs: opts.inputs,
      entityOutputs: true,
    });
    return { status: "success", circuit, result };
  } catch (error) {
    if (error instanceof BlueprintImportError) {
      return { status: "error", message: error.message };
    }
    if (error instanceof SyntaxError) {
      return { status: "error", message: error.message };
    }
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
