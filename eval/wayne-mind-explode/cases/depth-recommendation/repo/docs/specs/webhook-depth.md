---
type: Design Spec
title: Webhook payload signing
description: how a receiver proves a webhook came from us
tags: [webhook, security]
status: stable
generated: { by: human:wayne, at: 2026-06-01T00:00:00Z }
---

# Webhook payload signing

## TL;DR

Every webhook body is signed with the tenant key so a receiver can verify origin.
This page is in force; the current run amends it with delivery decisions.

## Decisions

### D1 — Webhook bodies are signed with the tenant key

A per-tenant key lets a receiver verify origin without a shared secret, and lets
one tenant rotate without affecting another.

- **Consequences** — key rotation becomes a per-tenant operation with its own
  overlap window.
- **Decided** — 2026-06-01, by user
