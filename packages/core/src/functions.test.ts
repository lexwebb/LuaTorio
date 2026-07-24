import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze } from "./analyze.js";
import { lowerToCombinators } from "./combinators.js";
import { lower } from "./lower.js";
import { optimize } from "./optimize.js";
import { parse } from "./parse.js";
import { simulate } from "./sim/simulate.js";

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), "../../../examples");

describe("user functions", () => {
  it("fully inlines clamp_fn into the existing simulator graph", () => {
    const source = readFileSync(join(examplesDir, "clamp_fn.lua"), "utf8");
    const graph = lowerToCombinators(optimize(lower(analyze(parse(source)))));

    expect(
      simulate(graph, { ticks: 1, inputs: { "signal-A": 1 } }).ticks[0]?.outputs["signal-B"],
    ).toBe(2);
    expect(
      simulate(graph, { ticks: 1, inputs: { "signal-A": 42 } }).ticks[0]?.outputs["signal-B"],
    ).toBe(42);
    expect(
      simulate(graph, { ticks: 1, inputs: { "signal-A": 150 } }).ticks[0]?.outputs["signal-B"],
    ).toBe(100);
  });
});
