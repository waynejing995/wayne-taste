#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["click>=8.1", "pyyaml>=6.0"]
# ///
"""Validate only the loader-level Wayne skill contract."""

from __future__ import annotations

import json
import re
from pathlib import Path

import click
import yaml


NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n(.*)\Z", re.DOTALL)
ALLOWED_FRONTMATTER = {"name", "description", "license", "allowed-tools", "metadata"}


def finding(code: str, message: str) -> dict[str, str]:
    return {"level": "error", "code": code, "message": message}


def validate(skill_dir: Path) -> tuple[list[dict[str, str]], dict[str, int]]:
    skill_path = skill_dir / "SKILL.md"
    findings: list[dict[str, str]] = []
    description_text = ""
    text = ""
    body = ""

    if not skill_path.is_file():
        findings.append(finding("skill-file", f"missing {skill_path}"))
    else:
        text = skill_path.read_text(encoding="utf-8")
        match = FRONTMATTER_RE.match(text)
        if not match:
            findings.append(
                finding("frontmatter", "missing or malformed YAML frontmatter")
            )
        else:
            body = match.group(2)
            try:
                data = yaml.safe_load(match.group(1))
            except yaml.YAMLError as exc:
                findings.append(finding("frontmatter", f"invalid YAML: {exc}"))
                data = None

            if not isinstance(data, dict):
                findings.append(
                    finding("frontmatter", "frontmatter must be a mapping")
                )
            else:
                keys = set(data)
                unexpected = keys - ALLOWED_FRONTMATTER
                missing = {"name", "description"} - keys
                if unexpected or missing:
                    findings.append(
                        finding(
                            "frontmatter-keys",
                            "frontmatter requires name + description and supports only "
                            f"{sorted(ALLOWED_FRONTMATTER)}; missing={sorted(missing)}, "
                            f"unexpected={sorted(unexpected)}",
                        )
                    )
                name = data.get("name")
                if not isinstance(name, str) or not NAME_RE.fullmatch(name):
                    findings.append(
                        finding("name", "name must be lowercase kebab-case")
                    )
                elif name != skill_dir.name:
                    findings.append(
                        finding(
                            "name-directory",
                            f"name {name!r} does not match directory {skill_dir.name!r}",
                        )
                    )
                elif len(name) > 64:
                    findings.append(finding("name-length", "name exceeds 64 characters"))
                description = data.get("description")
                if not isinstance(description, str) or not description.strip():
                    findings.append(
                        finding(
                            "description", "description must be a non-empty string"
                        )
                    )
                else:
                    description_text = description.strip()
                    if "<" in description_text or ">" in description_text:
                        findings.append(
                            finding(
                                "description-markup",
                                "description must not contain angle brackets",
                            )
                        )
                    if len(description_text) > 1024:
                        findings.append(
                            finding(
                                "description-length",
                                "description exceeds 1,024 characters",
                            )
                        )
            if not body.strip():
                findings.append(finding("body", "SKILL.md body must be non-empty"))

    metrics = {
        "description_chars": len(description_text),
        "lines": len(text.splitlines()),
        "words": len(text.split()),
        "errors": len(findings),
        "warnings": 0,
    }
    return findings, metrics


@click.command()
@click.argument(
    "skill_directory", type=click.Path(path_type=Path, exists=True, file_okay=False)
)
@click.option("--json-output", is_flag=True, help="Emit machine-readable JSON.")
def main(skill_directory: Path, json_output: bool) -> None:
    """Validate SKILL_DIRECTORY metadata required by the skill loader."""

    findings, metrics = validate(skill_directory.resolve())
    if json_output:
        print(
            json.dumps(
                {"metrics": metrics, "findings": findings},
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        print(
            f"{skill_directory}: {metrics['errors']} error(s), 0 warning(s); "
            f"{metrics['description_chars']} description chars, "
            f"{metrics['lines']} lines, {metrics['words']} words"
        )
        for item in findings:
            print(f"[ERROR] {item['code']}: {item['message']}")
    if findings:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
