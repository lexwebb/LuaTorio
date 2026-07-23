import { describe, expect, it } from "vitest";
import { analyze } from "./analyze.js";
import { parse } from "./parse.js";

describe("analyze", () => {
  it("accepts a valid clamp-style program and records inputs/outputs", () => {
    const ast = parse(`
      local raw = input("signal-A")
      local clamped = raw < 0 and 0 or (raw > 100 and 100 or raw)
      output("signal-B", clamped)
    `);

    const program = analyze(ast);

    expect(program.statements).toHaveLength(2);
    expect(program.statements[0]).toMatchObject({ kind: "local", name: "raw" });
    expect(program.statements[1]).toMatchObject({ kind: "local", name: "clamped" });

    expect(program.inputs).toEqual([expect.objectContaining({ signal: "signal-A" })]);
    expect(program.outputs).toHaveLength(1);
    expect(program.outputs[0]).toMatchObject({
      signal: "signal-B",
      expr: { kind: "ref", name: "clamped" },
    });
    expect(program.statements[1].expr.kind).toBe("logical");
  });

  it("rejects while loops as planned for v2", () => {
    const ast = parse(`
      local x = 1
      while x do
        output("signal-A", x)
      end
    `);

    expect(() => analyze(ast)).toThrow(/while/i);
    try {
      analyze(ast);
    } catch (error) {
      expect(error).toMatchObject({ name: "SemanticError", plannedVersion: "v2" });
    }
  });

  it("rejects for loops as planned for v2", () => {
    const ast = parse(`
      for i = 1, 10 do
        output("signal-A", i)
      end
    `);

    expect(() => analyze(ast)).toThrow(/for/i);
    try {
      analyze(ast);
    } catch (error) {
      expect(error).toMatchObject({ name: "SemanticError", plannedVersion: "v2" });
    }
  });

  it("rejects function declarations as planned for v3", () => {
    const ast = parse(`
      function f(x)
        return x
      end
      output("signal-A", 1)
    `);

    expect(() => analyze(ast)).toThrow(/function/i);
    try {
      analyze(ast);
    } catch (error) {
      expect(error).toMatchObject({ name: "SemanticError", plannedVersion: "v3" });
    }
  });

  it("rejects table constructors as planned for v4", () => {
    const ast = parse(`
      local t = { 1, 2, 3 }
      output("signal-A", 1)
    `);

    expect(() => analyze(ast)).toThrow(/table/i);
    try {
      analyze(ast);
    } catch (error) {
      expect(error).toMatchObject({ name: "SemanticError", plannedVersion: "v4" });
    }
  });

  it("accepts a single next-state reassignment (v2 phase 1 memory)", () => {
    const ast = parse(`
      local x = 0
      x = x + 1
      output("signal-A", x)
    `);

    const program = analyze(ast);

    expect(program.statements).toEqual([
      expect.objectContaining({ kind: "local", name: "x" }),
      expect.objectContaining({ kind: "assign", name: "x" }),
    ]);
    expect(program.outputs[0]).toMatchObject({
      signal: "signal-A",
      expr: { kind: "ref", name: "x" },
    });
  });

  it("rejects a second next-state assignment to the same variable", () => {
    const ast = parse(`
      local x = 0
      x = x + 1
      x = x + 1
      output("signal-A", x)
    `);

    expect(() => analyze(ast)).toThrow(/next-state assignment/i);
  });

  it("rejects reassignment of an undefined variable", () => {
    const ast = parse(`
      x = 1
      output("signal-A", x)
    `);

    expect(() => analyze(ast)).toThrow(/undefined variable 'x'/i);
  });

  it("rejects tick() as planned for v2 phase 3", () => {
    const ast = parse(`
      local x = 1
      tick()
      output("signal-A", x)
    `);

    expect(() => analyze(ast)).toThrow(/tick/i);
    try {
      analyze(ast);
    } catch (error) {
      expect(error).toMatchObject({ name: "SemanticError", plannedVersion: "v2" });
    }
  });

  it("rejects redeclaration of an existing local as planned for v2 (SSA)", () => {
    const ast = parse(`
      local x = 1
      local x = 2
      output("signal-A", x)
    `);

    expect(() => analyze(ast)).toThrow(/x/);
    try {
      analyze(ast);
    } catch (error) {
      expect(error).toMatchObject({ name: "SemanticError", plannedVersion: "v2" });
    }
  });

  it("rejects bare if statements, pointing to the and/or idiom, planned for v2", () => {
    const ast = parse(`
      local x = 1
      if x then
        output("signal-A", x)
      end
    `);

    expect(() => analyze(ast)).toThrow(/and\/or/i);
    try {
      analyze(ast);
    } catch (error) {
      expect(error).toMatchObject({ name: "SemanticError", plannedVersion: "v2" });
    }
  });

  it("rejects non-literal signal names in input()", () => {
    const ast = parse(`
      local name = "signal-A"
      local raw = input(name)
      output("signal-B", raw)
    `);

    expect(() => analyze(ast)).toThrow(/string literal/i);
  });

  it("rejects non-literal signal names in output()", () => {
    const ast = parse(`
      local name = "signal-A"
      output(name, 1)
    `);

    expect(() => analyze(ast)).toThrow(/string literal/i);
  });

  it("requires at least one output() call", () => {
    const ast = parse(`local x = 1`);

    expect(() => analyze(ast)).toThrow(/output/i);
    try {
      analyze(ast);
    } catch (error) {
      expect(error).toMatchObject({ name: "SemanticError" });
      expect((error as { plannedVersion?: string }).plannedVersion).toBeUndefined();
    }
  });

  it("rejects float literals in v1", () => {
    const ast = parse(`output("signal-A", 1.5)`);

    expect(() => analyze(ast)).toThrow(/float/i);
  });

  it("rejects string literals used outside input()/output() signal names", () => {
    const ast = parse(`output("signal-A", "oops")`);

    expect(() => analyze(ast)).toThrow(/string/i);
  });

  it("rejects references to undefined variables", () => {
    const ast = parse(`output("signal-A", undeclared)`);

    expect(() => analyze(ast)).toThrow(/undefined/i);
  });

  it("supports arithmetic and comparison operators", () => {
    const ast = parse(`
      local a = input("signal-A")
      local b = input("signal-B")
      local sum = a + b - a * b / b % a
      local cmp = a == b
      output("signal-C", sum)
      output("signal-D", cmp)
    `);

    const program = analyze(ast);
    expect(program.statements[2]).toMatchObject({ kind: "local", name: "sum" });
    expect(program.statements[2].expr.kind).toBe("binop");
    expect(program.statements[3].expr.kind).toBe("cmp");
    expect(program.inputs).toHaveLength(2);
    expect(program.outputs).toHaveLength(2);
  });

  it("includes line and column information from the AST", () => {
    const ast = parse(`local x = 1\noutput("signal-A", x)`);
    const program = analyze(ast);

    expect(program.statements[0].line).toBe(1);
    expect(program.outputs[0].line).toBe(2);
  });
});
