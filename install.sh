#!/bin/bash
#
# omaclaude user-level installer. No root needed.
#
# Puts the theme-set hook and the in-app injector in place and renders the
# stylesheet for the current theme. Safe to run repeatedly: the shell plugin
# runs it at every startup. The one-time app patch is root/setup.sh (sudo).
#
# Usage: install.sh [--quiet]
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
data="$HOME/.local/share/omaclaude"
hook="$HOME/.config/omarchy/hooks/theme-set.d/omaclaude"
asar="/usr/lib/claude-desktop/resources/app.asar"

quiet=false
[[ ${1:-} == --quiet ]] && quiet=true
note() { $quiet || printf 'omaclaude: %s\n' "$1"; }

# Only rewrite files whose content changed, so an unchanged install is a no-op.
put() {
  local mode=$1 src=$2 dest=$3
  cmp -s "$src" "$dest" 2>/dev/null && return 0
  mkdir -p "${dest%/*}"
  install -m "$mode" "$src" "$dest"
}

put 644 "$here/lib/gen-css.py" "$data/gen-css.py"
put 644 "$here/lib/inject.js" "$data/inject.js"
put 755 "$here/lib/theme-set-hook" "$hook"

# Render the stylesheet for the current theme now, rather than waiting for
# the next theme switch.
bash "$hook" >/dev/null 2>&1 || true

if [[ ! -f $asar ]]; then
  note "Claude desktop not found at /usr/lib/claude-desktop (install the claude-desktop package)"
elif ! grep -q "omaclaude-loader.js" "$asar" 2>/dev/null; then
  note "one more step: run 'sudo $here/root/setup.sh', then restart Claude"
  $quiet && command -v notify-send >/dev/null &&
    [[ ! -e $data/notified ]] &&
    notify-send -a omaclaude "omaclaude" "Run: sudo $here/root/setup.sh, then restart Claude" &&
    touch "$data/notified"
else
  note "done. Claude follows your Omarchy theme (restart Claude once if it was open during setup)"
fi
exit 0
