-- EACH-tag sticky hysteresis: 1 constant + 1 decider for N channels (#46)
-- Set when level == 0; hold while level < high and that signal is already selected.
local level_a = input("level-A")
local level_b = input("level-B")
local bag = each_latch(
  level_a, "signal-A", 10,
  level_b, "signal-B", 10
)
output("signal-A", bag)
output("signal-B", bag)
