'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { execFile, spawn } = require('child_process');
const { getTargets, discoverySources, tools } = require('./targets');

const PLATFORM = process.platform;
const TPLAT = process.env.CLEANER_TARGETS || PLATFORM; // 仅开发调试用：在 Linux 上模拟 mac/win 的目标列表
const IS_WIN = PLATFORM === 'win32';
const IS_MAC = PLATFORM === 'darwin';
const HOME = os.homedir();

let win;
const scanned = new Map(); // id -> item（最近一次扫描结果，清理时只认这里的路径）

// ------------------------------------------------------------------ 路径工具
function expandVars(p) {
  let s = p;
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = HOME + s.slice(1);
  s = s.replace(/%([^%]+)%/g, (m, name) => {
    const key = Object.keys(process.env).find((k) => k.toLowerCase() === name.toLowerCase());
    if (key) return process.env[key];
    if (name.toLowerCase() === 'localappdata') return path.join(HOME, 'AppData', 'Local');
    if (name.toLowerCase() === 'appdata') return path.join(HOME, 'AppData', 'Roaming');
    return m;
  });
  return path.normalize(s);
}

function globToRegex(seg) {
  const esc = seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, IS_WIN || IS_MAC ? 'i' : '');
}

async function exists(p) {
  try { await fsp.lstat(p); return true; } catch { return false; }
}

// 支持任意段中的 * 通配符
async function expandGlob(pattern) {
  const p = expandVars(pattern);
  if (/%[^%]+%/.test(p)) return []; // 环境变量不存在
  if (!p.includes('*') && !p.includes('?')) return (await exists(p)) ? [p] : [];
  const parsed = path.parse(p);
  const segs = p.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let bases = [parsed.root];
  for (const seg of segs) {
    const next = [];
    if (seg.includes('*') || seg.includes('?')) {
      const re = globToRegex(seg);
      for (const b of bases) {
        let ents = [];
        try { ents = await fsp.readdir(b); } catch { continue; }
        for (const e of ents) if (re.test(e)) next.push(path.join(b, e));
      }
    } else {
      for (const b of bases) {
        const c = path.join(b, seg);
        if (await exists(c)) next.push(c);
      }
    }
    bases = next;
    if (!bases.length) break;
  }
  return bases;
}

async function resolvePaths(patterns) {
  const out = new Set();
  for (const pat of patterns) for (const r of await expandGlob(pat)) out.add(r);
  // 去掉被其它路径包含的子路径，避免重复统计
  const arr = [...out].sort();
  return arr.filter((p, i) => !arr.some((q, j) => j !== i && isInside(p, q)));
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// ------------------------------------------------------------------ 安全护栏
const PROTECTED = new Set(
  [
    '/', HOME, path.join(HOME, 'Library'), path.join(HOME, 'Library', 'Application Support'),
    path.join(HOME, 'Library', 'Containers'), path.join(HOME, 'Library', 'Group Containers'),
    path.join(HOME, 'Documents'), path.join(HOME, 'Desktop'), path.join(HOME, 'Pictures'),
    path.join(HOME, 'Movies'), path.join(HOME, 'Music'), path.join(HOME, 'Downloads'),
    path.join(HOME, 'AppData'), path.join(HOME, 'AppData', 'Local'), path.join(HOME, 'AppData', 'Roaming'),
    '/System', '/Library', '/Applications', '/Users', '/usr', '/bin', '/private', '/var',
    'C:\\', 'C:\\Windows', 'C:\\Windows\\System32', 'C:\\Program Files', 'C:\\Program Files (x86)',
    'C:\\ProgramData', 'C:\\Users',
    process.env.SystemRoot, process.env.ProgramData, process.env.LOCALAPPDATA, process.env.APPDATA,
  ].filter(Boolean).map((p) => norm(p))
);
function norm(p) {
  let s = path.resolve(p);
  if (s.length > 1 && (s.endsWith('/') || s.endsWith('\\')) && !/^[A-Za-z]:\\$/.test(s)) s = s.slice(0, -1);
  return IS_WIN || IS_MAC ? s.toLowerCase() : s;
}
function assertDeletable(p) {
  const n = norm(p);
  if (PROTECTED.has(n)) throw new Error(`受保护的路径，拒绝删除：${p}`);
  const depth = path.resolve(p).split(/[\\/]+/).filter(Boolean).length;
  if (depth < 3) throw new Error(`路径层级过浅，拒绝删除：${p}`);
}

// ------------------------------------------------------------------ 大小统计
// 一个简单的并发限制器
function limiter(n) {
  let active = 0; const q = [];
  const next = () => { if (active >= n || !q.length) return; active++; const { fn, res, rej } = q.shift(); fn().then(res, rej).finally(() => { active--; next(); }); };
  return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
}
const ioLimit = limiter(64);
const duLimit = limiter(6);

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// Unix：用 du（实际占用的磁盘块）。返回 { size, denied }
async function duSizes(paths) {
  if (!paths.length) return { size: 0, denied: false };
  const r = await duLimit(() => run('du', ['-sk', '--', ...paths]));
  let size = 0;
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^(\d+)\s/);
    if (m) size += Number(m[1]) * 1024;
  }
  return { size, denied: /Operation not permitted|Permission denied/.test(r.stderr) };
}

