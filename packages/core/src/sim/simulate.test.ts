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
});
