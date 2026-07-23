# First-class bag-typed values (#66)

**Date:** 2026-07-23  
**Status:** Implementing (overnight)  
**Issue:** [#66](https://github.com/lexwebb/LuaTorio/issues/66)  
**Depends on:** #46 `each_latch`  
**Enables:** #58–#60 bag ops, #69/#70 tables-as-bags

## Goal

Treat multi-signal **bags** as typed values in analyze/IR — not only as `each_latch` wire handles that may solely feed `output()`.

## Bag vs scalar

| | Scalar | Bag |
|--|--------|-----|
| Meaning | One named signal channel’s integer | Map of signal → count on a wire |
| Producers (v1 of this issue) | `input`, literals, arith, cmp, … | `each_latch` (and later bag ops / table literals) |
| Consumers | arith, cmp, memory, `sr`, `signal_*`, `output(sig, scalar)` | `output(sig, bag)` (sample one channel), bag ops (#58+) |
| Memory | Lua `local` reassignment → enable-hold | Sticky state inside combinator / bag-hold IR — **not** reassigned as a Lua cell |

## Analyze rules

1. Rename mental model: `eachLatchLocals` → **`bagLocals`** (same set; any local whose initializer has bag type).
2. An expression is bag-typed if:
   - `kind === "each_latch"`, or
   - `kind === "ref"` and name ∈ `bagLocals`, or
   - `kind` is a bag-op node (added with #58+: `bag_binop`, `bag_filter`, …).
3. Scalar contexts (`forbidBagInScalar`) reject bag-typed exprs with clear errors.
4. Bag contexts (bag-op args, `output` second arg when sampling) accept bags; reject scalars where a bag is required.
5. Bag locals **cannot be reassigned** (sticky / combinator-owned state).
6. Tables `{ }` remain **v4** — rejected until #69/#70.

## IR representation

Keep `each_latch` as today. Bag values flow as **node ids** whose kind is bag-producing:

```ts
// Existing
{ kind: "each_latch"; id; entries: ... }

// Added with bag ops (#58+), not required for #66 alone:
{ kind: "bag_binop"; id; op; left; right }   // EACH⊗EACH, colored
{ kind: "bag_filter"; id; mode; data; mask } // include/exclude/limit
{ kind: "bag_hold"; id; enable; data }       // cookbook memory cell
```

Until bag ops land, #66’s “bag → op → output” e2e may be satisfied by landing **#58 `bag_binop` `/`** in the same slice (preferred overnight).

Pass-through: a bag local `ref` lowers to the producer node id (already true for `each_latch` → `output`).

## Initial surface (#58)

Keep construction and color allocation explicit, without introducing Lua tables before v4:

```lua
local left = bag_const("signal-A", 10, "signal-B", 15)
local right = bag_const("signal-A", 2, "signal-B", 3)
local result = bag_arith("/", left, right)
output("signal-A", result) -- samples a named channel from the result bag
```

- `bag_const(signal, count, ...)` accepts one or more unique string-literal/integer-literal
  pairs and lowers to one constant-combinator bag.
- `bag_arith(op, left, right)` accepts `+`, `-`, `*`, `/`, or `%` and requires two bag
  expressions. It lowers to `bag_binop`.
- `output(signal, bag)` remains a named-channel boundary sample. The `bag_binop` entity itself
  produces the complete `EACH` bag, so multiple outputs can expose multiple result channels.

## Color / network rules

- Compile path already assigns red/green for `each_latch` (#46) and import (#40).
- Bag pairwise arith (#58): left operand **red-only**, right **green-only**, output EACH (cookbook `1 math`).
- Filters (#59): data red, mask green (cookbook 3–5).
- Scalar Lua programs remain green-default.

## Unblocks v4 tables

Table constructors `{ signal = n, ... }` will lower to **constant bags** (or bag IR) once analyze knows bag type. Field access becomes bag channel sample. Without #66, tables would still be special-cased wire soup.

## Non-goals

- Lua `{ }` syntax (#69/#70)
- Domain-named bag APIs
- General loop-variable bundle memory
- Reassignable bag locals

## Acceptance mapping

| Criterion | Plan |
|-----------|------|
| Design note | This doc |
| Analyze bag vs scalar | `bagLocals` + forbid/require helpers |
| IR for bag values | `each_latch` + bag-op kinds as siblings land |
| E2E bag → op → output | Prefer with #58 `/` |
| Doc unblock tables | Section above + README pointer |
