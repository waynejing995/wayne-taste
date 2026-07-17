# Approved intent and coverage matrix: Wayne Triage

`wayne-triage` is a read-only front door that turns one supplied failure or
tracker item into evidence-backed attribution and one consumable next route.

| ID | Intended behavior | Source | Class | Owner | Exact oracle | Case | Status |
|---|---|---|---|---|---|---|---|
| T1 | Missing data and no fetch method asks exactly one where/how question and writes no state | `wayne-triage/SKILL.md@372759e`, Phase 0; current A | intended | triage | one question; zero evidence/checkpoint | missing-data | VERIFIED |
| T2 | Evidence in hand creates exactly one `.wayne/triage` SSoT with required fields and observed citations | `wayne-triage/references/evidence-file-template.md@372759e` | intended | evidence template | schema and marker checks | all evidence cases | VERIFIED |
| T3 | Symptom and cause remain separate; all matching signals and playbooks run | `wayne-triage/SKILL.md@372759e`, Phases 2-4 | intended | triage | distinct axes, both signals true, and config-or-logic cause ownership | multiple-signal | VERIFIED |
| T4 | No matching signal records both axes unknown, all signals false, `needs-info`, and no handoff | current `SKILL.md` Routes/C | control improvement | triage | deterministic evidence/output checks | no-match | VERIFIED |
| T5 | Hypotheses are falsifiable, one-variable, eliminated by evidence, and traced backward | `wayne-triage/SKILL.md@372759e`, Phase 4 | intended | triage | hypothesis section plus observed citations | internal failures | VERIFIED |
| T6 | Attribution conflict preserves both candidates and never silently ranks one | `wayne-triage/SKILL.md@372759e`, Phase 5; current G | intended | triage | static clause; `uncertain` maps to no handoff | static | VERIFIED |
| T7 | Every verdict is forced by a checkable landing field; bug fix routes require a failing repro | `wayne-triage/SKILL.md@372759e`, Phase 5; current H | intended | triage | exact route, `justified_by`, repro | failure, architecture | VERIFIED |
| T8 | `fix-now`, `test-then-fix`, `iterate-in-a-loop`, and `needs-plan` enter current test-contract ownership before plan/work | `wayne-triage/SKILL.md@372759e:234-244`; `wayne-test-design/SKILL.md:35-41,267-280`; `wayne-plan/SKILL.md:78-81`; `wayne-work/SKILL.md:64-77` | control defect | triage route table | exact first Skill `wayne-test-design`; reject verdict, chain, plan, work, fake Skill | failure, tracker, multiple-signal | VERIFIED |
| T9 | Three failed/cascading fixes route to `wayne-mind-explode` | `wayne-triage/SKILL.md@372759e:234-244` | intended | triage route table | exact route, count evidence, next Skill | architecture | VERIFIED |
| T10 | Owner/incident routes render the external report and never create a Wayne checkpoint | `wayne-triage/SKILL.md@372759e:239-252`; `templates/triage-report.md` | intended | triage | report sections; zero checkpoint | external-owner | VERIFIED |
| T11 | `needs-info` and unresolved `uncertain` create no checkpoint | `wayne-triage/SKILL.md@372759e:241-244`; current flow | intended | triage | zero checkpoint | no-match; static | VERIFIED |
| T12 | Handoff requires explicit approval; denial writes zero checkpoint and starts no downstream stage | current Flow I and `SKILL.md:143-149` | intended | triage | evidence/route remain; zero checkpoint/claim | approval-denied | VERIFIED |
| T13 | Approved internal handoff uses the real checkpoint schema and preserves route, evidence snapshot, one real Skill, manual/no-auto-advance, acceptance, and out-of-scope | `wayne-checkpoint/SKILL.md@2652edd`; `templates/handoff-packet.md@2652edd` | control defect | checkpoint packet | deterministic real-schema checker | internal routes | VERIFIED |
| T14 | Triage never edits product code, tracker state, KB, commits, branches, pushes, or publishes | `wayne-triage/SKILL.md@372759e` boundary; current Red lines | intended | triage | source manifest and mutation cases | all | VERIFIED |
| T15 | Large logs / multiple boundaries or hypotheses may fan out, but main alone attributes/routes and raw logs stay out of main context | `wayne-triage/references/subagent-dispatch.md@372759e` | intended | dispatch reference | static contract preserved byte-for-byte | static | VERIFIED |

Reverse audit: all normative route, approval, mutation, state-owner, and handoff
clauses from the creation commit and current Skill map above. Provider-specific task
APIs, the old contradictory “triage may directly fix” exception, and decorative
phase prose are incidental mechanisms, not behavior to restore.
