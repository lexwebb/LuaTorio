# Blueprint Emitter Design

**Date:** 2026-07-22  
**Status:** Approved (autonomous)  
**Issue:** [#10](https://github.com/lexwebb/LuaTorio/issues/10)

## Summary

Assemble Factorio blueprint JSON from `LaidOutCircuit`, encode with `@jensforstmann/factorio-blueprint-tools`, and implement real `compile()`.

## API

```typescript
export function emitBlueprint(
  laidOut: LaidOutCircuit,
  options?: { name?: string; json?: boolean },
): { blueprint: string; stats: { combinators: number; wires: number } };

// Replace stub:
export function compile(source: string, options?: CompileOptions): CompileResult;
// pipeline: parse → analyze → lower → (optimize unless false) → lowerToCombinators → layout → emit
```

## Dependencies

Add `@jensforstmann/factorio-blueprint-tools` to `@luatorio/core`.

## Tests

- emit produces string starting with `0` (blueprint version prefix) or valid JSON when json:true
- decode round-trip entity count matches
- compile(clamp program) returns blueprint + stats

## Errors

Propagate ParseError / SemanticError from pipeline.
