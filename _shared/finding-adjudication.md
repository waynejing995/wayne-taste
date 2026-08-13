# Finding adjudication — what a review finding may and may not change

A dual review is a **detector**, never an owner. It judges one artifact's bytes, and it is right to report that the artifact does not say what it must say — including when a decision log supplied alongside it already holds the answer. What it cannot do is tell "the artifact dropped a decision" apart from "the decision itself is wrong": the first is a transcription repair, the second belongs to the user alone, and no review protocol gives a reviewer standing over the second.

So between the review gate and any revision, the **main agent** classifies every finding against the frozen decision log. No artifact byte changes before that classification exists.

Owned here; used by `wayne-mind-explode` (node ADJ, after K) and `wayne-plan` (node ADJ, after G). Neither restates the taxonomy.

## Why the node exists

Without it the loop is a one-way ratchet: revising makes a finding disappear and defending it does not, so the next round raises it again. The only terminating move becomes changing the design until the reviewer stops objecting, which silently overwrites a user decision. Wayne's threshold, verbatim: _unless the risk is materially larger than what was known when the decision was made, or we discuss it, the decision stands._

## Dispositions

Classify each `F<number>` against the decision log as frozen at review time.

| Disposition | Test | Action |
| --- | --- | --- |
| `CARRIER_LOSS` | a recorded decision already answers it, and the reviewed artifact dropped, weakened, or contradicted that decision | fix the artifact to match the decision; no user needed |
| `REAL_DEFECT` | nothing decided this; a genuine gap or error in the artifact | fix normally |
| `CHALLENGES_DECISION` | it contradicts a recorded decision that is still in force | **never fix**; route to the user carrying the `D<number>` |
| `UPSTREAM_GAP` | it exposes an undecided question this stage does not own | route to that stage's upstream node |

`CARRIER_LOSS` is the common case and the cheap one: the reviewer is right about the bytes and the decision log already holds the answer. Treating it as `CHALLENGES_DECISION` wastes a user turn; treating a real challenge as `CARRIER_LOSS` is how a decision gets overwritten. When the two are genuinely indistinguishable, ask.

## Routing a `CHALLENGES_DECISION`

The question carries three things and nothing else:

1. the `D<number>` and what it decided,
2. the finding verbatim,
3. what evidence or risk the reviewer has that was **not** on the table when the decision was made.

Two outcomes, both terminal:

- **Stands.** Record the rejection and continue. The finding is now non-blocking and stays non-blocking when a later round raises it again — the artifact is not edited to make it go away.
- **Reopened.** The reversal is a new decision record naming the old one in `supersedes` (see `pipeline-id-contract.md`). Nothing else reverses a decision — not a reviewer, not the main agent, not a revision that quietly makes the finding disappear. A stage that cannot write the decision log stops and routes upstream instead of reversing it locally.

## The gate

```
PASS ⟺ two valid executions on the final digest
      ∧ every finding either resolved by a revision
                        or carrying a non-blocking adjudication
```

A raw reviewer verdict is **input** to this node, never the gate itself: a non-empty findings list arrives here whatever the voice called it, and a `PASS` carrying findings is not a pass. A gate that instead requires an empty findings list cannot terminate without capitulating to a defended decision, which is the failure this file exists to prevent.

## The record

One adjudication entry per finding: the `F<number>`, its disposition, the owning `D<number>` where applicable, the evidence it rests on, the action taken, and the user's outcome when one was needed. No new artifact is created for it:

- `wayne-mind-explode` — that round's `decision` record with `"source":"review"` enumerates the dispositions; a user's rejection or reversal is its own record.
- `wayne-plan` — the plan's own review record.
