# Next Language / IR Slices (Emit Size + Interop Hooks)

**Date:** 2026-07-23  
**Status:** P0–P2 landed on main (integration); language roadmap issues filed  
**Issues:** #38 (SR), #46/`each_latch`, #47/`signal_at`, #39–#41 interop; language track #65–#73

## Context

After #32/#33/#35–#37, Factorio emit tricks for the **current** Lua surface are largely squeezed. Further size wins need new IR (sometimes with a little syntax). Interop (#40/#41) needs a richer wire model; selector (#39) needs an IR use that is not “mux”.

## Ranking

| Priority | Slice | Unlocks | Depends |
|---|---|---|---|
| **P0** | **Cookbook SR** — independent set & reset | One-decider latch; closes #33 deferral | Emit + tiny builtin/syntax |
| **P1** | **Multi-signal channels / bundles** | EACH packing, fewer latches per channel; feeds #40 | IR bundle type; later colors |
| **P2** | **Rank / index / pick-by-N** | Honest **selector** emit (#39) | Bundle or multi-signal bag |
| P3 | `elseif`, richer if bodies | Ergonomics only (nested if already rejected) | [#65](https://github.com/lexwebb/LuaTorio/issues/65) |
| P3 | User `function` (v3) | Inlining / reuse | [#67](https://github.com/lexwebb/LuaTorio/issues/67) / [#68](https://github.com/lexwebb/LuaTorio/issues/68) |

### Why not selector or red/green first?

- **Selector** is index/filter, not if/else. Emitting it without rank/index IR is speculative.
- **Red/green** is fidelity/interop. Do it with #41 (undirected nets), not as a size chase on green-only programs.

## P0 — SR latch (ship in #38)

### Semantics (circuit truthiness: 0 = false)

\[
Q' = (Q \lor S) \land \lnot R
\]

Reset wins when both S and R are high. Output is **0 or 1** (constant-1 when set/hold).

### Surface

Builtin call (preferred over and/or soup — `r and 0 or …` is a footgun under circuit 0-falsy):

```lua
local q = 0
local s = input("signal-S")
local r = input("signal-R")
q = sr(q, s, r)
output("signal-Q", q)
```

Rules:

- `sr(state, set, reset)` only as the RHS of an assignment to the **same** local as `state`
- That local must be a memory cell (initialized `local q = …`)
- Args are integer expressions (signals / cmps / arith)

### IR

```ts
{ kind: "sr"; id: string; state: string; set: string; reset: string }
```

`store(cell, srId)` with `sr.state === memory.id` fuses into one decider latch.

### Emit (Factorio 2.0 decider, AND-before-OR)

Distribute \((Q \lor S) \land \lnot R\):

```
Q ≠ 0  AND  R = 0
OR
S ≠ 0  AND  R = 0
→ output constant 1 on Q
```

Plus Q feedback wire; nonzero init via existing latch seed.

**Expected size:** correct and/or idiom today ~7 blueprint combinators → **1** logic latch (+ I/O pads stripped at emit).

### Acceptance for P0

- [x] `sr` analyzed / lowered / referenced
- [x] Emit one decider latch; fuzz + hand sim (set then hold then reset)
- [x] Example `examples/sr_latch.lua` + golden
- [x] README note + safe-idiom warning for raw and/or

## P1 — Channels / `each_latch` (#46)

First ship: **`each_latch`** — multi-signal EACH-tag hysteresis bag (circuit primitive). Design: `2026-07-23-each-latch-design.md`. Research: `2026-07-23-each-tag-catalog-research.md`.

- Bridge to tables: **first-class bag-typed values** — [#66](https://github.com/lexwebb/LuaTorio/issues/66).
- Cookbook bag ops (arith / filters / hold / wildcards): [#58](https://github.com/lexwebb/LuaTorio/issues/58)–[#62](https://github.com/lexwebb/LuaTorio/issues/62).
- Later: general bundle / EACH packing memory for denser loops.

## P2 — Rank / index (#47)

`signal_at` / `signal_at_asc` — design `2026-07-23-signal-at-design.md`. Honest selector `select` emit (not mux).

Constant-table → rank → remap pipelines stay **composed** from primitives (`signal_at_asc` + constants/selectors); no domain-named builtins. Priority **value** pick: `examples/signal_at_asc.lua`.

## Language roadmap (toward tables and beyond)

Suggested order (emit density first, then Lua surface growth):

```text
#66 first-class bags ─┬─► #58/#59/#60 bag ops
                      └─► #69/#70 v4 tables
#65 elseif / nested if          (independent ergonomics)
#67 → #68 v3 functions ──► #71 v4 recursion
#72 → #73 v5 place()            (after circuit surface stabilizes)
```

| Issue | Topic |
|-------|--------|
| [#65](https://github.com/lexwebb/LuaTorio/issues/65) | `elseif` + nested if |
| [#66](https://github.com/lexwebb/LuaTorio/issues/66) | First-class bag-typed values |
| [#67](https://github.com/lexwebb/LuaTorio/issues/67) | v3 design — functions (no recursion) |
| [#68](https://github.com/lexwebb/LuaTorio/issues/68) | v3 implement functions |
| [#69](https://github.com/lexwebb/LuaTorio/issues/69) | v4 design — tables as bags |
| [#70](https://github.com/lexwebb/LuaTorio/issues/70) | v4 table constructors + field access |
| [#71](https://github.com/lexwebb/LuaTorio/issues/71) | v4 recursive functions |
| [#72](https://github.com/lexwebb/LuaTorio/issues/72) | v5 design — `place()` |
| [#73](https://github.com/lexwebb/LuaTorio/issues/73) | v5 implement `place()` |

Cookbook emit backlog (not language surface): [#57](https://github.com/lexwebb/LuaTorio/issues/57)–[#63](https://github.com/lexwebb/LuaTorio/issues/63).

## Tracking

| Track | Issue | Notes |
|---|---|---|
| SR / channels / rank | #38 → #46 / #47 | Landed (each_latch, signal_at, loop clocks) |
| Cookbook rip + ir-match | #52 / #54 | Landed |
| Foreign BP + undirected nets | #41 | Done |
| Red/green split | #40 | Done |
| Selector VM | #39 | Done |
| Language roadmap | **#65–#73** | Bags → tables; v3 functions; v5 place |
