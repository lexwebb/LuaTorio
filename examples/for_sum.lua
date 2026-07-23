-- Clocked for: sum 1..10, one iteration per game tick.
-- Induction/`__run` fuse to one clock; `sum += i` stays a gated hold (#50).
local sum = 0
for i = 1, 10 do
  sum = sum + i
  tick()
end
output("signal-A", sum)
