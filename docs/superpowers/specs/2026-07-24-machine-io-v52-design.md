# Machine I/O v5.2: assemblers, roboport, circuit conditions

**Date:** 2026-07-24  
**Status:** Implemented  
**Issues:** #80 (assemblers/foundries), #82 (allowlist + chest `circuit_condition` + roboport)

Extends v5.1 logistics-chest handles (`docs/superpowers/specs/2026-07-24-machine-io-logistics-design.md`).

## Decisions

- Keep the same surface: `place` → handle → `input_from` / `output_to` / `configure`.
- No new builtins.
- `simulate()` still ignores non-combinator machines; `entityInputs` injects bags for any `input_from` place (chest or roboport).

## Allowlist additions

| Entity | Role |
|--------|------|
| `iron-chest`, `steel-chest` | Decorative / future I/O |
| `small-electric-pole`, `big-electric-pole`, `substation` | Power poles |
| `assembling-machine-1/2/3`, `foundry` | Recipe + enable (#80) |
| `roboport` | Network contents bag (#82) |

Existing wooden-chest / lamp / medium pole / five logistic chests remain.

## Assembler / foundry (#80)

```lua
local asm = place("assembling-machine-2", 0, 0)
configure(asm, {
  set_recipe = true,
  circuit_enabled = true,
  circuit_condition = { signal = "signal-A", comparator = ">", constant = 0 },
  recipe = "iron-gear-wheel", -- optional static blueprint recipe
})
output_to(asm, { ["iron-gear-wheel"] = 1 }) -- circuit recipe bag
```

| Construct | Behavior |
|-----------|----------|
| `output_to(asm, bag)` | Allowed for assemblers/foundry. Implies `set_recipe = true`. Wires bag → machine (connector 5). |
| `configure` keys | `set_recipe`, `circuit_enabled` (bools); `recipe` (string literal); `circuit_condition` (table). |
| `input_from(asm)` | Sets `read_contents = true` on the machine (inventory bag). Optional. |

Emit (`AssemblingMachineBlueprintControlBehavior` + entity `recipe`):

- `control_behavior.set_recipe`, `circuit_enabled`, `circuit_condition`
- Top-level `recipe` when configured statically

## Chest `circuit_condition` (#82)

```lua
configure(requests, {
  set_requests = true,
  circuit_condition_enabled = true,
  circuit_condition = { signal = "signal-G", comparator = ">", constant = 0 },
})
```

Emit into `LogisticContainerBlueprintControlBehavior`: `circuit_condition_enabled` + `circuit_condition`.

## Roboport network bag (#82)

```lua
local port = place("roboport", 0, 0)
local net = input_from(port) -- read_items_mode = logistics (1)
output("signal-A", net["iron-plate"])
```

`input_from(roboport)` sets `read_items_mode = 1` (`defines.control_behavior.roboport.read_items_mode.logistics`). Same `entity_read` phantom / `entityInputs` path as chests.

## `circuit_condition` table shape

Literal nested table only:

| Key | Meaning |
|-----|---------|
| `signal` | First signal name (string literal) |
| `comparator` | `"<"`, `">"`, `"<="`, `">="`, `"=="`, `"~="` |
| `constant` | Integer literal (mutually exclusive with `other`) |
| `other` | Second signal name (optional alternate to `constant`) |

ASCII comparators map to Factorio blueprint symbols at emit (same as deciders).

## Simulation policy

Unchanged: machines/chests/roboports are not evaluated as crafting/logistics sims. Drive tests via `entityInputs` / classic `inputs`. Docs must state this.

## Non-goals

Full factory planner, every Factorio entity, quality/spoilage recipe signals, roboport robot-stats mode as language surface (configure can stay logistics-only for `input_from`).
