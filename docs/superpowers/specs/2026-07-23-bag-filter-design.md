# Bag filters — cookbook 3–5

## Surface

```lua
local data = bag_const("signal-A", 5, "signal-B", 7)
local mask = bag_const("signal-A", 1, "signal-B", 7)
local included = bag_filter("include", data, mask)
local excluded = bag_filter("exclude", data, mask)
local limited = bag_filter("limit", data, mask)
```

`data` is the red input and `mask` is the green input. Both must be bag expressions.
The result remains a bag, so it may be passed to `output()` or another bag primitive.

## Shared IR and emit

All three forms lower to:

```ts
{ kind: "bag_filter", id, mode, data, mask }
```

One decider receives `data` on red and `mask` on green, iterates red `EACH`, and copies
matching red counts onto output `EACH`. This preserves the cookbook's one-decider shape
without domain-specific language builtins.

| Mode | Per-channel condition | Result |
|---|---|---|
| `include` | red count is present and green count is present | data channel |
| `exclude` | red count is present and green count is absent | data channel |
| `limit` | red count `<=` green count | data channel |

Presence means a nonzero signal count, so mask magnitudes are intentionally irrelevant for
`include` and `exclude`; `limit` uses the green count as the per-channel cap. The simulator
evaluates a cross-color second `EACH` by channel name, which is required for the limit case.

## Scope

This is a reusable circuit primitive only. Recipe, train, asteroid, and other domain policies
compose bags and filters in user programs rather than becoming compiler builtins.
