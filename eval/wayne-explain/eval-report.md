# Eval: wayne-explain — procedural control vs short audience-aware candidate

## Result

Accept the candidate for the approved scope: one short explanation skill with optional audience or ELI depth. Five synthetic paired explanation cases showed no established regression. The metadata-only simulation improved the explicit ELI25 selection. This is not proof of host runtime activation or general reliability.

| Metric | Control | Candidate |
| --- | ---: | ---: |
| Full-file words | 409 | 83 |
| Lines | 41 | 6 |
| Description characters | 290 | 168 |
| Loader errors | 0 | 0 |

The full skill is about 80% shorter. Its only body paragraph restores missing context, calibrates to the requested audience, defaults to an adult new to the topic, keeps real names, and permits a concrete example. No fixed age table, separate per-level skills, or HTML requirement was added.

## Paired observations

| Case | Control | Candidate | Outcome |
| --- | --- | --- | --- |
| Concept confusion | Explains conflicting copies and authoritative status | Explains conflicting copies and authoritative status | Tie |
| Work status | Correct bug/change; no deployment claim | Correct bug/change; explicitly undeployed and unverified | Tie |
| Repeated confusion | Replaces jargon with a concrete payment example | Replaces jargon with a concrete payment example | Tie |
| ELI5 | Short directory analogy, with storage/maintenance cost | Short directory analogy, with storage/maintenance cost | Tie |
| ELI25 / backend engineer | Mechanism and technical trade-offs | Mechanism, composite-index example, and trade-offs | Tie |
| Metadata selection | 6/7; declines explicit ELI25 | 7/7; includes ELI25 and respects adjacent exclusions | Candidate win for approved added capability |

The corrected blind reviewer scored both groups 2/2 for explanation task success, boundaries, output, and control flow. Resource use was rated only usable because that reviewer did not receive execution traces; context efficiency was unscored while identities and skill inputs were hidden. The word savings above are a separate measured input-size observation, not a model-cost or runtime-performance claim.

## Evaluator correction

The first blind review interpreted name preservation as requiring every answer to repeat field names, a timezone identifier, and a source path from the input. The governing original clause only says to keep identifiers verbatim; it does not require an identifier inventory. That review therefore introduced an unsupported output-completeness requirement.

The initial verdict remains unchanged in the run evidence. A fresh isolated reviewer re-graded the same anonymous answers using the exact original clause and the complete scoring protocol, which had been missing from the first review workspace. It distinguished omitting a name from renaming it and found no grounded name-preservation defect. No skill, case, answer, or frozen rubric was changed to obtain this result.

## Execution and evidence

- Model: `gpt-6-astra`; reasoning effort: `high`; CLI: Codex `0.153.4`.
- Each version ran five independent explanation sessions and one metadata-only session through `eval/run_isolated_agent.sh`, using separate bubblewrap workspaces. The shared runner was unchanged.
- Cases and rubric were frozen before candidate generation. Skill snapshots and answer hashes were preserved. Hash checks passed, and the final live skill matches the evaluated candidate byte-for-byte.
- Control SHA-256: `949421bfaa0503d5647546d8beea0641bbb5e50f6b38d2fa36233ab6faea84db`.
- Candidate SHA-256: `69c4f629c6deaa45424acabf7bc5ab03e1c40a0d4683347cb11f394713296e6f`.
- Local generated evidence: `eval/.runs/wayne-explain/slim.Ss4CaA/` (gitignored).
- Answers and traces: `A/<case>/` and `B/<case>/`; A is control, B is candidate.
- Original blind verdict: `judge/codex-final.txt`; corrected verdict: `regrade/codex-final.txt`; both review workspaces retain their exact tasks and inputs.
- Static checks passed: loader validator on both snapshots, Prettier on the changed Markdown/JSON, `bash -n` on the harness, and `git diff --check`.

## Limits

One sample per case on one model, using synthetic conversations. ELI5 and engineer-oriented ELI25 received explanation trials; ELI15 received metadata selection only. ELI10, role-only requests, and actual host skill discovery were not exercised. The levels are audience cues, not calibrated age standards. No installs, syncs, commits, or publication were performed.
