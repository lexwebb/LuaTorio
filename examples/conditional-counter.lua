-- Conditional counter: each tick, if signal-C then x := x + 1 else x := x - 1
local x = 0
local c = input("signal-C")
if c then
  x = x + 1
else
  x = x - 1
end
output("signal-A", x)
