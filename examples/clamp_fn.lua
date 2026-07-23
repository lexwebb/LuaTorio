-- v3 user functions are compile-time templates, fully inlined at each call.
local function clamp(value, lo, hi)
  return value < lo and lo or (value > hi and hi or value)
end

local raw = input("signal-A")
output("signal-B", clamp(raw, 2, 100))
