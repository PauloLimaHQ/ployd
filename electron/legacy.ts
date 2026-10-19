// One-time migration from the app's previous name, "Sr. Popo" (bundle id
// com.pauloperego.srpopo). Ployd ships under a new name AND a new id, so to the
// OS it is a different app: nothing the old install left behind is picked up on
// its own. The first launch of Ployd adopts what matters — the userData folder
// (db.json, task logs, the board's localStorage) and the task worktrees — and
// clears away the rest, so no "Sr. Popo" is kept around afterwards.
//
// Deliberately free of `electron` imports: main.ts hands in the paths and the
// trash function, which is what lets the smoke suite drive all of it.
import { execFile, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import type { Task } from '../server/types';

export const LEGACY_APP_NAME = 'Sr. Popo';
const LEGACY_APP_ID = 'com.pauloperego.srpopo';
const LEGACY_PACKAGE_NAME = 'srpopo';

const hasDb = (dir: string) => fs.existsSync(path.join(dir, 'data', 'db.json'));

export const legacyWorktreesDir = (home: string) => path.join(home, `.${LEGACY_PACKAGE_NAME}`, 'worktrees');

// Is an Electron app holding this userData folder right now? Chromium keeps a
// `SingletonLock` symlink in it pointing at "<hostname>-<pid>" (macOS/Linux).
// Windows has no such link; there the folder rename itself fails while the old
// app has files open, which adoptUserData reports the same way.
export function instanceRunning(userData: string): boolean {
  let target: string;
  try {
    target = fs.readlinkSync(path.join(userData, 'SingletonLock'));
  } catch {
    return false;
  }
  const pid = Number(target.slice(target.lastIndexOf('-') + 1));
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export type UserDataOutcome =
  | { status: 'none' }
  | { status: 'moved' }
  // The old app is still open (or its folder could not be moved): this launch
  // must not start on either folder. Retried on the next launch.
  | { status: 'blocked'; reason: string }
  // Both folders hold a board. The Ployd one is in use, so it wins; the legacy
  // folder is returned for main.ts to move to the Trash.
  | { status: 'leftover'; legacy: string };

// Must run before anything touches `current` (the single-instance lock and the
// server's store both write into it). Synchronous for the same reason.
export function adoptUserData(current: string, legacy: string): UserDataOutcome {
  if (!fs.existsSync(legacy)) return { status: 'none' };
  if (hasDb(current)) return { status: 'leftover', legacy };
  if (!hasDb(legacy)) return { status: 'leftover', legacy };
  if (instanceRunning(legacy)) return { status: 'blocked', reason: `${LEGACY_APP_NAME} is still running.` };
  if (instanceRunning(current)) return { status: 'blocked', reason: 'Another Ployd window is starting.' };
  try {
    // A Ployd folder without a db.json holds no board — at most the empty
    // shell a previous, blocked launch left behind — so the legacy one replaces it.
    fs.rmSync(current, { recursive: true, force: true });
    fs.renameSync(legacy, current);
    return { status: 'moved' };
  } catch (err) {
    return { status: 'blocked', reason: (err as Error).message };
  }
}

function git(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 30000 }, () => resolve());
  });
}

// Sr. Popo created worktrees under ~/.srpopo/worktrees; Ployd uses
// ~/.ployd/worktrees. Each one is moved across, the tasks pointing at it are
// rewritten, and `git worktree repair` (run inside the moved worktree) fixes the
// link its repository keeps to it. A name that already exists in the new folder
// is left where it is, so no checkout is ever overwritten. Returns how many
// tasks changed, for the caller to decide whether to save.
export async function adoptWorktrees(tasks: Task[], legacyDir: string, targetDir: string): Promise<number> {
  if (!fs.existsSync(legacyDir)) return 0;
  fs.mkdirSync(targetDir, { recursive: true });
  const moved = new Map<string, string>();
  for (const name of fs.readdirSync(legacyDir)) {
    const from = path.join(legacyDir, name);
    const to = path.join(targetDir, name);
    if (fs.existsSync(to)) continue;
    try {
      fs.renameSync(from, to);
      moved.set(from, to);
    } catch { /* busy or cross-device: stays where it is, still usable */ }
  }
  for (const to of moved.values()) await git(to, ['worktree', 'repair']);

  let changed = 0;
  for (const t of tasks) {
    if (!t.worktreePath) continue;
    const to = moved.get(path.resolve(t.worktreePath));
    if (to) {
      t.worktreePath = to;
      changed += 1;
    }
  }
  // Drop the old folders once they are empty: ~/.srpopo/worktrees, then ~/.srpopo.
  for (const dir of [legacyDir, path.dirname(legacyDir)]) {
    try { fs.rmdirSync(dir); } catch { /* not empty — something stayed behind */ }
  }
  return changed;
}

// What else an old install leaves on disk: the app bundle itself, the update
// cache electron-updater keys by package name, and the files macOS keys by
// bundle id. Only paths that exist are returned, and never one that contains the
// running executable (in case the new build was copied over the old bundle).
export function leftovers(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv, exe: string): string[] {
  const out: string[] = [];
  if (platform === 'darwin') {
    const lib = path.join(home, 'Library');
    out.push(
      path.join('/Applications', `${LEGACY_APP_NAME}.app`),
      path.join(home, 'Applications', `${LEGACY_APP_NAME}.app`),
      path.join(lib, 'Caches', `${LEGACY_PACKAGE_NAME}-updater`),
      path.join(lib, 'Caches', LEGACY_APP_ID),
      path.join(lib, 'Caches', `${LEGACY_APP_ID}.ShipIt`),
      path.join(lib, 'HTTPStorages', LEGACY_APP_ID),
      path.join(lib, 'Preferences', `${LEGACY_APP_ID}.plist`),
      path.join(lib, 'Saved Application State', `${LEGACY_APP_ID}.savedState`),
      path.join(lib, 'Logs', LEGACY_APP_NAME),
    );
  } else if (platform === 'win32') {
    if (env.LOCALAPPDATA) out.push(path.join(env.LOCALAPPDATA, `${LEGACY_PACKAGE_NAME}-updater`));
  } else {
    out.push(path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), `${LEGACY_PACKAGE_NAME}-updater`));
  }
  const self = path.resolve(exe);
  return out.filter((p) => fs.existsSync(p) && !self.startsWith(path.resolve(p) + path.sep));
}

// Windows keeps the old install registered under its own uninstaller, which
// is the only clean way to remove it (Start menu entry, Apps & features row).
// The NSIS build installed per user into %LOCALAPPDATA%\Programs; run its
// uninstaller silently if it is still in either default location.
export function uninstallWindows(env: NodeJS.ProcessEnv): boolean {
  if (!env.LOCALAPPDATA) return false;
  const programs = path.join(env.LOCALAPPDATA, 'Programs');
  for (const dir of [LEGACY_PACKAGE_NAME, LEGACY_APP_NAME]) {
    const uninstaller = path.join(programs, dir, `Uninstall ${LEGACY_APP_NAME}.exe`);
    if (!fs.existsSync(uninstaller)) continue;
    try {
      spawn(uninstaller, ['/S'], { detached: true, stdio: 'ignore' }).unref();
      return true;
    } catch { /* leave it for the user to remove */ }
  }
  return false;
}
