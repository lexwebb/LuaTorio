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
      inputs: (tick) => [
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
});
