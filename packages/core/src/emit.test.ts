import { decodePlan, isBlueprint } from "@jensforstmann/factorio-blueprint-tools";
import { describe, expect, it } from "vitest";
import { lowerToCombinators } from "./combinators.js";
import { emitBlueprint } from "./emit.js";
import { compile } from "./index.js";
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
    // Empty I/O pads are omitted: 2 inputs + 1 output drop, leaving the adder.
    expect(stats).toEqual({ combinators: 1, places: 0, wires: 0 });
    expect(stats.combinators).toBeLessThan(laidOut.entities.length);
  });

  it("round-trips through decodePlan with the same entity and wire count", () => {
    const laidOut = simpleLaidOut();
    const { blueprint, stats } = emitBlueprint(laidOut);

    const plan = decodePlan(blueprint);
    expect(isBlueprint(plan)).toBe(true);
    if (isBlueprint(plan)) {
      expect(plan.blueprint.entities).toHaveLength(stats.combinators);
      expect(plan.blueprint.wires).toHaveLength(stats.wires);
    }
  });

  it("emits the plan object as a JSON string when options.json is true", () => {
    const laidOut = simpleLaidOut();
    const { blueprint, stats } = emitBlueprint(laidOut, { json: true });

    const plan = JSON.parse(blueprint);
    expect(isBlueprint(plan)).toBe(true);
    expect(plan.blueprint.entities).toHaveLength(stats.combinators);
  });

  it("omits empty I/O placeholders from the blueprint but keeps valued constants", () => {
    const laidOut = simpleLaidOut();
    const { blueprint, stats } = emitBlueprint(laidOut, { json: true });
    const plan = JSON.parse(blueprint);
    expect(stats.combinators).toBe(1);
    expect(
      plan.blueprint.entities.every((e: { name: string }) => e.name === "arithmetic-combinator"),
    ).toBe(true);
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

  it("emits logistics chest control behavior and chest circuit connectors", () => {
    const { blueprint, stats } = compile(
      `
        local stock = place("logistic-chest-storage", 0, 0)
        local requests = place("logistic-chest-requester", 4, 0)
        local inv = input_from(stock)
        local iron = inv["iron-plate"]
        output_to(requests, { ["iron-plate"] = 200 })
        configure(requests, { set_requests = true, request_from_buffers = true })
        output("signal-A", iron)
      `,
      { json: true },
    );
    const plan = JSON.parse(blueprint);
    const stock = plan.blueprint.entities.find(
      (entity: { name: string }) => entity.name === "logistic-chest-storage",
    );
    const requester = plan.blueprint.entities.find(
      (entity: { name: string }) => entity.name === "logistic-chest-requester",
    );

    expect(stock.control_behavior.read_contents).toBe(true);
    expect(requester.control_behavior.set_requests).toBe(true);
    expect(requester.request_filters.request_from_buffers).toBe(true);
    expect(plan.blueprint.wires.some((wire: number[]) => wire[1] === 5 || wire[3] === 5)).toBe(
      true,
    );
    // Read path: storage chest connector 5 → combinator input (not only write wires).
    const stockNumber = stock.entity_number as number;
    expect(
      plan.blueprint.wires.some(
        (wire: number[]) => wire[0] === stockNumber && wire[1] === 5 && wire[3] === 1,
      ),
    ).toBe(true);
    // Sim phantoms for input_from must not appear as empty constant pads in the blueprint.
    const emptyConstants = plan.blueprint.entities.filter(
      (entity: { name: string; control_behavior?: { sections?: { sections?: unknown[] } } }) =>
        entity.name === "constant-combinator" &&
        (entity.control_behavior?.sections?.sections?.length ?? 0) === 0,
    );
    expect(emptyConstants).toHaveLength(0);
    expect(stats.wires).toBe(plan.blueprint.wires.length);
  });
});
