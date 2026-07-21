# Approved intent and coverage: Wayne Verify

| ID | Intended behavior | Source | Oracle | Case | Status |
|---|---|---|---|---|---|
| VV01 | Locate the carried E2E contract; a missing contract blocks without invented verification | `fe578b0:wayne-verify/SKILL.md` Phase 1 | no repo mutation or runtime command; final routes to test design | missing-contract | FROZEN |
| VV02 | `_shared/e2e-contract.md` owns E2E information and lifecycle; Verify mutates only E2E Status, never unit status or product code | `_shared/e2e-contract.md` Required information and Status Lifecycle | blind AI ownership review plus Git mutation evidence | cli-success, server-success | FROZEN |
| VV03 | Every row is run with fresh evidence this session, including incoming `✅`/`❌`; historical status is not proof | `fe578b0` hard gate and Phase 3d; current Key Principles | exact entrypoint appears in fresh trace; stale `✅` flips to current `❌` | stale-green | FROZEN |
| VV04 | Execute the row's exact process, data, entrypoint, and concrete host/worktree; never substitute current cwd or another worktree | `708779e:wayne-verify/SKILL.md` Phase 3a | exact process/entrypoint command and named data observed | cli-success, server-success, startup-failure | FROZEN |
| VV05 | Wait on a real readiness signal; failure before readiness is `❌`, never skip/pass | `fe578b0` Phase 3a; current Phase 3a | ready marker for success; startup error plus `❌` for failure | server-success, startup-failure | FROZEN |
| VV06 | Drive the real user entrypoint; unit tests, mocks, helpers, and internal calls are not substitutes | `fe578b0` Phase 3b; `_shared/e2e-contract.md` | exact CLI/curl trace; runtime artifact/response observed | cli-success, server-success, stale-green | FROZEN |
| VV07 | Judge the real observable, not transport success, no exception, or returned true | `fe578b0` Phase 3c; `_shared/e2e-contract.md` Observable | exact artifact/response required; `TRANSPORT_OK` alone fails | cli-success, server-success, stale-green | FROZEN |
| VV08 | Change Status only after observation: fresh success `✅`, startup/observable failure `❌` | `_shared/e2e-contract.md` Status Lifecycle; current Phase 3d | final status and trace/artifact observations judged together by AI | all executable cases | FROZEN |
| VV09 | Tear down the row process on both success and failure | `fe578b0` Phase 3d | server writes shutdown marker after the verification drive | server-success | FROZEN |
| VV10 | Run rows in order and do not convert one failed row into a global skip or early ship handoff | `fe578b0` core loop and hard gate | row 2 executes after row 1 fails; statuses are `❌`, `✅`; final is not-ready | multi-row | FROZEN |
| VV11 | Accept only a legitimate `E2E: none`; reject a skip hiding a user-visible path without inventing a replacement row; the Flow must carry legitimate skip through the row loop and final gate | `fe578b0:wayne-verify/SKILL.md` Process Flow; `_shared/e2e-contract.md` Trigger Rule; current A/K | structural Flow oracle plus mutation; legitimate skip passes without execution; suspect skip stays unchanged, not run, and blocked; blind semantic route judgment | legit-skip, suspect-skip, static Flow | FROZEN |
| VV12 | Any `❌` routes to `wayne-work` and no ship handoff; all fresh `✅` or legitimate skips route only to one return-only checkpoint for ship, never a commit, push, PR, or `wayne-ship` invocation | `fe578b0` Phase 4; current Q; user milestone correction 2026-07-20 | status/Git/trace observations plus blind AI route and packet judgment | all cases | FROZEN |

The reported failure seed for this optimization is intent loss during slimming:
the harness therefore freezes fresh execution, state ownership, failure, skip,
teardown, and routing behavior before candidate generation.
