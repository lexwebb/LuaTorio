-- 2-to-1 multiplexer: signal-C = signal-A when signal-S > 0, else signal-B
local sel = input("signal-S")
local a = input("signal-A")
local b = input("signal-B")
output("signal-C", sel > 0 and a or b)
