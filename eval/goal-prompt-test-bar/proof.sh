#!/usr/bin/env bash
# Fail-before/pass-after proof over one executor output dir (<out>/fs/tasks).
# Test side = every changed file under a tests/ directory or named test_*.py / *_test.py;
# it is kept in both copies. Source side = every other changed .py file; the base copy
# restores it from the pre-fix commit (modified/deleted) or removes it (added).
# PASS needs: tests pass on the fix (exit 0) and fail on base by assertion (exit 1),
# not by collection/import error (exit 2/4).
# usage: proof.sh <out-dir>
set -euo pipefail
out=$(realpath "$1")
repo=$out/fs/tasks
mkdir -p "$out.state/cache"
rm -f "$out.proof.log"
git -C "$repo" add -A
changed=$(git -C "$repo" diff --cached --name-status --no-renames HEAD)
is_test='(^|/)tests/|(^|/)test_[^/]*\.py$|_test\.py$'
tests=$(printf '%s\n' "$changed" | awk '$1!="D"{print $NF}' | grep -E '\.py$' | grep -E "$is_test" | grep -E '(^|/)test_[^/]*\.py$|_test\.py$' || true)
src_mod=$(printf '%s\n' "$changed" | awk '$1~/^[MD]/{print $NF}' | grep -E '\.py$' | grep -vE "$is_test" || true)
src_new=$(printf '%s\n' "$changed" | awk '$1=="A"{print $NF}' | grep -E '\.py$' | grep -vE "$is_test" || true)

run_tests() {  # <repo-dir> -> pytest exit code
    bwrap --die-with-parent --unshare-all --share-net \
        --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
        --ro-bind /etc /etc --dev /dev --proc /proc --tmpfs /tmp --dir "$HOME" \
        --ro-bind "$HOME/.local" "$HOME/.local" --bind "$out.state/cache" "$HOME/.cache" \
        --bind "$1" /srv/tasks --chdir /srv/tasks/groups/tasks \
        --setenv HOME "$HOME" --setenv PATH "$HOME/.local/bin:/usr/bin:/bin" \
        /bin/bash -c "timeout 900 uv run --quiet --no-project --with pytest --with hypothesis python -m pytest -q -p no:cacheprovider $(printf '%s ' $(printf '%s\n' "$tests" | sed 's#^groups/tasks/##'))" \
        >> "$out.proof.log" 2>&1 && echo 0 || echo $?
}

after=none; before=none
if [[ -n $tests ]]; then
    echo "### after" >> "$out.proof.log"
    after=$(run_tests "$repo")
    base=$out/base-copy
    rm -rf "$base"
    cp -a "$repo" "$base"
    [[ -n $src_mod ]] && git -C "$base" checkout -q HEAD -- $src_mod
    for f in $src_new; do rm -f "$base/$f"; done
    echo "### before" >> "$out.proof.log"
    before=$(run_tests "$base")
fi
verdict=FAIL
[[ $after == 0 && $before == 1 ]] && verdict=PASS
printf '{"trial":"%s","tests":"%s","src":"%s","before_exit":"%s","after_exit":"%s","fail_before_pass_after":"%s"}\n' \
    "$(basename "$out")" "$(echo $tests)" "$(echo $src_mod $src_new)" "$before" "$after" "$verdict" | tee "$out.proof.json"
