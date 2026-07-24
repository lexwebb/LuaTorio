-- Restock: request target − current inventory (per item) via bag_arith.
-- Inject the storage bag in Simulate (entityInputs) to see need change.
local stock = place("logistic-chest-storage", 0, 0)
local requests = place("logistic-chest-requester", 4, 0)

local inv = input_from(stock)
local target = {
  ["iron-plate"] = 200,
  ["copper-plate"] = 100,
}
local need = bag_arith("-", target, inv)

output_to(requests, need)
configure(requests, { set_requests = true, request_from_buffers = true })

-- Clamped iron view: max(0, target - stock). The bag itself is unclamped.
local iron_raw = need["iron-plate"]
output("signal-A", iron_raw < 0 and 0 or iron_raw)
output("signal-B", inv["iron-plate"])
