local a = input("signal-A")
output("signal-B", a + 1)

-- Absolute blueprint tile positions; these are not wired by LuaTorio.
place("wooden-chest", 4, 0)
place("small-lamp", 4, 2)
place("medium-electric-pole", 2, 2)

-- Logistic chest with circuit enable condition (#82).
local gate = place("logistic-chest-requester", 8, 0)
configure(gate, {
  set_requests = true,
  requests = { ["iron-plate"] = 50 },
  circuit_condition_enabled = true,
  circuit_condition = { signal = "signal-G", comparator = ">", constant = 0 },
})
