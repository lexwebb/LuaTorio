/**
 * Regression for the Reddit EACH-tag catalog pattern
 * (u/thegroundbelowme — constant catalog + one sticky multi-OR decider).
 *
 * See docs/superpowers/specs/2026-07-23-each-tag-catalog-research.md
 */
import { describe, expect, it } from "vitest";
import type { CircuitEntity, CircuitGraph } from "../combinators.js";
import { redWire } from "../combinators.js";
import { evalDecider, SIGNAL_EACH } from "./eval.js";
import { bagSet, bagToRecord, emptyBag } from "./signals.js";
import { simulate } from "./simulate.js";

function signalRef(name: string) {
  return { type: "virtual" as const, name };
}

const RECIPE_A = "recipe-A";
const RECIPE_B = "recipe-B";
const ITEM_A = "item-A";
const ITEM_B = "item-B";
const BUFFER = 10;

/** Green-only / red-only network selectors (Factorio operand wire picks). */
const GREEN = { red: false, green: true };
const RED = { red: true, green: false };

/**
 * Two-recipe sticky catalog decider (AND-before-OR), matching the Reddit shape:
 *   set:  item=0 ∧ EACH(green)=recipe(green)
 *   hold: item<buffer ∧ recipe(red)>0 ∧ EACH(green)=recipe(green)
 */
function catalogDecider(): CircuitEntity {
  return {
    id: "dec",
    kind: "decider",
    name: "decider-combinator",
    outputSignal: SIGNAL_EACH,
    role: "latch",
    control_behavior: {
      decider_conditions: {
        conditions: [
          // --- recipe A set ---
          {
            first_signal: signalRef(ITEM_A),
            first_signal_networks: RED,
            comparator: "=",
            constant: 0,
          },
          {
            compare_type: "and",
            first_signal: signalRef(SIGNAL_EACH),
            first_signal_networks: GREEN,
            comparator: "=",
            second_signal: signalRef(RECIPE_A),
            second_signal_networks: GREEN,
          },
          // --- recipe A hold ---
          {
            compare_type: "or",
            first_signal: signalRef(ITEM_A),
            first_signal_networks: RED,
            comparator: "<",
            constant: BUFFER,
          },
          {
            compare_type: "and",
            first_signal: signalRef(RECIPE_A),
            first_signal_networks: RED,
            comparator: ">",
            constant: 0,
          },
          {
            compare_type: "and",
            first_signal: signalRef(SIGNAL_EACH),
            first_signal_networks: GREEN,
            comparator: "=",
            second_signal: signalRef(RECIPE_A),
            second_signal_networks: GREEN,
          },
          // --- recipe B set ---
          {
            compare_type: "or",
            first_signal: signalRef(ITEM_B),
            first_signal_networks: RED,
            comparator: "=",
            constant: 0,
          },
          {
            compare_type: "and",
            first_signal: signalRef(SIGNAL_EACH),
            first_signal_networks: GREEN,
            comparator: "=",
            second_signal: signalRef(RECIPE_B),
            second_signal_networks: GREEN,
          },
          // --- recipe B hold ---
          {
            compare_type: "or",
            first_signal: signalRef(ITEM_B),
            first_signal_networks: RED,
            comparator: "<",
            constant: BUFFER,
          },
          {
            compare_type: "and",
            first_signal: signalRef(RECIPE_B),
            first_signal_networks: RED,
            comparator: ">",
            constant: 0,
          },
          {
            compare_type: "and",
            first_signal: signalRef(SIGNAL_EACH),
            first_signal_networks: GREEN,
            comparator: "=",
            second_signal: signalRef(RECIPE_B),
            second_signal_networks: GREEN,
          },
        ],
        outputs: [{ signal: signalRef(SIGNAL_EACH), copy_count_from_input: false, constant: 1 }],
      },
    },
  };
}

