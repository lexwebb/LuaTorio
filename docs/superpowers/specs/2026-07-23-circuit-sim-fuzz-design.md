# Circuit Network Simulator & Fuzz Harness

**Date:** 2026-07-23  
**Status:** Implemented (MVP under `packages/core/src/sim/`)  
**Issues:** #30 (VM), #31 (fuzz), #32 (tricks)

## Why

Emitter optimizations (select specialization, latch fusion, …) change entity graphs. Golden JSON snapshots catch shape drift but not **behavioral** regressions. A tick-accurate green-wire VM lets us:

1. Assert example programs produce the expected signal traces
2. Equivalence-check optimized vs unoptimized lowers
3. Fuzz random programs against a reference interpreter
4. Prove Factorio-specific size tricks before landing them (#32)

## VM model (MVP)

Operate on `CircuitGraph` (pre-layout): entities + directed green `WireEdge`s (`from` = producer output → `to` = consumer input), matching how we emit.

### Tick semantics (Factorio-faithful enough)

- Each combinator has an **input bag** and **output bag** of `signal → int32`
- Wire networks: union of endpoints; each tick, a network’s signal is the **sum** of all connected **outputs** writing that signal
- Combinators **read** the previous tick’s network sums on their input side, **compute**, and register new outputs for the **next** tick (1-tick delay)
- Constant combinators (non-empty filters) continuously contribute their filters to their output

### Supported entity behaviors

| Kind | Behavior |
|---|---|
| `constant` | Emit section filters each tick (empty sections = I/O placeholder, emit nothing) |
| `arithmetic` | `first (±const/signal) op second (±const/signal) → output_signal` |
| `decider` | AND of conditions; on success emit constant or `copy_count_from_input` |

Out of scope for MVP: red wire, logistic, selector combinator, each/any/everything wildcards,
decider `else_outputs` / OR joins (add when emitter uses them — see
`2026-07-23-factorio-circuit-capabilities.md`).

### API sketch

```typescript
simulate(graph: CircuitGraph, opts: {
  ticks: number;
  /** Injected onto input-port placeholder entities each tick (by user signal name). */
  inputs?: Record<string, number> | ((tick: number) => Record<string, number>);
}): { ticks: Array<{ outputs: Record<string, number> }> }
```

Output ports = `graph.outputs` markers; read the value of `signal` on that entity’s input network.

## Reference interpreter

Interpret the **source-level** v1/v2 subset without circuits:

- Free-running: each “tick”, apply all next-state assigns/`if` muxes once; outputs = current memory/combinational values
- Clocked `while`/`for`: same as desugar — one body iteration per tick while `__run ∧ cond`

Used as fuzz oracle: `reference(source, inputs, ticks) ≡ simulate(compile(source), …)` on output signals.

## Fuzz harness

1. Generate small valid programs (locals, arith, cmp, and/or, assign, if, one while/for+tick)
2. Random input traces (length T)
3. Compile → `lowerToCombinators` → simulate T ticks
4. Compare to reference; on mismatch, shrink program/inputs
5. CI: fixed seed, N=100 cases, fail on mismatch

Optional later: fitness = combinator count under equivalence (search for rewrites).

## Factorio tricks backlog (#32)

Re-grounded from wiki/runtime research (`2026-07-23-factorio-circuit-capabilities.md`):

1. **Decider `else_outputs`** for mux / enable-hold (before selector)
2. Multi-condition **OR** + multi-output
3. Tighter SR / EACH latches (cookbook one-decider SR)
4. Drop empty I/O placeholders from blueprints (or stats)
5. **Selector** only for index/sort/count/channel work — not primary if/else mux
6. Channel packing (v4 wires)

## Layout in repo

```
packages/core/src/sim/
  signals.ts
  networks.ts
  eval.ts      # one combinator step
  simulate.ts  # public API
  reference.ts
  fuzz.ts
  *.test.ts
```
