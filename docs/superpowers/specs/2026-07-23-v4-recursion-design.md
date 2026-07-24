# Recursive functions: permanent reject (#71)

**Date:** 2026-07-23 (design) / 2026-07-24 (decision)  
**Status:** Accepted — **Option B** (no stack VM)  
**Issue:** [#71](https://github.com/lexwebb/LuaTorio/issues/71)  
**Depends on:** [#68](https://github.com/lexwebb/LuaTorio/issues/68) (closed)

## Decision

**Do not implement recursive functions or a combinator stack VM.**

v3 functions stay compile-time, fully inlined, and acyclic. Direct and mutual recursion remain
analyzer errors. Recursive algorithms belong in explicit `while` / `for` + memory cells.

### Why B

- A truthful stack emit is a sequential machine: visible tick latency, depth × frame-width
  combinator cost (often ~5–20× an equivalent loop), overflow/depth surface, and a separate
  simulator contract.
- That complexity buys source ergonomics, not denser blueprints. For Factorio circuits, loops
  win on size and ticks.

Option A (bounded stack IR) and compile-time unroll-with-magic-depth are documented below as
**rejected alternatives**, not a future roadmap promise.

## Current behavior (normative)

- `#68` inlines non-recursive `local function` declarations.
- Call-graph cycle detection rejects every recursive cycle.
- Diagnostics do **not** advertise recursion as “planned for v4”; they point authors at
  clocked loops / memory instead.

## Rejected alternatives

### Option A: explicit bounded stack IR (not pursuing)

Would have added frame state (PC/continuation, params/locals, return, SP, overflow/done),
allocated stack storage up to a literal max depth, and required either a microstep VM or a
fixed-depth pipeline with observable latency. Estimated cost scales as
\(C_{\mathrm{ctrl}} + C_{\mathrm{body}} + D \cdot W\) combinators — typically tens to hundreds
for modest depths, vs ~5–15 for an honest loop.

### Not an option: unroll a cycle

Compile-time unrolling only works with a statically proven finite acyclic expansion. Picking an
arbitrary unroll count is an implicit stack with worse diagnostics and no defined tick
semantics.

## Author guidance

Prefer:

```lua
local n = input("signal-N")
local acc = 1
local i = 1
while i <= n do
  acc = acc * i
  i = i + 1
  tick()
end
output("signal-A", acc)
```

over a recursive `fact(n)` that would need a stack machine in circuits.

## Implementation

No further emit/IR/sim work for #71. Analyzer rejection stays; README and roadmap treat
recursion as **out of scope**, not deferred.
