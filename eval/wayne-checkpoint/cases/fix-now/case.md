# Triage handoff request

- current stage: `triage`
- verdict: `fix-now`
- selected next agent: `wayne-test-design`
- snapshot: `.wayne/triage/normalize-whitespace.md`
- cause: one internal normalization branch drops surrounding whitespace
- failing repro: `normalize(" A ")` returns `" a "`, expected `"a"`
- acceptance: preserve lowercase behavior and make the failing repro pass
- out of scope: public API changes, unrelated cleanup, commit, or publish
- user approval: already granted for the return-only handoff packet
