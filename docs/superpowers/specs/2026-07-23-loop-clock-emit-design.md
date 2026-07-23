# Loop clock emit specialization (#50)

**Date:** 2026-07-23  
**Status:** Implemented  
**Issue:** #50  

## Goal

Specialize common clocked induction shapes to Factorio 2.0 **multi-output decider clocks**, cutting combinators on `while_count` / `for_sum` / `conditional-counter` without changing Lua surface semantics.

## Patterns

### 1. Copy-increment hold (`mem' = en ? mem+δ : mem`, literal δ)

**Before:** mux-side δ-gate + arithmetic `Q+δ` latch.  
**After:** one decider latch:

- then: copy `mem` + constant `δ` on `mem` (wire sum = `mem+δ`)
- else: copy `mem` (hold)

### 2. Fused sticky `__run` + induction clock

When the hold enable is a multi-use sticky `select(__run, cond, 0)`:

- one decider emits induction copy±δ **and** sticky `__run = 1` on the then branch
- else: hold induction only (`__run` clears)
- `__run` memory entity is absorbed; other holds remap wires to the host entity
- sim seeds via `latchSeeds` (multi-signal); output ports prefer producer `outputSignal` so `__run` does not pollute `signal-A`

### 3. Delta-choose ±literal (`mem' = c ? mem+δ₁ : mem+δ₂`)

**Before:** mux-side ±δ + arithmetic latch.  
**After:** one decider latch with copy+δ₁ / else copy+δ₂ (`conditional-counter`).

### 4. `sum += i` in `for_sum`

Still a separate incremental hold (cannot remap copy of `i` onto `sum` in a non-EACH decider output). Wins come from fusing the `i`/`__run` clock.

## Non-goals

- Arbitrary loop bodies
- Changing `__run` sticky restart semantics
- Domain-specific builtins
