# Approved intent and coverage matrix

Optimization target: let checkpoint package a caller-selected non-linear handoff
without taking ownership of triage semantics or changing save/list/resume behavior.

| ID | Intended behavior | Source | Class | Owner | Exact oracle | Case | Status |
|---|---|---|---|---|---|---|---|
| I1 | Handoff returns a packet and never invokes the next stage | `wayne-checkpoint/SKILL.md@fe578b0`, Mode A and Step 5 | intended | Skill | packet says manual and auto-advance NO; no product mutation | all internal | VERIFIED |
| I2 | The handoff packet carries snapshot, one next agent, self-contained prompt, optional goal, and manual trigger | `wayne-checkpoint/SKILL.md@fe578b0`, Step 3 | intended | template | deterministic packet-field and body checks | all internal | VERIFIED |
| I3 | Existing plan handoff routes to `wayne-work` | `wayne-checkpoint/SKILL.md@fe578b0`, Step 2 route table | intended | Skill | exact `pipeline_stage: plan`, `next_agent: wayne-work` | plan-regression | VERIFIED |
| I4 | A non-linear caller selects the next capability; checkpoint does not reinterpret its verdict | `wayne-triage/SKILL.md@372759e:234-252`; `wayne-checkpoint/SKILL.md@fe578b0`, Step 3 | intended | caller selects; checkpoint validates | packet preserves caller-supplied `wayne-test-design` | fix-now, needs-plan | VERIFIED |
| I5 | Non-linear metadata survives the packet | `wayne-triage/SKILL.md@372759e:247-252` | control defect | template | exact source stage, route, and evidence snapshot | triage internal | VERIFIED |
| I6 | Architecture caller target can return to design convergence | `wayne-triage/SKILL.md@372759e:234-252`; `wayne-mind-explode/SKILL.md:1-10` | intended | caller selects; checkpoint validates | preserve supplied `wayne-mind-explode` | escalate-architecture | VERIFIED |
| I7 | A call with no internal Wayne target fails loud without a packet | `wayne-triage/SKILL.md@372759e`, external report boundary; global fail-loud policy | intended | checkpoint validation | zero checkpoint; `NO_WAYNE_HANDOFF` result | external | VERIFIED |
| I8 | Every `next_agent` is one real Skill slug, never a verdict, chain, or external owner | `wayne-checkpoint/templates/handoff-packet.md@fe578b0`; repository skill directories | control defect | checker + template | exact allowlisted slug whose `SKILL.md` exists | all internal | VERIFIED |
| I9 | Triage evidence is the durable handoff snapshot | `wayne-triage/SKILL.md@372759e`, handoff clause | intended | template | frontmatter/body contains exact repo-relative evidence path | triage internal | VERIFIED |
| I10 | Save/list/resume and non-handoff prose are not redesigned by this fix | `wayne-checkpoint/SKILL.md@HEAD`, Save/Resume/List flows | intended | Skill | candidate diff restricted to handoff validation/schema surfaces | static diff | VERIFIED |
| I11 | Checkpoint and handoff templates carry exact path/owner/hash references plus derived progress only; they never become a second decision, U Status, or E Status owner | `_shared/pipeline-id-contract.md` Artifact state and field owners; current Save ownership rule | intended ownership repair | templates | structural template checker rejects copied decision tables/unit checkboxes and requires owner/hash references | static templates | FROZEN |
| I12 | Resume at `verify` re-enters `wayne-verify` with the exact authoritative Test Matrix; resume at `work` re-reads the plan/matrix instead of consuming checkpoint unit state | current Resume route table and ownership rule | intended | resume routing | static route/template contract; contextual resume behavior remains held out | static | FROZEN |

Ownership note: triage retains its verdict-to-next-stage table. Checkpoint owns
packet validation and shape only. Every changed normative clause must map to I1-I10;
other current checkpoint clauses remain byte-identical.
