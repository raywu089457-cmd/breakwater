// ---------- 作戰中途存檔：GPU 上的喪屍（位置/速度/狀態）與屍堆讀回來，連同遊戲狀態存進 IndexedDB ----------
// 讀檔＝帶參數重新載入頁面（乾淨的初始狀態），開場前套用存檔，避免半套狀態殘留。
const SAVE_VER = 2, SAVE_SLOT = 'slot1';
// 三格手動存檔＋一格自動存檔（每 AUTOSAVE_EVERY 遊戲分鐘）；F5/F9 是存檔 1 的快速存讀
const SLOTS = [['slot1', '存檔 1'], ['slot2', '存檔 2'], ['slot3', '存檔 3'], ['auto', '自動存檔']];
const slotName = (k) => (SLOTS.find((s) => s[0] === k) || [k, k])[1];
const AUTOSAVE_EVERY = 120;
let autoT = AUTOSAVE_EVERY;
// 屍堆大部分是 0：只存有值的格（4M 格 → 通常幾千格）
function packPile(buf) {
  const f = new Float32Array(buf);
  let n = 0;
  for (let i = 0; i < f.length; i++) if (f[i] !== 0) n++;
  const idx = new Uint32Array(n), val = new Float32Array(n);
  for (let i = 0, j = 0; i < f.length; i++) if (f[i] !== 0) { idx[j] = i; val[j++] = f[i]; }
  return { idx: idx.buffer, val: val.buffer };
}
function unpackPile(s) {
  if (s.pile) return s.pile;   // 第 1 版：整張存
  const f = new Float32Array(WN * WN), idx = new Uint32Array(s.pileIdx), val = new Float32Array(s.pileVal);
  for (let j = 0; j < idx.length; j++) f[idx[j]] = val[j];
  return f.buffer;
}
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('breakwater', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('saves');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idbOpen();
  try {
    return await new Promise((res, rej) => {
      const tx = db.transaction('saves', mode);
      const req = fn(tx.objectStore('saves'));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = tx.onabort = () => rej(tx.error || new Error('IndexedDB 交易失敗'));
    });
  } finally { db.close(); }
}
const idbPut = (key, val) => idbDo('readwrite', (st) => st.put(val, key));
const idbGet = (key) => idbDo('readonly', (st) => st.get(key));
async function readGpu(buffer, bytes, offset = 0) {
  const st = device.createBuffer({ size: Math.ceil(bytes / 4) * 4, usage: GBU.MAP_READ | GBU.COPY_DST });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(buffer, offset, st, 0, Math.ceil(bytes / 4) * 4);
  device.queue.submit([enc.finish()]);
  await st.mapAsync(GPUMapMode.READ);
  const out = st.getMappedRange().slice(0);
  st.unmap(); st.destroy();
  return out;
}
const saving = { busy: false };
async function saveGame(slot = SAVE_SLOT, auto = false) {
  if (saving.busy || !SLOTS.some((s) => s[0] === slot)) return null;
  saving.busy = true;
  try {
    // 先把 CPU 狀態拍下來，接著立刻排 GPU 複製 —— 兩者是同一個時間點
    const t0 = performance.now();
    const state = {
      ver: SAVE_VER, savedAt: Date.now(), region: CAMPAIGN.current, regionName: REGION.name, clock: clockText(), alive: sim.alive, rescued, auto,
      sim: { time: sim.time, n: sim.n, kills: sim.kills },
      cam: { x: cam.x, y: cam.y, ppm: cam.ppm },
      game: { beacons: game.beacons, lost: game.lost, friendly: game.friendly || 0, ciws: game.ciws, shots: game.shots },
      supply: { ...supply }, rescued,
      outposts: outposts.map((o) => ({ ...o })),
      walls: walls.map((w) => ({ r: [w.x0, w.y0, w.x1, w.y1], hp: w.panels.map((p) => (p ? p.hp : 0)) })),   // 每片牆板的耐久（0＝已經碎了）
      units: units.map((u) => ({ id: u.id, type: u.type, x: u.x, y: u.y, z: u.z, tx: u.tx, ty: u.ty, tz: u.tz, hp: u.hp, men: u.men, dmg: u.dmg, face: u.face,
        cargo: u.cargo, infected: u.infected || [], supplyLoad: u.supplyLoad, mission: u.mission, phase: u.phase, landed: !!u.landed, hang: u.hang, fireT: u.fireT })),
      nextUnitId,
      districts: districts.map((d) => ({ pop: d.pop, dead: d.dead, turned: d.turned, rescued: d.rescued, evacuated: d.evacuated || 0, state: d.state, calm: d.calm, opening: !!d.opening, lossF: d.lossF || 0 })),
      nexus: { t: nexus.t, phase: nexus.phase, warnT: nexus.warnT, attackT: nexus.attackT, attacks: nexus.attacks, history: nexus.history,
        target: nexus.target ? { kind: nexus.target.kind, name: nexus.target.name, x: nexus.target.x, y: nexus.target.y, value: nexus.target.value,
          ref: nexus.target.kind === 'shelter' ? nexus.target.ref.k : nexus.target.kind === 'outpost' ? nexus.target.ref.id : nexus.target.ref ? nexus.target.ref.id : null } : null },
      support: { cd: { ...support.cd } },
      events: events.slice(0, 30),
      op: { overrunT: op.overrunT, pop0: op.pop0 },
      quarantine: JSON.parse(JSON.stringify(quarantine)),
      nests: nests.map((n) => ({ ...n })), nextNestId,
      blockades: blockades.map((b) => ({ ...b })), nextBlockId,
    };
    const n = sim.n;
    const [agents, info, pile] = await Promise.all([readGpu(agentsB, n * 16), readGpu(infoB, n * 8), readGpu(pileA, WN * WN * 4)]);
    const pk = packPile(pile);
    state.agents = agents; state.info = info; state.pileIdx = pk.idx; state.pileVal = pk.val;
    await idbPut(slot, state);
    const ms = Math.round(performance.now() - t0);
    const mb = ((agents.byteLength + info.byteLength) / 1048576).toFixed(0);
    logEvent(auto ? `自動存檔（${state.clock}，${ms} ms）` : `已存檔到${slotName(slot)}（${state.clock}，${mb} MB 屍潮資料，${ms} ms）`, auto ? 'info' : 'good');
    return { slot, clock: state.clock, ms, bytes: agents.byteLength + info.byteLength + pk.idx.byteLength + pk.val.byteLength, pileCells: pk.idx.byteLength / 4 };
  } catch (e) {
    logEvent('存檔失敗：' + e.message, 'bad');
    return null;
  } finally { saving.busy = false; }
}
async function saveInfo(slot = SAVE_SLOT) {
  try { const s = await idbGet(slot); return s ? { slot, region: s.region, regionName: s.regionName, clock: s.clock, savedAt: s.savedAt, n: s.sim.n, alive: s.alive, rescued: s.rescued } : null; } catch { return null; }
}
const listSaves = () => Promise.all(SLOTS.map(([k]) => saveInfo(k)));
// 自動存檔：每 2 遊戲小時一次（作戰結束後不存）
function updateAutosave(sdt) {
  autoT -= sdt;
  if (autoT > 0) return;
  autoT = AUTOSAVE_EVERY;
  if (!op.over && !saving.busy) saveGame('auto', true);
}
// 讀檔入口：換頁到存檔的戰區，開場時套用
async function requestLoad(slot = SAVE_SLOT) {
  const info = await saveInfo(slot);
  if (!info) { logEvent('沒有存檔', 'bad'); return false; }
  const q = new URLSearchParams(location.search);
  q.set('region', info.region); q.set('load', slot); q.delete('n');
  location.search = q.toString();
  return true;
}
// 開場前套用存檔（11-game 在開始主迴圈前呼叫）
async function applySave(slot) {
  const s = await idbGet(slot);
  if (!s || s.ver > SAVE_VER) throw new Error('存檔不存在或版本不符');
  if (s.region !== CAMPAIGN.current) throw new Error('存檔不是這個戰區的');
  sim.time = s.sim.time;
  // 喪屍：位置、速度、狀態（屍體的死亡時間也在裡面，時間已還原所以會照常腐化）
  device.queue.writeBuffer(agentsB, 0, s.agents);
  device.queue.writeBuffer(infoB, 0, s.info);
  if (sim.n > s.sim.n) device.queue.writeBuffer(infoB, s.sim.n * 8, new Uint32Array((sim.n - s.sim.n) * 2));
  sim.n = s.sim.n;
  const pile = unpackPile(s);
  device.queue.writeBuffer(pileA, 0, pile);
  device.queue.writeBuffer(pileB, 0, pile);
  device.queue.writeBuffer(countersB, 4, new Uint32Array([s.sim.kills]));
  sim.kills = s.sim.kills;
  // 牆（前哨的牆也在裡面）
  for (const e of s.walls) {
    const [x0, y0, x1, y1] = Array.isArray(e) ? e : e.r;   // 第 1 版只有矩形
    if (!placeWall({ x0, y0, x1, y1 }, true) || Array.isArray(e)) continue;
    const w = walls[walls.length - 1];
    e.hp.forEach((hp, k) => { if (w.panels[k]) { if (hp <= 0) dropPanel(w, k); else w.panels[k].hp = hp; } });
  }
  wallsHit = true; flushWalls();
  outposts.length = 0; outposts.push(...s.outposts);
  // 部隊：靜悄悄清掉開局部隊，照存檔重建
  slots.fill(null); units.length = 0; sel.clear(); control = null;
  for (const d of s.units) {
    const u = spawnUnit(d.type, d.x, d.y);
    if (!u) continue;
    Object.assign(u, d, { slot: u.slot, path: [] });
    if (!isAir(u) && Math.hypot(u.tx - u.x, u.ty - u.y) > 3) u.path = findPath(u.x, u.y, u.tx, u.ty) || [];
  }
  nextUnitId = s.nextUnitId;
  s.districts.forEach((d, k) => Object.assign(districts[k], d));
  Object.assign(supply, s.supply);
  rescued = s.rescued;
  Object.assign(nexus, { t: s.nexus.t, phase: s.nexus.phase, warnT: s.nexus.warnT, attackT: s.nexus.attackT, attacks: s.nexus.attacks, history: s.nexus.history, target: null });
  if (s.nexus.target) {
    const t = s.nexus.target;
    const ref = t.kind === 'shelter' ? districts[t.ref] : t.kind === 'outpost' ? outposts.find((o) => o.id === t.ref) : t.ref != null ? units.find((u) => u.id === t.ref) : null;
    nexus.target = { ...t, ref };
  }
  Object.assign(support.cd, s.support.cd);
  events.length = 0; events.push(...s.events);
  Object.assign(game, { beacons: s.game.beacons, lost: s.game.lost, friendly: s.game.friendly, ciws: s.game.ciws, shots: s.game.shots });
  $('ciws').classList.toggle('on', game.ciws);
  op.overrunT = s.op.overrunT; op.pop0 = s.op.pop0;
  if (s.quarantine) { Object.assign(quarantine, s.quarantine); setQPolicy(quarantine.policy); }
  if (s.nests) { nests.length = 0; nests.push(...s.nests); nextNestId = s.nextNestId; }
  if (s.blockades) { blockades.length = 0; blockades.push(...s.blockades); nextBlockId = s.nextBlockId; rebuildDanger(); }
  cam.x = s.cam.x; cam.y = s.cam.y; cam.ppm = s.cam.ppm;
  setSpeed(0);   // 讀檔後先暫停，讓玩家看清楚再開時間
  autoT = AUTOSAVE_EVERY;
  logEvent(`讀取存檔：${slotName(slot)} · ${s.regionName} ${s.clock}（已暫停，按空白繼續）`, 'good');
  return s;
}
