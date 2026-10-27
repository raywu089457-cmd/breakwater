// ---------- Nexus（屍潮的蜂巢意識）：挑最弱又最值錢的目標 → 預警 → 發動屍潮；車隊會被伏擊、落單部隊會被獵殺 ----------
const NEXUS_WARN = 25;        // 預警時間（遊戲分鐘＝模擬秒）
const nexus = { t: 45, phase: 'idle', target: null, warnT: 0, attackT: 0, attacks: 0, history: [] };

const nearCount = (list, x, y, r) => list.filter((p) => Math.hypot(p.x - x, p.y - y) < r);
function defenseAt(x, y) {
  let d = 0;
  for (const u of nearCount(units, x, y, 90)) d += u.type === 'squad' ? u.men * 1.6 : u.type === 'tank' ? 8 : u.type === 'heli' ? 12 : u.type === 'transport' ? 2 : 0;
  for (const o of nearCount(outposts, x, y, 90)) if (o.stock > 0) d += OUTPOST_RATE;
  for (const n of nearCount(nests, x, y, 90)) d += NEST.rate;
  if (Math.hypot(x - fob.x, y - fob.y) < 140 && game.ciws && supply.stock > 0) d += CIWS_RATE;
  d += walls.filter((w) => Math.hypot((w.x0 + w.x1) / 2 - x, (w.y0 + w.y1) / 2 - y) < 60).length * 3;
  return d;
}
const districtOf = (x, y) => { const k = dmap[clamp(Math.floor(y / CELL), 0, NN - 1) * NN + clamp(Math.floor(x / CELL), 0, NN - 1)]; return k === 255 ? 0 : k; };
// 候選目標：值多少 ÷ 防守多強 × 附近屍潮多不多
function nexusCandidates() {
  const c = [];
  for (const d of shelters) if (d.pop > 0 && d.state !== 'evac' && d.state !== 'lost') c.push({ kind: 'shelter', name: d.name, x: d.sx, y: d.sy, value: 40 + d.pop / 60, ref: d });
  for (const o of outposts) c.push({ kind: 'outpost', name: o.name, x: o.x, y: o.y, value: 70 + o.stock / 5, ref: o });
  for (const u of units) {
    if (u.type === 'truck' && u.mission) c.push({ kind: 'convoy', name: `${UT.truck.name}車隊`, x: u.x, y: u.y, value: 90 + u.cargo * 3 + u.supplyLoad / 2, ref: u });
    else if ((u.type === 'squad' || u.type === 'tank') && Math.hypot(u.x - fob.x, u.y - fob.y) > 250) c.push({ kind: 'hunt', name: `落單的${UT[u.type].name}`, x: u.x, y: u.y, value: 55, ref: u });
  }
  c.push({ kind: 'base', name: '前進基地', x: fob.x, y: fob.y, value: 110 });
  c.push(...roadCandidates());
  for (const t of c) {
    const mass = sim.distCounts[districtOf(t.x, t.y)] || 0;
    t.defense = defenseAt(t.x, t.y);
    t.score = (t.value * (0.4 + Math.min(mass, 150000) / 60000)) / (1 + t.defense / 18) * (0.85 + Math.random() * 0.3);
  }
  return c.sort((a, b) => b.score - a.score);
}
// 目標會動（車隊、部隊）：跟著它；被消滅了就停在最後位置
function nexusPos() {
  const t = nexus.target;
  if (!t) return null;
  if ((t.kind === 'convoy' || t.kind === 'hunt') && units.includes(t.ref)) {
    const u = t.ref;
    // 伏擊：埋在車隊前方路上
    // 沿著卡車的路線往前走 35 m
    let x = u.x, y = u.y, left = t.kind === 'convoy' ? 35 : 0;
    for (const [wx, wy] of u.path) { const d = Math.hypot(wx - x, wy - y); if (d >= left) { x += ((wx - x) / d) * left; y += ((wy - y) / d) * left; left = 0; break; } x = wx; y = wy; left -= d; }
    t.x = x; t.y = y;
  }
  return t;
}
function updateNexus(sdt) {
  updateBlockades(sdt);
  if (nexus.phase === 'idle') {
    nexus.t -= sdt;
    if (nexus.t <= 0) {
      const best = nexusCandidates()[0];
      if (!best) { nexus.t = 20; return; }
      nexus.target = best; nexus.phase = 'warn'; nexus.warnT = NEXUS_WARN;
      const verb = { shelter: '圍攻避難所', outpost: '進攻前哨', convoy: '伏擊車隊', hunt: '獵殺', base: '總攻基地', road: '切斷道路：' }[best.kind];
      logEvent(`⚠ NEXUS 集結屍潮：${verb}${best.kind === 'road' ? '' : ' '}${best.name}，約 ${NEXUS_WARN} 分鐘後抵達`, 'bad');
    }
  } else if (nexus.phase === 'warn') {
    nexusPos();
    nexus.warnT -= sdt;
    if (nexus.warnT <= 0) {
      nexus.phase = 'attack'; nexus.attackT = 80 + nexus.attacks * 10;
      logEvent(`NEXUS 屍潮湧向 ${nexus.target.name}`, 'bad');
      if (nexus.target.kind === 'road') startBlockade(nexus.target);
    }
  } else if (nexus.phase === 'attack') {
    nexusPos();
    nexus.attackT -= sdt;
    if (nexus.attackT <= 0) {
      nexus.history.push({ name: nexus.target.name, kind: nexus.target.kind, at: clockText() });
      nexus.attacks++;
      nexus.phase = 'idle'; nexus.t = Math.max(25, 75 - nexus.attacks * 5) / REGION.nexus; nexus.target = null;
    }
  }
}
// 給模擬：預警時開始往目標聚（弱），發動後強力吸引
function nexusTargets() {
  const t = nexus.target, out = blockades.map((b) => [b.x, b.y, 10, BLOCK.w * REGION.nexus]);   // 封鎖點：屍群賴著不走
  if (!t) return out;
  if (nexus.phase === 'warn') out.push([t.x, t.y, 12, 160]);
  else out.push([t.x, t.y, 14, (330 + Math.min(nexus.attacks, 10) * 15) * REGION.nexus]);
  return out;
}
function nexusMarks(push) {
  for (const b of blockades) {
    push(b.x, b.y, BLOCK.r, 1, b.state === 'holding' ? [1, 0.12, 0.3] : [1, 0.45, 0.5], 0.45);
    push(b.x, b.y, BLOCK.r + BLOCK.pad, 0, [1, 0.12, 0.3], b.state === 'holding' ? 0.8 : 0.35);
  }
  const t = nexus.target;
  if (!t) return;
  const p = 0.5 + 0.5 * Math.sin(sim.time * (nexus.phase === 'attack' ? 9 : 4));
  push(t.x, t.y, 45, 1, [1, 0.15, 0.25], 0.4 + 0.6 * p);
  push(t.x, t.y, 70, 0, [1, 0.15, 0.25], 0.5);
}
function updateNexusUI() {
  const el = $('nexus'), t = nexus.target;
  placeBlockLabels();
  if (!t || nexus.phase === 'idle') {
    // 沒有進攻中，但還有被切斷的路：常駐提示
    const held = blockades.filter((b) => b.state === 'holding');
    if (!held.length) { el.style.display = 'none'; return; }
    el.style.display = ''; el.className = 'box block';
    el.innerHTML = `<b>NEXUS</b> 道路封鎖中：${held.map((b) => b.name).join('、')}　<span>屍群 ${held.map((b) => b.n).join(' / ')}</span>`;
    return;
  }
  el.style.display = '';
  el.className = 'box ' + nexus.phase;
  el.innerHTML = nexus.phase === 'warn'
    ? `<b>NEXUS</b> 屍潮集結中 → ${t.name}　<span>${Math.ceil(nexus.warnT)} 分鐘後抵達</span>`
    : `<b>NEXUS</b> 屍潮來襲：${t.name}　<span>剩 ${Math.ceil(nexus.attackT)} 分鐘</span>`;
}

