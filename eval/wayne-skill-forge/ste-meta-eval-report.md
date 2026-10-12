# Forge meta-eval: STE-lite revision

Control forge `92fd871` (before the revision). Candidate forge `01568b5` (defect fixes, `references/instruction-prose.md`, STE-lite body). Driver: `meta_eval.py`. Raw runs are under the gitignored `eval/.runs/wayne-skill-forge/`.

## Setup

| Item | Value |
| --- | --- |
| Generator | fresh Claude Code 2.1.296, Opus 5.5, effort high; one child per arm and archetype |
| Downstream | fresh Claude (Opus 5.5, high) and Codex (`gpt-6-sol`, high) in `run_isolated_agent.sh` |
| Archetypes | procedure (`staged-rollout`), loop-back procedure (`recoverable-rollout`), lens, router |
| Blindness | neutral child IDs; judges read only an anonymized packet outside the run directory |

| Run | Content | Trials |
| --- | --- | --: |
| `2026-10-12-ste-final` | procedure, lens, router; one trial per cell | 44 |
| `2026-10-12-ste-loop` | loop-back procedure; one trial per cell | 16 |
| `2026-10-12-ste-proc-reps` | both procedure fixtures, the same children, 3 repetitions, with command transcripts | 84 |

All eight children passed `validate_skill.py`. No trial was invalid.

## Deterministic gates

Event sequences and output structure passed in every trial of both arms. That includes the loop-back fixture: repair, then re-verify, at most two repairs, stop on a non-recoverable failure, and never a second apply.

The first two runs could not audit the commands that Claude ran, because `claude -p --output-format json` records no tool calls. One Claude trial admitted that it appended `; echo "exit=$?"` to a request command. That trial bought the command audit: the runner now captures the Claude stream, and `meta_eval.py` compares every `harness.py` invocation with the exact request commands. The repetition run used the audit:

| Agent | Control: trials with a changed request command | Candidate: trials with a changed request command |
| --- | --: | --: |
| Claude | 21 / 21 | 14 / 21 |
| Codex | 0 / 21 | 0 / 21 |

Every changed command was the same append: `; echo "EXIT=$?"`. Both intents make the outcome depend on the exit status, and Claude Code shows an exit code only for a failed command. In the candidate loop child (`loop-g2`), 7 of 12 Claude trials kept every command unchanged. That child is the only one that tells the agent to branch on the verify status line, not on the exit status. Both statements in this paragraph are observations. That the exit-status dependency causes the append is an inference, and no run isolated it.

## Blind semantic judge

The first judge pass used rubric items that no published intent clause supports, for example extra routing rationale. That pass was discarded. The judges then re-scored every pair under a rule: a verdict counts only if it quotes an intent clause, and otherwise the pair is a tie.

| Archetype | Candidate wins | Control wins | Ties | Traceable clause behind each win |
| --- | --: | --: | --: | --- |
| procedure | 0 | 0 | 6 | — |
| loop-back | 0 | 1 | 7 | "Do not run a command that the request does not contain." (the self-reported echo) |
| lens | 0 | 2 | 4 | "Cite observation IDs exactly." (two Codex outputs from the candidate child cite no IDs in Inferences and Alternatives) |
| router | 0 | 0 | 10 | — |

## Child size and cost

| Child | Control words | Candidate words |
| --- | --: | --: |
| procedure `SKILL.md` | 640 | 712 |
| loop-back `SKILL.md` | 586 | 762 |
| lens `SKILL.md` | 1,296 | 1,096 |
| router total (with 3 references) | 1,543 | 1,659 |

Candidate children have no semicolons and shorter sentences: an average of 13.1–16.7 words per sentence, against 16.9–20.5 for control.

## Verdict

**Not passed. Needs fix.**

- **Hard-boundary gate (`references/eval.md` §5): fail.** In 14 of 21 Claude trials, the candidate changed a request command. A hard-boundary score of 0 fails the candidate. The control fails the same gate (21/21), but the control failing does not make the candidate pass.
- **Output reliability (`references/eval.md` §6): fail.** Two lens outputs from the candidate child cite no observation IDs in Inferences and Alternatives. The intent requires "Cite observation IDs exactly". The control outputs did not lose this.
- **Cause: not isolated.** That every child forbids changed commands, and that the exit-status dependency drives the append, are inferences. No experiment separated the forge text from the intent, the runtime, or generator variance.
- STE-lite shows no measured benefit in this run.
- The candidate commits stay in history as a revertable candidate. Revert `01568b5`, `b318bd5`, and `570d5fa` to return to the defect-fixed forge at `b38d6a7`.

## Open items

- Smallest correction for the boundary failure: one forge rule about runtime-visible success signals. Then regenerate both procedure children and rerun the failed cases and their neighbors with the command audit.
- Smallest step for the lens loss: rerun the lens cases with repetitions, and regenerate the child, to find out whether the loss is systematic or comes from one child.
- One child per arm and archetype. Generator variance is not measured.
- The lens and router deterministic cases are at ceiling. Harder cases need to come from an observed failure.
- The hypotheses in `references/instruction-prose.md` are still open: a weaker downstream reader and trigger recall were not tested.
