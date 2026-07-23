import { describe, expect, it } from "vitest";
import type { IRModule } from "./ir.js";
import {
  isBooleanOrSelect,
  isStickyClearSelect,
  matchAndOrMux,
  matchEnableHold,
  matchMemoryStore,
  memDeltaLiteral,
  memPlusDelta,
} from "./ir-match.js";

function index(module: IRModule) {
  const nodeById = new Map(module.nodes.map((node) => [node.id, node]));
  const useCount = new Map<string, number>();
  const bump = (id: string) => useCount.set(id, (useCount.get(id) ?? 0) + 1);
  for (const node of module.nodes) {
    switch (node.kind) {
      case "binop":
      case "cmp":
        bump(node.left);
        bump(node.right);
        break;
      case "select":
        bump(node.cond);
        bump(node.then);
        bump(node.else);
        break;
      case "memory":
        bump(node.init);
        break;
      case "store":
        bump(node.value);
        break;
      case "sr":
        bump(node.state);
        bump(node.set);
        bump(node.reset);
        break;
      default:
        break;
    }
  }
  return { nodeById, useCount };
}

describe("ir-match", () => {
  it("matches mem+δ and mem±lit", () => {
    const module: IRModule = {
      nodes: [
        { kind: "literal", id: "__t0", value: 0 },
        { kind: "memory", id: "__t1", cell: "i", init: "__t0" },
        { kind: "literal", id: "__t2", value: 1 },
        { kind: "binop", id: "__t3", op: "+", left: "__t1", right: "__t2" },
        { kind: "binop", id: "__t4", op: "-", left: "__t1", right: "__t2" },
      ],
      outputs: [],
      inputs: [],
    };
    const { nodeById } = index(module);
    expect(memPlusDelta("__t3", "__t1", nodeById)).toBe("__t2");
    expect(memDeltaLiteral("__t3", "__t1", nodeById)).toBe(1);
    expect(memDeltaLiteral("__t4", "__t1", nodeById)).toBe(-1);
  });

  it("classifies free-delta / enable-hold / sticky / delta-choose stores", () => {
    const free: IRModule = {
      nodes: [
        { kind: "literal", id: "__t0", value: 0 },
        { kind: "memory", id: "__t1", cell: "x", init: "__t0" },
        { kind: "literal", id: "__t2", value: 1 },
        { kind: "binop", id: "__t3", op: "+", left: "__t1", right: "__t2" },
        { kind: "store", id: "__t4", cell: "x", value: "__t3" },
      ],
      outputs: [],
      inputs: [],
    };
    const freeIdx = index(free);
    const mem = free.nodes.find((n) => n.kind === "memory");
    expect(mem?.kind).toBe("memory");
    if (mem?.kind !== "memory") {
      return;
    }
    expect(matchMemoryStore(mem, "__t3", freeIdx.nodeById, freeIdx.useCount)).toEqual({
      kind: "free-delta",
      deltaId: "__t2",
      binopId: "__t3",
    });

    const hold: IRModule = {
      nodes: [
        { kind: "literal", id: "__t0", value: 0 },
        { kind: "memory", id: "__t1", cell: "x", init: "__t0" },
        { kind: "input", id: "__t2", signal: "signal-C" },
        { kind: "literal", id: "__t3", value: 1 },
        { kind: "binop", id: "__t4", op: "+", left: "__t1", right: "__t3" },
        { kind: "select", id: "__t5", cond: "__t2", then: "__t4", else: "__t1" },
        { kind: "store", id: "__t6", cell: "x", value: "__t5" },
      ],
      outputs: [],
      inputs: [{ signal: "signal-C", nodeId: "__t2" }],
    };
    const holdIdx = index(hold);
    const holdMem = hold.nodes.find((n) => n.kind === "memory");
    if (holdMem?.kind !== "memory") {
      throw new Error("expected memory");
    }
    expect(matchMemoryStore(holdMem, "__t5", holdIdx.nodeById, holdIdx.useCount)).toEqual({
      kind: "enable-hold",
      select: holdIdx.nodeById.get("__t5"),
      deltaId: "__t3",
    });
    expect(matchEnableHold(holdIdx.nodeById.get("__t5") as never, "__t1")).toEqual({
      select: holdIdx.nodeById.get("__t5"),
      nextId: "__t4",
    });

    const sticky: IRModule = {
      nodes: [
        { kind: "literal", id: "__t0", value: 1 },
        { kind: "memory", id: "__t1", cell: "run", init: "__t0" },
        { kind: "input", id: "__t2", signal: "signal-L" },
        { kind: "cmp", id: "__t3", op: "<", left: "__t1", right: "__t2" },
        { kind: "literal", id: "__t4", value: 0 },
        { kind: "select", id: "__t5", cond: "__t1", then: "__t3", else: "__t4" },
        { kind: "store", id: "__t6", cell: "run", value: "__t5" },
      ],
      outputs: [],
      inputs: [{ signal: "signal-L", nodeId: "__t2" }],
    };
    const stickyIdx = index(sticky);
    const stickySel = stickyIdx.nodeById.get("__t5");
    expect(stickySel?.kind).toBe("select");
    if (stickySel?.kind !== "select") {
      return;
    }
    expect(isStickyClearSelect(stickySel, "__t1", stickyIdx.nodeById)).toBe(true);
    const stickyMem = sticky.nodes.find((n) => n.kind === "memory");
    if (stickyMem?.kind !== "memory") {
      throw new Error("expected memory");
    }
    expect(matchMemoryStore(stickyMem, "__t5", stickyIdx.nodeById, stickyIdx.useCount).kind).toBe(
      "sticky-clear",
    );

    const choose: IRModule = {
      nodes: [
        { kind: "literal", id: "__t0", value: 0 },
        { kind: "memory", id: "__t1", cell: "x", init: "__t0" },
        { kind: "input", id: "__t2", signal: "signal-C" },
        { kind: "literal", id: "__t3", value: 1 },
        { kind: "binop", id: "__t4", op: "+", left: "__t1", right: "__t3" },
        { kind: "binop", id: "__t5", op: "-", left: "__t1", right: "__t3" },
        { kind: "select", id: "__t6", cond: "__t2", then: "__t4", else: "__t5" },
        { kind: "store", id: "__t7", cell: "x", value: "__t6" },
      ],
      outputs: [],
      inputs: [{ signal: "signal-C", nodeId: "__t2" }],
    };
    const chooseIdx = index(choose);
    const chooseMem = choose.nodes.find((n) => n.kind === "memory");
    if (chooseMem?.kind !== "memory") {
      throw new Error("expected memory");
    }
    expect(matchMemoryStore(chooseMem, "__t6", chooseIdx.nodeById, chooseIdx.useCount)).toEqual({
      kind: "delta-choose",
      select: chooseIdx.nodeById.get("__t6"),
      thenDelta: 1,
      elseDelta: -1,
    });
  });

  it("matches boolean or and and-or mux nests", () => {
    const module: IRModule = {
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "literal", id: "__t2", value: 0 },
        { kind: "cmp", id: "__t3", op: ">", left: "__t1", right: "__t2" },
        { kind: "input", id: "__t4", signal: "signal-B" },
        { kind: "cmp", id: "__t5", op: ">", left: "__t4", right: "__t2" },
        { kind: "select", id: "__t6", cond: "__t3", then: "__t3", else: "__t5" },
        { kind: "literal", id: "__t7", value: 0 },
        { kind: "select", id: "__t8", cond: "__t3", then: "__t1", else: "__t7" },
        { kind: "select", id: "__t9", cond: "__t8", then: "__t8", else: "__t4" },
      ],
      outputs: [],
      inputs: [
        { signal: "signal-A", nodeId: "__t1" },
        { signal: "signal-B", nodeId: "__t4" },
      ],
    };
    const { nodeById, useCount } = index(module);
    const orSel = nodeById.get("__t6");
    expect(orSel?.kind).toBe("select");
    if (orSel?.kind !== "select") {
      return;
    }
    expect(isBooleanOrSelect(orSel, nodeById)).toBe(true);

    const outer = nodeById.get("__t9");
    expect(outer?.kind).toBe("select");
    if (outer?.kind !== "select") {
      return;
    }
    expect(matchAndOrMux(outer, nodeById, useCount)).toEqual({
      inner: nodeById.get("__t8"),
      x: "__t1",
      y: "__t4",
    });
  });
});
