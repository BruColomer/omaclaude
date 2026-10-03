#!/bin/bash
#
# omaclaude one-time system setup. Run with sudo.
#
# Installs the patcher to /usr/local/bin and a pacman hook that re-runs it
# after every claude-desktop upgrade, then patches the app once now.
#
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "omaclaude: run this with sudo" >&2
  exit 1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install -Dm755 "$here/omaclaude-patch" /usr/local/bin/omaclaude-patch
install -Dm644 "$here/omaclaude.hook" /etc/pacman.d/hooks/omaclaude.hook
/usr/local/bin/omaclaude-patch

echo "omaclaude: done. Quit Claude completely and open it again."
