// ---------- 部隊：步兵班、戰車、攻擊直升機 —— 尋路、交戰、被咬、選取、指令、TAB 直接操控 ----------
const UT = {
  squad: { name: '步兵班', speed: 4.2, range: 42, rate: 1.6, contact: 4.0, bite: 3.2, ring: 7 },
  tank: { name: '戰車', speed: 9, range: 55, rate: 6, contact: 5.5, bite: 0.3, hp: 2000, reload: 4.5, ring: 8 },
  heli: { name: '攻擊直升機', speed: 26, range: 30, rate: 12, contact: 4.5, hp: 100, ring: 9 },
  truck: { name: '卡車', speed: 10, range: 0, rate: 0, contact: 4, bite: 0.35, hp: 900, cap: 30, ring: 7, load: 6 },
  transport: { name: '運輸直升機', speed: 24, range: 18, rate: 3, contact: 4.5, hp: 100, cap: 12, ring: 9, load: 4 },
};
const USLOTS = 20;                 // 同時最多 20 個單位（殺傷區 1 + 2×20 ≤ MAX_ZONES）
const slots = new Array(USLOTS).fill(null);
const units = [];
const sel = new Set();
let control = null;                // 直接操控中的單位
const aim = { x: 0, y: 0, firing: false, sx: -1, sy: -1 };
const tracers = [];                // 曳光彈：[x0, y0, z0, x1, y1, z1, 剩餘秒]
let nextUnitId = 1;
const HELI_ALTS = [40, 15, 6];
const isAir = (u) => u.type === 'heli' || u.type === 'transport';
const isCarrier = (u) => u.type === 'truck' || u.type === 'transport';

function spawnUnit(type, x, y) {
  const s = slots.indexOf(null);
  if (s < 0) return null;
  const t = UT[type];
  const u = { id: nextUnitId++, type, slot: s, x, y, z: type === 'heli' || type === 'transport' ? 40 : 0, tx: x, ty: y, tz: 40, path: [], vx: 0, vy: 0,
    face: Math.PI / 2, dir: 4, hp: t.hp || 0, men: type === 'squad' ? 8 : 0, dmg: 0, fireT: 0, firing: false, aimX: x, aimY: y + 10,
    walk: 0, hang: 0, reach: 0, crowd: 0, flash: 0, danger: false, kills: 0, cargo: 0, supplyLoad: 0, mission: null, phase: null, squeeze: 1, stuck: 0, bestD: null };
  slots[s] = u; units.push(u);
  return u;
}
function removeUnit(u) {
  if (!u.cargoLogged) logEvent(`${UT[u.type].name} 被摧毀`, 'bad');   // 載著人被打下來的另外報（cargoLost）
  slots[u.slot] = null;
  units.splice(units.indexOf(u), 1);
  sel.delete(u.id);
  if (control === u) control = null;
}
const unitById = (id) => units.find((u) => u.id === id);

