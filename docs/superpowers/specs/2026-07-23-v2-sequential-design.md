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

## Phase 2 (`if` / `else` next-state)

Bare `if`/`else` muxes next-state stores. Still one `store` per memory cell; the store value is a `select`.

```lua
local x = 0
local c = input("signal-C")
if c then
  x = x + 1
else
  x = x - 1
end
output("signal-A", x)
```

### Rules

1. `if cond then … end` and `if cond then … else … end` only (no `elseif`; no nested `if`).
2. Branch bodies may contain **only** assignments to already-declared locals (no `local`, `output()`, loops, nested `if`).
3. Each assigned name counts as that variable’s **one** next-state site (same phase-1 rule: no second top-level assign or second `if` writing the same cell).
4. Per cell, the next value is:
   - both branches assign → `select(cond, thenVal, elseVal)`
   - then only → `select(cond, thenVal, memory)` (hold when false)
   - else only → `select(cond, memory, elseVal)` (hold when true)
5. A variable assigned only inside `if` is still promoted to a memory cell (init from its `local`).

## Phase 3 (`tick` + `while` / `for`)

Clocked loops desugar onto the existing flat IR — **no CFG / `phi`**. One Factorio game tick = one loop iteration. `tick()` is a required syntactic barrier at the end of the loop body (no IR node).

```lua
local i = 0
local lim = input("signal-L")
while i < lim do
  i = i + 1
  tick()
end
output("signal-A", i)
```

```lua
local sum = 0
for i = 1, 10 do
  sum = sum + i
  tick()
end
output("signal-A", sum)
```

### Rules

1. At most **one** top-level `while` or numeric `for` per program (no nesting, no `repeat`).
2. Loop body last statement must be `tick()` with no args (exactly one).
3. Body may contain assignments and phase-2 `if`/`else` only (same body restrictions as phase 2).
4. Clocked program shape: `local*` → one loop → `output*` only. Free-running top-level assigns/`if` stores cannot mix with a loop.
5. Numeric `for name = start, stop do` only; optional step must be literal `1`. Induction var is declared by the `for` and not assignable in the body.
6. Programs with no loop remain **free-running** (phase 1–2 unchanged).

### Desugar (while)

Synthetic memory cell `__run` (init `1`):

- `enable = select(__run, cond, 0)`
- Each body cell: `store(cell, select(enable, bodyNext, mem))` (hold when not enabled)
- `__run' = select(__run, select(cond, 1, 0), 0)` (sticky exit)

### Desugar (`for i = lo, hi`)

- `local i = lo` (memory); `cond ≡ i <= hi`
- On enable: body stores, then `i' = i + 1`
- Same `__run` / enable wrapping as while

### Rejected

`tick()` outside loop / not last / with args; loop without `tick()`; nested or second loop; generic `for`; step ≠ 1; assign to for-var; mixing free-running stores with a loop; `break`; `repeat`.

## Testing

- Unit: mux expands to two deciders; assign analyze; memory IR shape; layout accepts latch cycles
- Golden: `examples/counter.lua`, hold/accumulator programs → blueprint JSON snapshots
- Existing v1 goldens must stay green (mux fidelity may update snapshots intentionally)

## Tracking

GitHub milestone `v2`, project [LuaTorio](https://github.com/users/lexwebb/projects/1). Issues map 1:1 to the implementation plan tasks.
