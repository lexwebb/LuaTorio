-- Clocked for: sum 1..10, one iteration per game tick
local sum = 0
for i = 1, 10 do
  sum = sum + i
  tick()
end
output("signal-A", sum)
