# v2 Sequential Logic Design

**Date:** 2026-07-23  
**Status:** Approved  
**Milestone:** `v2`  
**Parent:** [LuaTorio Design Spec](./2026-07-22-luatorio-design.md)

## Summary

v2 adds sequential logic to LuaTorio: variables that persist across Factorio game ticks via **memory cells** (latches), then control flow and an explicit `tick()` scheduler. Delivery is **phased** so latches ship before the FSM.

## Locked decisions

| Choice | Decision |
|---|---|
| Delivery | Phased (memory → `if` stores → `while`/`for` + `tick()`) |
| Phase 1 clock | Implicit: Factorio evaluates circuits every game tick |
| Phase 1 assign | One next-state assignment per memory variable |
| Unreassigned locals | Remain combinational SSA (v1) |
| Mux | Faithful two-decider `select` before latch work |
| Wires | Green only (red/green allocation still v4) |
| Pipeline | Unchanged stage list; IR remains the contract |

## Phase map

| Phase | Language | Circuits / IR |
|---|---|---|
| **1** | Reassignment (single next-state per var) | `memory` / `store`; latch + feedback; cycle-aware layout; fix `select` mux |
| **2** | `if` / `else` over next-state | Gated / branching stores |
| **3** | `while` / `for` + explicit `tick()` | CFG, tick scheduler FSM |

## Phase 1 language

```lua
-- Free-running accumulator: each game tick, x := x + signal-A
local x = 0
x = x + input("signal-A")
output("signal-B", x)
```

### Rules

1. `local x = init` declares a binding (combinational until reassigned).
2. `x = next` (after `local`) promotes `x` to a **memory cell**. RHS reads of `x` see the **held previous-tick** value. The assignment is the **next-state** function.
3. At most **one** next-state assignment per variable (second assign → `SemanticError`).
4. Still reject: `if`/`while`/`for`/`repeat`, `function`, tables, `tick()` (phase 2/3; keep `planned for v2` / later messaging).
5. At least one `output()` remains required.

### Non-goals (phase 1)

- Explicit `tick()`, loops, bare `if` statements
- CFG / `phi` nodes
- Multi-assign within one tick (SSA chain of reassigns)
- Red/green wire splitting

## IR

Extend [`packages/core/src/ir.ts`](../../../packages/core/src/ir.ts):

```typescript
| { kind: "memory"; id: string; cell: string; init: string }
| { kind: "store";  id: string; cell: string; value: string }
```

- `memory.id` is the temp signal carrying the **current** latched value.
- `memory.init` is the seed node id (from `local`).
- `store` ties next-state `value` to the same `cell` key.
- Module stays a **flat** node list (no basic blocks yet). Feedback edges appear in the **combinator** graph.

## Combinator lowering

### Faithful `select` (prerequisite)

One logical mux → **two** decider entities sharing output signal `id`:

- Then: `cond > 0` → copy `then` onto `id`
- Else: `cond ≤ 0` (or `cond = 0` with care for negative) → copy `else` onto `id`

Wire both deciders' outputs together under `id`; consumers read that signal.

### Latch (per memory cell)

Phase 1 enable is always true (every tick updates):

1. Hold previous value on the memory signal (feedback).
2. Drive next value from `store.value` (mux or arithmetic feedback consistent with Factorio 2.0 `control_behavior`).

Concrete shape: treat the memory entity as the cycle break point; wire `store` producers into the latch and feedback the latch output to readers and (as needed) back into the hold path.

## Layout

[`layout.ts`](../../../packages/core/src/layout.ts) today throws on any cycle. Phase 1:

- Identify latch / memory entities as **cycle break** nodes.
- Topo-sort the combinational shell (feedback edges ignored for ordering).
- Place entities deterministically left-to-right; keep emitting green Factorio 2.0 wire tuples including feedback edges.

## Analyze / lower / optimize

| Stage | Change |
|---|---|
| Analyze | Allow `AssignmentStatement` to declared locals; track `reassigned`; reject 2nd assign; reject loops/`if`/`tick` |
| Lower | Emit `memory`+`store` for reassigned names; env refs resolve to `memory.id` |
| Optimize | Exhaustive switches for new kinds; **do not** fold across `memory`/`store` |

## Phase 2 sketch (`if`)

Bare `if`/`else` gates next-state stores (write-enable from condition). Still no loops. May introduce multiple stores per cell with mutually exclusive enables, or a single muxed next-value.

## Phase 3 sketch (`tick` + loops)

- Builtin `tick()` marks an explicit clock barrier / scheduler step.
- `while` / `for` lower to a CFG / FSM: one iteration (or one state transition) per `tick()`.
- IR grows `phi` / block structure as in the parent design.

## Testing

- Unit: mux expands to two deciders; assign analyze; memory IR shape; layout accepts latch cycles
- Golden: `examples/counter.lua`, hold/accumulator programs → blueprint JSON snapshots
- Existing v1 goldens must stay green (mux fidelity may update snapshots intentionally)

## Tracking

GitHub milestone `v2`, project [LuaTorio](https://github.com/users/lexwebb/projects/1). Issues map 1:1 to the implementation plan tasks.
