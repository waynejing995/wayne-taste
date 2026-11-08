#!/usr/bin/env bash
# Run one blind judge (claude or codex) with only <judge-dir> visible at /judge.
# usage: judge.sh <claude|codex> <judge-dir> <out-dir>
set -euo pipefail
agent=$1
judge=$(realpath "$2")
out=$(realpath -m "$3")
: "${MODEL:?}" "${EFFORT:?}"
mkdir -p "$out/cache" "$out/claude-home" "$out/codex-home"
[[ -f $HOME/.claude/settings.json ]] && jq '{env}' "$HOME/.claude/settings.json" > "$out/claude-home/settings.json"
for f in config.toml magpie-models.json model-catalog-1m.json installation_id version.json auth.json; do
    [[ -f $HOME/.codex/$f ]] && cp "$HOME/.codex/$f" "$out/codex-home/"
done
prompt="Read /judge/rubric.md and follow it exactly. Judge every trial under /judge/trials/. Write the JSON to /out/verdicts.json and also print it as your final message."
common=(
    --die-with-parent --new-session --unshare-all --share-net
    --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64
    --ro-bind /etc /etc --dev /dev --proc /proc --tmpfs /tmp --dir "$HOME"
    --ro-bind "$judge" /judge --bind "$out" /out --bind "$out/cache" "$HOME/.cache"
    --bind "$out/codex-home" "$HOME/.codex" --chdir /judge --setenv HOME "$HOME" --setenv CODEX_HOME "$HOME/.codex"
)
case $agent in
    claude)
        bwrap "${common[@]}" --ro-bind "$HOME/.local" "$HOME/.local" --bind "$out/claude-home" "$HOME/.claude" \
            --ro-bind "$HOME/.claude.json" "$HOME/.claude.json" --setenv PATH "$HOME/.local/bin:/usr/bin:/bin" \
            /bin/bash -lc "claude -p --safe-mode --dangerously-skip-permissions --permission-mode bypassPermissions --model \"\$MODEL\" --effort \"\$EFFORT\" --no-session-persistence --output-format json '$prompt' > /out/claude-result.json"
        ;;
    codex)
        codex_bin=$(command -v codex) || { echo "codex binary not found on PATH" >&2; exit 2; }
        node_bin=$(dirname "$codex_bin")
        bwrap "${common[@]}" --ro-bind "$HOME/.local" "$HOME/.local" --ro-bind "$HOME/.nvm" "$HOME/.nvm" \
            --setenv PATH "$HOME/.local/bin:$node_bin:/usr/bin:/bin" \
            /bin/bash -lc "codex exec --ephemeral --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C /judge -m \"\$MODEL\" -c model_reasoning_effort='\"'\"\$EFFORT\"'\"' -o /out/final.md '$prompt' > /out/codex-trace.log 2>&1"
        ;;
esac
