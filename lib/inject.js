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

function terminalPalette(text) {
  const m = /\/\* omaclaude-terminal: (\{.*?\}) \*\//.exec(text);
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
function pageScript(palette) {
  const install = () => {
    const seen = new Set(); // xterm instances found so far
    const walked = new WeakSet(); // .xterm elements already looked up
    let colors = null;

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
        if (t) seen.add(t);
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
      schedule();
    };
  };

  window.__omaclaudeTerminal = window.__omaclaudeTerminal || install();
  window.__omaclaudeTerminal(palette);
}

let css = readCss();

function runPageScript(wc) {
  const palette = terminalPalette(css);
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
  }, 100);
}

app.whenReady().then(() => {
  try {
    fs.watch(path.dirname(cssFile), (_ev, name) => {
      if (!name || name === path.basename(cssFile)) reload();
    });
  } catch {}
});
