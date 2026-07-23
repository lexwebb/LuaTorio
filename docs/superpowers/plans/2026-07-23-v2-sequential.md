# v2 Sequential Logic Implementation Plan

> **For agentic workers:** Implement task-by-task. Checkboxes track progress. Sync GitHub Project on start/finish of each issue.

**Goal:** Ship v2 phase 1 — reassignment as memory cells with implicit per-tick update — after cutting the full milestone board (phases 2–3 issues stay Todo).

**Architecture:** Extend IR with `memory`/`store`; fix `select` mux to two deciders; lower latches with feedback wires; cycle-aware layout. Pipeline stages unchanged.

**Tech Stack:** `@luatorio/core`, Vitest, existing Factorio 2.0 blueprint emit

**Spec:** `docs/superpowers/specs/2026-07-23-v2-sequential-design.md`

## Global Constraints

- Phase 1 only in code until phase 2/3 issues are started
- One next-state assignment per memory variable
- Do not fold optimizations across memory
- Green wire only
- Sync project Status (Todo / In Progress / Done) per `.cursor/skills/github-project-sync/SKILL.md`
- Keep v1 programs compiling; update golden snapshots when mux/latch output intentionally changes

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/core/src/ir.ts` | Add `memory` / `store` node kinds |
| `packages/core/src/analyze.ts` | Allow single reassignment; track reassigned set |
| `packages/core/src/lower.ts` | Emit memory+store; env → memory id |
| `packages/core/src/optimize.ts` | Opaque memory/store in fold/CSE/DCE |
| `packages/core/src/combinators.ts` | Two-decider mux; latch entities + feedback |
| `packages/core/src/layout.ts` | Cycle break at latch/memory entities |
| `packages/core/src/*.test.ts` | Unit coverage |
| `examples/counter.lua` (etc.) | Golden inputs |
| `README.md` | Phase 1 language notes |

---

### Task 1: Design docs

**Files:** this plan + `docs/superpowers/specs/2026-07-23-v2-sequential-design.md`

- [ ] Spec + plan committed / present in repo
- [ ] Linked from README roadmap if needed

---

### Task 2: Faithful `select` mux lowering

**Files:** `combinators.ts`, `combinators.test.ts` (+ golden snapshot updates)

- [ ] Expand each `select` into two decider entities sharing output signal
- [ ] Wire cond/then/else into both; consumers still use logical node id as signal name
- [ ] Update unit + golden tests

---

### Task 3: IR `memory` / `store`

**Files:** `ir.ts` (+ type exports used by lower/optimize/combinators)

- [ ] Add node kinds with `cell`, `init` / `value` fields
- [ ] Document that feedback is at combinator layer

---

### Task 4: Semantic reassignment gate

**Files:** `analyze.ts`, `analyze.test.ts`

- [ ] `AnalyzedStatement` includes `{ kind: "assign"; name; expr; ... }`
- [ ] Allow assign to declared local once; reject second; reject undeclared
- [ ] Keep rejecting while/for/if; `tick()` → clear planned message
- [ ] Update tests that expected assign to always fail

---

### Task 5: Lower + optimize for memory

**Files:** `lower.ts`, `optimize.ts`, tests

- [ ] Locals that are later assigned → `memory` with init; assign → `store`
- [ ] Refs to memory vars resolve to `memory.id`
- [ ] Optimize: no fold through memory/store; CSE/DCE/childIds exhaustive

---

### Task 6: Combinator latch + feedback wires

**Files:** `combinators.ts`, tests

- [ ] Lower `memory`/`store` to latch entities with feedback `WireEdge`s
- [ ] Enable always-on for phase 1 (every tick)

---

### Task 7: Cycle-aware layout

**Files:** `layout.ts`, `layout.test.ts`

- [ ] Break cycles at latch/memory entities for topo order
- [ ] Still emit feedback wires in laid-out output
- [ ] Deterministic placement

---

### Task 8: Golden examples + tests

**Files:** `examples/counter.lua`, optional hold/accumulator; `golden.test.ts`

- [ ] At least one sequential example compiles end-to-end
- [ ] Snapshots updated and reviewed

---

### Task 9: README / language reference

**Files:** `README.md`

- [ ] Document phase 1 reassignment / memory semantics
- [ ] Point at v2 design spec; note loops/`tick()` still upcoming

---

### Task 10 (phase 2): `if`/`else` control-flow stores (issue #27)

**Files:** `analyze.ts`, `lower.ts`, tests, `examples/`, README, design spec phase-2 section

- [ ] Spec: muxed next-state via `select` (hold when branch omits assign)
- [ ] Analyze: allow if/else; bodies = assignments only; no elseif/nested if
- [ ] Lower: one `store` per cell with `select(cond, then, else|hold)`
- [ ] Example + golden + README; close #27

---

### Task 11 (phase 3): `tick()` + while/for FSM (issue #28)

**Files:** `analyze.ts`, `lower.ts`, tests, `examples/`, README, design spec phase-3 section

- [x] Spec: desugar to `__run` + enable-gated stores (no CFG/phi)
- [x] Analyze: one top-level while/for; body ends with `tick()`; clocked vs free-running mode
- [x] Lower: `__run` latch; `enable = select(__run, cond, 0)`; wrap body stores
- [x] Examples `while_count.lua` / `for_sum.lua` + golden + README; close #28
