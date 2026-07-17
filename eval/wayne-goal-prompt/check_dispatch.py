#!/usr/bin/env python3
"""Execute and validate dispatch startup-failure and same-thread resume behavior."""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import tempfile
import time
from pathlib import Path


JOB_ID = re.compile(r"^job-[0-9-]+-\d+$", re.MULTILINE)


def validate_report(report: dict[str, object]) -> list[str]:
    findings: list[str] = []
    failure = report.get("failure", {})
    resume = report.get("resume", {})
    if not isinstance(failure, dict) or not isinstance(resume, dict):
        return ["dispatch report shape invalid"]
    failure_required = {
        "dispatch_failed": "startup failure returned success",
        "no_job_id": "startup failure emitted a successful job id",
        "log_preserved": "startup failure lost driver log",
        "reason_preserved": "startup failure lost provider reason",
    }
    resume_required = {
        "dispatch_started": "blocked fixture did not start",
        "blocked_observed": "blocked state not observed",
        "alive_while_blocked": "driver exited instead of keeping live thread",
        "resume_succeeded": "resume command failed",
        "same_thread_active": "resume did not reactivate the same thread",
        "completed": "resumed goal did not complete",
        "one_job": "resume created a replacement job",
    }
    for key, finding in failure_required.items():
        if failure.get(key) is not True:
            findings.append(finding)
    for key, finding in resume_required.items():
        if resume.get(key) is not True:
            findings.append(finding)
    return findings


def wait_for(path: Path, needle: str, timeout: float = 12.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.is_file() and needle in path.read_text(encoding="utf-8", errors="replace"):
            return True
        time.sleep(0.05)
    return False


def job_dirs(root: Path) -> list[Path]:
    return sorted(path.parent for path in root.rglob("meta.env"))


def metadata(job: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (job / "meta.env").read_text(encoding="utf-8").splitlines():
        key, _, value = line.partition("=")
        values[key] = value
    return values


def alive(pid: int) -> bool:
    if pid <= 1:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def stop(pid: int) -> None:
    if pid <= 1:
        return
    if not alive(pid):
        return
    os.kill(pid, signal.SIGTERM)
    time.sleep(0.1)
    if alive(pid):
        os.kill(pid, signal.SIGKILL)


def wrapper(fake: Path, bindir: Path) -> None:
    bindir.mkdir(parents=True)
    path = bindir / "codex"
    path.write_text(f"#!/usr/bin/env bash\nexec python3 {fake} \"$@\"\n", encoding="utf-8")
    path.chmod(0o755)


def run_candidate(skill: Path) -> dict[str, object]:
    script = skill / "scripts/codex-dispatch.sh"
    fake = Path(__file__).resolve().parent / "fake_codex.py"
    with tempfile.TemporaryDirectory(prefix="goal-dispatch-eval-") as temp:
        root = Path(temp)
        repo = root / "repo"
        repo.mkdir()
        goal = repo / "goal-fixture.md"
        goal.write_text("Goal: fixture\n", encoding="utf-8")
        bindir = root / "bin"
        wrapper(fake, bindir)
        base_env = os.environ.copy()
        base_env["PATH"] = f"{bindir}:{base_env['PATH']}"
        base_env["WAYNE_DISPATCH_STARTUP_TIMEOUT"] = "5"

        failure_home = root / "failure-jobs"
        failure_trace = root / "failure-trace.jsonl"
        env = base_env | {
            "CODEX_DISPATCH_HOME": str(failure_home),
            "FAKE_CODEX_MODE": "initialize-fail",
            "FAKE_CODEX_TRACE": str(failure_trace),
        }
        failure_run = subprocess.run(
            ["bash", str(script), "dispatch", str(goal), str(repo)],
            check=False,
            capture_output=True,
            text=True,
            env=env,
            timeout=15,
        )
        failure_jobs = job_dirs(failure_home)
        failure_log = failure_jobs[0] / "driver.log" if failure_jobs else root / "missing"
        failure = {
            "dispatch_failed": failure_run.returncode != 0,
            "no_job_id": JOB_ID.search(failure_run.stdout) is None,
            "log_preserved": failure_log.is_file(),
            "reason_preserved": failure_log.is_file()
            and "fixture provider unavailable" in failure_log.read_text(
                encoding="utf-8", errors="replace"
            ),
        }
        for job in failure_jobs:
            stop(int(metadata(job).get("PID", "0")))

        resume_home = root / "resume-jobs"
        resume_trace = root / "resume-trace.jsonl"
        env = base_env | {
            "CODEX_DISPATCH_HOME": str(resume_home),
            "FAKE_CODEX_MODE": "blocked-resume",
            "FAKE_CODEX_TRACE": str(resume_trace),
        }
        dispatch_run = subprocess.run(
            ["bash", str(script), "dispatch", str(goal), str(repo)],
            check=False,
            capture_output=True,
            text=True,
            env=env,
            timeout=15,
        )
        match = JOB_ID.search(dispatch_run.stdout)
        jobs_before = job_dirs(resume_home)
        blocked = False
        kept_alive = False
        resume_run = subprocess.CompletedProcess([], 1, "", "missing job")
        completed = False
        same_thread = False
        pid = 0
        if match and jobs_before:
            job = jobs_before[0]
            meta = metadata(job)
            pid = int(meta.get("PID", "0"))
            driver_log = Path(meta["DRIVER_LOG"])
            blocked = wait_for(driver_log, "goal.status = blocked")
            kept_alive = alive(pid)
            resume_run = subprocess.run(
                ["bash", str(script), "resume", match.group(0)],
                check=False,
                capture_output=True,
                text=True,
                env=env,
                timeout=15,
            )
            completed = wait_for(driver_log, "GOAL COMPLETE")
            if resume_trace.is_file():
                requests = [
                    json.loads(line)
                    for line in resume_trace.read_text(encoding="utf-8").splitlines()
                    if line.strip()
                ]
                same_thread = any(
                    row.get("method") == "thread/goal/set"
                    and row.get("params", {}).get("threadId") == "thread-fixture"
                    and row.get("params", {}).get("status") == "active"
                    for row in requests
                )
        jobs_after = job_dirs(resume_home)
        if pid:
            stop(pid)
        resume = {
            "dispatch_started": dispatch_run.returncode == 0 and match is not None,
            "blocked_observed": blocked,
            "alive_while_blocked": kept_alive,
            "resume_succeeded": resume_run.returncode == 0,
            "same_thread_active": same_thread,
            "completed": completed,
            "one_job": len(jobs_before) == 1 and len(jobs_after) == 1,
        }
        return {"failure": failure, "resume": resume}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = run_candidate(args.skill.resolve())
    if args.report:
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    findings = validate_report(report)
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print("PASS: dispatch startup failure and same-thread resume")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
