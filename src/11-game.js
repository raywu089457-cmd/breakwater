// ---------- 遊戲層：輸入、工具、標記、HUD ----------
const params = new URLSearchParams(location.search);
const START_N = clamp(parseInt(params.get('n') || String(REGION.n), 10) || REGION.n, 1, MAX_AGENTS);
const tSpawn = performance.now();
setAgents(START_N);
const spawnMs = performance.now() - tSpawn;

const fob = map.fob;
const game = { tool: 'command', supType: 'artillery', ciws: true, pending: [], marks: [], beacons: [], survivors: [], shots: 0, fx: [], lost: 0 };
const fxArr = new Float32Array(MAX_FX * 4);
function buildFx() {
  game.fx = game.fx.filter((f) => sim.time - f[3] < 1.2);
  game.fx.slice(-MAX_FX).forEach((f, k) => fxArr.set(f, k * 4));
  return fxArr.subarray(0, Math.min(MAX_FX, game.fx.length) * 4);
}
// 避難所位置（依離市中心遠近排序；測試用 survivors[0] 當屍潮聚集點）
game.survivors = shelters.slice().sort((a, b) => Math.hypot(a.sx - map.downtown.x, a.sy - map.downtown.y) - Math.hypot(b.sx - map.downtown.x, b.sy - map.downtown.y)).map((d) => [d.sx, d.sy]);
// 開局部隊：兩個步兵班、一輛戰車在基地，直升機在基地上空
spawnUnit('squad', fob.x - 25, fob.y + 30);
spawnUnit('squad', fob.x + 25, fob.y + 30);
spawnUnit('tank', fob.x, fob.y + 10);
spawnUnit('heli', fob.x - 40, fob.y - 10);
applyCarry();

const CIWS_RATE = 45;     // 近防每秒最多擊殺
function rebuildSimInputs() {
  sim.targets = [[fob.x, fob.y, 70, 420], ...districtTargets(), ...outpostTargets(), ...nestTargets(), ...nexusTargets(), ...game.beacons.map(([x, y]) => [x, y, 10, 260]), ...unitTargets()];
  const z = unitZones();
  z[0] = game.ciws ? [fob.x, fob.y, 118, Math.min(4, CIWS_RATE / Math.max(sim.zoneCounts[0], 1))] : [0, 0, 0, 0];
  districtZones(z);
  outpostZones(z);
  nestZones(z);
  if (supply.stock <= 0) z[0] = [0, 0, 0, 0];   // 沒補給：近防停火
  for (let i = 0; i < z.length; i++) if (!z[i]) z[i] = [0, 0, 0, 0];
  sim.zones = z;
  sim.lines = unitLines();
  sim.units = [...unitProbeSlots(), ...districtProbes(), fobProbe(), ...nestProbes(), ...blockProbes()];
}
rebuildSimInputs();

function strike(x, y, r = 14, delay = 1.6) { game.pending.push({ x, y, r, t: delay, t0: delay }); game.shots++; }
function addBeacon(x, y) { if (game.beacons.length < 24) game.beacons.push([x, y]); }
function removeBeacon(x, y) {
  let best = -1, bd = 60;
  game.beacons.forEach(([bx, by], k) => { const d = Math.hypot(bx - x, by - y); if (d < bd) { bd = d; best = k; } });
  if (best >= 0) game.beacons.splice(best, 1);
}

