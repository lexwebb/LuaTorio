-- EACH-tag sticky catalog: 1 constant + 1 decider for N recipes (#46)
-- Set when stock == 0; hold while stock < buffer and recipe already selected.
local item_a = input("item-A")
local item_b = input("item-B")
local recipes = catalog_latch(
  item_a, "recipe-A", 10,
  item_b, "recipe-B", 10
)
output("recipe-A", recipes)
output("recipe-B", recipes)
