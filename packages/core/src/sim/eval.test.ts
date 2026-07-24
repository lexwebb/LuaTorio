import { describe, expect, it } from "vitest";
import type { CircuitEntity } from "../combinators.js";
import { evalDecider, evalSelector } from "./eval.js";
import { bagGet, bagSet, bagToRecord, emptyBag } from "./signals.js";

function decider(
  conditions: unknown[],
  outputs: unknown[],
  elseOutputs?: unknown[],
): CircuitEntity {
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

function selector(
  control_behavior: Record<string, unknown>,
  outputSignal = "signal-N",
): CircuitEntity {
  return {
    id: "s",
    kind: "selector",
    name: "selector-combinator",
    outputSignal,
    control_behavior,
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

  it("compares EACH channels by name across red and green networks", () => {
    const entity = decider(
      [
        {
          first_signal: { type: "virtual", name: "signal-each" },
          first_signal_networks: { red: true, green: false },
          comparator: "<=",
          second_signal: { type: "virtual", name: "signal-each" },
          second_signal_networks: { red: false, green: true },
        },
      ],
      [
        {
          signal: { type: "virtual", name: "signal-each" },
          copy_count_from_input: true,
          networks: { red: true, green: false },
        },
      ],
    );
    const red = emptyBag();
    const green = emptyBag();
    bagSet(red, "signal-A", 5);
    bagSet(red, "signal-B", 9);
    bagSet(green, "signal-A", 5);
    bagSet(green, "signal-B", 8);

    expect(bagToRecord(evalDecider(entity, { red, green }))).toEqual({ "signal-A": 5 });
  });
});

describe("evalSelector", () => {
  it("count: emits the number of present signals on count_signal", () => {
    const entity = selector({
      operation: "count",
      count_signal: { type: "virtual", name: "signal-N" },
    });
    const net = emptyBag();
    bagSet(net, "signal-A", 5);
    bagSet(net, "signal-B", 0);
    bagSet(net, "signal-C", -2);
    expect(bagGet(evalSelector(entity, net), "signal-N")).toBe(2);
  });

  it("select: picks by index with select_max descending (default)", () => {
    const entity = selector({
      operation: "select",
      index_constant: 1,
    });
    const net = emptyBag();
    bagSet(net, "signal-A", 10);
    bagSet(net, "signal-B", 3);
    bagSet(net, "signal-C", 7);
    // descending: A(10), C(7), B(3) → index 1 = C
    expect(bagToRecord(evalSelector(entity, net))).toEqual({ "signal-C": 7 });
  });

  it("select: ascending when select_max is false", () => {
    const entity = selector({
      operation: "select",
      select_max: false,
      index_constant: 0,
    });
    const net = emptyBag();
    bagSet(net, "signal-A", 10);
    bagSet(net, "signal-B", 3);
    // ascending: B(3), A(10) → index 0 = B
    expect(bagToRecord(evalSelector(entity, net))).toEqual({ "signal-B": 3 });
  });

  it("select: single signal always passes even if index is out of range", () => {
    const entity = selector({
      operation: "select",
      index_constant: 99,
    });
    const net = emptyBag();
    bagSet(net, "signal-A", 4);
    expect(bagToRecord(evalSelector(entity, net))).toEqual({ "signal-A": 4 });
  });

  it("select: empty when multi-signal index is out of range", () => {
    const entity = selector({
      operation: "select",
      index_constant: 5,
    });
    const net = emptyBag();
    bagSet(net, "signal-A", 1);
    bagSet(net, "signal-B", 2);
    expect(bagToRecord(evalSelector(entity, net))).toEqual({});
  });
});
