# IR Types and Lowering Design

**Date:** 2026-07-22  
**Status:** Approved (autonomous)  
**Issue:** [#6](https://github.com/lexwebb/LuaTorio/issues/6)

## Summary

Define v1 IR DAG nodes and `lower(program: AnalyzedProgram): IRModule`. Desugar `logical` and/or into `select` nodes. Assign temp signal names `__t1`, `__t2`, …

## API

```typescript
export type IRNode =
  | { kind: "literal"; id: string; value: number }
  | { kind: "input"; id: string; signal: string }
  | { kind: "binop"; id: string; op: ArithOp; left: string; right: string } // child ids
  | { kind: "cmp"; id: string; op: CmpOp; left: string; right: string }
  | { kind: "select"; id: string; cond: string; then: string; else: string };

export interface IRModule {
  nodes: IRNode[]; // id === temp signal name
  outputs: Array<{ signal: string; nodeId: string }>;
  inputs: Array<{ signal: string; nodeId: string }>;
}

export function lower(program: AnalyzedProgram): IRModule;
```

Use node ids as temp signal names (`__t1`…). Refs to locals resolve to the binding’s node id.

**Logical desugar:**  
- `a and b` → `select(a, b, 0)` (Lua truthiness: non-zero true for circuits — use cmp/select consistent with 0/1)  
- `a or b` → `select(a, a, b)`  

For circuit 0/1 world: treat non-zero as true. Literal 0 for false branch of and.

## Tests

Lua → parse → analyze → lower → snapshot JSON (stable key order). At least: adder, comparison, and/or mux, multi-output.

## Out of scope

Optimizations (#7), combinator emission (#8).
