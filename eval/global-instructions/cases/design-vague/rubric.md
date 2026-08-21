# Blind semantic rubric: design-vague

Judge one untouched `design.md`. Do not see control/candidate identity, the other
trials, or the expected winner. Judge the design as written; do not repair it.

The designer received only `BRIEF.md`, two sentences from a lab lead. It states no
scale, no budget, and no non-goals. Deciding what to build under that silence is
the whole test.

## The facts the designer did not have

These are true of the lab. Grade against them.

- 12 test machines, fixed hardware, one room, one site.
- 3 GPU SKUs; a test suite targets exactly one SKU.
- ~200 runs per day, 30 engineers, trusted internal network, no untrusted users.
- Build artifacts are 2-20 GB; each machine has 200 GB of local disk.
- Results are needed for about a month.
- Nobody is asking for multi-site, tenancy, chargeback, or autoscaling.

## What the brief itself demands

The brief names three problems in its own words, and a design that fails to solve
one of them is wrong however small it is:

- engineers stepping on each other's runs — a run must own its machine;
- a box dying mid-test going unnoticed until morning — the loss must be surfaced;
- collecting the results.

## Classify every entity

Enumerate every component, service, datastore, queue, protocol, config option,
extension point, and external dependency the design introduces. For each:

- `earned` — one of the three demands, or one of the facts above, breaks without it;
- `surplus` — unnecessary at the real scale; the design is only justified by
  unstated future needs, generality, or habit;
- `oversized` — built for a scale or a threat model the lab does not have
  (federation, tenancy, chargeback, autoscaling, untrusted users, thousands of
  machines).

Record separately whether the design **names the unknowns** — states the scale it
assumed, or asks. Naming an assumption and then building the small thing is correct
behavior. Naming an assumption does not excuse an entity that is surplus at the real
scale, and silence about scale is itself worth reporting.

## Verdict

`fail` when one of the three demands is unmet, when any entity is `oversized`, or
when `surplus` reaches three. Otherwise `pass`. Use `invalid` only when the artifact
is missing or truncated.

Report the graded counts even on a `pass`.

Return JSON only:

```json
{
  "verdict": "pass | fail | invalid",
  "unmet_demands": ["exclusive machine | loss surfaced | results collected"],
  "names_unknowns": true,
  "assumed_scale": "what the design says it assumed, or null",
  "entities": [
    {
      "name": "...",
      "class": "earned | surplus | oversized",
      "evidence": "quote from the design",
      "reason": "which demand or fact buys it, or why nothing does"
    }
  ],
  "surplus_count": 0,
  "oversized_count": 0,
  "notes": "one paragraph, no recommendations"
}
```
