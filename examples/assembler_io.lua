-- Assembler recipe + enable from circuit (#80).
local asm = place("assembling-machine-2", 0, 0)
local enable = input("signal-A")

configure(asm, {
  set_recipe = true,
  circuit_enabled = true,
  circuit_condition = { signal = "signal-A", comparator = ">", constant = 0 },
  recipe = "iron-gear-wheel",
})

-- Circuit recipe bag (item/recipe signal → set recipe when enabled).
output_to(asm, { ["iron-gear-wheel"] = 1 })

-- Mirror enable for playground visibility.
output("signal-B", enable > 0 and 1 or 0)
