-- Accumulator: each game tick, total := total + signal-A
local total = 0
total = total + input("signal-A")
output("signal-B", total)
