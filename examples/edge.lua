-- Cookbook 19: rising edge on a scalar level signal.
local level = input("signal-L")
local pulse = edge(level)

output("signal-P", pulse)
