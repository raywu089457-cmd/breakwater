// ---------- 後勤：補給庫存、補給船、部署部隊、前哨基地、卡車／運輸直升機撤離與補給線 ----------
const COST = { squad: 100, tank: 300, heli: 250, truck: 80, transport: 150, outpost: 250 };
const SUPPORT_COST = { artillery: 60, naval: 80, air: 120, tomahawk: 250 };
const WALL_COST_PER_M = 2;
const SHIP_EVERY = 120, SHIP_LOAD = 500;            // 每 2 遊戲小時一艘補給船，+500
const OUTPOST_R = 70, OUTPOST_RATE = 15, OUTPOST_CAP = 400, MAX_OUTPOSTS = 9;
const supply = { stock: 1500, shipT: SHIP_EVERY, used: 0, delivered: 0 };
const outposts = [];
let rescued = 0;

function useSupply(n) { const k = Math.min(supply.stock, n); supply.stock -= k; supply.used += k; return k; }
function spend(n, what) {
  if (supply.stock < n) { logEvent(`補給不足：${what || ''}需要 ${n}，庫存 ${Math.floor(supply.stock)}`, 'bad'); return false; }
  useSupply(n);
  return true;
}
// 部署：在基地北側集結點生成，扣補給
function deploy(type) {
  if (!spend(COST[type], UT[type].name)) return null;
  const k = units.length;
  const u = spawnUnit(type, fob.x - 40 + (k % 5) * 20, fob.y + 30 + Math.floor(k / 5) * 12);
  if (!u) { supply.stock += COST[type]; supply.used -= COST[type]; logEvent('部隊已達上限（20）', 'bad'); return null; }
  logEvent(`${UT[type].name} 已部署（−${COST[type]}）`);
  return u;
}
// 前哨：28 m 見方，四邊中間各留 12 m 門（只蓋四個角的 L 形牆），不管哪邊靠建築都進得去；自己的近防（耗前哨庫存）
function placeOutpost(x, y) {
  if (outposts.length >= MAX_OUTPOSTS) { logEvent('前哨已達上限', 'bad'); return null; }
  const H = 14, gap = 6;   // 部隊尋路格是 4 m、含牆就擋，門要至少兩格寬
  if (blockedW(x, y)) { logEvent('這裡不能蓋前哨', 'bad'); return null; }   // 角落壓到建築的那段牆就不蓋
  if (!spend(COST.outpost, '前哨')) return null;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    placeWall(wallRect(x + sx * gap, y + sy * H, x + sx * H, y + sy * H), true);   // 橫的一段
    placeWall(wallRect(x + sx * H, y + sy * gap, x + sx * H, y + sy * H), true);   // 直的一段
  }
  const o = { id: outposts.length + 1, x, y, stock: 150, name: `前哨 ${outposts.length + 1}` };
  outposts.push(o);
  logEvent(`${o.name} 建立（−${COST.outpost}）`, 'good');
  return o;
}
function cargoLost(u) {
  if (u.cargo > 0) {
    const d = districts[u.mission?.d ?? -1];
    if (d) d.dead += u.cargo;
    logEvent(`${UT[u.type].name} 被擊毀，${u.cargo} 名倖存者罹難`, 'bad');
    u.cargoLogged = true;
    u.cargo = 0; u.infected = [];
  }
}
// 右鍵命令：運輸單位點避難所＝撤離、卡車點前哨＝補給線，其他照一般移動
function orderAt(x, y) {
  const list = [...sel].map(unitById).filter(Boolean);
  const shelter = shelters.find((d) => Math.hypot(d.sx - x, d.sy - y) < 28 && d.pop > 0);
  const op = outposts.find((o) => Math.hypot(o.x - x, o.y - y) < 20);
  const rest = [];
  for (const u of list) {
    if (isCarrier(u) && shelter) { u.mission = { kind: 'evac', d: shelter.k }; u.phase = 'go'; routeTo(u, shelter.sx, shelter.sy); }
    else if (u.type === 'truck' && op) { u.mission = { kind: 'supply', o: op.id }; u.phase = 'fetch'; routeTo(u, fob.x, fob.y + 15); }
    else { u.mission = null; u.phase = null; u.landed = false; if (isAir(u) && u.tz < 15) u.tz = 40; rest.push(u.id); }
  }
  if (rest.length) orderMove(x, y, rest);
  return list.length;
}
function routeTo(u, x, y) {
  u.tx = x; u.ty = y;
  if (isAir(u)) { u.tz = 40; u.landed = false; u.path = []; return true; }
  const p = findPath(u.x, u.y, x, y);
  if (!p) { logEvent(`${UT[u.type].name} 無法到達目的地，任務取消`, 'bad'); u.mission = null; u.phase = null; u.path = []; return false; }
  u.path = p;
  return true;
}
const near = (u, x, y, r) => Math.hypot(u.x - x, u.y - y) < r;
function updateCarrier(u, sdt) {
  const m = u.mission, t = UT[u.type];
  if (!m) return;
  if (m.kind === 'evac') {
    const d = districts[m.d];
    if (u.phase === 'go' && near(u, d.sx, d.sy, isAir(u) ? 6 : 10)) { u.phase = 'load'; if (isAir(u)) { u.tz = 3; u.landed = true; } }
    if (u.phase === 'load') {
      if (isAir(u) && u.z > 4.5) return;                     // 還在下降
      u.loadF = (u.loadF || 0) + t.load * sdt;
      const k = Math.min(Math.floor(u.loadF), t.cap - u.cargo, d.pop);
      if (k > 0) { u.loadF -= k; u.cargo += k; d.pop -= k; u.infected = (u.infected || []).concat(pickupInfected(k, d)); }
      if (u.cargo >= t.cap || d.pop <= 0) { u.phase = 'back'; routeTo(u, fob.x, fob.y + 10); }
    }
    if (u.phase === 'back' && near(u, fob.x, fob.y + 10, isAir(u) ? 8 : 18)) {
      if (u.cargo) { quarantineEnqueue(u.cargo, u.infected || [], d.k); d.evacuated = (d.evacuated || 0) + u.cargo; logEvent(`${UT[u.type].name} 從 ${d.name} 撤回 ${u.cargo} 人，送檢疫站`, 'good'); }
      u.cargo = 0; u.infected = [];
      if (d.pop > 0) { u.phase = 'go'; routeTo(u, d.sx, d.sy); } else { u.mission = null; u.phase = null; }
    }
  } else if (m.kind === 'supply') {
    const o = outposts.find((q) => q.id === m.o);
    if (!o) { u.mission = null; return; }
    if (u.phase === 'fetch' && near(u, fob.x, fob.y + 15, 18)) {
      u.supplyLoad = useSupply(100); u.phase = 'deliver'; routeTo(u, o.x, o.y);
    }
    if (u.phase === 'deliver' && near(u, o.x, o.y, 16)) {
      o.stock = Math.min(OUTPOST_CAP, o.stock + u.supplyLoad); u.supplyLoad = 0;
      u.phase = 'fetch'; routeTo(u, fob.x, fob.y + 15);
    }
  }
}
function updateLogistics(sdt) {
  supply.shipT -= sdt;
  if (supply.shipT <= 0) { supply.shipT += SHIP_EVERY; supply.stock += SHIP_LOAD; supply.delivered += SHIP_LOAD; logEvent(`補給船抵達碼頭：+${SHIP_LOAD}`, 'good'); }
  // 彈藥消耗（戰車主砲另外扣）
  let use = 0;
  for (const u of units) if (u.firing) use += u.type === 'squad' ? 0.08 * u.men : u.type === 'heli' ? 0.6 : u.type === 'transport' ? 0.2 : u.type === 'tank' ? 0.3 : 0;
  if (game.ciws && sim.zoneCounts[0] > 0) use += 1.5;
  useSupply(use * sdt);
  for (const o of outposts) if (o.stock > 0 && sim.zoneCounts[55 + o.id - 1] > 0) o.stock = Math.max(0, o.stock - 1 * sdt);
  for (const u of units) if (isCarrier(u)) updateCarrier(u, sdt);
}
function outpostZones(z) {
  for (let k = 0; k < MAX_OUTPOSTS; k++) {
    const o = outposts[k], i = 55 + k;
    z[i] = o && o.stock > 0 ? [o.x, o.y, OUTPOST_R, Math.min(4, OUTPOST_RATE / Math.max(sim.zoneCounts[i], 1))] : [0, 0, 0, 0];
  }
}
function outpostTargets() { return outposts.map((o) => [o.x, o.y, 8, o.stock > 0 && sim.zoneCounts[55 + o.id - 1] > 0 ? 80 : 30]); }
function outpostMarks(push) {
  for (const o of outposts) {
    push(o.x, o.y, OUTPOST_R, 0, o.stock > 0 ? [0.35, 0.75, 1] : [0.6, 0.6, 0.6], 0.5);
    push(o.x, o.y, 6, 0, o.stock > 0 ? [0.35, 0.75, 1] : [1, 0.3, 0.2], 1);
  }
}
