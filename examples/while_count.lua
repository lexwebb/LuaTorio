-- Clocked while: count up to signal-L, one increment per game tick
local i = 0
local lim = input("signal-L")
while i < lim do
  i = i + 1
  tick()
end
output("signal-A", i)