// ----- 尋路（4 m 導航格 A*，部隊不能穿牆） -----
let unitBlock = new Uint8Array(NN * NN);
function rebuildUnitBlock() {
  for (let ny = 0; ny < NN; ny++) for (let nx = 0; nx < NN; nx++) {
    let hard = 0, wall = 0;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const v = map.t[(ny * CELL + y) * WN + nx * CELL + x];
      if (v === T.BUILDING || v === T.WATER) hard++; else if (v === T.WALL) wall++;
    }
    unitBlock[ny * NN + nx] = hard >= 6 || wall > 0 ? 1 : 0;
  }
  rebuildClearance();
}
rebuildUnitBlock();
const nIdx = (x, y) => clamp(Math.floor(y / CELL), 0, NN - 1) * NN + clamp(Math.floor(x / CELL), 0, NN - 1);
const blockedW = (x, y) => x < 0 || y < 0 || x >= WN || y >= WN || unitBlock[nIdx(x, y)] === 1;
function nearestOpen(i) {
  if (!unitBlock[i]) return i;
  const cx = i % NN, cy = (i / NN) | 0;
  for (let r = 1; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = cx + dx, y = cy + dy;
    if (x >= 0 && y >= 0 && x < NN && y < NN && !unitBlock[y * NN + x]) return y * NN + x;
  }
  return -1;
}
const gScore = new Float32Array(NN * NN), came = new Int32Array(NN * NN), closed = new Uint8Array(NN * NN);
// 危險格（Nexus 封鎖的路段）：每格多算這麼多步，有別條路就繞，沒有才硬闖（10-nexus 的 rebuildDanger 填）
const pathDanger = new Float32Array(NN * NN);
// r＝單位半徑：太窄（淨空不夠）的格子當成走不過；這樣找不到路才退回不管寬度
function findPath(sx, sy, tx, ty, r = 0) {
  const s = nearestOpen(nIdx(sx, sy)), t = nearestOpen(nIdx(tx, ty));
  if (s < 0 || t < 0) return null;
  const narrow = r * 0.9;
  gScore.fill(Infinity); closed.fill(0);
  const tX = t % NN, tY = (t / NN) | 0;
  const h = (i) => { const dx = Math.abs((i % NN) - tX), dy = Math.abs(((i / NN) | 0) - tY); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  const heap = [];   // [f, i]
  const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], end = heap.pop(); if (heap.length) { heap[0] = end; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  gScore[s] = 0; came[s] = -1; push(h(s), s);
  let found = false, guard = 0;
  while (heap.length && guard++ < 200000) {
    const [, i] = pop();
    if (closed[i]) continue;
    if (i === t) { found = true; break; }
    closed[i] = 1;
    const x = i % NN, y = (i / NN) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= NN || ny >= NN) continue;
      const j = ny * NN + nx;
      if (unitBlock[j] || closed[j]) continue;
      if (narrow > 0 && j !== t && cellClr[j] < narrow) continue;
      if (dx && dy && (unitBlock[y * NN + nx] || unitBlock[ny * NN + x])) continue;
      const g = gScore[i] + (dx && dy ? 1.414 : 1) + pathDanger[j];
      if (g < gScore[j]) { gScore[j] = g; came[j] = i; push(g + h(j), j); }
    }
  }
  if (!found) return r > 0 ? findPath(sx, sy, tx, ty, 0) : null;
  const cells = [];
  for (let i = t; i !== -1; i = came[i]) cells.push(i);
  cells.reverse();
  // 拉直：從目前點往後找最遠看得到的格子（路徑點＝格子裡最空曠的點；直線上每一點都要站得下這個半徑）
  const pt = (i) => [cellPt[i * 2], cellPt[i * 2 + 1]];
  const need = Math.min(narrow, 2.5);
  const los = (a, b) => {
    const [ax, ay] = pt(a), [bx, by] = pt(b);
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 1);
    for (let k = 1; k < n; k++) { const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n; if (blockedW(x, y) || clearAt(x, y) < need || pathDanger[nIdx(x, y)] > 0) return false; }
    return true;
  };
  const out = [];
  let k = 0;
  while (k < cells.length - 1) {
    let j = cells.length - 1;
    while (j > k + 1 && !los(cells[k], cells[j])) j--;
    out.push(pt(cells[j])); k = j;
  }
  if (out.length) out[out.length - 1] = r > 0 ? nearestClear(tx, ty, r) : [tx, ty];   // 終點在建築邊上就挪到站得下的地方
  return out;
}
const pathFor = (u, x, y) => findPath(u.x, u.y, x, y, UR[u.type]);

// ----- 指令 -----
function orderMove(x, y, ids = [...sel]) {
  const list = ids.map(unitById).filter(Boolean);
  const cols = Math.ceil(Math.sqrt(list.length));
  list.forEach((u, k) => {
    const ox = ((k % cols) - (cols - 1) / 2) * 12, oy = (Math.floor(k / cols) - (Math.ceil(list.length / cols) - 1) / 2) * 12;
    const gx = clamp(x + ox, 2, WN - 2), gy = clamp(y + oy, 2, WN - 2);
    u.tx = gx; u.ty = gy;
    u.path = isAir(u) ? [] : pathFor(u, gx, gy) || [];
    u.stuck = 0;
  });
  return list.length;
}
function setAltSel(z) {
  for (const id of sel) { const u = unitById(id); if (u && isAir(u)) u.tz = z; }
  if (control && isAir(control)) control.tz = z;
  document.querySelectorAll('[data-alt]').forEach((b) => b.classList.toggle('on', +b.dataset.alt === z));
}
function stepAlt(up) {
  const u = control && isAir(control) ? control : [...sel].map(unitById).find((v) => v && isAir(v));
  if (!u) return;
  const i = HELI_ALTS.indexOf(u.tz);
  setAltSel(HELI_ALTS[clamp((i < 0 ? 0 : i) + (up ? -1 : 1), 0, HELI_ALTS.length - 1)]);
}
function toggleControl() {
  if (control) { control = null; return null; }
  const u = [...sel].map(unitById).find(Boolean);
  if (u) { control = u; u.path = []; cam.ppm = Math.max(cam.ppm, 9); }
  return control;
}

