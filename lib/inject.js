// omaclaude: Omarchy theme injector for the Claude desktop app.
//
// Loaded in the Electron main process by the stub that root/omaclaude-patch
// adds to app.asar. Inserts ~/.config/Claude/omaclaude.css (written by the
// Omarchy theme-set hook) into every web page the app shows, and swaps it
// live when the file changes. Kept outside the asar so plugin updates reach
// it without re-patching.

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

let css = readCss();

async function apply(wc) {
  if (wc.isDestroyed()) return;
  const old = inserted.get(wc);
  inserted.delete(wc);
  try {
    if (css) inserted.set(wc, await wc.insertCSS(css, { cssOrigin: 'user' }));
    if (old) await wc.removeInsertedCSS(old);
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
