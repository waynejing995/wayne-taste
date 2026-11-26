# Architecture bar

One bar for judging whether the structure of a design is good. The [spec contract](spec-contract.md) says what a design must describe. This file says how to judge what the design describes. Use it when you compare design approaches, fuse two proposals, approve a design, review a spec as the engineering voice, review a diff that changes structure, or sweep a repository for structural drift.

Terms: a **component** is a unit with one owner. A **boundary** separates two components that differ in owner, runtime, or repository. An **interface** is what a component exposes across a boundary.

## Judge coupling by where it sits

Coupling is not a defect by itself. Parts that share one owner, sit inside one boundary, and change together are one component. Keep them together and put no interface between them: an interface there adds something to learn and hides nothing.

Coupling is a defect when it crosses a boundary without an interface. A change on one side then breaks the other side, and nothing reports the break. Two fixes exist. Lower what the two sides share: a typed interface, a schema, or a handle that carries the state. Or move the two sides inside one boundary. Splitting further is not a fix.

## Checks

Answer each check with yes, no, or not applicable. Cite the design section or `path::symbol` for every answer. A "no" is a finding. Other skills cite these checks by number: add a new check at the end, and do not renumber.

**Change stays local**

1. **Independent requirements do not break each other.** Can the design change to satisfy one requirement without breaking another requirement? One component that serves two requirements passes this check.
2. **One fact lives in one place.** Does each format, invariant, policy, encoding, and tool list have one owner? A rule that a prompt or skill text states while code enforces a second copy fails this check, because the copies drift and nobody re-reads the prompt copy.

**Boundary shape**

3. **The caller needs to know little.** Delete the component in your head. If its complexity reappears in every caller, the component earns its place. If the complexity vanishes, the component is a pass-through: remove it. Between two approaches, prefer the approach whose callers must know fewer signatures, orderings, errors, and settings.
4. **Dependencies across a boundary go one way and use the interface.** No cycle crosses a boundary. No component imports the internals of another component, shares mutable state with it, or writes a table that it also writes. A deferred import inside a function is a dependency. Mutual dependency inside one boundary passes this check.

**Correctness carried by the interface**

5. **Illegal states cannot be expressed, and implicit contracts are explicit.** If the caller must do A before B, B is unreachable without the value that A returns, or B fails loud. If one component parses text that another component writes (a log line, a status string), that text is an interface: give it a schema. The boundary parses external input into a domain type once.
6. **Key behavior is testable through the interface alone.** If a test must import internals, or a new single-implementation layer exists only for the test, the component has the wrong shape.

**Restraint and evolution**

7. **No abstraction without a second real variation.** A new interface or extension point needs two real variations today: two callers with different needs, or production plus a test double that a test uses. "It may be needed later" does not count.
8. **The design can land in steps.** Each step is verifiable alone, and no step forces unrelated components to change or release together. If a step cannot be undone, the design names the binding point and the fallback.
9. **Every automatic loop is bounded.** Each retry, repair, poll, and agent iteration has a cap, a stop condition, an observable state, and one owner.

Checks 1, 2, 4, 5, and 9 guard runtime behavior: a "no" can produce a wrong result or unbounded work. Checks 3, 6, 7, and 8 guard the cost of change. Each consumer of this file maps the two classes to its own severity scale.

## Make the answer hold after the review

A check answered in a review holds only on the day of the review, because a later change can break it silently. For each check that the design depends on, write the answer in a form that a machine can turn red:

- An `R<n>` whose Acceptance is the check. Examples: "the core package imports only its allow-list", "the previous release runs against the new schema", "every loop step declares a cap", "the result file validates against its schema".
- An `## Invariants` line, which `wayne-test-design` turns into a property or differential test seed. Use this form for ordering, idempotency, and at-most-one rules.

Checks 3 and 7 are judgment. They carry no machine check.

A check that covers only the code of this feature needs no further reason. A repository-wide gate (an import contract, a ratchet on a violation count, a hook) falls under the global rule that harness gates are earned: state the incident or the existing violation count next to the gate, or do not propose the gate.
