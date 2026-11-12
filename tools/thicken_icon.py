# /// script
# requires-python = ">=3.10"
# dependencies = ["skia-pathops==0.9.2", "fonttools==4.68.0"]
# ///
"""Thicken an icon's lines by a width, as one filled path (GitHub #119).

An icon drawn as filled outlines gets thicker lines from a stroke in its own colour, but the stroke and the fill
then overlap, and in a translucent colour (the toolbar's muted text is 60% opaque) the overlap is painted twice:
a darker rim and a lighter centre. This bakes the stroke into the shape instead: every path, unioned with its own
round-joined stroke, as a single filled path that is painted once.

    uv run tools/thicken_icon.py <icon.svg> <width>

Prints the path data, in the icon's own units. Width is in those units too: the full added width of each line.
"""

import re
import sys

import pathops
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.svgLib.path import parse_path


def thicken(paths: list[tuple[str, str]], width: float) -> str:
    """Return one path: the union of every path and its stroke of ``width``.

    Args:
        paths: Each path's data and its fill rule, ``"evenodd"`` or ``"nonzero"``. An even-odd outline whose inner
            contours wind the same way as its outer one would otherwise be read as filled solid.
        width: The full width added to each line, in the icon's own units. A negative width thins instead:
            the shape minus its own outline's stroke, so each line loses half of it on either side.

    Returns:
        SVG path data for the thickened shape, with nonzero winding.
    """
    shape = pathops.Path()
    for d, rule in paths:
        fill = (
            pathops.FillType.EVEN_ODD if rule == "evenodd" else pathops.FillType.WINDING
        )
        path = pathops.Path(fillType=fill)
        parse_path(d, path.getPen())
        path.simplify(fix_winding=True)
        stroke = pathops.Path(path)
        stroke.stroke(
            abs(width), pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 4
        )
        stroke.convertConicsToQuads()
        grown = pathops.op(
            path,
            stroke,
            pathops.PathOp.UNION if width >= 0 else pathops.PathOp.DIFFERENCE,
        )
        shape = pathops.op(shape, grown, pathops.PathOp.UNION)
    pen = SVGPathPen(None, ntos=lambda n: f"{n:.2f}".rstrip("0").rstrip("."))
    shape.draw(pen)
    return pen.getCommands()


def main() -> None:
    """Read an SVG's path data and print it thickened."""
    if len(sys.argv) != 3:
        sys.exit("usage: uv run tools/thicken_icon.py <icon.svg> <width>")
    with open(sys.argv[1], encoding="utf-8") as f:
        text = f.read()
    whole = "evenodd" if re.search(r'<svg[^>]*fill-rule="evenodd"', text) else "nonzero"
    paths = [
        (
            re.search(r'\bd="([^"]+)"', tag).group(1),
            "evenodd" if 'fill-rule="evenodd"' in tag else whole,
        )
        for tag in re.findall(r"<path\b[^>]*>", text)
    ]
    if not paths:
        sys.exit(f"{sys.argv[1]}: no path data")
    print(thicken(paths, float(sys.argv[2])))


if __name__ == "__main__":
    main()
