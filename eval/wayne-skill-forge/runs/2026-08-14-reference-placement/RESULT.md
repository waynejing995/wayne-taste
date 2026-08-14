# Result — forge revision: reference placement decision

Run date 2026-08-14. Stage 1 only (paired generation). Stage 2 downstream execution was not run; see "What this does not establish".

## Frozen inputs

| Arm | Forge | sha256 |
| --- | --- | --- |
| control | `control/SKILL.md` | `0a65e0e412238eddc0dc81067167def8e05af6359021a7c457f0a785c190eb86` |
| candidate | `candidate/SKILL.md` | `f8e53bc808dc8d36d395529ac97d8335a45fcea388b2197dd02cac7e4da91aec` |

Cases: `task/case-1-regression-evidence.md` (reconstructed regression fixture), `task/case-2-heldout-evidence.md` (held-out, neutral phrasing). Four fresh agents, identical model, tools, and instructions; only the forge path differed.

An earlier attempt was discarded: the candidate file was edited while its generator was running, and the first case announced its own conditional material, telling both arms the answer.

## Observed

| Arm | references | templates | scripts | `SKILL.md` words |
| --- | ---: | ---: | ---: | ---: |
| c1-A control | 2 | 1 | 1 | 1030 |
| c1-B candidate | 3 | 1 | 1 | 1292 |
| c2-A control | 2 | 0 | 0 | 1036 |
| c2-B candidate | 2 | 0 | 1 | 1177 |

All four passed the loader validator with 0 errors and prettier clean. All four produced a coherent placement rationale unprompted.

## Verdict: the regression did not reproduce

**The control forge produced references in both cases, with direct links and load gates.** The failure this revision targets — a skill shipped with zero references and conditional detail inlined — did not occur on either control arm.

Consequences, stated plainly:

- This A/B **does not** show that the patch fixes anything. Two ties.
- It **does** show no hard-boundary regression: loader validity, prettier, archetype fit, and placement reasoning all held on the candidate side.
- The one measurable difference is against the candidate: its bodies are larger (+262 and +141 words), still inside the forge's 800–1500 target but moving the wrong way for a change whose premise is that material should move out of the body, not that the body should grow.

## Causal attribution: unresolved

The historical 0-reference outcome is real and observed — `wayne-codebase-report` was shipped without any reference and gained them only after the user asked. What is unresolved is why.

Three explanations remain live, and this run separates none of them:

1. The forge's cut-first framing biases toward inlining, and the fixture was too easy to expose it.
2. The original run happened inside a long, interrupted working session where the forge was not re-read at drafting time. This is a plausible contributor and is *not* established — a single clean control success cannot attribute the failure to the operator.
3. The user reports a *tendency*, not a deterministic bug. A tendency will not appear reliably in n=2 paired trials, and its absence here is weak evidence.

Do not write this up as "A/B proved the fix". The honest sentence is: the patch is a policy clarification the user asked for, statically valid and regression-free, with behavioural benefit unproven.

## What this does not establish

- Stage 2 was not run. No fresh downstream agent executed a real task through the generated child skills, so nothing is known about whether the extra reference in `c1-B` is discovered and used, or whether it is a split file that costs a hop.
- Two cases is below the forge's own five-case bar for a trigger-sensitive or high-risk change.
- The regression fixture is reconstructed from a transcript, not the bytes the original author received.

## Recommendation

Keep the patch on its own merits as a written policy — move-before-cut and "optionally loaded, never optionally correct" are correct statements of intent regardless of this run — and do not cite this eval as evidence that it changes behaviour. Revisit if a future skill again ships with conditional detail inlined; that occurrence, captured with its prompt frozen at the time, is the case this run could not manufacture.
