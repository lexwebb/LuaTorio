# v4 recursive functions: stack and tick design (#71)

**Date:** 2026-07-23  
**Status:** Deferred for morning design decision  
**Issue:** [#71](https://github.com/lexwebb/LuaTorio/issues/71)  
**Depends on:** [#68](https://github.com/lexwebb/LuaTorio/issues/68) (closed)

## Context

v3 functions are compile-time, non-recursive expansions. #68 therefore detects every direct or
mutual call cycle during analysis and rejects it with `plannedVersion: "v4"`. That diagnostic
remains the current behavior while this issue is open.

Recursion cannot be added by relaxing that check: the existing lowering has no runtime call,
activation record, return address, or stack storage. A recursive call needs a sequential
machine, so it must specify both finite resources and Factorio tick behavior before an emitter
can be truthful.

## Stack model options

### Option A: explicit bounded stack IR

Add an explicit `recursive_call`/stack-machine IR family whose state includes, per active frame:

- callee/program counter or continuation;
- parameter and function-local values;
- a return-value slot;
- stack pointer, overflow flag, and completion state.

Lowering would turn a recursive function into a bounded interpreter/data path. Emit would
allocate memory cells and combinators for every frame up to a configured depth; return would
unwind one frame at a time. The simulator must execute the same state transitions rather than
pretending calls are combinational.

This is the only option that supports recursive source functions in this compiler. It has
visible, bounded resource cost proportional to maximum depth and frame width, and requires
dedicated layout, optimization, simulation, and diagnostic work.

### Option B: reject unbounded recursion

Keep v3 inlining and permanently reject every call-graph cycle. Recursive algorithms can be
written as explicit clocked loops and memory cells in the supported subset. This is simple,
honest, and has no hidden resource limit, but it does not deliver the #71 language feature.

### Not an option: unroll a cycle

Compile-time unrolling is valid only when a statically provable finite bound makes the call
graph acyclic after expansion. General recursion has no such bound. Arbitrarily choosing an
unroll count is an implicit stack limit with worse diagnostics and no defined tick semantics.

## Tick interaction

An explicit stack VM is sequential. A call, frame initialization, expression evaluation,
branch, return, and unwind cannot all be assumed to complete in one Factorio tick unless an
emit design proves the required combinator propagation and feedback timing.

The morning decision must choose one contract:

1. **Microstep VM:** each machine transition consumes one or more ticks. Invocation latency is
   observable; callers must receive a `done`/result protocol, and recursion cannot appear in
   ordinary combinational expression positions.
2. **Statically scheduled frames:** compile a fixed-depth recursive shape into a staged
   pipeline. Latency is fixed but still observable, and supported function bodies would be much
   narrower than v3 expressions.

Neither contract is compatible with silently treating recursive calls like current inlined
expressions. Memory cells and clocked loops must also be defined as VM-owned state or rejected
inside recursive bodies; sharing their feedback paths with frames without an ownership model
would create ambiguous next-state behavior.

## Limits and diagnostics

If Option A is accepted, recursion must require a compile-time literal maximum depth, either on
the function declaration or at each recursive call. The design must specify:

- a conservative maximum frame count and what counts as a frame;
- a source-level depth cap and compiler hard cap;
- overflow behavior: compile-time rejection when the bound cannot be established, or a
  deterministic runtime overflow signal that suppresses further calls;
- a combinator-cost estimate based on frame locals, parameters, continuation states, and
  result width;
- simulator limits identical to emitted limits.

The first implementation should prefer compile-time bounded depth and reject missing,
non-literal, negative, or excessive limits. It must never rely on an unbounded Factorio feedback
loop as a hidden call stack.

## Rejected source forms

Until an explicit-stack contract is accepted and implemented, analyzer rejection remains for:

- direct recursion and all mutual-recursion cycles;
- recursive functions that capture mutable state;
- recursion through a value (already outside the v3 callable model);
- unbounded or dynamically bounded recursive calls;
- recursive bodies containing `tick()`, `while`, `for`, mutable assignments, `input()`, or
  `output()`.

After a stack design is chosen, the last group must be reconsidered only with explicit state and
tick ownership rules; accepting it merely because a stack exists would be unsound.

## Why emit is deferred overnight

Full combinator-stack emission is a major language/runtime decision, not a local lowering task.
It determines visible tick latency, stack resource bounds, frame storage layout, overflow
semantics, and interactions with existing memory cells and clocks. Shipping an assumed model
overnight could lock the project into incorrect or surprising runtime behavior.

The design note is intentionally the only completed acceptance item for #71. Morning review must
select Option A or Option B and, if Option A, choose the tick contract and bounded-stack surface
before analyzer changes beyond the existing v4 diagnostic, IR, simulator, or emit work begins.

## Implementation gate after review

1. Record the selected stack and tick contract in this document.
2. Define bounded recursive syntax and precise rejected forms.
3. Change analyzer cycle handling only for source that satisfies that contract.
4. Add stack IR plus simulator transition tests before emitter work.
5. Emit one bounded example, compare stack cost with an explicit loop/inlining alternative, and
   document latency and resource limits in the README.
