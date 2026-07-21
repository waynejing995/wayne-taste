# Forge loader-validation Flow evidence

The original paired-trial candidate tree was
`e053ca980fc0e8d0a97ab8add62361c07d7230864bfe1ed7348e2a7212531cab`
(262 lines / 2056 words).

## Gates

- Flow structure: PASS.
- Calibration: PASS; missing decision, missing failure edge, missing success edge,
  and direct loader-to-behavior bypass are all rejected.
- Same malformed-child task:

| Model | Validator at trial time | Behavioral smoke | Child mutation | Semantic gate |
|---|---|---|---|---|
| Claude Opus 4.8 | 4 errors observed | not run | byte-identical | PASS |
| Codex `dvue-aoai-001-gpt-5.6-sol` | 4 errors observed | not run | byte-identical | PASS |

Both agents returned to revision and did not enter approval, write, install, sync,
commit, or publication. The case intentionally includes a smoke script that would
exit zero, so behavioral success cannot bypass malformed frontmatter.

The current loader-only validator reports one direct `frontmatter` error on the
same child. Its calibration accepts arbitrary Markdown and supported metadata while
rejecting malformed loader metadata. The cross-agent trial was not rerun for this
terminology-only Flow update.

Residual uncertainty: this targeted case exercises the loader-failure branch,
not the full procedure/lens/router meta-eval. The existing archetype harness remains
separate and was not staged as part of this change.
