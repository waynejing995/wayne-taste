---
type: Design Spec
title: Shared delivery queue
description: one queue carries every outbound delivery
tags: [queue, platform]
status: stable
generated: { by: human:wayne, at: 2026-05-04T00:00:00Z }
---

# Shared delivery queue

## TL;DR

Outbound deliveries go through one shared queue so ordering and backlog are
observable in a single place. Approved, not yet exercised in production.

## Decisions

### D2 — Every outbound delivery goes through the shared queue

A single queue keeps ordering and backlog observable; per-caller queues would
hide both.

- **Consequences** — a slow consumer delays every caller behind it.
- **Decided** — 2026-05-04, by user
