#!/usr/bin/env bash
# Run every case x side of the context-model eval in parallel, each in its own bwrap workspace.
# Usage: MODEL=opus EFFORT=high eval/context-model/run_all.sh <run-dir>
set -euo pipefail
: "${MODEL:?}" "${EFFORT:?}"
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
run=$(realpath -m "$1")
mkdir -p "$run"
cases=(init-common init-boundary init-missing compress-common compress-after-ship compress-smooth ship-phase8)
for c in "${cases[@]}"; do
    for side in control candidate; do
        ws="$run/$c/$side/ws"
        mkdir -p "$(dirname "$ws")"
        uv run --no-project python "$here/build.py" "$c" "$side" "$ws"
        # The trial copy of the state resolver must exist where skills look for it.
        (MODEL=$MODEL EFFORT=$EFFORT timeout 1500 "$root/eval/wayne-plan/run_agent.sh" claude "$ws" "$run/$c/$side/state" \
            > "$run/$c/$side/runner.log" 2>&1; echo "exit=$?" >> "$run/$c/$side/runner.log") &
    done
done
wait
echo done
