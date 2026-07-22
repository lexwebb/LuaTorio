# IR Optimizations Design

**Date:** 2026-07-22  
**Status:** Approved (autonomous)  
**Issue:** [#7](https://github.com/lexwebb/LuaTorio/issues/7)

## Summary

`optimize(module: IRModule): IRModule` with constant folding, CSE, DCE. Skippable later via compile option.

## Passes (order)

1. **Constant folding** — binop/cmp/select with literal children → literal
2. **CSE** — structurally identical nodes share one id (rewrite refs)
3. **DCE** — drop nodes not reachable from outputs

Preserve external input nodes even if unused? Prefer keep inputs listed in module.inputs. DCE nodes not reaching outputs.

## API

```typescript
export function optimize(module: IRModule): IRModule;
```

## Tests

Before/after snapshots: `2+3`→literal 5; duplicate subexpr shares node; unused local eliminated.

## Out of scope

Combinator emission.
