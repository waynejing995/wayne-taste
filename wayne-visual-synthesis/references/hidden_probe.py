# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow", "scipy", "click", "loguru"]
# ///
"""Hidden-signal probe for wayne-visual-synthesis.

The per-channel probe (channel_probe.py) finds content hidden in a *channel*. This one
finds content hidden in dimensions the eye ignores WITHIN a channel:

  1. Bit-plane analysis  -> LSB steganography. The lowest bit(s) of a natural image are
     near-random; embedded data makes them structured. Reports per-plane structure and a
     chi-square randomness score; can export each bit-plane as a viewable PNG.

  2. FFT magnitude spectrum -> frequency-domain watermarks and periodic patterns. A faint
     repeating carrier is invisible in space but shows as isolated peaks in the spectrum.
     Reports off-DC spectral peaks; can export a log-magnitude spectrum image.

What it does NOT detect: DCT/DWT-coefficient watermarks (need the specific transform),
deep/generative watermarks (SynthID etc., need the decoder). Say so — do not imply a clean
result means "no watermark".

PEP 723 inline deps: `uv run` anywhere.

    uv run hidden_probe.py IMG.png                     # bit-plane + FFT summary
    uv run hidden_probe.py IMG.png --dump-dir out      # + export bit-planes & spectrum
    uv run hidden_probe.py IMG.png --json

Measurement tool. Exit 0 always. No verdict; flags for a human/LLM to inspect.
"""

import sys
import json as _json
from pathlib import Path

import click
import numpy as np
from loguru import logger
from PIL import Image


def _load_planes(path: str):
    im = Image.open(path)
    if im.mode not in ("RGB", "RGBA", "L", "LA"):
        im = im.convert("RGB")
    arr = np.asarray(im)
    if arr.ndim == 2:
        arr = arr[:, :, None]
    names = {1: ["L"], 2: ["L", "A"], 3: ["R", "G", "B"], 4: ["R", "G", "B", "A"]}.get(
        arr.shape[2], [f"C{i}" for i in range(arr.shape[2])])
    return arr.astype(np.uint8), names


def _bitplane_stats(ch: np.ndarray, bit: int) -> dict:
    """Structure/randomness of one bit-plane. Natural-image low bits ~ random (ratio~0.5,
    low autocorrelation). Embedded data -> skewed ratio and/or spatial structure."""
    plane = (ch >> bit) & 1
    ones = float(plane.mean())
    # chi-square vs a fair coin: large -> non-random bit balance
    n = plane.size
    exp = n / 2.0
    obs1 = plane.sum()
    chi2 = ((obs1 - exp) ** 2 + ((n - obs1) - exp) ** 2) / exp
    # spatial structure: correlation between neighbors (random plane ~ 0)
    h_corr = float(np.mean(plane[:, :-1] == plane[:, 1:]))  # 0.5 if random
    v_corr = float(np.mean(plane[:-1, :] == plane[1:, :]))
    structure = max(abs(h_corr - 0.5), abs(v_corr - 0.5))
    return {
        "ones_ratio": round(ones, 4),
        "chi2_vs_fair": round(float(chi2), 2),
        "neighbor_agreement": round(max(h_corr, v_corr), 4),
        "structure_score": round(structure, 4),
        # low bits are supposed to look random; structure there is the tell
        "suspicious": bit <= 1 and structure > 0.08,
    }


def _fft_peaks(gray: np.ndarray) -> dict:
    """Off-DC peaks in the log-magnitude spectrum reveal periodic/frequency watermarks."""
    f = np.fft.fftshift(np.fft.fft2(gray - gray.mean()))
    mag = np.abs(f)
    h, w = mag.shape
    cy, cx = h // 2, w // 2
    # mask out the DC neighborhood
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
    off = mag.copy()
    off[r < 4] = 0
    peak = float(off.max())
    med = float(np.median(mag[r >= 4])) + 1e-9
    ratio = peak / med
    ys, xs = np.where(off >= 0.9 * peak)
    peaks = [[int(x - cx), int(y - cy)] for y, x in zip(ys[:8], xs[:8])]
    return {
        "peak_over_median": round(ratio, 2),
        "peak_offsets_from_dc": peaks,
        # a strong isolated off-DC peak = periodic carrier; natural spectra fall off smoothly
        "suspicious": ratio > 50.0,
    }


