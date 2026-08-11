---
type: Design Spec
title: Service-to-service authentication
description: how internal callers prove identity to the dispatcher
tags: [auth, platform]
status: stable
generated: { by: human:wayne, at: 2026-05-02T00:00:00Z }
verified: [{ by: wayne-verify/1, at: 2026-05-03T00:00:00Z }]
---

# Service-to-service authentication

## TL;DR

Internal callers present a signed service token; the dispatcher verifies it once
at the boundary and passes an authenticated principal inward.

## Decisions

### D7 — The dispatcher verifies the caller token at the boundary, not per handler

One verification point keeps the trust boundary auditable.

- **Consequences** — a handler cannot re-check identity cheaply; it must trust the
  principal it is given.
- **Decided** — 2026-05-02, by user
