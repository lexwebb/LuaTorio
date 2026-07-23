# `elseif` and Nested `if` Design

**Date:** 2026-07-23  
**Status:** Implemented  
**Issue:** [#65](https://github.com/lexwebb/LuaTorio/issues/65)

## Goal

Make `elseif` and branch-local nested `if` ergonomic syntax for the existing phase-2
next-state mux model. This adds no IR node or combinator kind.

## Desugaring

An `elseif` chain is equivalent to an `else` containing another `if`:

```lua
if a then x = 1
elseif b then x = 2
else x = 3
end
```

becomes the next-state value `select(a, 1, select(b, 2, 3))`.

A nested conditional in a branch is similarly converted into an assignment value before
the containing conditional lowers. For example:

```lua
if a then
  if b then x = 1 end
else
  x = 2
end
```

becomes `select(a, select(b, 1, x), 2)`, where `x` in the omitted inner branch is the
current memory value.

## Holds and restrictions

Each omitted branch reads the target cell's current memory value, so a missing assignment
continues to hold exactly as phase-2 `if`/`else` already does. The final analyzed form still
contains only assignment lists and `select` expressions, allowing `lower.ts` to retain its
existing one-store-per-memory-cell behavior.

Branch leaves remain assignments to declared locals. Nested `if` statements are allowed;
`local`, `output()`, loops, calls, and other statement forms remain unsupported in branches.
Each branch may still assign a target at most once, and each target still has only one
top-level next-state site.
