import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

import * as legacy from '../electron/legacy';
import type { Task } from '../server/types';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const writeDb = (userData: string, body = '{}') => {
  fs.mkdirSync(path.join(userData, 'data'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'data', 'db.json'), body);
};

test('legacy: the Sr. Popo userData folder replaces a Ployd folder that holds no board', () => {
  const root = tmp('ployd-legacy-ud-');
  const current = path.join(root, 'Ployd');
  const old = path.join(root, legacy.LEGACY_APP_NAME);
  writeDb(old, '{"repos":[1]}');
  fs.mkdirSync(path.join(current, 'data', 'logs'), { recursive: true }); // what a blocked launch leaves
  assert.deepStrictEqual(legacy.adoptUserData(current, old), { status: 'moved' });
  assert.strictEqual(fs.readFileSync(path.join(current, 'data', 'db.json'), 'utf8'), '{"repos":[1]}');
  assert.ok(!fs.existsSync(old), 'the legacy folder is gone');
});

test('legacy: nothing to adopt without a Sr. Popo folder; a Ployd board always wins', () => {
  const root = tmp('ployd-legacy-ud2-');
  const current = path.join(root, 'Ployd');
  const old = path.join(root, legacy.LEGACY_APP_NAME);
  assert.deepStrictEqual(legacy.adoptUserData(current, old), { status: 'none' });
  writeDb(current, 'ployd');
  writeDb(old, 'srpopo');
  assert.deepStrictEqual(legacy.adoptUserData(current, old), { status: 'leftover', legacy: old });
  assert.strictEqual(fs.readFileSync(path.join(current, 'data', 'db.json'), 'utf8'), 'ployd', 'Ployd data untouched');
});

test('legacy: a running Sr. Popo blocks the move instead of splitting the board', () => {
  const root = tmp('ployd-legacy-ud3-');
  const current = path.join(root, 'Ployd');
  const old = path.join(root, legacy.LEGACY_APP_NAME);
  writeDb(old);
  fs.symlinkSync(`${os.hostname()}-${process.pid}`, path.join(old, 'SingletonLock'));
  assert.strictEqual(legacy.adoptUserData(current, old).status, 'blocked');
  assert.ok(fs.existsSync(path.join(old, 'data', 'db.json')), 'nothing was moved');
});

test('legacy: worktrees move to the Ployd folder, tasks follow, and git still knows them', async () => {
  const home = tmp('ployd-legacy-wt-');
  const repo = path.join(home, 'repo');
  const oldDir = legacy.legacyWorktreesDir(home);
  const newDir = path.join(home, '.ployd', 'worktrees');
  const wt = path.join(oldDir, 'repo--fix-abc');
  fs.mkdirSync(oldDir, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', wt, '-b', 'srpopo/fix-abc']);

  const tasks = [{ worktreePath: wt }, { worktreePath: null }] as Task[];
  assert.strictEqual(await legacy.adoptWorktrees(tasks, oldDir, newDir), 1);
  const moved = path.join(newDir, 'repo--fix-abc');
  assert.strictEqual(tasks[0].worktreePath, moved);
  assert.ok(!fs.existsSync(path.join(home, '.srpopo')), 'the empty legacy folder is removed');
  const list = execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  assert.ok(list.includes(`worktree ${fs.realpathSync(moved)}`), 'the repo points at the new location');
  assert.ok(!list.includes('prunable'), 'the worktree is not orphaned');
});

test('legacy: leftovers lists only what exists and never the running app', () => {
  const home = tmp('ployd-legacy-left-');
  const cache = path.join(home, 'Library', 'Caches', 'srpopo-updater');
  const bundle = path.join(home, 'Applications', `${legacy.LEGACY_APP_NAME}.app`);
  fs.mkdirSync(cache, { recursive: true });
  fs.mkdirSync(bundle, { recursive: true });
  const exe = '/Applications/Ployd.app/Contents/MacOS/Ployd';
  assert.deepStrictEqual(legacy.leftovers('darwin', home, {}, exe), [bundle, cache]);
  const inside = path.join(bundle, 'Contents', 'MacOS', 'Ployd');
  assert.deepStrictEqual(legacy.leftovers('darwin', home, {}, inside), [cache]);
});
