-- Clamps signal-A to [0, 100], output on signal-B
local raw = input("signal-A")
local clamped = raw < 0 and 0 or (raw > 100 and 100 or raw)
output("signal-B", clamped)
