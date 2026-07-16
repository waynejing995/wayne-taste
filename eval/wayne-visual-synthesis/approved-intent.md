# Approved intent: Wayne Visual Synthesis

The skill turns one or more inspectable images into visual evidence. A concise
summary is useful only when it is derived from a complete Visual Element Ledger
(VEL), not used as a replacement for one.

## Required behavior

- Build one VEL per image before synthesis. Account for regions, elements, visible
  text, repeated groups, meaningful relationships, quality issues, and coverage.
- Preserve OCR text verbatim and in reading order. Do not translate, normalize,
  paraphrase, or silently guess unreadable text.
- For charts, tables, diagrams, documents, maps, equations, dense text, and dense
  UI, produce a carrier-specific semantic equivalent with source refs, required
  and missing fields, coverage, and confidence.
- Preserve object identity, geometry, layer/occlusion, and real source handles
  when later targeting or comparison needs them.
- In explicit comparison, resolve the image set, same-target relation,
  golden-vs-symmetric semantics, and tolerance before measuring. `No verdict` is
  an explicit resolved tolerance.
- Comparison has both a mechanical pixel/channel level and a VEL semantic level.
  Reconcile them as read noise or real change.
- Only exact byte/hash equality proves byte identity. Never invent a tolerance or
  emit pass/fail without an approved one.
- Inspect image channels and covered bit/frequency dimensions when content or
  deltas can be invisible in the displayed RGB composite. Hidden content becomes
  ledger evidence, not a footnote.
- Fail loud when the images or an observation backend are unavailable. Do not
  infer content from filenames or the request.

## Optimization goal

Reduce the 707-line control below the Forge hard boundary without losing any
behavior above. Detailed carrier schemas, output formats, and comparison methods
may live in direct references. A removed probe requirement is acceptable only if
the frozen alpha-channel plus LSB payload case still passes on both Claude and
Codex.
