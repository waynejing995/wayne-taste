---
title: Worker retry ownership
status: active
owner: product-design
---

# Worker Retry Ownership Plan

The next worker release makes `DeliveryService` own the retry counter and a
separate request-id cache. It fixes retries at five attempts with a constant
10-second delay so operators can predict throughput. `InMemoryDeliveryStore`
remains a record bag and must not add secondary indexes.

Implementation begins after the metrics export work and shares the same service
and store symbols as the delivery-retry request.
