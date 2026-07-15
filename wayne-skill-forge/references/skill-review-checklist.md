# Skill review checklist

Use this for a deep review after the deterministic validator. Report findings by
severity: `critical` blocks use, `major` should be fixed, `minor` is optional.

## Contents

1. Trigger contract
2. Net-new information
3. Size and progressive disclosure
4. Archetype fit
5. Flowchart contract
6. Reliability and permissions
7. Evaluation evidence
8. Contract protection

## 1. Trigger contract

- **critical** — YAML is valid; `name` and `description` exist; name matches directory.
- **critical** — description is at most 1,024 characters.
- **major** — description states what the skill does and when to use it.
- **major** — description includes real user language, not invented keyword stuffing.
- **major** — closest do-not-trigger boundary is clear when overlap is plausible.
- **major** — no body `When to Run` section duplicates routing metadata.
- **minor** — description is normally 180–400 characters and front-loads the key use case.

## 2. Net-new information

- **critical** — the skill adds specialized workflow, local knowledge, or a hard contract.
- **critical** — global `AGENTS.md` / `CLAUDE.md` rules are not copied into the skill.
- **major** — every load-bearing instruction maps to a local fact, observed failure,
  approval boundary, output contract, or verification need.
- **major** — generic advice the strongest-model baseline already follows is removed.
- **major** — the skill earns a new file rather than extending an existing owner.
- **minor** — decorative sections exist only when they carry task information.

## 3. Size and progressive disclosure

- **critical** — `SKILL.md` is under 500 lines.
- **major** — 80–180 lines and 800–1,500 words is the normal target; excess is
  justified by behavioral eval evidence.
- **major** — detailed schemas, variants, examples, and long checklists live in
  direct references, not the always-loaded body.
- **major** — repeated or deterministic work is a script, not generated code.
- **major** — every shipped resource is linked directly from `SKILL.md`.
- **major** — no fact is duplicated between body, reference, template, or sibling skill.
- **minor** — references above 100 lines have a table of contents.

## 4. Archetype fit

- **major** — procedure: order/gates/retries matter; process checks observable outcomes.
- **major** — lens: principles carry reasons; applicability boundary is explicit.
- **major** — router: at least three playbooks; routing uses observable signals;
  no-match fails loud.
- **major** — a two-way branch is not inflated into a router.
- **major** — examples remain only when the baseline needs them.
- **minor** — anti-patterns remain only when evidence shows a recurring mistake.

## 5. Flowchart contract

- **critical** — decisions, loops, routes, approval gates, and multiple terminals
  are represented when they materially control behavior.
- **critical** — the Flowchart and process do not disagree.
- **major** — Flowchart is the only owner of sequence and branching.
- **major** — process headings expand stable node IDs instead of restating edges.
- **major** — every decision edge is labelled, including failure/no-match.
- **major** — commands, schemas, and essays are absent from node labels.
- **major** — no Checklist or second phase list duplicates the Flowchart.
- **minor** — one main Flowchart; mode-specific flows live in direct references.
- **minor** — linear workflows omit Flow unless the user explicitly values it as
  a navigation aid and eval shows no context penalty.

## 6. Reliability and permissions

- **critical** — state owner and allowed mutation are unambiguous.
- **critical** — destructive, external, costly, or scope-expanding actions have gates.
- **critical** — failure is visible; missing configuration does not silently degrade.
- **major** — exact verification matches the real user path where behavior is user-visible.
- **major** — cross-agent skills avoid one agent's hardcoded home path or tool name,
  or isolate those details in direct agent-specific references.

## 7. Evaluation evidence

- **critical** — static validator passes.
- **major** — new skill: candidate beats or matches strongest-model no-skill baseline.
- **major** — existing skill: candidate does not regress against current skill.
- **major** — control and candidate use the same model, effort, task, tools, and artifacts.
- **major** — fresh agents receive raw task artifacts, not the intended diagnosis.
- **major** — at least three cases cover common, boundary, and failure behavior;
  trigger-sensitive or high-risk skills use five or more.
- **critical** — generator skills are evaluated through their generated artifact:
  old/candidate generator → paired child skills → fresh downstream task execution.
- **major** — downstream agents and judges are blind to generator identity.
- **critical** — each deterministic finding traces to a published intent/task
  clause; evaluator-only expectations are not scored against a candidate.
- **major** — provider, timeout, and tool-boundary terminations are recorded as
  invalid trials and rerun, not converted into behavioral losses.
- **minor** — token/context reduction is measured, but never substitutes for correctness.

## 8. Contract protection

- **critical** — every approved requirement was mapped to one body/resource/eval
  owner before compression; no clause was dropped only to hit a size target.
- **critical** — quoted grammar, headers, sentinels, cardinalities, verbatim clauses,
  and forbidden alternatives match the approved intent without normalization.
- **critical** — contradictory approved clauses were returned upstream; the forged
  contract did not silently choose one.
- **critical** — outputs with at least two low-freedom signals (exact grammar,
  cross-field reference, unique owner, verbatim carry, order, machine terminal)
  have one schema reference, one aligned template, and a deterministic validator.
- **critical** — every bundled validator passed a valid fixture, rejected one
  minimal mutation per independent invariant with the expected finding, tested
  both directions of cross-record rules, passed lint/static checks, and was
  challenged by a frozen external acceptance check.
- **major** — the body states when the contract resource must be read and when the
  validator must run.
- **major** — schema facts have one owner; the body, template, and validator do not
  define competing shapes.
- **major** — schema/template/validator agreement was traced back to the intent;
  self-consistency alone was not accepted as fidelity.
- **critical** — every source-relative claim names and reads its oracle inputs;
  artifact-only validation is not reported as source-fidelity proof.
- **critical** — when exact content is supplied only at runtime, the forged skill
  rebuilds a temporary source ledger and traces each literal, owner, and
  relationship into the output and its proof.
- **major** — semantic judgment uses behavioral cases rather than a fake keyword
  validator.

## Output

```markdown
## Skill Review: <name>

### Verdict
Pass / Needs improvement / Needs major revision

### Evidence
- Static: <result>
- Behavioral: <control vs candidate>
- Size: <description chars, lines, words>

### Findings
- critical: <location → failure → smallest fix>
- major: <location → failure → smallest fix>
- minor: <location → optional improvement>

### Residual uncertainty
- <what the eval did not cover>
```
