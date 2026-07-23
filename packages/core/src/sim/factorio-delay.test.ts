import { describe, expect, it } from "vitest";
import type { CircuitEntity, CircuitGraph, WireEdge } from "../combinators.js";
import { simulate } from "./simulate.js";

function signalRef(name: string) {
  return { type: "virtual" as const, name };
}

function green(from: string, to: string): WireEdge {
  return { from, to, color: "green" };
}

function arithAdd(
  id: string,
  first: string | number,
  second: string | number,
  output = id,
): CircuitEntity {
  const arithmetic_conditions: Record<string, unknown> = {
    operation: "+",
    output_signal: signalRef(output),
  };
  if (typeof first === "string") {
    arithmetic_conditions.first_signal = signalRef(first);
  } else {
    arithmetic_conditions.first_constant = first;
  }
  if (typeof second === "string") {
    arithmetic_conditions.second_signal = signalRef(second);
  } else {
    arithmetic_conditions.second_constant = second;
  }
  return {
    id,
    kind: "arithmetic",
    name: "arithmetic-combinator",
    outputSignal: output,
    control_behavior: { arithmetic_conditions },
  };
}

function constant(id: string, signal: string, count: number): CircuitEntity {
  return {
    id,
    kind: "constant",
    name: "constant-combinator",
    outputSignal: signal,
    control_behavior: {
      sections: {
        sections: [{ filters: [{ type: "virtual", name: signal, count }] }],
      },
    },
  };
}

function emptyOut(id: string, signal: string): CircuitEntity {
  return {
    id,
    kind: "constant",
    name: "constant-combinator",
    outputSignal: signal,
    control_behavior: { sections: { sections: [] } },
  };
}

describe("simulate Factorio delay (hand fixtures)", () => {
  it("factorio-parallel: arith→arith chain settles after depth API ticks", () => {
    const entities: CircuitEntity[] = [
      constant("c", "S", 1),
      arithAdd("a", "S", 0, "S"),
      arithAdd("b", "S", 0, "S"),
      emptyOut("o", "signal-A"),
    ];
    const graph: CircuitGraph = {
      entities,
      wires: [green("c", "a"), green("a", "b"), green("b", "o")],
      inputs: [],
      outputs: [{ signal: "signal-A", entityId: "o" }],
    };

    const parallel = simulate(graph, { ticks: 3, mode: "factorio-parallel" });
    expect(parallel.ticks.map((t) => t.outputs["signal-A"])).toEqual([0, 1, 1]);

    // Default factorio settles the combo cone inside one API tick (no latches).
    const settled = simulate(graph, { ticks: 2, mode: "factorio" });
    expect(settled.ticks.map((t) => t.outputs["signal-A"])).toEqual([1, 1]);
  });

  it("self-feedback +1 latch increments once per Factorio API tick", () => {
    const latch: CircuitEntity = {
      id: "q",
      kind: "arithmetic",
      name: "arithmetic-combinator",
      outputSignal: "q",
      role: "latch",
      control_behavior: {
        arithmetic_conditions: {
          first_signal: signalRef("q"),
          second_constant: 1,
          operation: "+",
          output_signal: signalRef("q"),
        },
      },
    };
    const graph: CircuitGraph = {
      entities: [latch, emptyOut("o", "signal-A")],
      wires: [green("q", "q"), green("q", "o")],
      inputs: [],
      outputs: [{ signal: "signal-A", entityId: "o" }],
    };

    const result = simulate(graph, { ticks: 4, mode: "factorio" });
    expect(result.ticks.map((t) => t.outputs["signal-A"])).toEqual([1, 2, 3, 4]);
  });

  it("else_outputs mux settles within one factorio API tick (combo cone)", () => {
    const mux: CircuitEntity = {
      id: "mux",
      kind: "decider",
      name: "decider-combinator",
      outputSignal: "T",
      control_behavior: {
        decider_conditions: {
          conditions: [{ first_signal: signalRef("C"), comparator: "!=", constant: 0 }],
          outputs: [{ signal: signalRef("T"), copy_count_from_input: true }],
          else_outputs: [{ signal: signalRef("E"), copy_count_from_input: true }],
        },
      },
    };
    const graph: CircuitGraph = {
      entities: [
        constant("cond", "C", 1),
        constant("then", "T", 10),
        constant("else", "E", 20),
        mux,
        emptyOut("o", "signal-A"),
      ],
      wires: [green("cond", "mux"), green("then", "mux"), green("else", "mux"), green("mux", "o")],
      inputs: [],
      outputs: [{ signal: "signal-A", entityId: "o" }],
    };

    const on = simulate(graph, { ticks: 2, mode: "factorio" });
    expect(on.ticks.map((t) => t.outputs["signal-A"])).toEqual([10, 10]);

    const offGraph: CircuitGraph = {
      ...graph,
      entities: [
        constant("cond", "C", 0),
        constant("then", "T", 10),
        constant("else", "E", 20),
        mux,
        emptyOut("o", "signal-A"),
      ],
    };
    const off = simulate(offGraph, { ticks: 1, mode: "factorio" });
    expect(off.ticks[0]?.outputs["signal-A"]).toBe(20);
  });

  it("latch-sync still settles combo in one step", () => {
    const graph: CircuitGraph = {
      entities: [
        constant("c", "S", 1),
        arithAdd("a", "S", 0, "S"),
        arithAdd("b", "S", 0, "S"),
        emptyOut("o", "signal-A"),
      ],
      wires: [green("c", "a"), green("a", "b"), green("b", "o")],
      inputs: [],
      outputs: [{ signal: "signal-A", entityId: "o" }],
    };
    const latchSync = simulate(graph, { ticks: 2, mode: "latch-sync" });
    expect(latchSync.ticks.map((t) => t.outputs["signal-A"])).toEqual([1, 1]);
  });
});