// Windows（以及兜底）：自己遍历
async function walkSize(p, state = { denied: false, files: 0 }) {
  let st;
  try { st = await ioLimit(() => fsp.lstat(p)); } catch (e) { if (e.code === 'EPERM' || e.code === 'EACCES') state.denied = true; return 0; }
  if (st.isSymbolicLink()) return 0; // 不跟随符号链接 / 目录联接
  if (!st.isDirectory()) { state.files++; return st.size; }
  let ents;
  try { ents = await ioLimit(() => fsp.readdir(p, { withFileTypes: true })); } catch (e) { if (e.code === 'EPERM' || e.code === 'EACCES') state.denied = true; return 0; }
  const sizes = await Promise.all(ents.map((e) => walkSize(path.join(p, e.name), state)));
  return sizes.reduce((a, b) => a + b, 0);
}

async function sizeOf(paths) {
  if (!IS_WIN) return duSizes(paths);
  const state = { denied: false, files: 0 };
  let size = 0;
  for (const p of paths) size += await walkSize(p, state);
  return { size, denied: state.denied };
}

// 列出目录的直接子项及大小
async function childSizes(dir, includeHidden = true) {
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return { items: [], denied: e.code === 'EPERM' || e.code === 'EACCES', error: e.message }; }
  if (!includeHidden) ents = ents.filter((e) => !e.name.startsWith('.'));
  let denied = false;
  let items;
  if (!IS_WIN) {
    const r = await duLimit(() => run('du', ['-k', '-d', '1', '-a', '--', dir]));
    denied = /Operation not permitted|Permission denied/.test(r.stderr);
    const map = new Map();
    for (const line of r.stdout.split('\n')) {
      const m = line.match(/^(\d+)\s+(.*)$/);
      if (m) map.set(path.normalize(m[2]), Number(m[1]) * 1024);
    }
    items = ents.map((e) => ({ name: e.name, path: path.join(dir, e.name), isDir: e.isDirectory(), isLink: e.isSymbolicLink(), size: map.get(path.join(dir, e.name)) || 0 }));
  } else {
    items = await Promise.all(ents.map(async (e) => {
      const p = path.join(dir, e.name);
      const st = { denied: false, files: 0 };
      const size = await walkSize(p, st);
      if (st.denied) denied = true;
      return { name: e.name, path: p, isDir: e.isDirectory(), isLink: e.isSymbolicLink(), size };
    }));
  }
  for (const it of items) {
    try { it.mtime = (await fsp.lstat(it.path)).mtimeMs; } catch { /* ignore */ }
  }
  items.sort((a, b) => b.size - a.size);
  return { items, denied };
}

