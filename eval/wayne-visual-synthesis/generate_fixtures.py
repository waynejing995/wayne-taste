# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Generate deterministic image fixtures for the visual-synthesis eval."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size)


def dashboard(path: Path) -> None:
    image = Image.new("RGB", (1000, 720), "#f4f7fb")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1000, 82), fill="#17233d")
    draw.text((32, 20), "Fleet Console", font=font(30, bold=True), fill="white")
    draw.text((760, 29), "Region: us-east-2", font=font(18), fill="#d6e2ff")

    cards = [
        (32, "Healthy", "12", "#20845c"),
        (356, "Warning", "2", "#b46a00"),
        (680, "Offline", "1", "#bd3f3f"),
    ]
    for x, label, value, color in cards:
        draw.rounded_rectangle((x, 110, x + 288, 220), 12, fill="white", outline="#d8e0eb", width=2)
        draw.text((x + 20, 132), label, font=font(19), fill="#4b5870")
        draw.text((x + 20, 164), value, font=font(36, bold=True), fill=color)

    draw.rounded_rectangle((32, 248, 620, 500), 12, fill="white", outline="#d8e0eb", width=2)
    draw.text((54, 268), "Queue depth", font=font(22, bold=True), fill="#17233d")
    draw.line((92, 438, 570, 438), fill="#64748b", width=2)
    draw.line((92, 318, 92, 438), fill="#64748b", width=2)
    for x, label in ((150, "Mon"), (280, "Tue"), (410, "Wed"), (540, "Thu")):
        draw.text((x - 18, 448), label, font=font(15), fill="#4b5870")
    for y, label in ((408, "10"), (368, "20"), (328, "30")):
        draw.text((58, y - 10), label, font=font(14), fill="#4b5870")
    points = [(150, 400), (280, 380), (410, 340), (540, 360)]
    draw.line(points, fill="#3d70e8", width=5)
    for point in points:
        draw.ellipse((point[0] - 6, point[1] - 6, point[0] + 6, point[1] + 6), fill="#3d70e8")

    draw.rounded_rectangle((646, 248, 968, 500), 12, fill="white", outline="#d8e0eb", width=2)
    draw.text((668, 268), "Nodes", font=font(22, bold=True), fill="#17233d")
    columns = ((668, "Node"), (790, "Status"), (916, "Jobs"))
    for x, label in columns:
        draw.text((x, 310), label, font=font(15, bold=True), fill="#4b5870")
    draw.line((668, 338, 946, 338), fill="#d8e0eb", width=2)
    rows = (("edge-01", "Ready", "8"), ("edge-02", "Draining", "3"))
    for row_index, row in enumerate(rows):
        y = 356 + row_index * 54
        for (x, _), value in zip(columns, row):
            draw.text((x, y), value, font=font(15), fill="#263247")
    draw.rounded_rectangle((802, 530, 968, 590), 10, fill="#3d70e8")
    draw.text((843, 546), "Deploy", font=font(21, bold=True), fill="white")
    draw.text((32, 660), "Last updated: 14:32 UTC", font=font(16), fill="#64748b")
    image.save(path)


