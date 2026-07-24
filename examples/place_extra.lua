-- Broader place allowlist: chests, poles, lamp (#82).
local a = input("signal-A")
output("signal-B", a + 1)

place("wooden-chest", 6, 0)
place("iron-chest", 8, 0)
place("steel-chest", 10, 0)
place("small-lamp", 6, 2)
place("small-electric-pole", 4, 2)
place("medium-electric-pole", 4, 4)
place("big-electric-pole", 2, 4)
place("substation", 0, 4)
