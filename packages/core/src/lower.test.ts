import { describe, expect, it } from "vitest";
import { analyze } from "./analyze.js";
import { lower } from "./lower.js";
import { parse } from "./parse.js";

function lowerSource(source: string) {
  return lower(analyze(parse(source)));
}

describe("lower", () => {
  it("lowers a two-input adder to a single binop node", () => {
    const module = lowerSource(`
      local a = input("signal-A")
      local b = input("signal-B")
      local sum = a + b
      output("signal-C", sum)
    `);

    expect(module).toMatchSnapshot();
    expect(module).toEqual({
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
    });
  });

  it("lowers a comparison to a cmp node", () => {
    const module = lowerSource(`
      local a = input("signal-A")
      local isPositive = a > 0
      output("signal-B", isPositive)
    `);

    expect(module).toMatchSnapshot();
    expect(module).toEqual({
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "literal", id: "__t2", value: 0 },
        { kind: "cmp", id: "__t3", op: ">", left: "__t1", right: "__t2" },
      ],
      outputs: [{ signal: "signal-B", nodeId: "__t3" }],
      inputs: [{ signal: "signal-A", nodeId: "__t1" }],
    });
  });

  it("desugars `and` into select(cond, right, 0), sharing one literal-0 node", () => {
    const module = lowerSource(`
      local a = input("signal-A")
      local b = input("signal-B")
      local anded = a and b
      output("signal-C", anded)
    `);

    expect(module).toMatchSnapshot();
    expect(module).toEqual({
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
    });
  });

  it("desugars `or` into select(cond, cond, right) reusing the left node id", () => {
    const module = lowerSource(`
      local a = input("signal-A")
      local b = input("signal-B")
      local ored = a or b
      output("signal-C", ored)
    `);

    expect(module).toMatchSnapshot();
    expect(module).toEqual({
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "input", id: "__t2", signal: "signal-B" },
        { kind: "select", id: "__t3", cond: "__t1", then: "__t1", else: "__t2" },
      ],
      outputs: [{ signal: "signal-C", nodeId: "__t3" }],
      inputs: [
        { signal: "signal-A", nodeId: "__t1" },
        { signal: "signal-B", nodeId: "__t2" },
      ],
    });
  });

  it("reuses a single shared literal-0 node across multiple desugared `and`s", () => {
    const module = lowerSource(`
      local a = input("signal-A")
      local b = input("signal-B")
      local c = input("signal-C")
      local x = a and b
      local y = a and c
      output("signal-D", x)
      output("signal-E", y)
    `);

    const zeroNodes = module.nodes.filter((node) => node.kind === "literal" && node.value === 0);
    expect(zeroNodes).toHaveLength(1);
    expect(module).toMatchSnapshot();
  });

  it("lowers a clamp-style program (nested and/or) with multiple locals", () => {
    const module = lowerSource(`
      local raw = input("signal-A")
      local clamped = raw < 0 and 0 or (raw > 100 and 100 or raw)
      output("signal-B", clamped)
    `);

    expect(module).toMatchSnapshot();
    expect(module.outputs).toEqual([{ signal: "signal-B", nodeId: module.nodes.at(-1)?.id }]);
    // Every node id referenced in outputs/select edges must exist in the node list.
    const knownIds = new Set(module.nodes.map((node) => node.id));
    for (const output of module.outputs) {
      expect(knownIds.has(output.nodeId)).toBe(true);
    }
  });

  it("supports multiple outputs sharing a common sub-expression", () => {
    const module = lowerSource(`
      local a = input("signal-A")
      local b = input("signal-B")
      local sum = a + b
      output("signal-C", sum)
      output("signal-D", sum - a)
    `);

    expect(module).toMatchSnapshot();
    expect(module).toEqual({
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "input", id: "__t2", signal: "signal-B" },
        { kind: "binop", id: "__t3", op: "+", left: "__t1", right: "__t2" },
        { kind: "binop", id: "__t4", op: "-", left: "__t3", right: "__t1" },
      ],
      outputs: [
        { signal: "signal-C", nodeId: "__t3" },
        { signal: "signal-D", nodeId: "__t4" },
      ],
      inputs: [
        { signal: "signal-A", nodeId: "__t1" },
        { signal: "signal-B", nodeId: "__t2" },
      ],
    });
  });

  it("lowers a reassigned local to memory + store", () => {
    const module = lowerSource(`
      local x = 0
      x = x + 1
      output("signal-A", x)
    `);

    expect(module).toEqual({
      nodes: [
        { kind: "literal", id: "__t1", value: 0 },
        { kind: "memory", id: "__t2", cell: "x", init: "__t1" },
        { kind: "literal", id: "__t3", value: 1 },
        { kind: "binop", id: "__t4", op: "+", left: "__t2", right: "__t3" },
        { kind: "store", id: "__t5", cell: "x", value: "__t4" },
      ],
      outputs: [{ signal: "signal-A", nodeId: "__t2" }],
      inputs: [],
    });
  });

  it("lowers if/else assigns to a select-muxed store", () => {
    const module = lowerSource(`
      local x = 0
      local c = input("signal-C")
      if c then
        x = 1
      else
        x = 2
      end
      output("signal-A", x)
    `);

    expect(module.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "memory", cell: "x" }),
        expect.objectContaining({
          kind: "select",
          then: expect.any(String),
          else: expect.any(String),
        }),
        expect.objectContaining({ kind: "store", cell: "x" }),
      ]),
    );
    const store = module.nodes.find((n) => n.kind === "store");
    const select = module.nodes.find((n) => n.kind === "select");
    expect(store).toMatchObject({ kind: "store", value: select?.id });
  });

  it("lowers if-then without else as select(cond, then, memory) hold", () => {
    const module = lowerSource(`
      local x = 0
      local c = input("signal-C")
      if c then
        x = 1
      end
      output("signal-A", x)
    `);

    const memory = module.nodes.find((n) => n.kind === "memory");
    const select = module.nodes.find((n) => n.kind === "select");
    expect(memory).toBeDefined();
    expect(select).toMatchObject({
      kind: "select",
      else: memory?.id,
    });
  });
});
