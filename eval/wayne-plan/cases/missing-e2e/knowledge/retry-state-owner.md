---
type: lesson
trigger: Adding retry or idempotency state to an in-memory service and store.
---

# Keep retry identity with its state owner

Do not let the service and store maintain separate idempotency maps. A timeout can
leave them disagreeing. Put records and the lookup index behind one store API and
test duplicate submission through that owner.
