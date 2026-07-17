#!/usr/bin/env python3
"""Calibrate the goal-prompt composition checker."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from check_trial import check


HARNESS = Path(__file__).resolve().parent
SKILL = HARNESS.parent.parent / "wayne-goal-prompt"


VAGUE = "你要改邮件重试还是支付重试，哪个具体失败和验收结果是目标？"

COMPOSE = """```text
Goal: Make `retry()` enforce the requested transient-only retry contract.

Context:
- Keep the public signature in `src/retry.py`.
- Do not print or commit the value of `RETRY_API_TOKEN`; use only the env-var name.

Tasks:
1. Implement at most three attempts for `TransientError` in `src/retry.py`.
   - Do not retry non-transient or other exceptions; re-raise them immediately.
2. Update unit tests and the real `retry_demo` module entrypoint.
   - Do not replace the real demo with a direct helper call.

Verification required before completion:
- `uv run --no-project python -m unittest discover -s tests -v`
- `uv run --no-project python -m retry_demo`
- Confirm the visible final line is exactly `RETRY_DEMO_OK attempts=3`.

Completion criteria:
- Unit tests prove three-attempt transient behavior and immediate non-transient re-raise.
- The real module command prints exactly `RETRY_DEMO_OK attempts=3`.
- No `RETRY_API_TOKEN` value is printed or committed.
```

这个 goal 对不对？在哪个 cwd 跑？"""

PLAN = """```text
Goal: Complete U1 and U2 from `docs/plans/2026-07-17-retry-plan.md`.

Context:
- Treat `docs/plans/2026-07-17-retry-plan.md` as the implementation SSoT.
- Do not change files outside the plan's approved paths.

Tasks:
1. Implement U1 — exception policy — exactly from the plan.
2. Implement U2 — CLI proof — exactly from the plan.
   - Do not substitute a direct `retry()` call for the module entrypoint.

Verification required before completion:
- `uv run --no-project python -m unittest discover -s tests -v`
- `uv run --no-project python -m retry_demo`
- Confirm the final line is exactly `RETRY_PLAN_OK attempts=3`.

Completion criteria:
- U1 and U2 are complete in order and unit tests pass.
- The real module entrypoint prints `RETRY_PLAN_OK attempts=3`.
- Only `src/retry.py`, `retry_demo.py`, and `tests/` change.
```

