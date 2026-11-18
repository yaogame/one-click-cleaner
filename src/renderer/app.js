'use strict';
/* global api */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v; else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};

const LEVEL = {
  safe: ['可清理', 'b-safe'], caution: ['谨慎', 'b-caution'], keep: ['建议保留', 'b-keep'], review: ['手动检查', 'b-review'], info: ['概览', 'b-info'],
};
const CAT_ORDER = ['AI 工具', '系统', '浏览器', '开发工具', '虚拟机 / 模拟器 / SDK', '照片 / 音乐 / iCloud', '设计 / 媒体', '通讯 / 应用', '应用缓存（自动发现）', '大目录（自动发现）', '空间集中的目录（深度扫描）', '大文件（深度扫描）', '项目依赖 / 构建产物（深度扫描）', '全盘空间去向', '主目录概览'];

const state = {
  info: null, items: new Map(), selected: new Set(), filter: 'all', query: '', open: new Map(), collapsed: new Set(['主目录概览']),
  scanning: false, cleaning: false, admin: true, scannedOnce: false,
};

function fmt(n) {
  if (!n) return '0 B';
  const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
}
function tilde(p) {
  const h = state.info?.home;
  if (!h || !p) return p;
  return p === h ? '~' : p.startsWith(h + (state.info.platform === 'win32' ? '\\' : '/')) ? '~' + p.slice(h.length) : p;
}
function toast(msg, ms = 4000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
const cleanable = (it) => (it.level === 'safe' || it.level === 'caution') && it.exists && (it.size > 0 || it.action === 'emptyTrash');
const fileMgr = () => (state.info?.platform === 'darwin' ? 'Finder' : '资源管理器');
const trashName = () => (state.info?.platform === 'darwin' ? '废纸篓' : '回收站');

// ------------------------------------------------------------------ 初始化
(async function init() {
  state.info = await api.info();
  const p = state.info.platform;
  document.body.classList.add(p === 'darwin' ? 'mac' : p === 'win32' ? 'win' : 'other');
  $('#platformLine').textContent = `${p === 'darwin' ? 'macOS' : p === 'win32' ? 'Windows' : p} · ${state.info.arch} · v${state.info.version}`;
  $('#optTrash').nextSibling.textContent = ` 移到${trashName()}（可恢复，但不会立即释放空间）`;
  refreshDisk();
  renderTools();

  $('#btnScan').onclick = scan; $('#btnScan2').onclick = scan;
  $('#btnDeep').onclick = deepScan;
  $('#btnClean').onclick = cleanSelected;
  for (const c of document.querySelectorAll('.chip')) c.onclick = () => { state.filter = c.dataset.f; document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c)); render(); };
  $('#search').oninput = (e) => { state.query = e.target.value.trim().toLowerCase(); render(); };
  for (const t of document.querySelectorAll('.tab')) t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    const tools = t.dataset.tab === 'tools';
    $('#tools').hidden = !tools; $('#list').hidden = tools; $('#filters').style.visibility = tools ? 'hidden' : '';
  };

  api.onScanItem((it) => { state.items.set(it.id, it); if (cleanable(it) && it.level === 'safe') state.selected.add(it.id); scheduleRender(); });
  api.onScanProgress((p) => progress(p.done / p.total, `正在统计 ${p.label}（${p.done}/${p.total}）`));
  api.onDeepProgress((p) => progress(null, `深度扫描：已检查 ${p.visited.toLocaleString()} 个文件，发现 ${p.bigFiles} 个大文件、${p.devDirs} 个依赖/构建目录 · ${tilde(p.label)}`));
  api.onCleanProgress((p) => progress(p.total ? p.done / p.total : 1, `正在清理 ${p.label}（${p.done}/${p.total}）`));
})();

