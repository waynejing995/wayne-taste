#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "usage: $0 <claude|codex> <workspace> <run-state>" >&2
    exit 2
fi

: "${MODEL:?set MODEL to the exact agent model slug}"
: "${EFFORT:?set EFFORT to the exact reasoning effort}"
command -v bwrap >/dev/null || { echo "bwrap is required" >&2; exit 2; }

agent=$1
workspace=$(realpath "$2")
state=$(realpath -m "$3")
mkdir -p "$state/cache" "$state/session-env"

common=(
    --die-with-parent --new-session --unshare-all --share-net
    --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib
    --ro-bind /lib64 /lib64 --ro-bind /etc /etc --dev /dev --proc /proc
    --tmpfs /tmp --dir /root --dir /root/.cache
    --bind "$state/cache" /root/.cache
    --bind "$workspace" /workspace --chdir /workspace --setenv HOME /root
)

case "$agent" in
    claude)
        bwrap "${common[@]}" \
            --ro-bind /root/.local /root/.local \
            --ro-bind /root/.claude /root/.claude \
            --ro-bind /root/.claude.json /root/.claude.json \
            --tmpfs /root/.claude/skills \
            --bind "$state/session-env" /root/.claude/session-env \
            --setenv PATH /root/.local/bin:/usr/local/bin:/usr/bin:/bin \
            /bin/bash -lc 'claude -p --safe-mode --dangerously-skip-permissions --permission-mode bypassPermissions --model "$MODEL" --effort "$EFFORT" --no-session-persistence --verbose --output-format stream-json "$(cat /workspace/task.md)" > /workspace/claude-trace.jsonl'
        jq -c 'select(.type == "result")' "$workspace/claude-trace.jsonl" | tail -1 > "$workspace/claude-result.json"
        ;;
    codex)
        mkdir -p "$state/codex-home"
        for file in config.toml model-catalog-1m.json installation_id version.json; do
            [[ -f "/root/.codex/$file" ]] && cp "/root/.codex/$file" "$state/codex-home/"
        done
        bwrap "${common[@]}" \
            --dir /root/.codex --ro-bind /root/.local /root/.local \
            --ro-bind /root/.nvm /root/.nvm \
            --bind "$state/codex-home" /root/.codex \
            --setenv CODEX_HOME /root/.codex \
            --setenv PATH /root/.local/bin:/root/.nvm/versions/node/v22.22.1/bin:/usr/local/bin:/usr/bin:/bin \
            /bin/bash -lc 'codex exec --ephemeral --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C /workspace -m "$MODEL" -c model_reasoning_effort="\"$EFFORT\"" -o /workspace/codex-final.txt - < /workspace/task.md > /workspace/codex-trace.log 2>&1'
        ;;
    *)
        echo "unknown agent: $agent" >&2
        exit 2
        ;;
esac
