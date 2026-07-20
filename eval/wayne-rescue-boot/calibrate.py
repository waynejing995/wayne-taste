#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "click>=8.1",
#   "loguru>=0.7",
#   "pyyaml>=6.0",
# ]
# ///
"""Calibrate Rescue Boot applicability and disk-safety Flow."""

from __future__ import annotations

import hashlib
import importlib.util
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONTROL = "708779ef56efcf7df59cd90a41925d2e66d9aa87"


def git_show(path: str) -> bytes:
    return subprocess.run(
        ["git", "show", f"{CONTROL}:{path}"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    ).stdout


def validator():
    path = ROOT / "wayne-skill-forge/scripts/validate_skill.py"
    spec = importlib.util.spec_from_file_location("validate_skill", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def error_codes(module, text: str) -> set[str]:
    with tempfile.TemporaryDirectory(prefix="rescue-boot-calibration-") as temp:
        skill = Path(temp) / "wayne-rescue-boot"
        skill.mkdir()
        (skill / "SKILL.md").write_text(text, encoding="utf-8")
        findings, _ = module.validate(skill)
    return {item["code"] for item in findings if item["level"] == "error"}


def reachable(adjacency: dict[str, set[str]], start: str, target: str) -> bool:
    frontier = [start]
    seen = set()
    while frontier:
        node = frontier.pop()
        if node == target:
            return True
        if node not in seen:
            seen.add(node)
            frontier.extend(adjacency[node] - seen)
    return False


def flow_errors(module, text: str) -> list[str]:
    dot = module.DOT_BLOCK_RE.findall(text)[0]
    edges = module.DOT_EDGE_RE.findall(dot)
    edge_set = set(edges)
    access = '"Console or BMC path available?"'
    no_access = '"Stop: no rescue access"'
    health = '"Disk healthy enough to repair?"'
    unsafe = '"Stop: preserve data / replace disk"'
    diagnose = '"Diagnose: initrd / grub / fstab"'
    chroot = '"chroot: rebuild initramfs\\n+ update-grub"'
    required = {
        (access, no_access, 'label="no"'): "missing no-access stop",
        (health, unsafe, 'label="no"'): "missing unhealthy-disk stop",
        (health, diagnose, 'label="yes"'): "missing healthy repair path",
    }
    findings = [message for edge, message in required.items() if edge not in edge_set]
    adjacency: dict[str, set[str]] = defaultdict(set)
    for left, right, _ in edges:
        adjacency[left].add(right)
    if reachable(adjacency, no_access, chroot):
        findings.append("no-access path reaches chroot")
    if reachable(adjacency, unsafe, chroot):
        findings.append("unhealthy-disk path reaches chroot")
    if not reachable(adjacency, health, chroot):
        findings.append("healthy path cannot reach chroot")
    return findings


def main() -> int:
    control = git_show("wayne-rescue-boot/SKILL.md")
    expected_hash = (ROOT / "eval/wayne-rescue-boot/control.sha256").read_text().split()[0]
    assert hashlib.sha256(control).hexdigest() == expected_hash

    module = validator()
    assert error_codes(module, control.decode()) == {"inherits", "when-to-run"}
    candidate = (ROOT / "wayne-rescue-boot/SKILL.md").read_text(encoding="utf-8")
    assert not error_codes(module, candidate)
    assert "## Inherits from" not in candidate
    assert "## When to Run" not in candidate

    assert not flow_errors(module, candidate)
    missing_access = candidate.replace(
        '    "Console or BMC path available?" -> "Stop: no rescue access" [label="no"];\n',
        "",
    )
    assert "missing no-access stop" in flow_errors(module, missing_access)
    missing_health = candidate.replace(
        '    "Disk healthy enough to repair?" -> "Diagnose: initrd / grub / fstab" [label="yes"];\n',
        "",
    )
    assert "missing healthy repair path" in flow_errors(module, missing_health)
    unsafe_bypass = candidate.replace(
        '    "Disk healthy enough to repair?" -> "Stop: preserve data / replace disk" [label="no"];',
        '    "Stop: preserve data / replace disk" -> "chroot: rebuild initramfs\\n+ update-grub";',
    )
    assert "unhealthy-disk path reaches chroot" in flow_errors(module, unsafe_bypass)
    print("PASS: safety Flow and 3 independent edge mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
