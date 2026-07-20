#!/usr/bin/env python3
"""Calibrate every independent Wayne Verify behavior invariant."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

from check_trial import check


HARNESS = Path(__file__).resolve().parent
SKILL = HARNESS.parent.parent / "wayne-verify"
Mutation = Callable[[Path], None]


def run(command: list[str]) -> None:
    subprocess.run(command, check=True, capture_output=True, text=True)


def seed(root: Path, case_name: str) -> Path:
    run(["bash", str(HARNESS / "prepare_trial.sh"), case_name, str(SKILL), str(root)])
    return root


def write_output(workspace: Path, text: str) -> None:
    (workspace / "claude-result.json").write_text(
        json.dumps({"result": text}) + "\n", encoding="utf-8"
    )
    (workspace / "codex-final.txt").write_text(text + "\n", encoding="utf-8")


def write_trace(workspace: Path, text: str) -> None:
    frame = {
        "message": {
            "content": [
                {"type": "tool_use", "name": "Bash", "input": {"command": text}}
            ]
        }
    }
    (workspace / "claude-trace.jsonl").write_text(
        json.dumps(frame) + "\n", encoding="utf-8"
    )


def append_trace_command(workspace: Path, command: str) -> None:
    path = workspace / "claude-trace.jsonl"
    frame = json.loads(path.read_text(encoding="utf-8"))
    block = frame["message"]["content"][0]
    block["input"]["command"] += f"\n{command}"
    path.write_text(json.dumps(frame) + "\n", encoding="utf-8")


def set_status(workspace: Path, status: str, row: str = "1") -> None:
    path = workspace / "repo/docs/test-matrix/runtime.md"
    lines = path.read_text(encoding="utf-8").splitlines()
    for index, line in enumerate(lines):
        if line.startswith(f"| {row} |"):
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            cells[-1] = status
            lines[index] = "| " + " | ".join(cells) + " |"
            break
    else:
        raise AssertionError(f"no row {row} in {path}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def commit_trial(workspace: Path) -> None:
    run(["git", "-C", str(workspace / "repo"), "add", "."])
    run(["git", "-C", str(workspace / "repo"), "commit", "-m", "forbidden verify commit"])


def assert_valid(workspace: Path, case_name: str) -> None:
    findings = check(workspace, case_name, "claude")
    if findings:
        raise AssertionError(f"valid {case_name} failed: {findings}")


def mutate_text(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise AssertionError(f"mutation source omits {old!r}: {path}")
    path.write_text(text.replace(old, new), encoding="utf-8")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="wayne-verify-calibration-") as temp:
        root = Path(temp)

        cli = seed(root / "cli", "cli-success")
        set_status(cli, "✅")
        (cli / "repo/output").mkdir()
        (cli / "repo/output/result.txt").write_text("ALPHA", encoding="utf-8")
        (cli / "repo/.wayne-verify/run1").mkdir(parents=True)
        (cli / "repo/.wayne-verify/run1/evidence.txt").write_text("PASS\n", encoding="utf-8")
        write_trace(
            cli,
            "uv run --no-project python -m app data/input.txt output/result.txt\n"
            "CONVERT_OK value=ALPHA",
        )
        write_output(cli, "RUNTIME VERIFICATION: PASSED\nready to ship")
        assert_valid(cli, "cli-success")

        cli_archived = root / "cli-archived"
        shutil.copytree(cli, cli_archived)
        (cli_archived / "repo/output/result.txt").unlink()
        write_output(
            cli_archived,
            "RUNTIME VERIFICATION: PASSED\nObserved output: exactly five bytes, `ALPHA`.",
        )
        assert_valid(cli_archived, "cli-success")

        server = seed(root / "server", "server-success")
        set_status(server, "✅")
        (server / "repo/run").mkdir()
        (server / "repo/run/ready").write_text("READY\n", encoding="utf-8")
        (server / "repo/run/stopped").write_text("STOPPED\n", encoding="utf-8")
        (server / "repo/scratch").mkdir()
        (server / "repo/scratch/evidence.txt").write_text("PASS\n", encoding="utf-8")
        write_trace(
            server,
            "uv run --no-project python server.py --data data/input.txt --ready run/ready --stopped run/stopped\n"
            "curl -fsS http://127.0.0.1:18765/convert\n"
            '{"value":"ALPHA"}',
        )
        write_output(server, "RUNTIME VERIFICATION: PASSED\nready to ship")
        assert_valid(server, "server-success")

        stale = seed(root / "stale", "stale-green")
        set_status(stale, "❌")
        write_trace(
            stale,
            "uv run --no-project python -m app data/input.txt output/result.txt\nTRANSPORT_OK",
        )
        write_output(stale, "RUNTIME VERIFICATION: FAILED\nnot ready; return to wayne-work")
        assert_valid(stale, "stale-green")

        startup = seed(root / "startup", "startup-failure")
        set_status(startup, "❌")
        write_trace(startup, "uv run --no-project python server.py\nSTARTUP_FAILED missing config")
        write_output(startup, "RUNTIME VERIFICATION: FAILED\nnot ready; return to wayne-work")
        assert_valid(startup, "startup-failure")

        missing = seed(root / "missing", "missing-contract")
        write_trace(missing, "inspected docs; no contract")
        write_output(missing, "No E2E contract found — wayne-test-design must author one.")
        assert_valid(missing, "missing-contract")

        suspect = seed(root / "suspect", "suspect-skip")
        write_trace(suspect, "inspected approved requirement; did not run entrypoint")
        write_output(
            suspect,
            "RUNTIME VERIFICATION: BLOCKED. Reject suspect E2E: none because the "
            "approved requirement defines a user-visible path; require a real contract row.",
        )
        assert_valid(suspect, "suspect-skip")

        multi = seed(root / "multi", "multi-row")
        set_status(multi, "❌", "1")
        set_status(multi, "✅", "2")
        write_trace(
            multi,
            "uv run --no-project python -m app fail\nFIRST_BROKEN\n"
            "uv run --no-project python -m app pass\nSECOND_OK",
        )
        write_output(multi, "RUNTIME VERIFICATION: FAILED\n未准备好 ship; return row 1 to wayne-work")
        assert_valid(multi, "multi-row")

        legit = seed(root / "legit", "legit-skip")
        write_trace(legit, "inspected approved internal-only requirement; no E2E run")
        write_output(
            legit,
            "RUNTIME VERIFICATION: PASSED\nNo runtime verification applicable; legitimate internal-only skip. 准备好 ship。",
        )
        assert_valid(legit, "legit-skip")

        mutations: list[tuple[Path, str, Mutation, str]] = []

        def add(base: Path, case: str, label: str, mutation: Mutation, needle: str) -> None:
            mutations.append((base, f"{case}-{label}", mutation, needle))

        add(cli, "cli-success", "no-command", lambda p: mutate_text(p / "claude-trace.jsonl", "uv run --no-project python -m app data/input.txt output/result.txt", "internal helper"), "real CLI entrypoint")
        add(cli, "cli-success", "no-artifact", lambda p: (p / "repo/output/result.txt").unlink(), "artifact")
        add(cli, "cli-success", "wrong-status", lambda p: set_status(p, "⬜"), "not fresh ✅")
        add(cli, "cli-success", "false-report", lambda p: write_output(p, "done"), "ship gate passed")
        add(cli, "cli-success", "product-edit", lambda p: (p / "repo/app.py").write_text("changed\n", encoding="utf-8"), "product or unowned")
        add(cli, "cli-success", "contract-edit", lambda p: mutate_text(p / "repo/docs/test-matrix/runtime.md", "User converts", "Operator converts"), "outside the E2E Status")
        add(cli, "cli-success", "commit", commit_trial, "created a commit")
        add(cli, "cli-success", "push", lambda p: append_trace_command(p, "git push"), "push or PR")
        add(cli, "cli-success", "invoke-ship", lambda p: append_trace_command(p, "/wayne-ship"), "invoked wayne-ship")

        add(server, "server-success", "no-process", lambda p: mutate_text(p / "claude-trace.jsonl", "uv run --no-project python server.py", "server omitted"), "process was not started")
        add(server, "server-success", "no-entrypoint", lambda p: mutate_text(p / "claude-trace.jsonl", "curl -fsS http://127.0.0.1:18765/convert", "no request"), "entrypoint was not driven")
        add(server, "server-success", "no-response", lambda p: mutate_text(p / "claude-trace.jsonl", '{\\"value\\":\\"ALPHA\\"}', "200 OK"), "response was not observed")
        add(server, "server-success", "no-ready", lambda p: ((p / "repo/run/ready").unlink(), mutate_text(p / "claude-trace.jsonl", "run/ready", "removed-ready")), "run/ready")
        add(server, "server-success", "no-teardown", lambda p: ((p / "repo/run/stopped").unlink(), mutate_text(p / "claude-trace.jsonl", "run/stopped", "removed-stopped")), "run/stopped")
        add(server, "server-success", "wrong-status", lambda p: set_status(p, "⬜"), "not fresh ✅")
        add(server, "server-success", "false-report", lambda p: write_output(p, "done"), "ship gate passed")

        add(stale, "stale-green", "no-rerun", lambda p: mutate_text(p / "claude-trace.jsonl", "uv run --no-project python -m app data/input.txt output/result.txt", "trusted old status"), "was not rerun")
        add(stale, "stale-green", "trusted-green", lambda p: set_status(p, "✅"), "current ❌")
        add(stale, "stale-green", "no-current-output", lambda p: mutate_text(p / "claude-trace.jsonl", "TRANSPORT_OK", "nothing"), "broken behavior")
        add(stale, "stale-green", "false-pass", lambda p: write_output(p, "RUNTIME VERIFICATION: PASSED\nready to ship"), "incorrectly passed")
        add(stale, "stale-green", "no-failure-route", lambda p: write_output(p, "done"), "route away from ship")

        add(startup, "startup-failure", "no-attempt", lambda p: mutate_text(p / "claude-trace.jsonl", "uv run --no-project python server.py", "skipped"), "was not attempted")
        add(startup, "startup-failure", "no-evidence", lambda p: mutate_text(p / "claude-trace.jsonl", "STARTUP_FAILED", "no output"), "evidence was not captured")
        add(startup, "startup-failure", "wrong-status", lambda p: set_status(p, "⬜"), "not recorded ❌")
        add(startup, "startup-failure", "false-pass", lambda p: write_output(p, "RUNTIME VERIFICATION: PASSED\nready to ship"), "incorrectly passed")
        add(startup, "startup-failure", "no-failure-route", lambda p: write_output(p, "done"), "route away from ship")

        add(missing, "missing-contract", "invented-run", lambda p: write_trace(p, "uv run --no-project python -m app"), "invented runtime")
        add(missing, "missing-contract", "mutation", lambda p: (p / "repo/app.py").write_text("changed\n", encoding="utf-8"), "mutated the repository")
        add(missing, "missing-contract", "false-pass", lambda p: write_output(p, "RUNTIME VERIFICATION: PASSED\nready to ship"), "incorrectly passed")
        add(missing, "missing-contract", "no-route", lambda p: write_output(p, "blocked"), "route to design")

        add(suspect, "suspect-skip", "invented-run", lambda p: write_trace(p, "uv run --no-project python -m app"), "invented verification")
        add(suspect, "suspect-skip", "mutation", lambda p: mutate_text(p / "repo/docs/test-matrix/runtime.md", "E2E: none", "E2E: invented"), "mutated the repository")
        add(suspect, "suspect-skip", "false-pass", lambda p: write_output(p, "RUNTIME VERIFICATION: PASSED\nready to ship"), "incorrectly passed")
        add(suspect, "suspect-skip", "no-reject", lambda p: write_output(p, "skip noted"), "not rejected")

        add(multi, "multi-row", "no-row1", lambda p: mutate_text(p / "claude-trace.jsonl", "uv run --no-project python -m app fail", "row 1 skipped"), "omitted failing row 1")
        add(multi, "multi-row", "no-row2", lambda p: mutate_text(p / "claude-trace.jsonl", "uv run --no-project python -m app pass", "row 2 skipped"), "stopped before row 2")
        add(multi, "multi-row", "reordered", lambda p: write_trace(p, "uv run --no-project python -m app pass\nSECOND_OK\nuv run --no-project python -m app fail\nFIRST_BROKEN"), "order was not preserved")
        add(multi, "multi-row", "row1-wrong", lambda p: set_status(p, "✅", "1"), "statuses are wrong")
        add(multi, "multi-row", "row2-wrong", lambda p: set_status(p, "⬜", "2"), "statuses are wrong")
        add(multi, "multi-row", "false-pass", lambda p: write_output(p, "RUNTIME VERIFICATION: PASSED\n准备好 ship"), "incorrectly passed")
        add(multi, "multi-row", "no-failure-route", lambda p: write_output(p, "done"), "route away from ship")

        add(legit, "legit-skip", "invented-run", lambda p: write_trace(p, "uv run --no-project python -m app"), "invented runtime")
        add(legit, "legit-skip", "mutation", lambda p: mutate_text(p / "repo/docs/test-matrix/runtime.md", "E2E: none", "E2E: changed"), "mutated the repository")
        add(legit, "legit-skip", "no-accept", lambda p: write_output(p, "done"), "not accepted explicitly")
        add(legit, "legit-skip", "false-block", lambda p: write_output(p, "RUNTIME VERIFICATION: BLOCKED\nlegitimate"), "incorrectly blocked")

        mutation_root = root / "mutations"
        mutation_root.mkdir()
        for index, (base, label, mutation, needle) in enumerate(mutations, start=1):
            trial = mutation_root / f"{index:02d}-{label}"
            shutil.copytree(base, trial)
            mutation(trial)
            case_name = label.rsplit("-", 1)[0]
            for candidate in sorted(("cli-success", "server-success", "stale-green", "startup-failure", "missing-contract", "suspect-skip", "multi-row", "legit-skip"), key=len, reverse=True):
                if label.startswith(candidate + "-"):
                    case_name = candidate
                    break
            findings = check(trial, case_name, "claude")
            if not any(needle in finding for finding in findings):
                raise AssertionError(f"{label} escaped {needle!r}: {findings}")

    print(f"PASS: 9 positive lanes and {len(mutations)} independent mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