def probe(path: str, dump_dir: str | None) -> dict:
    arr, names = _load_planes(path)
    out = {"image": path, "size": [arr.shape[1], arr.shape[0]], "channels": names}

    # ---- bit-plane analysis (planes 0 and 1 are where LSB stego lives) ----
    bp = {}
    lsb_flags = []
    for i, nm in enumerate(names):
        if nm == "A":
            continue
        ch = arr[:, :, i]
        planes = {b: _bitplane_stats(ch, b) for b in (0, 1, 7)}
        bp[nm] = planes
        if any(planes[b]["suspicious"] for b in (0, 1)):
            lsb_flags.append(nm)
        if dump_dir:
            Path(dump_dir).mkdir(parents=True, exist_ok=True)
            for b in (0, 1):
                img = ((ch >> b) & 1).astype(np.uint8) * 255
                Image.fromarray(img, "L").save(
                    str(Path(dump_dir) / f"{Path(path).stem}_{nm}_bit{b}.png"))
    out["bit_planes"] = bp
    out["lsb_suspicious_channels"] = lsb_flags

    # ---- FFT spectrum (on luminance) ----
    rgb = arr[:, :, :3] if arr.shape[2] >= 3 else np.repeat(arr[:, :, :1], 3, 2)
    gray = rgb.astype(np.float64) @ np.array([0.299, 0.587, 0.114])
    fft = _fft_peaks(gray)
    out["fft"] = fft
    if dump_dir:
        spec = np.log1p(np.abs(np.fft.fftshift(np.fft.fft2(gray - gray.mean()))))
        spec = (255 * (spec - spec.min()) / (np.ptp(spec) + 1e-9)).astype(np.uint8)
        Image.fromarray(spec, "L").save(str(Path(dump_dir) / f"{Path(path).stem}_spectrum.png"))

    flags = []
    if lsb_flags:
        flags.append(f"LSB structure in channel(s) {lsb_flags} — possible bit-plane steganography")
    if fft["suspicious"]:
        flags.append(f"isolated off-DC spectral peak (x{fft['peak_over_median']} median) "
                     f"at {fft['peak_offsets_from_dc'][:3]} — possible frequency/periodic watermark")
    out["flags"] = flags
    out["not_covered"] = "DCT/DWT-coefficient and deep/generative (e.g. SynthID) watermarks are NOT detected here"
    return out


@click.command()
@click.argument("image", type=click.Path(exists=True))
@click.option("--dump-dir", default=None, help="Export bit-plane PNGs and the FFT spectrum here.")
@click.option("--json", "as_json", is_flag=True)
@click.option("-v", "--verbose", is_flag=True)
def main(image, dump_dir, as_json, verbose):
    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "INFO")
    logger.info(f"hidden-signal probe {image}")

    result = probe(image, dump_dir)

    if as_json:
        print(_json.dumps(result, indent=2))
        return

    print(f"size: {result['size']}  channels: {result['channels']}")
    for nm, planes in result["bit_planes"].items():
        b0, b1 = planes[0], planes[1]
        print(f"  {nm}: bit0 struct={b0['structure_score']} chi2={b0['chi2_vs_fair']}"
              f"{' <--' if b0['suspicious'] else ''}  "
              f"bit1 struct={b1['structure_score']}{' <--' if b1['suspicious'] else ''}")
    f = result["fft"]
    print(f"  FFT: peak/median={f['peak_over_median']} "
          f"peaks={f['peak_offsets_from_dc'][:3]}{' <-- periodic' if f['suspicious'] else ''}")
    if result["flags"]:
        for fl in result["flags"]:
            print(f"!! {fl}")
    else:
        print("no LSB / periodic-frequency signal flagged")
    print(f"note: {result['not_covered']}")


if __name__ == "__main__":
    main()
