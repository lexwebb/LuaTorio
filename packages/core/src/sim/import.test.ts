import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze } from "../analyze.js";
import { lowerToCombinators } from "../combinators.js";
import { lower } from "../lower.js";
import { optimize } from "../optimize.js";
import { parse } from "../parse.js";
import { BlueprintImportError, fromBlueprint, fromCircuitGraph } from "./import.js";
import { simulate } from "./simulate.js";
import { simulateImported } from "./simulate-imported.js";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(here, "../../../../examples");
const fixturesDir = join(here, "fixtures");

function loadExample(name: string): string {
  return readFileSync(join(examplesDir, name), "utf8");
}

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

function graphOf(source: string) {
  return lowerToCombinators(optimize(lower(analyze(parse(source)))));
}

describe("fromBlueprint", () => {
  it("rejects unsupported entities with a clear error", () => {
    const plan = {
      blueprint: {
        entities: [{ entity_number: 1, name: "logistic-chest-buffer", control_behavior: {} }],
        wires: [],
      },
    };
    expect(() => fromBlueprint(plan)).toThrow(BlueprintImportError);
    expect(() => fromBlueprint(plan)).toThrow(/logistic/);
  });

  it("imports a minimal selector count blueprint", () => {
    const plan = {
      blueprint: {
        entities: [
          {
            entity_number: 1,
            name: "constant-combinator",
            control_behavior: {
              sections: {
                sections: [
                  {
                    index: 1,
                    filters: [
                      { index: 1, count: 5, type: "virtual", name: "signal-A" },
                      { index: 2, count: 3, type: "virtual", name: "signal-B" },
                    ],
                  },
                ],
              },
            },
          },
          {
            entity_number: 2,
            name: "selector-combinator",
            control_behavior: {
              operation: "count",
              count_signal: { type: "virtual", name: "signal-N" },
            },
          },
          {
            entity_number: 3,
            name: "constant-combinator",
            control_behavior: { sections: { sections: [] } },
          },
        ],
        wires: [
          [1, 2, 2, 2],
          [2, 4, 3, 2],
        ],
      },
    };
    const circuit = fromBlueprint(plan, {
      outputs: [{ signal: "signal-N", entityId: "3" }],
    });
    expect(circuit.entities.find((e) => e.id === "2")?.kind).toBe("selector");
    expect(circuit.entities.find((e) => e.id === "2")?.outputSignal).toBe("signal-N");
    const result = simulateImported(circuit, { ticks: 2 });
    expect(result.ticks[0]?.outputs["signal-N"]).toBe(2);
  });

  it("rejects unsupported selector operations", () => {
    const plan = {
      blueprint: {
        entities: [
          {
            entity_number: 1,
            name: "selector-combinator",
            control_behavior: { operation: "random" },
          },
        ],
        wires: [],
      },
    };
    expect(() => fromBlueprint(plan)).toThrow(BlueprintImportError);
    expect(() => fromBlueprint(plan)).toThrow(/random/);
  });

  it("marks self-feedback arithmetic as a latch", () => {
    const circuit = fromBlueprint(loadFixture("free-counter.json"), {
      outputs: [{ signal: "signal-A", entityId: "2" }],
    });
    expect(circuit.entities.find((e) => e.id === "1")?.role).toBe("latch");
    expect(circuit.nets.length).toBeGreaterThanOrEqual(1);
  });
});

describe("simulateImported fixtures", () => {
  it("static-mul: 6 * 7 → signal-C === 42", () => {
    const circuit = fromBlueprint(loadFixture("static-mul.json"), {
      outputs: [{ signal: "signal-C", entityId: "3" }],
    });
    const result = simulateImported(circuit, { ticks: 2 });
    expect(result.ticks[0]?.outputs["signal-C"]).toBe(42);
    expect(result.ticks[1]?.outputs["signal-C"]).toBe(42);
  });

  it("free-counter: after t ticks signal-A === t", () => {
    const circuit = fromBlueprint(loadFixture("free-counter.json"), {
      outputs: [{ signal: "signal-A", entityId: "2" }],
    });
    const t = 8;
    const result = simulateImported(circuit, { ticks: t });
    for (let i = 0; i < t; i += 1) {
      expect(result.ticks[i]?.outputs["signal-A"], `tick ${i + 1}`).toBe(i + 1);
    }
  });
});

describe("fromCircuitGraph bridge", () => {
  it("matches directed simulate on adder", () => {
    const graph = graphOf(loadExample("adder.lua"));
    const directed = simulate(graph, {
      ticks: 3,
      inputs: { "signal-A": 3, "signal-B": 7 },
    });
    const imported = simulateImported(fromCircuitGraph(graph), {
      ticks: 3,
      inputs: { "signal-A": 3, "signal-B": 7 },
    });
    expect(imported.ticks.map((tick) => tick.outputs["signal-C"])).toEqual(
      directed.ticks.map((tick) => tick.outputs["signal-C"]),
    );
  });

  it("matches directed simulate on counter", () => {
    const graph = graphOf(loadExample("counter.lua"));
    const directed = simulate(graph, { ticks: 10 });
    const imported = simulateImported(fromCircuitGraph(graph), { ticks: 10 });
    expect(imported.ticks.map((tick) => tick.outputs["signal-A"])).toEqual(
      directed.ticks.map((tick) => tick.outputs["signal-A"]),
    );
  });
});
