# Task 1 Report — IR Types and Lowering (Issue #6)

**Status:** Complete

## What was built

- `packages/core/src/ir.ts` — `IRNode` union (`literal`, `input`, `binop`, `cmp`, `select`)
  and `IRModule` (`nodes`, `outputs`, `inputs`), per the design doc's API.
- `packages/core/src/lower.ts` — `lower(program: AnalyzedProgram): IRModule`.
  - Fresh temp ids `__t1`, `__t2`, … assigned in node-creation order.
  - Locals resolve to their initializer's node id via an env map; no node is created for a
    bare `ref`.
  - `and`/`or` desugar to `select` per spec: `a and b → select(a, b, 0)`,
    `a or b → select(a, a, b)`. The literal-`0` node is memoized and shared across every
    desugared `and` in a module.
  - `select` (analyze's mux placeholder) lowers straight through, recursing on `cond`/`then`/`else`.
- `packages/core/src/lower.test.ts` — parse → analyze → lower snapshot/deep-equal tests:
  adder (binop), comparison (cmp), `and`, `or`, shared-literal-0 reuse across two `and`s,
  nested clamp-style `and`/`or`, and multi-output with a shared sub-expression.
- Re-exported `IRModule`, `IRNode`, `lower` from `packages/core/src/index.ts`.
- `biome.json`: scoped override to disable `lint/suspicious/noThenProperty` for the three
  new files, since the design's `select` node requires literal `then`/`else` field names
  (plain data, never awaited).

## Verification

- `pnpm test` — 32/32 passed (6 files).
- `pnpm typecheck` — clean (`tsc -b --pretty false`).
- `pnpm lint` — clean (`biome check .`; only a pre-existing deprecation info, no errors).
- `pnpm build` — clean (`tsc -b`).

## Notes / deviations

- None from the spec/plan. Optimization (#7) and combinator emission (#8) are untouched,
  as required.
- Did not sync the GitHub Project board per explicit instruction.

## Commit

`feat(core): add IR types and lowering`
