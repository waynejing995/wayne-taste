# Blind semantic rubric: Wayne Visual Synthesis

Judge one untouched trial from the task, original raster fixtures at full detail,
candidate skill/references, real probe/render outputs, agent report, and checker
observations. Do not see control/candidate identity or the expected winner.

Decide the applicable behavior in `approved-intent.md`: one complete VEL per image
before synthesis; exhaustive visible regions/elements/text/relationships/quality;
verbatim OCR and reading order; carrier-specific semantic equivalents; targetable
identity/geometry/layers/handles; explicit comparison set/golden/tolerance; both
pixel/channel and ledger levels; noise-versus-real-change reconciliation; hidden
channel evidence; and fail-loud missing-image behavior without filename inference.

Headings, field names, table shape, keywords, and phrase matches are navigation
clues only. Accept equivalent representation and reject same-shaped reports that
omit visible evidence, invent observations, normalize OCR, skip Level 2, confuse
pixel noise with semantic change, or emit an unapproved verdict. Use the actual
images and probe results, not checker vocabulary, as evidence.

Return JSON only with `verdict: pass | fail | invalid`, behavior-level verdicts and
image-grounded evidence, plus blocking/non-blocking findings. Use `invalid` only
when images, tools, provider output, or required trial evidence are unavailable.
