# Forge loader-validator hotfix

The validator now stays at the loader-level boundary used by the official
skill-creator, plus Wayne's directory agreement and non-empty body. It checks only:

- `SKILL.md` exists and has parseable YAML frontmatter;
- frontmatter contains `name` and `description`, with only loader-supported keys;
- `name` is lowercase kebab-case and matches the directory;
- name and description bounds match the loader; the Markdown body is non-empty.

It no longer parses body headings, Flowcharts, Process IDs, links, prose, line
counts, word counts, or house style. Those are AI authoring and behavioral-eval
questions, not loader validity.

Calibration accepts supported metadata and arbitrary valid Markdown, then rejects
missing/malformed metadata, unknown keys, invalid/mismatched names, and empty body.
