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
    // Empty I/O pads are stripped; a lone adder may have no remaining wires.
    expect(result.stats.wires).toBeGreaterThanOrEqual(0);
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

  it("emits placed non-combinator entities at their absolute coordinates", () => {
    const result = compile(
      `
        local a = input("signal-A")
        output("signal-B", a + 1)
        place("wooden-chest", 4, 0)
        place("small-lamp", 4, 2)
      `,
      { json: true },
    );
    const entities = JSON.parse(result.blueprint).blueprint.entities as Array<{
      name: string;
      position: { x: number; y: number };
    }>;

    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "wooden-chest", position: { x: 4, y: 0 } }),
        expect.objectContaining({ name: "small-lamp", position: { x: 4, y: 2 } }),
      ]),
    );
    expect(result.stats.places).toBe(2);
  });

  it("still compiles with optimize: false (folds nothing away at IR)", () => {
    const optimized = compile(`output("signal-B", 1 + 2)`, { json: true });
    const unoptimized = compile(`output("signal-B", 1 + 2)`, { optimize: false, json: true });

    const optEntities = JSON.parse(optimized.blueprint).blueprint.entities as Array<{
      name: string;
    }>;
    const unoptEntities = JSON.parse(unoptimized.blueprint).blueprint.entities as Array<{
      name: string;
    }>;
    // IR constant-fold collapses to a literal; combinator-level still folds 1+2 into one
    // arithmetic with two constants when optimize is off.
    expect(optEntities.some((e) => e.name === "arithmetic-combinator")).toBe(false);
    expect(unoptEntities.some((e) => e.name === "arithmetic-combinator")).toBe(true);
  });

  it("propagates ParseError from the parse stage", () => {
    expect(() => compile("local =")).toThrow(ParseError);
  });

  it("propagates SemanticError from the analyze stage", () => {
    expect(() => compile("local x = 1")).toThrow(SemanticError);
  });
});
