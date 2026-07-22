# Semantic Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `analyze(ast): AnalyzedProgram` enforcing v1 language rules (issue #5).

**Architecture:** Walk luaparse `Chunk` / statements / expressions; build a small typed AST for allowed constructs; throw `SemanticError` with line/column and planned version for rejects.

**Tech Stack:** Existing `@luatorio/core`, Vitest, luaparse types

**Spec:** `docs/superpowers/specs/2026-07-22-semantic-analyzer-design.md`

## Global Constraints

- Allow only v1 constructs from parent design
- Reject with `(planned for vN)` where applicable
- Require ≥1 `output()`; SSA locals; string-literal signal names
- Reject floats in v1
- Do not implement IR/emitter; `compile()` may stay stub
- Sync GitHub project on finish (#5 → Done)
- pnpm / Biome / existing package layout

---

### Task 1: SemanticError + analyze() with tests

**Files:**
- Create: `packages/core/src/analyze.ts`
- Create: `packages/core/src/analyze.test.ts`
- Modify: `packages/core/src/index.ts` (re-export)

**Produces:**
- `SemanticError`, `analyze`, `AnalyzedProgram` and expr/statement unions

Implement with TDD. Cover:
1. Valid clamp-style program succeeds and records inputs/outputs
2. `while` → SemanticError planned for v2
3. `function` → v3
4. table constructor → v4
5. reassignment / redeclare local → v2
6. `input(x)` non-literal → error
7. no output → error
8. float literal → error

Use AST `loc?.start.line/column` (1-based line; column as luaparse provides).

Analyzed expr kinds (minimum):
`literal` | `input` | `ref` | `binop` | `cmp` | `select` | `logical`

Map luaparse `IfStatement` used as expression carefully — v1 allows `if a then b else c` as expression; in Lua that's typically not a statement form for values. In Lua, if is a statement. The design says `if a then b else c` expression form — in real Lua this isn't an expression. Check how luaparse represents things...

**Important domain note:** In Lua, `if` is a statement, not an expression. The design example uses `and`/`or` ternary idiom for mux. For `if` "expression form", accept only if we find a pattern, OR accept `IfStatement` as invalid for value context and allow `and`/`or` for ternaries. Prefer: allow `LogicalExpression` for and/or; if user writes `if` statement that's not just control in a way we support, reject as planned for v2 unless it's a single if/else returning via ... actually v1 table says `if a then b else c` yes as expression form.

Looking at Lua — there is no if-expression. The parent design may mean the idiomatic use or a future extension. **Autonomous decision:** treat `IfStatement` as unsupported in v1 statement list for now (or allow as statement that doesn't produce value — but then unused). Better: **reject bare `IfStatement` as planned for v2** (sequential), and rely on `and`/`or` for mux per the clamp example. Document this in a code comment. If tests in issue require if-expression, map `IfStatement` with then+else single return-ish — but Lua if can't return values without assignment.

Actually re-read: `| `if a then b else c` | yes | Expression form; mux via decider |` — they want expression form. Some Lua dialects don't have it. Could mean they want us to accept a custom pattern. Simplest autonomous path: support `and`/`or` LogicalExpression for mux; if someone writes if-statement, reject with helpful message "use and/or ternary idiom in v1; if statements planned for v2".

- [ ] Implement analyze module + tests + exports
- [ ] `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
- [ ] Commit `feat(core): add v1 semantic analyzer`
- [ ] Sync #5 Done and close

---

## Execution

Single-task plan (whole feature). Implementer may split commits if useful.
