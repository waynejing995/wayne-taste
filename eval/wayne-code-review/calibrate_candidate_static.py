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

from check_candidate_static import DESIGN_RESOURCE, PROTOCOL_RESOURCE, check_candidate


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

        # Required resource: the protocol the design-conformance agent carries verbatim.
        trial = clone("missing-design-protocol")
        (trial / DESIGN_RESOURCE).unlink()
        assert_invalid(
            trial, f"missing required resource: {DESIGN_RESOURCE}", "missing design protocol"
        )

        trial = clone("empty-design-protocol")
        (trial / DESIGN_RESOURCE).write_text("\n", encoding="utf-8")
        assert_invalid(
            trial, f"required resource is empty: {DESIGN_RESOURCE}", "empty design protocol"
        )

        trial = clone("symlink-design-protocol")
        path = trial / DESIGN_RESOURCE
        path.unlink()
        path.symlink_to(Path("..") / "SKILL.md")
        assert_invalid(trial, f"not a symlink: {DESIGN_RESOURCE}", "symlinked design protocol")

        trial = clone("unreferenced-design-protocol")
        replace(trial / "SKILL.md", re.escape(DESIGN_RESOURCE), "references/gone.md")
        assert_invalid(
            trial, f"body does not reference {DESIGN_RESOURCE}", "unreferenced design protocol"
        )

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

        # Phase 1: the target is an already-committed range, resolved to a SHA pair.
        trial = clone("working-tree-target")
        replace(
            trial / "SKILL.md",
            r"review those, never the working tree",
            "review the working tree",
        )
        assert_invalid(trial, "already-committed review target", "working-tree target")

        trial = clone("no-pr-input")
        replace(
            trial / "SKILL.md",
            r"an open PR — `gh pr view[^`]*`;",
            "whatever the caller pasted;",
        )
        assert_invalid(trial, "must take the target from an open PR", "no PR input")

        # A declared PR input with no code path is exactly the drift this pair catches.
        trial = clone("unresolved-pr")
        replace(trial / "SKILL.md", r"BASE_SHA=\$\(git merge-base[^\n]*", "BASE_SHA=$(git rev-parse HEAD~1)")
        assert_invalid(trial, "must resolve one", "unresolved PR input")

        trial = clone("unverified-shas")
        replace(trial / "SKILL.md", r"HEAD_SHA=\$\(git rev-parse --verify[^\n]*", "HEAD_SHA=HEAD")
        assert_invalid(trial, "resolve both endpoints with git rev-parse", "unverified SHAs")

        # Phase 1 refusals: an unnamed target and a dirty tree are not reviewable.
        trial = clone("no-target-refusal")
        replace(trial / "SKILL.md", r"- no PR or range was given\.[^\n]*\n", "")
        assert_invalid(trial, "refuse instead of inferring a base", "missing no-target refusal")

        trial = clone("dirty-tree-refusal")
        replace(
            trial / "SKILL.md",
            r"`git status --porcelain` is non-empty\.",
            "the tree is dirty.",
        )
        assert_invalid(
            trial, "git status --porcelain is non-empty", "missing dirty-tree refusal"
        )

        # Later phases and the shared prompt read that fixed pair, never an inferred base.
        trial = clone("inferred-diff-target")
        replace(trial / "SKILL.md", r"git diff \$BASE_SHA \$HEAD_SHA", "git diff HEAD~1 HEAD")
        assert_invalid(trial, "scope every git diff/log", "inferred diff target")

        trial = clone("origin-inference")
        replace(
            trial / "SKILL.md",
            r"The final report names that exact pair\.",
            "The final report names that exact pair. Absent one, fall back to `origin/HEAD`.",
        )
        assert_invalid(trial, "infer a review base from an origin/", "origin inference")

        # No automatic handoff: no checkpoint packet, no routing into wayne-verify.
        trial = clone("checkpoint-handoff")
        replace(
            trial / "SKILL.md",
            r"Nothing here hands off automatically; the user runs the next step\.",
            "Emit a `wayne-checkpoint` handoff packet for the next stage.",
        )
        assert_invalid(trial, "promise a wayne-checkpoint handoff", "checkpoint handoff")

        trial = clone("verify-routing")
        replace(
            trial / "SKILL.md",
            r"it is not a stage this review advances into",
            "hand off to wayne-verify as the next stage",
        )
        assert_invalid(trial, "route into wayne-verify as the next stage", "wayne-verify routing")

        # Phase 2 rule ledger: the project's own rule files, read at the frozen HEAD_SHA.
        trial = clone("no-rule-ledger")
        path = trial / "SKILL.md"
        replace(path, r"for f in AGENTS\.md CLAUDE\.md; do", "for f in RULES.txt; do")
        replace(path, r"docs/AGENTS\.md:14", "docs/RULES.txt:14")
        assert_invalid(trial, "build a rule ledger from the project's own", "no rule ledger")

        trial = clone("worktree-rules")
        replace(
            trial / "SKILL.md",
            r"never off the working tree",
            "straight off the checkout",
        )
        assert_invalid(
            trial, "object store at the frozen HEAD_SHA", "rules read from the working tree"
        )

        trial = clone("head-only-rules")
        path = trial / "SKILL.md"
        replace(
            path,
            r'for sha in "\$BASE_SHA" "\$HEAD_SHA"; do\n\s*git cat-file -e "\$sha:\$p" 2>/dev/null && \{ echo "\$p"; break; \}\n\s*done',
            'git cat-file -e "$HEAD_SHA:$p" 2>/dev/null && echo "$p"',
        )
        replace(
            path,
            r"A path can exist at only one endpoint[^.]*\.[^.]*\.",
            "",
        )
        assert_invalid(
            trial, "rule files present at either endpoint", "head-only rule collection"
        )

        # The design-conformance agent: a third finding source, dispatched outside Phase 4.
        trial = clone("no-design-agent")
        path = trial / "SKILL.md"
        replace(path, r"^### Dispatch: the design-conformance agent$", "### The sweep", re.M)
        replace(path, r"Dispatch one subagent carrying", "Do the sweep inline, reading")
        replace(
            path,
            r"^4\. \*\*Dispatch the design-conformance agent\*\*[^\n]*$",
            "4. **Sweep the repository yourself** — inline, with the ledger in hand",
            re.M,
        )
        assert_invalid(
            trial, "design-conformance agent as a third finding source", "no design agent"
        )

        trial = clone("design-agent-as-voice")
        path = trial / "SKILL.md"
        replace(path, r"^### Dispatch: the design-conformance agent$", "### The sweep", re.M)
        replace(path, r"Dispatch one subagent carrying", "Voice 3 carries")
        replace(
            path,
            r"^4\. \*\*Dispatch the design-conformance agent\*\*[^\n]*$",
            "4. **Third voice** — the repository sweep, and the only voice carrying the ledger",
            re.M,
        )
        replace(
            path,
            r"(\*\*Voice 2\s*[—–-]\s*Codex:\*\*)",
            "**Voice 3 — Design conformance:** Dispatch the design-conformance agent "
            "with the rule ledger.\n\n\\1",
        )
        assert_invalid(
            trial, "design-conformance agent outside Phase 4", "design agent as a third voice"
        )

        # The ledger reaches the design agent only; a voice never sees it.
        trial = clone("ledger-to-voices")
        replace(
            trial / "SKILL.md",
            r"\*\*The rule ledger goes to the design-conformance agent, never to these two\.\*\* "
            r"Do not append it to either prompt\.",
            "**Append the rule ledger to the prompt for both.**",
        )
        assert_invalid(
            trial, "keep the rule ledger out of both adversarial voice prompts", "ledger to voices"
        )

        # Phase 5 rules on every merged finding against that ledger, and names the rule
        # that killed one instead of dropping it in silence.
        trial = clone("no-adjudication")
        path = trial / "SKILL.md"
        replace(path, r"^### Adjudicate against the ledger$", "### Extra notes", re.M)
        replace(
            path, r"Rule on every merged finding, theirs and your own:", "Present them as merged:"
        )
        assert_invalid(trial, "adjudicate findings against the rule ledger", "no adjudication")

        trial = clone("silent-suppression")
        replace(
            trial / "SKILL.md",
            r"never fix it; report it as suppressed, naming the rule `file:line`",
            "drop it without mention",
        )
        assert_invalid(
            trial, "rule-contradicted finding instead of fixing", "silent suppression"
        )

        # The doc-justification check is scoped to the docs a project actually keeps.
        trial = clone("no-doc-justification")
        replace(
            trial / "SKILL.md",
            r"it is updated \*\*inside this same range\*\* and says \*\*why\*\*",
            "it can be updated whenever somebody gets to it",
        )
        assert_invalid(trial, "in-range doc update with a reason", "no doc justification")

        trial = clone("demand-docs")
        replace(
            trial / "SKILL.md",
            r"Never turn the absence into a demand that the project start writing design "
            r"docs; that is not this review's call\.",
            "File it as a finding: the project should start writing design docs.",
        )
        assert_invalid(
            trial, "must not demand design docs where the project keeps none", "demand docs"
        )

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
