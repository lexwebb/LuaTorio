import { describe, expect, it } from "vitest";
import type { CircuitEntity } from "../combinators.js";
import { evalDecider } from "./eval.js";
import { bagGet, emptyBag, bagSet } from "./signals.js";

function decider(conditions: unknown[], outputs: unknown[], elseOutputs?: unknown[]): CircuitEntity {
  return {
    id: "d",
    kind: "decider",
    name: "decider-combinator",
    outputSignal: "signal-A",
    control_behavior: {
      decider_conditions: {
        conditions,
        outputs,
        ...(elseOutputs !== undefined ? { else_outputs: elseOutputs } : {}),
      },
    },
  };
}

describe("evalDecider", () => {
  it("ANDs conditions when compare_type is and", () => {
    const entity = decider(
      [
        { first_signal: { type: "virtual", name: "A" }, comparator: "!=", constant: 0 },
        {
          first_signal: { type: "virtual", name: "B" },
          comparator: "!=",
          constant: 0,
          compare_type: "and",
        },
      ],
      [{ signal: { type: "virtual", name: "signal-A" }, constant: 1 }],
    );
    const net = emptyBag();
    bagSet(net, "A", 1);
    bagSet(net, "B", 0);
    expect(bagGet(evalDecider(entity, net), "signal-A")).toBe(0);
    bagSet(net, "B", 1);
    expect(bagGet(evalDecider(entity, net), "signal-A")).toBe(1);
  });

  it("ORs conditions when compare_type is or (AND binds tighter)", () => {
    // A OR B AND C  ≡  A ∨ (B ∧ C)
    const entity = decider(
      [
        { first_signal: { type: "virtual", name: "A" }, comparator: "!=", constant: 0 },
        {
          first_signal: { type: "virtual", name: "B" },
          comparator: "!=",
          constant: 0,
          compare_type: "or",
        },
        {
          first_signal: { type: "virtual", name: "C" },
          comparator: "!=",
          constant: 0,
          compare_type: "and",
        },
      ],
      [{ signal: { type: "virtual", name: "signal-A" }, constant: 1 }],
    );
    const net = emptyBag();
    // only A
    bagSet(net, "A", 1);
    expect(bagGet(evalDecider(entity, net), "signal-A")).toBe(1);
    // only B (no C) — B∧C fails, A false
    bagSet(net, "A", 0);
    bagSet(net, "B", 1);
    bagSet(net, "C", 0);
    expect(bagGet(evalDecider(entity, net), "signal-A")).toBe(0);
    // B and C
    bagSet(net, "C", 1);
    expect(bagGet(evalDecider(entity, net), "signal-A")).toBe(1);
  });

  it("emits else_outputs when the OR/AND condition fails", () => {
    const entity = decider(
      [
        { first_signal: { type: "virtual", name: "A" }, comparator: "!=", constant: 0 },
        {
          first_signal: { type: "virtual", name: "B" },
          comparator: "!=",
          constant: 0,
          compare_type: "or",
        },
      ],
      [{ signal: { type: "virtual", name: "signal-A" }, constant: 1 }],
      [{ signal: { type: "virtual", name: "signal-A" }, constant: 9 }],
    );
    const net = emptyBag();
    expect(bagGet(evalDecider(entity, net), "signal-A")).toBe(9);
  });
});
