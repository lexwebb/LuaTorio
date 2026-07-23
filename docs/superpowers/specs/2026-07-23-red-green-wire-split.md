# Red / Green Wire Split (#40)

**Date:** 2026-07-23  
**Status:** Done (#40)  
**Related:** #41 undirected nets, #39 selector

Landed: `WireEdge.color` red|green; `ColoredInputs` + `*_signal_networks` in eval; layout red connectors; `simulate` / `simulateImported` keep colors separate.

## Problem

Factorio red and green are **separate** networks. Combinator operands default to reading **both** (summed), but can select red-only, green-only, or both via `*_signal_networks: { red?, green? }` (defaults `true`).

LuaTorio previously treated every wire as one green bag and summed all producers into a single `SignalBag` before `eval*`. That cannot express foreign blueprints or cookbook patterns that isolate colors.

## Model

### Directed emit graph (`CircuitGraph`)

```ts
WireEdge.color: "red" | "green"  // was green-only
```

Layout maps color → Factorio connector ids (same as #41 `WIRE_CONNECTOR`):

| Color | Input | Output |
|-------|-------|--------|
| red   | 1     | 3      |
| green | 2     | 4      |

Constants still attach on the input connector id for that color (emitter convention).

### Simulation input bags

For each consumer, build **two** bags (`red`, `green`) by summing producers on edges of that color. Pass both into eval.

Operand / condition reads use:

```ts
first_signal_networks?: { red?: boolean; green?: boolean }  // default both
second_signal_networks?: { red?: boolean; green?: boolean }
```

Resolved bag = sum of enabled colors (missing field ⇒ both). Same for decider condition operands and copy-from-input outputs when those fields appear.

### Undirected import (#41)

`simulateImported` already has per-net `color`. After #40 it **must not** merge red+green when building an entity’s default input — instead expose `{ red, green }` and apply the same `*_signal_networks` rules. Interaction: one eval backend, two graph front-ends (directed edges vs undirected nets).

## Emit path (minimal)

Compiled Lua stays green-only (no automatic coloring). Acceptance path:

1. Hand / import graphs may set `color: "red"`.
2. `layout` + `emitBlueprint` emit red connector ids.
3. Fixture: arithmetic `A(red) + B(green)` where both colors carry the same signal name with different counts — green-only sum would be wrong.

## Non-goals

- Automatic optimal coloring of compiled programs
- Logistic networks
- Changing default green emit for existing goldens
