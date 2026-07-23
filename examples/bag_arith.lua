-- Cookbook 1 math: pairwise EACH / EACH across red (left) and green (right).
local demand = bag_const(
  "signal-A", 10,
  "signal-B", 15
)
local batch = bag_const(
  "signal-A", 2,
  "signal-B", 3
)
local batches = bag_arith("/", demand, batch)
output("signal-A", batches)
output("signal-B", batches)
