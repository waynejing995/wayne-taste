---
name: <kebab-name>
description: <180-400 characters: what situation family this routes, when to use it, concrete trigger phrases, and the no-match boundary.>
---

# <Skill title>

<One sentence: select one playbook from observable evidence; do not execute every playbook.>

<!-- Map every routing requirement to one owner before compressing. Add a schema
     and checker only when a named non-AI consumer requires them; AI-readable
     routing prose is judged semantically. -->

## Playbooks

<!-- Require at least three genuinely different playbooks. Each reference is one
     level below SKILL.md and owns its complete procedure. -->

| Observable signal | Playbook | Result |
| --- | --- | --- |
| <checkable condition A> | `references/<playbook-a>.md` | <one line> |
| <checkable condition B> | `references/<playbook-b>.md` | <one line> |
| <checkable condition C> | `references/<playbook-c>.md` | <one line> |
| none match | — | stop, report missing coverage, ask only if needed |

## Flow

```mermaid
flowchart TB
    A["Collect routing evidence"]
    B{"Which signal matches?"}
    C["Read playbook A"]
    D["Read playbook B"]
    E["Read playbook C"]
    X(["Stop: no playbook fits"])
    G(["Run selected playbook"])

    A --> B
    B -->|"A"| C
    B -->|"B"| D
    B -->|"C"| E
    B -->|"none"| X
    C --> G
    D --> G
    E --> G
```

## Process

### A. Collect routing evidence

- Gather only fields used by the selection table.
- Verify: every routing claim traces to an observed value.

### C. Read playbook A

- Read `references/<playbook-a>.md` completely, then follow it.

### D. Read playbook B

- Read `references/<playbook-b>.md` completely, then follow it.

### E. Read playbook C

- Read `references/<playbook-c>.md` completely, then follow it.

<!-- Do not repeat playbook internals here. Add routing anti-patterns only when
     an eval shows a recurring misroute. -->
