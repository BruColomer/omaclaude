# omaclaude

Makes the [Claude desktop app](https://claude.ai/download) follow your [Omarchy](https://omarchy.org) theme. Every `omarchy theme set` recolours the whole app (sidebar, chat, Code tab, buttons, accents) within a second, with no restart.

It reads the theme's `colors.toml` and rebuilds the app's own colour scales from it: the gray ramp behind every surface, text and border, and the accent, danger, success and warning roles. The app's contrast steps are kept, so it still reads like Claude, only in your colours.

## Requirements

- Omarchy (Quattro shell)
- The `claude-desktop` package, installed at `/usr/lib/claude-desktop`
- `python3`

## Install

```bash
omarchy plugin add https://github.com/BruColomer/omaclaude --enable
```

The plugin puts the theme hook in place by itself. The app has no theming support, so it also needs a small loader added to it once. That step needs root:

```bash
sudo ~/.config/omarchy/plugins/io.github.brucolomer.omaclaude/root/setup.sh
```

Then quit Claude completely and open it again.

### What the root step does

`root/setup.sh` installs two files and runs one of them:

- `/usr/local/bin/omaclaude-patch` adds a loader file to `/usr/lib/claude-desktop/resources/app.asar` and points the app's entry point at it. The loader loads `~/.local/share/omaclaude/inject.js` if it exists, then starts the app exactly as before. No app code is modified, and nothing is downloaded or executed.
- `/etc/pacman.d/hooks/omaclaude.hook` re-runs the patcher after each `claude-desktop` upgrade, because an upgrade replaces `app.asar`.

The injector runs inside the app and only inserts `~/.config/Claude/omaclaude.css` into the app's pages. It watches that file and swaps in the new version when it changes. It opens no ports and makes no network requests.

## How it fits together

| Piece | Location | Role |
|---|---|---|
| Theme hook | `~/.config/omarchy/hooks/theme-set.d/omaclaude` | Runs `gen-css.py` on every theme switch |
| Generator | `~/.local/share/omaclaude/gen-css.py` | `colors.toml` → `~/.config/Claude/omaclaude.css` |
| Injector | `~/.local/share/omaclaude/inject.js` | Inserts the stylesheet into the app, live |
| Loader | inside `app.asar` (root step) | Loads the injector at app start |

The shell plugin runs `install.sh` at every shell start, which keeps the user-level files current after a plugin update. It never runs anything as root.

## Light and dark

The app picks its light or dark scale from the system colour scheme (`org.gnome.desktop.interface color-scheme`). For a light Omarchy theme, set that to `prefer-light` (or set Claude's own appearance to Light). Otherwise the app keeps its dark scale, which omaclaude has built for a light theme, and the colours come out inverted.

## Uninstall

```bash
sudo ~/.config/omarchy/plugins/io.github.brucolomer.omaclaude/uninstall.sh
omarchy plugin remove io.github.brucolomer.omaclaude
```

The first command removes the hook, injector and stylesheet, points the app back at its original entry point, and removes the pacman hook and patcher. Restart Claude to get the stock colours back. Running `uninstall.sh` without `sudo` removes only the user-level files.

## Notes

- Unofficial. Not affiliated with or endorsed by Anthropic.
- A Claude update can rename the app's internal colour variables. If the colours stop applying after an update, open an issue.
- Electron's asar integrity check is not enforced on Linux, which is what lets the loader be added without rebuilding the app.

## License

MIT
