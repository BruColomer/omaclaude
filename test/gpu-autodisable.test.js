// Run with: node --test test/gpu-autodisable.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { undoAutoDisable } = require('../lib/gpu-autodisable.js');

const HOST = os.hostname();

function sandbox(config, { marker, raw } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omaclaude-gpu-'));
  const claudeDir = path.join(root, 'Claude');
  fs.mkdirSync(claudeDir);
  const configFile = path.join(claudeDir, 'claude_desktop_config.json');
  fs.writeFileSync(configFile, raw ?? `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  if (marker !== undefined) fs.writeFileSync(path.join(claudeDir, 'gpu-crash-streak'), String(marker));
  const stateFile = path.join(root, 'data', 'gpu-session');
  const run = (extra = {}) =>
    undoAutoDisable({
      claudeDir,
      stateFile,
      env: { HYPRLAND_INSTANCE_SIGNATURE: 'sig-1' },
      hostname: HOST,
      ...extra,
    });
  const read = () => JSON.parse(fs.readFileSync(configFile, 'utf8'));
  return { root, claudeDir, configFile, stateFile, run, read };
}

const AUTO = {
  isHardwareAccelerationDisabled: true,
  isHardwareAccelerationAutoDisabled: true,
  isHardwareAccelerationAutoDisableNoticePending: true,
  preferences: { keep: 'me' },
};

test('reverts an automatic disable and keeps the rest of the file', () => {
  const s = sandbox(AUTO, { marker: 3 });
  assert.equal(s.run(), 'undone');
  assert.deepEqual(s.read(), {
    isHardwareAccelerationDisabled: false,
    isHardwareAccelerationAutoDisabled: false,
    isHardwareAccelerationAutoDisableNoticePending: false,
    preferences: { keep: 'me' },
  });
  const text = fs.readFileSync(s.configFile, 'utf8');
  assert.ok(text.startsWith('{\n  "isHardware'), 'two-space indent kept');
  assert.ok(text.endsWith('}\n'), 'trailing newline kept');
  assert.equal(fs.statSync(s.configFile).mode & 0o777, 0o600);
  assert.ok(!fs.existsSync(path.join(s.claudeDir, 'gpu-crash-streak')), 'marker removed');
  assert.deepEqual(fs.readdirSync(s.claudeDir).sort(), ['claude_desktop_config.json']);
});

test('never touches a disable the user chose', () => {
  const chosen = {
    isHardwareAccelerationDisabled: true,
    isHardwareAccelerationAutoDisabled: false,
    other: 1,
  };
  const s = sandbox(chosen);
  const before = fs.readFileSync(s.configFile);
  assert.equal(s.run(), 'clean');
  assert.deepEqual(fs.readFileSync(s.configFile), before);
});

test('leaves a config that has no flags alone', () => {
  const s = sandbox({ other: 1 });
  const before = fs.readFileSync(s.configFile);
  assert.equal(s.run(), 'clean');
  assert.deepEqual(fs.readFileSync(s.configFile), before);
});

test('crash-loop guard: a shutoff in this login session stays until the next login', () => {
  const s = sandbox(AUTO);
  assert.equal(s.run(), 'undone');
  // The GPU really is broken: the app flips the setting again mid-session.
  fs.writeFileSync(s.configFile, `${JSON.stringify(AUTO, null, 2)}\n`);
  assert.equal(s.run(), 'same-session');
  assert.equal(s.read().isHardwareAccelerationAutoDisabled, true, 'left disabled');
  // Next login (new Hyprland instance): one more attempt.
  assert.equal(s.run({ env: { HYPRLAND_INSTANCE_SIGNATURE: 'sig-2' } }), 'undone');
  assert.equal(s.read().isHardwareAccelerationDisabled, false);
});

test('a leftover crash marker alone is cleared, a small one is not', () => {
  const big = sandbox({ other: 1 }, { marker: 3 });
  assert.equal(big.run(), 'undone');
  assert.ok(!fs.existsSync(path.join(big.claudeDir, 'gpu-crash-streak')));

  const small = sandbox({ other: 1 }, { marker: 2 });
  assert.equal(small.run(), 'clean');
  assert.ok(fs.existsSync(path.join(small.claudeDir, 'gpu-crash-streak')));
});

test('does nothing while another instance owns the profile', () => {
  const s = sandbox(AUTO);
  fs.symlinkSync(`${HOST}-${process.ppid}`, path.join(s.claudeDir, 'SingletonLock'));
  assert.equal(s.run(), 'other-instance');
  assert.equal(s.read().isHardwareAccelerationAutoDisabled, true);
  assert.ok(!fs.existsSync(s.stateFile), 'state not consumed, so the next launch retries');
});

test('ignores a stale lock left by a dead process', () => {
  const s = sandbox(AUTO);
  const dead = spawnSync(process.execPath, ['-e', '0']).pid;
  fs.symlinkSync(`${HOST}-${dead}`, path.join(s.claudeDir, 'SingletonLock'));
  assert.equal(s.run(), 'undone');
});

test('ignores a lock from another host', () => {
  const s = sandbox(AUTO);
  fs.symlinkSync(`elsewhere-${process.ppid}`, path.join(s.claudeDir, 'SingletonLock'));
  assert.equal(s.run(), 'undone');
});

test('unreadable config: touches nothing and does not consume the session', () => {
  const s = sandbox(null, { raw: '{ not json' });
  assert.equal(s.run(), 'unreadable');
  assert.equal(fs.readFileSync(s.configFile, 'utf8'), '{ not json');
  assert.ok(!fs.existsSync(s.stateFile));

  const missing = sandbox({});
  fs.rmSync(missing.configFile);
  assert.equal(missing.run(), 'unreadable');
});
