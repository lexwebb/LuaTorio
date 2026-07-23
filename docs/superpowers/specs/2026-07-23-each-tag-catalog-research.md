# EACH-tag catalog (Reddit / Factorio 2.0) → LuaTorio exploitability

**Date:** 2026-07-23  
**Status:** Research note  
**Source:** [r/factorio — recipe-from-zero inventory](https://www.reddit.com/r/factorio/comments/1ismwzf/) · primary technique by u/thegroundbelowme ([comment](https://www.reddit.com/r/factorio/comments/1ismwzf/comment/mdhwg7t/))  
**Related:** #32 capabilities, #33 EACH, #38 channels, #39 selector, #40 red/green

## What the post is solving

OP wants a foundry to set its recipe from “whatever output is at 0 qty” (e.g. cast iron rods vs cast steel plates) without one decider per recipe and without recipe flicker.

Naive approach: **N deciders** (one per recipe). The clever answer: **1 constant + 1 decider**.

## Core trick (decompose)

Three Factorio 2.0 ideas composed:

### 1. Catalog on green, state/inventory on red

| Wire | Carries |
|------|---------|
| **Green** | Constant combinator: recipe signals with **unique** nonzero tags (`cast-iron-rod = 1`, `cast-steel = 2`, …) |
| **Red** | Chest/belt inventory **plus** decider output fed back to its own input (sticky “current recipe”) |

Colors must stay separate so inventory counts do not collide with recipe tags of the same item name family, and so feedback can be read as “are we already emitting this recipe?”.

### 2. EACH as a tagged pass-through

Decider output = `EACH (1)`.

Every OR-group ends with:

```
… AND EACH (green) = <recipe-signal> (green)
```

Because EACH walks **present green signals**, and the compare is on **values** (not names):

- Unique tags ⇒ only the matching recipe signal passes that AND.
- Duplicate tags ⇒ multiple recipes would fire for one condition (broken).

Author’s gloss: the real predicate is the inventory/latch tests; `EACH = recipe` is a **filter that picks which catalog signal to emit**.

### 3. Multi-OR sticky latch per recipe (same decider)

Per recipe, two AND-groups OR’d:

1. **Set:** `item = 0` ∧ `EACH = recipe`
2. **Hold:** `item < buffer` ∧ `recipe (red) > 0` ∧ `EACH = recipe`

Feedback on red makes `recipe (red) > 0` mean “we are currently selected”. Hitting the buffer clears the hold; set only re-arms at zero (hysteresis / anti-flicker / productivity-friendly batches).

Priority between recipes is encoded by extra “other recipe (red) = 0” terms (mutex across latches), not by separate combinators.

**Entities for N recipes:** still **2** (constant + decider). Conditions grow with N; hardware count does not.

## Sibling patterns in the same thread

| Pattern | Size | Notes |
|---------|------|--------|
| **EACH−EACH deficit** (leonskills / cookbook) | 1 arith (+ optional const) | `each(green targets) − each(red inventory) → each`; positive ⇒ under target. No sticky latch. |
| **WarDaft priority pipeline** | ~2 const + 3 decider + 2 selector + 1 arith | Pair item↔recipe tables; `EACH`/`EACH` filters; **selector index 0** picks highest priority missing; second selector maps item→recipe. Scales by editing constants, not conditions. |
| **Quality remapping** | +1 selector | Uncommon tags in constant → quality-transfer back to normal so recipe≠product collision is avoided. |

WarDaft is the honest **#39 selector** use: rank/index over a bag, not if/else mux.

## What LuaTorio can do today

| Layer | Status |
|-------|--------|
| VM EACH in decider conditions + `EACH` output | Yes (#33) |
| VM AND-before-OR multi-condition | Yes (#32 P1) |
| VM red/green + `*_signal_networks` | Yes (#40) |
| Sticky single-signal latch / `sr` | Yes (#38 P0) |
| Sim of **hand / imported** graphs with this wiring | Yes (proven by fixture below) |
| **Emit** from compiled Lua | **No** — emit stays green-only; no catalog/bundle IR; no “N OR-groups sharing one decider over EACH tags” |

So: we can **simulate and import** this density; we cannot yet **compile** Lua into it.

## Exploitability ranking (for us)

### A — High leverage (aligns with #38 P1 channels)

**EACH-tag catalog + multi-OR emit** for “dispatch on a bag”:

- IR idea: a **bundle** / channel table `{ signal → tag }` plus predicates, lowered to one constant + one decider.
- Language sketch (illustrative, not committed):

  ```lua
  -- general primitive (shipped as each_latch triples, not tables):
  -- each_latch(level, signal, high, ...)
  local bag = each_latch(level_a, "signal-A", 100, level_b, "signal-B", 100)
  ```

- Win vs today’s tree of `cmp`/`select`/`sr`: **O(N) combinators → 2**, for sticky multi-channel picks.
- Language surface stays **circuit-primitive** (`each_latch`); foundry/recipe wiring is an example, not an API.
- Needs: auto or explicit **red/green coloring** on emit (today non-goal of #40 for compiled programs).

### B — Medium (already half-supported)

**Deficit arithmetic** `EACH − EACH` for “targets − inventory”:

- One arith with red/green operand select — VM already does this.
- Emit only if we have multi-signal bags + color assignment.
- No latch; good for filters / limits, not batch sticky recipes.

### C — Medium / later (feeds #39 honestly)

**WarDaft pipeline** once channel + `signal_at` / rank IR exist:

- Selector pick-min-priority among deficit signals, then table-map to recipes.
- Better **extensibility** (edit constants) than hard-coded OR stacks; more entities.

### D — Low for current Lua surface

Hand-tuned foundry/assembler logistics are **domain** programs. Without multi-signal bags, forcing this pattern onto scalar SSA `if/else` trees is a mismatch (same reason #32 demoted selector-as-mux).

## Recommended next steps

1. Keep this note as the cookbook reference for “EACH tag filter + color-isolated latch”.
2. When opening the **channels / bundles** follow-up (post-#38 P1), treat **A** as the first emit-size target that justifies red/green on the **compile** path (not only import).
3. Add / keep the sim fixture (`each-tag-catalog.test.ts`) as a regression for the exact Reddit shape.
4. Do **not** chase WarDaft until `signal_at` / rank lands; do **not** invent selector muxes.

## Fixture

`packages/core/src/sim/each-tag-catalog.test.ts` — eval + directed `simulate` of a 2-recipe sticky catalog (constant green + decider with red feedback).
