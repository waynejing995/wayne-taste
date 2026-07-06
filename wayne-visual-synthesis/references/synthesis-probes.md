# Synthesis Probes — what is actually in this image

These probes belong to single-image reading (Sweep Pass 1), NOT to comparison. They answer
"what does this image contain that the naked composite does not show" — hidden channels,
steganography, invisible watermarks. That is a synthesis question: it changes the ledger for
one image. (Compare mode reuses the channel probe to diff two images, but the probes' home is
here.)

Run BOTH on every single-image read, never conditionally. You cannot know whether content is
hidden without probing; skipping is betting it isn't there. A non-empty result means the hidden
content earns its own region/element entries — not a footnote.

## 1. Per-Channel Probe — content hidden in a channel

`references/channel_probe.py` splits every channel, quantifies each independently, flags
channels carrying structure the naked composite hides, and exports each channel as a viewable
grayscale PNG. It reads the image in its NATIVE channel model — RGB / RGBA / CMYK / YCbCr /
LA / L — and does NOT flatten to RGBA, because flattening is exactly what hides the K plate,
the chroma planes, or a data alpha.

    uv run references/channel_probe.py IMG.png                 # probe one image
    uv run references/channel_probe.py IMG.png --dump-dir out  # + export per-channel PNGs
    uv run references/channel_probe.py IMG.png --json

Reports `hidden_content_channels`: any channel carrying structure the composite doesn't show
(shape in alpha, mark in one color plane, content in the CMYK K plate). Channels never seen as
shape in the composite (`A`, `K`, `Cb`, `Cr`) are always inspected directly. For non-display
models (CMYK/YCbCr/HSV) the flattened view is a conversion artifact, so the composite is not
treated as the visible baseline — every plane is read on its own terms.

## 2. Hidden-Signal Probe — content hidden within a channel

Content can hide in dimensions the eye ignores *within* a channel — how most invisible
watermarks and steganography work: put the payload where human vision is blind.
`references/hidden_probe.py` covers the two most common such dimensions:

- **Bit-plane / LSB**: the lowest bit(s) of a natural image are near-random; embedded data
  makes them structured. Reports per-plane structure + chi-square; can export each bit-plane.
- **FFT magnitude spectrum**: a faint periodic carrier is invisible in space but shows as
  isolated off-DC peaks. Reports peak-over-median and peak offsets; can export the spectrum.

    uv run references/hidden_probe.py IMG.png                 # summary
    uv run references/hidden_probe.py IMG.png --dump-dir out  # export bit-planes + spectrum
    uv run references/hidden_probe.py IMG.png --json

## Where invisible content hides, and what catches each

| Hiding dimension | Example | Caught by |
|---|---|---|
| Extra / chroma channel | alpha mask, YCbCr Cb/Cr, CMYK K | `channel_probe.py` |
| Least-significant bit | LSB steganography | `hidden_probe.py` bit-plane |
| Periodic spatial carrier | sinusoid / tiled pattern, printer dots | `hidden_probe.py` FFT |
| DCT/DWT coefficients | JPEG-domain robust watermark | NOT covered — needs the transform |
| Deep / generative | SynthID, StegaStamp | NOT covered — needs the decoder |

A clean probe does NOT mean "no watermark" — it means the covered dimensions are clean. State
the two uncovered classes (DCT/DWT-coefficient and deep/generative) explicitly whenever you
report a hidden-content result.
