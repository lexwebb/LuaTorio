-- signal-D is 1 when signal-A < signal-B < signal-C (strictly ascending), else 0
local a = input("signal-A")
local b = input("signal-B")
local c = input("signal-C")
local ascending = (a < b) and (b < c)
output("signal-D", ascending)
