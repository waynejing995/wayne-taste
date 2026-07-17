# Eval: Wayne Work — restore required safe parallel waves

## Versions

| Side | Skill SHA-256 | Tree lock | Lines | Words | Forge static |
|---|---|---|---:|---:|---|
| Control | `87ef0aafba82f09ab9d894f97b96b5e69826b86c9fdf24f92d1fbdc2dbd60878` | `88f32584211afd1849e665bc51b12ccb6b46cb536118ba7fc9e64ec6c83a706c` | 164 | 1062 | 0 errors, 0 warnings at its live path |
| Candidate | `5d82b195e6acde750518717480087def2ec416026afa3c8be342b1a5a29912e9` | same as live skill hash | 180 | 1202 | 0 errors, 0 warnings |

Harness hash: `b0463fd5621ef627eb60b015a96be95f5fd6ceedf69ee4bf514c82206f3ae00f`.
Trials used Claude Opus 4.8 at high effort and
`dvue-aoai-001-gpt-5.6-sol` at high effort.

## Targeted result

| Case | Claude control | Codex control | Claude candidate | Codex candidate |
|---|---|---|---|---|
| `parallel-disjoint` | FAIL: no unit Agent calls; no handoff | FAIL: no native dispatch attempt; no handoff | PASS: two calls dispatched before either result | PASS: native attempt observed; exact tool error surfaced; explicit serial fallback |

The case has two ready units with no dependency and disjoint write sets. The
Claude trace proves both unit-specific workers were dispatched before either
returned. The current Codex exec runner returns `collab spawn failed: no thread
with id`; the accepted behavior is an observable native attempt, the exact error
in both handoff and final output, and an explicit serial fallback without a false
parallel claim.

Both candidate cells also pass implementation, hidden tests, unit/full commands,
per-worker contract checks, U/E ownership, scope, and durable return-only handoff.

## Held-out regressions

| Case | Claude candidate | Codex candidate |
|---|---|---|
| `normal` | PASS | PASS |
| `protected` | PASS | PASS |
| `missing-u` | PASS | PASS |

The normal case preserves RED → unit GREEN → full GREEN, locked tests, hidden
tests, U-only status changes, E ownership, scope, and the review handoff. Both
blocker cases preserve zero mutation and the exact five-line blocker contract.

The final live-path `parallel-disjoint` smoke also passed with Claude and Codex.

## Calibration and invalidated trials

Calibration passes 5 positive cells and 13 independent mutations, including
serial workers, missing worker contract fields, fake/no trace, hidden fallback,
test weakening, U/E drift, missing RED, extra scope, and forbidden commit.

Several intermediate trials were invalidated because the checker overfit prose
serialization: `committing` versus `do not commit`, `matrix` versus `matrices`,
mixed-language verification text, `scope_preserved` versus `preserved_scope`, and
`Implementation Handoff` versus `Work Handoff`. Those forms were added as positive
calibration variants or the redundant prose check was removed. No Skill rule was
added merely to satisfy those spellings.

Behavioral candidate revisions were limited to observed failures:

- require a durable checkpoint file rather than a prose-only handoff;
- quote a native dispatch error in both packet and final output;
- repeat the literal `wayne-code-review` in the final output.

## Verdict

Accept. The 16-line increase restores the historical must-attempt safe-parallel
behavior, fixed worker contracts, one-owner write sets, wave barriers, explicit
failure fallback, and durable handoff without reintroducing provider-specific
task/team APIs.

Residual uncertainty: real overlap is proven on Claude. Codex overlap cannot be
proven while its native spawn path returns the runner error; that cell proves the
required attempt and fail-loud serial fallback instead. Mixed-wave timing and
shared-integration repair remain future held-out cases.
