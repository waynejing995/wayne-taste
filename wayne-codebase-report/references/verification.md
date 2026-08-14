# Verification recipe

Load this when running step F, or when deciding what a verification result is allowed to claim.

## What the verifier proves, and what it does not

It proves two things only: a cited location exists and is in range, and a supplied literal sits on the line you said it does. It proves nothing about whether the argument built on that quote is sound. Step G exists because of that gap; never let a green verifier stand in for it.

## Invocation

```bash
uv run <skill-dir>/scripts/verify_citations.py <report.md> \
  --root <repo-root> [--root <second-root>] \
  --stop-at "<verification section heading>" \
  --alias <shorthand>=<real/path> \
  --placeholder <illustrative.md> \
  --expect-missing <deliberately/dead/link.md> \
  --require-quote-coverage \
  --quote '<path>:<line>:<exact literal>'
```

Exit `0` means clean. Exit `1` lists each defect.

## Flags, and the failure each one prevents

**`--root`** — repeat for every tree a citation may resolve against: the subject repository, the vault, the report's own directory. A citation that resolves nowhere is a defect in the report.

**`--stop-at`** — truncates at the verification section so it does not verify itself. A self-inclusive count changes on every edit, and the report ends up contradicting its own numbers. The tool now errors when the marker is absent, because a silently ignored `--stop-at` reintroduces exactly that bug.

**`--alias`** — the report legitimately writes `fiber.ts:418` after establishing the full path in the same paragraph. Map each shorthand to its real path rather than expanding every occurrence.

**`--placeholder`** — a path used illustratively, such as `foo.md` in a naming convention. Declaring it keeps it out of the failure list without silently ignoring unknown paths.

**`--expect-missing`** — a path the report deliberately cites as _not_ existing, such as a dead link you are reporting. The tool fails if it turns out to exist, which catches the case where the thing was created and your finding went stale.

**`--quote 'path:line:literal'`** — the only way a quotation is checked. Pass one per verbatim quote that carries an argument. Bind them yourself: the tool never guesses which file a blockquote came from.

**`--require-quote-coverage`** — turns an unbound blockquote into a failure. Coverage is an exact set difference over literal text, so verifying an unrelated quote cannot satisfy an unverified one, and a short verified fragment cannot stand in for a long unverified blockquote.

## Reporting the result

State the numbers the tool produced and the scope sentence together:

> N unique path references, M resolved in range, K placeholders, J declared-missing, 0 unexpected failures; Q quotes re-grepped, Q hitting the exact cited line. This establishes that cited locations exist and quoted bytes are present. It establishes nothing about the correctness of the interpretation built on them.

Say which sections were scanned. If the verifier ran over sections 0 through 7, do not write "every claim in this report".

## When the report is split across files

Run the verifier against the single source report and say so in each split page. Splitting changes pagination, not content, and re-deriving counts per page invites drift. Cross-references between split pages must be relative Markdown links that resolve, which is a separate check from citation verification.
