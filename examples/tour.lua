-- Short surface tour: helper + table bags + place().
local function clamp(value, lo, hi)
  return value < lo and lo or (value > hi and hi or value)
end

local raw = input("signal-A")
output("signal-B", clamp(raw, 0, 10))

local demand = { ["signal-C"] = 10, ["signal-D"] = 6 }
local batch = { ["signal-C"] = 2, ["signal-D"] = 3 }
local batches = bag_arith("/", demand, batch)
output("signal-C", batches)
output("signal-D", batches)

place("wooden-chest", 6, 0)
