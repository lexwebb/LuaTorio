# Factorio circuit capabilities → LuaTorio #32 re-ground

**Date:** 2026-07-23  
**Status:** Research note (wiki + runtime docs + cookbook)  
**Issue:** #32  

## Sources

| Source | What we took |
|--------|----------------|
| [Circuit network](https://wiki.factorio.com/Circuit_network) | Wires, int32 wrap, red≠green, combinator overview |
| [Decider combinator](https://wiki.factorio.com/Decider_combinator) | Multi-condition AND/OR, multi-output, **else outputs**, EACH/ANY/EVERYTHING, red/green per operand, 1-tick delay |
| [Arithmetic combinator](https://wiki.factorio.com/Arithmetic_combinator) | Ops (+ − * / % ^ << >> & \| xor), EACH, red/green per operand |
| [Constant combinator](https://wiki.factorio.com/Constant_combinator) | Multi-signal output, logistic groups (2.0), no power |
| [Selector combinator](https://wiki.factorio.com/Selector_combinator) | Sort/index, count, random, stack size, rocket capacity, quality, time |
| [FFF-384](https://www.factorio.com/blog/post/fff-384) | Design intent for decider 2.0 + selector |
| [Runtime: DeciderCombinatorParameters](https://lua-api.factorio.com/latest/concepts/DeciderCombinatorParameters.html) | Blueprint fields: `conditions`, `outputs`, **`else_outputs`** |
| [Cookbook / Combinator tutorial](https://wiki.factorio.com/Tutorial:Combinator_tutorial) | Memory cells, SR/RS latches, clocks, EACH packing |

## Capability map (what Factorio can do)

### Wires & values

- Red and green are **separate** networks; same color merges (sums) at junctions.
- Devices that read “the circuit” usually **sum red+green** unless a combinator selects wires per operand.
- Values are **signed int32**, wrap on overflow.
- Absent signal ≡ **0**.

### Timing

- Every combinator (arith + decider + selector) has **1 tick** of latency before its output is visible on the wire.
- LuaTorio’s VM is **latch-synchronous** (only `role: "latch"` delayed) on purpose so desugared loops work; full Factorio delay is stricter.

### Constant combinator

- Emits configured signals continuously; can be toggled in GUI.
- 2.0: configured via **logistic groups** (min value emitted).
- No electricity required.

### Arithmetic combinator

| Feature | Notes |
|---------|--------|
| Ops | `+ − * / %` exponent, `<< >>`, bitwise `& \| xor` |
| EACH | One operand may be EACH; output EACH (map) or single signal (sum of per-signal results) |
| Wire select | Per operand: red, green, or both (sum) |
| Feedback | Output→input is a separate tick; used for clocks / `EACH+0` one-way copy |

### Decider combinator (2.0) — highest leverage for us

| Feature | Notes |
|---------|--------|
| Conditions | List of compares; adjacent join is **AND or OR**; **AND binds tighter than OR** |
| Outputs | **List** of outputs when condition true |
| **Else outputs** | **List** of outputs when condition **false** (runtime: `else_outputs`) |
| Output value | Constant (configurable since 2.0.36) or **copy count from input** |
| Copy semantics | Copy uses the **output signal’s** count on the selected input wires (no separate “copy from signal X onto Y” field) |
| Wire select | Per condition operand + per output copy |
| Wildcards | **Everything / Anything / Each** with special input/output rules (see wiki table) |
| EACH + else | With Each in conditions, each signal activates **either** normal **or** else outputs |

### Selector combinator — narrower than we assumed

Modes (wiki): **select input** (sort + index), **count inputs**, **random**, **stack size**, **rocket capacity**, **quality filter/transfer**, **time** (T/L/D).

It is **not** a general if/else mux for two arbitrary values. It is for ranking/indexing/filtering a **bag of signals**. Useful later for channel packing / “pick Nth signal”; **wrong primary tool** for Lua `a and b or c` / `if` mux.

### Cookbook patterns we care about

- **Memory:** decider self-loop (input count, condition ≠0 or >0) holds a value; arith `EACH+0` loop is the classic register.
- **SR / RS latch:** cookbook says **one decider** can do SR in 2.0 with multi-condition set/reset.
- **Clocks / pulses / edge detect:** feedback + 1-tick delay; less relevant to our SSA-style emit today.

## What LuaTorio uses today

| Capability | Used? |
|------------|--------|
| Single-condition decider | Yes (cmp, gates, const-when) |
| Two-condition **AND** | Rare (`select(c, bool, 0)`) |
| **OR** conditions | No (VM rejects) |
| **Multiple outputs** | No (always one) |
| **`else_outputs`** | **No — biggest miss** |
| Red/green per operand | No (single green bag) |
| EACH / ANY / EVERYTHING | No |
| Arith EACH | No |
| Bitwise / shifts / pow | No (IR ops are Lua arith/cmp subset) |
| Selector | No |
| Incremental enable-hold (`mem+δ`) | Yes (landed) |
| Full mux | Then-gate + else-gate + arith merge (3) |
| Gate + rename | Decider + arith `+0` (2) |

## Re-grounded #32 priority

Previous backlog overweighted **selector-as-mux**. Wiki says selector is index/filter, not if/else. Re-rank:

### P0 — Decider `else_outputs` for mux / enable-hold

**Why:** Official wiki + runtime API. One decider can emit “then” outputs when cond holds and “else” outputs when not — replaces **two mux-side gates**.

**Realistic savings:**

| Pattern today | With else_outputs | Save |
|---------------|-------------------|------|
| Full mux (gate+gate+merge) | 1 decider + merge (rename still needed) | **−1** |
| Enable-hold (gate+gate+latch) | 1 decider + latch | **−1** |
| `select(c, lit, 0)` | Already 1 | 0 |
| Incremental `mem+δ` hold | Already 2 | 0 (optional polish) |

**Blockers:** Extend VM `evalDecider` for `else_outputs`; fuzz; emit shape; goldens.

**Rename caveat:** `copy_count_from_input` copies the **output signal’s** input count. Mapping branch signal `T` onto result id `R` still needs rename (arith `+0`) or IR identity / EACH tricks. So **3→1 general mux is not free**; **3→2** is the honest first win.

### P1 — Multi-output + OR conditions (boolean / multi-write)

- Emit several results from one “conditions passed” event.
- OR of pure predicates without building value muxes.
- Needs VM OR + nested joins (AND precedence).

### P2 — Single-decider SR / EACH memory (cookbook)

- Cookbook: SR latch in **one** decider in 2.0.
- EACH packing for multi-channel cells (v4-ish).
- Higher risk; prove per pattern with fuzz.

### P3 — Drop empty I/O placeholders

- Still ~30% of entity count; not “logic,” but blueprint clutter / stats.
- Sim can keep markers; emit omits or stats exclude.

### P4 — Selector combinator (re-scoped)

- Use for **index / sort / count / quality / time**, not primary if/else.
- Revisit when channel packing or “pick signal by rank” appears in IR.

### P5 — Further arith folding / unused ops

- Bitwise/shifts only if language grows them.
- EACH+0 as insulator/rename alternative to arith rename.

## Implications for the VM

Update `docs/superpowers/specs/2026-07-23-circuit-sim-fuzz-design.md` backlog mentally:

1. **`else_outputs`** (before selector)
2. `compare_type: "or"` (+ document AND precedence)
3. Multiple outputs (already partially looped in eval)
4. EACH/ANY/EVERYTHING when emit needs them
5. Selector entity kind when P4 work starts
6. Optional: red/green split (only if emit stops summing)

## Acceptance check for next implement pass

- [x] VM: `else_outputs` when conditions fail
- [x] Emit: general `select` → one decider (then outs + else outs) + merge if rename required
- [x] Emit: non-incremental enable-hold → one decider + latch
- [x] Fuzz + while_count / for_sum / mux / clamp goldens
- [x] Re-run opt profile; mux/clamp/conditional-counter down (mux 10→9, clamp 13→11, conditional-counter 8→7)
- [x] Emit: fuse sole-use `cmp` into select/const-when/gate/mux deciders (blueprint: clamp 4→3, mux 5→4)
- [x] P1: VM OR + AND-before-OR; boolean `select(a,a,b)` → one OR-decider; shared-cond multi-output mux
- [x] P2: sticky `select(mem, bool, 0)` → one decider latch (when select is sole-use)
- [ ] Follow-up: EACH / ANY / EVERYTHING packing (needs wildcard VM) — not required to close #32
- [ ] Follow-up: full cookbook SR with independent set/reset (no Lua IR shape yet)
