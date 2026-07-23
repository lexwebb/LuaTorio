# `catalog_latch` design (#46)

**Date:** 2026-07-23  
**Status:** Implemented  
**Issue:** #46  
**Research:** `2026-07-23-each-tag-catalog-research.md`

## Goal

Compile sticky multi-recipe dispatch to **1 constant + 1 decider** (Factorio 2.0 EACH-tag catalog), not an O(N) tree of `cmp`/`select`/`sr`.

## Surface (no v4 tables)

Variadic triples — stock expression, recipe signal name, buffer literal:

```lua
local item_a = input("item-A")
local item_b = input("item-B")
local recipes = catalog_latch(
  item_a, "recipe-A", 10,
  item_b, "recipe-B", 10
)
output("recipe-A", recipes)
output("recipe-B", recipes)
```

Rules:

- ≥1 triple; arg count divisible by 3
- Recipe arg: string literal (signal name)
- Buffer arg: integer numeric literal `> 0`
- Tags auto-assigned `1..N` (unique)
- `catalog_latch(...)` only as `local` initializer
- That local is **not** reassignable; only usable as `output(...)` expr (wire handle)
- Sticky state lives in the combinator (red feedback), not in a Lua memory cell

## Semantics (per recipe, AND-before-OR)

\[
\begin{align*}
\mathrm{set}_i &= (\mathrm{stock}_i = 0) \\
\mathrm{hold}_i &= (\mathrm{stock}_i < \mathrm{buffer}_i) \land (\mathrm{recipe}_i^{\mathrm{red}} > 0) \\
\mathrm{emit}_i &= (\mathrm{set}_i \lor \mathrm{hold}_i) \land (\mathrm{EACH}^{\mathrm{green}} = \mathrm{tag}_i)
\end{align*}
\]

Output `EACH` constant 1 for each activating recipe signal. When multiple stocks are 0, multiple recipes may emit (same as minimal Reddit shape; no mutex in v1).

## IR

```ts
{
  kind: "catalog_latch";
  id: string;
  entries: Array<{ stock: string; recipe: string; buffer: number; tag: number }>;
}
```

## Emit

| Entity | Role |
|--------|------|
| `${id}__cat` constant | Green catalog: each `recipe → tag` |
| `id` decider (`role: "latch"`) | Multi-OR set/hold; output `EACH` = 1 |

Wires:

- Catalog → decider **green**
- Each stock producer → decider **red**
- Decider → decider **red** (feedback)
- Decider → output pads **green**

Operand networks: inventory/hold tests **red-only**; EACH/tag compares **green-only**.

## Reference interpreter

Bag-valued local: each tick recompute set/hold from stocks + previous held recipes; outputs sample named recipe signals from the bag.

## Acceptance

- [x] This design note
- [x] analyze → IR → emit → sim for 2 entries
- [x] `stats.combinators === 2` (constant + decider; I/O pads omitted per #35 policy when empty)
- [x] Example + golden + set/hold/clear sim
- [x] README row
