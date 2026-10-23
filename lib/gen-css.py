#!/usr/bin/env python3
"""Build the Claude desktop stylesheet from an Omarchy colors.toml.

The app's UI (the "cds" design system) derives every surface, text and border
colour from a gray ramp (--cds-gray-0 lightest .. --cds-gray-900 darkest) and
per-role scales (--cds-role-accent-50 .. 850, etc.). Re-colouring those ramps
from the theme retints the whole app while keeping its contrast steps. The
older claude.ai variables (--bg-100 etc., "H S% L%" triplets) are set too, and
so are the fixed colours of claude.ai's newer "fizzy-lake" look and desktop
layout, which bypass the ramp (see stock-tokens.json).

Usage: gen-css.py path/to/colors.toml > omarchy-theme.css
"""

import colorsys
import json
import os
import sys
import tomllib

c = tomllib.load(open(sys.argv[1], "rb"))
dark = c.get("mode", "dark") != "light"


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def hexc(t):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(v))) for v in t)


def mix(a, b, t):
    a, b = rgb(a), rgb(b)
    return hexc(a[i] + (b[i] - a[i]) * t for i in range(3))


def lum(h):
    r, g, b = (v / 255 for v in rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def triplet(h):
    r, g, b = (v / 255 for v in rgb(h))
    hh, l, s = colorsys.rgb_to_hls(r, g, b)
    return f"{hh * 360:.1f} {s * 100:.1f}% {l * 100:.1f}%"


def get(key, fallback):
    return c.get(key) or fallback


bg = c["background"]
fg = c["foreground"]
darker = get("darker_background", mix(bg, "#000000", 0.3))
dark_bg = get("dark_background", mix(bg, "#000000", 0.15))
accent = get("accent", get("blue", fg))
red = get("bright_red", get("red", "#e06c75"))
green = get("green", "#98c379")
yellow = get("yellow", "#e5c07b")
magenta = get("magenta", accent)
selection = get("selection", mix(bg, accent, 0.3))

# The app's stock gray ramp. Its luminance spacing is kept; only the
# endpoints are replaced, piecewise between anchor steps.
STOCK = {
    0: "#ffffff", 10: "#fcfcfb", 20: "#f9f9f7", 30: "#f6f6f4", 40: "#f3f3f0", 50: "#f0efec",
    60: "#edece8", 70: "#eae9e4", 80: "#e7e6e1", 90: "#e4e3dd", 100: "#e1e0d9", 150: "#d2d1c7",
    200: "#c3c2b7", 250: "#b4b3a8", 300: "#a5a49a", 350: "#97958d", 400: "#898781", 450: "#7b7974",
    500: "#6d6b67", 550: "#5f5e5a", 600: "#52514e", 650: "#454442", 700: "#383835", 750: "#2c2c2a",
    800: "#20201f", 810: "#1e1e1d", 820: "#1c1c1b", 830: "#1a1a19", 840: "#181817", 850: "#151515",
    860: "#131313", 870: "#111111", 880: "#0f0f0f", 890: "#0d0d0d", 900: "#0b0b0b",
}

if dark:
    # Dark UI: page is gray-850/900, text is gray-50..400.
    anchors = {0: mix(fg, "#ffffff", 0.4), 50: fg, 850: bg, 900: darker}
else:
    # Light UI: page is gray-0..50, text is gray-800..900.
    anchors = {0: bg, 50: dark_bg, 850: fg, 900: mix(fg, "#000000", 0.4)}

keys = sorted(anchors)
gray = {}
for step, stock in STOCK.items():
    lo = max(k for k in keys if k <= step)
    hi = min(k for k in keys if k >= step)
    if lo == hi:
        gray[step] = anchors[lo]
        continue
    a, b = lum(STOCK[lo]), lum(STOCK[hi])
    t = (a - lum(stock)) / (a - b) if a != b else 0
    gray[step] = mix(anchors[lo], anchors[hi], t)

ROLE_STEPS = [50, 100, 200, 250, 300, 350, 400, 450, 500, 600, 700, 750, 800, 850]


def scale(base):
    """A role ramp around one colour: 450 is the colour, lower is lighter."""
    out = {}
    for n in ROLE_STEPS:
        if n < 450:
            out[n] = mix(base, "#ffffff", (450 - n) / 450 * 0.85)
        elif n > 450:
            out[n] = mix(base, darker if dark else "#000000", (n - 450) / 450 * 0.85)
        else:
            out[n] = base
    return out


def on(color):
    return gray[900] if lum(color) > 0.5 else gray[0]


decl = []
names = set()


def add(k, v):
    names.add(k)
    decl.append(f"  --{k}: {v} !important;")


for step, v in gray.items():
    add(f"cds-gray-{step}", v)

for role, base, palette in (
    ("accent", accent, "blue"),
    ("danger", red, "red"),
    ("success", green, "green"),
    ("warning", yellow, "yellow"),
    ("pro", magenta, "violet"),
):
    for n, v in scale(base).items():
        add(f"cds-role-{role}-{n}", v)
        add(f"cds-{palette}-{n}", v)
    add(f"cds-role-{role}-fill", base)
    add(f"cds-role-{role}-fill-hover", mix(base, fg, 0.15))
    add(f"cds-role-{role}-on", on(base))

add("cds-clay", accent)
add("cds-clay-emphasized", mix(accent, fg, 0.15))

# Older claude.ai variables, still used by some web views.
legacy = {
    "bg-000": mix(bg, fg, 0.06), "bg-100": bg, "bg-200": dark_bg, "bg-300": darker,
    "bg-400": darker, "bg-500": darker,
    "text-000": fg, "text-100": fg, "text-200": mix(fg, bg, 0.2), "text-300": mix(fg, bg, 0.2),
    "text-400": mix(fg, bg, 0.45), "text-500": mix(fg, bg, 0.45),
    "border-100": fg, "border-200": fg, "border-300": fg, "border-400": fg,
    "accent-brand": accent, "brand-000": accent, "brand-100": accent,
    "brand-200": mix(accent, fg, 0.2), "accent-000": mix(accent, fg, 0.35),
    "accent-100": accent, "accent-200": accent, "accent-900": mix(bg, accent, 0.22),
    "oncolor-100": on(accent), "oncolor-200": on(accent), "oncolor-300": on(accent),
    "danger-000": red, "danger-100": red, "danger-200": red, "danger-900": mix(bg, red, 0.15),
    "success-000": green, "success-100": green, "success-200": green,
    "success-900": mix(bg, green, 0.15),
    "warning-000": yellow, "warning-100": yellow, "warning-200": yellow,
    "warning-900": mix(bg, yellow, 0.15),
}
for k, v in legacy.items():
    add(k, triplet(v))

# The same ramp as "H S% L%" triplets, which the newer desktop layout reads.
for step, v in gray.items():
    add(f"cds-hsl-gray-{step}", triplet(v))


def ramp(color):
    """A stock neutral, moved to the same place on the theme's ramp."""
    target = lum(color)
    steps = sorted(STOCK)
    for lo, hi in zip(steps, steps[1:]):
        a, b = lum(STOCK[lo]), lum(STOCK[hi])
        if a >= target >= b:
            return mix(gray[lo], gray[hi], (a - target) / (a - b) if a != b else 0)
    return gray[0] if target > lum(STOCK[0]) else gray[900]


# The desktop layout's own surface levels (on .dframe-root): fixed grays,
# given here by their stock lightness.
levels = [3.9, 10.2, 14.9, 20, 23.9, 32.2, 65.1] if dark else [100, 96.1, 92.2, 87.8, 83.9, 60, 45.1]
for n, light in enumerate(levels):
    add(f"df-z{n}", triplet(ramp(hexc([light / 100 * 255] * 3))))

# claude.ai's newer look ("fizzy-lake", flagged on the html element) gives
# surfaces, text, borders and fills fixed colours instead of ramp references.
# stock-tokens.json (from tools/stock-tokens.py) holds those stock values, and
# each is moved onto the theme: an opaque neutral by its place on the gray
# ramp, a white or black overlay as the theme's light or dark end at the same
# opacity, and a colour as the theme colour of its hue.
light_end, dark_end = (fg, darker) if dark else (bg, fg)
aqua = c.get("cyan") or c.get("color6") or accent
hues = (  # (upper bound in degrees, theme colour)
    (12, red), (30, mix(red, yellow, 0.5)), (65, yellow), (160, green),
    (195, aqua), (240, accent), (345, magenta), (360, red),
)


def parse(value):
    """'#rgb[a]', '#rrggbb[aa]' or 'H S% L%' -> ('#rrggbb', alpha, was a triplet)."""
    if value.startswith("#"):
        h = value[1:]
        if len(h) in (3, 4):
            h = "".join(ch * 2 for ch in h)
        return "#" + h[:6], int(h[6:8], 16) / 255 if len(h) == 8 else 1.0, False
    hh, s, l = (float(x.rstrip("%")) for x in value.split())
    return hexc(v * 255 for v in colorsys.hls_to_rgb(hh / 360, l / 100, s / 100)), 1.0, True


def retint(value):
    color, alpha, was_triplet = parse(value)
    r, g, b = rgb(color)
    if max(r, g, b) - min(r, g, b) <= 6:
        out = ramp(color) if alpha >= 1 else light_end if lum(color) > 0.5 else dark_end
    else:
        hue, light, _ = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        base = next(col for bound, col in hues if hue * 360 < bound)
        toward = "#ffffff" if light > 0.5 else darker if dark else "#000000"
        out = mix(base, toward, min(0.85, abs(light - 0.5) / 0.5 * 0.85))
    if was_triplet:
        return triplet(out)
    return out if alpha >= 1 else out + "%02x" % round(alpha * 255)


try:
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "stock-tokens.json")) as f:
        stock = json.load(f)
