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
mkdir -p \
    "$state/cache" \
    "$state/session-env" \
    "$state/codex-home/skills/fixture-sentinel"
touch "$state/codex-home/AGENTS.md"
for file in config.toml model-catalog-1m.json installation_id version.json auth.json; do
    [[ -f "/root/.codex/$file" ]] && cp "/root/.codex/$file" "$state/codex-home/"
done

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
        bwrap "${base[@]}" \
            --ro-bind /root/.local /root/.local \
            --ro-bind /root/.claude /root/.claude \
            --ro-bind /root/.claude.json /root/.claude.json \
            --tmpfs /root/.claude/skills \
            --dir /root/.claude/skills/fixture-sentinel \
            --ro-bind "$workspace/fixture-skill" /root/.claude/skills/fixture-sentinel \
            --ro-bind "$workspace/instructions.md" /root/.claude/CLAUDE.md \
            --bind "$state/session-env" /root/.claude/session-env \
            --setenv PATH /root/.local/bin:/usr/local/bin:/usr/bin:/bin \
            /bin/bash -lc 'claude -p --dangerously-skip-permissions --permission-mode bypassPermissions --setting-sources user --model "$MODEL" --effort "$EFFORT" --no-session-persistence --verbose --output-format stream-json "$(cat /workspace/task.md)" > /workspace/claude-trace.jsonl'
        jq -c 'select(.type == "result")' "$workspace/claude-trace.jsonl" | tail -1 > "$workspace/claude-result.json"
        ;;
    codex)
        bwrap "${base[@]}" \
            --dir /root/.codex \
            --bind "$state/codex-home" /root/.codex \
            --ro-bind "$workspace/instructions.md" /root/.codex/AGENTS.md \
            --ro-bind "$workspace/fixture-skill" /root/.codex/skills/fixture-sentinel \
            --ro-bind /root/.local /root/.local \
            --ro-bind /root/.nvm /root/.nvm \
            --setenv CODEX_HOME /root/.codex \
            --setenv PATH /root/.local/bin:/root/.nvm/versions/node/v22.22.1/bin:/usr/local/bin:/usr/bin:/bin \
            /bin/bash -lc 'codex exec --ephemeral --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C /workspace/repo -m "$MODEL" -c model_reasoning_effort="\"$EFFORT\"" -o /workspace/codex-final.txt --json - < /workspace/task.md > /workspace/codex-trace.jsonl 2> /workspace/codex-stderr.txt'
        ;;
    *)
        echo "unknown agent: $agent" >&2
        exit 2
        ;;
esac