// ------------------------------------------------------------------ 进程检测
async function runningApps() {
  const names = new Set();
  if (IS_WIN) {
    const r = await run('tasklist', ['/fo', 'csv', '/nh']);
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)"/);
      if (m) names.add(m[1].replace(/\.exe$/i, '').toLowerCase());
    }
  } else {
    const r = await run('ps', ['-axo', 'comm=']);
    for (const line of r.stdout.split('\n')) {
      const s = line.trim(); if (!s) continue;
      names.add(path.basename(s).toLowerCase());
      const m = s.match(/\/([^/]+)\.app\//); if (m) names.add(m[1].toLowerCase());
    }
  }
  return names;
}

async function isAdmin() {
  if (!IS_WIN) return process.getuid && process.getuid() === 0;
  const r = await run('net', ['session']);
  return r.code === 0;
}

// ------------------------------------------------------------------ 扫描
function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

async function scan() {
  scanned.clear();
  const targets = getTargets(TPLAT);
  const sources = discoverySources(TPLAT);
  const total = targets.length + sources.length;
  let done = 0;
  const tick = (label) => send('scan-progress', { done: ++done, total, label });

  // 收集所有静态目标的路径，用于自动发现时去重
  const claimed = [];
  const resolvedTargets = await Promise.all(targets.map(async (t) => ({ t, paths: await resolvePaths(t.paths) })));
  for (const { t, paths } of resolvedTargets) if (t.level !== 'info') claimed.push(...paths);
  // dedupe：目标目录里包含其它目标时，只取未被其它目标覆盖的子项，避免重复统计
  for (const rt of resolvedTargets) {
    if (!rt.t.dedupe) continue;
    const others = resolvedTargets.filter((x) => x !== rt).flatMap((x) => x.paths);
    const out = [];
    for (const p of rt.paths) {
      if (!others.some((o) => isInside(o, p))) { out.push(p); continue; }
      let ents = [];
      try { ents = await fsp.readdir(p); } catch { continue; }
      for (const e of ents) {
        const c = path.join(p, e);
        if (!others.some((o) => norm(o) === norm(c) || isInside(c, o) || isInside(o, c))) out.push(c);
      }
    }
    rt.paths = out;
    if (rt.t.mode === 'contents') rt.t = { ...rt.t, mode: 'mixed' };
  }

  const results = [];
  const tasks = [];
  for (const { t, paths } of resolvedTargets) {
    tasks.push((async () => {
      const item = { ...t, resolved: paths, exists: paths.length > 0, size: 0, denied: false };
      if (paths.length) {
        const r = await sizeOf(paths);
        item.size = r.size; item.denied = r.denied;
      } else if (t.action === 'emptyTrash' && IS_MAC) {
        item.denied = true;
      }
      if (t.action === 'emptyTrash' && IS_MAC && !item.size) {
        // 没有完全磁盘访问权限时 ~/.Trash 读不到，仍然允许通过 Finder 清空
        item.exists = true; item.resolved = [expandVars('~/.Trash')];
      }
      scanned.set(item.id, item);
      results.push(item);
      send('scan-item', publicItem(item));
      tick(t.name);
    })());
  }

  let dynId = 0;
  for (const src of sources) {
    tasks.push((async () => {
      const dir = expandVars(src.dir);
      const { items, denied } = await childSizes(dir, src.includeHidden !== false);
      if (src.totalName) {
        const item = { id: `d${dynId++}`, cat: '全盘空间去向', name: src.totalName, paths: [dir], resolved: [dir], exists: true, size: items.reduce((a, b) => a + (b.isLink ? 0 : b.size), 0), level: 'info', note: '主目录总占用（含隐藏目录和 ~/Library）。点开逐层查看。', mode: 'contents', dynamic: true, denied, space: 'home' };
        scanned.set(item.id, item); results.push(item); send('scan-item', publicItem(item));
      }
      for (const c of items) {
        if (c.size < src.min || c.isLink) continue;
        if (src.exclude && src.exclude.includes(c.name)) continue;
        // 已被具体目标覆盖的路径跳过（主目录概览除外，它只用于定位）
        if (src.cat !== '主目录概览' && claimed.some((p) => norm(p) === norm(c.path) || isInside(c.path, p))) continue;
        const item = {
          id: `d${dynId++}`, cat: src.cat, name: prettyName(c.name), paths: [c.path], resolved: [c.path], exists: true,
          size: c.size, level: src.level, note: src.note, mode: c.isDir ? 'contents' : 'whole', dynamic: true, denied,
        };
        scanned.set(item.id, item);
        results.push(item);
        send('scan-item', publicItem(item));
      }
      tick(src.dir);
    })());
  }
  await Promise.all(tasks);

  const running = await runningApps();
  for (const it of results) {
    it.running = (it.apps || []).filter((a) => running.has(a.toLowerCase()));
  }
  return { items: results.map(publicItem), admin: await isAdmin() };
}

