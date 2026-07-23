# Cookbook follow-ups — 9, 19/20, 13, and 6

## 9 — multi-signal memory cell (#60)

The cookbook cell routes a red bag through `EVERYTHING` while S is true, and feeds its
output back while S is false. It needs a pass decider plus a feedback/copy path. LuaTorio's
current scalar `select(enable, next, memory)` emits one latch per scalar cell; bags are
immutable wire values and cannot currently be assigned as memory. Adding `bag_hold(enable,
data)` would therefore add a stateful bag surface, IR, simulator/reference semantics, and at
least two emit entities without replacing an existing emitted bag cell. There is no clear size
win yet.

Composition recipe: retain scalar state in Lua, use `each_latch` for channel-wise sticky
dispatch, and apply `bag_filter` to select the bag channels. Revisit only with a real bag-state
surface where the cookbook cell replaces an O(N) scalar-memory expansion.

## 19/20 — edge detector and pulse extender (#61)

`edge(value)` is a scalar rising-edge primitive. It emits the cookbook's two entities:
an arithmetic `+0` one-tick delay, followed by a red-current/green-previous decider that emits
one when `current > previous`. It is intentionally scalar: a bag edge needs defined per-channel
state, output shape, and reset behavior.

Pulse extension remains composition-only: use a scalar memory cell with `sr(state, edge(input),
reset)` (or an explicit reset threshold) for a latch-like extended signal. The cookbook's EACH
version needs stateful bags and does not have an honest compact IR yet.

## 13 — ANYTHING/EVERYTHING predicates (#62)

`bag_test("any" | "every", comparator, bag, integerThreshold)` lowers to one decider using
`signal-anything` or `signal-everything` and emits scalar `1` on success. It is the general
predicate needed by stalled-belt-style control without a belt-specific builtin.

- Use `ANYTHING` when one present bag channel may satisfy a threshold.
- Use `EVERYTHING` when every present channel must satisfy it (the simulator treats an empty bag
  as vacuously true, matching its wildcard model).
- Use `EACH` when output must preserve or transform every channel individually.
- Use ordinary scalar comparisons when there is one named signal.

## 6 — scalar hysteresis (#63)

The two-combinator cookbook latch needs independent high and low threshold conditions around a
sticky state. Current `sr` accepts set/reset booleans but only scalar expression construction;
the Lua composition is already direct:

```lua
local active = 0
active = sr(active, level > high, level < low)
```

This remains the recommended recipe. A dedicated `hysteresis(level, low, high)` would duplicate
that surface without a demonstrated emit reduction, so it is not planned.
