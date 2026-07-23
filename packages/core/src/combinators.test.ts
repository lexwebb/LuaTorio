import { describe, expect, it } from "vitest";
import { lowerToCombinators } from "./combinators.js";
import type { IRModule } from "./ir.js";

describe("lowerToCombinators", () => {
  it("lowers a literal node to a constant combinator carrying its value on the temp signal", () => {
    const module: IRModule = {
      nodes: [{ kind: "literal", id: "__t1", value: 5 }],
      outputs: [{ signal: "signal-A", nodeId: "__t1" }],
      inputs: [],
    };

    const graph = lowerToCombinators(module);

    expect(graph.entities[0]).toEqual({
      id: "__t1",
      kind: "constant",
      name: "constant-combinator",
      outputSignal: "__t1",
      control_behavior: {
        sections: {
          sections: [
            { index: 1, filters: [{ index: 1, count: 5, type: "virtual", name: "__t1" }] },
          ],
        },
      },
    });
  });

  it("lowers an input node to a constant-combinator placeholder using the real signal name", () => {
    const module: IRModule = {
      nodes: [{ kind: "input", id: "__t1", signal: "signal-A" }],
      outputs: [{ signal: "signal-B", nodeId: "__t1" }],
      inputs: [{ signal: "signal-A", nodeId: "__t1" }],
    };

    const graph = lowerToCombinators(module);

    expect(graph.entities[0]).toEqual({
      id: "__t1",
      kind: "constant",
      name: "constant-combinator",
      outputSignal: "signal-A",
      control_behavior: { sections: { sections: [] } },
    });
    expect(graph.inputs).toEqual([{ signal: "signal-A", entityId: "__t1" }]);
  });

  it("lowers a binop node to an arithmetic combinator with a matching operation", () => {
    const module: IRModule = {
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "input", id: "__t2", signal: "signal-B" },
        { kind: "binop", id: "__t3", op: "+", left: "__t1", right: "__t2" },
      ],
      outputs: [{ signal: "signal-C", nodeId: "__t3" }],
      inputs: [
        { signal: "signal-A", nodeId: "__t1" },
        { signal: "signal-B", nodeId: "__t2" },
      ],
    };

    const graph = lowerToCombinators(module);
    const sum = graph.entities.find((entity) => entity.id === "__t3");

    expect(sum).toEqual({
      id: "__t3",
      kind: "arithmetic",
      name: "arithmetic-combinator",
      outputSignal: "__t3",
      control_behavior: {
        arithmetic_conditions: {
          first_signal: { type: "virtual", name: "__t1" },
          second_signal: { type: "virtual", name: "__t2" },
          operation: "+",
          output_signal: { type: "virtual", name: "__t3" },
        },
      },
    });
  });

  it("lowers a cmp node to a decider combinator, mapping `==`/`~=` to `=`/`!=`", () => {
    const module: IRModule = {
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "literal", id: "__t2", value: 0 },
        { kind: "cmp", id: "__t3", op: "~=", left: "__t1", right: "__t2" },
      ],
      outputs: [{ signal: "signal-B", nodeId: "__t3" }],
      inputs: [{ signal: "signal-A", nodeId: "__t1" }],
    };

    const graph = lowerToCombinators(module);
    const decider = graph.entities.find((entity) => entity.id === "__t3");

    expect(decider).toEqual({
      id: "__t3",
      kind: "decider",
      name: "decider-combinator",
      outputSignal: "__t3",
      control_behavior: {
        decider_conditions: {
          conditions: [
            {
              first_signal: { type: "virtual", name: "__t1" },
              comparator: "!=",
              constant: 0,
            },
          ],
          outputs: [{ signal: { type: "virtual", name: "__t3" }, constant: 1 }],
        },
      },
    });
  });

  it("specializes select(c, x, 0) to gate + rename (2 entities)", () => {
    const module: IRModule = {
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "input", id: "__t2", signal: "signal-B" },
        { kind: "literal", id: "__t3", value: 0 },
        { kind: "select", id: "__t4", cond: "__t1", then: "__t2", else: "__t3" },
      ],
      outputs: [{ signal: "signal-C", nodeId: "__t4" }],
      inputs: [
        { signal: "signal-A", nodeId: "__t1" },
        { signal: "signal-B", nodeId: "__t2" },
      ],
    };

    const graph = lowerToCombinators(module);
    const gate = graph.entities.find((entity) => entity.id === "__t4__gate");
    const rename = graph.entities.find((entity) => entity.id === "__t4");

    expect(gate).toMatchObject({
      kind: "decider",
      role: "mux-side",
      outputSignal: "__t2",
      control_behavior: {
        decider_conditions: {
          conditions: [
            { first_signal: { type: "virtual", name: "__t1" }, comparator: "!=", constant: 0 },
          ],
        },
      },
    });
    expect(rename).toMatchObject({
      kind: "arithmetic",
      outputSignal: "__t4",
      control_behavior: {
        arithmetic_conditions: {
          first_signal: { type: "virtual", name: "__t2" },
          second_constant: 0,
          operation: "+",
          output_signal: { type: "virtual", name: "__t4" },
        },
      },
    });
    expect(graph.entities.some((entity) => entity.id === "__t4__else")).toBe(false);
    expect(graph.wires.filter((wire) => wire.to === "__t4__gate")).toEqual([
      { from: "__t1", to: "__t4__gate", color: "green" },
      { from: "__t2", to: "__t4__gate", color: "green" },
    ]);
  });

  it("specializes select(c, 1, 0) to one decider outputting constant 1", () => {
    const module: IRModule = {
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "literal", id: "__t2", value: 1 },
        { kind: "literal", id: "__t3", value: 0 },
        { kind: "select", id: "__t4", cond: "__t1", then: "__t2", else: "__t3" },
      ],
      outputs: [{ signal: "signal-B", nodeId: "__t4" }],
      inputs: [{ signal: "signal-A", nodeId: "__t1" }],
    };

    const graph = lowerToCombinators(module);
    const decider = graph.entities.find((entity) => entity.id === "__t4");

    expect(decider).toEqual({
      id: "__t4",
      kind: "decider",
      name: "decider-combinator",
      outputSignal: "__t4",
      control_behavior: {
        decider_conditions: {
          conditions: [
            { first_signal: { type: "virtual", name: "__t1" }, comparator: "!=", constant: 0 },
          ],
          outputs: [{ signal: { type: "virtual", name: "__t4" }, constant: 1 }],
        },
      },
    });
    expect(graph.entities.filter((entity) => entity.id.startsWith("__t4")).length).toBe(1);
  });

  it("specializes select(c, cmp, 0) to one AND-decider outputting constant 1", () => {
    const module: IRModule = {
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "literal", id: "__t2", value: 0 },
        { kind: "cmp", id: "__t3", op: ">", left: "__t1", right: "__t2" },
        { kind: "input", id: "__t4", signal: "signal-B" },
        { kind: "select", id: "__t5", cond: "__t4", then: "__t3", else: "__t2" },
      ],
      outputs: [{ signal: "signal-C", nodeId: "__t5" }],
      inputs: [
        { signal: "signal-A", nodeId: "__t1" },
        { signal: "signal-B", nodeId: "__t4" },
      ],
    };

    const graph = lowerToCombinators(module);
    const andDecider = graph.entities.find((entity) => entity.id === "__t5");

    expect(andDecider).toMatchObject({
      kind: "decider",
      outputSignal: "__t5",
      control_behavior: {
        decider_conditions: {
          conditions: [
            { first_signal: { type: "virtual", name: "__t4" }, comparator: "!=", constant: 0 },
            {
              first_signal: { type: "virtual", name: "__t3" },
              comparator: "!=",
              constant: 0,
              compare_type: "and",
            },
          ],
          outputs: [{ signal: { type: "virtual", name: "__t5" }, constant: 1 }],
        },
      },
    });
  });

  it("emits else_outputs mux + merge for select(c, x, y) with distinct non-zero branches", () => {
    const module: IRModule = {
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "input", id: "__t2", signal: "signal-B" },
        { kind: "input", id: "__t3", signal: "signal-C" },
        { kind: "select", id: "__t4", cond: "__t1", then: "__t2", else: "__t3" },
      ],
      outputs: [{ signal: "signal-D", nodeId: "__t4" }],
      inputs: [
        { signal: "signal-A", nodeId: "__t1" },
        { signal: "signal-B", nodeId: "__t2" },
        { signal: "signal-C", nodeId: "__t3" },
      ],
    };

    const graph = lowerToCombinators(module);
    expect(graph.entities.find((entity) => entity.id === "__t4__mux")).toMatchObject({
      kind: "decider",
      role: "mux-side",
      control_behavior: {
        decider_conditions: {
          else_outputs: [{ signal: { type: "virtual", name: "__t3" }, copy_count_from_input: true }],
        },
      },
    });
    expect(graph.entities.find((entity) => entity.id === "__t4")).toMatchObject({
      kind: "arithmetic",
      outputSignal: "__t4",
    });
    expect(graph.entities.find((entity) => entity.id === "__t4__then")).toBeUndefined();
    expect(graph.entities.find((entity) => entity.id === "__t4__else")).toBeUndefined();
  });

  it("lowers memory+store to a latch arithmetic with feedback from the store value", () => {
    const module: IRModule = {
      nodes: [
        { kind: "literal", id: "__t1", value: 0 },
        { kind: "memory", id: "__t2", cell: "x", init: "__t1" },
        { kind: "literal", id: "__t3", value: 1 },
        { kind: "binop", id: "__t4", op: "+", left: "__t2", right: "__t3" },
        { kind: "store", id: "__t5", cell: "x", value: "__t4" },
      ],
      outputs: [{ signal: "signal-A", nodeId: "__t2" }],
      inputs: [],
    };

    const graph = lowerToCombinators(module);
    const latch = graph.entities.find((entity) => entity.id === "__t2");

    expect(latch).toMatchObject({
      kind: "arithmetic",
      role: "latch",
      outputSignal: "__t2",
      control_behavior: {
        arithmetic_conditions: {
          first_signal: { type: "virtual", name: "__t4" },
          second_constant: 0,
          operation: "+",
          output_signal: { type: "virtual", name: "__t2" },
        },
      },
    });
    expect(graph.entities.some((entity) => entity.id === "__t5")).toBe(false);
    expect(graph.entities.some((entity) => entity.id === "__t1")).toBe(false); // zero init elided
    expect(graph.entities.some((entity) => entity.id === "__t3")).toBe(false); // +1 as constant
    expect(graph.wires).toEqual(
      expect.arrayContaining([
        { from: "__t4", to: "__t2", color: "green" },
        { from: "__t2", to: "__t4", color: "green" },
      ]),
    );
    expect(graph.entities.find((entity) => entity.id === "__t4")).toMatchObject({
      control_behavior: {
        arithmetic_conditions: {
          first_signal: { type: "virtual", name: "__t2" },
          second_constant: 1,
          operation: "+",
          output_signal: { type: "virtual", name: "__t4" },
        },
      },
    });
  });

  it("wires every IR edge from producer to consumer", () => {
    const module: IRModule = {
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "input", id: "__t2", signal: "signal-B" },
        { kind: "binop", id: "__t3", op: "+", left: "__t1", right: "__t2" },
        { kind: "binop", id: "__t4", op: "-", left: "__t3", right: "__t1" },
      ],
      outputs: [{ signal: "signal-C", nodeId: "__t4" }],
      inputs: [
        { signal: "signal-A", nodeId: "__t1" },
        { signal: "signal-B", nodeId: "__t2" },
      ],
    };

    const graph = lowerToCombinators(module);

    expect(graph.wires).toEqual([
      { from: "__t1", to: "__t3", color: "green" },
      { from: "__t2", to: "__t3", color: "green" },
      { from: "__t3", to: "__t4", color: "green" },
      { from: "__t1", to: "__t4", color: "green" },
      { from: "__t4", to: "__o1", color: "green" },
    ]);
  });

  it("creates one boundary output entity per module.outputs entry, wired from its producer", () => {
    const module: IRModule = {
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "input", id: "__t2", signal: "signal-B" },
        { kind: "binop", id: "__t3", op: "+", left: "__t1", right: "__t2" },
      ],
      outputs: [
        { signal: "signal-C", nodeId: "__t3" },
        { signal: "signal-D", nodeId: "__t3" },
      ],
      inputs: [
        { signal: "signal-A", nodeId: "__t1" },
        { signal: "signal-B", nodeId: "__t2" },
      ],
    };

    const graph = lowerToCombinators(module);
    const outputEntities = graph.entities.filter((entity) => entity.id.startsWith("__o"));

    expect(outputEntities).toEqual([
      {
        id: "__o1",
        kind: "constant",
        name: "constant-combinator",
        outputSignal: "signal-C",
        control_behavior: { sections: { sections: [] } },
      },
      {
        id: "__o2",
        kind: "constant",
        name: "constant-combinator",
        outputSignal: "signal-D",
        control_behavior: { sections: { sections: [] } },
      },
    ]);
    expect(graph.outputs).toEqual([
      { signal: "signal-C", entityId: "__o1" },
      { signal: "signal-D", entityId: "__o2" },
    ]);
    expect(graph.wires.filter((wire) => wire.to.startsWith("__o"))).toEqual([
      { from: "__t3", to: "__o1", color: "green" },
      { from: "__t3", to: "__o2", color: "green" },
    ]);
  });

  it("lowers a full clamp-style program end to end with a sensible entity/wire count", async () => {
    const { analyze } = await import("./analyze.js");
    const { lower } = await import("./lower.js");
    const { optimize } = await import("./optimize.js");
    const { parse } = await import("./parse.js");

    const module = optimize(
      lower(
        analyze(
          parse(`
            local raw = input("signal-A")
            local clamped = raw < 0 and 0 or (raw > 100 and 100 or raw)
            output("signal-B", clamped)
          `),
        ),
      ),
    );

    const graph = lowerToCombinators(module);

    expect(graph.outputs).toEqual([{ signal: "signal-B", entityId: "__o1" }]);
    // Every wire endpoint resolves to a known entity id (no dangling references).
    const knownIds = new Set(graph.entities.map((entity) => entity.id));
    for (const wire of graph.wires) {
      expect(knownIds.has(wire.from)).toBe(true);
      expect(knownIds.has(wire.to)).toBe(true);
    }
    expect(graph.entities.length).toBeGreaterThan(0);
  });

  it("specializes enable-hold of mem+δ into gate + latch (no else-gate, no mem+δ binop)", async () => {
    const { analyze } = await import("./analyze.js");
    const { lower } = await import("./lower.js");
    const { optimize } = await import("./optimize.js");
    const { parse } = await import("./parse.js");

    const module = optimize(
      lower(
        analyze(
          parse(`
            local L = input("signal-L")
            local i = 0
            while i < L do
              i = i + 1
              tick()
            end
            output("signal-A", i)
          `),
        ),
      ),
    );

    const graph = lowerToCombinators(module);
    const latches = graph.entities.filter((entity) => entity.role === "latch");
    const muxSides = graph.entities.filter((entity) => entity.role === "mux-side");
    // One body cell (i) uses incremental hold: 1 mux-side + latch with Q feedback.
    // __run uses a plain latch (else=0 path), not enable-hold fusion.
    expect(graph.entities.length).toBe(8);
    expect(muxSides.length).toBe(1);
    expect(latches.length).toBe(2);
    const iLatch = latches.find((entity) => {
      const cond = entity.control_behavior.arithmetic_conditions as
        | { first_signal?: { name?: string }; second_signal?: { name?: string } }
        | undefined;
      return cond?.first_signal?.name === entity.id;
    });
    expect(iLatch).toBeDefined();
    expect(graph.wires).toEqual(
      expect.arrayContaining([{ from: iLatch!.id, to: iLatch!.id, color: "green" }]),
    );
  });
});