function prettyName(n) { return n; }

function publicItem(it) {
  return {
    id: it.id, cat: it.cat, name: it.name, level: it.level, note: it.note, size: it.size, exists: it.exists,
    resolved: it.resolved, patterns: it.paths, mode: it.mode, denied: it.denied, fda: !!it.fda, admin: !!it.admin,
    running: it.running || [], action: it.action || null, dynamic: !!it.dynamic, dedupe: !!it.dedupe, space: it.space || null,
  };
}

// ------------------------------------------------------------------ 深度扫描：大文件 + 项目依赖
const DEV_DIRS = new Set(['node_modules', '.next', '.nuxt', '.turbo', '.parcel-cache', '.gradle', 'Pods', 'DerivedData', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', 'target', 'build', 'dist', '.dart_tool', '.angular', '.svelte-kit', '.expo']);
const DEV_NEEDS_SIBLING = { target: ['Cargo.toml', 'pom.xml'], build: ['build.gradle', 'build.gradle.kts', 'CMakeLists.txt', 'pubspec.yaml', 'package.json'], dist: ['package.json'], venv: ['requirements.txt', 'pyproject.toml', 'setup.py'], '.venv': [] };
let deepAbort = false;

async function deepScan(opts) {
  deepAbort = false;
  const minFile = (opts && opts.minFileMB ? opts.minFileMB : 500) * 2 ** 20;
  const libMinFile = 1024 * 2 ** 20; // ~/Library 里只报告 ≥1 GiB 的文件，减少噪音
  const LIB = norm(path.join(HOME, 'Library'));
  const roots = (opts && opts.roots && opts.roots.length) ? opts.roots : [HOME, ...(IS_MAC ? ['/Users/Shared'] : []), ...(IS_WIN ? ['C:\\Users\\Public'] : [])];
  const skip = new Set([path.join(HOME, '.Trash'), '/System', '/private/var/vm'].map(norm));
  const BUNDLE = /\.(photoslibrary|musiclibrary|tvlibrary|fcpbundle|logicx|band|imovielibrary|aplibrary|lrlibrary)$/i;
  const bigFiles = []; const devDirs = []; const bundles = []; const dirStats = [];
  let visited = 0; let lastSend = 0;
  const allocated = (st) => (st.blocks != null && !IS_WIN ? st.blocks * 512 : st.size);
  // 返回该目录的总占用；同时记录 ≥1 GiB 的目录，用于找出“空间集中”的位置
  const walk = async (dir, depth, inLib) => {
    if (deepAbort || depth > 20) return 0;
    if (skip.has(norm(dir))) return 0;
    let ents;
    try { ents = await ioLimit(() => fsp.readdir(dir, { withFileTypes: true })); } catch { return 0; }
    const names = new Set(ents.map((e) => e.name));
    const subs = [];
    let files = 0;
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name === '.git') continue;
        if (BUNDLE.test(e.name)) { bundles.push({ path: p }); continue; }
        if (!inLib && DEV_DIRS.has(e.name)) {
          const need = DEV_NEEDS_SIBLING[e.name];
          if (!need || need.length === 0 || need.some((n) => names.has(n))) { devDirs.push({ path: p, kind: e.name, parent: dir }); continue; }
        }
        subs.push(p);
      } else if (e.isFile()) {
        visited++;
        try {
          const st = await ioLimit(() => fsp.lstat(p));
          const sz = allocated(st);
          files += sz;
          if (st.size >= (inLib ? libMinFile : minFile)) bigFiles.push({ path: p, size: sz, mtime: st.mtimeMs });
        } catch { /* ignore */ }
      }
    }
    if (Date.now() - lastSend > 300) { lastSend = Date.now(); send('deep-progress', { visited, label: dir, bigFiles: bigFiles.length, devDirs: devDirs.length }); }
    const childSizes = await Promise.all(subs.map((s) => walk(s, depth + 1, inLib || norm(s) === LIB)));
    const total = files + childSizes.reduce((a, b) => a + b, 0);
    if (total >= 2 ** 30) dirStats.push({ path: dir, size: total, maxChild: Math.max(0, ...childSizes), files });
    return total;
  };
  for (const r of roots) { const rp = expandVars(r); if (await exists(rp)) await walk(rp, 0, norm(rp) === LIB); }

  // 媒体库等“包”整体统计
  await Promise.all(bundles.map(async (b) => { b.size = (await sizeOf([b.path])).size; }));

  // 计算依赖/构建目录大小
  let i = 0;
  await Promise.all(devDirs.map(async (d) => {
    const r = await sizeOf([d.path]);
    d.size = r.size;
    if (++i % 10 === 0) send('deep-progress', { visited, label: `统计 ${d.path}`, bigFiles: bigFiles.length, devDirs: devDirs.length });
  }));

  const items = [];
  bigFiles.sort((a, b) => b.size - a.size).forEach((f, k) => {
    const item = { id: `f${k}`, cat: '大文件（深度扫描）', name: path.basename(f.path), paths: [f.path], resolved: [f.path], exists: true, size: f.size, level: 'review', mode: 'whole', note: `最后修改：${new Date(f.mtime).toLocaleDateString()}。确认不需要后再删除（会移到废纸篓/回收站）。`, dynamic: true, trashOnly: true };
    scanned.set(item.id, item); items.push(publicItem(item));
  });
  devDirs.filter((d) => d.size >= 20 * 2 ** 20).sort((a, b) => b.size - a.size).forEach((d, k) => {
    const item = { id: `p${k}`, cat: '项目依赖 / 构建产物（深度扫描）', name: `${path.basename(d.parent)} / ${d.kind}`, paths: [d.path], resolved: [d.path], exists: true, size: d.size, level: 'caution', mode: 'whole', note: d.kind === 'node_modules' ? '依赖目录，删除后在项目里重新 npm/pnpm install 即可。' : '构建产物或缓存，可重新生成。仍在开发的项目建议保留。', dynamic: true };
    scanned.set(item.id, item); items.push(publicItem(item));
  });
  // 空间集中点：≥2 GiB，且没有哪个子目录占到它的 60% 以上（否则应该往下看子目录）
  const homeN = norm(HOME);
  const hot = dirStats
    .filter((d) => d.size >= 2 * 2 ** 30 && d.maxChild < d.size * 0.6 && norm(d.path) !== homeN)
    .sort((a, b) => b.size - a.size).slice(0, 40);
  hot.forEach((d, k) => {
    const item = { id: `h${k}`, cat: '空间集中的目录（深度扫描）', name: path.basename(d.path), paths: [d.path], resolved: [d.path], exists: true, size: d.size, level: 'review', mode: 'contents', note: d.files > d.size * 0.5 ? '大部分空间是这个目录里直接存放的文件，点开按大小排序检查。' : '空间分散在多个子目录中，点开逐层查看。', dynamic: true };
    scanned.set(item.id, item); items.push(publicItem(item));
  });
  bundles.filter((b) => b.size >= 2 ** 30).sort((a, b) => b.size - a.size).forEach((b, k) => {
    const item = { id: `m${k}`, cat: '空间集中的目录（深度扫描）', name: path.basename(b.path), paths: [b.path], resolved: [b.path], exists: true, size: b.size, level: 'review', mode: 'whole', note: /photoslibrary/i.test(b.path) ? '照片图库。可在“照片 → 设置 → iCloud”开启“优化 Mac 储存空间”，不要直接删除里面的文件。' : '媒体库/工程包，请在对应应用内管理。', dynamic: true };
    scanned.set(item.id, item); items.push(publicItem(item));
  });
  return { items, visited, aborted: deepAbort };
}

