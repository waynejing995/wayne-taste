#!/usr/bin/env python3
"""Static contract checker for the accepted Wayne Code Review skill directory.

Scope: what the skill's own prose must promise. Frozen review bytes and
"two valid voices or the run fails" are obligations of the `wayne-code-review-flow`
Pi workflow, not of this skill, and are deliberately not gated here.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


REQUIRED_NAME = "wayne-code-review"
PROTOCOL_RESOURCE = "references/reviewer-protocol.md"
REQUIRED_RESOURCES = (PROTOCOL_RESOURCE,)
FORBIDDEN_DEPENDENCIES = ("gstack",)
IGNORED_PARTS = {".git", "__pycache__", ".pytest_cache", ".ruff_cache"}


def parse_skill(path: Path) -> tuple[dict[str, str], str, list[str]]:
    findings: list[str] = []
    if not path.is_file():
        return {}, "", ["missing SKILL.md"]

    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, "", ["SKILL.md must start with YAML frontmatter"]

    try:
        end = next(index for index in range(1, len(lines)) if lines[index].strip() == "---")
    except StopIteration:
        return {}, "", ["SKILL.md frontmatter has no closing delimiter"]

    frontmatter: dict[str, str] = {}
    for line in lines[1:end]:
        if not line or line[0].isspace() or line.lstrip().startswith("#"):
            continue
        match = re.match(r"^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$", line)
        if not match:
            findings.append(f"invalid frontmatter line: {line!r}")
            continue
        key, value = match.groups()
        if key in frontmatter:
            findings.append(f"duplicate frontmatter key: {key}")
        frontmatter[key] = value.strip().strip("\"'")

    if set(frontmatter) != {"name", "description"}:
        findings.append(
            "frontmatter keys must be exactly name and description; "
            f"found={sorted(frontmatter)}"
        )
    if frontmatter.get("name") != REQUIRED_NAME:
        findings.append(
            f"frontmatter name must be {REQUIRED_NAME!r}; found={frontmatter.get('name')!r}"
        )
    if not frontmatter.get("description"):
        findings.append("frontmatter description must be non-empty")

    body = "\n".join(lines[end + 1 :]).strip()
    if not body:
        findings.append("SKILL.md body is empty")
    return frontmatter, body, findings


def text_files(root: Path) -> list[tuple[Path, str]]:
    result: list[tuple[Path, str]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or any(part in IGNORED_PARTS for part in path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        result.append((path, text))
    return result


def has_any(text: str, patterns: tuple[str, ...], *, flags: int = re.IGNORECASE) -> bool:
    return any(re.search(pattern, text, flags) for pattern in patterns)


def paragraphs(body: str) -> list[str]:
    """Lowercase, markup-stripped, whitespace-collapsed paragraphs."""
    result: list[str] = []
    for block in re.split(r"\n\s*\n", body):
        normalized = block.lower().replace("*", "").replace("`", "").replace("_", " ")
        result.append(re.sub(r"\s+", " ", normalized).strip())
    return result


def section(body: str, heading: str) -> str:
    """The `## <heading>` section of the body, up to the next `##` heading."""
    match = re.search(
        rf"^##\s+{re.escape(heading)}\b.*?(?=^##\s|\Z)",
        body,
        re.MULTILINE | re.DOTALL,
    )
    return match.group(0) if match else ""


def any_paragraph(blocks: list[str], *token_groups: tuple[str, ...]) -> bool:
    """True when one paragraph satisfies every group (a group needs one member)."""
    return any(
        all(any(token in block for token in group) for group in token_groups)
        for block in blocks
    )


def check_candidate(root: Path) -> list[str]:
    findings: list[str] = []
    if not root.is_dir():
        return [f"candidate is not a directory: {root}"]

    _, body, skill_findings = parse_skill(root / "SKILL.md")
    findings.extend(skill_findings)
    body_lower = body.lower()
    blocks = paragraphs(body)

    for relative in REQUIRED_RESOURCES:
        if relative not in body:
            findings.append(f"SKILL.md body does not reference {relative}")
        resource = root / relative
        if not resource.is_file():
            findings.append(f"missing required resource: {relative}")
        elif resource.is_symlink():
            findings.append(f"required resource must be self-contained, not a symlink: {relative}")
        elif not resource.read_text(encoding="utf-8").strip():
            findings.append(f"required resource is empty: {relative}")

    if "claude" not in body_lower or "codex" not in body_lower:
        findings.append("SKILL.md must require both Claude and Codex voices")

    # Exactly two *dispatched* voices, one Claude and one Codex. The main agent's own
    # structured review is a third finding source by design, not a dispatched voice,
    # so this is scoped to the dispatch section instead of counting global mentions.
    dispatch = section(body, "Phase 4")
    if not dispatch:
        findings.append("SKILL.md has no Phase 4 dual voice dispatch section")
    else:
        voices = re.findall(r"\*\*Voice\s*(\d+)\s*[—–-]\s*(.+?)\*\*", dispatch)
        if len(voices) != 2:
            findings.append(
                f"SKILL.md Phase 4 must dispatch exactly two voices; found={len(voices)}"
            )
        labels = " | ".join(label.lower() for _, label in voices)
        if sum("claude" in label.lower() for _, label in voices) != 1 or sum(
            "codex" in label.lower() for _, label in voices
        ) != 1:
            findings.append(
                "SKILL.md Phase 4 must dispatch one Claude voice and one Codex voice; "
                f"found={labels!r}"
            )

    dispatch_blocks = paragraphs(dispatch)

    # Single source of truth for the shared prompt: one protocol file, both voices.
    if not any_paragraph(
        dispatch_blocks,
        ("both", "each", "two"),
        ("same", "identical"),
        (PROTOCOL_RESOURCE, "reviewer-protocol.md"),
    ):
        findings.append(
            f"SKILL.md Phase 4 must send both voices the same bytes from {PROTOCOL_RESOURCE}"
        )

    # Neither dispatched voice sees the other's output or the structured review.
    no_crosstalk = (
        "neither sees the other",
        "neither knows what the other",
        "nothing from each other",
        "sees nothing from",
    )
    if not any_paragraph(dispatch_blocks, no_crosstalk):
        findings.append(
            "SKILL.md Phase 4 must state that neither dispatched voice sees the other's "
            "output or the structured review"
        )

    if not has_any(
        dispatch,
        (r"\bparallel\b", r"\bconcurrent(?:ly)?\b", r"both\s+start[^.]{0,80}before"),
    ):
        findings.append("SKILL.md must require parallel reviewer execution")

    # Degradation is allowed, silence is not: a missing voice must be labelled and
    # the result must not be presented as dual-voice.
    unavailable = ("unavailable", "not available", "fails", "failed")
    single_voice_label = ("single-voice", "single voice", "claude-only", "claude only")
    if not any_paragraph(blocks, unavailable, single_voice_label):
        findings.append(
            "SKILL.md must state that an unavailable voice is reported explicitly and "
            "not presented as dual-voice"
        )

    # Frozen review bytes and "two valid voices or fail" are the Pi workflow's
    # obligations; the skill must say so instead of implying it is the merge gate.
    if not any_paragraph(blocks, ("wayne-code-review-flow",), ("gate",)):
        findings.append(
            "SKILL.md must name wayne-code-review-flow as the formal gate that owns "
            "frozen bytes and two valid voices"
        )

    if not has_any(body, (r"\bstatic[- ]only\b",)):
        findings.append("SKILL.md must declare static-only review")

    # Phase 6 auto-fixes mechanical issues by design; judgment calls are the user's.
    if not has_any(
        body,
        (
            r"\bask\b[^.\n]{0,80}\bjudgment\b",
            r"\bjudgment\b[^.\n]{0,80}\b(?:ask|user)\b",
        ),
    ):
        findings.append("SKILL.md must route judgment calls to the user")
    if not has_any(body, (r"\bthe user decides\b",)):
        findings.append("SKILL.md must leave the decision to the user")
    if not has_any(
        body,
        (
            r"\bapply\b[^.\n]{0,40}\buser[- ]approved\b",
            r"\buser[- ]approved\b[^.\n]{0,40}\bappl(?:y|ied)\b",
        ),
    ):
        findings.append("SKILL.md must apply only user-approved fixes")

    if not has_any(
        body,
        (
            r"\bnever\s+commits?\b",
            r"\bdoes\s+not\b[^.\n]{0,60}\bcommit\b",
            r"\bdo\s+not\s+commit\b",
        ),
    ):
        findings.append("SKILL.md must state that the skill never commits")

    if not any_paragraph(
        blocks,
        ("return-only",),
        ("wayne-verify",),
        ("not auto-invoke", "never auto-invoke", "no auto-invoke"),
    ):
        findings.append(
            "SKILL.md must emit a return-only wayne-verify handoff that does not auto-invoke it"
        )

    for path, text in text_files(root):
        lower = text.lower()
        for dependency in FORBIDDEN_DEPENDENCIES:
            if dependency in lower:
                findings.append(
                    "candidate references forbidden dependency "
                    f"{dependency!r}: {path.relative_to(root)}"
                )

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate the static contract of the Wayne Code Review skill."
    )
    parser.add_argument("candidate", type=Path, help="skill directory")
    args = parser.parse_args()

    findings = check_candidate(args.candidate.resolve())
    result = {
        "semantic_verdict": "AI_REVIEW_REQUIRED",
        "observations": findings,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
