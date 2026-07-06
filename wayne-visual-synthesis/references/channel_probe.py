# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow", "scipy", "click", "loguru"]
# ///
"""Per-channel probe for wayne-visual-synthesis.

Some content lives ONLY in a specific channel and is invisible in the composited
RGB view: a shape carried only by alpha, a mark only in blue, a premultiplied-alpha
darkening, or two images that differ solely in alpha. Looking at the flattened image
misses all of these. This probe splits every channel, quantifies each independently,
flags channels that carry structure the naked composite hides, and exports each
channel as a standalone grayscale PNG so it can actually be viewed.

PEP 723 inline deps: `uv run` anywhere, no venv.

    uv run channel_probe.py IMG.png                 # probe one image
    uv run channel_probe.py IMG.png --dump-dir out  # + export per-channel PNGs
    uv run channel_probe.py A.png B.png              # per-channel diff of two images
    uv run channel_probe.py IMG.png --json

Measurement tool. Exit 0 always. No pass/fail.
"""

import sys
import json as _json
from pathlib import Path

import click
import numpy as np
from loguru import logger
from PIL import Image


CHANNEL_NAMES = {
    "RGB": ["R", "G", "B"], "RGBA": ["R", "G", "B", "A"],
    "LA": ["L", "A"], "L": ["L"],
    "CMYK": ["C", "M", "Y", "K"],
    "YCbCr": ["Y", "Cb", "Cr"],
    "HSV": ["H", "S", "V"],
    "I": ["I"], "F": ["F"], "P": ["P"],
}


def _load(path: str):
    """Load preserving the original channel model. CMYK/YCbCr/etc are NOT flattened
    to RGBA — flattening is exactly what hides per-channel content (K plate, chroma)."""
    im = Image.open(path)
    mode = im.mode
    if mode not in CHANNEL_NAMES:
        logger.warning(f"mode {mode!r} not natively mapped; converting to RGBA (may hide channel content)")
        im = im.convert("RGBA")
        mode = "RGBA"
    arr = np.asarray(im)
    if arr.ndim == 2:
        arr = arr[:, :, None]
    names = CHANNEL_NAMES[mode]
    # guard: array channel count must match the name list
    n = arr.shape[2]
    if n != len(names):
        names = [f"{mode}{i}" for i in range(n)]
    return arr.astype(np.int32), names, mode


def _channel_stats(ch: np.ndarray) -> dict:
    from scipy.ndimage import label
    vmin, vmax = int(ch.min()), int(ch.max())
    std = float(ch.std())
    # "structure" = the channel is not flat AND has spatially contiguous regions
    # that stand out from its own dominant value (not just noise).
    dominant = int(np.bincount(ch.ravel()).argmax())
    off = np.abs(ch - dominant) > 8
    lab, ncomp = label(off)
    sizes = np.bincount(lab.ravel())[1:] if ncomp else np.array([])
    big = int((sizes >= 25).sum()) if sizes.size else 0
    return {
        "min": vmin, "max": vmax, "range": vmax - vmin,
        "std": round(std, 3),
        "constant": vmin == vmax,
        "dominant_value": dominant,
        "off_dominant_px": int(off.sum()),
        "structured_blobs": big,
        "carries_structure": big > 0,
    }


def probe_one(path: str, dump_dir: str | None) -> dict:
    arr, names, mode = _load(path)
    out = {"image": path, "mode": mode, "size": [arr.shape[1], arr.shape[0]],
           "channels": {}}

    # Composite baseline = what the naked human-visible view shows. Only meaningful
    # for display models (RGB/RGBA/L). For CMYK/YCbCr/HSV the "flattened view" is a
    # conversion artifact, so we don't treat it as the visible baseline.
    is_display = mode in ("RGB", "RGBA", "L", "LA")
    if is_display and arr.shape[2] >= 3:
        composite = arr[:, :, :3]
    else:
        composite = arr[:, :, :1]
    composite_std = float(composite.std())

    # channels never seen as shape in the composite: alpha, and any non-display
    # model's chroma/data plates (K, Cb, Cr, ...) — always inspect these directly.
    never_visible = {"A", "K", "Cb", "Cr"}

    hidden = []
    for i, nm in enumerate(names):
        st = _channel_stats(arr[:, :, i])
        out["channels"][nm] = st
        composite_flat = composite_std < 3.0
        hides = nm in never_visible or composite_flat or not is_display
        if st["carries_structure"] and hides:
            hidden.append(nm)
        if dump_dir:
            Path(dump_dir).mkdir(parents=True, exist_ok=True)
            Image.fromarray(arr[:, :, i].astype(np.uint8), "L").save(
                str(Path(dump_dir) / f"{Path(path).stem}_{nm}.png"))

    out["composite_std"] = round(composite_std, 3)
    out["composite_is_display_model"] = is_display
    out["hidden_content_channels"] = hidden
    if hidden:
        out["warning"] = (f"channels {hidden} carry structure not visible in the "
                          f"naked composite — inspect them directly")
    return out