// ------------------------------------------------------------------ 清理
async function removePath(p, useTrash) {
  assertDeletable(p);
  if (useTrash) { await shell.trashItem(p); return; }
  await fsp.rm(p, { recursive: true, force: true, maxRetries: 2 });
}

async function cleanItem(item, useTrash) {
  const errors = [];
  if (item.action === 'emptyTrash') {
    if (IS_MAC) {
      const r = await run('osascript', ['-e', 'tell application "Finder" to empty trash']);
      if (r.code !== 0) {
        // 退回到直接删除
        try { for (const e of await fsp.readdir(expandVars('~/.Trash'))) await fsp.rm(path.join(expandVars('~/.Trash'), e), { recursive: true, force: true }); } catch (e) { errors.push(`清空废纸篓失败：${r.stderr || e.message}`); }
      }
    } else if (IS_WIN) {
      const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue']);
      if (r.code !== 0 && r.stderr) errors.push(r.stderr.trim());
    }
    return errors;
  }
  const trash = useTrash || item.trashOnly;
  for (const p of item.resolved) {
    let st;
    try { st = await fsp.lstat(p); } catch { continue; }
    if ((item.mode === 'contents' || item.mode === 'mixed') && st.isDirectory()) {
      let ents = [];
      try { ents = await fsp.readdir(p); } catch (e) { errors.push(`${p}: ${e.code || e.message}`); continue; }
      for (const e of ents) {
        try { await removePath(path.join(p, e), trash); } catch (err) { errors.push(`${path.join(p, e)}: ${err.code || err.message}`); }
      }
    } else {
      try { await removePath(p, trash); } catch (err) { errors.push(`${p}: ${err.code || err.message}`); }
    }
  }
  return errors;
}

