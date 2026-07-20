---
title: Metrics export
status: active
---

# Metrics Export Plan

Add a read-only `relay_queue.metrics.snapshot(store)` function in a later change.
It depends only on `InMemoryDeliveryStore.all()` remaining available. It does not
own delivery identity, retry state, or dispatch behavior.
