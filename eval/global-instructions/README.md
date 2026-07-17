# Global instructions trimming eval

One harness evaluates one instruction document on both supported global surfaces:

| Lane | Installation surface |
|---|---|
| Claude | isolated `~/.claude/CLAUDE.md` |
| Codex | isolated `$CODEX_HOME/AGENTS.md` |

The candidate bytes, task, repository fixture, permissions, checker, and model
effort stay the same. Only the filename and host agent change. Do not create a
Claude harness and a Codex harness.

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
```

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
```

Run every case as control/candidate × Claude/Codex. Infrastructure termination is
`invalid`, not a behavioral loss. Accept a trimmed candidate only when every
control-pass cell remains passing, every targeted failure flips, both installation
surfaces pass, and the candidate is smaller.