def probe_diff(a: str, b: str, dump_dir: str | None) -> dict:
    A, na, ma = _load(a)
    B, nb, mb = _load(b)
    out = {"a": a, "b": b, "mode_a": ma, "mode_b": mb}
    if A.shape != B.shape:
        out["note"] = "shape mismatch (size or channel count differ) — that IS the diff"
        out["shape_a"], out["shape_b"] = list(A.shape), list(B.shape)
        return out
    names = na
    ch_out = {}
    invisible = []
    is_display = ma in ("RGB", "RGBA", "L", "LA")
    # visible-composite delta: for display models, the RGB planes; else N/A.
    if is_display and A.shape[2] >= 3:
        comp_diff = np.abs(A[:, :, :3] - B[:, :, :3]).sum(axis=2)
    elif is_display:
        comp_diff = np.abs(A[:, :, 0] - B[:, :, 0])
    else:
        comp_diff = None
    comp_changed = int((comp_diff > 0).sum()) if comp_diff is not None else 0
    never_visible = {"A", "K", "Cb", "Cr"}
    for i, nm in enumerate(names):
        d = np.abs(A[:, :, i] - B[:, :, i])
        changed = int((d > 0).sum())
        ch_out[nm] = {"changed_px": changed, "max_delta": int(d.max()),
                      "mean_delta": round(float(d.mean()), 5)}
        # differs in this channel but the visible composite doesn't show it
        if changed > 0 and (nm in never_visible or comp_changed == 0 or not is_display):
            invisible.append(nm)
        if dump_dir and changed:
            Path(dump_dir).mkdir(parents=True, exist_ok=True)
            m = (d > 0).astype(np.uint8) * 255
            Image.fromarray(m, "L").save(str(Path(dump_dir) / f"diff_{nm}.png"))
    out["per_channel"] = ch_out
    out["composite_changed_px"] = comp_changed if comp_diff is not None else None
    out["diff_only_in_channels"] = invisible
    if invisible:
        out["warning"] = (f"channels {invisible} differ but the RGB composite does "
                          f"not fully show it — a plain visual/RGB diff would miss this")
    return out


@click.command()
@click.argument("image_a", type=click.Path(exists=True))
@click.argument("image_b", type=click.Path(exists=True), required=False)
@click.option("--dump-dir", default=None, help="Export per-channel (or per-channel diff) PNGs here.")
@click.option("--json", "as_json", is_flag=True)
@click.option("-v", "--verbose", is_flag=True)
def main(image_a, image_b, dump_dir, as_json, verbose):
    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "INFO")

    if image_b:
        logger.info(f"per-channel diff {image_a} vs {image_b}")
        result = probe_diff(image_a, image_b, dump_dir)
    else:
        logger.info(f"per-channel probe {image_a}")
        result = probe_one(image_a, dump_dir)

    if as_json:
        print(_json.dumps(result, indent=2))
        return

    if image_b:
        print(f"mode: {result['mode_a']} vs {result['mode_b']}")
        if "note" in result:
            print(f"-> {result['note']}")
            return
        for nm, s in result["per_channel"].items():
            print(f"  {nm}: changed={s['changed_px']} max_delta={s['max_delta']} mean={s['mean_delta']}")
        print(f"composite changed px: {result['composite_changed_px']}")
        if result["diff_only_in_channels"]:
            print(f"!! {result['warning']}")
        else:
            print("no channel-hidden diff detected")
    else:
        print(f"mode: {result['mode']}  size: {result['size']}  composite_std={result['composite_std']} "
              f"(display_model={result['composite_is_display_model']})")
        for nm, s in result["channels"].items():
            tag = " <-- carries structure" if s["carries_structure"] else ""
            print(f"  {nm}: range={s['range']} std={s['std']} blobs={s['structured_blobs']}{tag}")
        if result["hidden_content_channels"]:
            print(f"!! {result['warning']}")
        else:
            print("no hidden-in-channel content detected")


if __name__ == "__main__":
    main()
