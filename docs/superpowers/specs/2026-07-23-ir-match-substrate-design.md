# IR pattern-match substrate (#54)

**Date:** 2026-07-23  
**Status:** Implemented (v1 substrate)  
**Issue:** #54  

## Problem

Emit specialization grew as hand-rolled predicates inside `combinators.ts`. The absorption pre-pass and emit dispatch often duplicate the same shape checks (`mem+δ`, sticky clear, `c and x or y`, …). Drift = wrong entity counts or missing wires. Cookbook rip (#52) will add more idioms.

## Non-goals

- AST rewrite engine / visitor framework / rule DSL  
- Moving domain filters into language surface  
- Replacing IR kinds for explicit builtins (`sr`, `each_latch`, `signal_at`)

## Layering

| Layer | Role |
|-------|------|
| **analyze** | Named intrinsics + program shape |
| **optimize** | Canonicalize toward matchable IR (`select(c,1,0)` → bool, CSE) |
| **`ir-match.ts`** | Pure `matchX → bindings \| undefined` |
| **combinators emit** | Absorb via matchers; emit entities from bindings |

## v1 API (`packages/core/src/ir-match.ts`)

View helpers: `literalValueOf`, `isBooleanValued`, `useAtMost`, `soleUseCmp`, `fusedCmpForSelect`.

Matchers: `isBooleanOrSelect`, `matchAndOrMux`, `memPlusDelta`, `memDeltaLiteral`, `isStickyClearSelect`, `matchEnableHold`, `matchMemoryStore`.

`matchMemoryStore` classifies a cell’s store value structurally. Shared-enable sticky / fused `__run` clock still need user-graph filters in the emitter (those stay next to wire topology).

## Rules

1. **Absorb and emit call the same matcher** for a shape — no twin `if` trees.  
2. Matchers stay pure (no `CircuitEntity` construction).  
3. New cookbook idioms = new `match*` + one emit arm; prefer extending `matchMemoryStore` when the store value is the discriminant.

## Follow-ups

- Drive the memory pre-pass entirely from `matchMemoryStore` (remove residual inline duplicates).  
- Optional: `specializeSelect(node) → { kind, absorbIds }` so select absorb mirrors `lowerSelect` exactly.  
- Cookbook: edge detector / pulse extender as match+emit pairs once Lua shapes exist.
