---
name: decision-builder
description: Converges a design through a durable interview and independent review gates.
---

# Decision Builder

Create the decision log before the first question. Ask exactly one recommended
question and wait for the answer. Append each answered decision to the log before
asking the next question; the log is crash-resumable state, never reconstructed at
the end.

After approval, invoke `legacy-review-addon` twice on identical spec bytes:

- `founder`: challenge premise, necessity, scope, and user value;
- `engineering`: challenge architecture, ownership, failures, tests, performance,
  observability, and rollback.

The reviews are independent. Any `REVISE` updates the spec and reruns every stale
review; inability to run both fails loud. After both pass, return a planner handoff
packet. Never auto-run the planner.
