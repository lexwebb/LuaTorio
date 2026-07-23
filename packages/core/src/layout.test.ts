import { describe, expect, it } from "vitest";
import type { CircuitEntity, CircuitGraph } from "./combinators.js";
import { layout } from "./layout.js";

function entity(id: string, kind: CircuitEntity["kind"] = "arithmetic"): CircuitEntity {
  return { id, kind, name: `${kind}-combinator`, outputSignal: id, control_behavior: {} };
}

describe("layout", () => {
  it("lays out a 2-entity graph: input feeding an output marker", () => {
    const graph: CircuitGraph = {
      entities: [entity("in", "constant"), entity("__o1", "constant")],
      wires: [{ from: "in", to: "__o1", color: "green" }],
      outputs: [{ signal: "signal-A", entityId: "__o1" }],
      inputs: [{ signal: "signal-A", entityId: "in" }],
    };

    const laid = layout(graph);

    expect(laid.entities.map((e) => e.entity_number)).toEqual([1, 2]);
    expect(laid.entities.map((e) => e.position)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(laid.wires).toEqual([[1, 2, 2, 2]]);
    expect(laid.outputs).toBe(graph.outputs);
    expect(laid.inputs).toBe(graph.inputs);
  });

  it("orders two inputs before their downstream sum (3 entities)", () => {
    const graph: CircuitGraph = {
      entities: [entity("a", "constant"), entity("b", "constant"), entity("sum", "arithmetic")],
      wires: [
        { from: "a", to: "sum", color: "green" },
        { from: "b", to: "sum", color: "green" },
      ],
      outputs: [],
      inputs: [
        { signal: "signal-A", entityId: "a" },
        { signal: "signal-B", entityId: "b" },
      ],
    };

    const laid = layout(graph);

    expect(laid.entities.map((e) => e.id)).toEqual(["a", "b", "sum"]);
    expect(laid.entities.map((e) => e.position.x)).toEqual([0, 2, 4]);
    expect(laid.wires).toEqual([
      [1, 2, 3, 2],
      [2, 2, 3, 2],
    ]);
  });

  it("uses the output connector (4) only on a two-sided combinator's producing side (4 entities)", () => {
    const graph: CircuitGraph = {
      entities: [entity("a", "constant"), entity("mid", "decider"), entity("__o1", "constant")],
      wires: [
        { from: "a", to: "mid", color: "green" },
        { from: "mid", to: "__o1", color: "green" },
      ],
      outputs: [{ signal: "signal-B", entityId: "__o1" }],
      inputs: [{ signal: "signal-A", entityId: "a" }],
    };

    const laid = layout(graph);

    expect(laid.wires).toEqual([
      [1, 2, 2, 2], // constant -> decider input side
      [2, 4, 3, 2], // decider output side -> constant
    ]);
  });

  it("lays out a 5-entity graph with fan-in, preserving wire count and increasing x", () => {
    const graph: CircuitGraph = {
      entities: [
        entity("a", "constant"),
        entity("b", "constant"),
        entity("c", "constant"),
        entity("sum", "arithmetic"),
        entity("__o1", "constant"),
      ],
      wires: [
        { from: "a", to: "sum", color: "green" },
        { from: "b", to: "sum", color: "green" },
        { from: "c", to: "sum", color: "green" },
        { from: "sum", to: "__o1", color: "green" },
      ],
      outputs: [{ signal: "signal-D", entityId: "__o1" }],
      inputs: [
        { signal: "signal-A", entityId: "a" },
        { signal: "signal-B", entityId: "b" },
        { signal: "signal-C", entityId: "c" },
      ],
    };

    const laid = layout(graph);

    expect(laid.entities.map((e) => e.entity_number)).toEqual([1, 2, 3, 4, 5]);
    expect(laid.wires).toHaveLength(graph.wires.length);
    const xs = laid.entities.map((e) => e.position.x);
    expect(xs).toEqual([0, 2, 4, 6, 8]);
  });

  it("throws on a non-latch cyclic graph", () => {
    const graph: CircuitGraph = {
      entities: [entity("a"), entity("b")],
      wires: [
        { from: "a", to: "b", color: "green" },
        { from: "b", to: "a", color: "green" },
      ],
      outputs: [],
      inputs: [],
    };

    expect(() => layout(graph)).toThrow(/cycle/);
  });

  it("lays out a latch feedback cycle by breaking at the latch entity", () => {
    const latch: CircuitEntity = {
      id: "mem",
      kind: "arithmetic",
      name: "arithmetic-combinator",
      outputSignal: "mem",
      control_behavior: {},
      role: "latch",
    };
    const graph: CircuitGraph = {
      entities: [latch, entity("next", "arithmetic"), entity("__o1", "constant")],
      wires: [
        { from: "mem", to: "next", color: "green" },
        { from: "next", to: "mem", color: "green" },
        { from: "mem", to: "__o1", color: "green" },
      ],
      outputs: [{ signal: "signal-A", entityId: "__o1" }],
      inputs: [],
    };

    const laid = layout(graph);

    expect(laid.entities.map((e) => e.id)).toEqual(["mem", "next", "__o1"]);
    expect(laid.wires).toHaveLength(3);
  });

  it("lays out a real lowered program end to end", async () => {
    const { analyze } = await import("./analyze.js");
    const { lowerToCombinators } = await import("./combinators.js");
    const { lower } = await import("./lower.js");
    const { optimize } = await import("./optimize.js");
    const { parse } = await import("./parse.js");

    const module = optimize(
      lower(analyze(parse(`output("signal-C", input("signal-A") + input("signal-B"))`))),
    );
    const laid = layout(lowerToCombinators(module));

    expect(laid.entities.map((e) => e.entity_number)).toEqual(laid.entities.map((_, i) => i + 1));
    const xs = laid.entities.map((e) => e.position.x);
    expect(xs).toEqual(xs.map((_, i) => i * 2));
    expect(laid.wires).toHaveLength(lowerToCombinators(module).wires.length);
  });
});
