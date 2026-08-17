#!/usr/bin/env python3
"""Deterministic observations for one wayne-work wave trial.

This script owns only directly observable state: locked inputs, git state, matrix
rows, the final verification, and the recorded event/read logs. It does NOT decide
whether the S node ran: a read timestamp proves file access, not execution, and a
de-duplicated diff proves neither (a worker reusing a helper produces the same
shape). That verdict comes from the arm's returned S receipt — scoped diff,
baseline command and result, post-edit command and result, applied list, skipped
list with reasons — judged against approved-intent.md, with the logs below as
corroboration.

usage: check_wave.py <arm> <workspace>
"""

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "cases" / "work-wave" / "repo"
MATRIX = "docs/test-matrix/2026-08-14-export-matrix.md"


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def locked_inputs(repo):
    findings = []
    for rel in ["tests/test_csv.py", "tests/test_json.py", "tests/__init__.py", "scripts/verify.py", "src/export/__init__.py"]:
        current, original = repo / rel, FIXTURE / rel
        if not current.exists():
            findings.append(f"{rel} was deleted")
        elif current.read_bytes() != original.read_bytes():
            findings.append(f"{rel} was modified")
    return findings


def matrix_rows(repo):
    text = (repo / MATRIX).read_text()
    u_open = sum(1 for line in text.splitlines() if line.startswith("| U") and "☐" in line)
    u_done = sum(1 for line in text.splitlines() if line.startswith("| U") and "☑" in line)
    e_open = sum(1 for line in text.splitlines() if line.startswith("| E") and "⬜" in line)
    return u_open, u_done, e_open


def events(ws):
    verify = []
    log = ws / "verify-events.log"
    if log.exists():
        for line in log.read_text().splitlines():
            stamp, mode, result = line.split()
            verify.append((float(stamp), mode, result))
    reads = []
    read_log = ws / "reads.log"
    if read_log.exists():
        for line in read_log.read_text().splitlines():
            parts = line.split()
            if len(parts) == 3 and parts[1] in {"open", "access"}:
                reads.append((float(parts[0]), parts[2]))
    return verify, reads


def main():
    arm, ws = sys.argv[1], Path(sys.argv[2]).resolve()
    repo = ws / "repo"
    findings = []

    findings += locked_inputs(repo)
    if run(["git", "rev-parse", "--verify", "HEAD"], repo).returncode == 0:
        findings.append("a commit was created")

    final = run([sys.executable, "scripts/verify.py", "full"], repo)
    if final.returncode != 0:
        findings.append("final `verify.py full` does not pass")

    u_open, u_done, e_open = matrix_rows(repo)
    if u_open or u_done != 4:
        findings.append(f"U rows not fully ticked: {u_done} done, {u_open} open")
    if e_open != 1:
        findings.append("an E row was changed")

    verify, reads = events(ws)
    greens = [t for t, _mode, result in verify if result == "PASS"]
    work_reads = [t for t, path in reads if path.endswith("wayne-work/SKILL.md")]
    all_simplify_reads = [t for t, path in reads if path.endswith("wayne-simplify/SKILL.md")]
    # A read that merely follows the link while wayne-work is being loaded is not the S node.
    # The S execution is the first read that happens after the wave first went green.
    first_green = min(greens) if greens else None
    s_reads = [t for t in all_simplify_reads if first_green and t > first_green]
    t_s = min(s_reads) if s_reads else None

    trace = {
        "wayne_work_read": bool(work_reads),
        "simplify_reads_total": len(all_simplify_reads),
        "simplify_read_after_green": t_s is not None,
        "verify_events": [(mode, result) for _t, mode, result in verify],
        "reverified_after_simplify": bool(t_s and any(t > t_s for t in greens)),
        "matrix_written_after_simplify": bool(t_s and (repo / MATRIX).stat().st_mtime > t_s),
    }

    if arm == "candidate" and not all_simplify_reads:
        findings.append("wayne-simplify/SKILL.md was never opened in this workspace")

    print(
        json.dumps(
            {
                "arm": arm,
                "workspace": str(ws),
                "final_verification": "pass" if final.returncode == 0 else "fail",
                "matrix": {"u_done": u_done, "u_open": u_open, "e_open": e_open},
                "trace": trace,
                "findings": findings,
                "verdict": "pass" if not findings else "fail",
            },
            indent=2,
        )
    )
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
