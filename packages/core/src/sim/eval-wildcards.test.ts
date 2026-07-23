import { describe, expect, it } from "vitest";
import type { CircuitEntity } from "../combinators.js";
import {
  evalArithmetic,
  evalDecider,
  SIGNAL_ANYTHING,
  SIGNAL_EACH,
  SIGNAL_EVERYTHING,
} from "./eval.js";
import { bagGet, bagSet, emptyBag, bagToRecord } from "./signals.js";

function signalRef(name: string) {
  return { type: "virtual" as const, name };
}

describe("evalArithmetic EACH", () => {
  it("maps EACH+0 onto EACH (identity over present signals)", () => {
    const entity: CircuitEntity = {
      id: "a",
      kind: "arithmetic",
      name: "arithmetic-combinator",
      outputSignal: SIGNAL_EACH,
      control_behavior: {
        arithmetic_conditions: {
          first_signal: signalRef(SIGNAL_EACH),
          second_constant: 0,
          operation: "+",
          output_signal: signalRef(SIGNAL_EACH),
        },
      },
    };
    const net = emptyBag();
    bagSet(net, "A", 3);
    bagSet(net, "B", 5);
    expect(bagToRecord(evalArithmetic(entity, net))).toEqual({ A: 3, B: 5 });
  });

  it("sums EACH+0 onto a specific output signal", () => {
    const entity: CircuitEntity = {
      id: "a",
      kind: "arithmetic",
      name: "arithmetic-combinator",
      outputSignal: "R",
      control_behavior: {
        arithmetic_conditions: {
          first_signal: signalRef(SIGNAL_EACH),
          second_constant: 0,
          operation: "+",
          output_signal: signalRef("R"),
        },
      },
    };
    const net = emptyBag();
    bagSet(net, "A", 3);
    bagSet(net, "B", 5);
    expect(bagGet(evalArithmetic(entity, net), "R")).toBe(8);
  });
});

describe("evalDecider wildcards", () => {
  it("Everything > 0 is true when all present signals pass (vacuous if empty)", () => {
    const entity: CircuitEntity = {
      id: "d",
      kind: "decider",
      name: "decider-combinator",
      outputSignal: "R",
      control_behavior: {
        decider_conditions: {
          conditions: [
            { first_signal: signalRef(SIGNAL_EVERYTHING), comparator: ">", constant: 0 },
          ],
          outputs: [{ signal: signalRef("R"), constant: 1 }],
        },
      },
    };
    expect(bagGet(evalDecider(entity, emptyBag()), "R")).toBe(1);
    const net = emptyBag();
    bagSet(net, "A", 2);
    bagSet(net, "B", 3);
    expect(bagGet(evalDecider(entity, net), "R")).toBe(1);
    bagSet(net, "B", -1);
    expect(bagGet(evalDecider(entity, net), "R")).toBe(0);
  });

  it("Anything > 10 is true when some present signal passes", () => {
    const entity: CircuitEntity = {
      id: "d",
      kind: "decider",
      name: "decider-combinator",
      outputSignal: "R",
      control_behavior: {
        decider_conditions: {
          conditions: [
            { first_signal: signalRef(SIGNAL_ANYTHING), comparator: ">", constant: 10 },
          ],
          outputs: [{ signal: signalRef("R"), constant: 1 }],
        },
      },
    };
    const net = emptyBag();
    bagSet(net, "A", 3);
    expect(bagGet(evalDecider(entity, net), "R")).toBe(0);
    bagSet(net, "B", 11);
    expect(bagGet(evalDecider(entity, net), "R")).toBe(1);
  });

  it("EACH > 0 with EACH output filters non-positive signals", () => {
    const entity: CircuitEntity = {
      id: "d",
      kind: "decider",
      name: "decider-combinator",
      outputSignal: SIGNAL_EACH,
      control_behavior: {
        decider_conditions: {
          conditions: [{ first_signal: signalRef(SIGNAL_EACH), comparator: ">", constant: 0 }],
          outputs: [{ signal: signalRef(SIGNAL_EACH), copy_count_from_input: true }],
        },
      },
    };
    const net = emptyBag();
    bagSet(net, "A", 4);
    bagSet(net, "B", -2);
    bagSet(net, "C", 7);
    expect(bagToRecord(evalDecider(entity, net))).toEqual({ A: 4, C: 7 });
  });

  it("EACH condition with specific output sums activating counts onto that signal", () => {
    const entity: CircuitEntity = {
      id: "d",
      kind: "decider",
      name: "decider-combinator",
      outputSignal: "R",
      control_behavior: {
        decider_conditions: {
          conditions: [{ first_signal: signalRef(SIGNAL_EACH), comparator: ">", constant: 0 }],
          outputs: [{ signal: signalRef("R"), copy_count_from_input: true }],
        },
      },
    };
    const net = emptyBag();
    bagSet(net, "A", 4);
    bagSet(net, "B", -2);
    bagSet(net, "C", 7);
    expect(bagGet(evalDecider(entity, net), "R")).toBe(11);
  });
});
