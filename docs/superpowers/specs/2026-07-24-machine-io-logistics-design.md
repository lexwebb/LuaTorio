# Machine-backed I/O: logistics chests (v5.1)

**Date:** 2026-07-24  
**Status:** Implementing  
**Issues:** design + implement (filed with this slice)

## Decisions

- **First slice:** logistics chests only (not assemblers).
- **Surface:** entity handles — `place` returns a handle; `input_from` / `output_to` / `configure` bind the circuit.
- Classic `input("sig")` / `output("sig", expr)` **remain** as constant-pad I/O for playground/sim.

## Goal

Pasteable blueprints where the Lua circuit reads chest contents and/or drives requester/buffer
requests, with red/green wires to the chest — not empty constant pads alone.

## Surface

```lua
local stock = place("logistic-chest-storage", 0, 0)
local requests = place("logistic-chest-requester", 4, 0)

local inv = input_from(stock)          -- bag
local iron = inv["iron-plate"]

output_to(requests, {
  ["iron-plate"] = 200,
  ["copper-plate"] = 100,
})

configure(requests, {
  read_contents = false,
  set_requests = true,
  request_from_buffers = true,
})

output("signal-A", iron)
```

| Construct | Behavior |
|-----------|----------|
| `place(name, x, y)` | Expression or statement. As `local e = place(...)` returns an **entity handle**. |
| Allowlist | Existing wooden-chest / lamp / pole **plus** `logistic-chest-passive-provider`, `active-provider`, `storage`, `buffer`, `requester`. |
| `input_from(entity)` | Local init → **bag**. Implies `read_contents = true` unless `configure` overrides. Wires chest → consumers. |
| `output_to(entity, bag)` | Statement. Requester/buffer only. Implies `set_requests = true`. Wires bag producer → chest. |
| `configure(entity, {…})` | Statement. Literal keys: `read_contents`, `set_requests`, `request_from_buffers`, optional `requests` table (static filters when not circuit-driven). |
| Handles | Not arith/cmp; not reassigned; only `input_from` / `output_to` / `configure`. |

## IR / emit

`SpatialPlace` becomes a richer spatial entity: handle `id`, logistic flags, request filters,
and circuit attachments (combinator ids to wire).

- `input_from` → IR `entity_read` bag node (no combinator); consumers wire from the chest
  (`wire_connector_id` circuit_red=5 / circuit_green=6).
- `output_to` → marks chest `set_requests`, wires bag-producing combinator → chest.
- Blueprint `control_behavior`: `read_contents` / `set_requests` per
  `LogisticContainerBlueprintControlBehavior`; static filters via logistic sections when
  `configure.requests` is set without circuit-driven `output_to`.

## Simulation

`simulate()` ignores non-combinator entities (unchanged). Drive tests via classic `input()`.

## Non-goals

Assemblers/recipes, roboport network contents, circuit_condition DSL, proximity auto-wire,
logistics VM simulation.