// 標記陣列：每個 8 個 float（x, y, 半徑, 類型 | r, g, b, a）
const markArr = new Float32Array(MAX_MARKS * 8);
function buildMarks(dt) {
  let n = 0;
  const push = (x, y, r, type, c, a) => { if (n < MAX_MARKS) { markArr.set([x, y, r, type, c[0], c[1], c[2], a], n * 8); n++; } };
  game.marks = game.marks.filter((m) => (m.life -= dt * (sim.speed ? 1 : 0)) > 0);
  for (const m of game.marks) if (m.type === 3) push(m.x, m.y, m.r, 3, [0.05, 0.04, 0.035], Math.min(1, m.life / 20) * 0.8);
  for (const m of game.marks) if (m.type === 2) push(m.x, m.y, m.r, 2, [1, 0.75, 0.35], m.life / m.max);
  for (const m of game.marks) if (m.type === 6) push(m.x, m.y, m.r, 6, [0.3, 0.03, 0.03], Math.min(1, m.life / 20) * 0.85);
  for (const m of game.marks) if (m.type === 4) { const k = 1 - m.life / m.max; push(m.x, m.y, m.r * Math.sqrt(k) + 0.5, 4, [1, 0.85, 0.55], (1 - k) * 0.9); }
  for (const m of game.marks) if (m.type === 5) { const k = m.life / m.max; push(m.x, m.y, m.r * (0.3 + 0.7 * k), 5, m.c, Math.min(1, k * 1.6)); }
  for (const p of game.pending) push(p.x, p.y, p.r, 1, [1, 0.35, 0.2], p.t / p.t0);
  push(fob.x, fob.y, 70, 0, [0.35, 0.75, 1], 1);
  if (game.ciws) push(fob.x, fob.y, 118, 0, [0.3, 0.55, 0.9], 0.6);
  for (const d of shelters) push(d.sx, d.sy, 10, 0, DSTATE[d.state].col, 1);
  for (const [x, y] of game.beacons) push(x, y, 10, 0, [1, 0.85, 0.3], 1);
  unitMarks(push);
  outpostMarks(push);
  nestMarks(push);
  nexusMarks(push);
  quarantineMarks(push);
  if (aim.sx >= 0) {
    const r = canvas.getBoundingClientRect();
    const [hx, hy] = screenToGround((aim.sx - r.left) / r.width, (aim.sy - r.top) / r.height);
    if (drag && drag.sup) supportMarks(push, drag.g0[0], drag.g0[1], hx, hy); else supportMarks(push, hx, hy);
  } else supportMarks(push);
  return markArr.subarray(0, n * 8);
}
const unitArr = new Float32Array(MAX_UNITS * 12);
function buildUnits() {
  let n = 0;
  const pushI = (a, b, c) => { if (n < MAX_UNITS) { unitArr.set(a, n * 12); unitArr.set(b, n * 12 + 4); unitArr.set(c, n * 12 + 8); n++; } };
  pushSupportInstances(pushI);
  pushNestInstances(pushI);
  pushWrecks(pushI);
  pushUnitInstances(pushI);
  pushParticles(pushI);
  game.unitInstances = n;
  return unitArr.subarray(0, n * 12);
}

function updateGame(dt) {
  const sdt = dt * sim.speed;
  for (const p of game.pending) p.t -= sdt;
  for (const p of game.pending.filter((p) => p.t <= 0)) {
    sim.strikesOnce.push([p.x, p.y, p.r, 0.93]);
    game.marks.push({ type: 2, x: p.x, y: p.y, r: p.r * 1.1, life: 0.18, max: 0.18 });
    game.fx.push([p.x, p.y, p.r * 1.9, sim.time]);
    fxExplosion(p.x, p.y, p.r * 1.9);
    game.marks.push({ type: 3, x: p.x, y: p.y, r: p.r * 0.8, life: 90, max: 90 });
  }
  game.pending = game.pending.filter((p) => p.t > 0);
  // 準星：直接操控時跟著滑鼠
  if (control && aim.sx >= 0) { const r = canvas.getBoundingClientRect(); [aim.x, aim.y] = screenToGround((aim.sx - r.left) / r.width, (aim.sy - r.top) / r.height); }
  if (sdt > 0) { updateUnits(Math.min(sdt, 0.15)); updateSupport(Math.min(sdt, 0.15)); updateDistricts(Math.min(sdt, 0.15)); updateLogistics(Math.min(sdt, 0.15)); updateNests(Math.min(sdt, 0.15)); updateNexus(Math.min(sdt, 0.15)); updateQuarantine(Math.min(sdt, 0.15)); updateCampaign(Math.min(sdt, 0.15)); updateAutosave(Math.min(sdt, 0.15)); updateWalls(Math.min(sdt, 0.15)); updateCombatFx(Math.min(sdt, 0.15)); }
  rebuildSimInputs();
  if (control) {
    // 鏡頭跟著被操控的單位
    const a = Math.min(1, dt * 6);
    cam.x += (control.x - cam.x) * a; cam.y += (control.y - cam.y) * a;
  } else {
    const k = keys, s = (dt * 700) / cam.ppm;
    if (k.has('KeyA') || k.has('ArrowLeft')) cam.x -= s;
    if (k.has('KeyD') || k.has('ArrowRight')) cam.x += s;
    if (k.has('KeyW') || k.has('ArrowUp')) cam.y += s / Math.sin(cam.pitch);
    if (k.has('KeyS') || k.has('ArrowDown')) cam.y -= s / Math.sin(cam.pitch);
  }
}

