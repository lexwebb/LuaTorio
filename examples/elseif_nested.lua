-- Priority state: nested conditions and elseif lower to one next-state mux tree.
local x = 0
local a = input("signal-A")
local b = input("signal-B")
local c = input("signal-C")

if a then
  if b then
    x = 1
  else
    x = 2
  end
elseif c then
  x = 3
end

output("signal-X", x)
