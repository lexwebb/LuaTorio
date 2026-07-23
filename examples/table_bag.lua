-- v4 table syntax is a constant multi-signal bag.
local request = {
  ["iron-plate"] = 10,
  ["signal-A"] = -1,
}

-- A literal-key lookup samples one scalar channel from the bag.
local iron = request["iron-plate"]
local iron_only = bag_filter("include", request, { ["iron-plate"] = 1 })

output("iron-plate", request)
output("signal-A", request)
output("signal-B", iron)
output("signal-C", iron_only["iron-plate"])
