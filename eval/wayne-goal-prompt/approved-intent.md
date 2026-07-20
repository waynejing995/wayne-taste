# Approved intent and coverage: Wayne Goal Prompt

| ID | Intended behavior | Source | Oracle | Case | Status |
|---|---|---|---|---|---|
| GP01 | Output is a steering prompt, not a plan or implementation | `a2d3255` why/how; current Boundary | no product mutation; no plan/implementation artifact | all composition | PASS |
| GP02 | Required sections are Goal, Context, Tasks, Verification required, Completion criteria; Current correction is correction-only | `a2d3255:SKILL.md`; template | exact headings/cardinality; correction absent on first issue | compose-real-path, existing-plan | PASS |
| GP03 | Missing target, success, or verification evidence produces the minimum pointed Chinese question instead of invented criteria | `a2d3255:SKILL.md` Process 2-3 | one Chinese question; no goal block or mutation | vague-missing | PASS |
| GP04 | Verification names exact commands and the real entrypoint; every completion criterion maps to observable proof | `a2d3255` why; exemplar | required commands and real-path negative boundary appear; no “run tests”/“works well” | compose-real-path | PASS |
| GP05 | Existing plan/spec/decision docs remain SSoT and are referenced, not re-pasted | `5fed796` why/how | plan path and unit IDs present; unique rationale sentinels absent; §5/§6 self-contained | existing-plan | PASS |
| GP06 | Prompt stays at most 4,000 characters without trimming §5/§6 | `708779e:SKILL.md` | extracted goal block length ≤4,000 and required proof remains | composed cases | PASS |
| GP07 | Constraints stay with governed tasks; secrets use env-var names, not values | template; exemplar | task-local red-lines and env name retained; fixture secret absent | compose-real-path | PASS |
| GP08 | No dispatch occurs until the user confirms both goal and cwd | `c0d7611` why/how; current Process 5 | pre-confirm worktree/process trace unchanged; Chinese confirm gate asks goal + cwd | composition cases | PASS |
| GP09 | Confirmed dispatch uses the bundled headless goal adapter, project-local goal file, explicit cwd, YOLO params, JSONL, and inbox | `708779e` why/how | static/script oracle over exact public contract | candidate-static | PASS |
| GP10 | App-server startup/provider failure, including failure to start the initial work turn, is reported before readiness or a successful job ID | fail-loud policy; current G; user correction 2026-07-20 | fake initialize and `turn/start` failures make `dispatch` non-zero, publish no ready marker/job ID, and preserve logs | dispatch-failure | PASS |
| GP11 | A paused/blocked live goal keeps the same thread available; `resume` reactivates it without a new job | current Unblocking/Resuming claim; app-server schema `ThreadGoalSetParams.status` | fake server observes same thread `goal/set status=active`, then completes | resume | PASS |
| GP12 | Usage/budget terminal states fail; persistent provider failure is not hidden by resume spam | current terminal semantics | deterministic terminal/failure status stays non-complete | dispatch-failure | PASS |
| GP13 | Mid-run injection uses `thread/inject_items`; monitoring consumes JSONL events rather than a TUI pane | `708779e` why/how; current scripts | schema/static check plus fake protocol trace | candidate-static, resume | PASS |

Provider-specific app-server details belong in the script and one direct runtime
reference, not repeated through the always-loaded skill body.