// 被咬的士兵變喪屍：直接加在喪屍陣列尾端
function spawnZombieAt(x, y) {
  if (sim.n >= MAX_AGENTS) return;
  device.queue.writeBuffer(agentsB, sim.n * 16, new Float32Array([x, y, 0, 0]));
  device.queue.writeBuffer(infoB, sim.n * 8, new Uint32Array([1 | (((Math.random() * 256) | 0) << 8), 0]));
  sim.n++;
}
const explodeAt = (x, y, r, lethal, z = 0) => detonate(x, y, r, lethal, z, 60);
// 畫面上的高度：直升機實際高度壓縮顯示（40 m 畫成 16 m），不然戰術視角下會飛出畫面；物理照用實際高度
const visZ = (u) => (isAir(u) ? 4 + u.z * 0.3 : 1);
const angTo8 = (th) => ((Math.round((-90 - (th * 180) / Math.PI) / 45) % 8) + 8) % 8;
const angTo4 = (th) => { const c = Math.cos(th), s = Math.sin(th); return Math.abs(c) > Math.abs(s) ? (c > 0 ? 2 : 1) : (s > 0 ? 3 : 0); };

// ----- 每幀更新（sdt＝模擬秒） -----
const unitPerf = { ms: 0, max: 0 };
function updateUnits(sdt) {
  const tU = performance.now();
  try { updateUnitsInner(sdt); } finally { const ms = performance.now() - tU; unitPerf.ms = lerp(unitPerf.ms, ms, 0.05); unitPerf.max = Math.max(unitPerf.max, ms); }
}
function updateUnitsInner(sdt) {
  const P = sim.probe;
  for (const u of [...units]) {
    const t = UT[u.type], b = u.slot * 8;
    const contact = P[b], inr = P[b + 1];
    const cx = inr ? P[b + 2] / inr - 64 : 0, cy = inr ? P[b + 3] / inr - 64 : 0;
    const maxPile = P[b + 4] / 100;
    const ctl = control === u;
    // 受擊閃白：血量每掉 4% 閃一下（被啃、被炸都算）
    u.hurt = Math.max(0, (u.hurt || 0) - sdt);
    if (t.hp) { const st = Math.ceil(u.hp / (t.hp * 0.04)); if (u.hpStep != null && st < u.hpStep) u.hurt = 0.12; u.hpStep = st; }
    // --- 移動 ---
    let mvx = 0, mvy = 0;
    if (isAir(u)) {
      if (ctl) { const k = keys; const dx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0), dy = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0); if (dx || dy) { u.tx = u.x + dx * 40; u.ty = u.y + dy * 40; } else { u.tx = u.x; u.ty = u.y; } }
      const dx = u.tx - u.x, dy = u.ty - u.y, d = Math.hypot(dx, dy);
      const want = d > 0.5 ? Math.min(t.speed, d * 0.7) : 0;
      const a = Math.min(1, sdt * 1.6);
      u.vx += ((d > 0.5 ? (dx / d) * want : 0) - u.vx) * a; u.vy += ((d > 0.5 ? (dy / d) * want : 0) - u.vy) * a;
      const drag = 1 / (1 + u.hang * 0.6);
      mvx = u.vx * drag; mvy = u.vy * drag;
      u.x = clamp(u.x + mvx * sdt, 1, WN - 1); u.y = clamp(u.y + mvy * sdt, 1, WN - 1);
      // 前面或底下有比較高的樓：先爬升越過去（設定的高度不變，過了樓再降回來）
      const zGoal = Math.max(u.tz, airClearance(u, dx, dy, d));
      u.climbing = zGoal > u.tz + 0.5;
      const vz = (zGoal > u.z ? Math.min(u.climbing ? 9 : 5, (zGoal - u.z) * 1.5) : Math.max(-4, (zGoal - u.z) * 1.5)) - 0.9 * u.hang;
      u.z = Math.max(u.landed ? 2.5 : 0, u.z + vz * sdt);
    } else {
      if (ctl) {
        const k = keys;
        mvx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0); mvy = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
        const l = Math.hypot(mvx, mvy); if (l) { mvx = (mvx / l) * t.speed; mvy = (mvy / l) * t.speed; }
      } else if (u.path.length) {
        const [wx, wy] = u.path[0];
        const dx = wx - u.x, dy = wy - u.y, d = Math.hypot(dx, dy);
        if (d < (u.type === 'tank' || u.type === 'truck' ? 3 : 1.5)) { u.path.shift(); u.bestD = null; }
        else { mvx = (dx / d) * t.speed; mvy = (dy / d) * t.speed; }
        followCheck(u, d, sdt);
      }
      // 每步最多 0.5 m，邊走邊推出建築／牆／水（4 倍速也不會穿過 2 m 厚的牆）
      const ox = u.x, oy = u.y, stepN = Math.max(1, Math.ceil((Math.hypot(mvx, mvy) * sdt) / 0.5));
      for (let k = 0; k < stepN; k++) { u.x += (mvx * sdt) / stepN; u.y += (mvy * sdt) / stepN; collideGround(u); }
      u.x = clamp(u.x, 1, WN - 1); u.y = clamp(u.y, 1, WN - 1);
      if (sdt > 0) { const ax = (u.x - ox) / sdt, ay = (u.y - oy) / sdt; if (Math.hypot(ax, ay) < Math.hypot(mvx, mvy) * 0.25) { mvx = ax; mvy = ay; } }   // 頂著牆：原地不算在走
      // 卡住時縮小的半徑：周圍夠空就慢慢長回來
      if (u.squeeze < 1) u.squeeze = Math.min(1, u.squeeze + sdt * 0.25, Math.max(u.squeeze, (clearAt(u.x, u.y) - 0.2) / UR[u.type]));
    }
    const sp = Math.hypot(mvx, mvy);
    u.moving = sp > 0.3;
    u.walk += sp * sdt;
    // --- 交戰 ---
    u.firing = false;
    u.fireT = Math.max(0, u.fireT - sdt);
    if (ctl && aim.firing) { u.firing = true; u.aimX = aim.x; u.aimY = aim.y; }
    else if (!ctl && inr > 0 && !isAir(u) && u.type !== 'truck') { u.firing = true; u.aimX = u.x + cx; u.aimY = u.y + cy; }
    else if (isAir(u) && (contact > 0 || (inr > 0 && u.type === 'heli'))) { u.firing = true; u.aimX = u.x + cx * 0.3; u.aimY = u.y + cy * 0.3; }
    if (u.type === 'truck' || supply.stock <= 0) u.firing = false;   // 沒補給就沒彈藥
    if (u.firing && u.type !== 'transport') u.face = Math.atan2(u.aimY - u.y, u.aimX - u.x);
    else if (sp > 0.3) u.face = Math.atan2(mvy, mvx);
    u.dir = angTo8(u.face);
    // 戰車主砲：AI 瞄最密的那團（看得到才開）、操控時對著準星（點住才開）。砲彈走直線，路上撞到建築就在牆面炸
    const shot = u.type === 'tank' && u.fireT <= 0 && supply.stock >= 4 && ((ctl && aim.firing) || (!ctl && inr > 25)) ? tankTarget(u, ctl, P[b + 5]) : null;
    if (shot) {
      useSupply(4);
      u.face = Math.atan2(shot[1] - u.y, shot[0] - u.x); u.dir = angTo8(u.face);
      const hit = rayHitBuilding(u.x + Math.cos(u.face) * 5, u.y + Math.sin(u.face) * 5, 2.2, shot[0], shot[1], 0.5);
      const [ex, ey, ez] = hit || [shot[0], shot[1], 0];
      explodeAt(ex, ey, 6, 0.9, ez > 1 ? ez : 0);
      tracers.push([u.x + Math.cos(u.face) * 5, u.y + Math.sin(u.face) * 5, 2.2, ex, ey, Math.max(0.5, ez), 0.08, 1]);
      game.fx.push([u.x + Math.cos(u.face) * 5.5, u.y + Math.sin(u.face) * 5.5, 4, sim.time]);
      // 砲口爆風：一團亮光＋往前噴的煙，車身底下揚塵
      const mx = u.x + Math.cos(u.face) * 6, my = u.y + Math.sin(u.face) * 6;
      fxMuzzle(mx, my, 2.3, true);
      for (let k = 0; k < 5; k++) emit(mx, my, 2.2, Math.cos(u.face) * rr(3, 8) + rr(-1.5, 1.5), Math.sin(u.face) * rr(3, 8) + rr(-1.5, 1.5), rr(0.5, 1.5), rr(1, 1.8), 1.2, 3.5, 0.5, 0.48, 0.44, 0.6, 0, 2);
      for (let k = 0; k < 6; k++) { const a = Math.random() * 6.2832; emit(u.x + Math.cos(a) * 3, u.y + Math.sin(a) * 3, 0.3, Math.cos(a) * 5, Math.sin(a) * 5, 0.3, 0.7, 1, 2.6, 0.55, 0.5, 0.42, 0.45, 0, 2); }
      u.fireT = ctl ? 2.5 : t.reload;
    }
    // 曳光彈：打死喪屍的那幾發由 GPU 擊殺紀錄畫（onKills → shotAt，畫到牠倒下的位置）；這裡補沒打中的幾發（只揚塵、不噴血）
    if (u.firing && sdt > 0 && Math.random() < (u.type === 'squad' ? u.men : u.type === 'tank' ? 1 : 2) * sdt * 3) {
      const [mx, my, mz] = muzzleOf(u);
      fxMuzzle(mx, my, mz, false);
      missShot(mx, my, mz, u, u.type === 'squad' ? 3 : 1.5, !isAir(u));
    }
    // --- 被咬 / 被抓 ---
    if (u.type === 'squad') {
      u.dmg += contact * t.bite * sdt;
      while (u.dmg >= 100 && u.men > 0) {
        u.dmg -= 100; u.men--;
        const [sx, sy] = soldierPos(u, u.men);
        fxSoldierDown(sx, sy); u.hurt = 0.25;
        if (Math.random() < 0.7) spawnZombieAt(sx, sy);   // 被咬的變成喪屍
        game.lost = (game.lost || 0) + 1;
      }
      if (u.men <= 0) { removeUnit(u); continue; }
    } else if (u.type === 'tank' || u.type === 'truck') {
      u.hp -= contact * t.bite * sdt;
      if (u.hp <= 0) { explodeAt(u.x, u.y, 9, 0.95); addWreck(u); game.lost = (game.lost || 0) + 1; cargoLost(u); removeUnit(u); continue; }
    } else {
      u.reach = maxPile + 2.7; u.crowd = contact;
      u.danger = u.z < u.reach + 3 && contact > 6;
      if (u.z < u.reach && contact > 6 && sp < 8) {
        const lam = 0.35 * (u.reach - u.z + 0.5) * Math.min(contact / 25, 2);
        if (Math.random() < lam * sdt) { u.hang = Math.min(u.hang + 1, 12); u.flash = 0.4; }
      } else if (u.hang > 0 && u.z > u.reach + 1.5 && Math.random() < 1.2 * sdt) u.hang--;
      u.hp -= u.hang * 2.5 * sdt;
      if (u.flash > 0) u.flash -= sdt;
      if ((u.z <= 0.5 && !u.landed) || u.hp <= 0) { explodeAt(u.x, u.y, 11, 0.95); addWreck(u); game.lost = (game.lost || 0) + 1; cargoLost(u); removeUnit(u); continue; }
    }
  }
  separateUnits(units);
  for (let k = tracers.length - 1; k >= 0; k--) if ((tracers[k][6] -= sdt) <= 0) tracers.splice(k, 1);
}
// 走路徑時 1.2 秒沒更靠近路徑點＝卡住：終點被別的單位佔著就停在旁邊；不然半徑縮小（擠得過窄巷）、重新找路
function followCheck(u, d, sdt) {
  if (u.bestD == null || d < u.bestD - 0.3) { u.bestD = d; u.stuck = 0; return; }
  u.stuck = (u.stuck || 0) + sdt;
  if (u.stuck < 1.2) return;
  u.stuck = 0; u.bestD = null;
  if (u.path.length === 1 && d < UR[u.type] * 3 + 4) { u.path = []; return; }
  u.squeeze = Math.max(0.35, (u.squeeze || 1) * 0.7);
  const p = findPath(u.x, u.y, u.tx, u.ty, unitRadius(u));
  if (p) u.path = p;
}
// 直升機要飛多高才不會撞樓：機身底下 4 m 內、往目標方向 30 m 內最高的屋頂／牆 + 4 m
function airClearance(u, dx, dy, d) {
  let top = 0;
  for (let oy = -3; oy <= 3; oy += 3) for (let ox = -3; ox <= 3; ox += 3) top = Math.max(top, solidTop(u.x + ox, u.y + oy));
  if (d > 1) { const L = Math.min(d, 30); for (let s = 2; s <= L; s += 2) top = Math.max(top, solidTop(u.x + (dx / d) * s, u.y + (dy / d) * s)); }
  return top > 0 ? top + 4 : 0;
}
// 第 k 個士兵的世界座標：貼著建築／牆時隊形往中間收，士兵不會站進牆裡
// 戰車主砲瞄哪：AI＝探測回報 8–48 m 內最密的 3×3 m（中間隔著建築就改瞄重心，重心也看不到就不開）；操控＝準星
function tankTarget(u, ctl, best) {
  if (ctl) return [aim.x, aim.y];
  const n = best >>> 22, idx = best & 0x3fffff;
  const cands = [];
  if (n >= 3) cands.push([(idx % WN) + 0.5 + (Math.random() - 0.5) * 1.5, Math.floor(idx / WN) + 0.5 + (Math.random() - 0.5) * 1.5]);
  cands.push([u.aimX, u.aimY]);
  for (const [x, y] of cands) if (Math.hypot(x - u.x, y - u.y) < UT.tank.range && groundLos(u.x, u.y, x, y)) return [x, y];
  return null;
}
function soldierPos(u, k) {
  const [ox, oy] = soldierOffset(u, k);
  let x = u.x + ox, y = u.y + oy;
  if (hardAt(x, y) || clearAt(x, y) < 0.3) { x = u.x + ox * 0.35; y = u.y + oy * 0.35; }
  return [x, y];
}
function soldierOffset(u, k) {
  const r = k >> 2, c = k & 3;
  const ax = (c - 1.5) * 1.7, ay = (r === 0 ? 0.9 : -0.9);
  const f = u.face - Math.PI / 2;   // 隊形面向 face
  return [ax * Math.cos(f) - ay * Math.sin(f), ax * Math.sin(f) + ay * Math.cos(f)];
}

