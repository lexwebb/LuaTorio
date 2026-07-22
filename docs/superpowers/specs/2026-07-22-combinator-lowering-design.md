# Combinator Lowering Design

**Date:** 2026-07-22  
**Status:** Approved (autonomous)  
**Issue:** [#8](https://github.com/lexwebb/LuaTorio/issues/8)

## Summary

Lower `IRModule` to an unpositioned circuit graph: entities with control_behavior + logical wire edges (no coordinates yet).

## API

```typescript
export type CombinatorKind = "constant" | "arithmetic" | "decider";

export interface CircuitEntity {
  id: string; // IR node id
  kind: CombinatorKind;
  /** Factorio entity name */
  name: string;
  control_behavior: Record<string, unknown>;
  /** Output signal name this entity produces (temp or user signal) */
  outputSignal: string;
}

export interface WireEdge {
  from: string; // entity id
  to: string;
  /** Always green in v1 */
  color: "green";
}

export interface CircuitGraph {
  entities: CircuitEntity[];
  wires: WireEdge[];
  outputs: Array<{ signal: string; entityId: string }>;
  inputs: Array<{ signal: string; entityId: string }>;
}

export function lowerToCombinators(module: IRModule): CircuitGraph;
```

Map per parent design table. Arithmetic/decider use Factorio 2.0 control_behavior shapes (best-effort typed as records; refine in #10).

Wires connect producer entity to consumer for each IR edge.

## Tests

Unit tests per IR kind → expected entity kind + op fields.

## Out of scope

Positions (#9), blueprint string (#10).
