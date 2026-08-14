# Approved intent — forge revision: reference placement decision

## Observed failure (control)

On 2026-08-14 the forge was used to author `wayne-codebase-report`. The shipped skill had `SKILL.md` plus `scripts/` and **zero** `references/`, even though it carried material needed only on some runs — the scout fan-out contract (large repositories only) and the full verifier flag semantics (verification step only). References were added only after the user asked "why no ref file?".

**Provenance caveat.** That run happened inside a long working session, not from a frozen prompt. `case-1-regression-evidence.md` is a **fixture reconstructed from the transcript**, not the exact bytes the original author received. The historical 0-reference outcome is observed evidence; this eval is a *reproduction attempt* against a clean fresh agent. If the control arm produces references here, the reconstruction failed to reproduce the failure and cannot justify the patch — that is a real possible outcome and must be reported as such, with the residual uncertainty that the original failure may have been operator-specific (a long interrupted session, the forge not re-read) rather than a forge defect.

Hypothesised root cause: the forge gives explicit, repeated pressure to cut and only passive permission to add resources, so the default outcome is that conditional detail is inlined or dropped.

## Change under test

Three edits to the forge:

1. §Protect the contract before compressing — compression becomes two ordered operations, **move** then **cut**. Branch-conditional long detail moves to `references/`, repeated *deterministic* operations to `scripts/`, output material to `templates/`; only what survives every move is a cut candidate. The `SKILL.md` budget is reframed as an always-loaded-context budget, not a limit on the knowledge the skill may carry.
2. Same section — a reference is **optionally loaded, never optionally correct**; the body keeps the load condition and a direct link.
3. §D plus one red line — an explicit resource-placement decision extending the coverage map, with `No reference: <reason>` when nothing qualifies, kept in working notes rather than shipped.

The forge must not require a reference in every skill; it must require an explicit placement decision.

## Control vs candidate

| | Forge SKILL.md |
| --- | --- |
| control | `control/SKILL.md`, git blob `e7491d2bf894f8d3ec840a5bb65d5decbcc771f4` |
| candidate | `candidate/SKILL.md` |

Same model, effort, tools, evidence, and return-only instruction on both sides.

## Success criteria

The candidate passes only if downstream execution improves or ties, with no hard-boundary regression:

1. **Placement decision is made and visible.** The generated skill either ships a one-level `references/` for genuinely conditional material, or states the exemption. A skill that inlines conditional detail with no decision is a control-style failure.
2. **The reference is discoverable and used.** A fresh downstream agent, given only the generated skill and a real task that needs the conditional material, must reach the reference and act on it. A reference that exists but is never opened is not an improvement — it is a split file.
3. **No body bloat.** `SKILL.md` stays inside the forge's own word budget.
4. **No regression** on loader validity, prettier, or Flow/process alignment.

Criterion 2 is the load-bearing one. Counting whether a `references/` directory appeared measures authoring style, not execution effect.

## Non-goals

- Requiring a reference in every skill.
- Judging prose quality of the generated `SKILL.md`.
