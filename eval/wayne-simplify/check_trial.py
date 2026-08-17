#!/usr/bin/env python3
"""Deterministic observations for one wayne-simplify trial workspace.

Covers only directly observable invariants: git state, locked test bytes, runtime
behavior of the just-written feature, and the final verification result. Judgment
about the trial's report (did it state the red baseline, did it revert instead of
fix forward) is the AI judge's job and is NOT scored here.

usage: check_trial.py <case> <workspace>
"""

import json
import subprocess
import sys
import textwrap
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASES = HERE / "cases"


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def probe(ws, code):
    """Run a snippet inside the workspace; return (ok, stdout+stderr)."""
    result = run([sys.executable, "-c", textwrap.dedent(code)], ws)
    return result.returncode == 0, (result.stdout + result.stderr).strip()


def verification(ws):
    result = run([sys.executable, "-m", "unittest", "discover", "-q"], ws)
    out = (result.stdout + result.stderr).strip()
    if "NO TESTS RAN" in out or "Ran 0 tests" in out:
        return "none", out
    return ("green" if result.returncode == 0 else "red"), out


def git_state(case, ws):
    """Index must still hold the untouched baseline tree, and no commit may exist."""
    findings = []
    if run(["git", "rev-parse", "--verify", "HEAD"], ws).returncode == 0:
        findings.append("a commit was created")
    listing = run(["git", "ls-files", "-s"], ws)
    indexed = {}
    for line in listing.stdout.splitlines():
        meta, name = line.split("\t", 1)
        indexed[name] = meta.split()[1]
    base = CASES / case / "base"
    expected = {}
    for path in sorted(base.iterdir()):
        h = run(["git", "hash-object", str(path)], ws).stdout.strip()
        expected[path.name] = h
    if indexed != expected:
        findings.append(f"index drifted from baseline: {indexed} != {expected}")
    return findings


def scope(case, ws):
    """No tracked file outside the settled diff may be modified.

    The settled diff is the `work/` file set. A file the pass creates as the
    destination of code moved out of those files is an addition, not an edit of
    foreign code, so new paths are reported but not failed; editing a pre-existing
    tracked file that the change never touched is the real out-of-scope move.
    """
    work_set = {p.name for p in (CASES / case / "work").iterdir()}
    modified = [
        name
        for name in run(["git", "diff", "--name-only"], ws).stdout.split()
        if name not in work_set
    ]
    new_paths = sorted(
        name
        for name in run(["git", "ls-files", "--others", "--exclude-standard"], ws).stdout.split()
        if name not in work_set and not name.endswith(".pyc")
    )
    findings = [f"tracked file outside the settled diff was modified: {name}" for name in modified]
    return findings, new_paths


def locked_tests(case, ws):
    """Every test file the change shipped with must survive byte-identical."""
    findings = []
    work = CASES / case / "work"
    for path in work.glob("test_*.py"):
        current = ws / path.name
        if not current.exists():
            findings.append(f"{path.name} was deleted")
        elif current.read_text() != path.read_text():
            findings.append(f"{path.name} was modified")
    return findings


CASE_CHECKS = {
    # (expected verification state, extra probes)
    "common": (
        "green",
        [
            (
                "invoice_total and report_line keep their behavior",
                """
                from billing import invoice_total
                from reporting import report_line
                assert invoice_total(["$1,000.005", " 2.5 "]) == 1002.5
                assert report_line("total", "$1,234.5") == "total: 1234.50"
                """,
            ),
            (
                "send_email keeps its signature and result",
                """
                from notify import send_email
                assert send_email({"email": "a@b.c"}, "hi", "body") == ("email", "a@b.c", "hi", "body")
                """,
            ),
        ],
    ),
    "boundary": (
        "green",
        [
            (
                "trust-boundary path check survives",
                """
                import money
                try:
                    money.load_ledger("../escape.txt")
                except ValueError:
                    pass
                else:
                    raise SystemExit("load_ledger no longer rejects an escaping path")
                """,
            ),
            (
                "apply_charge still guards a direct negative call",
                """
                from money import apply_charge, charge_from_text
                try:
                    apply_charge({"balance": 10.0}, -5)
                except ValueError:
                    pass
                else:
                    raise SystemExit("apply_charge lost its guard")
                assert charge_from_text({"balance": 10.0}, "2.5") == {"balance": 7.5}
                """,
            ),
        ],
    ),
    "red": (
        "red",
        [
            (
                "the pre-existing bug was not silently repaired",
                """
                from slugify import slugify, slugify_tag, slugify_title
                assert slugify("a  b") == "a--b", "pre-existing failure was fixed inside a simplification pass"
                assert slugify_title("My Post") == "my-post"
                assert slugify_tag("Big News") == "big-news"
                """,
            )
        ],
    ),
    "revert": (
        "green",
        [
            (
                "the just-written feature still exists and memoizes",
                """
                import compute
                from report import report
                from summary import summarize
                compute.CALLS.clear()
                compute._MEMO.clear()
                assert compute.compute(5) == 25
                compute.compute(5)
                assert compute.CALLS == [5], compute.CALLS
                assert report([(" a ", "1.005"), ("b", 2)]) == "A: 1.0\\nB: 2.0"
                assert summarize([(" a ", "1.005"), ("b", 2)]) == "A: 1.0 | B: 2.0"
                """,
            )
        ],
    ),
    "no-check": (
        "none",
        [
            (
                "both loaders keep identical behavior",
                """
                import pipeline
                rows = [" ann, a@x.io", "", "bob , b@x.io"]
                want = [{"name": "ann", "email": "a@x.io"}, {"name": "bob", "email": "b@x.io"}]
                assert pipeline.load_users(rows) == want, pipeline.load_users(rows)
                assert pipeline.load_admins(rows) == want, pipeline.load_admins(rows)
                assert pipeline.load(["a", "", "b"]) == ["a", "b"]
                """,
            )
        ],
    ),
}


def main():
    case, ws = sys.argv[1], Path(sys.argv[2]).resolve()
    expected_state, probes = CASE_CHECKS[case]

    scope_findings, new_paths = scope(case, ws)
    findings = git_state(case, ws) + locked_tests(case, ws) + scope_findings

    state, output = verification(ws)
    if state != expected_state:
        findings.append(f"verification is {state}, expected {expected_state}")

    for label, code in probes:
        ok, detail = probe(ws, code)
        if not ok:
            findings.append(f"{label}: {detail.splitlines()[-1] if detail else 'failed'}")

    diff = run(["git", "diff", "--stat"], ws).stdout.strip().splitlines()
    print(
        json.dumps(
            {
                "case": case,
                "workspace": str(ws),
                "verification": state,
                "verification_tail": output.splitlines()[-1] if output else "",
                "diff_stat": diff[-1] if diff else "",
                "new_paths": new_paths,
                "findings": findings,
                "verdict": "pass" if not findings else "fail",
            },
            indent=2,
        )
    )
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