// ----- 輸入 -----
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'Space') { setSpeed(sim.speed ? 0 : (game.lastSpeed || 1)); e.preventDefault(); }
  if (/^Digit[1-4]$/.test(e.code)) setSpeed(+e.code.slice(5));
  if (e.code === 'BracketLeft') pixelScale = Math.max(1, pixelScale - 1);
  if (e.code === 'BracketRight') pixelScale = Math.min(4, pixelScale + 1);
  if (e.code === 'KeyH') $('help').style.display = $('help').style.display === 'none' ? '' : 'none';
  if (e.code === 'KeyQ' || e.code === 'KeyE') stepAlt(e.code === 'KeyQ');
  if (e.code === 'Tab') { e.preventDefault(); toggleControl(); }
  if (e.code === 'KeyM') setMuted();
  if (e.code === 'F5') { e.preventDefault(); if (!op.over) saveGame(); }
  if (e.code === 'F9') { e.preventDefault(); requestLoad(); }
  if (e.code === 'Escape') { control = null; sel.clear(); aim.firing = false; }
  if (SUP_KEYS[e.code] && !control) setSupport(SUP_KEYS[e.code]);
});
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
let drag = null;
const toUV = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
const selbox = $('selbox');
canvas.addEventListener('pointerdown', (e) => {
  aim.sx = e.clientX; aim.sy = e.clientY;
  if (control && e.button === 0) { aim.firing = true; drag = null; return; }   // 直接操控：左鍵開火
  drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, btn: e.button, g0: screenToGround(...toUV(e)),
    wall: e.button === 0 && game.tool === 'wall' && !e.shiftKey, box: e.button === 0 && game.tool === 'command', sup: e.button === 0 && game.tool === 'support' };
  canvas.setPointerCapture(e.pointerId);
});
// move/up 掛在 window：拖曳中途指標失去 capture、或在面板上放開時，拖曳照樣正常結束
addEventListener('pointermove', (e) => {
  aim.sx = e.clientX; aim.sy = e.clientY;
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
  drag.moved = true;
  if (drag.wall) { const g = screenToGround(...toUV(e)); setWallGhost(wallRect(drag.g0[0], drag.g0[1], g[0], g[1])); return; }
  if (drag.sup) return;   // 空襲拖曳畫線（預覽在標記裡）
  if (drag.box) {
    Object.assign(selbox.style, { display: 'block', left: Math.min(drag.x0, e.clientX) + 'px', top: Math.min(drag.y0, e.clientY) + 'px',
      width: Math.abs(e.clientX - drag.x0) + 'px', height: Math.abs(e.clientY - drag.y0) + 'px' });
    return;
  }
  if (control) return;
  canvas.classList.add('drag');
  const r = canvas.getBoundingClientRect();
  cam.x -= (dx / r.width) * 2 * cam.halfW;
  cam.y += ((dy / r.height) * 2 * cam.halfH) / Math.sin(cam.pitch);
  drag.x = e.clientX; drag.y = e.clientY;
});
addEventListener('pointerup', (e) => {
  canvas.classList.remove('drag');
  if (control && e.button === 0) { aim.firing = false; return; }
  if (!drag) return;
  const [gx, gy] = screenToGround(...toUV(e));
  if (drag.wall) {
    if (drag.moved) buildOrRepair(wallRect(drag.g0[0], drag.g0[1], gx, gy));
    setWallGhost(null);
  } else if (drag.sup) {
    if (game.supType === 'air' && drag.moved) callSupport('air', (drag.g0[0] + gx) / 2, (drag.g0[1] + gy) / 2, gx + (gx - drag.g0[0]), gy + (gy - drag.g0[1]));
    else callSupport(game.supType, gx, gy);
  } else if (drag.box && drag.moved) {
    selbox.style.display = 'none';
    if (!e.shiftKey) sel.clear();
    const r = canvas.getBoundingClientRect();
    const x0 = Math.min(drag.x0, e.clientX), x1 = Math.max(drag.x0, e.clientX), y0 = Math.min(drag.y0, e.clientY), y1 = Math.max(drag.y0, e.clientY);
    for (const u of units) { const [sx, sy] = projectPx(u.x, u.y, visZ(u), r); if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) sel.add(u.id); }
  } else if (!drag.moved) {
    if (drag.btn === 2) {
      if (sel.size) orderAt(gx, gy);
      else if (e.shiftKey) removeBeacon(gx, gy); else addBeacon(gx, gy);
    } else if (drag.btn === 0) {
      if (game.tool === 'command') {
        const u = pickUnit(e.clientX, e.clientY);
        if (!e.shiftKey) sel.clear();
        if (u) { if (e.shiftKey && sel.has(u.id)) sel.delete(u.id); else sel.add(u.id); }
      } else if (game.tool === 'strike') strike(gx, gy);
      else if (game.tool === 'beacon') { if (e.shiftKey) removeBeacon(gx, gy); else addBeacon(gx, gy); }
      else if (game.tool === 'wall' && e.shiftKey) removeWallAt(gx, gy);
      else if (game.tool === 'outpost') { placeOutpost(gx, gy); setTool('command'); }
      else if (game.tool === 'nest') { if (e.shiftKey) removeNestAt(gx, gy); else placeNest(gx, gy); }
    }
  }
  drag = null;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const uv = toUV(e);
  const g0 = screenToGround(...uv);
  cam.ppm *= Math.exp(-e.deltaY * 0.0015);
  updateCam(iw, ih);
  const g1 = screenToGround(...uv);
  if (!control) { cam.x += g0[0] - g1[0]; cam.y += g0[1] - g1[1]; if (e.deltaY > 0) zoomCenterPull(); }
  updateCam(iw, ih);
}, { passive: false });
function setSpeed(s) {
  if (op.over && s) return;   // 作戰結束後不能再開時間
  if (s) game.lastSpeed = s;
  sim.speed = s;
  document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === s));
}
function setTool(t) {
  game.tool = t;
  document.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === t));
  document.querySelectorAll('[data-sup]').forEach((x) => x.classList.toggle('on', t === 'support' && x.dataset.sup === game.supType));
}
function setSupport(type) { game.supType = type; setTool('support'); }
document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
document.querySelectorAll('[data-alt]').forEach((b) => b.addEventListener('click', () => setAltSel(+b.dataset.alt)));
document.querySelectorAll('[data-sup]').forEach((b) => b.addEventListener('click', () => setSupport(b.dataset.sup)));
document.querySelectorAll('[data-deploy]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.deploy === 'outpost' || b.dataset.deploy === 'nest') setTool(b.dataset.deploy); else deploy(b.dataset.deploy); }));
$('nexus').addEventListener('click', () => { const t = nexus.phase !== 'idle' && nexus.target ? nexus.target : blockades.find((b) => b.state === 'holding'); if (t) { cam.x = t.x; cam.y = t.y; cam.ppm = Math.max(cam.ppm, 3); } });
function setMuted() { const m = sfx.toggle(); $('mute').textContent = m ? '🔇' : '🔊'; $('mute').classList.toggle('on', !m); }
$('mute').textContent = sfx.muted ? '🔇' : '🔊'; $('mute').classList.toggle('on', !sfx.muted);
$('mute').addEventListener('click', setMuted);
$('camp').addEventListener('click', showCampaignMap);
document.querySelectorAll('[data-qp]').forEach((b) => b.addEventListener('click', () => setQPolicy(b.dataset.qp)));
$('ciws').addEventListener('click', () => { game.ciws = !game.ciws; $('ciws').classList.toggle('on', game.ciws); });

// ----- HUD -----
const fmt = (n) => n.toLocaleString('en-US');
let fps = 60, lastHud = 0;
function unitLine(u) {
  if (u.type === 'squad') return `步兵班 · ${u.men} 人`;
  if (u.type === 'tank') return `戰車 · HP ${Math.max(0, u.hp).toFixed(0)}${u.fireT > 0 ? ' · 裝填' : ''}`;
  if (isCarrier(u)) {
    const job = !u.mission ? '待命' : u.mission.kind === 'evac' ? { go: '前往', load: '裝載', back: '返航' }[u.phase] + ' ' + districts[u.mission.d].name : { fetch: '回基地取補給', deliver: '送補給' }[u.phase];
    return `${UT[u.type].name} · ${job} · 載 ${u.cargo}/${UT[u.type].cap} · HP ${Math.max(0, u.hp).toFixed(0)}`;
  }
  return `直升機 · ${u.z.toFixed(0)} m · HP ${Math.max(0, u.hp).toFixed(0)}${u.hang ? ' · 被抓 ' + u.hang : u.danger ? ' · 危險' : ''}`;
}
function hud(now) {
  if (now - lastHud < 250) return;
  lastHud = now;
  const selU = [...sel].map(unitById).filter(Boolean);
  const selTxt = control ? 'TAB 操控：' + unitLine(control) : selU.length === 1 ? unitLine(selU[0]) : selU.length ? `${selU.length} 個單位` : '—';
  const rows = [
    ['FPS', fps.toFixed(0)],
    ['GPU 模擬', hasTS ? gpuMs.sim.toFixed(2) + ' ms' : '—'],
    ['GPU 繪製', hasTS ? gpuMs.render.toFixed(2) + ' ms' : '—'],
    ['喪屍存活', fmt(sim.alive)],
    ['畫面中', fmt(sim.visible)],
    ['擊殺', fmt(sim.kills)],
    ['部隊', `${units.length} 個單位 · 損失 ${game.lost}`],
    ['選取', selTxt],
    ['牆', `${walls.length} 段 · ${wallLength()} m${damagedPanels() ? ` · 受損 ${damagedPanels()}` : ''} · 機槍堡 ${nests.length}`],
    ['爬牆中', fmt(sim.climbing)],
    ['屍堆最高', `${(sim.maxPile || 0).toFixed(1)} m`],
    ['時間', `${clockText()}  ${sim.speed ? sim.speed + '×' : '暫停'}`],
    ['補給', `${Math.floor(supply.stock).toLocaleString()} · 船 ${Math.ceil(supply.shipT)} 分`],
    ['救出', `${rescued.toLocaleString()} 人${queueLen() ? ' · 排隊 ' + queueLen().toLocaleString() : ''}`],
    ['倖存者', `${survivorsLeft().toLocaleString()} 人 · 死亡 ${survivorsDead().toLocaleString()}`],
    ['縮放', `${cam.ppm.toFixed(2)} px/m  ${Math.round((cam.pitch * 180) / Math.PI)}°`],
  ];
  document.querySelectorAll('[data-sup]').forEach((b) => { const c = support.cd[b.dataset.sup]; b.textContent = SUP[b.dataset.sup].name + (c > 0 ? ' ' + Math.ceil(c) : ''); b.style.opacity = c > 0 ? 0.55 : 1; });
  updateDistrictUI();
  renderEvents();
  updateNexusUI();
  updateQuarantineUI();
  $('statRows').innerHTML = rows.map(([a, b]) => `<div class="r"><span>${a}</span><span>${b}</span></div>`).join('');
  $('mode').textContent = control ? '直接操控' : cam.ppm < 1.6 ? '作戰地圖' : '戰術';
}

$('regionName').textContent = `· ${REGION.name}（${CAMPAIGN.current + 1}/${REGIONS.length}）`;
// ----- 主迴圈 -----
cam.x = fob.x; cam.y = fob.y + 140; cam.ppm = 6;
let last = performance.now();
function loop(now) {
  const dt = clamp((now - last) / 1000, 0, 0.1);   // rAF 時間戳可能早於初始化時的 performance.now()，第一幀會是負的
  last = now;
  fps = lerp(fps, 1 / Math.max(dt, 1e-4), 0.05);
  updateGame(dt);
  // 大爆炸震動畫面（只動鏡頭，畫完還原）
  const sk = support.shake * 2.2, shx = (Math.random() - 0.5) * sk, shy = (Math.random() - 0.5) * sk;
  cam.x += shx; cam.y += shy;
  updateDistrictColors();
  encodeFrame(dt, buildMarks(dt), buildFx(), buildUnits());
  cam.x -= shx; cam.y -= shy;
  placeLabels();
  sfx.tick(dt);
  hud(now);
  requestAnimationFrame(loop);
}
// 讀檔：網址帶 ?load=slot 就在開場前套用
if (params.get('load')) {
  try { await applySave(params.get('load')); } catch (e) { logEvent('讀檔失敗：' + e.message, 'bad'); }
  try { const q = new URLSearchParams(location.search); q.delete('load'); history.replaceState(null, '', '?' + q.toString()); } catch { /* file:// 不給改就算了 */ }
}
requestAnimationFrame(loop);

// ----- 測試掛鉤 -----
window.GAME = {
  get frames() { return frames; }, get fps() { return fps; }, gpuMs, errors, sim, cam, game, units,
  get helis() { return units.filter((u) => u.type === 'heli'); },
  info: { buildings: map.buildings.length, genMs: Math.round(genMs), spawnMs: Math.round(spawnMs), hasTS, fob },
  buildings: () => map.buildings,
  stats: () => ({ alive: sim.alive, visible: sim.visible, kills: sim.kills, time: sim.time, fps, gpu: { ...gpuMs }, n: sim.n,
    climbing: sim.climbing, maxPile: sim.maxPile, walls: walls.length, lost: game.lost,
    units: units.map((u) => ({ id: u.id, type: u.type, x: +u.x.toFixed(1), y: +u.y.toFixed(1), z: +u.z.toFixed(1), men: u.men, hp: +u.hp.toFixed(0), hang: u.hang, firing: u.firing })) }),
  view(x, y, ppm) { cam.x = x; cam.y = y; if (ppm) cam.ppm = ppm; return true; },
  debugRescue(n) { rescued += n; return rescued; },
  findPath: (a, b, c, d) => findPath(a, b, c, d), tileAt: (x, y) => map.t[(y | 0) * WN + (x | 0)],
  blockades, roadCandidates, get pathDangerCells() { let n = 0; for (const v of pathDanger) if (v > 0) n++; return n; },
  // 測試：Nexus 立刻挑某一類目標（預警時間可縮短）
  forceNexus(kind, warn = NEXUS_WARN) { const c = nexusCandidates().find((t) => t.kind === kind); if (!c) return null; Object.assign(nexus, { target: c, phase: 'warn', warnT: warn, t: 0 }); logEvent(`⚠ NEXUS 集結屍潮：${c.name}，約 ${warn} 分鐘後抵達`, 'bad'); return { name: c.name, x: c.x, y: c.y }; },
  async pileStats() { const f = new Float32Array(await readGpu(pileA, WN * WN * 4)); let n = 0, sum = 0; for (const v of f) if (v) { n++; sum += v; } return { n, sum }; },
  get panels() { return walls.flatMap((w, wi) => w.panels.map((p, k) => (p ? { wall: wi, k, id: p.id, hp: +p.hp.toFixed(1), x: (p.x0 + p.x1) / 2, y: (p.y0 + p.y1) / 2 } : null)).filter(Boolean)); }, get breaches() { return game.breaches || 0; }, livePanels,
  listSaves, slots: SLOTS, get autoT() { return autoT; }, set autoT(v) { autoT = v; },
  nests, placeNest, removeNestAt, quarantine, setQPolicy, queueLen, qEnqueue(n, inf, turnIn, dk = 1) { quarantineEnqueue(n, Array.from({ length: inf }, () => sim.time + turnIn), dk); return queueLen(); }, saveGame, requestLoad, saveInfo, async sampleAgents(k = 64) { return [...new Float32Array(await readGpu(agentsB, k * 16))]; }, async sampleInfo(k = 64) { return [...new Uint32Array(await readGpu(infoB, k * 8))]; },
  op, endOperation, campaign: CAMPAIGN, region: REGION, regions: REGIONS, showCampaignMap, sprites: SPRITES, sfx, dayNight, nexus, nexusCandidates, districts, events, clockText, supply, outposts, get rescued() { return rescued; }, deploy, placeOutpost, orderAt, support, callSupport, setSupport, strike, addBeacon, setSpeed, setTool, setAlt: setAltSel, setAgents: (n) => setAgents(n),
  // 戰鬥特效（M16）：粒子數、殘骸數、某類地面標記數、這幀的單位實例數
  fx: { get particles() { return nParts; }, get wrecks() { return wrecks.length; }, marks: (type) => game.marks.filter((m) => m.type === type).length, get instances() { return game.unitInstances; }, maxParticles: MAX_PARTS, maxInstances: MAX_UNITS, explode: (x, y, size) => fxExplosion(x, y, size) },
  select(ids) { sel.clear(); for (const id of ids) sel.add(id); return [...sel]; },
  get selection() { return [...sel]; },
  order: (x, y) => orderMove(x, y),
  control(id) { control = id == null ? null : unitById(id) || null; return control ? control.id : null; },
  aimAt(x, y, firing) { aim.sx = -1; aim.x = x; aim.y = y; aim.firing = !!firing; },
  spawnUnit: (type, x, y) => spawnUnit(type, x, y)?.id ?? null,
  heliTo(x, y, z) { const h = units.find((u) => u.type === 'heli'); if (!h) return false; h.tx = x; h.ty = y; if (z != null) h.tz = z; return true; },
  placeWall: (ax, ay, bx, by) => placeWall(wallRect(ax, ay, bx, by)), repairCost: (ax, ay, bx, by) => repairCost(wallRect(ax, ay, bx, by)),
  async agentAt(i) { return [...new Float32Array(await readGpu(agentsB, 16, i * 16))]; },
  // 破牆者是依編號決定的（跟 WGSL 的 pcg 一樣）
  isBrute(i) { let s = (Math.imul(i * 3 + 17, 747796405) + 2891336453) >>> 0; let w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0; w = ((w >>> 22) ^ w) >>> 0; return ((w >>> 20) & 1023) < BRUTE_K; },
  damagePanel(id, hp) { const e = panelById[id]; if (!e) return false; e[0].panels[e[1]].hp = hp; wallsHit = true; return true; },
  removeWallAt, get walls() { return walls.map((w) => [w.x0, w.y0, w.x1, w.y1]); },
  setRelax(k) { sim.relaxIters = Math.max(2, k & ~1); return sim.relaxIters; },
  // 視窗像素座標 → 地面座標（跟滑鼠縮放用同一個函式）
  groundAt(px, py) { const r = canvas.getBoundingClientRect(); return screenToGround((px - r.left) / r.width, (py - r.top) / r.height); },
};
