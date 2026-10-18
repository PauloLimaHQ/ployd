/* Ployd — theme. No build step: native ES module. */
import { toast } from '../core/api.js';
import { $ } from '../core/state.js';
import { syncTerminalHost } from './terminal.js';
import { renderView } from './workspaces.js';


// ---------- theme ----------
// System / Light / Dark, chosen in Settings → General → Appearance (there's no
// top-bar toggle — the header is for board actions). It stays a device-local
// preference in localStorage rather than a db.json setting, so the desktop app
// and a phone paired over the LAN can differ; the same value is read by an
// inline <head> script so the first paint already matches. cycleTheme() backs
// the command palette entry and the Electron menu item.
const THEME_KEY = 'ployd.theme';
const THEME_CYCLE = ['system', 'light', 'dark'];
const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' };

// The OS preference, for resolving 'system' into data-scheme below. A context
// without matchMedia just counts as light.
const DARK_QUERY = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function currentTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch { return 'system'; }
}
// data-scheme is always the *resolved* light/dark, the OS preference
// included. The Paper tokens key off data-theme + the media query as before;
// the color themes key off data-scheme, so they need no media-query copies.
function syncScheme(mode = currentTheme()) {
  const dark = mode === 'dark' || (mode === 'system' && !!DARK_QUERY?.matches);
  document.documentElement.setAttribute('data-scheme', dark ? 'dark' : 'light');
}
function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') {
    document.documentElement.setAttribute('data-theme', mode);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  syncScheme(mode);
  try {
    if (mode === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch { /* storage unavailable — non-fatal */ }
  const select = $('#setting-theme');
  if (select) select.value = mode;
}
function cycleTheme() {
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(currentTheme()) + 1) % THEME_CYCLE.length];
  applyTheme(next);
  toast(`Theme: ${THEME_LABEL[next]}`, 'info');
}
function initTheme() {
  applyTheme(currentTheme());
  applyPalette(currentPalette());
  $('#setting-theme').addEventListener('change', (e) => applyTheme(e.target.value));
  $('#setting-palette').addEventListener('change', (e) => applyPalette(e.target.value));
  // Following the OS: re-resolve when it flips (no-op while light/dark is pinned).
  DARK_QUERY?.addEventListener('change', () => syncScheme());
}

// ---------- color theme (appearance) ----------
// Which tint the board wears, independent of light/dark: every palette has
// both halves, so "System" keeps following the OS whatever the colors are.
// Device-local in localStorage like the theme; the inline <head> script reads
// the same key so the first paint is already tinted. 'paper' is the original
// warm look and is the absence of data-palette, not a CSS block of its own.
const PALETTE_KEY = 'ployd.palette';
const DEFAULT_PALETTE = 'paper';
const PALETTES = ['paper', 'graphite', 'nord', 'solarized', 'rose-pine'];
const PALETTE_LABEL = { paper: 'Paper', graphite: 'Graphite', nord: 'Nord', solarized: 'Solarized', 'rose-pine': 'Rosé Pine' };

function currentPalette() {
  try {
    const stored = localStorage.getItem(PALETTE_KEY);
    return PALETTES.includes(stored) ? stored : DEFAULT_PALETTE;
  } catch { return DEFAULT_PALETTE; }
}
function applyPalette(name) {
  const palette = PALETTES.includes(name) ? name : DEFAULT_PALETTE;
  if (palette === DEFAULT_PALETTE) document.documentElement.removeAttribute('data-palette');
  else document.documentElement.setAttribute('data-palette', palette);
  try {
    if (palette === DEFAULT_PALETTE) localStorage.removeItem(PALETTE_KEY);
    else localStorage.setItem(PALETTE_KEY, palette);
  } catch { /* storage unavailable — non-fatal */ }
  const select = $('#setting-palette');
  if (select) select.value = palette;
}
function cyclePalette() {
  const next = PALETTES[(PALETTES.indexOf(currentPalette()) + 1) % PALETTES.length];
  applyPalette(next);
  toast(`Color theme: ${PALETTE_LABEL[next]}`, 'info');
}

// ---------- layout (appearance) ----------
// Two shells for the same board, chosen in Settings → General → Appearance:
// 'sidebar' — the default — is the integrated shell: a persistent project rail
// on the left, and a tabbed work area to its right where each open project and
// each shell session is a tab. 'classic' is the older shape, kept for anyone
// who prefers it: the Super View grid plus one repo's board, with a terminal
// docked at the bottom of the window. Device-local in localStorage like the
// theme, so the desktop app and a phone on the LAN can each pick their own —
// it never reaches db.json.
const LAYOUT_KEY = 'ployd.layout';
const LAYOUTS = ['sidebar', 'classic'];
const DEFAULT_LAYOUT = 'sidebar';
const LAYOUT_LABEL = { classic: 'Classic board', sidebar: 'Project sidebar' };

function currentLayout() {
  try {
    const stored = localStorage.getItem(LAYOUT_KEY);
    return LAYOUTS.includes(stored) ? stored : DEFAULT_LAYOUT;
  } catch { return DEFAULT_LAYOUT; }
}
function applyLayout(mode) {
  const layout = LAYOUTS.includes(mode) ? mode : DEFAULT_LAYOUT;
  document.body.dataset.layout = layout;
  try {
    // Always written, the default included: clearing the key would hand the
    // choice back to whatever the default happens to be in the next release.
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch { /* storage unavailable — non-fatal */ }
  const sidebar = $('#sidebar');
  sidebar.classList.toggle('hidden', layout !== 'sidebar');
  // Nothing of the rail survives the classic layout — drop the markup so a
  // stale list can't flash on the way back in.
  if (layout !== 'sidebar') sidebar.innerHTML = '';
  // Re-parent the terminal before rendering: which layout is on decides whether
  // the mount belongs to the docked panel or the work area, and renderView()
  // below is what decides whether it's the visible pane.
  syncTerminalHost();
  renderView();
  const select = $('#setting-layout');
  if (select) select.value = layout;
}
function toggleLayout() {
  const next = currentLayout() === 'sidebar' ? 'classic' : 'sidebar';
  applyLayout(next);
  toast(`Layout: ${LAYOUT_LABEL[next]}`, 'info');
}
function initLayout() {
  applyLayout(currentLayout());
  $('#setting-layout').addEventListener('change', (e) => applyLayout(e.target.value));
}

export {
  LAYOUT_LABEL, PALETTE_LABEL, THEME_LABEL, currentLayout, currentPalette, currentTheme, cyclePalette, cycleTheme,
  initLayout, initTheme, toggleLayout,
};