async function refreshDisk() {
  const d = await api.diskUsage();
  if (!d) return;
  const used = d.total - d.free;
  $('#disk').innerHTML = '';
  $('#disk').append(
    el('div', { class: 'lbl' }, `磁盘可用 ${fmt(d.free)} / 共 ${fmt(d.total)}`),
    el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${(used / d.total * 100).toFixed(1)}%` })),
  );
}

function progress(frac, label) {
  const p = $('#progress');
  if (frac === false) { p.hidden = true; return; }
  p.hidden = false;
  $('#progressBar').style.width = frac == null ? '100%' : `${Math.round(frac * 100)}%`;
  $('#progressBar').style.opacity = frac == null ? '.5' : '1';
  $('#progressLabel').textContent = label;
}

let rTimer = null;
function scheduleRender() { if (rTimer) return; rTimer = setTimeout(() => { rTimer = null; render(); }, 120); }

// ------------------------------------------------------------------ 扫描
async function scan() {
  if (state.scanning) return;
  state.scanning = true; setBusy();
  for (const [id, it] of state.items) if (!/^[fphm]/.test(id)) state.items.delete(id);
  state.selected.clear(); state.open.clear();
  $('#toolbar').hidden = false;
  $('#summary').innerHTML = ''; $('#summary').append(el('h1', {}, '正在扫描…'), el('p', { class: 'muted' }, '正在统计各个目录的实际占用，主目录较大时需要一两分钟。'));
  const t0 = Date.now();
  try {
    const r = await api.scan();
    for (const it of r.items) state.items.set(it.id, it);
    state.admin = r.admin;
    state.scannedOnce = true;
    try { state.space = await api.spaceOverview(); state.disk = await api.diskUsage(); } catch { state.space = null; }
    progress(false);
    renderSummary((Date.now() - t0) / 1000);
    renderAdminBanner();
  } catch (e) {
    toast(`扫描失败：${e.message}`);
  } finally {
    state.scanning = false; setBusy(); render(); refreshDisk();
  }
}

async function deepScan() {
  if (state.scanning) { api.deepAbort(); return; }
  state.scanning = true; setBusy(true);
  $('#toolbar').hidden = false;
  if (!state.scannedOnce) { $('#summary').innerHTML = ''; $('#summary').append(el('h1', {}, '深度扫描中…'), el('p', { class: 'muted' }, '正在主目录中查找 ≥500 MiB 的大文件、node_modules、构建产物等。')); }
  for (const id of [...state.items.keys()]) if (/^[fphm]/.test(id)) { state.items.delete(id); state.selected.delete(id); }
  try {
    const r = await api.deepScan({ minFileMB: 500 });
    for (const it of r.items) state.items.set(it.id, it);
    state.collapsed.delete('大文件（深度扫描）'); state.collapsed.delete('项目依赖 / 构建产物（深度扫描）'); state.collapsed.delete('空间集中的目录（深度扫描）');
    toast(`深度扫描${r.aborted ? '已停止' : '完成'}：检查了 ${r.visited.toLocaleString()} 个文件，发现 ${r.items.length} 项`);
    if (state.scannedOnce) renderSummary(); else { $('#summary').innerHTML = ''; $('#summary').append(el('h2', {}, '深度扫描结果'), el('p', { class: 'muted' }, '点「扫描」可同时统计缓存、日志等常规项目。')); }
  } finally {
    progress(false); state.scanning = false; setBusy(); render();
  }
}

function setBusy(deep) {
  $('#btnScan').disabled = state.scanning || state.cleaning;
  $('#btnDeep').disabled = state.cleaning || (state.scanning && !deep && !$('#btnDeep').dataset.deep);
  $('#btnDeep').textContent = deep ? '停止深度扫描' : '深度扫描';
  if (deep) { $('#btnDeep').dataset.deep = '1'; $('#btnDeep').disabled = false; } else delete $('#btnDeep').dataset.deep;
  updateCleanBtn();
}

function updateCleanBtn() {
  let sum = 0; let n = 0;
  for (const id of state.selected) { const it = state.items.get(id); if (it) { sum += it.size; n++; } }
  const b = $('#btnClean');
  b.disabled = !n || state.scanning || state.cleaning;
  b.textContent = n ? `一键清理 ${fmt(sum)}（${n} 项）` : '一键清理';
}

// ------------------------------------------------------------------ 摘要（类似人工分析报告）
function renderSummary(secs) {
  const items = [...state.items.values()].filter((i) => i.exists);
  const sum = (f) => items.filter(f).reduce((a, b) => a + b.size, 0);
  const safe = sum((i) => i.level === 'safe');
  const caution = sum((i) => i.level === 'caution');
  const manual = sum((i) => i.level === 'review' && !i.dynamic) + sum((i) => i.level === 'keep');
  const s = $('#summary'); s.innerHTML = '';
  s.append(el('h1', {}, `可一键释放 ${fmt(safe)}`));
  s.append(el('div', { class: 'stats' },
    stat(fmt(safe), '可清理（默认已勾选）'), stat(fmt(caution), '谨慎项（需手动勾选）'), stat(fmt(manual), '建议保留 / 手动检查'),
    secs ? stat(`${secs.toFixed(0)} 秒`, '扫描耗时') : null));

  renderSpace(s, items);

  // AI 工具（Codex 等）专门的总结
  const home = items.filter((i) => i.cat === '主目录概览');
  const codexHome = home.find((i) => i.name === '.codex');
  const ai = items.filter((i) => i.cat === 'AI 工具' && i.size > 0).sort((a, b) => b.size - a.size);
  if (ai.length) {
    const codexParts = ai.filter((i) => i.name.startsWith('Codex'));
    let lead = '';
    const codexTotal = codexHome ? codexHome.size : codexParts.filter((i) => i.resolved.some((r) => /[\\/]\.codex[\\/]/.test(r))).reduce((a, b) => a + b.size, 0);
    if (codexTotal) {
      const biggest = codexParts.filter((i) => (i.resolved[0] || '').includes('.codex') && i.size > 0).sort((a, b) => b.size - a.size)[0];
      lead = `你的 ~/.codex 总计 ${fmt(codexTotal)}${biggest ? `，最大的部分是${biggest.name.replace('Codex ', '')}` : ''}。`;
    }
    const work = ai.find((i) => i.name === 'Codex 工作目录' && i.size > 1024 ** 3);
    if (work) lead += `另有一个 ${fmt(work.size)} 的工作目录，值得单独整理。`;
    s.append(el('h2', { style: 'margin-top:14px' }, 'AI 工具'));
    if (lead) s.append(el('p', {}, lead));
    s.append(table(ai.slice(0, 10)));
  }

  // 其它最大的项
  const others = items.filter((i) => i.cat !== 'AI 工具' && i.cat !== '主目录概览' && i.level !== 'info' && i.size > 100 * 2 ** 20 && !/^[hm]/.test(i.id)).sort((a, b) => b.size - a.size).slice(0, 10);
  if (others.length) { s.append(el('h2', { style: 'margin-top:14px' }, '占用最大的其它项目')); s.append(table(others)); }

  const dyn = items.filter((i) => i.cat === '应用缓存（自动发现）').sort((a, b) => b.size - a.size);
  const namedCaches = items.filter((i) => ['浏览器', '设计 / 媒体', '通讯 / 应用'].includes(i.cat) && i.size > 500 * 2 ** 20).sort((a, b) => b.size - a.size);
  if (dyn.length || namedCaches.length) {
    s.append(el('h2', { style: 'margin-top:14px' }, '如果还想多腾一些空间'));
    const parts = [];
    if (dyn[0]) parts.push(`你最大的单项应用缓存是 ${tilde(dyn[0].resolved[0])}，占 ${fmt(dyn[0].size)}。我只核实了大小，还没有确认里面是可重建的预览、模型还是离线资源。建议先点开看其子目录，优先使用应用自带的缓存清理功能。`);
    const rest = [...dyn.slice(1, 3), ...namedCaches.slice(0, 3)].sort((a, b) => b.size - a.size).slice(0, 3);
    if (rest.length) parts.push(`排在后面的还有 ${rest.map((r) => `${r.name} ${fmt(r.size)}`).join('、')}。`);
    s.append(el('p', {}, parts.join('')));
  }
  if (items.some((i) => i.denied)) {
    s.append(el('p', { class: 'muted' }, state.info.platform === 'darwin'
      ? '⚠︎ 部分目录没有读取权限，实际占用可能更大。可在「系统工具」中授予“完全磁盘访问权限”后重新扫描。'
      : '⚠︎ 部分目录没有读取权限，实际占用可能更大。可以管理员身份重新启动后再扫描。'));
  }
}
// 磁盘空间去向：把“已用”拆解到各个卷 / 顶层目录，剩下的就是快照、可清除空间或无权限的部分
function renderSpace(s, items) {
  const sp = state.space; const disk = state.disk;
  if (!sp || !disk || !sp.volumes.length) return;
  const used = disk.total - disk.free;
  const data = sp.volumes[0];
  const parts = items.filter((i) => i.cat === '全盘空间去向' && i.size > 0).sort((a, b) => b.size - a.size);
  const counted = parts.reduce((a, b) => a + b.size, 0);
  const rest = Math.max(0, data.used - counted);
  const others = sp.volumes.slice(1).filter((v) => v.used > 256 * 2 ** 20);
  const otherVolUsed = others.reduce((a, b) => a + b.used, 0);
  const containerRest = Math.max(0, used - data.used - otherVolUsed);
  s.append(el('h2', { style: 'margin-top:14px' }, `磁盘空间去向：已用 ${fmt(used)} / 共 ${fmt(disk.total)}`));
  const segs = [...parts.map((p) => ({ label: p.name, size: p.size })), { label: '未统计', size: rest, dim: true }, ...others.map((v) => ({ label: v.name, size: v.used, sys: true }))];
  const bar = el('div', { class: 'stack' });
  const palette = ['#2f6bff', '#18a058', '#e3a23a', '#9a5bd0', '#d64541', '#3aa7c9', '#8a6d3b'];
  segs.forEach((g, i) => {
    if (g.size / used < 0.004) return;
    bar.append(el('i', { title: `${g.label} ${fmt(g.size)}`, style: `width:${(g.size / used * 100).toFixed(2)}%;background:${g.dim ? 'var(--line)' : g.sys ? 'var(--info)' : palette[i % palette.length]}` }));
  });
  s.append(bar);
  const rows = [
    ...parts.map((p) => el('tr', {},
      el('td', {}, el('a', { onclick: () => jumpTo(p.id) }, p.name), p.denied ? el('span', { class: 'badge b-perm', style: 'margin-left:6px' }, '部分无权限') : null),
      el('td', { class: 'size' }, fmt(p.size)), el('td', {}, p.note || ''))),
    el('tr', {}, el('td', {}, '未统计到的部分'), el('td', { class: 'size' }, fmt(rest)), el('td', {}, restNote(rest))),
    ...others.map((v) => el('tr', {}, el('td', {}, v.name), el('td', { class: 'size' }, fmt(v.used)), el('td', {}, '系统管理，无法直接清理。'))),
  ];
  if (containerRest > 2 ** 30) rows.push(el('tr', {}, el('td', {}, '其他卷（Recovery 等）'), el('td', { class: 'size' }, fmt(containerRest)), el('td', {}, '系统恢复分区等。')));
  s.append(el('table', {}, el('tr', {}, el('th', {}, '位置'), el('th', {}, '占用'), el('th', {}, '说明')), rows));
  const home = items.filter((i) => i.cat === '主目录概览').sort((a, b) => b.size - a.size).slice(0, 12);
  if (home.length) {
    s.append(el('p', { style: 'margin-top:10px' }, '主目录里占用最大的：',
      ...home.map((h, k) => el('span', {}, k ? '、' : '', el('a', { onclick: () => jumpTo(h.id) }, `~/${h.name}`), ` ${fmt(h.size)}`))));
  }
}
function restNote(rest) {
  const sp = state.space; const tips = [];
  if (state.info.platform === 'darwin') {
    if (sp.snapshots.length) tips.push(`有 ${sp.snapshots.length} 个 Time Machine 本地快照，它们占用的空间算在这里（系统工具 → 清理本地快照）`);
    if ([...state.items.values()].some((i) => i.denied)) tips.push('有目录因缺少“完全磁盘访问权限”没统计到（系统工具 → 授予权限后重新扫描）');
    tips.push('其余是 APFS 可清除空间、其他用户的文件和系统数据库');
  } else {
    tips.push('包括无权限读取的目录、卷影副本（系统还原点）和其他用户的文件；以管理员身份运行可统计更多');
  }
  return (rest > 20 * 2 ** 30 ? '偏大：' : '') + tips.join('；') + '。';
}
function stat(v, l) { return el('div', { class: 'stat' }, el('b', {}, v), el('span', {}, l)); }
function table(rows) {
  return el('table', {},
    el('tr', {}, el('th', {}, '目录'), el('th', {}, '实测占用'), el('th', {}, '建议')),
    rows.map((r) => el('tr', {},
      el('td', {}, el('a', { onclick: () => jumpTo(r.id) }, r.resolved.length > 1 ? `${r.name}` : tilde(r.resolved[0]) || r.name), ' ', badge(r.level)),
      el('td', { class: 'size' }, fmt(r.size)),
      el('td', {}, r.note || ''))));
}
function badge(level) { const [t, c] = LEVEL[level] || [level, '']; return el('span', { class: `badge ${c}` }, t); }

function jumpTo(id) {
  const it = state.items.get(id); if (!it) return;
  state.collapsed.delete(it.cat); state.filter = 'all'; state.query = ''; $('#search').value = '';
  document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.f === 'all'));
  if (!state.open.has(id)) toggleOpen(it, false);
  render();
  requestAnimationFrame(() => { const r = document.getElementById(`row-${id}`); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
}

function renderAdminBanner() {
  const b = $('#admin');
  const needAdmin = state.info.platform === 'win32' && !state.admin && [...state.items.values()].some((i) => i.admin && i.exists);
  b.hidden = !needAdmin; b.innerHTML = '';
  if (needAdmin) b.append(el('span', {}, '部分系统目录（Windows\\Temp、更新缓存等）需要管理员权限才能清理。'), el('button', { class: 'btn sm', onclick: () => api.relaunchAdmin() }, '以管理员身份重新启动'));
}

// ------------------------------------------------------------------ 列表
function visible(it) {
  if (state.filter !== 'all' && it.level !== state.filter) return false;
  if (state.query) {
    const hay = `${it.name} ${it.resolved.join(' ')} ${it.note || ''}`.toLowerCase();
    if (!hay.includes(state.query)) return false;
  }
  return true;
}

function render() {
  updateCleanBtn();
  const list = $('#list');
  const scrollY = window.scrollY;
  list.innerHTML = '';
  const groups = new Map();
  for (const it of state.items.values()) {
    if (!visible(it)) continue;
    if (!groups.has(it.cat)) groups.set(it.cat, []);
    groups.get(it.cat).push(it);
  }
  const cats = [...groups.keys()].sort((a, b) => (CAT_ORDER.indexOf(a) + 99) % 99 - (CAT_ORDER.indexOf(b) + 99) % 99);
  const maxSize = Math.max(1, ...[...state.items.values()].filter((i) => i.cat !== '主目录概览').map((i) => i.size));
  for (const cat of cats) {
    const rows = groups.get(cat).sort((a, b) => (b.exists - a.exists) || (b.size - a.size));
    const present = rows.filter((r) => r.exists && (r.size > 0 || r.action));
    const absent = rows.length - present.length;
    const selectable = present.filter(cleanable);
    const catSel = selectable.filter((r) => state.selected.has(r.id));
    const total = present.filter((r) => r.level !== 'info' || cat === '主目录概览').reduce((a, b) => a + b.size, 0);
    const box = el('input', { type: 'checkbox', title: '全选本类可清理项', onclick: (e) => {
      e.stopPropagation();
      const on = e.target.checked;
      for (const r of selectable) { if (on) { if (r.level === 'safe' || cat.includes('深度')) state.selected.add(r.id); } else state.selected.delete(r.id); }
      render();
    } });
    box.checked = selectable.length > 0 && catSel.length === selectable.length;
    box.indeterminate = catSel.length > 0 && catSel.length < selectable.length;
    box.disabled = !selectable.length;
    const section = el('section', { class: `cat${state.collapsed.has(cat) ? ' collapsed' : ''}` },
      el('div', { class: 'cat-h', onclick: () => { state.collapsed.has(cat) ? state.collapsed.delete(cat) : state.collapsed.add(cat); render(); } },
        el('span', { class: 'caret' }, '▾'), box, el('span', { class: 'name' }, cat),
        el('span', { class: 'muted' }, `${present.length} 项${absent ? `（另有 ${absent} 项未安装/为空）` : ''}`),
        el('span', { class: 'tot' }, catSel.length ? el('span', {}, '已选 ', el('b', {}, fmt(catSel.reduce((a, b) => a + b.size, 0))), ' / ') : '', fmt(total))),
      el('div', { class: 'rows' }, present.map((r) => row(r, maxSize)), absent && state.query ? rows.filter((r) => !present.includes(r)).map((r) => row(r, maxSize)) : null));
    list.append(section);
  }
  window.scrollTo(0, scrollY);
}

function row(it, maxSize) {
  const can = cleanable(it);
  const cb = el('input', { type: 'checkbox', onclick: (e) => { e.stopPropagation(); e.target.checked ? state.selected.add(it.id) : state.selected.delete(it.id); render(); } });
  cb.checked = state.selected.has(it.id); cb.disabled = !can;
  cb.title = can ? (it.level === 'caution' ? '谨慎项：确认后再勾选' : '勾选后参与一键清理') : '此项只展示，不参与一键清理，请点开手动处理';
  const paths = it.resolved.length ? it.resolved : it.patterns;
  const nm = el('div', { class: 'nm' }, it.name, badge(it.level),
    it.running.length ? el('span', { class: 'badge b-run', title: '请先退出这些应用再清理' }, `运行中：${it.running.join(', ')}`) : null,
    it.denied ? el('span', { class: 'badge b-perm', title: state.info.platform === 'darwin' ? '需要完全磁盘访问权限，统计可能偏小' : '需要管理员权限，统计可能偏小' }, '权限不足') : null,
    it.admin && state.info.platform === 'win32' && !state.admin ? el('span', { class: 'badge b-perm' }, '需管理员') : null);
  const r = el('div', { class: `row${it.exists ? '' : ' empty'}`, id: `row-${it.id}` },
    el('div', { class: 'row-main', onclick: () => toggleOpen(it) },
      cb,
      el('div', {}, nm, el('div', { class: 'pth mono', title: paths.join('\n') }, paths.slice(0, 2).map(tilde).join('  ·  ') + (paths.length > 2 ? `  · 等 ${paths.length} 处` : '')), it.note ? el('div', { class: 'note' }, it.note) : null),
      el('div', {}, el('div', { class: 'sz' }, it.exists ? fmt(it.size) : '—'), el('div', { class: 'meter' }, el('i', { style: `width:${Math.min(100, it.size / maxSize * 100).toFixed(1)}%` }))),
      el('div', { class: 'ops' },
        it.resolved[0] ? el('button', { class: 'btn sm', title: `在${fileMgr()}中显示`, onclick: (e) => { e.stopPropagation(); api.reveal(it.resolved[0]); } }, '打开') : null,
        el('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); toggleOpen(it); } }, state.open.has(it.id) ? '收起' : '目录'))));
  if (state.open.has(it.id)) r.append(browser(it));
  return r;
}

// ------------------------------------------------------------------ 目录浏览
function toggleOpen(it, rerender = true) {
  if (state.open.has(it.id)) state.open.delete(it.id);
  else {
    const root = it.resolved[0];
    state.open.set(it.id, { root, cwd: root, data: null, loading: false });
    loadDir(it.id);
  }
  if (rerender) render();
}

async function loadDir(id) {
  const o = state.open.get(id); if (!o || !o.cwd) return;
  o.loading = true; o.data = null; render();
  const res = await api.listDir(o.cwd);
  if (state.open.get(id) !== o) return;
  o.loading = false; o.data = res; render();
}

function browser(it) {
  const o = state.open.get(it.id);
  const box = el('div', { class: 'browser' });
  if (!it.resolved.length) { box.append(el('div', { class: 'muted' }, '此位置不存在或为空。')); return box; }
  if (it.action === 'emptyTrash' && o.data && o.data.denied) {
    box.append(el('div', { class: 'muted' }, `没有权限读取${trashName()}内容，但仍可以清空。`));
  }
  if (it.resolved.length > 1) {
    box.append(el('div', { class: 'roots' }, it.resolved.map((p) => el('button', { class: `chip${o.root === p ? ' active' : ''}`, onclick: () => { o.root = p; o.cwd = p; loadDir(it.id); } }, tilde(p)))));
  }
  // 面包屑：从当前根到 cwd
  const sep = state.info.platform === 'win32' ? '\\' : '/';
  const rel = o.cwd.slice(o.root.length).split(/[\\/]/).filter(Boolean);
  const crumbs = el('div', { class: 'crumbs' }, el('a', { onclick: () => { o.cwd = o.root; loadDir(it.id); } }, tilde(o.root)));
  let acc = o.root;
  for (const seg of rel) {
    acc = acc + (acc.endsWith(sep) ? '' : sep) + seg;
    const target = acc;
    crumbs.append(el('span', { class: 'muted' }, '›'), el('a', { onclick: () => { o.cwd = target; loadDir(it.id); } }, seg));
  }
  crumbs.append(el('span', { style: 'flex:1' }), el('button', { class: 'btn sm', onclick: () => api.openPath(o.cwd) }, `在${fileMgr()}中打开`));
  box.append(crumbs);

  if (o.loading) { box.append(el('div', { class: 'muted' }, '正在统计子目录大小…')); return box; }
  if (!o.data) return box;
  if (o.data.error && !o.data.items.length) {
    // 不是目录（单个文件）或无权限
    box.append(el('div', { class: 'muted' }, o.data.denied ? (state.info.platform === 'darwin' ? '没有读取权限：请在「系统工具」中授予完全磁盘访问权限。' : '没有读取权限：请以管理员身份运行。') : '这是一个文件。'),
      el('div', { style: 'margin-top:6px' }, el('button', { class: 'btn sm', onclick: () => api.reveal(o.cwd) }, `在${fileMgr()}中显示`)));
    return box;
  }
  const items = o.data.items;
  if (!items.length) { box.append(el('div', { class: 'muted' }, '空目录。')); return box; }
  const max = Math.max(1, items[0].size);
  const total = items.reduce((a, b) => a + b.size, 0);
  box.append(el('div', { class: 'muted', style: 'margin-bottom:4px;font-size:12px' }, `${items.length} 项，共 ${fmt(total)}，按大小排序${o.data.denied ? '（部分无权限）' : ''}`));
  for (const c of items.slice(0, 300)) {
    box.append(el('div', { class: 'ent' },
      el('span', {}, c.isDir ? '📁' : '📄'),
      el('span', { class: `n${c.isDir ? ' dir' : ''}`, title: c.path, onclick: c.isDir ? () => { o.cwd = c.path; loadDir(it.id); } : null }, c.name),
      el('span', { class: 's' }, fmt(c.size)),
      el('span', { class: 'd' }, c.mtime ? new Date(c.mtime).toLocaleDateString() : ''),
      el('span', { class: 'o' },
        el('button', { class: 'btn sm', onclick: () => api.reveal(c.path) }, '显示'),
        el('button', { class: 'btn sm danger', onclick: async () => {
          if (!(await api.confirm(`把“${c.name}”移到${trashName()}？`, `${c.path}\n${fmt(c.size)}\n\n移到${trashName()}后，需要清空${trashName()}才会真正释放空间。`))) return;
          const r = await api.trashPath(c.path);
          if (r.ok) { toast(`已移到${trashName()}：${c.name}`); loadDir(it.id); } else toast(`失败：${r.error}`);
        } }, `移到${trashName()}`)),
      el('span', { class: 'bar' }, el('i', { style: `width:${(c.size / max * 100).toFixed(1)}%` }))));
  }
  if (items.length > 300) box.append(el('div', { class: 'muted' }, `… 还有 ${items.length - 300} 项，请在${fileMgr()}中查看`));
  return box;
}

// ------------------------------------------------------------------ 清理
async function cleanSelected() {
  const items = [...state.selected].map((id) => state.items.get(id)).filter(Boolean);
  if (!items.length) return;
  const total = items.reduce((a, b) => a + b.size, 0);
  const running = [...new Set(items.flatMap((i) => i.running))];
  const caution = items.filter((i) => i.level === 'caution');
  const useTrash = $('#optTrash').checked;
  const detail = [
    `将清理 ${items.length} 项，预计释放 ${fmt(total)}。`,
    useTrash ? `文件会移到${trashName()}，清空${trashName()}后才会释放空间。` : '文件将被直接删除，无法恢复。',
    running.length ? `\n⚠︎ 以下应用仍在运行，建议先退出：${running.join('、')}` : '',
    caution.length ? `\n包含 ${caution.length} 个谨慎项：${caution.slice(0, 6).map((c) => c.name).join('、')}${caution.length > 6 ? ' 等' : ''}` : '',
    '\n' + items.slice(0, 12).map((i) => `• ${i.name}  ${fmt(i.size)}`).join('\n') + (items.length > 12 ? `\n… 等 ${items.length} 项` : ''),
  ].join('\n');
  if (!(await api.confirm('确定要清理选中的项目吗？', detail))) return;
  state.cleaning = true; setBusy();
  try {
    const res = await api.clean(items.map((i) => i.id), { trash: useTrash });
    let freed = 0; let errs = 0;
    for (const r of res) {
      freed += r.freed; errs += r.errorCount;
      const it = state.items.get(r.id); if (it) { it.size = r.after; it.lastErrors = r.errors; }
      state.selected.delete(r.id);
    }
    toast(`清理完成，释放 ${fmt(freed)}${errs ? `\n${errs} 个文件被占用或无权限，已跳过（退出相关应用后可再试）` : ''}`, 7000);
  } catch (e) {
    toast(`清理出错：${e.message}`);
  } finally {
    progress(false); state.cleaning = false; setBusy(); render(); refreshDisk();
    if (state.scannedOnce) renderSummary();
  }
}

// ------------------------------------------------------------------ 系统工具
function renderTools() {
  const box = $('#tools'); box.innerHTML = '';
  box.append(el('p', { class: 'muted' }, '这些是系统或开发工具自带的清理命令，比直接删除文件更安全。'));
  const grid = el('div', { class: 'toolgrid' });
  for (const t of state.info.tools) {
    const out = el('pre', { hidden: true });
    const btn = el('button', { class: 'btn sm', onclick: async () => {
      btn.disabled = true; btn.textContent = '运行中…'; out.hidden = false; out.textContent = '…';
      const r = await api.runTool(t.id);
      out.textContent = r.out || (r.ok ? '完成' : '失败');
      btn.disabled = false; btn.textContent = '运行'; refreshDisk();
    } }, '运行');
    grid.append(el('div', { class: 'tool' }, el('div', { class: 'tn' }, t.name, t.admin ? el('span', { class: 'badge b-perm', style: 'margin-left:6px' }, '管理员') : null), el('div', { class: 'td' }, t.desc), el('div', {}, btn), out));
  }
  box.append(grid);
}
