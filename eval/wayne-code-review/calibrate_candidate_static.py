#!/usr/bin/env python3
"""Calibrate static observations, not candidate semantics.

Every surviving gate in `check_candidate_static.py` must pass on the pristine
skill and fail on one seeded violation of that gate.
"""

from __future__ import annotations

import argparse
import re
import shutil
import tempfile
from pathlib import Path

from check_candidate_static import PROTOCOL_RESOURCE, check_candidate


DEFAULT_CANDIDATE = Path(__file__).resolve().parents[2] / "wayne-code-review"


def replace(path: Path, pattern: str, value: str, flags: int = 0) -> None:
    text = path.read_text(encoding="utf-8")
    changed, count = re.subn(pattern, value, text, flags=flags)
    if count == 0:
        raise AssertionError(f"mutation pattern did not match: {pattern!r} in {path}")
    path.write_text(changed, encoding="utf-8")


def assert_invalid(root: Path, needle: str, label: str) -> None:
    findings = check_candidate(root)
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"{label} missing {needle!r}: {findings}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate", type=Path, nargs="?", default=DEFAULT_CANDIDATE)
    args = parser.parse_args()
    candidate = args.candidate.resolve()
    findings = check_candidate(candidate)
    if findings:
        raise AssertionError(f"positive candidate failed: {findings}")

    with tempfile.TemporaryDirectory(prefix="wayne-review-static-") as temp:
        root = Path(temp)
        count = 0

        def clone(name: str) -> Path:
            nonlocal count
            count += 1
            target = root / name
            shutil.copytree(candidate, target)
            return target

        # Required resource: the one reviewer protocol file.
        trial = clone("missing-protocol")
        (trial / PROTOCOL_RESOURCE).unlink()
        assert_invalid(trial, "missing required resource", "missing protocol")

        trial = clone("empty-protocol")
        (trial / PROTOCOL_RESOURCE).write_text("\n", encoding="utf-8")
        assert_invalid(trial, "required resource is empty", "empty protocol")

        trial = clone("symlink-protocol")
        path = trial / PROTOCOL_RESOURCE
        path.unlink()
        path.symlink_to(Path("..") / "SKILL.md")
        assert_invalid(trial, "not a symlink", "symlinked protocol")

        trial = clone("unreferenced-protocol")
        replace(trial / "SKILL.md", re.escape(PROTOCOL_RESOURCE), "references/gone.md")
        assert_invalid(trial, "body does not reference", "unreferenced protocol")

        # Frontmatter shape.
        trial = clone("frontmatter-name")
        replace(trial / "SKILL.md", r"^name: wayne-code-review$", "name: wayne-review", re.M)
        assert_invalid(trial, "frontmatter name must be", "frontmatter name")

        trial = clone("frontmatter-extra")
        replace(trial / "SKILL.md", r"^name: wayne-code-review$", "model: opus\nname: wayne-code-review", re.M)
        assert_invalid(trial, "frontmatter keys must be exactly", "frontmatter keys")

        trial = clone("frontmatter-duplicate")
        replace(
            trial / "SKILL.md",
            r"^name: wayne-code-review$",
            "name: wayne-code-review\nname: wayne-code-review",
            re.M,
        )
        assert_invalid(trial, "duplicate frontmatter key", "duplicate frontmatter key")

        trial = clone("frontmatter-invalid-line")
        replace(trial / "SKILL.md", r"^name: wayne-code-review$", "name wayne-code-review", re.M)
        assert_invalid(trial, "invalid frontmatter line", "invalid frontmatter line")

        trial = clone("empty-description")
        replace(trial / "SKILL.md", r"^description: .*$", "description:", re.M)
        assert_invalid(trial, "description must be non-empty", "empty description")

        trial = clone("no-frontmatter")
        path = trial / "SKILL.md"
        path.write_text(
            re.sub(r"\A---\n.*?\n---\n", "", path.read_text(encoding="utf-8"), flags=re.DOTALL),
            encoding="utf-8",
        )
        assert_invalid(trial, "must start with YAML frontmatter", "no frontmatter")

        trial = clone("unclosed-frontmatter")
        path = trial / "SKILL.md"
        frontmatter = path.read_text(encoding="utf-8").split("---\n", 2)[1]
        path.write_text("---\n" + frontmatter, encoding="utf-8")
        assert_invalid(trial, "no closing delimiter", "unclosed frontmatter")

        trial = clone("empty-body")
        path = trial / "SKILL.md"
        frontmatter = path.read_text(encoding="utf-8").split("---\n", 2)[1]
        path.write_text("---\n" + frontmatter + "---\n", encoding="utf-8")
        assert_invalid(trial, "SKILL.md body is empty", "empty body")

        trial = clone("missing-skill")
        (trial / "SKILL.md").unlink()
        assert_invalid(trial, "missing SKILL.md", "missing SKILL.md")

        # Phase 4 dispatch section must exist at all.
        trial = clone("no-phase-4")
        replace(
            trial / "SKILL.md",
            r"^## Phase 4\b.*?(?=^## )",
            "",
            re.MULTILINE | re.DOTALL,
        )
        assert_invalid(trial, "no Phase 4 dual voice dispatch section", "missing Phase 4")

        # Both voice identities.
        trial = clone("voice-identity")
        replace(trial / "SKILL.md", r"codex", "alpha", re.IGNORECASE)
        assert_invalid(trial, "both Claude and Codex voices", "voice identity")

        # Exactly two dispatched voices, one Claude and one Codex.
        trial = clone("drop-voice-2")
        replace(
            trial / "SKILL.md",
            r"\*\*Voice 2\s*[—–-]\s*Codex:\*\*.*?(?=### Wait \+ Gather)",
            "",
            re.DOTALL,
        )
        assert_invalid(trial, "must dispatch exactly two voices", "dropped Codex dispatch")

        trial = clone("third-voice")
        replace(
            trial / "SKILL.md",
            r"(\*\*Voice 2\s*[—–-]\s*Codex:\*\*)",
            "**Voice 3 — Gemini:** Dispatch a third opinion.\n\n\\1",
        )
        assert_invalid(trial, "must dispatch exactly two voices", "third voice")

        trial = clone("voice-relabel")
        replace(trial / "SKILL.md", r"(\*\*Voice 2\s*[—–-]\s*)Codex:", r"\1Gemini:")
        assert_invalid(
            trial, "one Claude voice and one Codex voice", "non-Codex second voice"
        )

        # One protocol file is the single source of the shared prompt.
        trial = clone("per-voice-prompt")
        replace(
            trial / "SKILL.md",
            r"receive the \*\*same bytes\*\*",
            "receive their own separately written prompts",
        )
        assert_invalid(trial, "same bytes from", "per-voice prompt")

        # No crosstalk between the dispatched voices.
        trial = clone("crosstalk")
        replace(
            trial / "SKILL.md",
            r"Neither sees the other's output, nor your structured review from Phase 3\.",
            "Each voice is shown the other's output and your structured review.",
        )
        assert_invalid(trial, "neither dispatched voice sees", "crosstalk")

        # Parallel dispatch.
        trial = clone("serial-dispatch")
        replace(trial / "SKILL.md", r"parallel|concurrently", "sequentially", re.IGNORECASE)
        assert_invalid(trial, "parallel reviewer execution", "serial dispatch")

        # A degraded run must be labelled, never presented as dual-voice.
        trial = clone("unlabelled-degradation")
        replace(
            trial / "SKILL.md",
            r"single-voice|single voice|claude-only|claude only",
            "standard",
            re.IGNORECASE,
        )
        assert_invalid(trial, "not presented as dual-voice", "unlabelled degradation")

        # The formal gate obligations live in the Pi workflow.
        trial = clone("workflow-owner")
        replace(trial / "SKILL.md", r"wayne-code-review-flow", "some saved workflow")
        assert_invalid(trial, "must name wayne-code-review-flow", "workflow owner")

        # Static-only scope.
        trial = clone("static-only")
        replace(trial / "SKILL.md", r"Static Only", "Static Analysis")
        assert_invalid(trial, "static-only review", "static only")

        # Judgment calls belong to the user; the skill never commits.
        trial = clone("judgment-routing")
        replace(trial / "SKILL.md", r"judgment", "remaining", re.IGNORECASE)
        assert_invalid(trial, "route judgment calls to the user", "judgment routing")

        trial = clone("user-decides")
        replace(trial / "SKILL.md", r"the user decides", "we decide", re.IGNORECASE)
        assert_invalid(trial, "leave the decision to the user", "user decides")

        trial = clone("unapproved-fixes")
        replace(trial / "SKILL.md", r"user-approved", "recommended", re.IGNORECASE)
        assert_invalid(trial, "judgment-call fixes only after user approval", "unapproved fixes")

        # The no-approval path must stay a bounded mechanical allowlist.
        trial = clone("autofix-without-allowlist")
        replace(trial / "SKILL.md", r"Directly fix these without asking:", "Directly fix these:")
        assert_invalid(trial, "enumerated mechanical allowlist", "auto-fix without allowlist")

        trial = clone("autofix-unenumerated")
        path = trial / "SKILL.md"
        path.write_text(
            re.sub(
                r"(Directly fix these without asking:\n\n)(?:- .+\n)+",
                r"\1- Anything mechanical\n",
                path.read_text(encoding="utf-8"),
            ),
            encoding="utf-8",
        )
        assert_invalid(trial, "enumerated mechanical allowlist", "unenumerated auto-fix")

        trial = clone("commits")
        replace(trial / "SKILL.md", r"Never commit", "Then commit")
        replace(trial / "SKILL.md", r"does NOT run the app, commit,", "does NOT run the app,")
        assert_invalid(trial, "never commits", "commits")

        # Return-only handoff.
        trial = clone("auto-invoke")
        replace(trial / "SKILL.md", r"does NOT auto-invoke", "auto-invokes", re.IGNORECASE)
        assert_invalid(trial, "does not auto-invoke", "auto-invoke handoff")

        # The handoff must not point past a gate that never ran. Two independent
        # mutations, so each one proves its own half of the gate.
        trial = clone("ungated-handoff")
        replace(
            trial / "SKILL.md",
            r"only `GATE: PASS` may emit a packet",
            "a packet is emitted either way",
        )
        assert_invalid(trial, "NO_WAYNE_HANDOFF", "ungated handoff")

        trial = clone("no-handoff-refusal")
        replace(trial / "SKILL.md", r"NO_WAYNE_HANDOFF: code-review — <reason>", "nothing further")
        assert_invalid(trial, "NO_WAYNE_HANDOFF", "missing handoff refusal")

        # Forbidden dependency scan.
        trial = clone("forbidden-dependency")
        path = trial / PROTOCOL_RESOURCE
        path.write_text(
            path.read_text(encoding="utf-8") + "\nInvoke gstack for review.\n",
            encoding="utf-8",
        )
        assert_invalid(trial, "forbidden dependency", "forbidden dependency")

    print(
        f"PASS: static observations cover 1 candidate and {count} mutations; "
        "semantic verdict remains AI_REVIEW_REQUIRED"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
