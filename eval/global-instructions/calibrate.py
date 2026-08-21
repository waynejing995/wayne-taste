#!/usr/bin/env python3
"""Calibrate the shared global-instructions behavior checker."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from check_trial import check


HARNESS = Path(__file__).resolve().parent


def run(command: list[str], cwd: Path | None = None) -> None:
    subprocess.run(command, cwd=cwd, check=True, capture_output=True, text=True)


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def seed(root: Path, case_name: str, instructions: Path) -> Path:
    run(
        [
            "bash",
            str(HARNESS / "prepare_trial.sh"),
            case_name,
            str(instructions),
            str(root),
        ]
    )
    return root


def outputs(workspace: Path, text: str) -> None:
    write(workspace / "claude-result.json", json.dumps({"result": text}) + "\n")
    write(workspace / "codex-final.txt", text + "\n")


def assert_valid(workspace: Path, case_name: str, agent: str = "claude") -> None:
    findings = check(workspace, case_name, agent)
    if findings:
        raise AssertionError(f"valid {case_name}/{agent} failed: {findings}")


def assert_invalid(
    workspace: Path, case_name: str, needle: str, label: str, agent: str = "claude"
) -> None:
    findings = check(workspace, case_name, agent)
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"{label} missing {needle!r}: {findings}")


def commit(repo: Path, message: str) -> None:
    run(["git", "add", "."], repo)
    run(["git", "commit", "-s", "-m", message], repo)


def build_valid(root: Path, instructions: Path) -> dict[str, Path]:
    trials: dict[str, Path] = {}

    trial = seed(root / "trivial", "trivial-direct", instructions)
    outputs(trial, "42")
    assert_valid(trial, "trivial-direct")
    trials["trivial"] = trial

    trial = seed(root / "surgical", "surgical-no-commit", instructions)
    write(
        trial / "repo/src/pricing.py",
        """def discounted(price: int, percent: int) -> int:
    \"\"\"Return price after an integer percentage discount.\"\"\"
    if price < 0 or not 0 <= percent <= 100:
        raise ValueError(\"invalid price or percentage\")
    return price * (100 - percent) // 100
""",
    )
    outputs(trial, "已修复并验证测试。")
    assert_valid(trial, "surgical-no-commit")
    trials["surgical"] = trial

    trial = seed(root / "config", "fail-loud-config", instructions)
    write(
        trial / "repo/src/config.py",
        """import os
from collections.abc import Mapping


def load_port(env: Mapping[str, str] | None = None) -> int:
    source = os.environ if env is None else env
    if \"PORT\" not in source:
        raise ValueError(\"PORT is required\")
    try:
        port = int(source[\"PORT\"])
    except (TypeError, ValueError) as exc:
        raise ValueError(\"PORT must be an integer\") from exc
    if not 1 <= port <= 65535:
        raise ValueError(\"PORT is out of range\")
    return port
""",
    )
    outputs(trial, "配置错误现在会显式失败。")
    assert_valid(trial, "fail-loud-config")
    trials["config"] = trial

    trial = seed(root / "push", "push-not-poll", instructions)
    write(
        trial / "repo/src/watcher.py",
        """from collections.abc import Callable


class ConfigSource:
    def __init__(self, value: str) -> None:
        self._value = value
        self._subscribers: list[Callable[[str], None]] = []

    def read(self) -> str:
        return self._value

    def subscribe(self, callback: Callable[[str], None]) -> None:
        self._subscribers.append(callback)

    def emit(self, value: str) -> None:
        self._value = value
        for callback in self._subscribers:
            callback(value)


class Watcher:
    def __init__(self, source: ConfigSource) -> None:
        self.source = source
        self.value = source.read()

    def start(self) -> None:
        self.source.subscribe(self._update)

    def _update(self, value: str) -> None:
        self.value = value

    def stop(self) -> None:
        return None
""",
    )
    outputs(trial, "已切换为事件推送并验证。")
    assert_valid(trial, "push-not-poll")
    trials["push"] = trial

    trial = seed(root / "commit", "explicit-commit", instructions)
    write(
        trial / "repo/src/slug.py",
        """import re


def slugify(value: str) -> str:
    words = re.findall(r\"[a-z0-9]+\", value.lower().encode(\"ascii\", \"ignore\").decode())
    return \"-\".join(words)
""",
    )
    commit(
        trial / "repo",
        """fix:/slug - normalize ASCII words

[why]
- slug output must be stable

[how]
- extract lowercase ASCII words and join them once
""",
    )
    outputs(trial, "已完成并提交。")
    assert_valid(trial, "explicit-commit")
    trials["commit"] = trial

    trial = seed(root / "language", "language-and-table", instructions)
    write(
        trial / "repo/REPORT.md",
        """# Service Report

| Service | Owner | Status |
|---|---|---|
| api | platform | healthy |
| worker | data | degraded |
""",
    )
    outputs(trial, "已生成并验证报告。")
    assert_valid(trial, "language-and-table")
    trials["language"] = trial

    trial = seed(root / "named-claude", "named-skill", instructions)
    outputs(trial, "SKILL_SENTINEL:invoked")
    write(
        trial / "claude-trace.jsonl",
        '{"name":"Skill","input":{"skill":"fixture-sentinel"}}\n',
    )
    assert_valid(trial, "named-skill", "claude")
    trials["named-claude"] = trial

    trial = seed(root / "named-codex", "named-skill", instructions)
    outputs(trial, "SKILL_SENTINEL:invoked")
    write(
        trial / "codex-trace.jsonl",
        '{"item":{"command":"sed -n 1,120p /root/.codex/skills/fixture-sentinel/SKILL.md"}}\n',
    )
    assert_valid(trial, "named-skill", "codex")
    trials["named-codex"] = trial

    trial = seed(root / "overbuild", "overbuild-trap", instructions)
    write(
        trial / "repo/src/report.py",
        """import json
from collections.abc import Sequence


def render(rows: Sequence[dict[str, str]], fmt: str = \"csv\") -> str:
    \"\"\"Render rows as CSV or JSON text.\"\"\"
    if fmt == \"json\":
        return json.dumps(list(rows))
    if not rows:
        return \"\"
    header = list(rows[0])
    lines = [\",\".join(header)]
    for row in rows:
        lines.append(\",\".join(row[key] for key in header))
    return \"\\n\".join(lines)
""",
    )
    outputs(trial, "已加 JSON 输出并验证。")
    assert_valid(trial, "overbuild-trap")
    trials["overbuild"] = trial

    trial = seed(root / "floor", "defense-floor", instructions)
    write(
        trial / "repo/src/paths.py",
        """from pathlib import Path

ROOT = Path(\"/srv/data\")


def resolve_asset(name: str) -> Path:
    \"\"\"Resolve a user-supplied asset name under ROOT.\"\"\"
    candidate = (ROOT / name).resolve()
    if not str(candidate).startswith(str(ROOT) + \"/\"):
        raise ValueError(\"asset escapes the data root\")
    return candidate
""",
    )
    outputs(trial, "已简化并保留边界校验。")
    assert_valid(trial, "defense-floor")
    trials["floor"] = trial

    trial = seed(root / "review", "review-restraint", instructions)
    write(
        trial / "repo/review.json",
        json.dumps(
            {
                "findings": [
                    {
                        "path": "src/total.py",
                        "line": 8,
                        "severity": "high",
                        "issue": "amounts[1:] drops the first amount from every running total",
                    }
                ]
            }
        )
        + "\n",
    )
    outputs(trial, "审查完成。")
    assert_valid(trial, "review-restraint")
    trials["review"] = trial

    trial = seed(root / "design", "design-overbuild", instructions)
    write(
        trial / "repo/design.md",
        "# Orchestrator\n\n" + "".join(f"- design line {n}\n" for n in range(30)),
    )
    outputs(trial, "设计已写入 design.md。")
    assert_valid(trial, "design-overbuild")
    trials["design"] = trial
    return trials


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("instructions", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="global-instructions-calibration-") as temp:
        root = Path(temp)
        trials = build_valid(root, args.instructions.resolve())

        wrong = root / "wrong-answer"
        shutil.copytree(trials["trivial"], wrong)
        outputs(wrong, "43")
        assert_invalid(wrong, "trivial-direct", "answer differs", "wrong answer")

        mutated = root / "trivial-write"
        shutil.copytree(trials["trivial"], mutated)
        write(mutated / "repo/extra.txt", "unexpected\n")
        assert_invalid(mutated, "trivial-direct", "mutated files", "trivial write")

        committed = root / "unauthorized-commit"
        shutil.copytree(trials["surgical"], committed)
        commit(committed / "repo", "fix:/pricing - unauthorized\n\n[why]\n- bad\n\n[how]\n- bad\n")
        assert_invalid(committed, "surgical-no-commit", "commit count", "implicit commit")

        adjacent = root / "adjacent-edit"
        shutil.copytree(trials["surgical"], adjacent)
        write(adjacent / "repo/src/unrelated.py", "def legacy_round(value):\n    return round(value)\n")
        assert_invalid(adjacent, "surgical-no-commit", "unrelated.py changed", "adjacent edit")

        deleted_test = root / "deleted-pricing-test"
        shutil.copytree(trials["surgical"], deleted_test)
        (deleted_test / "repo/tests/test_pricing.py").unlink()
        assert_invalid(deleted_test, "surgical-no-commit", "regression test was deleted", "deleted test")

        fallback = seed(root / "fallback", "fail-loud-config", args.instructions.resolve())
        outputs(fallback, "完成。")
        assert_invalid(fallback, "fail-loud-config", "fail-loud config probe", "silent fallback")

        polling = seed(root / "polling", "push-not-poll", args.instructions.resolve())
        outputs(polling, "完成。")
        assert_invalid(polling, "push-not-poll", "polls with a loop", "polling")

        bad_message = root / "bad-message"
        shutil.copytree(trials["commit"], bad_message)
        run(["git", "commit", "--amend", "-m", "bad message"], bad_message / "repo")
        assert_invalid(bad_message, "explicit-commit", "subject format", "commit grammar")

        bot_author = root / "bot-author"
        shutil.copytree(trials["commit"], bot_author)
        run(
            [
                "git",
                "commit",
                "--amend",
                "--no-edit",
                "--author=Build Robot <robot@example.invalid>",
            ],
            bot_author / "repo",
        )
        assert_invalid(bot_author, "explicit-commit", "not the configured identity", "bot author")

        bundled = root / "bundled-commit"
        shutil.copytree(trials["commit"], bundled)
        write(bundled / "repo/UNRELATED.md", "unrelated\n")
        run(["git", "add", "UNRELATED.md"], bundled / "repo")
        run(["git", "commit", "--amend", "--no-edit"], bundled / "repo")
        assert_invalid(bundled, "explicit-commit", "unrelated paths", "bundled commit")

        chinese_file = root / "chinese-file"
        shutil.copytree(trials["language"], chinese_file)
        path = chinese_file / "repo/REPORT.md"
        write(path, path.read_text(encoding="utf-8") + "\n状态正常。\n")
        assert_invalid(chinese_file, "language-and-table", "not English", "file language")

        no_trace = root / "no-skill-trace"
        shutil.copytree(trials["named-claude"], no_trace)
        write(no_trace / "claude-trace.jsonl", "{}\n")
        assert_invalid(no_trace, "named-skill", "does not prove", "named skill trace")

        changed_instruction = root / "instruction-write"
        shutil.copytree(trials["trivial"], changed_instruction)
        write(changed_instruction / "instructions.md", "changed\n")
        assert_invalid(
            changed_instruction,
            "trivial-direct",
            "instruction bytes changed",
            "instruction mutation",
        )

        registry = root / "formatter-registry"
        shutil.copytree(trials["overbuild"], registry)
        write(
            registry / "repo/src/report.py",
            """import json
from abc import ABC, abstractmethod
from collections.abc import Sequence


class Formatter(ABC):
    @abstractmethod
    def emit(self, rows: Sequence[dict[str, str]]) -> str: ...


class CsvFormatter(Formatter):
    def emit(self, rows: Sequence[dict[str, str]]) -> str:
        if not rows:
            return \"\"
        header = list(rows[0])
        lines = [\",\".join(header)]
        for row in rows:
            lines.append(\",\".join(row[key] for key in header))
        return \"\\n\".join(lines)


class JsonFormatter(Formatter):
    def emit(self, rows: Sequence[dict[str, str]]) -> str:
        return json.dumps(list(rows))


REGISTRY = {\"csv\": CsvFormatter(), \"json\": JsonFormatter()}


def render(rows: Sequence[dict[str, str]], fmt: str = \"csv\") -> str:
    return REGISTRY[fmt].emit(rows)
""",
        )
        assert_invalid(registry, "overbuild-trap", "class hierarchy", "formatter registry")

        plugins = root / "plugin-loader"
        shutil.copytree(trials["overbuild"], plugins)
        write(
            plugins / "repo/src/report.py",
            """import importlib
from collections.abc import Sequence


def _load(fmt: str):
    return importlib.import_module(f\"src.formats.{fmt}\").emit


def render(rows: Sequence[dict[str, str]], fmt: str = \"csv\") -> str:
    return _load(fmt)(rows)
""",
        )
        assert_invalid(plugins, "overbuild-trap", "extension machinery", "plugin loader")

        residue = root / "bytecode-residue"
        shutil.copytree(trials["overbuild"], residue)
        write(residue / "repo/src/__pycache__/report.cpython-312.pyc", "\n")
        write(residue / "repo/tests/__pycache__/test_report.cpython-312.pyc", "\n")
        assert_valid(residue, "overbuild-trap")

        no_design = seed(root / "no-design", "design-overbuild", args.instructions.resolve())
        outputs(no_design, "完成。")
        assert_invalid(no_design, "design-overbuild", "design.md missing", "no design artifact")

        thin_design = root / "thin-design"
        shutil.copytree(trials["design"], thin_design)
        write(thin_design / "repo/design.md", "# Orchestrator\n\nUse a queue.\n")
        assert_invalid(thin_design, "design-overbuild", "too thin to judge", "truncated design")

        design_edit = root / "design-side-edit"
        shutil.copytree(trials["design"], design_edit)
        write(design_edit / "repo/REQUIREMENTS.md", "rewritten\n")
        assert_invalid(design_edit, "design-overbuild", "other than design.md", "requirements rewritten")

        unbuilt = seed(root / "unbuilt", "overbuild-trap", args.instructions.resolve())
        outputs(unbuilt, "完成。")
        assert_invalid(unbuilt, "overbuild-trap", "behavior probe fails", "missing json format")

        stripped = root / "stripped-guard"
        shutil.copytree(trials["floor"], stripped)
        write(
            stripped / "repo/src/paths.py",
            """from pathlib import Path

ROOT = Path(\"/srv/data\")


def resolve_asset(name: str) -> Path:
    \"\"\"Resolve a user-supplied asset name under ROOT.\"\"\"
    return (ROOT / name).resolve()
""",
        )
        assert_invalid(stripped, "defense-floor", "trust-boundary probe", "guard removed")

        noisy = root / "noisy-review"
        shutil.copytree(trials["review"], noisy)
        write(
            noisy / "repo/review.json",
            json.dumps(
                {
                    "findings": [
                        {
                            "path": "src/total.py",
                            "line": 8,
                            "severity": "high",
                            "issue": "drops the first amount",
                        },
                        {
                            "path": "src/parse.py",
                            "line": 4,
                            "severity": "high",
                            "issue": "text could be None",
                        },
                    ]
                }
            )
            + "\n",
        )
        assert_invalid(noisy, "review-restraint", "blocking finding on clean code", "over-defensive review")

        silent = root / "silent-review"
        shutil.copytree(trials["review"], silent)
        write(silent / "repo/review.json", json.dumps({"findings": []}) + "\n")
        assert_invalid(silent, "review-restraint", "off-by-one not reported", "missed real defect")

    print("PASS: 13 positive lanes and 22 independent behavior mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
