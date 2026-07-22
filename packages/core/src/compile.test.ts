import { isBlueprint } from "@jensforstmann/factorio-blueprint-tools";
import { describe, expect, it } from "vitest";
import { SemanticError } from "./analyze.js";
import { compile } from "./index.js";
import { ParseError } from "./parse.js";

describe("compile", () => {
  it("compiles a simple program into a blueprint string with stats", () => {
    const result = compile(`output("signal-C", input("signal-A") + input("signal-B"))`);

    expect(result.blueprint.startsWith("0")).toBe(true);
    expect(result.stats.combinators).toBeGreaterThan(0);
    expect(result.stats.wires).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });

  it("emits the plan object as JSON when options.json is true", () => {
    const result = compile(`output("signal-B", input("signal-A") + 1)`, { json: true });

    const plan = JSON.parse(result.blueprint);
    expect(isBlueprint(plan)).toBe(true);
    expect(plan.blueprint.entities.length).toBe(result.stats.combinators);
  });

  it("sets the blueprint label from options.name", () => {
    const result = compile(`output("signal-B", input("signal-A"))`, {
      name: "My Circuit",
      json: true,
    });

    expect(JSON.parse(result.blueprint).blueprint.label).toBe("My Circuit");
  });

  it("still compiles with optimize: false (folds nothing away)", () => {
    const optimized = compile(`output("signal-B", 1 + 2)`);
    const unoptimized = compile(`output("signal-B", 1 + 2)`, { optimize: false });

    // Constant folding collapses `1 + 2` into a single literal when optimize runs (default);
    // skipping it keeps the two literal operands plus the arithmetic combinator around.
    expect(unoptimized.stats.combinators).toBeGreaterThan(optimized.stats.combinators);
  });

  it("propagates ParseError from the parse stage", () => {
    expect(() => compile("local =")).toThrow(ParseError);
  });

  it("propagates SemanticError from the analyze stage", () => {
    expect(() => compile("local x = 1")).toThrow(SemanticError);
  });
});
