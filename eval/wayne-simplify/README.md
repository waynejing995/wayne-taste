# eval/wayne-simplify

Harness for the `wayne-simplify` post-write refinement pass.

| File                 | Owns                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| `approved-intent.md` | what the skill must cause; the only source of scored expectations         |
| `task.md`            | the frozen task text, byte-identical across arms except the skill prefix  |
| `cases/<case>/base`  | the pre-change state, loaded into the git index                           |
| `cases/<case>/work`  | the "just written" change, left in the working tree                       |
| `prepare_trial.sh`   | materializes one workspace; index = baseline, worktree = change, no commit |
| `check_trial.py`     | deterministic observations only: git state, locked test bytes, runtime behavior, verification result |
| `calibrate.py`       | proves the checker passes a pristine workspace and fails each seeded violation |
| `eval-report.md`     | the frozen run record                                                     |

Cases: `common` (duplication + single-implementation factory), `boundary` (guards that look redundant but are load-bearing), `red` (failing baseline), `revert` (a stdlib swap whose only green path is editing a test), `no-check` (no runnable verification).

```bash
uv run --no-project python calibrate.py                                   # checker sanity, must end "calibration ok"
bash prepare_trial.sh <case> <arm>                     # prints the workspace path
uv run --no-project python check_trial.py <case> <workspace>              # JSON verdict for one trial
uv run --no-project python check_wave.py <arm> <workspace>                # JSON verdict for one wave arm
bash prepare_wave.sh <arm>                             # prints the wave workspace path
```

Wave-integration harness (proves the `wayne-work` node S, not the standalone pass):

| File                    | Owns                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `cases/work-wave/repo`  | a two-unit plan whose units both need the same normalization, so the wave diff duplicates it |
| `prepare_wave.sh`       | builds `/tmp/wayne-simplify-wave/<arm>`: control = `wayne-work` at git HEAD without the skill, candidate = working-tree `wayne-work` plus the skill |
| `check_wave.py`         | observable state only — locked inputs, git state, U/E rows, final verification, recorded logs |
| `watch_reads.py`        | inotify read log, corroboration only; a read timestamp is not proof of execution     |

The S verdict is read from the arm's returned receipt (scope, baseline command and result, re-run result, applied, skipped) against `approved-intent.md` item 8. Workspaces live under `/tmp` because inotify does not see reads on the NFS mount, and the verification event log is written outside `repo/` so trial cleanup cannot erase it.


Workspaces land in the gitignored `eval/.runs/wayne-simplify/`. The checker never judges prose: whether a trial *reported* the red baseline or *explained* a revert is scored by reading its report against `approved-intent.md`.
