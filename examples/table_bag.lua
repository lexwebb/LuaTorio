-- v4 table syntax is a constant multi-signal bag.
local request = {
  ["iron-plate"] = 10,
  ["signal-A"] = -1,
}

-- A literal-key lookup samples one scalar channel from the bag.
local iron = request["iron-plate"]

output("iron-plate", request)
output("signal-A", request)
output("signal-B", iron)