// ----- 給模擬的資料：目標、殺傷區、射擊線、探測位置 -----
function unitTargets() {
  const t = [];
  for (const u of units) {
    if (isAir(u)) { if (u.z < 25) t.push([u.x, u.y, 6, 120 + (25 - u.z) * 6]); }
    else if (u.type === 'truck') { if (u.moving) t.push([u.x, u.y, 5, 60]); }
    else t.push([u.x, u.y, 5, u.firing ? 90 : 40]);   // 開槍很吵
  }
  return t;
}
function unitZones() {
  const zc = sim.zoneCounts;
  const rate = (kps, cnt) => Math.min(4, kps / Math.max(cnt, 1));   // 每隻每秒被打死機率 = 每秒擊殺上限 ÷ 區內數量
  const z = [];
  for (let s = 0; s < USLOTS; s++) {
    const u = slots[s], i = 1 + s * 2;
    let a = [0, 0, 0, 0], b = [0, 0, 0, 0];
    if (u && control !== u) {
      const t = UT[u.type];
      // 地面射手：半徑給負的＝GPU 只算看得到的（中間沒有建築）
      if (u.type === 'squad' && u.firing) a = [u.x, u.y, -t.range, rate(t.rate * u.men, zc[i])];
      if (u.type === 'tank' && u.firing) a = [u.x, u.y, -t.range, rate(t.rate, zc[i])];
      if (isAir(u) && supply.stock > 0 && (u.type === 'heli' || u.firing)) { const r = clamp(8 + u.z * 0.5, 8, t.range), acc = clamp(1.25 - u.z / 50, 0.45, 1.15); a = [u.x, u.y, r, rate(t.rate * acc, zc[i])]; }
    }
    if (u && u.type === 'tank' && u.moving) b = [u.x, u.y, 3.2, 8];   // 輾過去
    if (u && u.type === 'truck' && u.moving) b = [u.x, u.y, 2.6, 5];
    z[i] = a; z[i + 1] = b;
  }
  return z;
}
function unitLines() {
  const u = control;
  if (!u || !aim.firing || u.type === 'tank' || u.type === 'truck' || supply.stock <= 0) return [];
  const dx = aim.x - u.x, dy = aim.y - u.y, d = Math.hypot(dx, dy) || 1;
  let L = Math.min(d, isAir(u) ? 45 : 60);
  if (!isAir(u)) { const hit = rayHitBuilding(u.x, u.y, 1.5, u.x + (dx / d) * L, u.y + (dy / d) * L, 1.5); if (hit) L = Math.hypot(hit[0] - u.x, hit[1] - u.y); }   // 射擊線停在第一棟建築
  const kps = u.type === 'squad' ? u.men * 2.6 : 22;
  return [[u.x, u.y, u.x + (dx / d) * L, u.y + (dy / d) * L, isAir(u) ? 2.5 : 1.6, Math.min(6, kps / Math.max(sim.lineCounts[0], 1)), 0, 0]];
}
function unitProbeSlots() {
  const out = [];
  for (let s = 0; s < USLOTS; s++) {
    const u = slots[s];
    out.push(u ? [u.x, u.y, isAir(u) ? Math.max(u.z, 0.6) : 0, UT[u.type].contact] : [-5000, -5000, 0, 0]);
  }
  return out;
}

