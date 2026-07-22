# Grid Layout Planner Design

**Date:** 2026-07-22  
**Status:** Approved (autonomous)  
**Issue:** [#9](https://github.com/lexwebb/LuaTorio/issues/9)

## Summary

Assign positions to `CircuitGraph` entities: topological left-to-right, 2-tile spacing; inputs left, outputs right. Produce Factorio 2.0 `wires` tuples with green connectors.

## API

```typescript
export interface PlacedEntity extends CircuitEntity {
  entity_number: number;
  position: { x: number; y: number };
}

export type FactorioWire = [number, number, number, number]; // src, src_conn, dst, dst_conn

export interface LaidOutCircuit {
  entities: PlacedEntity[];
  wires: FactorioWire[];
  outputs: CircuitGraph["outputs"];
  inputs: CircuitGraph["inputs"];
}

export function layout(graph: CircuitGraph): LaidOutCircuit;
```

Green wire connector IDs: use Factorio 2.0 arithmetic/decider/constant green input/output connector numbers (document constants in file; typical values: combinator green in/out — research or use commonly documented IDs 1–5; prefer library constants if available from blueprint tools).

## Tests

Small graphs 2–5 combinators: positions increase in x; wires length matches edges.

## Out of scope

Blueprint encode (#10).
