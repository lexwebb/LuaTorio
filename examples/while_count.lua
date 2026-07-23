-- Clocked while: count up to signal-L, one increment per game tick.
-- Emits as a fused sticky+copy-increment decider clock (#50).
local i = 0
local lim = input("signal-L")
while i < lim do
  i = i + 1
  tick()
end
output("signal-A", i)