async function clean(ids, opts) {
  const out = [];
  let k = 0;
  for (const id of ids) {
    const item = scanned.get(id);
    if (!item) continue;
    if (!['safe', 'caution'].includes(item.level) && item.action !== 'emptyTrash') continue; // 只清理可清理级别
    send('clean-progress', { done: k, total: ids.length, label: item.name });
    const before = item.size;
    const errors = await cleanItem(item, !!(opts && opts.trash));
    const after = item.resolved.length ? (await sizeOf(item.resolved.filter((p) => fs.existsSync(p)))).size : 0;
    item.size = after;
    out.push({ id, freed: Math.max(0, before - after), after, errors: errors.slice(0, 50), errorCount: errors.length });
    k++;
  }
  send('clean-progress', { done: k, total: ids.length, label: '完成' });
  return out;
}

// ------------------------------------------------------------------ IPC
ipcMain.handle('info', async () => ({
  platform: PLATFORM, home: HOME, arch: process.arch, version: app.getVersion(),
  tools: tools(TPLAT).map(({ id, name, desc, admin }) => ({ id, name, desc, admin: !!admin })),
}));
ipcMain.handle('scan', () => scan());
ipcMain.handle('deep-scan', (e, opts) => deepScan(opts));
ipcMain.handle('deep-abort', () => { deepAbort = true; });
ipcMain.handle('list-dir', (e, dir) => childSizes(dir, true));
ipcMain.handle('reveal', (e, p) => { if (fs.existsSync(p)) shell.showItemInFolder(p); else shell.openPath(path.dirname(p)); });
ipcMain.handle('open-path', (e, p) => shell.openPath(p));
ipcMain.handle('trash-path', async (e, p) => {
  try { assertDeletable(p); await shell.trashItem(p); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('clean', (e, ids, opts) => clean(ids, opts));
ipcMain.handle('space-overview', async () => {
  const vol = async (name, mp) => {
    try { const st = await fsp.statfs(mp); return { name, mount: mp, used: (st.blocks - st.bfree) * st.bsize }; } catch { return null; }
  };
  const out = { volumes: [], snapshots: [] };
  if (IS_MAC) {
    out.volumes = (await Promise.all([
      vol('数据卷（你的文件、应用、缓存）', '/System/Volumes/Data'), vol('macOS 系统卷（只读，不可清理）', '/'),
      vol('虚拟内存 / 交换文件', '/System/Volumes/VM'), vol('Preboot（启动与系统更新）', '/System/Volumes/Preboot'),
      vol('系统更新暂存', '/System/Volumes/Update'),
    ])).filter(Boolean);
    const r = await run('tmutil', ['listlocalsnapshots', '/']);
    out.snapshots = r.stdout.split('\n').filter((l) => /com\.apple/.test(l)).map((l) => l.trim());
  } else if (IS_WIN) {
    const root = path.parse(HOME).root;
    out.volumes = [await vol(`系统盘 ${root}`, root)].filter(Boolean);
  } else {
    out.volumes = [await vol('根分区', '/')].filter(Boolean);
  }
  return out;
});
ipcMain.handle('disk-usage', async () => {
  try {
    const root = IS_WIN ? path.parse(HOME).root : '/';
    const s = await fsp.statfs(IS_MAC ? '/System/Volumes/Data' : root);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch { return null; }
});
ipcMain.handle('confirm', async (e, msg, detail) => {
  const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['取消', '确定清理'], defaultId: 1, cancelId: 0, message: msg, detail });
  return r.response === 1;
});
ipcMain.handle('run-tool', async (e, id) => {
  const t = tools(TPLAT).find((x) => x.id === id);
  if (!t) return { ok: false, out: '未知工具' };
  if (t.open) { await shell.openExternal(t.open); return { ok: true, out: '已打开' }; }
  if (t.admin) {
    // Windows：以管理员身份打开一个命令窗口执行，执行完保留窗口方便查看
    const ps = `Start-Process -FilePath cmd.exe -ArgumentList '/k ${t.admin.replace(/'/g, "''")}' -Verb RunAs`;
    const r = await run('powershell.exe', ['-NoProfile', '-Command', ps]);
    return { ok: r.code === 0, out: r.code === 0 ? '已在管理员窗口中启动，请在新窗口查看进度。' : (r.stderr || '已取消') };
  }
  if (t.detached) {
    spawn('cmd.exe', ['/c', t.cmd], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    return { ok: true, out: '已启动' };
  }
  const r = IS_WIN ? await run('cmd.exe', ['/c', t.cmd], { timeout: 30 * 60 * 1000 }) : await run('/bin/bash', ['-lc', t.cmd], { timeout: 30 * 60 * 1000 });
  return { ok: r.code === 0, out: (r.stdout + '\n' + r.stderr).trim().slice(-4000) || (r.code === 0 ? '完成' : `退出码 ${r.code}`) };
});
ipcMain.handle('relaunch-admin', async () => {
  if (IS_WIN) {
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    const r = await run('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -Verb RunAs`]);
    if (r.code === 0) app.quit();
    return r.code === 0;
  }
  return false;
});

// ------------------------------------------------------------------ 窗口
function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 900, minHeight: 600,
    title: '一键清理助手',
    backgroundColor: '#111316',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
