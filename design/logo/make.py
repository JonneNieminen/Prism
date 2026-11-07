"""Prism logo masters ("Bend"). White light falls, bends, and fans out into three
stem lanes. Lumio's language: one monoline weight, round caps, deep tile.

python3 design/logo/make.py  →  SVGs in design/logo/, docs/logo.svg, public/favicon.svg
Then scripts/render-icons.sh renders the PNG/ICNS app icons."""
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
TILE = "#1F2144"

PALETTES = {
    # beam, vocals, drums, bass
    "dark": ("#F4EFE2", "#E48AA0", "#DDB06A", "#9D92E4"),
    "light": ("#24264A", "#C95F78", "#B8862F", "#7166C4"),
}


def symbol(beam, voc, drm, bas, mono=False):
    """64×64 artwork, optically centred. Lanes are drawn outer→inner, beam last,
    so the lanes peel out from under the white line."""
    def stroke(d, c, w, o=1.0):
        op = f' stroke-opacity="{o}"' if o < 1 else ""
        return f'<path d="{d}" fill="none" stroke="{c}"{op} stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'

    def dot(x, y, c, o=1.0):
        op = f' fill-opacity="{o}"' if o < 1 else ""
        return f'<circle cx="{x}" cy="{y}" r="3" fill="{c}"{op}/>'

    ov, od, ob = (1, 0.72, 0.48) if mono else (1, 1, 1)
    return "".join([
        stroke("M15 33A18 18 0 0 0 33 51H49", bas, 4.5, ob), dot(49, 51, bas, ob),
        stroke("M15 33A12 12 0 0 0 27 45H49", drm, 4.5, od), dot(49, 45, drm, od),
        stroke("M15 33A6 6 0 0 0 21 39H49", voc, 4.5, ov), dot(49, 39, voc, ov),
        stroke("M15 14V28", beam, 7),
    ])


def svg(body, view="0 0 64 64", extra=""):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" role="img" aria-label="Prism">{extra}{body}</svg>\n'


dark = symbol(*PALETTES["dark"])
light = symbol(*PALETTES["light"])
mono = symbol(*(["currentColor"] * 4), mono=True)

files = {
    HERE / "prism-symbol-on-dark.svg": svg(dark),
    HERE / "prism-symbol-on-light.svg": svg(light),
    HERE / "prism-symbol-mono.svg": svg(mono),
    # Square tile (README, web): full-bleed like Lumio's icon.
    HERE / "prism-icon.svg": svg(dark, extra=f'<rect width="64" height="64" rx="15" fill="{TILE}"/>'),
    # macOS app icon: tile on the 1024 grid (824 tile, 100 margin) with Big Sur-era shadow.
    HERE / "prism-app-icon.svg": svg(
        f'<g transform="translate(100 100) scale(12.875)">{dark}</g>',
        view="0 0 1024 1024",
        extra=(
            '<defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%">'
            '<feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.28"/></filter></defs>'
            f'<rect x="100" y="100" width="824" height="824" rx="185" fill="{TILE}" filter="url(#s)"/>'
        ),
    ),
}
# Icon Composer bundle for macOS 26+ (flat: solid fill, no shadow, no translucency).
# render-icons.sh rasterises mark.svg → Assets/mark.png and compiles it with actool.
TILE_RGB = tuple(int(TILE[i : i + 2], 16) / 255 for i in (1, 3, 5))
icon_json = {
    "fill": {"solid": "srgb:" + ",".join(f"{c:.5f}" for c in TILE_RGB) + ",1.00000"},
    "groups": [{"layers": [{"image-name": "mark.png", "name": "mark"}],
                "shadow": {"kind": "none", "opacity": 0},
                "translucency": {"enabled": False, "value": 0}}],
    "supported-platforms": {"squares": ["macOS"]},
}
import json
(HERE / "Prism.icon/Assets").mkdir(parents=True, exist_ok=True)
(HERE / "Prism.icon/icon.json").write_text(json.dumps(icon_json, indent=2) + "\n")
files[HERE / "mark.svg"] = svg(dark)

files[ROOT / "docs/logo.svg"] = files[HERE / "prism-icon.svg"]
files[ROOT / "public/favicon.svg"] = files[HERE / "prism-icon.svg"]
for p, s in files.items():
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s)
print("\n".join(str(p.relative_to(ROOT)) for p in files))
