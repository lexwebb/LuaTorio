# v4 tables as constant bags (#69)

**Date:** 2026-07-23  
**Status:** Accepted design  
**Issue:** [#69](https://github.com/lexwebb/LuaTorio/issues/69)  
**Implementation:** [#70](https://github.com/lexwebb/LuaTorio/issues/70)  
**Depends on:** [#66](https://github.com/lexwebb/LuaTorio/issues/66), [#58](https://github.com/lexwebb/LuaTorio/issues/58), [#59](https://github.com/lexwebb/LuaTorio/issues/59)

## Goal

Use a deliberately small Lua table surface as readable syntax for constant multi-signal bags.
This is a circuit value feature, not general Lua object storage.

## Surface

The only v4.0 constructor shape is a non-empty map with bracketed string-literal Factorio signal
names and integer-literal counts:

```lua
local request = {
  ["iron-plate"] = 10,
  ["signal-A"] = -1,
}
local iron = request["iron-plate"]
output("iron-plate", request)
output("signal-B", iron)
```

String keys are required because Factorio signal names commonly contain hyphens. Lua identifier
keys (`{ iron_plate = 10 }`), dot access, variable keys, array entries, duplicate keys, empty
constructors, and non-integer values are rejected in v4.0.

`bag["signal-name"]` is a named-channel sample and returns a scalar. The key must be a string
literal. Sampling an absent key yields the normal circuit value `0`, not `nil`.

## Immutability and writes

Table/bag values are immutable in v4.0. `bag["signal-A"] = value`, `bag.field = value`, and
assignment through any index are rejected with a diagnostic such as:

```text
bag field writes are not supported in v4.0; create a new bag with bag_arith()/bag_filter()
```

There is no mutation, aliasing, Lua reference identity, or table iteration. A later language
slice may add explicit functional bag-update syntax only if it has a compact, faithful circuit
lowering.

## Lowering and bag family

Each literal lowers directly to the existing `bag_const` form (or its equivalent bag IR):

```ts
{ kind: "bag_const", id, entries: [
  { signal: "iron-plate", count: 10 },
  { signal: "signal-A", count: -1 },
] }
```

It therefore emits one constant-combinator bag and participates in the same typed flow as other
bag producers:

| Producer / operation | Relation to table bags |
|---|---|
| `each_latch` (#46) | Produces a runtime, stateful bag; table literals may be used as constant masks or operands, but do not alter latch state. |
| `bag_const` (#58) | The explicit v3 spelling and table literal have identical constant-bag semantics. `bag_const` remains supported. |
| `bag_arith` (#58) | A literal is a bag operand, so pairwise EACH arithmetic may combine a constant literal with a runtime bag. |
| `bag_filter` (#59) | A literal is a natural include/exclude/limit mask; filter color and wire rules stay owned by the bag operation. |

Field reads lower as a named-channel sample at the scalar boundary. Repeated reads of the same
literal/key may share the bag producer and sample node through normal optimization.

## Constant catalogs versus runtime bags

The v4.0 syntax intentionally constructs **constant catalog bags** only: all keys and counts are
known at compile time, emit as a constant combinator, and can describe requests, masks, or
lookup-like signal sets. It does not construct an arbitrary dynamic Lua map.

Runtime bags continue to come from circuit primitives: `each_latch`, `bag_arith`, and
`bag_filter` (plus later bag producers). They may be sampled with the same literal-key read
syntax, but cannot be rewritten as a Lua table. This distinction prevents a dynamic-map
implementation from being smuggled into a constant-combinator feature.

## Dependency order

1. #66 supplies the bag type, bag-local restrictions, and bag/scalar boundary.
2. #58 supplies `bag_const` and pairwise arithmetic; it establishes the constant-bag lowering
   and red/green arithmetic convention.
3. #59 supplies filtering so literal bags can serve as masks.
4. #70 adds parser/analyzer support, lowering, optimization sharing, simulation, and emit
   coverage for this Lua syntax.

`each_latch` (#46) is an established bag producer rather than a hard parser dependency; its
interaction is covered by the common bag type. No new cookbook emit pattern is designed here.

## Implementation plan (#70)

1. Accept only bracketed string-key/integer-value table constructors and literal-string index
   reads; preserve current `unsupported construct: table constructor (planned for v4)` behavior
   outside that subset.
2. Analyze table literals as `bag_const` values, enforce bag-local immutability, and reject
   index/member writes with the v4.0 diagnostic.
3. Lower literal-key reads to named bag-channel samples, then reuse existing bag lowering,
   color allocation, optimization, simulation, and emission paths.
4. Test constants, negative counts, absent reads, bag arithmetic/filter composition, malformed
   keys/values, and every explicit non-goal. Add an example and README roadmap pointer.

## Non-goals

- Full Lua tables, object identity, `nil`, iteration, or `pairs`
- Metatables, methods, and arbitrary string or computed keys
- Nested tables, arrays/list semantics, and mixed map/array constructors
- Field/index writes or dynamic bag construction
- Domain-specific recipe or factory APIs
