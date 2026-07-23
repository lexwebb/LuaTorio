# `each_latch` design (#46)

**Date:** 2026-07-23  
**Status:** Implemented  
**Issue:** #46  
**Research:** `2026-07-23-each-tag-catalog-research.md` (Reddit foundry write-up — domain inspiration only)

## Goal

General circuit primitive: sticky multi-signal hysteresis via Factorio 2.0 **EACH-tag filtering** — **1 constant + 1 decider**, not an O(N) `cmp`/`select`/`sr` tree.

Language builtins name **circuit ops**, not domain jobs (no `recipe_*` / foundry APIs). Domain uses belong in examples/comments.

## Surface (no v4 tables)

Variadic triples — level expression, emit signal name, high watermark:

```lua
local level_a = input("level-A")
local level_b = input("level-B")
local bag = each_latch(
  level_a, "signal-A", 10,
  level_b, "signal-B", 10
)
output("signal-A", bag)
output("signal-B", bag)
```

Rules:

- ≥1 triple; arg count divisible by 3
- Signal arg: string literal (Factorio signal name)
- High arg: integer numeric literal `> 0`
- Tags auto-assigned `1..N` (unique)
- `each_latch(...)` only as `local` initializer
- That local is **not** reassignable; only usable as `output(...)` expr (wire handle)
- Sticky state lives in the combinator (red feedback), not in a Lua memory cell

## Semantics (per channel, AND-before-OR)

\[
\begin{align*}
\mathrm{set}_i &= (\mathrm{level}_i = 0) \\
\mathrm{hold}_i &= (\mathrm{level}_i < \mathrm{high}_i) \land (\mathrm{signal}_i^{\mathrm{red}} > 0) \\
\mathrm{emit}_i &= (\mathrm{set}_i \lor \mathrm{hold}_i) \land (\mathrm{EACH}^{\mathrm{green}} = \mathrm{tag}_i)
\end{align*}
\]

Output `EACH` constant 1 for each activating signal. When multiple levels are 0, multiple signals may emit (no mutex in v1).

## IR

```ts
{
  kind: "each_latch";
  id: string;
  entries: Array<{ level: string; signal: string; buffer: number; tag: number }>;
}
```

(`buffer` in IR = surface `high`.)

## Emit

| Entity | Role |
|--------|------|
| `${id}__tags` constant | Green tag table: each `signal → tag` |
| `id` decider (`role: "latch"`) | Multi-OR set/hold; output `EACH` = 1 |

Wires: tags → decider **green**; levels → decider **red**; decider ↔ decider **red**; decider → outputs **green**.

## Primitive family (target shape)

| Builtin | Circuit job |
|---------|-------------|
| `sr` | Independent set/reset latch |
| `each_latch` | Multi-channel EACH-tag hysteresis bag |
| `signal_count` | Count present signals |
| `signal_at` / `signal_at_asc` | Rank/index pick (selector `select`) |

Domain pipelines (foundry recipes, ammo, etc.) = **composition** of these + constants, not new builtins.

## Acceptance

- [x] This design note
- [x] analyze → IR → emit → sim for 2 entries
- [x] `stats.combinators === 2`
- [x] Example + golden + set/hold/clear sim
- [x] README row (circuit-primitive framing)
