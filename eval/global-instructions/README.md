# Global instructions trimming eval

One harness evaluates one instruction document on every supported global surface:

| Lane | Installation surface |
|---|---|
| Claude | isolated `~/.claude/CLAUDE.md` |
| Codex | isolated `$CODEX_HOME/AGENTS.md` |
| pi | isolated `$PI_CODING_AGENT_DIR/AGENTS.md` |

The candidate bytes, task, repository fixture, permissions, checker, and model
effort stay the same. Only the filename and host agent change. Do not create a
per-agent harness.

Each lane starts from a fresh home and state. Claude receives only provider env,
the candidate, and `fixture-sentinel`; Codex receives only a provider-only config,
the same candidate, and that fixture. Live hooks, plugins, MCP config, project rules,
agents, skills, `AGENTS.override.md`, and other instruction owners are excluded.
Claude product-core skills/agents and Codex `.system` skills are frozen allowlists,
not copied user state.

Official discovery contracts:

- Claude user instructions load from `~/.claude/CLAUDE.md`; Anthropic recommends
  concise, specific files under 200 lines:
  <https://code.claude.com/docs/en/memory.md#choose-where-to-put-claudemd-files>
- Codex global guidance loads from `$CODEX_HOME/AGENTS.override.md`, otherwise
  `$CODEX_HOME/AGENTS.md`, using the first non-empty file:
  <https://learn.chatgpt.com/docs/agent-configuration/agents-md.md>

Generated workspaces, homes, traces, controls, and candidates belong only under
`eval/.runs/global-instructions/`.

Before an A/B run, prove both installation adapters with the shared discovery
fixture:

```bash
bash eval/global-instructions/prepare_trial.sh discovery-probe \
  eval/global-instructions/support/discovery-instructions.md <workspace>
MODEL=<model> EFFORT=<effort> bash eval/global-instructions/run_agent.sh \
  <claude|codex> <workspace> <state>
uv run --no-project python eval/global-instructions/check_discovery.py \
  <workspace> --agent <claude|codex>

uv run --no-project python eval/global-instructions/check_pair.py \
  <claude-workspace> <codex-workspace>
```

`prepare_trial.sh` records candidate/task/base-tree hashes, the harness identity, and
a unique workspace ID. `run_agent.sh` rejects reused state and records agent, model,
effort, state ID, exit code, and `complete|invalid`. A provider/tool termination without
a final artifact is `invalid`; it is never scored as a behavior failure.

The harness identity is `harness_id.sh`: the git tree object of this directory at HEAD.
Git already content-addresses the tree, so no digest is maintained by hand and the id
changes only when the harness changes. It refuses to emit an id while the harness
directory is dirty — commit the harness before preparing a trial. Calibration runs
before that commit exists, so it sets `HARNESS_ID_ALLOW_DIRTY=1` and records a
`dirty:` id that a scored run can never be confused with.

## Design cases

`design-overbuild` produces a design document, and nothing deterministic can decide
whether a design bought its complexity. The two layers are kept apart so one cannot
be read as the other:

| Layer | Script | Result | Means |
| --- | --- | --- | --- |
| integrity | `check_trial.py` | `SCORABLE` / `FAIL` | the trial can be judged at all |
| quality | `semantic-rubric.md` | `pass` / `fail` / `invalid` | the design earned its entities |

Freeze and commit the rubric before the run. Judge blind: strip trial identity,
shuffle the documents, and give the judge the rubric and `REQUIREMENTS.md` only —
never the control/candidate mapping or the rule under test. The rubric reports
`surplus_count` and `contradicted_count` even on a `pass`, because two passing
designs are not equivalent and a pass/fail alone has already failed to separate
candidates here.

## Run

Materialize the frozen control without editing the live dirty `CLAUDE.md`:

```bash
bash eval/global-instructions/materialize_control.sh \
  eval/.runs/global-instructions/control.md
```

Prepare and run one neutral trial:

```bash
bash eval/global-instructions/prepare_trial.sh \
  surgical-no-commit <instructions.md> <workspace>

MODEL=opus EFFORT=high bash eval/global-instructions/run_agent.sh \
  claude <workspace> <state>

MODEL=dvue-aoai-001-gpt-5.6-sol EFFORT=high \
  bash eval/global-instructions/run_agent.sh codex <workspace> <state>

uv run --no-project python eval/global-instructions/check_trial.py \
  <workspace> --case surgical-no-commit --agent claude

uv run --no-project python eval/global-instructions/calibrate_instructions.py \
  <instructions.md>
HARNESS_ID_ALLOW_DIRTY=1 uv run --no-project python eval/global-instructions/calibrate.py \
  <instructions.md>
HARNESS_ID_ALLOW_DIRTY=1 uv run --no-project python eval/global-instructions/calibrate_isolation.py
```

Run every case as control/candidate × Claude/Codex. Infrastructure termination is
`invalid`, not a behavioral loss. Accept a trimmed candidate only when every
control-pass cell remains passing, every targeted failure flips, both installation
surfaces pass, and the candidate is smaller.

The harness proves whether a candidate is eligible for paired A/B execution. It
does not claim a trim is better until all control/candidate behavior cells run.
