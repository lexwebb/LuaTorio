-- Read a storage chest and drive requester requests through circuit wires.
local stock = place("logistic-chest-storage", 0, 0)
local requests = place("logistic-chest-requester", 4, 0)

local inv = input_from(stock)
local iron = inv["iron-plate"]

output_to(requests, { ["iron-plate"] = 200 })
configure(requests, { set_requests = true, request_from_buffers = true })

output("signal-A", iron)
