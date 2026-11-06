# Approved intent: wayne-go

Source: user requests on 2026-11-05 — "a skill like just do it, but help build the task prompt", "an entry wayne skill which works as a playbook", "my mental model is more like mattpocock's" (`ask-matt` router), and the confirmed choices: one skill (router plus quick lane), one unified task-prompt template, and "他只负责 prompt 生成，执行与他无关" (it only generates prompts; execution has nothing to do with it).

| ID | Intended behavior | Oracle |
| --- | --- | --- |
| WG01 | A small, low-stakes request with a clear target routes to the quick lane and returns one copy-paste task prompt. | final response holds one prompt block with Goal, Context, Tasks, Verification, Completion criteria |
| WG02 | The quick-lane prompt is grounded: real file paths, the repository's real test command, and the real user entrypoint; nothing invented. | blind AI review against the fixture repository |
| WG03 | On every route the skill only writes a prompt. It does not edit, run the change, commit, invoke the selected skill, open a session, or dispatch. The trial task text does not forbid execution, so this is the skill's own behavior. | `check_trial.py` side-effect PASS; no claim of execution in the response |
| WG04 | The quick-lane prompt tells the executor to stop and report on scope growth (shared interface, schema, migration, irreversible action, extra files, two failed fixes on one premise). | blind AI review |
| WG05 | A "直接干" request whose change touches a shared interface or an irreversible action does not get a quick-lane prompt; it routes to the pipeline (plan) or asks, and says why. | `shared-interface`, `irreversible` cases |
| WG06 | Pipeline signals route to the matching Wayne skill and return a next-step prompt for it, without doing that skill's work: failure → `wayne-triage`, unsettled design → `wayne-mind-explode`, approved plan → `wayne-work`, reviewed diff → `wayne-ship`. | `failure`, `design`, `has-plan`, `ship` cases |
| WG07 | No match, or a vague request, gets one Chinese question with a recommendation, and nothing else. | `vague` case |
| WG08 | The response states the selected route and the fact that selected it. | blind AI review |

Cases: `quick-common` (WG01–WG04, WG08), `shared-interface` and `irreversible` (WG05), `failure`, `design`, `has-plan`, `ship` (WG06), `vague` (WG07). WG03 applies to every case.
