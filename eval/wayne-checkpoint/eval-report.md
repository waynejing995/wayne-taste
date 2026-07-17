# Eval: Wayne Checkpoint

## Versions

| Side | Tree SHA-256 | SKILL.md | Forge static |
|---|---|---:|---|
| Control | `4fa9cde11894786d41ad84dd99b520e61ac424369b22e4e3a10490349d9cb055` | 462 lines / 2393 words | 4 pre-existing errors, 4 warnings |
| Candidate | `1843b27ec86861a2876c5b83c30b81e12b18f3afcb3467b90b48c381d9f1d3c3` | 471 lines / 2471 words | same 4 errors, 4 warnings |

Trials used Claude Opus 4.8 and `dvue-aoai-001-gpt-5.6-sol`, both at high
effort, in fresh isolated workspaces. The final frozen harness hash is recorded
in `harness.sha256`.

## Paired result

| Case | Claude control | Codex control | Claude candidate | Codex candidate |
|---|---|---|---|---|
| `plan-regression` | FAIL: omitted out-of-scope | PASS | PASS | PASS |
| `fix-now` | FAIL: no route/snapshot | FAIL: no route/snapshot | PASS | PASS |
| `needs-plan` | FAIL: no route/snapshot | FAIL: no route/snapshot | PASS | PASS |
| `escalate-architecture` | FAIL: no route/snapshot | FAIL: no route/snapshot/acceptance | PASS | PASS |
| `external` | FAIL: wrote a Wayne packet | FAIL: wrote a Wayne packet | PASS | PASS |

The candidate does not derive triage routing. It validates and preserves the
caller-selected Skill plus route/snapshot metadata. With no internal Skill target,
it writes no packet and returns `NO_WAYNE_HANDOFF`.

## Validation

- Calibration: PASS, 5 valid routes and 8 independent mutations.
- Candidate behavior: 10/10 PASS; no invalid final cells.
- Live-path smoke: `fix-now` PASS on Claude and Codex.
- Live tree equals the evaluated candidate byte-for-byte.
- Diff check: PASS.
- Forge static: unchanged at 4 errors and 4 warnings; this bounded fix does not
  claim the legacy 471-line checkpoint Skill is Forge-clean.

## Verdict

Accept this bounded compatibility fix. It flips every targeted non-linear handoff
failure on both agents and preserves the control-pass Codex plan handoff.

Residual uncertainty: save/list/resume behavior was preserved textually rather
than rerun end-to-end. The older checkpoint Skill still needs a separate full
optimization to remove its inherited static errors; that is deliberately outside
this blocker fix.
