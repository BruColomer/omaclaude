// omaclaude: Omarchy theme injector for the Claude desktop app.
//
// Loaded in the Electron main process by the stub that root/omaclaude-patch
// adds to app.asar. Inserts ~/.config/Claude/omaclaude.css (written by the
// Omarchy theme-set hook) into every web page the app shows, and swaps it
// live when the file changes. Kept outside the asar so plugin updates reach
// it without re-patching.
//
// The terminal pane is the exception: xterm.js draws it with WebGL from a
// JS theme object, so CSS cannot reach it. Its palette is carried as JSON in
// a comment in the stylesheet and applied by a small script in the page.

const { app, webContents } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cssFile =
  process.env.OMACLAUDE_CSS || path.join(os.homedir(), '.config', 'Claude', 'omaclaude.css');
const inserted = new Map(); // webContents -> key from insertCSS

function readCss() {
  try {
    return fs.readFileSync(cssFile, 'utf8');
  } catch {
    return '';
  }
}

function embedded(text, name) {
  const m = new RegExp(`/\\* omaclaude-${name}: (\\{.*?\\}) \\*/`).exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// Runs in the page. Finds each xterm instance through the React tree (the
// component holding it keeps it in a ref as { terminal }), merges the Omarchy
// palette over the app's terminal theme, and re-applies it whenever the app
// sets its own theme again (on mount, re-attach, or appearance change).
// The pane around the terminal (tab strip, padding) is painted with the app's
// own terminal background via inline styles, so elements there that still
// show that colour are repainted with the theme background.
function pageScript(palette) {
  const install = () => {
    const seen = new Set(); // xterm instances found so far
    const walked = new WeakSet(); // .xterm elements already looked up
    const painted = new Set(); // pane elements whose background we override
    let colors = null;
    let stockBg = null; // the app's own terminal background, as [r, g, b]
    let lastPaint = 0;

    const rgb = (css) => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(css || '');
      if (m) return m[4] === '0' ? null : [+m[1], +m[2], +m[3]];
      const h = /^#([0-9a-f]{6})$/i.exec(css || '');
      return h ? [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16)) : null;
    };
    const near = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) <= 3);

    const paintPane = (xtermEl) => {
      if (!stockBg) return;
      const root = xtermEl.closest('[data-pane-root]') || xtermEl.parentElement?.parentElement?.parentElement;
      if (!root) return;
      const els = [root, ...root.querySelectorAll('*')];
      for (const el of els) {
        if (el.closest('.xterm')) continue;
        if (!painted.has(el) && !near(rgb(getComputedStyle(el).backgroundColor), stockBg)) continue;
        painted.add(el);
        el.style.setProperty('background-color', colors.background, 'important');
      }
    };

    const findTerminal = (el) => {
      for (let node = el; node; node = node.parentElement) {
        const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
        if (!key) continue;
        for (let f = node[key], i = 0; f && i < 80; f = f.return, i++) {
          for (let h = f.memoizedState, j = 0; h && j < 100; h = h.next, j++) {
            const t = h.memoizedState && h.memoizedState.current && h.memoizedState.current.terminal;
            if (t && t.options && typeof t.loadAddon === 'function') return t;
          }
        }
        return null;
      }
      return null;
    };

    const apply = () => {
      if (!colors) return;
      for (const el of document.querySelectorAll('.xterm')) {
        if (walked.has(el)) continue;
        walked.add(el);
        const t = findTerminal(el);
        if (!t) continue;
        seen.add(t);
        const own = t.options.theme && t.options.theme.background;
        if (!stockBg && own && own !== colors.background) stockBg = rgb(own);
      }
      for (const t of seen) {
        try {
          const current = t.options.theme || {};
          if (Object.keys(colors).every((k) => current[k] === colors[k])) continue;
          t.options.theme = { ...current, ...colors };
        } catch {
          seen.delete(t);
        }
      }
      // Repainting reads computed styles across the pane, so cap its rate:
      // the observer fires constantly while a chat reply streams in.
      const now = Date.now();
      if (now - lastPaint < 500) return;
      lastPaint = now;
      for (const el of painted) if (!el.isConnected) painted.delete(el);
      for (const el of document.querySelectorAll('.xterm')) paintPane(el);
    };

    let pending = false;
    const schedule = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        apply();
      });
    };

    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    // The app can swap the theme without touching the DOM (appearance change).
    setInterval(apply, 2000);

    return (next) => {
      colors = next;
      for (const el of painted) el.style.setProperty('background-color', next.background, 'important');
      schedule();
    };
  };

  window.__omaclaudeTerminal = window.__omaclaudeTerminal || install();
  window.__omaclaudeTerminal(palette);
}

let css = readCss();

function runPageScript(wc) {
  const palette = embedded(css, 'terminal');
  if (!palette) return;
  const src = `(${pageScript})(${JSON.stringify(palette)})`;
  for (const frame of wc.mainFrame.framesInSubtree) {
    frame.executeJavaScript(src).catch(() => {});
  }
}

async function apply(wc) {
  if (wc.isDestroyed()) return;
  const old = inserted.get(wc);
  inserted.delete(wc);
  try {
    if (css) inserted.set(wc, await wc.insertCSS(css, { cssOrigin: 'user' }));
    if (old) await wc.removeInsertedCSS(old);
    runPageScript(wc);
  } catch {}
}

// The window controls (close button) sit in a native overlay that the app
// colours itself through setTitleBarOverlay. Swap in the theme colours on the
// way through, and re-send the last overlay whenever the theme changes.
const { BrowserWindow } = require('electron');
const lastOverlay = new WeakMap(); // window -> overlay options the app asked for
const overlayWith = (opts) => {
  const colors = embedded(css, 'titlebar');
  return colors ? { ...opts, ...colors } : opts;
};
const setOverlay = BrowserWindow.prototype.setTitleBarOverlay;
if (typeof setOverlay === 'function') {
  BrowserWindow.prototype.setTitleBarOverlay = function (opts) {
    lastOverlay.set(this, opts);
    return setOverlay.call(this, overlayWith(opts));
  };
}
function refreshOverlays() {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      setOverlay.call(win, overlayWith(lastOverlay.get(win) || {}));
    } catch {}
  }
}

// Windows can get their overlay colours at construction, without a call to
// setTitleBarOverlay; cover those once they exist. Throws, harmlessly, for
// windows without an overlay.
app.on('browser-window-created', (_e, win) => {
  setTimeout(() => {
    if (win.isDestroyed() || lastOverlay.has(win)) return;
    try {
      setOverlay.call(win, overlayWith({}));
    } catch {}
  }, 1000);
});

app.on('web-contents-created', (_e, wc) => {
  // insertCSS does not survive navigation, so re-apply on every load.
  wc.on('dom-ready', () => apply(wc));
  wc.once('destroyed', () => inserted.delete(wc));
});

// Watch the directory, not the file: the hook replaces it by rename.
let timer;
function reload() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const next = readCss();
    if (next === css) return;
    css = next;
    for (const wc of webContents.getAllWebContents()) apply(wc);
    refreshOverlays();
  }, 100);
}

app.whenReady().then(() => {
  try {
    fs.watch(path.dirname(cssFile), (_ev, name) => {
      if (!name || name === path.basename(cssFile)) reload();
    });
  } catch {}
});
