-- Cookbook SR latch: Q' = (Q or S) and not R (circuit 0-falsy)
-- Prefer sr() over and/or soup — `r and 0 or …` is wrong under circuit truthiness.
local q = 0
local s = input("signal-S")
local r = input("signal-R")
q = sr(q, s, r)
output("signal-Q", q)
