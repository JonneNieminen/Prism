"""Render the Prism app icon (1024px PNG); `npx tauri icon` makes the rest.
uv run --no-project --with pillow python -I scripts/make-icon.py src-tauri/icons/source.png

Design: a rounded prism in the brand gradient; one white line goes in, four
stem-coloured lanes come out, fan apart, then run parallel like tracks."""
import math, sys
from PIL import Image, ImageDraw, ImageFilter

S = 4096
pad = int(S * 0.09)
BG = (20, 20, 31, 255)
LANES = ["#FF5D8F", "#FFB020", "#7C5CFF", "#A3E635"]  # vocals, drums, bass, other
G0, G1 = (124, 92, 255), (255, 93, 143)

def rounded_triangle(cx, cy, r, rad, steps=24):
    pts = []
    verts = [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in (-90, 30, 150)]
    for i, (vx, vy) in enumerate(verts):
        a0 = math.radians(-90 + 120 * i) - math.radians(60)
        # inset vertex toward centre, then sweep an arc around it
        ix, iy = cx + (r - rad * 2) * math.cos(math.radians(-90 + 120 * i)), cy + (r - rad * 2) * math.sin(math.radians(-90 + 120 * i))
        for k in range(steps + 1):
            a = a0 + math.radians(120) * k / steps
            pts.append((ix + rad * math.cos(a), iy + rad * math.sin(a)))
    return pts

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=int(S * 0.2), fill=BG)

# soft brand glow behind the prism
glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse([S * 0.18, S * 0.22, S * 0.68, S * 0.78], fill=(124, 92, 255, 90))
img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(S * 0.08)))

cx, cy, r = S * 0.42, S * 0.53, S * 0.22
y0 = cy + S * 0.03
exit_x = cx + r * 0.42
lane_x = S * 0.70
lanes = [y0 + (i - 1.5) * S * 0.085 for i in range(4)]

layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
L = ImageDraw.Draw(layer)
w = int(S * 0.034)
for col, ly in zip(LANES, lanes):
    path = []
    for k in range(41):  # smoothstep fan-out, then straight lane
        t = k / 40
        x = exit_x + (lane_x - exit_x) * t
        e = t * t * (3 - 2 * t)
        path.append((x, y0 + (ly - y0) * e))
    path.append((S - pad * 1.6, ly))
    L.line(path, fill=col, width=w, joint="curve")
    for (x, y) in (path[-1],):
        L.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=col)
lane_glow = layer.filter(ImageFilter.GaussianBlur(S * 0.018))
img = Image.alpha_composite(img, lane_glow)
img = Image.alpha_composite(img, layer)

d = ImageDraw.Draw(img)
d.line([(pad * 1.6, y0), (cx, y0)], fill=(242, 242, 247, 255), width=w)
d.ellipse([pad * 1.6 - w / 2, y0 - w / 2, pad * 1.6 + w / 2, y0 + w / 2], fill=(242, 242, 247, 255))

tri = rounded_triangle(cx, cy, r, S * 0.03)
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(int(cy - r), int(cy + r) + 1, 4):
    t = (y - (cy - r)) / (2 * r)
    c = tuple(int(G0[i] + (G1[i] - G0[i]) * t) for i in range(3)) + (255,)
    gd.rectangle([0, y, S, y + 4], fill=c)
m = Image.new("L", (S, S), 0)
ImageDraw.Draw(m).polygon(tri, fill=255)
img.paste(grad, (0, 0), m)
# glass highlight
hl = Image.new("L", (S, S), 0)
ImageDraw.Draw(hl).polygon(rounded_triangle(cx - S * 0.02, cy - S * 0.03, r * 0.62, S * 0.02), fill=60)
img.paste(Image.new("RGBA", (S, S), (255, 255, 255, 255)), (0, 0), Image.composite(hl, Image.new("L", (S, S), 0), m))

mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([pad, pad, S - pad, S - pad], radius=int(S * 0.2), fill=255)
out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
out.paste(img, (0, 0), mask)
out.resize((1024, 1024), Image.LANCZOS).save(sys.argv[1])
