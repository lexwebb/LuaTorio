# IR Lowering Implementation Plan

> **For agentic workers:** Use subagent-driven or direct implementation. Checkboxes for tracking.

**Goal:** IR types + `lower(AnalyzedProgram)` (issue #6).

**Spec:** `docs/superpowers/specs/2026-07-22-ir-lowering-design.md`

## Global Constraints

- IR kinds: literal, input, binop, cmp, select
- Temp ids `__tN`
- Desugar logical → select
- Snapshot tests via parse+analyze+lower
- Export from `@luatorio/core`
- Do not implement optimize/emit

### Task 1

- Create `packages/core/src/ir.ts`, `packages/core/src/lower.ts`, `packages/core/src/lower.test.ts`
- Re-export from index
- Green test/typecheck/lint/build
- Commit `feat(core): add IR types and lowering`
