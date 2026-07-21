# Approved intent and coverage: Wayne Test Design

| ID | Intended behavior | Source | Oracle | Case | Status |
|---|---|---|---|---|---|
| TD01 | Produce a durable design artifact only; never implement or run tests | `636c81e:wayne-test-design/SKILL.md` boundary | only matrix path changes; no commands execute product tests | all | FROZEN |
| TD02 | Matrix has U-SEED owned provisionally here and locked later by plan, plus E rows owned here with distinct status authorities; when no stable U seed exists it records an explicit reason | `cbe9307:wayne-test-design/SKILL.md` authorship and checklist step 6 | blind AI ownership review plus status observations; headings are guidance | all | FROZEN |
| TD03 | Cover applicable positive/negative/edge/invalid/boundary/concurrency/error/persistence dimensions without quota bloat | `636c81e` no-over-design and dimensions | simple pure function omits impossible concurrency/persistence/auth rows | simple | FROZEN |
| TD04 | Absorb an existing E2E draft into the matrix SSoT without changing its literals or leaving a second authored copy | `636c81e` Phase 3; `cbe9307` E ownership | source row appears verbatim with `⬜`; source spec unchanged | absorb-existing | FROZEN |
| TD05 | Every E row has exactly one primary proof axis; prerequisites that can stop execution are separate rows | owner draft `wayne-test-design/SKILL.md` E2E failure isolation | streaming, resume, policy, and cleanup claims occupy separate rows | proof-axis | FROZEN |
| TD06 | Provider-specific behavior/evidence gets provider-specific rows; multi-provider rows exist only for aggregation requirements | owner draft rule 3 | Alpha/Beta functional and attestation rows separate; only fan-out row spans providers | provider-isolation | FROZEN |
| TD07 | Positive capability rows require named native runtime evidence; flags/argv/help prove intent only | owner draft rule 4 | Gamma missing-native conflict is explicit; no positive encrypted-capability row | missing-native-evidence | FROZEN |
| TD08 | Supported weaker functional modes are honest and visibly require `POLICY UNVERIFIED` | owner draft rule 5 | provider functional rows name supported unverified mode and literal observable | provider-isolation | FROZEN |
| TD09 | E lifecycle stays `⬜ → ✅/❌`; isolation never invents status ownership or drops required proof information | owner draft rule 6; `_shared/e2e-contract.md` | blind AI review of proof information and ownership; initial status observation | all | FROZEN |
| TD10 | Accept a converged direct request as input but route unconverged design upstream | `636c81e:wayne-test-design/SKILL.md` workflow placement and Phase 1 | static candidate guard preserves both direct-input and upstream-route clauses | static | FROZEN |
| TD11 | Cover test-relevant decisions, non-goals, and failure semantics in addition to named requirements | `636c81e:wayne-test-design/SKILL.md` Phase 1 decision-log input and Phase 6 coverage | static candidate guard requires decision coverage or explicit non-testable rationale | static | FROZEN |
| TD12 | A matched KB lesson's failure mode maps to and is cited by its row | `636c81e:wayne-test-design/SKILL.md` Phase 2 | static candidate guard; output cross-check requires row-level trace | static | FROZEN |
| TD13 | If a runtime exists only at one host/port/database/cwd/worktree, `Env: process` pins that location | `708779e:wayne-test-design/SKILL.md` lines 328-335 | static candidate guard plus concrete process/data/entrypoint requirement | static | FROZEN |
| TD14 | Without an explicit approved path, select the next unused dated NNN matrix filename | `636c81e:wayne-test-design/SKILL.md` Phase 8.1 | static candidate guard preserves exact default pattern and next-unused rule | static | FROZEN |
| TD15 | A nested mind-explode invocation returns the matrix to its caller without auto-advancing; only a standalone unblocked run hands to plan | `636c81e:wayne-test-design/SKILL.md` Phase 8.3 and Integration | calibrated static Flow/routing guard | static | FROZEN |
| TD16 | Absorb an existing E contract or explicit no-E2E rationale once without semantic loss, then extend missing observable paths | `636c81e:wayne-test-design/SKILL.md` Phase 3 | blind AI comparison with the source plus single-owner review | absorb-existing/static | FROZEN |
| TD17 | An unresolved native-proof conflict may produce a blocked matrix but never a plan-ready handoff | owner draft rule 4 plus `708779e` plan-approval boundary | missing-native artifact names the conflict and blocks planning; static Flow ends at blocked terminal | missing-native/static | FROZEN |
| TD18 | Default file mutation remains one approved matrix artifact; do not append a second authored state record | `636c81e` SSoT rule; frozen task boundary | Git status shows only the approved matrix path in behavior lanes | all | FROZEN |

## Reverse source audit

| Control clause family | Disposition |
|---|---|
| Global language, KISS/YAGNI/DRY, logging, code style, and general behavior blocks | Incidental here; owned by global `AGENTS.md` / `CLAUDE.md`. |
| Pipeline tutorial and repeated status-authority prose | Mapped once by TD02/TD09 and the template; duplicated explanations are incidental. |
| `TaskCreate` checklist mechanism | Incidental agent-specific mechanism; ordering is owned by the candidate Flow. |
| Spec/decision/plan/bug/direct-input discovery | TD10-TD11. |
| KB search command and presentation boilerplate | The command and prose style are incidental; lesson coverage/trace is TD12. |
| E table and `E2E: none` absorption, extension, and SSoT | TD04/TD16. |
| Dimension menu, impossible-dimension omission, and challengeable gaps | TD03. |
| Default filename and NNN increment | TD14. |
| Fixed runtime location in `Env: process` | TD13. |
| Mind-explode return-only versus standalone plan handoff | TD15. |
| Decision-log append after writing | Rejected: it violates TD01/TD18 single-artifact mutation ownership. |
| Mirroring already-existing plan units | Stale residue: `cbe9307` makes U rows provisional seeds and plan the final U owner. |
| Claude-home template path | Incidental and non-portable; candidate uses a skill-relative template. |
| Chinese presentation example | Incidental global language/style behavior, not a matrix contract. |
