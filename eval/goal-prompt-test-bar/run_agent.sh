#!/usr/bin/env bash
# Run one Claude or Codex writer in bwrap. The frozen fixture under <workspace>/fs is
# bound read-write at the real absolute paths the task names; nothing else of the
# host's projects is visible.
set -euo pipefail

if [[ $# -ne 4 ]]; then
    echo "usage: $0 <claude|codex> <case> <workspace> <run-state>" >&2
    exit 2
fi
: "${MODEL:?set MODEL to the exact model slug}"
: "${EFFORT:?set EFFORT to the exact reasoning effort}"
command -v bwrap >/dev/null || { echo "bwrap is required" >&2; exit 2; }

agent=$1
case_name=$2
workspace=$(realpath "$3")
state=$(realpath -m "$4")
fs=$workspace/fs
mkdir -p "$state/cache" "$state/claude-home" "$state/codex-home"
if [[ -f $HOME/.claude/settings.json ]]; then
    jq '{env}' "$HOME/.claude/settings.json" > "$state/claude-home/settings.json"
fi
for file in config.toml magpie-models.json model-catalog-1m.json installation_id version.json auth.json; do
    [[ -f $HOME/.codex/$file ]] && cp "$HOME/.codex/$file" "$state/codex-home/"
done

case $case_name in
    monitor-preprocess)
        binds=(--bind "$fs/inbox-scripts" /srv/wayne-skills/wayne-inbox/scripts
               --ro-bind "$fs/omp-config.yml" "$HOME/.omp/agent/config.yml")
        cwd=/srv/wayne-skills/wayne-inbox/scripts
        ;;
    *)
        binds=(--bind "$fs/tasks" /srv/tasks)
        cwd=/srv/tasks
        ;;
esac

common=(
    --die-with-parent --new-session --unshare-all --share-net
    --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib
    --ro-bind /lib64 /lib64 --ro-bind /etc /etc --dev /dev --proc /proc
    --tmpfs /tmp --dir "$HOME" --dir "$HOME/.cache" --dir "$HOME/.codex"
    --bind "$state/cache" "$HOME/.cache"
    --bind "$state/codex-home" "$HOME/.codex"
    --bind "$workspace" /workspace
    --bind "$fs/wayne-home" "$HOME/.wayne"
    "${binds[@]}"
    --chdir "$cwd" --setenv HOME "$HOME" --setenv CODEX_HOME "$HOME/.codex"
    --setenv WAYNE_HOME "$HOME/.wayne"
)

case $agent in
    claude)
        bwrap "${common[@]}" \
            --ro-bind "$HOME/.local" "$HOME/.local" \
            --bind "$state/claude-home" "$HOME/.claude" \
            --ro-bind "$HOME/.claude.json" "$HOME/.claude.json" \
            --setenv PATH "$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" \
            /bin/bash -lc 'claude -p --safe-mode --dangerously-skip-permissions --permission-mode bypassPermissions --model "$MODEL" --effort "$EFFORT" --no-session-persistence --verbose --output-format stream-json "$(cat /workspace/task.md)" > /workspace/claude-trace.jsonl'
        jq -c 'select(.type == "result")' "$workspace/claude-trace.jsonl" | tail -1 > "$workspace/claude-result.json"
        jq -r '.result // empty' "$workspace/claude-result.json" > "$workspace/final.md"
        ;;
    codex)
        codex_bin=$(command -v codex) || { echo "codex binary not found on PATH" >&2; exit 2; }
        node_bin=$(dirname "$codex_bin")
        bwrap "${common[@]}" \
            --ro-bind "$HOME/.local" "$HOME/.local" \
            --ro-bind "$HOME/.nvm" "$HOME/.nvm" \
            --setenv PATH "$HOME/.local/bin:$node_bin:/usr/local/bin:/usr/bin:/bin" \
            /bin/bash -lc "codex exec --ephemeral --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C $cwd -m \"\$MODEL\" -c model_reasoning_effort=\"\\\"\$EFFORT\\\"\" -o /workspace/final.md - < /workspace/task.md > /workspace/codex-trace.log 2>&1"
        ;;
    *)
        echo "unknown agent: $agent" >&2
        exit 2
        ;;
esac