describe("EACH-tag catalog (Reddit pattern)", () => {
  it("unique green tags select only the matching recipe when stock is empty", () => {
    const red = emptyBag();
    const green = emptyBag();
    // both items empty → both set groups true; EACH tags pick which catalog signal emits
    bagSet(green, RECIPE_A, 1);
    bagSet(green, RECIPE_B, 2);
    const out = evalDecider(catalogDecider(), { red, green });
    // Both set conditions can fire; both recipes emit (no mutex in this minimal shape).
    expect(bagToRecord(out)).toEqual({ [RECIPE_A]: 1, [RECIPE_B]: 1 });
  });

  it("duplicate tags would falsely activate both recipes for one EACH filter", () => {
    const red = emptyBag();
    const green = emptyBag();
    bagSet(red, ITEM_A, 0);
    bagSet(red, ITEM_B, 5); // B not empty → B set false; B hold needs recipe on red
    // Broken catalog: both recipes tagged 1
    bagSet(green, RECIPE_A, 1);
    bagSet(green, RECIPE_B, 1);
    const out = evalDecider(catalogDecider(), { red, green });
    // EACH=RECIPE_A compares values: both green signals have value 1 → both pass A's filter
    expect(bagToRecord(out)).toEqual({ [RECIPE_A]: 1, [RECIPE_B]: 1 });
  });

  it("hold uses red feedback — green catalog must not keep the latch stuck", () => {
    const red = emptyBag();
    const green = emptyBag();
    bagSet(green, RECIPE_A, 1);
    bagSet(green, RECIPE_B, 2);
    // item-A mid-buffer, but no recipe on red yet → hold false, set false → off
    bagSet(red, ITEM_A, 5);
    bagSet(red, ITEM_B, 5);
    expect(bagToRecord(evalDecider(catalogDecider(), { red, green }))).toEqual({});

    // Same inventory, but recipe-A already selected on red → hold keeps A
    bagSet(red, RECIPE_A, 1);
    expect(bagToRecord(evalDecider(catalogDecider(), { red, green }))).toEqual({ [RECIPE_A]: 1 });
  });

  it("directed simulate: set at 0, hold below buffer, clear at buffer (2 entities)", () => {
    const catalog: CircuitEntity = {
      id: "catalog",
      kind: "constant",
      name: "constant-combinator",
      outputSignal: RECIPE_A,
      control_behavior: {
        sections: {
          sections: [
            {
              index: 1,
              filters: [
                { index: 1, count: 1, type: "virtual", name: RECIPE_A },
                { index: 2, count: 2, type: "virtual", name: RECIPE_B },
              ],
            },
          ],
        },
      },
    };
    const stockA: CircuitEntity = {
      id: ITEM_A,
      kind: "constant",
      name: "constant-combinator",
      outputSignal: ITEM_A,
      control_behavior: { sections: { sections: [] } },
    };
    const stockB: CircuitEntity = {
      id: ITEM_B,
      kind: "constant",
      name: "constant-combinator",
      outputSignal: ITEM_B,
      control_behavior: { sections: { sections: [] } },
    };
    const outPort: CircuitEntity = {
      id: "__o",
      kind: "constant",
      name: "constant-combinator",
      outputSignal: RECIPE_A,
      control_behavior: { sections: { sections: [] } },
    };
    const dec = catalogDecider();

    const graph: CircuitGraph = {
      entities: [catalog, stockA, stockB, dec, outPort],
      wires: [
        { from: "catalog", to: "dec", color: "green" },
        redWire(ITEM_A, "dec"),
        redWire(ITEM_B, "dec"),
        redWire("dec", "dec"), // sticky feedback on red
        { from: "dec", to: "__o", color: "green" },
      ],
      inputs: [
        { signal: ITEM_A, entityId: ITEM_A },
        { signal: ITEM_B, entityId: ITEM_B },
      ],
      outputs: [{ signal: RECIPE_A, entityId: "__o" }],
    };

    // Only A empty → select A; B stocked so B stays off
    const set = simulate(graph, {
      ticks: 2,
      inputs: { [ITEM_A]: 0, [ITEM_B]: 20 },
      entityOutputs: true,
    });
    expect(set.ticks[1]?.entities?.dec).toEqual({ [RECIPE_A]: 1 });
    expect(set.ticks[1]?.outputs[RECIPE_A]).toBe(1);

    // Mid-buffer with prior selection: hold A (empty→set, then raise stock)
    const hold = simulate(graph, {
      ticks: 4,
      inputs: (tick) => (tick < 2 ? { [ITEM_A]: 0, [ITEM_B]: 20 } : { [ITEM_A]: 5, [ITEM_B]: 20 }),
      entityOutputs: true,
    });
    expect(hold.ticks[3]?.entities?.dec).toEqual({ [RECIPE_A]: 1 });

    // At buffer: hold clears
    const clear = simulate(graph, {
      ticks: 4,
      inputs: (tick) =>
        tick < 2 ? { [ITEM_A]: 0, [ITEM_B]: 20 } : { [ITEM_A]: BUFFER, [ITEM_B]: 20 },
      entityOutputs: true,
    });
    expect(clear.ticks[3]?.entities?.dec ?? {}).toEqual({});
  });
});
