import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze } from "../analyze.js";
import { lowerToCombinators } from "../combinators.js";
import { lower } from "../lower.js";
import { optimize } from "../optimize.js";
import { parse } from "../parse.js";
import { simulate } from "./simulate.js";

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

function loadExample(name: string): string {
  return readFileSync(join(examplesDir, name), "utf8");
}

function graphOf(source: string) {
  return lowerToCombinators(optimize(lower(analyze(parse(source)))));
}

describe("simulate", () => {
  it("free-running counter: after t ticks signal-A === t (latch-synchronous)", () => {
    // Delay model: only role:latch is registered (1 tick). The +1 arithmetic is
    // combinational within the tick, so x' = x+1 lands on Q at the end of each tick.
    // Post-edge sample → after t ticks, A === t (started from 0).
    const graph = graphOf(loadExample("counter.lua"));
    const t = 10;
    const result = simulate(graph, { ticks: t });
    for (let i = 0; i < t; i += 1) {
      expect(result.ticks[i]?.outputs["signal-A"], `tick ${i + 1}`).toBe(i + 1);
    }
  });

  it("elseif_nested selects priority branches and holds when none match", () => {
    const graph = graphOf(loadExample("elseif_nested.lua"));
    const result = simulate(graph, {
      ticks: 4,
      inputs: (tick) =>
        [
          { "signal-A": 1, "signal-B": 1, "signal-C": 1 },
          { "signal-A": 1, "signal-B": 0, "signal-C": 1 },
          { "signal-A": 0, "signal-B": 0, "signal-C": 1 },
          { "signal-A": 0, "signal-B": 0, "signal-C": 0 },
        ][tick] ?? {},
    });

    expect(result.ticks.map((tick) => tick.outputs["signal-X"])).toEqual([1, 2, 3, 3]);
  });

  it("sr_latch sets, holds, then resets", () => {
    const graph = graphOf(loadExample("sr_latch.lua"));
    const result = simulate(graph, {
      ticks: 6,
      inputs: (t) => ({
        "signal-S": t === 1 ? 1 : 0,
        "signal-R": t === 4 ? 1 : 0,
      }),
    });
    expect(result.ticks.map((tick) => tick.outputs["signal-Q"] ?? 0)).toEqual([0, 1, 1, 1, 0, 0]);
  });

  it("while_count with L=5 settles at signal-A === 5", () => {
    const graph = graphOf(loadExample("while_count.lua"));
    const result = simulate(graph, { ticks: 12, inputs: { "signal-L": 5 } });
    expect(result.ticks[4]?.outputs["signal-A"]).toBe(5);
    expect(result.ticks[11]?.outputs["signal-A"]).toBe(5);
  });

  it("adder: static inputs appear as their sum on signal-C", () => {
    const graph = graphOf(loadExample("adder.lua"));
    const result = simulate(graph, {
      ticks: 2,
      inputs: { "signal-A": 3, "signal-B": 7 },
    });
    expect(result.ticks[0]?.outputs["signal-C"]).toBe(10);
    expect(result.ticks[1]?.outputs["signal-C"]).toBe(10);
  });

  it("signal_count: counts nonzero inputs onto signal-N", () => {
    const graph = graphOf(loadExample("signal_count.lua"));
    const result = simulate(graph, {
      ticks: 2,
      inputs: { "signal-A": 1, "signal-B": 0, "signal-C": 4 },
    });
    expect(result.ticks[0]?.outputs["signal-N"]).toBe(2);
    expect(result.ticks[1]?.outputs["signal-N"]).toBe(2);
  });

  it("for_sum 1..10 settles at signal-A === 55", () => {
    const graph = graphOf(loadExample("for_sum.lua"));
    const result = simulate(graph, { ticks: 16 });
    // After 10 enabled iterations sum = 55; further ticks hold.
    expect(result.ticks[9]?.outputs["signal-A"]).toBe(55);
    expect(result.ticks[15]?.outputs["signal-A"]).toBe(55);
  });

  it("signal_at: largest among A/B/C onto signal-N", () => {
    const graph = graphOf(loadExample("signal_at.lua"));
    const result = simulate(graph, {
      ticks: 2,
      inputs: { "signal-A": 3, "signal-B": 7, "signal-C": 1 },
    });
    expect(result.ticks[0]?.outputs["signal-N"]).toBe(7);
    expect(result.ticks[1]?.outputs["signal-N"]).toBe(7);
  });

  it("signal_at_asc: minimum present priority onto signal-N", () => {
    const graph = graphOf(loadExample("signal_at_asc.lua"));
    const result = simulate(graph, {
      ticks: 2,
      inputs: { "priority-1": 0, "priority-2": 2, "priority-3": 3 },
    });
    // 0 absent; among 2 and 3, ascending index 0 → 2
    expect(result.ticks[0]?.outputs["signal-N"]).toBe(2);
  });

  it("each_latch sets, holds below high, clears at high", async () => {
    const { compile } = await import("../index.js");
    const compiled = compile(loadExample("each_latch.lua"));
    expect(compiled.stats.combinators).toBe(2);

    const graph = graphOf(loadExample("each_latch.lua"));
    const set = simulate(graph, {
      ticks: 2,
      inputs: { "level-A": 0, "level-B": 20 },
    });
    expect(set.ticks[1]?.outputs["signal-A"]).toBe(1);
    expect(set.ticks[1]?.outputs["signal-B"] ?? 0).toBe(0);

    const hold = simulate(graph, {
      ticks: 4,
      inputs: (tick) =>
        tick < 2 ? { "level-A": 0, "level-B": 20 } : { "level-A": 5, "level-B": 20 },
    });
    expect(hold.ticks[3]?.outputs["signal-A"]).toBe(1);

    const clear = simulate(graph, {
      ticks: 4,
      inputs: (tick) =>
        tick < 2 ? { "level-A": 0, "level-B": 20 } : { "level-A": 10, "level-B": 20 },
    });
    expect(clear.ticks[3]?.outputs["signal-A"] ?? 0).toBe(0);
  });

  it("bag_arith emits cookbook EACH/EACH division over red and green bags", () => {
    const source = `
      local left = bag_const("signal-A", 10, "signal-B", 15)
      local right = bag_const("signal-A", 2, "signal-B", 3)
      local result = bag_arith("/", left, right)
      output("signal-A", result)
      output("signal-B", result)
    `;
    const graph = graphOf(source);
    const arithmetic = graph.entities.filter((entity) => entity.kind === "arithmetic");

    expect(arithmetic).toHaveLength(1);
    expect(arithmetic[0]?.control_behavior.arithmetic_conditions).toMatchObject({
      first_signal: { name: "signal-each" },
      first_signal_networks: { red: true, green: false },
      operation: "/",
      second_signal: { name: "signal-each" },
      second_signal_networks: { red: false, green: true },
      output_signal: { name: "signal-each" },
    });
    expect(graph.wires).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: "red" }),
        expect.objectContaining({ color: "green" }),
      ]),
    );

    const result = simulate(graph, { ticks: 2 });
    expect(result.ticks[1]?.outputs).toMatchObject({ "signal-A": 5, "signal-B": 5 });
  });

  it("bag_filter includes, excludes, and limits red data by a green bag", () => {
    const source = `
      local data = bag_const("signal-A", 5, "signal-B", 7, "signal-C", 9)
      local mask = bag_const("signal-A", 1, "signal-B", 7)
      local included = bag_filter("include", data, mask)
      local excluded = bag_filter("exclude", data, mask)
      local limited = bag_filter("limit", data, mask)
      output("signal-A", included)
      output("signal-C", excluded)
      output("signal-B", limited)
    `;
    const graph = graphOf(source);
    const filters = graph.entities.filter((entity) => entity.label?.startsWith("bag "));
    expect(filters).toHaveLength(3);
    expect(graph.wires).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: "red" }),
        expect.objectContaining({ color: "green" }),
      ]),
    );

    const result = simulate(graph, { ticks: 4, entityOutputs: true });
    expect(result.ticks[3]?.entities).toMatchObject({
      [filters[0]!.id]: { "signal-A": 5, "signal-B": 7 },
      [filters[1]!.id]: { "signal-C": 9 },
      [filters[2]!.id]: { "signal-B": 7 },
    });
    expect(result.ticks[3]?.outputs).toMatchObject({
      "signal-A": 5,
      "signal-B": 7,
      "signal-C": 9,
    });
  });

  it("table bag samples named channels as scalars, including absent channels", () => {
    const graph = graphOf(`
      local request = { ["iron-plate"] = 10, ["signal-A"] = -1 }
      local iron = request["iron-plate"]
      local absent = request["signal-Z"]
      local doubled = bag_arith("+", request, { ["iron-plate"] = 10, ["signal-A"] = -1 })
      local ironOnly = bag_filter("include", doubled, { ["iron-plate"] = 1 })
      output("iron-plate", request)
      output("signal-A", request)
      output("signal-B", iron)
      output("signal-C", absent)
      output("signal-D", ironOnly["iron-plate"])
    `);

    const result = simulate(graph, { ticks: 3 });
    expect(result.ticks[2]?.outputs).toMatchObject({
      "iron-plate": 10,
      "signal-A": -1,
      "signal-B": 10,
      "signal-C": 0,
      "signal-D": 20,
    });
  });

  it("edge emits a one-tick pulse for each rising scalar input", () => {
    const graph = graphOf(`
      local level = input("signal-L")
      local pulse = edge(level)
      output("signal-P", pulse)
    `);
    const edge = graph.entities.find((entity) => entity.label === "edge");
    expect(edge?.control_behavior.decider_conditions).toMatchObject({
      conditions: [
        {
          comparator: ">",
          first_signal_networks: { red: true, green: false },
          second_signal_networks: { red: false, green: true },
        },
      ],
    });
    const result = simulate(graph, {
      ticks: 8,
      entityOutputs: true,
      inputs: (tick) => ({ "signal-L": [0, 3, 3, 0, 2, 2, 0, 0][tick] ?? 0 }),
    });
    expect(
      result.ticks.map((tick) => tick.entities?.[edge!.id]?.[edge!.outputSignal] ?? 0),
    ).toEqual([0, 1, 0, 0, 1, 0, 0, 0]);
  });

  it("bag_test emits ANYTHING and EVERYTHING wildcard deciders", () => {
    const graph = graphOf(`
      local bag = bag_const("signal-A", 2, "signal-B", 5)
      local any = bag_test("any", ">", bag, 4)
      local every = bag_test("every", ">", bag, 1)
      output("signal-A", any)
      output("signal-B", every)
    `);
    const tests = graph.entities.filter((entity) => entity.label?.startsWith("bag "));
    expect(tests[0]?.control_behavior.decider_conditions).toMatchObject({
      conditions: [
        expect.objectContaining({
          first_signal: expect.objectContaining({ name: "signal-anything" }),
        }),
      ],
    });
    expect(tests[1]?.control_behavior.decider_conditions).toMatchObject({
      conditions: [
        expect.objectContaining({
          first_signal: expect.objectContaining({ name: "signal-everything" }),
        }),
      ],
    });
    const result = simulate(graph, { ticks: 3 });
    expect(result.ticks[2]?.outputs).toMatchObject({ "signal-A": 1, "signal-B": 1 });
  });

  it("entityInputs injects input_from bags onto entity_read phantoms", () => {
    const graph = graphOf(loadExample("logistics_io.lua"));
    expect(graph.entityReads?.length).toBe(1);
    const placeId = graph.entityReads?.[0]?.placeId;
    expect(placeId).toBeDefined();

    const result = simulate(graph, {
      ticks: 3,
      entityInputs: { [placeId as string]: { "iron-plate": 42 } },
    });
    expect(result.ticks[0]?.outputs["signal-A"]).toBe(42);
    expect(result.ticks[2]?.outputs["signal-A"]).toBe(42);
  });

  it("entityInputs can vary per tick", () => {
    const graph = graphOf(`
      local stock = place("logistic-chest-storage", 0, 0)
      local inv = input_from(stock)
      output("signal-A", inv["iron-plate"])
    `);
    const placeId = graph.entityReads?.[0]?.placeId as string;
    const result = simulate(graph, {
      ticks: 3,
      entityInputs: (tick) => ({ [placeId]: { "iron-plate": tick + 1 } }),
    });
    expect(result.ticks.map((t) => t.outputs["signal-A"])).toEqual([1, 2, 3]);
  });

  it("logistics_restock: need = target − stock via bag_arith + entityInputs", () => {
    const graph = graphOf(loadExample("logistics_restock.lua"));
    const placeId = graph.entityReads?.[0]?.placeId as string;
    const result = simulate(graph, {
      ticks: 4,
      entityInputs: { [placeId]: { "iron-plate": 50, "copper-plate": 20 } },
    });
    // Clamped iron: max(0, 200-50) = 150; signal-B is raw stock.
    expect(result.ticks[3]?.outputs["signal-A"]).toBe(150);
    expect(result.ticks[3]?.outputs["signal-B"]).toBe(50);
  });
});
