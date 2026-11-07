"""Render the Prism app icon (1024px PNG) and the README logo; `npx tauri icon`
makes the platform sizes.  uv run --no-project --with pillow python -I scripts/make-icon.py

Flat design: graphite tile, solid indigo prism, one light line in, four soft
stem-coloured lanes out (vocals, drums, bass, other)."""
import math, pathlib
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
S = 4096
pad = int(S * 0.09)
BG = (36, 36, 39, 255)
ACCENT = (123, 130, 224, 255)
LINE = (236, 236, 238, 255)
LANES = [(228, 138, 160), (221, 176, 106), (157, 146, 228), (169, 199, 126)]


def rounded_triangle(cx, cy, r, rad, steps=32):
    pts = []
    for i in range(3):
        a = math.radians(-90 + 120 * i)
        ix, iy = cx + (r - rad * 2) * math.cos(a), cy + (r - rad * 2) * math.sin(a)
        for k in range(steps + 1):
            t = a - math.radians(60) + math.radians(120) * k / steps
            pts.append((ix + rad * math.cos(t), iy + rad * math.sin(t)))
    return pts


def render(tile=True):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if tile:
        d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=int(S * 0.2), fill=BG)
    cx, cy, r = S * 0.43, S * 0.53, S * 0.2
    y0 = cy + S * 0.025
    exit_x, lane_x = cx + r * 0.4, S * 0.69
    lanes = [y0 + (i - 1.5) * S * 0.075 for i in range(4)]
    w = int(S * 0.03)
    for col, ly in zip(LANES, lanes):
        path = []
        for k in range(41):
            t = k / 40
            e = t * t * (3 - 2 * t)
            path.append((exit_x + (lane_x - exit_x) * t, y0 + (ly - y0) * e))
        end = (S - pad * 1.7, ly)
        path.append(end)
        d.line(path, fill=col + (255,), width=w, joint="curve")
        d.ellipse([end[0] - w / 2, ly - w / 2, end[0] + w / 2, ly + w / 2], fill=col + (255,))
    start = (pad * 1.7, y0)
    d.line([start, (cx, y0)], fill=LINE, width=w)
    d.ellipse([start[0] - w / 2, y0 - w / 2, start[0] + w / 2, y0 + w / 2], fill=LINE)
    d.polygon(rounded_triangle(cx, cy, r, S * 0.028), fill=ACCENT)
    if tile:
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([pad, pad, S - pad, S - pad], radius=int(S * 0.2), fill=255)
        out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        img = out
    return img.resize((1024, 1024), Image.LANCZOS)


render().save(ROOT / "src-tauri/icons/source.png")
(ROOT / "docs").mkdir(exist_ok=True)
render().resize((512, 512), Image.LANCZOS).save(ROOT / "docs/logo.png")
print("icons written")
