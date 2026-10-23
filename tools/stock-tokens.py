#!/usr/bin/env python3
"""Snapshot claude.ai's fixed "fizzy-lake" colours into lib/stock-tokens.json.

claude.ai's newer look (the html element carries data-cds-fizzy-lake="color
...") sets its surfaces, text, borders and fills to fixed colours instead of
deriving them from the gray ramp, so retinting the ramp no longer reaches
them. gen-css.py maps each of these stock colours onto the Omarchy theme.
Re-run this when claude.ai changes its palette.

Usage: stock-tokens.py claude-ai-stylesheet.css [...] > lib/stock-tokens.json

The stylesheet is the shared-styles-*.css that claude.ai loads. The desktop
app keeps it zstd-compressed in ~/.config/Claude/Cache/Cache_Data.
"""
import json
import re
import sys

HEX = re.compile(r"#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})")
TRIPLET = re.compile(r"[\d.]+ [\d.]+% [\d.]+%")

base, dark = {}, {}
for path in sys.argv[1:]:
    css = open(path, encoding="utf-8", errors="replace").read()
    for sel, body in re.findall(r"([^{}]*)\{([^{}]*)\}", css):
        if "[data-cds-fizzy-lake~=color]" not in sel:
            continue
        if "data-mode=dark" in sel:
            target = dark
        elif "data-mode" in sel:
            continue  # the same dark values again, for an unset mode
        else:
            target = base
        for name, value in re.findall(r"(--cds-[a-z0-9-]+)\s*:\s*([^;]+)", body):
            value = value.strip()
            if name.startswith(("--cds-gray-", "--cds-hsl-gray-")):
                continue  # gen-css.py builds these from its own ramp
            if HEX.fullmatch(value) or (name.startswith("--cds-hsl-") and TRIPLET.fullmatch(value)):
                target[name] = value

json.dump({"base": dict(sorted(base.items())), "dark": dict(sorted(dark.items()))}, sys.stdout, indent=1)
print()
