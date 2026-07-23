-- Among present rank scores, pick the minimum (selector select, index 0, ascending).
-- 0 = absent. Useful for priority tables without encoding domain names in the language.
local p1 = input("priority-1")
local p2 = input("priority-2")
local p3 = input("priority-3")
local best = signal_at_asc(0, p1, p2, p3)
output("signal-N", best)
