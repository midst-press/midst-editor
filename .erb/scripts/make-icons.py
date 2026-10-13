#!/usr/bin/env python3
"""Regenerate every app icon from the artwork in .erb/icon-source/ (issue #59).

The artwork is kept outside assets/ because everything under assets/ is shipped inside the app.

Run on macOS (it uses iconutil), from the repository root:

    uv run --no-project --with pillow python .erb/scripts/make-icons.py

Writes assets/icon.icns, assets/icon.ico, assets/icon.png and assets/icons/*.png. Commit the results.

WHY THE macOS ICON IS BUILT THE WAY IT IS. macOS 26 draws an app icon inside a grey rounded box, smaller
and with a border, unless the icon is an opaque rounded rectangle. Measured on macOS 26.6.1 with a
bundle holding only an .icns:

    opaque rounded rectangle, any margin        accepted, drawn at the size of the system's own icons
    the same with a transparent hole in it      boxed
    a circle                                    boxed

The icon this replaces had a transparent squiggle cut through it, which is why it was boxed. So the
macOS icon is the designer's SQUARE artwork placed on Apple's icon grid: an 824px tile centred on a
1024px canvas, corner radius 185.4, with nothing transparent inside the tile. Earlier macOS draws an
.icns as given, and the margin makes it the same size as other apps' icons there.

Windows and Linux take the designer's rounded-corner artwork as supplied; neither platform masks icons.

This script refuses to write anything if the macOS tile is not fully opaque.
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parents[2] / "assets"
SOURCE = Path(__file__).resolve().parents[1] / "icon-source"
CANVAS, TILE, RADIUS = 1024, 824, 185.4
MARGIN = (CANVAS - TILE) // 2


def mac_master() -> Image.Image:
    """The square artwork as an opaque rounded tile on Apple's grid."""
    square = Image.open(SOURCE / "Icon-Light-Square.png").convert("RGBA")
    # The supplied export is opaque except for alpha 254 over part of the gradient; anything lower
    # would be real transparency and is refused. The alpha is then set to exactly 255.
    if square.size != (CANVAS, CANVAS) or square.getchannel("A").getextrema()[0] < 250:
        sys.exit("Icon-Light-Square.png must be 1024x1024 and opaque")
    square.putalpha(255)
    scale = 4  # draw the mask large and reduce it, for a smooth edge
    mask = Image.new("L", (TILE * scale, TILE * scale), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, TILE * scale - 1, TILE * scale - 1], radius=RADIUS * scale, fill=255)
    tile = square.resize((TILE, TILE), Image.LANCZOS)
    tile.putalpha(mask.resize((TILE, TILE), Image.LANCZOS))
    master = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    master.paste(tile, (MARGIN, MARGIN), tile)
    # A transparent pixel inside the tile is what gets the icon boxed on macOS 26. Check well inside the
    # corners: the middle band across, and the middle band down.
    alpha = master.getchannel("A")
    inner = int(RADIUS) + 2
    for box in ((MARGIN + 2, MARGIN + inner, CANVAS - MARGIN - 2, CANVAS - MARGIN - inner),
                (MARGIN + inner, MARGIN + 2, CANVAS - MARGIN - inner, CANVAS - MARGIN - 2)):
        if alpha.crop(box).getextrema() != (255, 255):
            sys.exit("the macOS tile has a transparent pixel inside it; macOS 26 would box the icon")
    return master


def main() -> None:
    mac = mac_master()
    plain = Image.open(SOURCE / "Icon-Light-RC.png").convert("RGBA")
    if plain.size != (CANVAS, CANVAS):
        sys.exit("Icon-Light-RC.png must be 1024x1024")

    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "icon.iconset"
        iconset.mkdir()
        for n in (16, 32, 128, 256, 512):
            mac.resize((n, n), Image.LANCZOS).save(iconset / f"icon_{n}x{n}.png")
            mac.resize((2 * n, 2 * n), Image.LANCZOS).save(iconset / f"icon_{n}x{n}@2x.png")
        if not shutil.which("iconutil"):
            sys.exit("iconutil not found: run this on macOS")
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(ASSETS / "icon.icns")], check=True)

    plain.save(ASSETS / "icon.ico", sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])
    plain.save(ASSETS / "icon.png")
    for n in (16, 32, 128, 256, 512, 1024):
        plain.resize((n, n), Image.LANCZOS).save(ASSETS / "icons" / f"{n}x{n}.png")
    plain.resize((180, 180), Image.LANCZOS).save(ASSETS / "icons" / "apple-touch-icon.png")
    print("icons written under", ASSETS)


if __name__ == "__main__":
    main()
