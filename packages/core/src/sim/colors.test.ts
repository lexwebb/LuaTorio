import { describe, expect, it } from "vitest";
import { redWire } from "../combinators.js";
import { emitBlueprint } from "../emit.js";
import { layout } from "../layout.js";
import { evalArithmetic } from "./eval.js";
import { fromCircuitGraph } from "./import.js";
import { bagSet, emptyBag } from "./signals.js";
import { simulate } from "./simulate.js";
import { simulateImported } from "./simulate-imported.js";

function signalRef(name: string) {
  return { type: "virtual" as const, name };
}

describe("red/green wire split (#40)", () => {
  it("evalArithmetic respects first_signal_networks red-only vs green-only", () => {
    const entity = {
      id: "op",
      kind: "arithmetic" as const,
      name: "arithmetic-combinator",
      outputSignal: "signal-C",
      control_behavior: {
        arithmetic_conditions: {
          first_signal: signalRef("signal-A"),
          first_signal_networks: { red: true, green: false },
          second_signal: signalRef("signal-A"),
          second_signal_networks: { red: false, green: true },
          operation: "+",
          output_signal: signalRef("signal-C"),
        },
      },
    };
    const red = emptyBag();
    const green = emptyBag();
    bagSet(red, "signal-A", 3);
    bagSet(green, "signal-A", 7);
    // 3 (red) + 7 (green) = 10 — naive sum-both would be 10+10=20 or 3+7 with wrong selection
    expect(evalArithmetic(entity, { red, green }).get("signal-C")).toBe(10);

    // If both operands read both colors, each sees 10 → 20
    const both = {
      ...entity,
      control_behavior: {
        arithmetic_conditions: {
          ...entity.control_behavior.arithmetic_conditions,
          first_signal_networks: { red: true, green: true },
          second_signal_networks: { red: true, green: true },
        },
      },
    };
    expect(evalArithmetic(both, { red, green }).get("signal-C")).toBe(20);
  });

  it("directed simulate: red A + green A with per-operand select → 10, not 20", () => {
    const graph = {
      entities: [
        {
          id: "cred",
          kind: "constant" as const,
          name: "constant-combinator",
          outputSignal: "signal-A",
          control_behavior: {
            sections: {
              sections: [
                {
                  index: 1,
                  filters: [{ index: 1, count: 3, type: "virtual", name: "signal-A" }],
                },
              ],
            },
          },
        },
        {
          id: "cgreen",
          kind: "constant" as const,
          name: "constant-combinator",
          outputSignal: "signal-A",
          control_behavior: {
            sections: {
              sections: [
                {
                  index: 1,
                  filters: [{ index: 1, count: 7, type: "virtual", name: "signal-A" }],
                },
              ],
            },
          },
        },
        {
          id: "op",
          kind: "arithmetic" as const,
          name: "arithmetic-combinator",
          outputSignal: "signal-C",
          control_behavior: {
            arithmetic_conditions: {
              first_signal: signalRef("signal-A"),
              first_signal_networks: { red: true, green: false },
              second_signal: signalRef("signal-A"),
              second_signal_networks: { red: false, green: true },
              operation: "+",
              output_signal: signalRef("signal-C"),
            },
          },
        },
        {
          id: "out",
          kind: "constant" as const,
          name: "constant-combinator",
          outputSignal: "signal-C",
          control_behavior: { sections: { sections: [] } },
        },
      ],
      wires: [
        redWire("cred", "op"),
        { from: "cgreen", to: "op", color: "green" as const },
        { from: "op", to: "out", color: "green" as const },
      ],
      inputs: [],
      outputs: [{ signal: "signal-C", entityId: "out" }],
    };

    const directed = simulate(graph, { ticks: 2 });
    expect(directed.ticks[0]?.outputs["signal-C"]).toBe(10);
    expect(directed.ticks[1]?.outputs["signal-C"]).toBe(10);

    const imported = simulateImported(fromCircuitGraph(graph), { ticks: 2 });
    expect(imported.ticks.map((t) => t.outputs["signal-C"])).toEqual([10, 10]);
  });

  it("layout emits red connector ids for red WireEdges", () => {
    const graph = {
      entities: [
        {
          id: "a",
          kind: "constant" as const,
          name: "constant-combinator",
          outputSignal: "signal-A",
          control_behavior: {
            sections: {
              sections: [
                { index: 1, filters: [{ index: 1, count: 1, type: "virtual", name: "signal-A" }] },
              ],
            },
          },
        },
        {
          id: "b",
          kind: "arithmetic" as const,
          name: "arithmetic-combinator",
          outputSignal: "signal-B",
          control_behavior: {
            arithmetic_conditions: {
              first_signal: signalRef("signal-A"),
              second_constant: 0,
              operation: "+",
              output_signal: signalRef("signal-B"),
            },
          },
        },
      ],
      wires: [redWire("a", "b")],
      inputs: [],
      outputs: [],
    };
    const laid = layout(graph);
    // constant from → red in (1); arith to → red in (1)
    expect(laid.wires).toEqual([[1, 1, 2, 1]]);
    const { stats } = emitBlueprint(laid, { json: true });
    expect(stats.wires).toBe(1);
  });
});
