# Ground truth: heldout-teams-markdown (judge only)

Real fix: tasks commit `1cb20c3` "keep literal text literal when converting to Markdown". The writer saw parent `6d31a8c`.

Root cause: `fetch_teams.html_to_markdown` called markdownify's converter without `escape_misc=True`, so a Windows share path lost a backslash to Markdown escaping and a message starting with "- " or "# " rendered as a list or heading. Fix: one keyword argument, `escape_misc=True`, plus a comment. No tests shipped; no tests directory existed covering fetch_teams.

What a strong goal asks for: unit tests on fabricated message HTML (`\\server\share` path; text starting with "- " and "# "; a normal message unchanged) that fail before and pass after; diff coverage of the one changed line is trivial. A property test is reasonable but optional (escaping round-trip). Smoke: render one real message or skip with a reason (needs Teams credentials). No retry/recovery machinery.
