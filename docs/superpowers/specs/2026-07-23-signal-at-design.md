# `signal_at` / rank design (#47)

**Date:** 2026-07-23  
**Status:** Implemented  
**Issue:** #47  
**Related:** #39 selector VM, #46 `each_latch`, EACH-tag research

## Goal

Honest Factorio **selector `select`** emit for “Nth by value” — not if/else mux. A circuit primitive for rank/index; domain priority tables compose on top.

## Surface

```lua
-- Descending (largest first): index 0 = max
local top = signal_at(0, a, b, c)
output("signal-N", top)

-- Ascending (smallest first): index 0 = min
local best = signal_at_asc(0, p1, p2, p3)
output("signal-N", best)
```

Rules:

- First arg: integer literal index `≥ 0`
- Remaining args: ≥1 scalar expressions (same shape as `signal_count`)
- Result is a **scalar**: count of the picked signal, renamed onto the result wire (SSA-friendly)
- Optional later: single bag arg for named pass-through (identity-preserving)

## IR

```ts
{
  kind: "signal_at";
  id: string;
  index: number;
  ascending: boolean; // true → select_max: false
  args: string[];
}
```

## Emit

One `selector-combinator`:

```json
{
  "operation": "select",
  "index_constant": <index>,
  "select_max": true | false
}
```

Green wires from each arg. Selector pass-through keeps the winner’s **temp signal name**; the output port’s legacy single-signal rename yields the count on the user output signal (same pattern as other SSA edges).

**Size:** 1 combinator (vs decider sort networks).

## vs `each_latch`

| | `each_latch` | `signal_at` |
|--|-----------------|-------------|
| Job | Sticky multi-signal hysteresis | Rank/index pick |
| Size | 2 (const + decider) | 1 (selector) |
| State | Red feedback latch | Combinational |
| Extensibility | OR-stack grows with N | Add args / edit constants upstream |

## Composition (not new builtins)

Deficit → priority → `signal_at_asc(0, …)` → constant remap is **composed** from primitives + constants. This slice ships the rank primitive + `examples/signal_at_asc.lua`.

## Acceptance

- [x] This design note
- [x] analyze → IR → emit → sim
- [x] Example + golden (`signal_at.lua`, `signal_at_asc.lua`)
- [x] Priority-rank example without domain-named builtins
- [x] No selector-as-mux
