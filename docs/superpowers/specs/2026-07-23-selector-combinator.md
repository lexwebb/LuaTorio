# Selector Combinator (#39)

**Date:** 2026-07-23  
**Status:** Implemented (#39)  
**Depends:** Honest use is index/rank/count — not if/else mux (see Factorio capabilities doc).

## Modes

| Mode (`operation`) | LuaTorio | Notes |
|---|---|---|
| `count` | **Supported** | Count nonzero unique input signals → `count_signal` |
| `select` | **Supported (VM)** | Sort by value; pick by `index_constant` / `index_signal`; `select_max` (default true = descending) |
| `random` | Unsupported | Reject on import |
| `quality-filter` / `quality-transfer` | Unsupported | Space Age |
| `stack-size` / `rocket-capacity` | Unsupported | |
| clock / time | Unsupported | |

## Language surface (emit)

```lua
local n = signal_count(a, b, c)  -- ≥1 args; wires all onto one selector (count)
output("signal-N", n)
```

IR: `{ kind: "signal_count"; id; args: string[] }`  
Emit: one `selector-combinator` (`operation: "count"`, `count_signal` = id), green wires from each arg.

**Clearer than decider soup:** counting distinct signals previously needed a hand-rolled EACH/decider chain; selector is the Factorio-native op.

Index/rank Lua: `signal_at` / `signal_at_asc` (#47). VM also evaluates `select` for foreign blueprints / hand graphs.

## Import (#41)

`fromBlueprint` accepts `selector-combinator` when `operation` is `count` or `select`; other operations throw `BlueprintImportError`.
