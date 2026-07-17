#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "usage: $0 <claude|codex> <workspace> <run-state>" >&2
    exit 2
fi

: "${MODEL:?set MODEL to the exact model slug}"
: "${EFFORT:?set EFFORT to the exact reasoning effort}"
command -v bwrap >/dev/null || { echo "bwrap is required" >&2; exit 2; }

agent=$1
workspace=$(realpath "$2")
state=$(realpath -m "$3")
[[ ! -e "$state" ]] || { echo "run state already exists: $state" >&2; exit 2; }
mkdir -p \
    "$state/cache" \
    "$state/session-env" \
    "$state/claude-home/skills/fixture-sentinel" \
    "$state/codex-home/skills/fixture-sentinel"
cp -R "$workspace/fixture-skill/." "$state/claude-home/skills/fixture-sentinel/"
cp -R "$workspace/fixture-skill/." "$state/codex-home/skills/fixture-sentinel/"
if [[ -f /root/.claude/settings.json ]]; then
    jq '{env}' /root/.claude/settings.json > "$state/claude-home/settings.json"
else
    printf '{}\n' > "$state/claude-home/settings.json"
fi
uv run --no-project python "$(dirname "$0")/write_codex_config.py" \
    /root/.codex/config.toml "$state/codex-home/config.toml"
for file in model-catalog-1m.json installation_id version.json auth.json; do
    [[ -f "/root/.codex/$file" ]] && cp "/root/.codex/$file" "$state/codex-home/"
done

state_id=$(printf '%s' "$state" | sha256sum | cut -d' ' -f1)
write_status() {
    local status=$1 rc=$2
    jq -n \
        --arg agent "$agent" --arg model "$MODEL" --arg effort "$EFFORT" \
        --arg status "$status" --arg state_id "$state_id" --arg state_path "$state" \
        --argjson exit_code "$rc" \
        '{agent:$agent,model:$model,effort:$effort,status:$status,
          state_id:$state_id,state_path:$state_path,exit_code:$exit_code}' \
        > "$workspace/run-status.json"
}

base=(
    --die-with-parent --new-session --unshare-all --share-net
    --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib
    --ro-bind /lib64 /lib64 --ro-bind /etc /etc --dev /dev --proc /proc
    --tmpfs /tmp --dir /root --dir /root/.cache
    --bind "$state/cache" /root/.cache
    --bind "$workspace" /workspace --chdir /workspace/repo
    --setenv HOME /root
)

case "$agent" in
    claude)
        set +e
        bwrap "${base[@]}" \
            --ro-bind /root/.local /root/.local \
            --dir /root/.claude \
            --bind "$state/claude-home" /root/.claude \
            --ro-bind "$workspace/instructions.md" /root/.claude/CLAUDE.md \
            --bind "$state/session-env" /root/.claude/session-env \
            --unsetenv CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD \
            --setenv PATH /root/.local/bin:/usr/local/bin:/usr/bin:/bin \
            /bin/bash -lc 'claude -p --dangerously-skip-permissions --permission-mode bypassPermissions --setting-sources user --strict-mcp-config --mcp-config "{\"mcpServers\":{}}" --no-chrome --model "$MODEL" --effort "$EFFORT" --no-session-persistence --verbose --output-format stream-json "$(cat /workspace/task.md)" > /workspace/claude-trace.jsonl'
        rc=$?
        set -e
        if [[ $rc -eq 0 ]] && jq -e 'select(.type == "result")' "$workspace/claude-trace.jsonl" >/dev/null 2>&1; then
            jq -c 'select(.type == "result")' "$workspace/claude-trace.jsonl" | tail -1 > "$workspace/claude-result.json"
            write_status complete 0
        else
            write_status invalid "$rc"
            exit 1
        fi
        ;;
    codex)
        set +e
        bwrap "${base[@]}" \
            --dir /root/.codex \
            --bind "$state/codex-home" /root/.codex \
            --ro-bind "$workspace/instructions.md" /root/.codex/AGENTS.md \
            --ro-bind /root/.local /root/.local \
            --ro-bind /root/.nvm /root/.nvm \
            --setenv CODEX_HOME /root/.codex \
            --setenv PATH /root/.local/bin:/root/.nvm/versions/node/v22.22.1/bin:/usr/local/bin:/usr/bin:/bin \
            /bin/bash -lc 'codex exec --ephemeral --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C /workspace/repo -m "$MODEL" -c model_reasoning_effort="\"$EFFORT\"" -o /workspace/codex-final.txt --json - < /workspace/task.md > /workspace/codex-trace.jsonl 2> /workspace/codex-stderr.txt'
        rc=$?
        set -e
        if [[ $rc -eq 0 && -s "$workspace/codex-final.txt" ]]; then
            write_status complete 0
        else
            write_status invalid "$rc"
            exit 1
        fi
        ;;
    *)
        echo "unknown agent: $agent" >&2
        exit 2
        ;;
esac
