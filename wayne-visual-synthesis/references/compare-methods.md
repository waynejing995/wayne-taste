# Image Comparison Methods

Load this when running `compare` mode. Pick methods by what the diff must separate,
not by habit. Report which method produced each number; never emit a bare "different".

## Method Catalog

| Method | Measures | Best when | Threshold knobs | Python lib | Failure mode |
|---|---|---|---|---|---|
| exact pixel diff `L1/L2/hash` | byte-identical pixels, absolute/squared error, whole-image checksum | deterministic software rendering, golden-file locks | max changed pixels, max `L1/L2`, hash equality | `numpy`, `Pillow`, `imagehash` | fails on harmless antialiasing, gamma, font, GPU, alpha rounding noise |
| per-pixel tolerance diff | pixels exceeding channel epsilon | tiny numeric drift where spatial alignment is exact | per-channel epsilon, changed-pixel count/ratio, ignore mask | `numpy`, `Pillow` | hides small real changes if epsilon/count too loose; poor for shifted edges |
| pixelmatch | perceptual-ish pixel diff with antialias detection | web/UI screenshots with antialiasing and small color noise | threshold, include/exclude AA, diff color, max diff pixels | `pixelmatch`, `Pillow` | can miss subtle structural changes; still sensitive to alignment |
| ImageMagick compare `AE/RMSE` | absolute error count, root mean square error | CI-friendly CLI baselines, broad image formats | metric choice, fuzz %, max AE/RMSE | `wand`, `subprocess` to `magick compare` | metric choice easy to misuse; RMSE can dilute localized failures |
| dssim | structural dissimilarity derived from SSIM | perceptual regression where layout matters more than exact pixels | max DSSIM, window size | `pyssim`, `sewar`, CLI wrappers | less interpretable; can tolerate visible color/contrast changes |
| SSIM | luminance, contrast, structure similarity | natural images, rendered scenes, UI layout sanity | min SSIM, window size, channel axis, data range | `scikit-image` | weak on small localized defects; sensitive to crop/alignment |
| MS-SSIM | SSIM across multiple scales | scene renders where global and local structure both matter | min MS-SSIM, scale weights, window size | `pytorch-msssim`, `piq` | can miss tiny UI defects; heavier dependency/runtime |
| `pHash/aHash/dHash/wHash` | compact perceptual image fingerprint distance | coarse duplicate/regression triage, thumbnail-level similarity | Hamming distance, hash size, hash type | `imagehash`, `Pillow` | not a render-regression oracle; misses small/local changes |
| NVIDIA FLIP | perceptual image difference tuned for rendered images | graphics/rendering regressions, HDR/LDR perceptual diffs | mean/max FLIP, exposure, color space, heatmap threshold | `flip-evaluator`, NVIDIA FLIP tools | slower; thresholds need calibration per renderer/content |
| LPIPS | deep perceptual embedding distance | ML/photorealistic renders where human perception matters | max LPIPS, backbone `alex/vgg/squeeze`, resize/crop policy | `lpips`, `torchmetrics`, `piq` | poor for precise UI/geometry assertions; nondeterministic stack risk |
| ORB/SIFT align-then-diff | feature-match transform, then pixel/perceptual diff | camera jitter, minor translation/rotation/scale before comparison | matcher ratio, RANSAC reproj threshold, inlier count, post-diff threshold | `opencv-python` | alignment can mask real camera/geometry regressions; fails on low-texture images |
| color histogram/EMD | color distribution, optionally earth-mover distance | palette/lighting/exposure drift independent of geometry | bins, color space, EMD/chi-square/correlation threshold | `opencv-python`, `scipy` | blind to spatial/layout changes |
| edge/gradient `Sobel/Canny` diff | shape/edge/gradient structure | geometry, silhouette, layout, camera-framing changes | blur sigma, edge thresholds, gradient magnitude epsilon, changed-edge ratio | `opencv-python`, `scikit-image` | noisy on texture/AA; weak for flat color or lighting-only changes |

## Separating sub-LSB alpha-blend rounding noise from real geometry/camera change

