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
