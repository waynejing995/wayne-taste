#!/usr/bin/env bash
# Open the next pipeline stage as a fresh `omp --goal` session in a new
# terminal: tern first, then herdr, then tmux. The goal tells the new agent
# to run <next-agent> from the handoff packet, which stays the single source
# of the task.
#
# usage: launch-stage.sh <next-agent> <packet-path> <cwd>
# stdout: one line `via=<tern|herdr|tmux> name=<session> target=<id>`
set -euo pipefail

[ $# -eq 3 ] || { echo "usage: $0 <next-agent> <packet-path> <cwd>" >&2; exit 2; }
next_agent=$1 packet=$2 cwd=$3
[ -f "$packet" ] || { echo "launch-stage: packet not found: $packet" >&2; exit 1; }
[ -d "$cwd" ] || { echo "launch-stage: cwd not found: $cwd" >&2; exit 1; }
omp_bin=$(command -v omp) || { echo "launch-stage: omp not on PATH" >&2; exit 1; }

packet=$(realpath "$packet")
cwd=$(realpath "$cwd")
name="${next_agent#wayne-}-$(date +%m%d-%H%M%S)"

goal_file="${packet%.md}.goal.md"
cat >"$goal_file" <<EOF
Follow the \`$next_agent\` skill.

Your task is the \`### Next Prompt\` section of the handoff packet \`$packet\`.
Read the whole packet first, then re-read every authoritative artifact it
references; the packet's progress summary is orientation only.
EOF

# One shell command for every backend. omp is pinned to the absolute path seen
# here, because a backend's login shell may rebuild PATH.
cmd="$(printf %q "$omp_bin") --goal \"\$(cat $(printf %q "$goal_file"))\"; exec bash"

# Each launcher returns non-zero on failure after removing anything it created,
# so a reachable-but-broken backend falls through to the next one.
warn() { echo "launch-stage: $*" >&2; }

launch_tern() {
	command -v tern >/dev/null && tern ls >/dev/null 2>&1 || return 1
	if ! tern new session "$name" --cwd "$cwd" --keep-open -- bash -lc "$cmd" >/dev/null; then
		warn "tern new session failed; trying the next backend"
		tern kill session "$name" >/dev/null 2>&1 || true
		return 1
	fi
	echo "via=tern name=$name target=$name"
}

launch_herdr() {
	[ "${HERDR_ENV:-}" = 1 ] && command -v herdr >/dev/null || return 1
	local created tab pane
	if ! created=$(herdr tab create --cwd "$cwd" --label "$name" --no-focus) ||
		! tab=$(jq -er '.result.tab.tab_id' <<<"$created") ||
		! pane=$(jq -er '.result.root_pane.pane_id' <<<"$created"); then
		warn "herdr tab create failed; trying the next backend"
		[ -n "${tab:-}" ] && herdr tab close "$tab" >/dev/null 2>&1
		return 1
	fi
	if ! herdr pane run "$pane" "$cmd" >/dev/null; then
		warn "herdr pane run failed; closed tab $tab, trying the next backend"
		herdr tab close "$tab" >/dev/null 2>&1 || true
		return 1
	fi
	echo "via=herdr name=$name target=$pane"
}

launch_tmux() {
	command -v tmux >/dev/null || return 1
	local target
	if [ -n "${TMUX:-}" ]; then
		target=$(tmux new-window -d -P -F '#{session_name}:#{window_index}' -n "$name" -c "$cwd" "bash -lc $(printf %q "$cmd")") || {
			warn "tmux new-window failed"
			return 1
		}
	else
		tmux new-session -d -s "$name" -c "$cwd" "bash -lc $(printf %q "$cmd")" || {
			warn "tmux new-session failed"
			return 1
		}
		target=$name
	fi
	echo "via=tmux name=$name target=$target"
}

launch_tern || launch_herdr || launch_tmux || {
	warn "no backend launched (tern daemon, herdr pane with HERDR_ENV=1, tmux); start $next_agent from $packet"
	exit 1
}
