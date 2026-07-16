# Delivery Architecture

`Dispatcher` is the sole owner of delivery lifecycle state. API handlers submit
commands but do not write state directly. The current implementation is in-memory;
durability is deliberately outside the approved evaluation feature.

No active implementation plan exists. New design specs must preserve one lifecycle
owner and must not introduce a second state representation.
