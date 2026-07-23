# Foreign Blueprints + Undirected Wire Nets

**Date:** 2026-07-23  
**Status:** Done (#41)  
**Related:** #40 red/green, #39 selector (unsupported until present)  
**Landed:** `fromBlueprint` / `fromCircuitGraph` → `ImportedCircuit`; `simulateImported`; fixtures `static-mul` + `free-counter` under `packages/core/src/sim/fixtures/`

## Problem

LuaTorio’s sim graph is **directed** (`WireEdge.from → to`: producer output → consumer input), matching how we emit. Factorio wires are **undirected**: a red/green link joins two entity connectors into one network. Foreign blueprints therefore cannot round-trip through today’s `CircuitGraph` without a net model.

## Goals

1. Decode a Factorio blueprint (string or JSON plan) into an internal model we can simulate.
2. Build **undirected** (per-color) wire nets; evaluate combinators from net bags, not edge direction.
3. Hand fixtures: ≥2 foreign/minimal blueprints with known traces.
4. Clear errors for unsupported entities (selector until #39, logistics, etc.).

## Non-goals (this issue)

- Decompile blueprint → Lua
- Pixel-perfect layout re-emit
- Automatic red/green coloring of *compiled* programs (#40 may add colors first for import)

## Proposed model

Keep emit’s directed graph for the compiler path. Add a parallel **network** view for import/sim of foreign plans:

```ts
type WireColor = "red" | "green";

interface CircuitNet {
  color: WireColor;
  /** Entity connector endpoints in this net (entity id + input|output side). */
  members: Array<{ entityId: string; side: "in" | "out" }>;
}

interface ImportedCircuit {
  entities: CircuitEntity[]; // reuse control_behavior shapes where possible
  nets: CircuitNet[];
  /** Optional I/O labels if we can infer them; else drive by entity id. */
}
```

**Simulate imported:** each tick, for each combinator, sum signal bags from nets attached to its **input** side (per color; #40 splits red vs green). Write outputs onto nets attached to its **output** side. Constants drive continuously; latches use `role` or heuristic (self-net feedback).

**Bridge from emit:** `CircuitGraph` → `ImportedCircuit` by treating each directed edge as joining `from`’s out with `to`’s in on one color (today: green only). Enables one sim backend later.

## Milestone plan

1. **Design lock** (this doc) + fixture corpus location (`packages/core/src/sim/fixtures/`)
2. `fromBlueprint(plan) → ImportedCircuit` for constant / arithmetic / decider only
3. `simulateImported` (or extend `simulate`) on undirected nets
4. Two fixtures + tests; document gaps → #40 / #39

## Open questions

- Latch detection without our `role: "latch"` metadata (self-feedback heuristic?)
- Whether to remap `__t*` virtuals when importing LuaTorio-emitted BPs vs game exports
- Entity connector indices for Factorio 2.0 blueprint wire tuples `[ent, connector, ent, connector]`
