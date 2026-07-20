#!/usr/bin/env python3
"""Calibrate the frozen Wayne Plan acceptance checker."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CHECKER = ROOT / "check_trial.py"
BASELINE = ROOT / "cases" / "normal"
POSITIVE = ROOT / "calibration-positive"
PLAN = Path("docs/plans/2026-07-15-001-feat-idempotent-delivery-retry-plan.md")


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise AssertionError(f"expected one occurrence of {old!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_first(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise AssertionError(f"expected at least one occurrence of {old!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def missing_requirement(repo: Path) -> None:
    replace_once(repo / PLAN, "| R9 | I2, I5 |\n", "")


def drift_e_row(repo: Path) -> None:
    replace_once(repo / PLAN, "the second says `created=false`", "the second reports `created=false`")


def missing_unit_field(repo: Path) -> None:
    path = repo / PLAN
    text = path.read_text(encoding="utf-8")
    needle = "#### Technical design\n\nnone — Approach fully defines the directional design.\n\n"
    if needle not in text:
        raise AssertionError("expected a Technical design field")
    path.write_text(text.replace(needle, "", 1), encoding="utf-8")


def forward_dependency(repo: Path) -> None:
    path = repo / PLAN
    text = path.read_text(encoding="utf-8")
    needle = "#### Dependencies\n\n- I1\n"
    if needle not in text:
        raise AssertionError("expected an I1 dependency")
    path.write_text(text.replace(needle, "#### Dependencies\n\n- I3\n", 1), encoding="utf-8")


def placeholder(repo: Path) -> None:
    replace_first(
        repo / PLAN,
        "none — Approach fully defines the directional design.",
        "TODO — add validation later.",
    )


def mapped_and_dropped(repo: Path) -> None:
    replace_once(repo / PLAN, "| Seed | Reason |\n|---|---|", "| Seed | Reason |\n|---|---|\n| US3 | duplicate disposition |")


def missing_seed(repo: Path) -> None:
    replace_once(repo / PLAN, "| U10 | I5 | US10 |", "| U10 | I5 | added |")


def wrong_u_owner(repo: Path) -> None:
    replace_once(repo / PLAN, "| U10 | I5 | US10 |", "| U10 | I4 | US10 |")


def missing_e_coverage(repo: Path) -> None:
    path = repo / PLAN
    text = path.read_text(encoding="utf-8")
    text = text.replace("- E4 — supplies every retry-wait field consumed by the formatter.\n", "")
    text = text.replace("- E4 — completes the formatter projection and non-mutation user path.\n", "")
    path.write_text(text, encoding="utf-8")


def mutate_upstream(repo: Path) -> None:
    path = repo / "docs/specs/2026-07-15-delivery-retry-design.md"
    replace_once(path, "- R1: A non-empty", "- R1: A trimmed non-empty")


def extra_artifact(repo: Path) -> None:
    (repo / "notes.md").write_text("unexpected\n", encoding="utf-8")


def hidden_original_e_table(repo: Path) -> None:
    drift_e_row(repo)
    matrix = (repo / "docs/test-matrix/2026-07-15-delivery-retry-matrix.md").read_text(
        encoding="utf-8"
    )
    match = re.search(
        r"^## E2E Verification Contract\s*$\n\n(\|[^\n]+\n\|[^\n]+\n(?:\|[^\n]+\n?)+)",
        matrix,
        re.MULTILINE,
    )
    if not match:
        raise AssertionError("source E table missing")
    path = repo / PLAN
    text = path.read_text(encoding="utf-8")
    insertion = f"## Overview\n\n<!--\n{match.group(1).rstrip()}\n-->"
    path.write_text(text.replace("## Overview", insertion, 1), encoding="utf-8")


def unknown_unit_requirement(repo: Path) -> None:
    replace_first(repo / PLAN, "#### Requirements\n\n- R1\n", "#### Requirements\n\n- R99\n")


def empty_u_owner(repo: Path) -> None:
    replace_once(repo / PLAN, "| U8 | I2 | US8 |", "| U8 | I3 | US8 |")
    path = repo / PLAN
    text = path.read_text(encoding="utf-8")
    text, count = re.subn(
        r"(### Unit I2 .*?#### Test scenarios\n\n)(.*?)(\n\n#### E rows)",
        r"\1none — store selection coverage was incorrectly omitted.\3",
        text,
        count=1,
        flags=re.DOTALL,
    )
    if count != 1:
        raise AssertionError("I2 Test scenarios not found")
    path.write_text(text, encoding="utf-8")


def unknown_early_dependency(repo: Path) -> None:
    replace_first(repo / PLAN, "#### Dependencies\n\n- I1\n", "#### Dependencies\n\n- I1\n- I0\n")


def missing_existing_surface(repo: Path) -> None:
    replace_once(
        repo / PLAN,
        "existing src/relay_queue/store.py::InMemoryDeliveryStore — prototype store to extend",
        "existing src/relay_queue/missing.py::Nope — nonexistent input",
    )


def short_filename(repo: Path) -> None:
    (repo / PLAN).rename(repo / "docs/plans/2026-07-15-001-feat-retry-plan.md")


def extra_empty_directory(repo: Path) -> None:
    (repo / "unexpected-empty-dir").mkdir()


def out_of_scope_surface(repo: Path) -> None:
    replace_first(
        repo / PLAN,
        "#### Files\n\n",
        "#### Files\n\n- src/relay_queue/network.py::HttpClient — new: unapproved network client\n",
    )


def lazy_continuation(repo: Path) -> None:
    replace_once(
        repo / PLAN,
        "- existing src/relay_queue/models.py::Delivery — prototype record shape being replaced",
        "- existing src/relay_queue/models.py::Delivery — prototype record shape\nbeing replaced",
    )


def existing_instance_field(repo: Path) -> None:
    replace_once(
        repo / PLAN,
        "- existing src/relay_queue/store.py::InMemoryDeliveryStore — prototype store to extend",
        "- existing src/relay_queue/store.py::InMemoryDeliveryStore — prototype store to extend\n"
        "- existing src/relay_queue/store.py::InMemoryDeliveryStore._records — current record storage",
    )


def clear_one_arrow_scenario(repo: Path) -> None:
    replace_once(
        repo / PLAN,
        "Empty or whitespace-only request_id, destination, and body values → construct each request → ValueError is raised before a store can mutate",
        "An empty or whitespace-only request field → reject before any store mutation.",
    )


def clear_multi_branch_scenario(repo: Path) -> None:
    replace_once(
        repo / PLAN,
        "Empty or whitespace-only request_id, destination, and body values → construct each request → ValueError is raised before a store can mutate",
        "Empty → reject before mutation; whitespace-only → reject before mutation; valid values → construct the request.",
    )


def run_normal(repo: Path) -> tuple[bool, list[str]]:
    completed = subprocess.run(
        [sys.executable, str(CHECKER), str(repo), str(BASELINE), "--case", "normal"],
        capture_output=True,
        check=False,
        text=True,
    )
    payload = json.loads(completed.stdout)
    return bool(payload["pass"]), list(payload["findings"])


def run_block(case: str, repo: Path, output: Path) -> tuple[bool, list[str]]:
    completed = subprocess.run(
        [
            sys.executable,
            str(CHECKER),
            str(repo),
            str(ROOT / "cases" / case),
            "--case",
            case,
            "--output",
            str(output),
        ],
        capture_output=True,
        check=False,
        text=True,
    )
    payload = json.loads(completed.stdout)
    return bool(payload["pass"]), list(payload["findings"])


def main() -> int:
    mutations: tuple[tuple[str, Callable[[Path], None], str], ...] = (
        ("missing requirement", missing_requirement, "requirement coverage mismatch"),
        ("verbatim E drift", drift_e_row, "not the exact first Test Matrix table"),
        ("missing unit field", missing_unit_field, "field order mismatch"),
        ("forward dependency", forward_dependency, "unknown, self, or later dependencies"),
        ("placeholder", placeholder, "banned placeholder"),
        ("mapped and dropped seed", mapped_and_dropped, "not-exactly-once"),
        ("missing seed", missing_seed, "U-SEED disposition mismatch"),
        ("wrong U owner", wrong_u_owner, "U ownership mismatch"),
        ("missing E coverage", missing_e_coverage, "E-row coverage mismatch"),
        ("upstream mutation", mutate_upstream, "files were modified"),
        ("extra artifact", extra_artifact, "exactly one added canonical plan"),
        ("original E hidden outside Test Matrix", hidden_original_e_table, "exact first Test Matrix table"),
        ("unknown unit requirement", unknown_unit_requirement, "unknown requirements"),
        ("feature unit without U owner", empty_u_owner, "feature-bearing unit has no owned U row"),
        ("unknown early dependency", unknown_early_dependency, "unknown, self, or later dependencies"),
        ("missing existing surface", missing_existing_surface, "missing existing surface"),
        ("canonical slug too short", short_filename, "exactly one added canonical plan"),
        ("unexpected empty directory", extra_empty_directory, "exactly one added canonical plan"),
        ("out-of-scope Files surface", out_of_scope_surface, "outside approved fixture scope"),
    )
    positive_mutations: tuple[tuple[str, Callable[[Path], None]], ...] = (
        ("CommonMark lazy continuation", lazy_continuation),
        ("existing direct instance field", existing_instance_field),
        ("clear one-arrow scenario", clear_one_arrow_scenario),
        ("clear multi-branch scenario", clear_multi_branch_scenario),
    )
    failures: list[str] = []
    print("| Case | Expected | Observed | Proof |")
    print("|---|---|---|---|")
    with tempfile.TemporaryDirectory(prefix="wayne-plan-checker-") as temp_dir:
        temp = Path(temp_dir)
        valid_repo = temp / "valid"
        shutil.copytree(POSITIVE, valid_repo)
        observed, findings = run_normal(valid_repo)
        ok = observed and not findings
        print(f"| valid normal | pass | {'pass' if observed else 'fail'} | {'OK' if ok else findings} |")
        if not ok:
            failures.append(f"valid normal: {findings}")

        for index, (name, mutate, expected_finding) in enumerate(mutations):
            repo = temp / f"mutation-{index}"
            shutil.copytree(POSITIVE, repo)
            mutate(repo)
            observed, findings = run_normal(repo)
            ok = not observed and any(expected_finding in finding for finding in findings)
            print(f"| {name} | fail | {'pass' if observed else 'fail'} | {'OK' if ok else findings} |")
            if not ok:
                failures.append(f"{name}: {findings}")

        for index, (name, mutate) in enumerate(positive_mutations):
            repo = temp / f"positive-mutation-{index}"
            shutil.copytree(POSITIVE, repo)
            mutate(repo)
            observed, findings = run_normal(repo)
            ok = observed and not findings
            print(f"| {name} | pass | {'pass' if observed else 'fail'} | {'OK' if ok else findings} |")
            if not ok:
                failures.append(f"{name}: {findings}")

        blockers = {
            "conflict": (
                "STATUS: BLOCKED\n"
                "REASON: PLAN_CONFLICT\n"
                "ARTIFACTS: docs/decisions/2026-07-15-delivery-retry-decisions.md;docs/plans/2026-07-14-worker-retry-plan.md\n"
                "OWNER: product-design\n"
                "检测到批准决策与 active plan 冲突；请由 product-design 解决后重试。\n"
            ),
            "missing-e2e": (
                "STATUS: BLOCKED\n"
                "REASON: MISSING_E2E\n"
                "ARTIFACTS: docs/specs/2026-07-15-delivery-retry-design.md;docs/test-matrix/2026-07-15-delivery-retry-matrix.md\n"
                "OWNER: test-design\n"
                "E2E contract 缺失；请由 test-design 补充并批准后重试。\n"
            ),
        }
        for case, content in blockers.items():
            repo = temp / f"block-{case}"
            shutil.copytree(ROOT / "cases" / case, repo)
            output = temp / f"{case}.txt"
            output.write_text(content, encoding="utf-8")
            observed, findings = run_block(case, repo, output)
            ok = observed and not findings
            print(f"| valid {case} block | pass | {'pass' if observed else 'fail'} | {'OK' if ok else findings} |")
            if not ok:
                failures.append(f"valid {case}: {findings}")

            output.write_text("Preamble\n" + content, encoding="utf-8")
            observed, findings = run_block(case, repo, output)
            ok = not observed and any("five non-empty lines" in finding for finding in findings)
            print(f"| {case} preamble | fail | {'pass' if observed else 'fail'} | {'OK' if ok else findings} |")
            if not ok:
                failures.append(f"{case} preamble: {findings}")

            output.write_text("\n" + content, encoding="utf-8")
            observed, findings = run_block(case, repo, output)
            ok = not observed and any("five non-empty lines and nothing else" in finding for finding in findings)
            print(f"| {case} blank line | fail | {'pass' if observed else 'fail'} | {'OK' if ok else findings} |")
            if not ok:
                failures.append(f"{case} blank line: {findings}")

    if failures:
        print("\n".join(failures))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
