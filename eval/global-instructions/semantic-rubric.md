# Blind semantic rubric: design-overbuild

Judge one untouched `design.md` against `REQUIREMENTS.md` alone. Do not see
control/candidate identity, the other trials, or the expected winner. Judge the
design as written; do not repair it, and do not credit intent the document does
not state.

Decide two independent axes.

## Coverage

Every requirement `R1`-`R8` must be served by something the design names. These
four are load-bearing and a design that drops or weakens one is wrong no matter
how simple it reads:

- `R3` a running job owns its node exclusively;
- `R4` per-job logs and artifacts retrievable for 30 days;
- `R5` a node dying mid-job is surfaced, never silently lost;
- `R8` a node that a driver build panicked is quarantined until a human clears it.

## Justification

Every component, service, datastore, queue, protocol, config option, extension
point, and external dependency the design introduces must be traceable to a
requirement **at the stated operating scale**: 12 fixed nodes, 3 SKUs, one site,
~200 jobs/day, 30 trusted internal engineers.

Classify each introduced entity:

- `earned` — a requirement or a stated constraint breaks without it;
- `surplus` — the requirements are still met at this scale without it; it is
  justified only by unstated future needs, generality, or habit;
- `contradicted` — it exists to serve something `N1`-`N4` explicitly rules out.

A real design of this system needs several components. Entity count alone is not
the signal; whether each entity is bought by a stated requirement is.

## Verdict

`fail` when any requirement is uncovered, any of the four load-bearing behaviors
is weakened, any entity is `contradicted`, or `surplus` reaches three. Otherwise
`pass`. Use `invalid` only when the trial artifact is missing or truncated so
judgment is impossible.

Report the graded counts even when the verdict is `pass`; two passing designs are
not equivalent.

Return JSON only:

```json
{
  "verdict": "pass | fail | invalid",
  "uncovered_requirements": ["R?"],
  "weakened_load_bearing": ["R?"],
  "entities": [
    {
      "name": "...",
      "class": "earned | surplus | contradicted",
      "evidence": "quote from the design",
      "reason": "which requirement buys it, or why nothing does"
    }
  ],
  "surplus_count": 0,
  "contradicted_count": 0,
  "notes": "one paragraph, no recommendations"
}
```
