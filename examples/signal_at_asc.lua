-- WarDaft-style priority: among present priority scores, pick the minimum (index 0, ascending).
-- Wire only the priorities you care about (0 = absent). Lowest nonzero rank wins.
local p1 = input("priority-1")
local p2 = input("priority-2")
local p3 = input("priority-3")
local best = signal_at_asc(0, p1, p2, p3)
output("signal-N", best)
