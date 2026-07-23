# v5 entity placement (`place`) (#72)

**Date:** 2026-07-23  
**Status:** Accepted design  
**Issue:** [#72](https://github.com/lexwebb/LuaTorio/issues/72)  
**Implementation:** [#73](https://github.com/lexwebb/LuaTorio/issues/73)

## Goal

Add an explicit, small spatial surface for placing selected non-combinator Factorio entities
alongside a generated circuit. v5.0 makes placement deterministic without attempting to become a
factory planner.

## Surface

`place` is a top-level statement:

```lua
place("wooden-chest", 0, 0)
place("small-lamp", 2, 0, "north")
place("medium-electric-pole", 0, 3)
```

The complete v5.0 signature is:

```lua
place(name, x, y[, direction])
```

- `name` is a string literal in the v5.0 allowlist.
- `x` and `y` are signed integer literals in Factorio tile coordinates.
- `direction`, when present, is one of `"north"`, `"east"`, `"south"`, or `"west"`; omitted
  means Factorio's default north direction.
- Calls are top-level statements only and return no value. They cannot occur in expressions,
  functions, branches, or loop bodies.
- Duplicate occupied entity positions and overlap with compiler-generated combinator footprints
  are compile errors. There is no implicit coordinate shifting.

Coordinates are absolute in the resulting blueprint. They are intentionally stable across source
edits that do not change a `place` call.

## Spatial IR and layout

Circuit computation remains a signal/combinator graph. `place` creates a separate spatial IR
node, carried beside that graph until blueprint assembly:

```ts
type SpatialNode = {
  kind: "place";
  id: string;
  entity: "wooden-chest" | "small-lamp" | "medium-electric-pole";
  x: number;
  y: number;
  direction: "north" | "east" | "south" | "west";
};
```

The normal combinator graph is still topologically laid out. Before placement it reserves the
explicit spatial footprints; if automatic circuit placement would collide, layout fails with the
placed entity id/name and coordinate rather than moving either object. This keeps source
coordinates authoritative and avoids hidden layout changes.

## Wires and entity behavior

v5.0 emits **no automatic circuit-wire connections** to a placed entity. `place` only adds the
entity and its absolute geometry to the blueprint:

- A placed small lamp has no generated circuit condition.
- A placed chest has no generated circuit-network connection.
- A placed medium electric pole has no generated red/green circuit wire or power-network
  planning; Factorio's normal in-game electric coverage rules apply.

The compiler's internal combinator wires remain unchanged. A later slice can add an explicit
wire/condition surface with entity-specific connector validation; it must not infer wires merely
because two entities are nearby.

## v5.0 entity allowlist

The initial allowlist is deliberately concrete:

| Entity | v5.0 behavior |
|---|---|
| `"wooden-chest"` | Place the chest only. |
| `"small-lamp"` | Place the lamp only; no condition/configuration. |
| `"medium-electric-pole"` | Place the pole only; no automatic wire or power planning. |

Any other name is rejected and lists these allowed entities. Extending the list requires an
entity-specific emission and footprint decision, not a generic pass-through.

## Simulation policy

`simulate()` ignores `SpatialNode`s and continues to simulate only the combinator graph. Its
documentation and result warnings state that placed non-combinator entities have no simulator
behavior in v5.0. This is intentional: chests, lamps, and poles do not affect the circuit graph
until a later explicit wiring/configuration feature makes them circuit participants.

## Implementation plan (#73)

1. Add top-level `place` statement analysis with literal arity/type/direction validation and
   allowlist diagnostics; preserve rejection of expression/nested uses.
2. Add `SpatialNode` to the analyzed/lowered program while keeping the existing combinator IR
   and emitter contract separate.
3. Reserve absolute footprints during layout, detect collisions, and emit the three supported
   Factorio entities with stable entity numbering and coordinates.
4. Make simulation skip spatial nodes with a documented warning; add analyzer, layout, blueprint
   golden, and simulator-policy tests plus a README roadmap pointer.

## Non-goals

- A full base planner, logistic network DSL, recipes, belts, inserters, or every entity type
- Automatic circuit or power wiring to placed entities
- Relative/constraint-based layout, auto-routing, or collision relocation
- Decompiling placed blueprint entities back into Lua
