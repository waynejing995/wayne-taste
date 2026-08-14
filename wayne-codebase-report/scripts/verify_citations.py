#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["click>=8.1", "loguru>=0.7"]
# ///
"""Verify every path:line citation and verbatim quote in a codebase report.

Two checks, both mechanical:

1. Every backticked ``path`` or ``path:line`` reference resolves to a real file
   under one of the given roots, and the line number is within the file.
2. Every literal supplied via ``--quote path:line:literal`` appears verbatim on
   that exact line. Binding a quote to its source is the caller's job: the tool
   counts blockquote literals it can see and reports how many went unchecked,
   but it never guesses which file a blockquote came from.

The report section that reports these results is excluded by default, because a
self-inclusive count drifts on every edit.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import click
from loguru import logger

# A citation must look like a file: a known source/doc extension, and either a
# path separator or a hyphenated basename. `ctx.sessions` and `options.messages`
# are identifiers, not paths, and must not be treated as citations.
EXT = (
    "md|markdown|ts|tsx|js|mjs|cjs|jsx|json|jsonc|ya?ml|toml|ini|cfg|lock|"
    "py|rs|go|c|h|cpp|hpp|sh|bash|sql|txt|xml|html|css|proto"
)
REF_RE = re.compile(
    rf"`((?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.(?:{EXT}))(?::([0-9]+(?:[-,][0-9]+)*))?`"
)
SEGMENT_RE = re.compile(r"\A([0-9]+)(?:-([0-9]+))?\Z")

# Report contract: a verbatim source quote is a blockquote whose whole payload is
# one code span. Any other non-empty blockquote shape is a format error, because
# it cannot be bound to source bytes and would silently escape the coverage gate.
BLOCKQUOTE_LINE_RE = re.compile(r"^[ \t]*>[ \t]?(.*\S.*)$", re.MULTILINE)
CODE_SPAN_RE = re.compile(r"\A(`+)(.+)\1\Z", re.DOTALL)


def quote_payload(value: str) -> str | None:
    """Return the code-span payload of a blockquote line, or None if not one."""
    match = CODE_SPAN_RE.match(value.strip())
    return match.group(2).strip() if match else None


def line_targets(selector: str) -> tuple[list[int], str | None]:
    """Expand a `12`, `12-20`, or `57,59-60` selector into the lines it asserts."""
    targets: list[int] = []
    for segment in selector.split(","):
        match = SEGMENT_RE.match(segment)
        if not match:
            return [], f"unparseable line selector {selector!r}"
        start = int(match.group(1))
        end = int(match.group(2) or match.group(1))
        if end < start:
            return [], f"reversed range {segment!r} in {selector!r}"
        targets.extend((start, end))
    return targets, None


def resolve(ref: str, roots: list[Path], aliases: dict[str, str]) -> Path | None:
    if ref in aliases:
        ref = aliases[ref]
    for root in roots:
        candidate = root / ref
        if candidate.is_file():
            return candidate
    direct = Path(ref)
    return direct if direct.is_file() else None


def line_count(path: Path) -> int:
    with path.open("rb") as handle:
        return sum(1 for _ in handle)


def check_refs(
    text: str,
    roots: list[Path],
    aliases: dict[str, str],
    placeholders: set[str],
    expect_missing: set[str],
) -> dict:
    seen: set[tuple[str, str | None]] = set()
    ok: list[str] = []
    unresolved: list[str] = []
    out_of_range: list[str] = []
    skipped: list[str] = []
    declared_missing: list[str] = []
    wrongly_present: list[str] = []
    wrongly_present_seen: set[str] = set()

    for match in REF_RE.finditer(text):
        ref, selector = match.group(1), match.group(2)
        if (ref, selector) in seen:
            continue
        seen.add((ref, selector))
        if ref in placeholders:
            skipped.append(ref)
            continue
        path = resolve(ref, roots, aliases)
        if ref in expect_missing:
            if path is None:
                declared_missing.append(ref)
            elif ref not in wrongly_present_seen:
                wrongly_present_seen.add(ref)
                wrongly_present.append(f"{ref} exists but was declared missing")
            continue
        if path is None:
            unresolved.append(f"{ref}:{line}" if line else ref)
            continue
        if selector:
            targets, error = line_targets(selector)
            if error:
                out_of_range.append(f"{ref}: {error}")
                continue
            total = line_count(path)
            over = [value for value in targets if value > total]
            if over:
                out_of_range.append(
                    f"{ref}:{selector} references line {max(over)} but the file has {total}"
                )
                continue
        ok.append(ref)

    return {
        "unique": len(seen),
        "resolved": len(ok),
        "placeholders": len(skipped),
        "declared_missing": len(declared_missing),
        "unresolved": unresolved,
        "out_of_range": out_of_range,
        "wrongly_present": wrongly_present,
    }


def check_quotes(specs: tuple[str, ...], roots: list[Path], aliases: dict[str, str]) -> dict:
    hits: list[str] = []
    hit_literals: set[str] = set()
    misses: list[str] = []
    for spec in specs:
        try:
            ref, line_s, literal = spec.split(":", 2)
        except ValueError:
            misses.append(f"malformed --quote (want path:line:literal): {spec}")
            continue
        path = resolve(ref, roots, aliases)
        if path is None:
            misses.append(f"{ref}: file not found")
            continue
        lines = path.read_text(encoding="utf-8", errors="replace").split("\n")
        index = int(line_s)
        if index < 1 or index > len(lines):
            misses.append(f"{ref}:{line_s}: line out of range")
            continue
        if literal in lines[index - 1]:
            hits.append(f"{ref}:{line_s}")
            hit_literals.add(literal.strip())
        else:
            found = [i + 1 for i, value in enumerate(lines) if literal in value][:4]
            misses.append(f"{ref}:{line_s}: literal not on that line; found at {found or 'nowhere'}")
    return {
        "checked": len(specs),
        "hits": len(hits),
        "hit_literals": hit_literals,
        "misses": misses,
    }


@click.command()
@click.argument("report", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option(
    "--root",
    "roots",
    multiple=True,
    required=True,
    type=click.Path(exists=True, file_okay=False, path_type=Path),
    help="Repository root a citation may resolve against. Repeat for several.",
)
@click.option(
    "--stop-at",
    default=None,
    help="Truncate the report at the first line containing this text, so the "
    "verification section does not verify itself.",
)
@click.option(
    "--alias",
    "alias_specs",
    multiple=True,
    help="shorthand=real/path for a citation the report abbreviates.",
)
@click.option(
    "--placeholder",
    "placeholder_specs",
    multiple=True,
    help="A path that is illustrative, not real (e.g. foo.md in a naming example).",
)
@click.option(
    "--expect-missing",
    "expect_missing_specs",
    multiple=True,
    help="A path the report deliberately cites as NOT existing (e.g. a known dead "
    "link). Fails if it turns out to exist.",
)
@click.option(
    "--quote",
    "quote_specs",
    multiple=True,
    help="path:line:literal — assert the literal appears on that exact line.",
)
@click.option(
    "--require-quote-coverage",
    is_flag=True,
    help="Fail when a blockquote literal in the report was never bound to a "
    "source line with --quote.",
)
@click.option("--json", "as_json", is_flag=True, help="Machine-readable output.")
@click.option("-v", "--verbose", is_flag=True, help="Show DEBUG diagnostics on stderr.")
def main(
    report,
    roots,
    stop_at,
    alias_specs,
    placeholder_specs,
    expect_missing_specs,
    quote_specs,
    require_quote_coverage,
    as_json,
    verbose,
):
    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "WARNING")
    logger.debug("report={} roots={}", report, [str(root) for root in roots])
    text = report.read_text(encoding="utf-8")
    if stop_at:
        cut = text.find(stop_at)
        if cut == -1:
            raise click.ClickException(
                f"--stop-at {stop_at!r} not found in {report}; the verification "
                "section would verify itself. Fix the marker."
            )
        text = text[:cut]

    aliases = dict(spec.split("=", 1) for spec in alias_specs)
    placeholders = set(placeholder_specs)

    refs = check_refs(text, list(roots), aliases, placeholders, set(expect_missing_specs))
    logger.debug("refs: {}", {k: v for k, v in refs.items() if not isinstance(v, list)})
    quotes = check_quotes(quote_specs, list(roots), aliases)
    seen_literals: set[str] = set()
    malformed_quotes: list[str] = []
    for raw in BLOCKQUOTE_LINE_RE.findall(text):
        payload = quote_payload(raw)
        if payload is None:
            preview = raw.strip()
            malformed_quotes.append(preview if len(preview) <= 90 else preview[:87] + "...")
        else:
            seen_literals.add(payload)
    hit_literals = {value.strip() for value in quotes.pop("hit_literals")}
    # Exact set difference. A substring match would let a verified fragment stand
    # in for a whole blockquote, which is the failure this gate exists to catch.
    unbound_literals = sorted(seen_literals - hit_literals)
    candidates = len(seen_literals)
    unbound = len(unbound_literals)
    quotes["blockquote_literals"] = candidates
    quotes["unbound"] = unbound
    quotes["unbound_literals"] = unbound_literals
    quotes["malformed"] = malformed_quotes
    failed = bool(
        refs["unresolved"]
        or refs["out_of_range"]
        or refs["wrongly_present"]
        or quotes["misses"]
        or (require_quote_coverage and (unbound or malformed_quotes))
    )
    result = {"refs": refs, "quotes": quotes, "failed": failed}

    if failed:
        logger.warning("verification failed; see findings above")
    if as_json:
        click.echo(json.dumps(result, indent=2))
    else:
        click.echo(
            f"refs: {refs['unique']} unique, {refs['resolved']} resolved, "
            f"{refs['placeholders']} placeholders, "
            f"{refs['declared_missing']} declared-missing"
        )
        for item in refs["unresolved"]:
            click.echo(f"  UNRESOLVED  {item}")
        for item in refs["out_of_range"]:
            click.echo(f"  OUT-OF-RANGE {item}")
        for item in refs["wrongly_present"]:
            click.echo(f"  UNEXPECTEDLY-PRESENT {item}")
        click.echo(
            f"quotes: {quotes['checked']} checked, {quotes['hits']} exact-line hits, "
            f"{candidates} blockquote literals seen, {unbound} unbound"
        )
        for value in malformed_quotes:
            level = "BAD-QUOTE-SHAPE" if require_quote_coverage else "note"
            click.echo(f"  {level}  blockquote is not a single code span: {value}")
        for value in unbound_literals:
            level = "UNBOUND-QUOTE" if require_quote_coverage else "note"
            preview = value if len(value) <= 90 else value[:87] + "..."
            click.echo(f"  {level}  {preview}")
        for item in quotes["misses"]:
            click.echo(f"  QUOTE-MISS  {item}")
        click.echo("FAILED" if failed else "OK")

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