// ---------- 切斷道路：Nexus 在卡車在跑的路線上（最好是橋）集結一團屍群賴著不走。
// 守住之後地面部隊會繞路（有別條路的話），把屍群打散到剩不到 BLOCK.clear 隻、撐 BLOCK.clearT 分鐘，路才通。----------
const BLOCK = { r: 22, hold: 150, clear: 50, clearT: 6, formT: 70, life: 240, max: 3, cost: 30, pad: 12, w: 150 };
const blockades = [];   // { id, slot, x, y, name, state: forming|holding, t, lowT, n }
let nextBlockId = 1;
const blockProbeBase = () => nestProbeBase() + NEST.max;
const tileW = (x, y) => (x < 0 || y < 0 || x >= WN || y >= WN ? T.BUILDING : map.t[Math.floor(y) * WN + Math.floor(x)]);
// 河上的橋：南北兩側不遠處都是水
function onBridge(x, y) {
  let n = false, s = false;
  for (let d = 8; d <= 24; d += 4) { if (tileW(x, y + d) === T.WATER) n = true; if (tileW(x, y - d) === T.WATER) s = true; }
  return n && s && tileW(x, y) !== T.WATER;
}
// 候選封鎖點：每條正在跑的卡車路線（基地 ↔ 前哨／避難所）取中段，挑防守弱的一點，橋加倍
function roadCandidates() {
  if (blockades.length >= BLOCK.max) return [];
  const routes = new Map();
  for (const u of units) {
    if (u.type !== 'truck' || !u.mission) continue;
    const m = u.mission;
    const dest = m.kind === 'supply' ? outposts.find((o) => o.id === m.o) : districts[m.d];
    if (!dest) continue;
    const key = m.kind + (m.o ?? m.d);
    const r = routes.get(key) || { dest, x: dest.x ?? dest.sx, y: dest.y ?? dest.sy, trucks: 0 };
    r.trucks++; routes.set(key, r);
  }
  const out = [];
  for (const r of routes.values()) {
    const path = findPath(fob.x, fob.y + 15, r.x, r.y);
    if (!path || !path.length) continue;
    // 沿路每 16 m 取樣
    const pts = []; let px = fob.x, py = fob.y + 15, acc = 0;
    for (const [wx, wy] of path) {
      const d = Math.hypot(wx - px, wy - py);
      for (let s = 16 - (acc % 16); s < d; s += 16) pts.push([px + ((wx - px) * s) / d, py + ((wy - py) * s) / d, acc + s]);
      acc += d; px = wx; py = wy;
    }
    let best = null;
    for (const [x, y, l] of pts) {
      if (l < acc * 0.3 || l > acc * 0.8) continue;
      if (blockades.some((b) => Math.hypot(b.x - x, b.y - y) < 80)) continue;
      if (Math.hypot(x - fob.x, y - fob.y) < 160) continue;   // 近防打得到的地方封不住
      const br = onBridge(x, y);
      const sc = ((br ? 2 : 1) / (1 + defenseAt(x, y) / 18)) * (0.9 + Math.random() * 0.2);
      if (!best || sc > best.sc) best = { x, y, sc, br };
    }
    if (!best) continue;
    const dn = r.dest.name;
    out.push({ kind: 'road', name: best.br ? `通往${dn}的橋` : `通往${dn}的道路`, x: best.x, y: best.y, value: (75 + r.trucks * 25) * (best.br ? 1.4 : 1) });
  }
  return out;
}
function startBlockade(t) {
  if (blockades.length >= BLOCK.max) return null;
  const used = new Set(blockades.map((b) => b.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  const b = { id: nextBlockId++, slot, x: t.x, y: t.y, name: t.name, state: 'forming', t: 0, lowT: 0, n: 0 };
  blockades.push(b);
  return b;
}
function blockProbes() {
  const out = [];
  for (let k = 0; k < BLOCK.max; k++) { const b = blockades.find((q) => q.slot === k); out.push(b ? [b.x, b.y, 0, BLOCK.r] : [-5000, -5000, 0, 0]); }
  return out;
}
// 守住的封鎖：範圍＋外圍 pad 的導航格加成本
function rebuildDanger() {
  pathDanger.fill(0);
  for (const b of blockades) {
    if (b.state !== 'holding') continue;
    const R = BLOCK.r + BLOCK.pad, c0 = Math.floor((b.x - R) / CELL), c1 = Math.floor((b.x + R) / CELL), r0 = Math.floor((b.y - R) / CELL), r1 = Math.floor((b.y + R) / CELL);
    for (let y = Math.max(0, r0); y <= Math.min(NN - 1, r1); y++) for (let x = Math.max(0, c0); x <= Math.min(NN - 1, c1); x++)
      if (Math.hypot((x + 0.5) * CELL - b.x, (y + 0.5) * CELL - b.y) < R) pathDanger[y * NN + x] += BLOCK.cost;
  }
}
// 剩下的路線會不會穿過封鎖區
function pathHits(u, b) {
  const R = BLOCK.r + BLOCK.pad;
  let px = u.x, py = u.y;
  for (const [wx, wy] of u.path) {
    const ax = wx - px, ay = wy - py, L2 = ax * ax + ay * ay || 1e-6;
    const t = clamp(((b.x - px) * ax + (b.y - py) * ay) / L2, 0, 1);
    if (Math.hypot(px + ax * t - b.x, py + ay * t - b.y) < R) return true;
    px = wx; py = wy;
  }
  return false;
}
// 路線穿過封鎖區的地面部隊：重新找路（有別條路就繞），回傳成功繞開的數量
function rerouteAround(b) {
  let n = 0;
  for (const u of units) {
    if (isAir(u) || !u.path.length || !pathHits(u, b)) continue;
    const p = pathFor(u, u.tx, u.ty);
    if (p) { u.path = p; if (!pathHits(u, b)) n++; }
  }
  return n;
}
function updateBlockades(sdt) {
  const P = sim.probe, b0 = blockProbeBase();
  let changed = false;
  for (let k = blockades.length - 1; k >= 0; k--) {
    const b = blockades[k];
    b.n = P[(b0 + b.slot) * 8];
    b.t += sdt;
    if (b.state === 'forming') {
      if (b.n >= BLOCK.hold) {
        b.state = 'holding'; b.t = 0;
        rebuildDanger();
        const n = rerouteAround(b);
        logEvent(`⛔ 道路被切斷：${b.name}${n ? `（${n} 支部隊改道）` : ''}`, 'bad');
      } else if (b.t > BLOCK.formT) { blockades.splice(k, 1); logEvent(`NEXUS 沒能封住 ${b.name}`, 'good'); }
    } else {
      b.lowT = b.n < BLOCK.clear ? b.lowT + sdt : 0;
      if (b.lowT >= BLOCK.clearT) { blockades.splice(k, 1); changed = true; logEvent(`道路已打通：${b.name}`, 'good'); }
      else if (b.t > BLOCK.life) { blockades.splice(k, 1); changed = true; logEvent(`屍群從 ${b.name} 散去，道路恢復通行`, 'good'); }
    }
  }
  if (changed) rebuildDanger();
}
// 封鎖點的地圖標籤（任何縮放都顯示）
const blabels = $('blabels');
function placeBlockLabels() {
  while (blabels.children.length < blockades.length) blabels.appendChild(document.createElement('div'));
  while (blabels.children.length > blockades.length) blabels.lastChild.remove();
  if (!blockades.length) return;
  const r = canvas.getBoundingClientRect();
  blockades.forEach((b, k) => {
    const el = blabels.children[k];
    const [x, y] = projectPx(b.x, b.y + BLOCK.r + BLOCK.pad, 0, r);
    el.className = 'bl ' + b.state;
    el.style.display = control ? 'none' : '';
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    el.textContent = b.state === 'holding' ? `⛔ 封鎖 · ${b.name} · 屍 ${b.n}` : `封鎖集結中 · ${b.name} · 屍 ${b.n}/${BLOCK.hold}`;
  });
}
