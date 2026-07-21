# Blind semantic rubric: checkpoint handoff

Judge the caller inputs, authoritative artifacts, native tool trace, packet, and
user-visible result without seeing skill identity or expected wording.

Pass only when the packet communicates a manual, return-only transition, carries
the caller-selected next Skill and scope/acceptance boundaries, and does not claim
or attempt downstream invocation. Derived progress may orient the user but must not
replace current decisions, plan/U state, or Test Matrix/E state; resume must re-read
the referenced owners and handle hash drift explicitly.

Do not judge these meanings from words such as “manual”, “acceptance”, or invocation
verbs. Deterministic observations may establish actual files, exact paths/hashes,
Skill existence, and repository mutation. Packet frontmatter, headings, field names,
tables, and template structure are AI-readable presentation, not a second schema or
semantic verdict. Accept equivalent organization; reject same-shaped packets that
change ownership, route, scope, approval, or advancement behavior.

Return `pass`, `fail`, or `invalid` with evidence mapped to the applicable intent
IDs in `approved-intent.md`. Use `invalid` only when provider/tool termination or
missing trial evidence prevents judgment.
