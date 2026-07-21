# Wayne Visual Synthesis eval

This harness generates deterministic raster fixtures and gives Claude and Codex
the same eight tasks:

| Case | Behavior under test |
|---|---|
| `describe` | VEL-first UI inventory plus chart/table carrier equivalents |
| `ocr` | verbatim document transcript in reading order |
| `compare` | explicit golden, byte-identity tolerance, two-level comparison |
| `pixel-noise` | 120 isolated one-LSB changes classified as noise, no verdict |
| `semantic-change` | READY/Deploy to FAILED/Retry classified as real change |
| `hidden-channel` | alpha-only `SECRET 42` and bit-0 `LSB MARK` entered in the VEL |
| `missing-image` | fail loud without inventing a visual report |
| `multi-no-compare` | one VEL per image and no implicit comparison |

Generated images and trial output belong under `eval/.runs/wayne-visual-synthesis/`.
The static contract also parses the method catalog's short-circuit table: dimension
or hash may stop later Level-1 metrics, never per-image VEL or Level 2, and hash
equality cannot emit PASS without a pre-approved byte-identity tolerance.

`check_trial.py` and `check_static.py` emit `AI_REVIEW_REQUIRED`. Their headings,
keywords, field names, and table-row matches are observations for
[the blind image rubric](semantic-rubric.md), not visual-semantic verdicts. Generated
raster bytes and the bundled channel/hidden/pixel probe outputs remain direct
machine evidence and must be supplied to the reviewer.

```bash
uv run --no-project python eval/wayne-visual-synthesis/calibrate.py
bash eval/wayne-visual-synthesis/prepare_trial.sh describe \
  wayne-visual-synthesis eval/.runs/wayne-visual-synthesis/control-describe

MODEL=opus EFFORT=high bash eval/run_isolated_agent.sh claude \
  eval/.runs/wayne-visual-synthesis/control-describe \
  eval/.runs/wayne-visual-synthesis/state-claude

uv run --no-project python eval/wayne-visual-synthesis/check_trial.py \
  eval/.runs/wayne-visual-synthesis/control-describe \
  --case describe \
  --output eval/.runs/wayne-visual-synthesis/control-describe/claude-result.json
```

If fixture images or the agent result are missing, mark the trial `invalid`; do not
score a partial report as a behavioral loss.
