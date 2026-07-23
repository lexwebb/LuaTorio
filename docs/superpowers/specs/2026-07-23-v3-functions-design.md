# v3 functions: non-recursive, fully inlined (#67)

**Date:** 2026-07-23  
**Status:** Accepted design  
**Issue:** [#67](https://github.com/lexwebb/LuaTorio/issues/67)  
**Implementation:** [#68](https://github.com/lexwebb/LuaTorio/issues/68)

## Goal

Add reusable, user-defined circuit expressions without introducing a runtime call mechanism,
stack, or feedback path. v3.0 functions are compile-time templates: every call is fully inlined
into the caller's signal graph.

## Surface

Function declarations form a prefix of the top-level program. Their body is a pure expression
scope: zero or more single-binding `local` declarations followed by exactly one `return`.

```lua
local function clamp(value, lo, hi)
  local below = value < lo
  local above = value > hi
  return below and lo or (above and hi or value)
end

local raw = input("signal-A")
output("signal-B", clamp(raw, 0, 100))
```

Rules:

- Declaration syntax is only `local function name(param, ...) ... end`; global functions,
  anonymous functions, methods, varargs, and multiple return values are rejected.
- Function names and parameters are unique. Declarations may call any declared v3 function,
  including one declared later in the prefix.
- A body permits existing scalar and bag expression forms, pure `local name = expr` bindings,
  and one final `return expr`. Local bindings are immutable and scoped to that invocation.
- A call may appear wherever a scalar or bag expression is accepted. Parameter and return types
  are inferred per call after substitution; scalar contexts still reject bags using the existing
  diagnostic family (for example, `bag local 'x' may only be passed to output() or bag_arith()`).
- `input()` and `output()` remain top-level boundary declarations. They are rejected in function
  bodies; a caller passes input-derived values as arguments and exposes results with `output()`.

## Captures and state

v3.0 permits **read-only captures of outer immutable locals**. Resolution is parameter, then
function-local, then a captured outer local. A capture may be scalar or bag-typed, preserving its
normal context rules after inlining.

The analyzer rejects captures of a name that is reassigned anywhere, a loop induction variable,
or any other memory cell. It also rejects assignments, `if` statement bodies, `while`, `for`,
and `tick()` inside a function body. Consequently a function has no mutable upvalue and cannot
hide sequential state:

```lua
local scale = 10
local function capped(x)
  return x < scale and x or scale -- allowed: immutable capture
end

local total = 0
local function bad(x)
  return x + total -- rejected once total is assigned: mutable upvalue
end
```

## No recursion

Before lowering, analysis collects declared functions and their direct user-function calls into a
directed call graph. Builtins (`input`, bag primitives, etc.) are not graph edges. A DFS with
visiting/visited marks rejects every strongly connected cycle, including direct recursion and
mutual recursion, and reports the participating path, for example:

```text
recursive function call cycle: a -> b -> a (planned for v4)
```

The rejection is at the declaration/call location and uses `plannedVersion: "v4"`. Calls through
values are impossible in this subset, so the static graph is complete.

## Lowering

v3.0 has **no `call` IR node**. Lowering expands the called body into the caller, substitutes
arguments and permitted captures, and alpha-renames each function-local binding by call site.
The result is the existing scalar/bag IR and optimizer pipeline. Common-subexpression
elimination may share equivalent expanded nodes, but source calls do not imply a shared runtime
subcircuit.

This keeps emit, simulator, layout, and wire ownership unchanged for #68. A future `call` IR
with explicit function instances is an optimization/diagnostic option only after its sharing
and state semantics are specified; it is not required for v3.0.

## Interactions

| Area | v3.0 rule |
|---|---|
| Inputs / outputs | Only top-level `input()` and `output()` calls. Functions receive and return circuit values, not ports. |
| Memory cells | Functions cannot declare or capture mutable cells. An inlined call is valid in a caller's next-state RHS, so it computes combinational next state. |
| Clocked loops | Function bodies cannot contain loops or `tick()`. Calls in allowed loop assignment expressions are inlined and execute as combinational logic during that iteration. |
| Bags | Bags may be parameters, immutable captures, or return values. Existing bag-only contexts (`output`, `bag_arith`, later filters) remain enforced after expansion. |
| `each_latch` | May be created only where the existing bag-local rules allow it; a function cannot use it to create reassignable captured state. |

## Implementation plan (#68)

1. Extend analyzed-program metadata with function declarations, lexical binding information, and
   source locations; retain current unsupported-function diagnostics until the gate lands.
2. Validate declaration/body shape, immutable captures, top-level I/O boundaries, and the
   recursion call graph.
3. Expand calls during lowering with argument substitution and alpha-renamed body locals; pass
   the expanded graph through existing optimize, simulate, layout, and emit paths.
4. Add analyzer diagnostics plus scalar, bag-return, capture, memory-RHS, clocked-loop, and
   recursion-cycle tests. Add a compact example and README language-reference pointer.

## Non-goals

- Recursion, a stack, or recursive-function emission (v4 #71)
- Runtime `call` IR or callable first-class values
- `place()` and entity APIs
- Tables, closures with mutable upvalues, methods, or varargs
