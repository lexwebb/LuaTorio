import { decodePlan, isBlueprint } from "@jensforstmann/factorio-blueprint-tools";
import { describe, expect, it } from "vitest";
import { lowerToCombinators } from "./combinators.js";
import { emitBlueprint } from "./emit.js";
import type { LaidOutCircuit } from "./layout.js";
import { layout } from "./layout.js";

function simpleLaidOut(): LaidOutCircuit {
  const graph = lowerToCombinators({
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
  return layout(graph);
}

describe("emitBlueprint", () => {
  it("produces an encoded blueprint string starting with the version-0 prefix", () => {
    const laidOut = simpleLaidOut();
    const { blueprint, stats } = emitBlueprint(laidOut);

    expect(blueprint.startsWith("0")).toBe(true);
    expect(stats).toEqual({ combinators: laidOut.entities.length, wires: laidOut.wires.length });
  });

  it("round-trips through decodePlan with the same entity and wire count", () => {
    const laidOut = simpleLaidOut();
    const { blueprint } = emitBlueprint(laidOut);

    const plan = decodePlan(blueprint);
    expect(isBlueprint(plan)).toBe(true);
    if (isBlueprint(plan)) {
      expect(plan.blueprint.entities).toHaveLength(laidOut.entities.length);
      expect(plan.blueprint.wires).toHaveLength(laidOut.wires.length);
    }
  });

  it("emits the plan object as a JSON string when options.json is true", () => {
    const laidOut = simpleLaidOut();
    const { blueprint } = emitBlueprint(laidOut, { json: true });

    const plan = JSON.parse(blueprint);
    expect(isBlueprint(plan)).toBe(true);
    expect(plan.blueprint.entities).toHaveLength(laidOut.entities.length);
  });

  it("sets the blueprint label from options.name", () => {
    const laidOut = simpleLaidOut();
    const { blueprint } = emitBlueprint(laidOut, { name: "My Circuit", json: true });

    const plan = JSON.parse(blueprint);
    expect(plan.blueprint.label).toBe("My Circuit");
  });

  it("converts internal comparator strings to the library's blueprint-string symbols", () => {
    const graph = lowerToCombinators({
      nodes: [
        { kind: "input", id: "__t1", signal: "signal-A" },
        { kind: "literal", id: "__t2", value: 0 },
        { kind: "cmp", id: "__t3", op: "~=", left: "__t1", right: "__t2" },
      ],
      outputs: [{ signal: "signal-B", nodeId: "__t3" }],
      inputs: [{ signal: "signal-A", nodeId: "__t1" }],
    });
    const laidOut = layout(graph);
    const { blueprint } = emitBlueprint(laidOut, { json: true });

    const plan = JSON.parse(blueprint);
    const decider = plan.blueprint.entities.find(
      (e: { name: string }) => e.name === "decider-combinator",
    );
    expect(decider.control_behavior.decider_conditions.conditions[0].comparator).toBe("≠");
  });
});
