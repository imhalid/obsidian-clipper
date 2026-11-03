"""Draw the Thymer Web Clipper icon: Thymer's tick on a blueprint grid, as an SVG.

    python3 scripts/make-icon.py full > icon.svg
    python3 scripts/make-icon.py small > icon-small.svg

"full" has the grid, the circles and the hatching; "small" is for 16 to 48 px,
where those would only be noise: the tile and a larger, solid tick.
"""
import math
import sys

SIZE = 1024
# Apple's icon shape is a superellipse; a rounded square this round is close to it
RADIUS = 228

# Thymer's mark (from its app icon, in a 256 box): two bars with flat ends
LONG = ((88.5, 192.0), (198.4, 56.5))
SHORT = ((52.3, 88.5), (121.6, 151.5))
BAR = 32.0
MARK_CENTER = (125.0, 124.0)

TOP = '#2BE3BF'
BOTTOM = '#03947C'
LINE = '#FFFFFF'


class Mark:
    def __init__(self, scale, center):
        self.scale = scale
        self.center = center

    def place(self, point):
        return (self.center[0] + (point[0] - MARK_CENTER[0]) * self.scale,
                self.center[1] + (point[1] - MARK_CENTER[1]) * self.scale)

    def bar(self, ends, attributes):
        """One bar as a rounded rectangle turned along its two ends."""
        (x1, y1), (x2, y2) = self.place(ends[0]), self.place(ends[1])
        angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
        length = math.hypot(x2 - x1, y2 - y1)
        width = BAR * self.scale
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        return (f'<rect x="{cx - length / 2:.1f}" y="{cy - width / 2:.1f}" width="{length:.1f}" height="{width:.1f}" '
                f'rx="{width * 0.18:.1f}" transform="rotate({angle:.2f} {cx:.1f} {cy:.1f})" {attributes}/>')


def grid():
    lines = []
    # Guides at the eighths, the middle and the diagonals, like Apple's icon template
    for fraction in (0.125, 0.3125, 0.5, 0.6875, 0.875):
        p = SIZE * fraction
        lines.append(f'<line x1="{p}" y1="0" x2="{p}" y2="{SIZE}"/>')
        lines.append(f'<line x1="0" y1="{p}" x2="{SIZE}" y2="{p}"/>')
    lines.append(f'<line x1="0" y1="0" x2="{SIZE}" y2="{SIZE}"/>')
    lines.append(f'<line x1="{SIZE}" y1="0" x2="0" y2="{SIZE}"/>')
    for r in (128, 232, 340):
        lines.append(f'<circle cx="512" cy="512" r="{r}"/>')
    inset = 92
    return (f'<g stroke="{LINE}" stroke-opacity="0.3" stroke-width="5" fill="none">{"".join(lines)}</g>'
            f'<rect x="{inset}" y="{inset}" width="{SIZE - 2 * inset}" height="{SIZE - 2 * inset}" rx="150" '
            f'fill="none" stroke="{LINE}" stroke-width="16"/>')


def svg(detail):
    defs = [
        f'<linearGradient id="tile" x1="0" y1="0" x2="0" y2="{SIZE}" gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="{TOP}"/><stop offset="1" stop-color="{BOTTOM}"/></linearGradient>',
        f'<clipPath id="shape"><rect width="{SIZE}" height="{SIZE}" rx="{RADIUS}"/></clipPath>',
    ]
    body = [f'<rect width="{SIZE}" height="{SIZE}" rx="{RADIUS}" fill="url(#tile)"/>']
    # The short bar first: the long one is drawn over it, with a gap of the tile's colour
    bars = (SHORT, LONG)
    if detail:
        mark = Mark(3.4, (504, 530))
        # One hatch angle for both bars, so it reads as one drawing
        defs.append('<pattern id="hatch" width="30" height="30" patternUnits="userSpaceOnUse" patternTransform="rotate(-15)">'
                    f'<line x1="0" y1="0" x2="0" y2="30" stroke="{LINE}" stroke-width="8" stroke-opacity="0.8"/></pattern>')
        body.append(grid())
        for i, ends in enumerate(bars):
            defs.append(f'<clipPath id="bar{i}">{mark.bar(ends, "")}</clipPath>')
            body.append(mark.bar(ends, 'fill="url(#tile)" stroke="url(#tile)" stroke-width="44"'))
            body.append(f'<rect width="{SIZE}" height="{SIZE}" fill="url(#hatch)" clip-path="url(#bar{i})"/>')
            body.append(mark.bar(ends, f'fill="none" stroke="{LINE}" stroke-width="20"'))
    else:
        mark = Mark(3.9, (500, 530))
        for ends in bars:
            body.append(mark.bar(ends, f'fill="{LINE}" stroke="url(#tile)" stroke-width="44"'))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">'
            f'<defs>{"".join(defs)}</defs><g clip-path="url(#shape)">{"".join(body)}</g></svg>\n')


if __name__ == '__main__':
    sys.stdout.write(svg(detail=sys.argv[1:] != ['small']))
