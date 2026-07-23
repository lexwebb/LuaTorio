-- Cookbook 13 building blocks: predicate a multi-signal bag with ANYTHING/EVERYTHING.
local stock = bag_const(
  "signal-A", 2,
  "signal-B", 5
)
local needs_attention = bag_test("any", "<", stock, 3)
local healthy = bag_test("every", ">", stock, 1)

output("signal-A", needs_attention)
output("signal-B", healthy)