这个 goal 对不对？在哪个 cwd 跑？"""


def run(command: list[str]) -> None:
    subprocess.run(command, check=True, capture_output=True, text=True)


def seed(root: Path, case_name: str) -> Path:
    run(
        [
            "bash",
            str(HARNESS / "prepare_trial.sh"),
            case_name,
            str(SKILL),
            str(root),
        ]
    )
    return root


def write_output(workspace: Path, text: str) -> None:
    (workspace / "claude-result.json").write_text(
        json.dumps({"result": text}) + "\n", encoding="utf-8"
    )
    (workspace / "codex-final.txt").write_text(text + "\n", encoding="utf-8")


def assert_valid(workspace: Path, case_name: str, agent: str = "claude") -> None:
    findings = check(workspace, case_name, agent)
    if findings:
        raise AssertionError(f"valid {case_name}/{agent} failed: {findings}")


def assert_invalid(
    workspace: Path, case_name: str, text: str, needle: str, label: str
) -> None:
    trial = workspace.parent / label
    shutil.copytree(workspace, trial)
    write_output(trial, text)
    findings = check(trial, case_name, "claude")
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"{label} missing {needle!r}: {findings}")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="goal-prompt-calibration-") as temp:
        root = Path(temp)
        vague = seed(root / "vague", "vague-missing")
        write_output(vague, VAGUE)
        assert_valid(vague, "vague-missing")

        compose = seed(root / "compose", "compose-real-path")
        write_output(compose, COMPOSE)
        assert_valid(compose, "compose-real-path")
        assert_valid(compose, "compose-real-path", "codex")

        markdown_negative = seed(root / "markdown-negative", "compose-real-path")
        write_output(
            markdown_negative,
            COMPOSE.replace("non-transient", "non-`TransientError`"),
        )
        assert_valid(markdown_negative, "compose-real-path")

        accurate_confirm = seed(root / "accurate-confirm", "compose-real-path")
        write_output(
            accurate_confirm,
            COMPOSE.replace("这个 goal 对不对？", "请确认这个 goal 是否准确无误？"),
        )
        assert_valid(accurate_confirm, "compose-real-path")

        plan = seed(root / "plan", "existing-plan")
        write_output(plan, PLAN)
        assert_valid(plan, "existing-plan")

        assert_invalid(vague, "vague-missing", COMPOSE, "invented goal", "vague-invented")
        assert_invalid(
            vague,
            "vague-missing",
            VAGUE + "\n还要用什么命令？",
            "exactly one",
            "vague-two-questions",
        )
        assert_invalid(
            vague,
            "vague-missing",
            "你希望怎么验收？",
            "ambiguous retry target",
            "vague-target",
        )

        assert_invalid(
            compose,
            "compose-real-path",
            COMPOSE.replace("Context:", "Background:"),
            "required section",
            "missing-section",
        )
        assert_invalid(
            compose,
            "compose-real-path",
            COMPOSE.replace("Tasks:", "TEMP HEADING:", 1)
            .replace("Verification required before completion:", "Tasks:", 1)
            .replace("TEMP HEADING:", "Verification required before completion:", 1),
            "out of order",
            "wrong-order",
        )
        oversized = COMPOSE.replace("Keep the public signature", "x" * 4100)
        assert_invalid(compose, "compose-real-path", oversized, "exceeds 4000", "oversized")
        assert_invalid(
            compose,
            "compose-real-path",
            COMPOSE.replace("Tasks:", "Current correction:\n- retry\n\nTasks:"),
            "includes Current correction",
            "false-correction",
        )
        assert_invalid(
            compose,
            "compose-real-path",
            COMPOSE.replace(
                "uv run --no-project python -m retry_demo", "run the demo"
            ),
            "omits required literal",
            "missing-command",
        )
        assert_invalid(
            compose,
            "compose-real-path",
            COMPOSE.replace(
                "The real module command prints exactly `RETRY_DEMO_OK attempts=3`.",
                "It works well.",
            ),
            "vague verification",
            "vague-done",
        )
        assert_invalid(
            compose,
            "compose-real-path",
            COMPOSE + "\ns3cr3t-fixture-value",
            "leaks the fixture secret",
            "secret",
        )
        assert_invalid(
            compose,
            "compose-real-path",
            COMPOSE.replace("Do not replace the real demo with a direct helper call.", "Use the demo."),
            "fake-substitute boundary",
            "fake-path",
        )
        assert_invalid(
            compose,
            "compose-real-path",
            COMPOSE.replace(
                "   - Do not retry non-transient or other exceptions; re-raise them immediately.\n",
                "",
            ).replace(" and immediate non-transient re-raise", ""),
            "non-transient negative behavior",
            "missing-negative-behavior",
        )
        assert_invalid(
            compose,
            "compose-real-path",
            COMPOSE.replace("在哪个 cwd 跑？", "可以开始吗？"),
            "ask for cwd",
            "missing-cwd",
        )
        assert_invalid(
            compose,
            "compose-real-path",
            COMPOSE.replace("这个 goal 对不对？", "可以开始了吗？"),
            "goal is correct",
            "missing-goal-confirmation",
        )

        assert_invalid(
            plan,
            "existing-plan",
            PLAN.replace("Context:", "Context:\n- LATENT-ORANGE-CAPACITOR", 1),
            "rationale sentinel",
            "plan-sentinel",
        )
        assert_invalid(
            plan,
            "existing-plan",
            PLAN.replace(
                "Tasks:", "Tasks:\n- Implement the internal backoff bookkeeping.", 1
            ),
            "implementation detail",
            "plan-detail",
        )
        assert_invalid(
            plan,
            "existing-plan",
            PLAN.replace("docs/plans/2026-07-17-retry-plan.md", "the plan"),
            "plan-backed goal omits",
            "plan-path",
        )

        mutated = root / "repo-mutation"
        shutil.copytree(compose, mutated)
        (mutated / "repo/extra.txt").write_text("bad\n", encoding="utf-8")
        findings = check(mutated, "compose-real-path", "claude")
        if not any("mutated the product" in finding for finding in findings):
            raise AssertionError(f"repo mutation escaped: {findings}")

        file_write = root / "goal-file"
        shutil.copytree(compose, file_write)
        (file_write / "goal-retry.md").write_text(COMPOSE, encoding="utf-8")
        findings = check(file_write, "compose-real-path", "claude")
        if not any("unexpected files" in finding for finding in findings):
            raise AssertionError(f"pre-confirm goal file escaped: {findings}")

    print("PASS: 6 positive lanes and 19 independent mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
