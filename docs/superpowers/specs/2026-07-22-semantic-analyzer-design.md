# Semantic Analyzer Design (v1 subset gate)

**Date:** 2026-07-22  
**Status:** Approved (autonomous)  
**Issue:** [#5](https://github.com/lexwebb/LuaTorio/issues/5)  
**Parent:** [LuaTorio Design Spec](./2026-07-22-luatorio-design.md)  
**Depends on:** [#4 parser](./2026-07-22-lua-parser-design.md)

## Summary

Walk a luaparse `Chunk` and enforce v1 language rules. Return a validated program model (or throw `SemanticError` with line/column and planned version). No IR lowering yet.

## API

```typescript
export class SemanticError extends Error {
  readonly line: number;
  readonly column: number;
  readonly plannedVersion?: string;
}

export interface AnalyzedProgram {
  /** Ordered locals and expression bindings — enough for IR lowering (#6) */
  statements: AnalyzedStatement[];
  outputs: Array<{ signal: string; expr: AnalyzedExpr; line: number; column: number }>;
  inputs: Array<{ signal: string; line: number; column: number }>;
}

export function analyze(ast: Chunk): AnalyzedProgram;
```

Exact `AnalyzedStatement` / `AnalyzedExpr` shapes: minimal typed mirror of allowed constructs (literal, input, ident, binop, cmp, select/if, logical and/or). Prefer a small discriminated union sufficient for #6.

## Rules (must enforce)

Allow: `local x = expr`, `input("sig")`, `output("sig", expr)`, `+ - * / %`, comparisons, `if`/`else` expression form, `and`/`or`, integer literals.

Reject with planned version:
- reassignment / redeclare → v2
- `while` / `for` → v2
- `function` → v3
- tables → v4
- non-literal signal names in input/output → clear error (no version)
- missing `output()` → clear error
- non-integer numeric literals if float appears → reject or truncate policy: **reject floats** in v1

## Errors

`SemanticError` message includes construct name and `(planned for vN)` when applicable; line/column from AST `loc` when present.

## Tests

Valid clamp-style program; one test per rejection class; require output; SSA redeclare.

## Out of scope

IR, optimize, emit, compile() wiring beyond `analyze` export (optional: `compile` still stub).