- **Absorb sub-LSB alpha noise**: per-pixel tolerance, pixelmatch AA handling, SSIM/MS-SSIM, FLIP.
- **Expose geometry/camera movement**: edge/gradient diff and ORB/SIFT align-then-diff.
- Exact diff, hash, AE, RMSE do NOT separate the two — they mostly report "different".
- Histogram and perceptual hashes are triage only — weak separators for this case.

## Render Regression Triage Pipeline

The short-circuit scope is structural:

| Signal | Level-1 action | Required continuation | Verdict effect |
|---|---|---|---|
| Dimension mismatch | stop later pixel metrics | per-image VEL and Level 2 | apply only the pre-approved tolerance |
| Exact hash equality | stop later pixel metrics | per-image VEL and Level 2 | byte-identity PASS only under a pre-approved byte-identity tolerance; otherwise no verdict |

Run the Level-1 stages in order. A stop below ends later pixel metrics only; it
never ends per-image synthesis, Level 2, reconciliation, or reporting:

1. **Dimension gate** — sizes differ → record that as the Level-1 result and stop
   later pixel metrics; do not resize unless the user asks. Continue to Level 2.
2. **Exact hash** — identical → record byte identity and stop later pixel metrics.
   Continue to Level 2; verdict policy still applies.
3. **Per-pixel L1 map** — compute `diff = |A-B|.sum(axis=2)`. Report: changed-px %, max L1, `L1>threshold` count, strong-diff bbox + centroid.
4. **Diff-region characterization** — the discriminator between noise and real change:
   - **Magnitude**: all L1 ≤ ~5 → sub-LSB / rounding. Large L1 → real.
   - **Color family**: differences confined to one material/color (e.g. only the translucent overlay) → localized blending, not geometry.
   - **Spatial pattern**: connected-component the diff mask. Many tiny scattered blobs → AA/dither/rounding. Few large contiguous blobs following a silhouette → geometry/camera moved.
   - **Signed bias**: symmetric ± → dither; consistent one-direction → real shift or exposure change.
5. **Structural cross-check** (optional, when step 4 is ambiguous): SSIM/edge-diff to confirm structure is unchanged, or FLIP for a perceptual number.

## Local Floor Script

`references/compare_render.py` implements the triage pipeline's Level-1 floor
(hash gate -> L1 map + diff-region characterization -> edge/gradient diff, with SSIM
tie-breaker). PEP 723 inline deps — runs anywhere via `uv run`, no venv setup:

    uv run references/compare_render.py A.png B.png            # human-readable
    uv run references/compare_render.py A.png B.png --json     # machine-readable

It measures and classifies (`sub-lsb-blend-noise` / `likely-geometry-or-camera-change` /
`real-change-nongeometric`); it never emits pass/fail. FLIP/LPIPS/MS-SSIM are intentionally
omitted from the local floor — add them only when a perceptual score must be reported.

## Per-Channel Diff (compare's reuse of a synthesis probe)

The channel and hidden-signal probes are SYNTHESIS tools — they belong to single-image reading
and are documented in [synthesis-probes.md](synthesis-probes.md). Compare mode reuses only the
channel probe's pair form, to catch differences invisible to an RGB-level diff:

    uv run references/channel_probe.py A.png B.png    # per-channel diff

It reports `diff_only_in_channels`: any channel that differs while the visible composite does
not (identical-RGB/alpha-differ pairs an RGB diff scores as 0; chroma/K-plate changes). Because
each image was already channel-probed during its own synthesis pass, compare only adds this
cross-image channel diff — it does not re-own hidden-content detection.

## Verdict Policy

- A verdict is emitted ONLY in `compare` mode AND ONLY against an explicit tolerance the user
  gave or approved. State the tolerance and the method that produced the number.
- With no stated tolerance: report the measured diff + a noise-vs-real classification, and say
  no pass/fail was requested. Do NOT invent a tolerance.
- Fail loud: if a needed lib is unavailable, say so; do not silently downgrade to a weaker metric.
- Never claim "identical" from a perceptual metric alone — only exact/hash proves byte-identity.
