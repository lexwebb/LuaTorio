import { describe, expect, it } from "vitest";
import type { IRModule } from "./ir.js";
import { optimize } from "./optimize.js";

describe("optimize", () => {
  it("folds a binop of two literals into a single literal", () => {
    const before: IRModule = {
      nodes: [
        { kind: "literal", id: "__t1", value: 2 },
        { kind: "literal", id: "__t2", value: 3 },
        { kind: "binop", id: "__t3", op: "+", left: "__t1", right: "__t2" },
      ],
      outputs: [{ signal: "signal-A", nodeId: "__t3" }],
      inputs: [],
    };

    const after = optimize(before);

    expect(after).toEqual({
      nodes: [{ kind: "literal", id: "__t3", value: 5 }],
      outputs: [{ signal: "signal-A", nodeId: "__t3" }],
      inputs: [],
    });
  });

  it("folds a cmp of two literals into a 0/1 literal", () => {
    const before: IRModule = {
      nodes: [
        { kind: "literal", id: "__t1", value: 5 },
        { kind: "literal", id: "__t2", value: 3 },
        { kind: "cmp", id: "__t3", op: ">", left: "__t1", right: "__t2" },
      ],
      outputs: [{ signal: "signal-A", nodeId: "__t3" }],
      inputs: [],
    };

    const after = optimize(before);

    expect(after).toEqual({
      nodes: [{ kind: "literal", id: "__t3", value: 1 }],
      outputs: [{ signal: "signal-A", nodeId: "__t3" }],
      inputs: [],
    });
  });

  it("resolves a select with a literal condition to the taken branch, without needing the branch to be a literal", () => {
    const before: IRModule = {
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "input", id: "__t2", signal: "signal-B" },
        { kind: "literal", id: "__t3", value: 1 },
        { kind: "select", id: "__t4", cond: "__t3", then: "__t1", else: "__t2" },
      ],
      outputs: [{ signal: "signal-C", nodeId: "__t4" }],
      inputs: [
        { signal: "signal-A", nodeId: "__t1" },
        { signal: "signal-B", nodeId: "__t2" },
      ],
    };

    const after = optimize(before);

    // The select is gone and the output points straight at the taken (`then`) branch. Both
    // inputs survive DCE even though signal-B is now unreachable from outputs, because
    // `module.inputs` entries are preferred to be kept.
    expect(after).toEqual({
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "input", id: "__t2", signal: "signal-B" },
      ],
      outputs: [{ signal: "signal-C", nodeId: "__t1" }],
      inputs: [
        { signal: "signal-A", nodeId: "__t1" },
        { signal: "signal-B", nodeId: "__t2" },
      ],
    });
  });

  it("shares one node for a duplicated subexpression (CSE) referenced by two outputs", () => {
    const before: IRModule = {
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "input", id: "__t2", signal: "signal-B" },
        { kind: "binop", id: "__t3", op: "+", left: "__t1", right: "__t2" },
        { kind: "binop", id: "__t4", op: "+", left: "__t1", right: "__t2" },
      ],
      outputs: [
        { signal: "signal-C", nodeId: "__t3" },
        { signal: "signal-D", nodeId: "__t4" },
      ],
      inputs: [
        { signal: "signal-A", nodeId: "__t1" },
        { signal: "signal-B", nodeId: "__t2" },
      ],
    };

    const after = optimize(before);

    expect(after.nodes).toHaveLength(3);
    expect(after.outputs[0]?.nodeId).toBe(after.outputs[1]?.nodeId);
  });

  it("eliminates an unused local (dead code) that isn't listed as an input", () => {
    const before: IRModule = {
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "literal", id: "__t2", value: 99 }, // unused local, not an input
        { kind: "binop", id: "__t3", op: "*", left: "__t1", right: "__t1" },
      ],
      outputs: [{ signal: "signal-B", nodeId: "__t3" }],
      inputs: [{ signal: "signal-A", nodeId: "__t1" }],
    };

    const after = optimize(before);

    expect(after.nodes.map((node) => node.id)).toEqual(["__t1", "__t3"]);
    expect(after.nodes.some((node) => node.id === "__t2")).toBe(false);
  });

  it("aliases select(c, x, x) to x", () => {
    const before: IRModule = {
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "select", id: "__t2", cond: "__t1", then: "__t1", else: "__t1" },
      ],
      outputs: [{ signal: "signal-B", nodeId: "__t2" }],
      inputs: [{ signal: "signal-A", nodeId: "__t1" }],
    };

    const after = optimize(before);

    expect(after.outputs[0]?.nodeId).toBe("__t1");
    expect(after.nodes.some((node) => node.kind === "select")).toBe(false);
  });

  it("aliases select(cmp, 1, 0) to the cmp (redundant truthify)", () => {
    const before: IRModule = {
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "literal", id: "__t2", value: 0 },
        { kind: "cmp", id: "__t3", op: ">", left: "__t1", right: "__t2" },
        { kind: "literal", id: "__t4", value: 1 },
        { kind: "select", id: "__t5", cond: "__t3", then: "__t4", else: "__t2" },
      ],
      outputs: [{ signal: "signal-B", nodeId: "__t5" }],
      inputs: [{ signal: "signal-A", nodeId: "__t1" }],
    };

    const after = optimize(before);

    expect(after.outputs[0]?.nodeId).toBe("__t3");
    expect(after.nodes.some((node) => node.kind === "select")).toBe(false);
  });

  it("returns a module with no dangling references (every referenced id exists in nodes)", () => {
    const before: IRModule = {
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "literal", id: "__t2", value: 10 },
        { kind: "cmp", id: "__t3", op: "<", left: "__t1", right: "__t2" },
        { kind: "literal", id: "__t4", value: 0 },
        { kind: "select", id: "__t5", cond: "__t3", then: "__t4", else: "__t1" },
      ],
      outputs: [{ signal: "signal-B", nodeId: "__t5" }],
      inputs: [{ signal: "signal-A", nodeId: "__t1" }],
    };

    const after = optimize(before);
    const knownIds = new Set(after.nodes.map((node) => node.id));

    for (const output of after.outputs) {
      expect(knownIds.has(output.nodeId)).toBe(true);
    }
    for (const input of after.inputs) {
      expect(knownIds.has(input.nodeId)).toBe(true);
    }
  });
});
