# Next Language / IR Slices (Emit Size + Interop Hooks)

**Date:** 2026-07-23  
**Status:** P0 done (#38); P1 implementing (#46)  
**Issues:** #38 (SR), #46 (channels / `catalog_latch`), #47 (rank / WarDaft), #39 selector, #40 red/green, #41 blueprint ingest

## Context

After #32/#33/#35–#37, Factorio emit tricks for the **current** Lua surface are largely squeezed. Further size wins need new IR (sometimes with a little syntax). Interop (#40/#41) needs a richer wire model; selector (#39) needs an IR use that is not “mux”.

## Ranking

| Priority | Slice | Unlocks | Depends |
|---|---|---|---|
| **P0** | **Cookbook SR** — independent set & reset | One-decider latch; closes #33 deferral | Emit + tiny builtin/syntax |
| **P1** | **Multi-signal channels / bundles** | EACH packing, fewer latches per channel; feeds #40 | IR bundle type; later colors |
| **P2** | **Rank / index / pick-by-N** | Honest **selector** emit (#39) | Bundle or multi-signal bag |
| P3 | `elseif`, richer if bodies | Ergonomics only (nested if already rejected) | Analyze only |
| P3 | User `function` (v3) | Inlining / reuse | Large; not an emit-size lever first |

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

## P1 — Channels / `catalog_latch` (#46)

First ship: **`catalog_latch`** — multi-signal recipe bag without full v4 tables. Design: `2026-07-23-catalog-latch-design.md`. Research: `2026-07-23-each-tag-catalog-research.md`.

Later: general bundle / EACH packing memory for denser loops.

## P2 — Rank / index (#47)

`signal_at` / `signal_at_asc` — design `2026-07-23-signal-at-design.md`. Honest selector `select` emit (not mux).

WarDaft recipe-table map (second selector over a constant pairing) remains a small follow-up once named bags are ergonomic; priority **value** pick ships in `examples/signal_at_asc.lua`.

## Tracking

| Track | Issue | Board order |
|---|---|---|
| Language / emit size | **#38** | 1 — active |
| Foreign BP + undirected nets | **#41** | 2 — interop |
| Red/green split | **#40** | 3 — with/after #41 |
| Selector | **#39** | 4 — after P2 IR exists |
