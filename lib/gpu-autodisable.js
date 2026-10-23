// omaclaude: undo the Claude desktop app's *automatic* hardware-acceleration
// shutoff.
//
// The app counts GPU-process deaths and, at three in one session, turns
// hardware acceleration off for good (isHardwareAccelerationAutoDisabled in
// claude_desktop_config.json, plus a "gpu-crash-streak" marker file that the
// next launch also acts on). Ending the Hyprland session with the app still
// running kills its GPU process every time, so each logout, reboot or
// shutdown trips it and the app stays slow until someone finds the toggle in
// Help > Troubleshooting.
//
// This runs from the loader, before any app code, so the app has not read the
// config yet and will see the repaired file. It only ever reverts an
// automatic disable. A disable the user chose has isHardwareAccelerationAutoDisabled
// false and is never touched.
//
// Crash-loop guard: a truly broken GPU would trip the shutoff mid-session. The
// undo is allowed once per login session (boot + Hyprland instance), tracked in
// a state file, so a shutoff that happens in the session we are in stays in
// force until the next login. Worst case on a broken GPU is one retry, and the
// app's own "Graphics problems detected" dialog, per login.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const STREAK_THRESHOLD = 3; // the app's own limit for acting on the marker

function loginSession(env) {
  let boot = '';
  try {
    boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch {}
  return `${boot}:${env.HYPRLAND_INSTANCE_SIGNATURE || ''}`;
}

// Chromium's profile lock is a symlink "<hostname>-<pid>". Another live
// instance means the app (not us) owns the config right now.
function otherInstanceRunning(claudeDir, hostname, ownPid) {
  let target;
  try {
    target = fs.readlinkSync(path.join(claudeDir, 'SingletonLock'));
  } catch {
    return false;
  }
  const m = /^(.*)-(\d+)$/.exec(target);
  if (!m || m[1] !== hostname) return false;
  const pid = Number(m[2]);
  if (pid === ownPid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function writeAtomic(file, text, mode) {
  const tmp = `${file}.omaclaude.tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}

// Returns what it did, for the log and the tests:
//   'other-instance'  the app is already running; touched nothing
//   'same-session'    already handled for this login session; touched nothing
//   'unreadable'      config missing or not JSON; touched nothing
//   'clean'           nothing to undo
//   'undone'          repaired the config and/or removed the crash marker
function undoAutoDisable({
  claudeDir,
  stateFile,
  env = process.env,
  hostname = os.hostname(),
  pid = process.pid,
}) {
  if (otherInstanceRunning(claudeDir, hostname, pid)) return 'other-instance';

  const session = loginSession(env);
  let last = '';
  try {
    last = fs.readFileSync(stateFile, 'utf8').trim();
  } catch {}
  if (last === session) return 'same-session';

  const configFile = path.join(claudeDir, 'claude_desktop_config.json');
  const markerFile = path.join(claudeDir, 'gpu-crash-streak');
  let acted = false;

  let raw;
  try {
    raw = fs.readFileSync(configFile, 'utf8');
  } catch {
    return 'unreadable';
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    return 'unreadable';
  }

  if (config && config.isHardwareAccelerationAutoDisabled === true) {
    config.isHardwareAccelerationDisabled = false;
    config.isHardwareAccelerationAutoDisabled = false;
    config.isHardwareAccelerationAutoDisableNoticePending = false;
    const indent = /^\{\r?\n( +)"/.exec(raw);
    const text = JSON.stringify(config, null, indent ? indent[1].length : 2);
    const mode = fs.statSync(configFile).mode & 0o777;
    writeAtomic(configFile, raw.endsWith('\n') ? `${text}\n` : text, mode);
    acted = true;
  }

  // The marker left by the dying session makes the next launch flip the
  // setting again, so it goes too. Anything under the threshold is inert.
  try {
    const streak = Number.parseInt(fs.readFileSync(markerFile, 'utf8'), 10);
    if (streak >= STREAK_THRESHOLD) {
      fs.rmSync(markerFile, { force: true });
      acted = true;
    }
  } catch {}

  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${session}\n`);
  return acted ? 'undone' : 'clean';
}

module.exports = { undoAutoDisable };
