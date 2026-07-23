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

  it("accepts while with body ending in tick() (v2 phase 3)", () => {
    const ast = parse(`
      local i = 0
      local lim = input("signal-L")
      while i < lim do
        i = i + 1
        tick()
      end
      output("signal-A", i)
    `);

    const program = analyze(ast);
    expect(program.statements).toEqual([
      expect.objectContaining({ kind: "local", name: "i" }),
      expect.objectContaining({ kind: "local", name: "lim" }),
      expect.objectContaining({
        kind: "while",
        body: [expect.objectContaining({ kind: "assign", name: "i" })],
      }),
    ]);
  });

  it("accepts numeric for with body ending in tick() (v2 phase 3)", () => {
    const ast = parse(`
      local sum = 0
      for i = 1, 10 do
        sum = sum + i
        tick()
      end
      output("signal-A", sum)
    `);

    const program = analyze(ast);
    expect(program.statements).toEqual([
      expect.objectContaining({ kind: "local", name: "sum" }),
      expect.objectContaining({
        kind: "for",
        name: "i",
        body: [expect.objectContaining({ kind: "assign", name: "sum" })],
      }),
    ]);
  });

  it("rejects while without tick()", () => {
    const ast = parse(`
      local i = 0
      while i < 10 do
        i = i + 1
      end
      output("signal-A", i)
    `);

    expect(() => analyze(ast)).toThrow(/tick/i);
  });

  it("rejects for without tick()", () => {
    const ast = parse(`
      local sum = 0
      for i = 1, 10 do
        sum = sum + i
      end
      output("signal-A", sum)
    `);

    expect(() => analyze(ast)).toThrow(/tick/i);
  });

  it("rejects mixing free-running assign with a clocked loop", () => {
    const ast = parse(`
      local x = 0
      x = x + 1
      while x < 10 do
        x = x + 1
        tick()
      end
      output("signal-A", x)
    `);

    expect(() => analyze(ast)).toThrow(/mix|free-running/i);
  });

  it("rejects a second top-level loop", () => {
    const ast = parse(`
      local x = 0
      while x < 5 do
        x = x + 1
        tick()
      end
      while x < 10 do
        x = x + 1
        tick()
      end
      output("signal-A", x)
    `);

    expect(() => analyze(ast)).toThrow(/at most one|clocked/i);
  });

  it("rejects assign to for induction variable", () => {
    const ast = parse(`
      local sum = 0
      for i = 1, 10 do
        i = i + 1
        tick()
      end
      output("signal-A", sum)
    `);

    expect(() => analyze(ast)).toThrow(/induction/i);
  });

  it("rejects numeric for with step other than literal 1", () => {
    const ast = parse(`
      local sum = 0
      for i = 1, 10, 2 do
        sum = sum + i
        tick()
      end
      output("signal-A", sum)
    `);

    expect(() => analyze(ast)).toThrow(/step/i);
  });

  it("rejects repeat loops", () => {
    const ast = parse(`
      local x = 1
      repeat
        x = x + 1
        tick()
      until x > 10
      output("signal-A", x)
    `);

    expect(() => analyze(ast)).toThrow(/repeat/i);
  });

  it("rejects output inside while body", () => {
    const ast = parse(`
      local x = 1
      while x do
        output("signal-A", x)
        tick()
      end
    `);

    expect(() => analyze(ast)).toThrow(/assignments and if/i);
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

  it("rejects tick() outside a while/for body", () => {
    const ast = parse(`
      local x = 1
      tick()
      output("signal-A", x)
    `);

    expect(() => analyze(ast)).toThrow(/tick/i);
    try {
      analyze(ast);
    } catch (error) {
      expect(error).toMatchObject({ name: "SemanticError" });
      expect((error as { plannedVersion?: string }).plannedVersion).toBeUndefined();
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

  it("accepts if/else that assigns memory next-state (v2 phase 2)", () => {
    const ast = parse(`
      local x = 0
      local c = input("signal-C")
      if c then
        x = x + 1
      else
        x = x - 1
      end
      output("signal-A", x)
    `);

    const program = analyze(ast);
    expect(program.statements).toEqual([
      expect.objectContaining({ kind: "local", name: "x" }),
      expect.objectContaining({ kind: "local", name: "c" }),
      expect.objectContaining({
        kind: "if",
        thenAssigns: [expect.objectContaining({ name: "x" })],
        elseAssigns: [expect.objectContaining({ name: "x" })],
      }),
    ]);
  });

  it("accepts if-then without else (hold when false)", () => {
    const ast = parse(`
      local x = 0
      local c = input("signal-C")
      if c then
        x = 1
      end
      output("signal-A", x)
    `);

    const program = analyze(ast);
    const ifStmt = program.statements.find((s) => s.kind === "if");
    expect(ifStmt).toMatchObject({
      kind: "if",
      thenAssigns: [expect.objectContaining({ name: "x" })],
      elseAssigns: [],
    });
  });

  it("rejects output() inside if bodies", () => {
    const ast = parse(`
      local x = 1
      if x then
        output("signal-A", x)
      end
    `);

    expect(() => analyze(ast)).toThrow(/only contain assignments/i);
  });

  it("desugars elseif chains into nested select assignments", () => {
    const ast = parse(`
      local x = 0
      local a = input("signal-A")
      local b = input("signal-B")
      if a then
        x = 1
      elseif b then
        x = 2
      end
      output("signal-A", x)
    `);

    const program = analyze(ast);
    const ifStmt = program.statements.find((statement) => statement.kind === "if");
    expect(ifStmt).toMatchObject({
      kind: "if",
      thenAssigns: [expect.objectContaining({ name: "x" })],
      elseAssigns: [expect.objectContaining({ name: "x" })],
    });
    if (ifStmt?.kind !== "if") throw new Error("expected an analyzed if statement");
    const elseifExpr = ifStmt.elseAssigns[0]?.expr;
    expect(elseifExpr).toMatchObject({ kind: "select" });
    if (elseifExpr?.kind !== "select") throw new Error("expected desugared elseif select");
    expect(elseifExpr.then).toMatchObject({ kind: "literal", value: 2 });
    expect(elseifExpr.else).toMatchObject({ kind: "ref", name: "x" });
  });

  it("desugars nested ifs in branches while preserving omitted-branch holds", () => {
    const ast = parse(`
      local x = 0
      local a = input("signal-A")
      local b = input("signal-B")
      if a then
        if b then
          x = 1
        end
      else
        x = 2
      end
      output("signal-X", x)
    `);

    const program = analyze(ast);
    const ifStmt = program.statements.find((statement) => statement.kind === "if");
    expect(ifStmt).toMatchObject({
      kind: "if",
      thenAssigns: [expect.objectContaining({ name: "x" })],
      elseAssigns: [expect.objectContaining({ name: "x" })],
    });
    if (ifStmt?.kind !== "if") throw new Error("expected an analyzed if statement");
    const nestedExpr = ifStmt.thenAssigns[0]?.expr;
    expect(nestedExpr).toMatchObject({ kind: "select" });
    if (nestedExpr?.kind !== "select") throw new Error("expected desugared nested if select");
    expect(nestedExpr.then).toMatchObject({ kind: "literal", value: 1 });
    expect(nestedExpr.else).toMatchObject({ kind: "ref", name: "x" });
  });

  it("rejects a second next-state site when if already assigned the variable", () => {
    const ast = parse(`
      local x = 0
      local c = input("signal-C")
      if c then
        x = 1
      end
      x = 2
      output("signal-A", x)
    `);

    expect(() => analyze(ast)).toThrow(/next-state assignment/i);
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

  it("tracks bag locals and permits pairwise bag arithmetic", () => {
    const program = analyze(
      parse(`
        local left = bag_const("signal-A", 10, "signal-B", 5)
        local right = bag_const("signal-A", 2, "signal-B", 5)
        local result = bag_arith("/", left, right)
        output("signal-A", result)
      `),
    );

    expect(program.statements[2]).toMatchObject({
      kind: "local",
      name: "result",
      expr: { kind: "bag_binop", op: "/" },
    });
  });

  it("rejects bag/scalar mixes with a bag-local error", () => {
    expect(() =>
      analyze(
        parse(`
          local bag = bag_const("signal-A", 10)
          output("signal-B", bag + 1)
        `),
      ),
    ).toThrow(/bag local 'bag'.*bag_arith/i);

    expect(() =>
      analyze(
        parse(`
          local scalar = 1
          local bag = bag_arith("/", scalar, bag_const("signal-A", 2))
          output("signal-A", bag)
        `),
      ),
    ).toThrow(/left operand must be a bag/i);
  });

  it("accepts bag_filter modes and rejects invalid filter calls", () => {
    const program = analyze(
      parse(`
        local data = bag_const("signal-A", 5)
        local mask = bag_const("signal-A", 1)
        local filtered = bag_filter("include", data, mask)
        output("signal-A", filtered)
      `),
    );
    expect(program.statements[2]).toMatchObject({
      kind: "local",
      name: "filtered",
      expr: { kind: "bag_filter", mode: "include" },
    });

    expect(() =>
      analyze(
        parse(`
          local data = bag_const("signal-A", 5)
          local mask = bag_const("signal-A", 1)
          local filtered = bag_filter("unknown", data, mask)
          output("signal-A", filtered)
        `),
      ),
    ).toThrow(/bag_filter mode/i);

    expect(() =>
      analyze(
        parse(`
          local data = bag_const("signal-A", 5)
          local filtered = bag_filter("include", data, 1)
          output("signal-A", filtered)
        `),
      ),
    ).toThrow(/mask operand must be a bag/i);
  });

  it("includes line and column information from the AST", () => {
    const ast = parse(`local x = 1\noutput("signal-A", x)`);
    const program = analyze(ast);

    expect(program.statements[0].line).toBe(1);
    expect(program.outputs[0].line).toBe(2);
  });
});
