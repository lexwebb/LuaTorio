-- Cookbook 3–5: red data filtered by a green presence/count mask.
local data = bag_const(
  "signal-A", 5,
  "signal-B", 7,
  "signal-C", 9
)
local mask = bag_const(
  "signal-A", 1,
  "signal-B", 7,
  "signal-C", 8
)

local included = bag_filter("include", data, mask)
local excluded = bag_filter("exclude", data, mask)
local limited = bag_filter("limit", data, mask)

output("signal-A", included)
output("signal-B", excluded)
output("signal-C", limited)