// ----- 繪製實例 -----
function pushUnitInstances(push) {
  const ss = SPRITES.soldier, ts = SPRITES.tank;
  const sl = pickLod(cam.ppm, ss, 1.85), tl = pickLod(cam.ppm, ts, 7.4), zl = pickLod(cam.ppm);
  for (const u of units) {
    if (isAir(u)) {
      const hs = (u.type === 'transport' && SPRITES.transport) || SPRITES.heli, hw = vehW(u.type === 'transport' && SPRITES.transport ? 'transport' : 'heli', hs), hh = (hw * hs.cellH) / hs.cellW, hl = pickLod(cam.ppm, hs, hh);
      push([u.x, u.y, 0.08, 11 + u.z * 0.08], [6 + u.z * 0.05, 0, 0, 1], [0, 0, clamp(0.45 - u.z / 120, 0.12, 0.45), 0]);
      for (let j = 0; j < Math.min(u.hang, 8); j++) {
        const ox = ((j % 4) - 1.5) * 1.3, oy = (j < 4 ? -1 : 1) * 1.1;
        push([u.x + ox, u.y + oy, visZ(u) - 1.4 - (j >= 4 ? 0.9 : 0), (1.95 * zl.cw) / zl.ch], [1.95, zl.x + ((Math.floor(sim.time * 6) + j) % 4) * zl.cw, zl.y + 3 * zl.ch, 3], [zl.cw, zl.ch, 1, 0]);
      }
      push([u.x, u.y, visZ(u), hw], [hh, hl.x + (u.dir % 4) * hl.cw, hl.y + Math.floor(u.dir / 4) * hl.ch, 0], [hl.cw, hl.ch, 1, (u.flash > 0 ? 2 : 0) | (u.hurt > 0 ? 8 : 0)]);
      push([u.x, u.y, visZ(u) + 1.2, 15], [15, 0, 0, 2], [0, 0, 0.9, 0]);
    } else if (u.type === 'tank' || u.type === 'truck') {
      const vs = (u.type === 'truck' && SPRITES.truck) || ts, w = vehW(u.type === 'truck' && SPRITES.truck ? 'truck' : 'tank', vs), h = (w * vs.cellH) / vs.cellW, vl = pickLod(cam.ppm, vs, h);
      push([u.x, u.y, 0.08, w * 0.8], [h * 0.75, 0, 0, 1], [0, 0, 0.35, 0]);   // 車底影子
      push([u.x, u.y, 0.6, w], [h, vl.x + (u.dir % 4) * vl.cw, vl.y + Math.floor(u.dir / 4) * vl.ch, 0], [vl.cw, vl.ch, 1, (u.hp < 250 && Math.sin(sim.time * 10) > 0 ? 2 : 0) | (u.hurt > 0 ? 8 : 0)]);
    } else {
      const w = (1.85 * sl.cw) / sl.ch;
      const row4 = angTo4(u.face);
      for (let k = 0; k < u.men; k++) {
        const [px, py] = soldierPos(u, k);
        let row = row4, col = 0, flip = 0;
        if (u.firing && ((Math.floor(sim.time * 12) + k) & 1)) { row = 2; col = 4; flip = Math.cos(u.face) < 0 ? 1 : 0; }
        else if (u.moving) col = (Math.floor(u.walk * 1.6) + k) & 3;
        push([px, py, 0, w], [1.85, sl.x + col * sl.cw, sl.y + row * sl.ch, 5], [sl.cw, sl.ch, 1, flip | (u.hurt > 0 ? 8 : 0)]);
      }
    }
  }
  // 曳光彈：外面一圈淡淡的光暈＋亮芯
  for (const t of tracers) {
    push([t[0], t[1], t[2], t[7] ? 5 : 3], [t[3], t[4], t[5], 4], t[7] ? [1, 0.6, 0.25, 0.35] : [1, 0.7, 0.3, 0.25]);
    push([t[0], t[1], t[2], t[7] ? 2.2 : 1.2], [t[3], t[4], t[5], 4], t[7] ? [1, 0.95, 0.75, 1] : [1, 0.95, 0.6, 0.95]);
  }
  pushUnitOverlays(push);
}
function unitMarks(push) {
  for (const u of units) {
    const r = UT[u.type].ring;
    if (sel.has(u.id)) push(u.x, u.y, r, 0, control === u ? [1, 0.8, 0.3] : [0.45, 1, 0.5], 1);
    if (sel.has(u.id) && control !== u) {
      const g = isAir(u) ? [u.tx, u.ty] : u.path.length ? u.path[u.path.length - 1] : null;
      if (g && Math.hypot(g[0] - u.x, g[1] - u.y) > 4) push(g[0], g[1], 4, 0, [0.45, 1, 0.5], 0.7);
    }
    if (isAir(u) && (u.danger || u.hang)) push(u.x, u.y, 9, 1, [1, 0.25, 0.2], 0.5 + 0.5 * Math.sin(sim.time * 8));
  }
  if (control && aim.firing === false) push(aim.x, aim.y, 1.5, 0, [1, 0.8, 0.3], 0.8);
}
// 選取／受傷單位頭上的血條（步兵班＝剩幾人的格子）＋選取單位的虛線路徑
// 種類 7 血條：(x, y, z, 寬m) (高m, 填滿比例, 格數, 7) (r, g, b, a)；種類 8 虛線（跟 4 一樣，但會流動）
function pushUnitOverlays(push) {
  const ppm = cam.ppm, up = cam.up;
  if (ppm < 2) return;
  for (const u of units) {
    const t = UT[u.type], picked = sel.has(u.id);
    if (picked && control !== u) {
      const pts = isAir(u) ? (Math.hypot(u.tx - u.x, u.ty - u.y) > 4 ? [[u.tx, u.ty]] : []) : u.path.slice(0, 12);
      let px = u.x, py = u.y;
      for (const [qx, qy] of pts) { push([px, py, 0.25, 1], [qx, qy, 0.25, 8], u.mission ? [0.35, 0.9, 1, 0.7] : [0.45, 1, 0.5, 0.7]); px = qx; py = qy; }
    }
    const frac = u.type === 'squad' ? u.men / 8 : t.hp ? clamp(u.hp / t.hp, 0, 1) : 1;
    if (!picked && frac >= 1) continue;
    const lift = u.type === 'squad' ? 3.1 : isAir(u) ? 7 : 5.2, z0 = isAir(u) ? visZ(u) : u.type === 'squad' ? 0 : 0.6;
    const bx = u.x + up[0] * lift, by = u.y + up[1] * lift, bz = z0 + up[2] * lift;
    const w = 34 / ppm, h = 4.5 / ppm, e = 2 / ppm;
    const c = frac > 0.6 ? [0.35, 0.95, 0.4, 1] : frac > 0.3 ? [1, 0.8, 0.25, 1] : [1, 0.3, 0.25, 1];
    push([bx, by, bz, w + e], [h + e, 1, 1, 7], [0.05, 0.05, 0.05, 0.8]);
    push([bx, by, bz, w], [h, frac, u.type === 'squad' ? 8 : 1, 7], c);
  }
}
// 畫面像素 → 最近的單位（28 px 內）
function pickUnit(px, py) {
  let best = null, bd = 28;
  const r = canvas.getBoundingClientRect();
  for (const u of units) {
    const [sx, sy] = projectPx(u.x, u.y, visZ(u), r);
    const d = Math.hypot(sx - px, sy - py);
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}
function projectPx(x, y, z, r) {
  const m = cam.vp; const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  return [r.left + (cx * 0.5 + 0.5) * r.width, r.top + (0.5 - cy * 0.5) * r.height];
}
