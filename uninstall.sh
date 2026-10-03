#!/bin/bash
#
# Reverses install.sh and, when run with sudo, root/setup.sh too.
#
#   uninstall.sh          remove the hook, injector and stylesheet
#   sudo uninstall.sh     also unpatch the app and remove the pacman hook
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
user_home=$HOME
[[ $EUID -eq 0 && -n ${SUDO_USER:-} ]] && user_home=$(getent passwd "$SUDO_USER" | cut -d: -f6)

rm -f "$user_home/.config/omarchy/hooks/theme-set.d/omaclaude" \
  "$user_home/.config/Claude/omaclaude.css"
rm -rf "$user_home/.local/share/omaclaude"
echo "omaclaude: removed the theme hook and injector"

if [[ $EUID -eq 0 ]]; then
  python3 "$here/root/omaclaude-patch" --remove
  rm -f /etc/pacman.d/hooks/omaclaude.hook /usr/local/bin/omaclaude-patch
  echo "omaclaude: unpatched the app. Restart Claude to get the stock colours back."
else
  echo "omaclaude: run 'sudo $here/uninstall.sh' to also unpatch the app"
fi
