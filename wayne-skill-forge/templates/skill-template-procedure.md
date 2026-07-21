---
name: <kebab-name>
description: <180-400 characters: what the workflow does, when to use it, concrete trigger phrases, and the closest do-not-trigger boundary.>
---

# <Skill title>

<One sentence: the unique result this skill guarantees.>

<!-- Add a compact Boundary section only when a neighboring skill can be confused
     with this one. Do not add an Inherits block or a body When-to-Run section. -->

<!-- Before compressing, map every approved requirement to body / reference /
     template / eval. AI-readable output stays semantic. Add a machine schema or
     checker only when a named parser/API/executable consumes the output. -->

## Flow

<!-- Keep Flow only when there is a branch, loop, retry, approval gate, or multiple
     terminals. Otherwise delete this section and use one numbered Process. Flow
     owns sequence and branching; Process expands node details without restating it. -->

```dot
digraph <name> {
    rankdir=TB;

    A [label="Prepare input", shape=box];
    B [label="Ready to act?", shape=diamond];
    C [label="Resolve missing requirement", shape=box];
    D [label="Execute workflow", shape=box];
    E [label="Verification passes?", shape=diamond];
    F [label="Revise from failure", shape=box];
    G [label="Done", shape=doublecircle];

    A -> B;
    B -> C [label="no"];
    C -> A;
    B -> D [label="yes"];
    D -> E;
    E -> F [label="no"];
    F -> D;
    E -> G [label="yes"];
}
```

## Process

### A. Prepare input

- Input: <exact artifact or state>.
- Action: <skill-specific action>.
- Verify: <observable condition>.

### C. Resolve missing requirement

- Ask or fail only when the missing fact cannot be discovered safely.
- Verify: <required fact now exists>.

### D. Execute workflow

- Action: <the non-obvious sequence or local rule>.
- Output: <artifact or state transition>.
- Verify: <observable condition>.

<!-- Test bundled operational scripts by executing their real job. -->

### F. Revise from failure

- Use the failed check as evidence; change one variable at a time.
- Return to D after the cause is addressed.

<!-- Add Red lines or Anti-patterns only for observed, recurring failures. -->
