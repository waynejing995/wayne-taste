# Contract protection

Use mechanical validation only for a contract consumed by a real parser, API,
loader, executable, or storage engine. Do not create a machine schema merely because
one agent hands Markdown to another agent.

## Decide whether a machine contract exists

Name the consumer before designing a schema:

| Consumer | Protection |
|---|---|
| skill loader | YAML frontmatter parsing, required fields, naming rules |
| JSON/API parser | its published schema, enums, references, and error behavior |
| executable or CLI | argv, exit status, stdout/stderr, and filesystem effects |
| AI reading Markdown | semantic ownership, source grounding, and behavioral review |

If no non-AI consumer exists, stop. Use a readable example or template as guidance,
not as a grammar, and let independent agents judge whether the artifact preserves
intent and supports the downstream task.

## Map requirements before compression

Build a temporary map and delete it before delivery:

| Requirement | Failure if omitted | Single owner | Proof |
|---|---|---|---|
| `<approved clause>` | `<observable failure>` | body / reference / template / script / eval | `<evidence>` |

- Every approved clause has one owner and one proof.
- Split independent directions, transitions, and relationships into separate rows.
- A template demonstrates an accepted output; it does not silently become a grammar.
- An eval exercises behavior; it does not compensate for a missing instruction.
- Contradictory clauses block authoring. Report both sources and return precedence to
  the upstream owner instead of encoding one interpretation in a checker.

For an AI-readable artifact, trace requirements to semantic review cases. Preserve
literal spelling only when the user or an authoritative source makes the bytes
normative. Otherwise preserve meaning, modality, ownership, timing, and accepted or
rejected behavior rather than surface wording.

## Protect a real machine interface

When a machine contract does exist:

1. Cite the external consumer and its authoritative contract.
2. Keep one schema owner; do not independently redefine it in prose and code.
3. Check only directly observable fields, types, enums, references, hashes, event
   order, exit status, or side effects required by that consumer.
4. Test one valid example and one mutation per independent invariant.
5. Keep semantic claims out of the checker.

Exact bytes are normative only when the external contract says they are. A heading,
keyword, table layout, sentence count, arrow count, or regex match over prose cannot
prove completeness, causality, intent, or quality.

### Bind the checker to its real oracle

Classify each machine invariant by what the checker must observe:

| Invariant | Required oracle input |
|---|---|
| local fields, types, enums, references | generated machine artifact |
| verbatim machine payload | artifact plus original source |
| real path or symbol | artifact plus repository surface |
| CLI behavior | argv plus exit status, streams, and side effects |
| downstream execution | sanitized workspace plus hidden acceptance task |

A checker cannot claim source fidelity or completeness without reading the source.
Use Git `HEAD` and status for repository scope evidence; do not recursively open or
hash unrelated files. Agent write history and the final diff own mutation review.

### Prove only the machine invariants

For every bundled checker or operational script:

1. Run one known-valid fixture against the real consumer contract.
2. Mutate each independent field, reference, state, or side effect and require the
   expected failure.
3. Run the actual artifact through the real parser, API, loader, or executable.
4. Keep semantic review separate; a script pass proves only the named interface.

Keep test fixtures in the eval harness unless runtime users need them. Inspection is
not execution, and agreement between a template and its own checker is not proof
that either matches the external consumer.

### Compress without dropping behavior

Delete decoration and duplicated explanation first. Keep failure and stop terminals,
state ownership, approval boundaries, retry and timeout semantics, exact machine
contracts, and the observable proof of completion. Context size is a tie-breaker
only after behavior is preserved.

## Eval boundary

Eval code may use regex or shape checks to locate evidence and raise a reviewer
question. Treat that result as an observation, not an automatic behavioral verdict.
A fresh AI judge must read the task, sources, artifact, and evidence to decide the
meaning. A paraphrase with the same meaning must remain eligible to pass.

## Runtime cost gate

Never make a user workflow scan unrelated repository files, construct a full-tree
manifest, or repair permissions merely to validate an AI-readable document. Prefer
Git's own commit/status evidence for scope, and run a mechanical checker only when
the named machine consumer would otherwise reject or misexecute the artifact.
