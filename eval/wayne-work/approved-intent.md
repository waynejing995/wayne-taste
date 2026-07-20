# Approved intent and coverage matrix: Wayne Work

`wayne-work` executes one approved plan to a verified, review-ready diff. It does
not redesign, weaken tests, steal E ownership, commit, or auto-advance.

| ID | Intended behavior | Source | Class | Owner | Exact oracle | Case | Status |
|---|---|---|---|---|---|---|---|
| W1 | Validate complete, non-conflicting plan/decision/matrix/spec before editing | `wayne-work/SKILL.md@cbe9307`, Inputs; current A | intended | main | exact blocker and zero mutation | protected, missing-u | VERIFIED |
| W2 | Build dependency, consumes-produces, and file-overlap graph before scheduling | `wayne-work/SKILL.md@0888631:141-167`; current C | intended | main | source clause plus two independent fixture units | parallel-disjoint | VERIFIED |
| W3 | At least two ready, dependency-free, write-disjoint units trigger a native parallel-subagent attempt | `wayne-work/SKILL.md@0888631:141-167`; user correction 2026-07-16 | control regression | main scheduler | Claude: two unit Agent calls before either result; Codex: externally visible native attempt | parallel-disjoint | VERIFIED |
| W4 | Tool/capability failure is not parallel success; report exact reason and explicitly fall back serial | global fail-loud policy; capability probe in `eval/.runs/wayne-work-capability-probe` | control defect | main scheduler | Codex trace contains spawn failure; output reports failure plus serial fallback | parallel-disjoint | VERIFIED |
| W5 | Dependent or overlapping units remain serial and name the dependency/conflicting path | `wayne-work/SKILL.md@cbe9307:147-173,213-228` | intended | main scheduler | current dependent normal plan remains correct; static clause | normal | VERIFIED |
| W6 | Each worker receives one full unit contract, allowed paths, exact verify, no-commit, and no-matrix/shared-owner boundary | `wayne-work/SKILL.md@cbe9307:188-210,234-243` | intended | main dispatch | external trace prompt checks and one mutation per field family | parallel-disjoint | VERIFIED |
| W7 | Main alone owns shared paths, actual-diff review, matrix U status, integration/full verification, and handoff | `wayne-work/SKILL.md@cbe9307:213-228,330-387`; current C/H/J | intended | main | worker prompts exclude matrix; final scope/matrix/full/handoff checks | parallel-disjoint, normal | VERIFIED |
| W8 | Test-first units establish relevant RED before implementation; no locked-test weakening | current R and Red lines | intended | unit executor | verification event and locked-path mutations | normal | VERIFIED |
| W9 | Unit exact verification must pass before its U rows change `☐→☑`; E stays `⬜` | `wayne-work/SKILL.md@636c81e,cbe9307`; current G/H | intended | main owns status | matrix/content and real test checks | normal, parallel-disjoint | VERIFIED |
| W10 | Wave/integration failure blocks later work and completion until repaired and full verify passes | `wayne-work/SKILL.md@cbe9307:213-228,368-387`; current J | intended | main | full verify and no handoff on failure; static wave barrier | normal; deterministic mutation | VERIFIED |
| W11 | Final completion proves all units/decisions, scope diff, exact full commands, no TODO/stage/commit/branch | current J and Red lines | intended | main | hidden tests, manifest, git, full verify | normal, parallel-disjoint | VERIFIED |
| W12 | Success emits return-only checkpoint to `wayne-code-review` and never invokes it | `wayne-work/SKILL.md@fe578b0`; current L | intended | checkpoint packet | plan/matrix/units/verify/scope/next stage | normal, parallel-disjoint | VERIFIED |
| W13 | Every Deferred-to-Implementation item has one owning unit; Work resolves only repository/runtime-observable HOW and returns behavior-changing choices to user and Plan | `wayne-work/SKILL.md@cbe9307:105-119,555-566`; current A | intended regression restored | main | contextual source/trace review; no lexical proxy | deferred-boundary | UNVERIFIED |
| W14 | Workers report DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED; the main agent never treats unresolved status as success or retries a Plan gap unchanged | `wayne-work/SKILL.md@cbe9307:319-328`; current D | intended regression restored | main scheduler | ordered worker-result and next-action trace | worker-status | UNVERIFIED |
| W15 | Every wave receives one independent read-only spec-compliance review before U status changes; it rejects missing, changed, and extra behavior without replacing the final code-review stage | `wayne-work/SKILL.md@cbe9307:330-387`; user confirmation 2026-07-20; current H | intended regression restored | review agent + main status owner | review report plus event order around U mutation | parallel-disjoint | UNVERIFIED |

Reverse audit: provider-specific `TaskCreate`, `TeamCreate`, `Agent`, `SendMessage`,
fixed model names, and a fixed “3+ tasks” threshold are incidental mechanisms and
must not return. The behavior owner is native-capability scheduling with observable
success or an explicit failure path.
