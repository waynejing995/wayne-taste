# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow", "scipy", "scikit-image", "click", "loguru"]
# ///
"""Local render-regression comparator for wayne-visual-synthesis `compare` mode.

Level-1 pixel comparison: the three-tool floor that separates sub-LSB alpha-blend
rounding noise from real geometry/camera change.

  hash gate -> per-pixel L1 map + diff-region characterization -> edge/gradient diff
  (SSIM as the ambiguity tie-breaker)

PEP 723 inline deps: run anywhere with `uv run`, no venv setup.

    uv run compare_render.py A.png B.png
    uv run compare_render.py A.png B.png --l1-threshold 5 --json

Exit code is 0 always (measurement tool, not a gate). A pass/fail verdict belongs
to compare mode against a user-stated tolerance, not to this script.
"""

import sys
import hashlib
import json as _json

import click
import numpy as np
from loguru import logger
from PIL import Image


def _load(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB")).astype(np.int32)


def _sha(path: str) -> str:
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def _color_family(a_rgb: np.ndarray) -> str:
    r, g, b = int(a_rgb[0]), int(a_rgb[1]), int(a_rgb[2])
    if g > r and g > b:
        return "green"
    if r > g and r > b:
        return "red"
    if b > r and b > g:
        return "blue"
    if r > 150 and g > 150 and b > 150:
        return "light"
    if r < 70 and g < 70 and b < 70:
        return "dark"
    return "neutral"


def compare(path_a: str, path_b: str, l1_threshold: int) -> dict:
    from collections import Counter
    from scipy.ndimage import label
    from skimage.metrics import structural_similarity as ssim
    from skimage.filters import sobel
    from skimage.color import rgb2gray

    out: dict = {"a": path_a, "b": path_b}

    # 1. dimension gate
    A = _load(path_a)
    B = _load(path_b)
    out["dims"] = {"a": list(A.shape[:2][::-1]), "b": list(B.shape[:2][::-1])}
    if A.shape != B.shape:
        out["verdict_hint"] = "dimension-mismatch"
        out["note"] = "sizes differ; that IS the diff. No resize-then-diff without explicit ask."
        return out

    # 2. exact hash gate
    ha, hb = _sha(path_a), _sha(path_b)
    out["hash"] = {"a": ha[:16], "b": hb[:16], "match": ha == hb}
    if ha == hb:
        out["verdict_hint"] = "byte-identical"
        return out

    # 3. per-pixel L1 map
    diff = np.abs(A - B).sum(axis=2)
    total = diff.size
    changed = int((diff > 0).sum())
    strong = int((diff > l1_threshold).sum())
    out["pixel"] = {
        "changed_px": changed,
        "changed_pct": round(100 * changed / total, 4),
        "max_l1": int(diff.max()),
        "mean_l1": round(float(diff.mean()), 6),
        "l1_threshold": l1_threshold,
        "strong_diff_px": strong,
    }

    ys, xs = np.where(diff > 0)
    if changed:
        out["pixel"]["any_bbox"] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
        out["pixel"]["centroid"] = [int(xs.mean()), int(ys.mean())]

    # 4. diff-region characterization (the noise-vs-real discriminator)
    #   4a. magnitude
    mags = dict(Counter(diff[diff > 0].tolist()))
    out["pixel"]["l1_histogram"] = {str(k): int(v) for k, v in sorted(mags.items())}
    sub_lsb = bool(changed) and int(diff.max()) <= 5

    #   4b. color family of differing pixels
    fam = Counter(_color_family(A[y, x]) for y, x in zip(ys, xs))
    out["pixel"]["diff_color_families"] = dict(fam)
    single_family = len(fam) == 1

    #   4c. spatial pattern (connected components)
    mask = diff > 0
    lab, ncomp = label(mask)
    sizes = np.bincount(lab.ravel())[1:] if ncomp else np.array([])
    out["pixel"]["components"] = {
        "count": int(ncomp),
        "largest_px": int(sizes.max()) if sizes.size else 0,
        "singletons": int((sizes == 1).sum()) if sizes.size else 0,
    }
    scattered = ncomp > 0 and (sizes == 1).sum() >= 0.5 * ncomp

    #   4d. signed bias
    signed = (A - B).sum(axis=2)
    sv = signed[mask]
    out["pixel"]["signed_bias"] = {
        "mean": round(float(sv.mean()), 4) if sv.size else 0.0,
        "a_brighter": int((sv > 0).sum()),
        "b_brighter": int((sv < 0).sum()),
    }

    # 5. structural cross-check
    gray_a, gray_b = rgb2gray(A / 255.0), rgb2gray(B / 255.0)
    s = float(ssim(gray_a, gray_b, data_range=1.0))
    out["ssim"] = round(s, 6)

    edge_a, edge_b = sobel(gray_a), sobel(gray_b)
    edge_diff = np.abs(edge_a - edge_b)
    out["edge"] = {
        "mean_gradient_delta": round(float(edge_diff.mean()), 6),
        "max_gradient_delta": round(float(edge_diff.max()), 6),
        "changed_edge_px": int((edge_diff > 0.05).sum()),
    }
    geometry_moved = out["edge"]["changed_edge_px"] > 0.001 * total

    # classification (heuristic; compare mode reconciles against the ledger)
    if sub_lsb and (single_family or scattered) and not geometry_moved:
        cls = "sub-lsb-blend-noise"
    elif geometry_moved:
        cls = "likely-geometry-or-camera-change"
    else:
        cls = "real-change-nongeometric"
    out["classification"] = cls
    out["verdict_hint"] = "differs; no pass/fail (no tolerance supplied)"
    return out


@click.command()
@click.argument("image_a", type=click.Path(exists=True))
@click.argument("image_b", type=click.Path(exists=True))
@click.option("--l1-threshold", default=5, show_default=True,
              help="Per-pixel L1 (channel-sum) above which a diff counts as 'strong'.")
@click.option("--json", "as_json", is_flag=True, help="Emit machine-readable JSON on stdout.")
@click.option("-v", "--verbose", is_flag=True)
def main(image_a, image_b, l1_threshold, as_json, verbose):
    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "INFO")
    logger.info(f"comparing {image_a} vs {image_b}")

    result = compare(image_a, image_b, l1_threshold)

    if as_json:
        print(_json.dumps(result, indent=2))
        return

    p = result.get("pixel", {})
    print(f"dims:  {result['dims']['a']} vs {result['dims']['b']}")
    print(f"hash:  {'MATCH' if result.get('hash', {}).get('match') else 'differ'}")
    if result.get("verdict_hint") in ("byte-identical", "dimension-mismatch"):
        print(f"-> {result['verdict_hint']}: {result.get('note','')}")
        return
    print(f"changed: {p['changed_px']} px ({p['changed_pct']}%)  max_l1={p['max_l1']}  "
          f"strong(>{p['l1_threshold']})={p['strong_diff_px']}")
    print(f"bbox:  {p.get('any_bbox')}  centroid={p.get('centroid')}")
    print(f"color families: {p['diff_color_families']}")
    print(f"components: {p['components']}  signed_bias={p['signed_bias']}")
    print(f"ssim:  {result['ssim']}  edge_changed_px={result['edge']['changed_edge_px']}")
    print(f"=> classification: {result['classification']}")
    print(f"=> {result['verdict_hint']}")


if __name__ == "__main__":
    main()
