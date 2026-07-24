-- Roboport logistic network contents as an input_from bag (#82).
-- Inject the bag in Simulate via entityInputs (not a live logistics sim).
local port = place("roboport", 0, 0)
local net = input_from(port)
local iron = net["iron-plate"]

output("signal-A", iron)