except (OSError, ValueError):
    stock = {"base": {}, "dark": {}}
for name, value in {**stock["base"], **(stock["dark"] if dark else {})}.items():
    if name[2:] not in names:
        add(name[2:], retint(value))

# The terminal pane is drawn by xterm.js (WebGL), which CSS cannot reach, so
# its palette travels as JSON in a comment that inject.js reads. Same mapping
# as Omarchy's alacritty template; colorN keys are the fallback.
def term(name, n, fallback):
    return c.get(name) or c.get(f"color{n}") or fallback


# The terminal sits one step back from the chat, on the sidebar's shade
# (gray-870, or its mirror gray-30 in a light UI), so it reads as its own
# panel instead of blending in.
term_bg = gray[870] if dark else gray[30]

terminal = {
    "background": term_bg,
    "foreground": fg,
    "cursor": get("bright_foreground", fg),
    "cursorAccent": term_bg,
    "selectionBackground": get("selection_background", selection),
    "selectionForeground": get("selection_foreground", get("bright_foreground", fg)),
    "black": term("black", 0, term_bg),
    "red": term("red", 1, red),
    "green": term("green", 2, green),
    "yellow": term("yellow", 3, yellow),
    "blue": term("blue", 4, accent),
    "magenta": term("magenta", 5, magenta),
    "cyan": term("cyan", 6, accent),
    "white": term("white", 7, fg),
    "brightBlack": c.get("muted") or c.get("color8") or get("dark_foreground", mix(bg, fg, 0.4)),
    "brightRed": term("bright_red", 9, red),
    "brightGreen": term("bright_green", 10, green),
    "brightYellow": term("bright_yellow", 11, yellow),
    "brightBlue": term("bright_blue", 12, accent),
    "brightMagenta": term("bright_magenta", 13, magenta),
    "brightCyan": term("bright_cyan", 14, accent),
    "brightWhite": term("bright_white", 15, get("bright_foreground", fg)),
}

print("/* Claude desktop palette - generated from the active Omarchy theme.")
print(" * Do not edit: rewritten on every `omarchy theme set`. */")
print(f"/* omaclaude-terminal: {json.dumps(terminal, separators=(',', ':'))} */")
# The window-controls overlay (close button) is native, coloured by the main
# process; inject.js reads this too.
titlebar = {"color": bg, "symbolColor": fg}
print(f"/* omaclaude-titlebar: {json.dumps(titlebar, separators=(',', ':'))} */\n")
print(":root, .cds-root, .cds-dark-scope, [data-theme], [data-mode], .dframe-root {")
print("\n".join(decl))
print("}\n")
print(f"::selection {{ background-color: {selection}; }}")