def document(path: Path) -> None:
    image = Image.new("RGB", (1000, 700), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((55, 45, 945, 655), outline="#c9ced6", width=3)
    lines = [
        (95, 90, "RELEASE NOTES v2.7.0", 34, True),
        (95, 160, "Owner: R&D / QA", 24, False),
        (95, 205, "Window: 09:30-10:15 UTC", 24, False),
        (95, 290, '1. Keep "Retry-After" unchanged.', 24, False),
        (95, 340, "2. Error code: E_CONN_042.", 24, False),
        (95, 430, "Rollback if p95 > 250 ms.", 24, False),
        (95, 535, "DO NOT TRANSLATE.", 28, True),
    ]
    for x, y, text, size, bold in lines:
        draw.text((x, y), text, font=font(size, bold=bold), fill="#17191d")
    image.save(path)


def compare_fixture(path: Path) -> None:
    image = Image.new("RGB", (720, 420), "#eef2f7")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((90, 85, 630, 335), 18, fill="white", outline="#bac5d4", width=3)
    draw.text((150, 125), "Build 742", font=font(30, bold=True), fill="#1d2a3a")
    draw.text((150, 190), "Status: STABLE", font=font(26), fill="#287a55")
    draw.rounded_rectangle((150, 250, 345, 305), 9, fill="#3d70e8")
    draw.text((201, 265), "Promote", font=font(20, bold=True), fill="white")
    image.save(path)


def noise_pair(a_path: Path, b_path: Path) -> None:
    image = Image.new("RGB", (800, 480), "#243b67")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((140, 105, 660, 375), 18, fill="#f7f9fc")
    draw.text((210, 155), "Render Stable", font=font(38, bold=True), fill="#17233d")
    draw.text((210, 225), "Frames: 120", font=font(25), fill="#4b5870")
    draw.text((210, 275), "Camera: locked", font=font(25), fill="#4b5870")
    image.save(a_path)

    noisy = image.copy()
    pixels = noisy.load()
    points: list[tuple[int, int]] = []
    for row in range(6):
        for column in range(20):
            points.append((12 + column * 39, 12 + row * 13))
    if len(points) != 120:
        raise AssertionError("noise fixture must contain exactly 120 points")
    for x, y in points:
        r, g, b = pixels[x, y]
        pixels[x, y] = (r, g, b + 1)
    noisy.save(b_path)


def semantic_pair(a_path: Path, b_path: Path) -> None:
    def render(path: Path, status: str, button: str, accent: str) -> None:
        image = Image.new("RGB", (800, 480), "#eef2f7")
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((120, 90, 680, 390), 18, fill="white", outline="#c5cfdd", width=3)
        draw.text((180, 135), "Release Gate", font=font(34, bold=True), fill="#17233d")
        draw.text((180, 215), f"Status: {status}", font=font(28, bold=True), fill=accent)
        draw.rounded_rectangle((180, 295, 385, 350), 9, fill=accent)
        draw.text((235, 309), button, font=font(21, bold=True), fill="white")
        image.save(path)

    render(a_path, "READY", "Deploy", "#20845c")
    render(b_path, "FAILED", "Retry", "#bd3f3f")


def hidden_alpha(path: Path) -> None:
    image = Image.new("RGBA", (760, 360), (255, 255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 760, 92), fill=(33, 55, 92, 255))
    draw.text((32, 25), "Channel Inspection", font=font(30, bold=True), fill=(255, 255, 255, 255))
    draw.text((32, 300), "Visible composite: ordinary panel", font=font(18), fill=(70, 80, 95, 255))

    bit_mask = Image.new("1", image.size, 0)
    bit_draw = ImageDraw.Draw(bit_mask)
    bit_draw.text((205, 120), "LSB MARK", font=font(52, bold=True), fill=1)
    pixels = image.load()
    mask_pixels = bit_mask.load()
    for y in range(105, 205):
        for x in range(120, 690):
            red, green, blue, alpha_value = pixels[x, y]
            pixels[x, y] = (255 if mask_pixels[x, y] else 254, green, blue, alpha_value)

    alpha = Image.new("L", image.size, 255)
    alpha_draw = ImageDraw.Draw(alpha)
    alpha_draw.text((175, 215), "SECRET 42", font=font(52, bold=True), fill=0)
    image.putalpha(alpha)
    image.save(path)


def generate(output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    dashboard(output / "dashboard.png")
    document(output / "release-notes.png")
    compare_fixture(output / "golden.png")
    shutil.copyfile(output / "golden.png", output / "actual.png")
    noise_pair(output / "noise-a.png", output / "noise-b.png")
    semantic_pair(output / "semantic-a.png", output / "semantic-b.png")
    hidden_alpha(output / "hidden-alpha.png")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    generate(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
