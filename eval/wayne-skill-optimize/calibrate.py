#!/usr/bin/env python3
"""Calibrate deterministic dossier integrity without lexical semantics."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from check_review import manifest as review_manifest
from check_trial import validate


HARNESS = Path(__file__).resolve().parent
TEMPORAL_CHECKER = """#!/usr/bin/env python3
import json, sys
events = json.load(open(sys.argv[1], encoding="utf-8"))
kinds = [event["type"] for event in events]
assert kinds.index("answer") < kinds.index("decision_persisted") < kinds.index("question")
"""
POLICY_CHECKER = """#!/usr/bin/env python3
import json, sys
actions = json.load(open(sys.argv[1], encoding="utf-8"))
assert not any(item["dependency"] == "legacy-review-addon" for item in actions)
"""


def write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(value, str):
        path.write_text(value, encoding="utf-8")
    else:
        path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha(path: Path) -> str:
    return sha(path.read_bytes())


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True
    )
    return result.stdout.strip()


def source_set_hash(ledger: dict[str, object]) -> str:
    rows = [
        {"id": row["id"], "sha256": row["sha256"]}
        for row in ledger["sources"]  # type: ignore[index]
    ]
    encoded = json.dumps(sorted(rows, key=lambda row: row["id"]), separators=(",", ":"))
    return sha(encoded.encode())


def write_reviews(dossier: Path, ledger: dict[str, object]) -> None:
    source_hash = source_set_hash(ledger)
    ledger_hash = file_sha(dossier / "intent-ledger.json")
    source_ids = [row["id"] for row in ledger["sources"]]  # type: ignore[index]
    behavior_ids = [row["id"] for row in ledger["behaviors"]]  # type: ignore[index]
    oracle_ids = sorted(
        {
            oracle_id
            for row in ledger["behaviors"]  # type: ignore[index]
            for oracle_id in row["oracle_ids"]
        }
    )
    for provider in ("claude", "codex"):
        write(
            dossier / "semantic-reviews" / f"{provider}.json",
            {
                "version": 1,
                "provider": provider,
                "source_sha256": source_hash,
                "ledger_sha256": ledger_hash,
                "verdict": "PASS",
                "reviewed_source_ids": source_ids,
                "reviewed_behavior_ids": behavior_ids,
                "reviewed_oracle_ids": oracle_ids,
                "missing_requirements": [],
                "misclassified_behavior_ids": [],
                "notes": "Independent full-source reverse audit completed.",
            },
        )


def seed(root: Path) -> tuple[Path, Path, dict[str, object]]:
    repo = root / "repo"
    skill = repo / "decision-builder/SKILL.md"
    write(
        skill,
        "Ask exactly one question. Persist each answer before the next question.\n"
        "After approval run founder and engineering reviews, then return a planner handoff.\n",
    )
    git(repo, "init", "-q")
    git(repo, "config", "user.name", "Eval")
    git(repo, "config", "user.email", "eval@example.invalid")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "initial")
    initial = git(repo, "rev-parse", "HEAD")
    initial_skill = subprocess.run(
        ["git", "show", f"{initial}:decision-builder/SKILL.md"],
        cwd=repo,
        check=True,
        capture_output=True,
    ).stdout
    write(skill, "Ask questions and save decisions at the end.\n")
    write(
        repo / "policy.md",
        "legacy-review-addon is forbidden; founder and engineering capabilities remain.\n",
    )
    write(
        repo / "usage-feedback.md",
        "Decision 2 was not durable before question 3.\n",
    )
    claude_history = (
        '{"type":"state","decision_ids":[1]}\n'
        '{"type":"user","text":"Answer Q2: use the existing queue"}\n'
        '{"type":"tool","name":"AskUserQuestion","question":"Q3"}\n'
    )
    codex_history = claude_history.replace("AskUserQuestion", "request_user_input")
    write(repo / "session-history/claude-session.jsonl", claude_history)
    write(repo / "session-history/codex-session.jsonl", codex_history)
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "current")
    control = git(repo, "rev-parse", "HEAD")

    dossier = repo / "eval/decision-builder"
    sources = [
        {
            "id": "initial-skill",
            "path": "decision-builder/SKILL.md",
            "revision": initial,
            "sha256": sha(initial_skill),
        }
    ]
    for source_id, relative in (
        ("policy", "policy.md"),
        ("feedback", "usage-feedback.md"),
        ("claude-history", "session-history/claude-session.jsonl"),
        ("codex-history", "session-history/codex-session.jsonl"),
    ):
        sources.append(
            {
                "id": source_id,
                "path": relative,
                "revision": "WORKTREE",
                "sha256": file_sha(repo / relative),
            }
        )
    ledger: dict[str, object] = {
        "version": 1,
        "target": "decision-builder",
        "control_commit": control,
        "sources": sources,
        "behaviors": [
            {
                "id": "I1",
                "classification": "intended",
                "source_refs": [
                    {
                        "source_id": "initial-skill",
                        "exact": "Persist each answer before the next question.",
                    }
                ],
                "owner": "decision-builder",
                "oracle_ids": ["O1"],
                "status": "FROZEN",
            },
            {
                "id": "I2",
                "classification": "intended",
                "source_refs": [
                    {
                        "source_id": "policy",
                        "exact": "legacy-review-addon is forbidden; founder and engineering capabilities remain.",
                    }
                ],
                "owner": "decision-builder",
                "oracle_ids": ["O2"],
                "status": "FROZEN",
            },
        ],
        "milestones": [
            {
                "id": "M1",
                "precondition": "both reviews pass",
                "setter": "decision-builder",
                "allowed_next": "return planner handoff",
                "forbidden_next": "run planner",
                "mutable_artifact": "checkpoint",
            }
        ],
    }
    write(dossier / "intent-ledger.json", ledger)
    write(
        dossier / "failure-trace.json",
        {
            "version": 1,
            "histories": [
                {
                    "path": "session-history/claude-session.jsonl",
                    "sha256": file_sha(repo / "session-history/claude-session.jsonl"),
                },
                {
                    "path": "session-history/codex-session.jsonl",
                    "sha256": file_sha(repo / "session-history/codex-session.jsonl"),
                },
            ],
            "pre_state": {
                "source": "session-history/claude-session.jsonl",
                "exact": '{"type":"state","decision_ids":[1]}',
            },
            "user_transition": {
                "source": "session-history/claude-session.jsonl",
                "exact": '{"type":"user","text":"Answer Q2: use the existing queue"}',
            },
            "first_wrong_mutation": {
                "source": "session-history/claude-session.jsonl",
                "exact": '{"type":"tool","name":"AskUserQuestion","question":"Q3"}',
            },
        },
    )
    write(dossier / "check_temporal.py", TEMPORAL_CHECKER)
    write(dossier / "check_policy.py", POLICY_CHECKER)
    write(
        dossier / "events-valid.json",
        [{"type": "answer"}, {"type": "decision_persisted"}, {"type": "question"}],
    )
    write(
        dossier / "events-wrong-order.json",
        [{"type": "answer"}, {"type": "question"}, {"type": "decision_persisted"}],
    )
    write(dossier / "actions-valid.json", [])
    write(
        dossier / "actions-forbidden.json",
        [{"action": "invoke", "dependency": "legacy-review-addon"}],
    )
    write(
        dossier / "oracle-manifest.json",
        {
            "version": 1,
            "oracles": [
                {
                    "id": "O1",
                    "kind": "temporal",
                    "behavior_ids": ["I1"],
                    "positive": ["uv", "run", "--no-project", "python", "check_temporal.py", "events-valid.json"],
                    "mutations": [["uv", "run", "--no-project", "python", "check_temporal.py", "events-wrong-order.json"]],
                },
                {
                    "id": "O2",
                    "kind": "dependency",
                    "behavior_ids": ["I2"],
                    "positive": ["uv", "run", "--no-project", "python", "check_policy.py", "actions-valid.json"],
                    "mutations": [["uv", "run", "--no-project", "python", "check_policy.py", "actions-forbidden.json"]],
                },
            ],
        },
    )
    write_reviews(dossier, ledger)
    output = root / "output.txt"
    write(output, "Intent dossier and deterministic cases frozen for external review.\n")
    return output, dossier, ledger


def expect(
    root: Path, output: Path, needle: str, *, require_reviews: bool = True
) -> None:
    findings = validate(root, output, require_reviews=require_reviews)
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"mutation missed {needle!r}: {findings}")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="skill-optimize-calibration-") as temp:
        root = Path(temp)
        output, dossier, ledger = seed(root)
        findings = validate(root, output)
        if findings:
            raise AssertionError(f"positive fixture failed: {findings}")

        reviews = dossier / "semantic-reviews"
        saved_reviews = {
            path.name: path.read_text(encoding="utf-8") for path in reviews.glob("*.json")
        }
        shutil.rmtree(reviews)
        findings = validate(root, output, require_reviews=False)
        if findings:
            raise AssertionError(f"author-stage fixture failed without reviews: {findings}")
        expect(root, output, "cannot read claude.json")
        for filename, text in saved_reviews.items():
            write(reviews / filename, text)
        expect(
            root,
            output,
            "author created semantic reviews",
            require_reviews=False,
        )

        ledger_path = dossier / "intent-ledger.json"
        original_ledger = ledger_path.read_text(encoding="utf-8")
        changed = json.loads(original_ledger)
        changed["sources"][0]["sha256"] = "0" * 64
        write(ledger_path, changed)
        expect(root, output, "source hash mismatch")
        write(ledger_path, original_ledger)

        changed = json.loads(original_ledger)
        changed["control_commit"] = "0" * 40
        write(ledger_path, changed)
        expect(root, output, "control_commit does not match")
        write(ledger_path, original_ledger)

        changed = json.loads(original_ledger)
        changed["behaviors"][0]["classification"] = "guessed"
        write(ledger_path, changed)
        expect(root, output, "invalid classification")
        write(ledger_path, original_ledger)

        changed = json.loads(original_ledger)
        changed["behaviors"][0]["source_refs"][0]["exact"] = "absent excerpt"
        write(ledger_path, changed)
        expect(root, output, "source excerpt is absent")
        write(ledger_path, original_ledger)

        changed = json.loads(original_ledger)
        changed["behaviors"][0]["oracle_ids"] = ["O99"]
        write(ledger_path, changed)
        expect(root, output, "behavior/oracle ID closure")
        write(ledger_path, original_ledger)

        changed = json.loads(original_ledger)
        changed["milestones"][0]["mutable_artifact"] = ""
        write(ledger_path, changed)
        expect(root, output, "milestone lacks")
        write(ledger_path, original_ledger)

        trace_path = dossier / "failure-trace.json"
        original_trace = trace_path.read_text(encoding="utf-8")
        changed = json.loads(original_trace)
        changed["first_wrong_mutation"]["exact"] = "absent event"
        write(trace_path, changed)
        expect(root, output, "first_wrong_mutation excerpt is absent")
        write(trace_path, original_trace)

        changed = json.loads(original_trace)
        changed["histories"][0]["sha256"] = "0" * 64
        write(trace_path, changed)
        expect(root, output, "history hash mismatch")
        write(trace_path, original_trace)

        oracle_path = dossier / "oracle-manifest.json"
        original_oracles = oracle_path.read_text(encoding="utf-8")
        changed = json.loads(original_oracles)
        changed["oracles"][0]["positive"][-1] = "events-wrong-order.json"
        write(oracle_path, changed)
        expect(root, output, "oracle positive did not pass")
        write(oracle_path, original_oracles)

        changed = json.loads(original_oracles)
        changed["oracles"][0]["mutations"][0][-1] = "events-valid.json"
        write(oracle_path, changed)
        expect(root, output, "oracle mutation did not fail")
        write(oracle_path, original_oracles)

        review_path = dossier / "semantic-reviews/claude.json"
        original_review = review_path.read_text(encoding="utf-8")
        changed = json.loads(original_review)
        changed["verdict"] = "FAIL"
        write(review_path, changed)
        expect(root, output, "claude semantic review did not pass")
        write(review_path, original_review)

        changed = json.loads(original_review)
        changed["source_sha256"] = "0" * 64
        write(review_path, changed)
        expect(root, output, "claude semantic review source hash mismatch")
        write(review_path, original_review)

        changed = json.loads(original_review)
        changed["reviewed_source_ids"] = changed["reviewed_source_ids"][:-1]
        write(review_path, changed)
        expect(root, output, "reviewed_source_ids is incomplete")
        write(review_path, original_review)

        changed = json.loads(original_review)
        changed["missing_requirements"] = ["missing review capability"]
        write(review_path, changed)
        expect(root, output, "PASS contradicts reported gaps")
        write(review_path, original_review)

        (dossier / "candidate").mkdir()
        expect(root, output, "candidate was generated")
        (dossier / "candidate").rmdir()
        (dossier / "control-results").mkdir()
        expect(root, output, "control/candidate trials started")
        shutil.rmtree(dossier / "control-results")

        target = root / "repo/decision-builder/SKILL.md"
        original_target = target.read_text(encoding="utf-8")
        write(target, original_target + "edited\n")
        expect(root, output, "live target skill changed")
        write(target, original_target)

        policy = root / "repo/policy.md"
        original_policy = policy.read_text(encoding="utf-8")
        write(policy, original_policy + "edited\n")
        expect(root, output, "tracked input changed outside the dossier")
        write(policy, original_policy)

        escaped = root / "repo/notes.md"
        write(escaped, "escaped\n")
        expect(root, output, "untracked output escaped the dossier")
        escaped.unlink()

        original_output = output.read_text(encoding="utf-8")
        write(output, "")
        expect(root, output, "agent produced no user-visible summary")
        write(output, original_output)

        author = root / "review-author"
        shutil.copytree(root / "repo", author / "repo")
        shutil.rmtree(author / "repo/eval/decision-builder/semantic-reviews")
        review_workspace = root / "review-workspace"
        subprocess.run(
            [
                "bash",
                str(HARNESS / "prepare_review.sh"),
                str(author),
                "claude",
                str(review_workspace),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        expected_manifest = (
            review_workspace / "dossier-manifest.sha256"
        ).read_text(encoding="utf-8").splitlines()
        if review_manifest(review_workspace / "repo") != expected_manifest:
            raise AssertionError("prepared review manifest disagrees with checker")
        git_index = review_workspace / "repo/.git/index"
        original_index = git_index.read_bytes()
        git_index.write_bytes(original_index + b"stat-cache-change")
        if review_manifest(review_workspace / "repo") != expected_manifest:
            raise AssertionError("Git metadata caused a false source-mutation finding")
        git_index.write_bytes(original_index)
        expected_diff = (
            review_workspace / "repo-diff.sha256"
        ).read_text(encoding="utf-8").strip()
        write(review_workspace / "repo/policy.md", "changed source\n")
        current_diff = sha(
            git(
                review_workspace / "repo",
                "diff",
                "--binary",
                "--full-index",
                "HEAD",
                "--",
            ).encode()
        )
        if current_diff == expected_diff:
            raise AssertionError("frozen Git diff missed a source mutation")

        print("PASS: author/full-review fixtures plus 22 independent integrity mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
