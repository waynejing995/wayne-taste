---
type: Design Spec
title: Queued webhook delivery
description: how webhook deliveries leave the request path
tags: [webhook, delivery]
status: stable
generated: { by: human:wayne, at: 2026-06-01T00:00:00Z }
---

# Queued webhook delivery

## TL;DR

Webhook delivery is being moved off the request path. This run amends the page.

## Decisions

### D1 — Webhook delivery leaves the request path

Delivery failures must not fail the caller's request.

- **Consequences** — delivery becomes asynchronous and needs its own frontier.
- **Decided** — 2026-06-01, by user
