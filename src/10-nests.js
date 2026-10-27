// ---------- 機槍堡：可蓋的固定防禦（沙包＋重機槍）——開火耗補給、被貼身的喪屍啃會壞 ----------
const NEST = { cost: 120, r: 45, rate: 8, hp: 600, bite: 0.6, use: 0.15, contactR: 5, max: 12, zone0: 64 };
const nests = [];
let nextNestId = 1;
const nestProbeBase = () => SHELTER_SLOT0 + shelters.length + 1;   // 部隊 20、避難所 14、基地 1 之後

function placeNest(x, y) {
  if (nests.length >= NEST.max) { logEvent(`機槍堡已達上限（${NEST.max}）`, 'bad'); return null; }
  if (blockedW(x, y) || nests.some((n) => Math.hypot(n.x - x, n.y - y) < 8)) { logEvent('這裡不能蓋機槍堡', 'bad'); return null; }
  if (!spend(NEST.cost, '機槍堡')) return null;
  const n = { id: nextNestId++, x, y, hp: NEST.hp, firing: false, aimX: x, aimY: y + 10, face: Math.PI / 2, kills: 0 };
  nests.push(n);
  logEvent(`機槍堡 ${n.id} 建好了（−${NEST.cost}）`, 'good');
  return n;
}
function removeNestAt(x, y) {
  const k = nests.findIndex((n) => Math.hypot(n.x - x, n.y - y) < 6);
  if (k < 0) return false;
  supply.stock += Math.floor(NEST.cost / 2);   // 拆掉退一半
  logEvent(`機槍堡 ${nests[k].id} 拆除（退回 ${Math.floor(NEST.cost / 2)}）`);
  nests.splice(k, 1);
  return true;
}
function nestProbes() {
  const out = [];
  for (let k = 0; k < NEST.max; k++) { const n = nests[k]; out.push(n ? [n.x, n.y, 0, NEST.contactR] : [-5000, -5000, 0, 0]); }
  return out;
}
function updateNests(sdt) {
  const P = sim.probe, b0 = nestProbeBase();
  for (let k = nests.length - 1; k >= 0; k--) {
    const n = nests[k], b = (b0 + k) * 8;
    const contact = P[b], inr = P[b + 1];
    const cx = inr ? P[b + 2] / inr - 64 : 0, cy = inr ? P[b + 3] / inr - 64 : 0;
    n.firing = inr > 0 && supply.stock > 0;
    if (n.firing) {
      n.aimX = n.x + cx; n.aimY = n.y + cy; n.face = Math.atan2(cy, cx);
      useSupply(NEST.use * sdt);
      if (Math.random() < sdt * 5) missShot(n.x, n.y, 1.2, n, 2, true);   // 打死的那幾發由擊殺紀錄畫（nestShotAt）
    }
    n.hp -= contact * NEST.bite * sdt;
    if (n.hp <= 0) {
      explodeAt(n.x, n.y, 5, 0.6);
      logEvent(`機槍堡 ${n.id} 被屍潮淹沒`, 'bad');
      game.lost++;
      nests.splice(k, 1);
    }
  }
}
function nestZones(z) {
  for (let k = 0; k < NEST.max; k++) {
    const n = nests[k], i = NEST.zone0 + k;
    z[i] = n && n.firing ? [n.x, n.y, -NEST.r, Math.min(4, NEST.rate / Math.max(sim.zoneCounts[i], 1))] : [0, 0, 0, 0];
  }
}
function nestTargets() { return nests.filter((n) => n.firing).map((n) => [n.x, n.y, 5, 60]); }
function pushNestInstances(push) {
  const s = SPRITES.nest;
  if (!s) return;
  const w = 7.5, h = (w * s.cellH) / s.cellW, lv = pickLod(cam.ppm, s, h);
  for (const n of nests) {
    const fr = n.firing && (Math.floor(sim.time * 14) & 1) ? 1 : 0;
    push([n.x, n.y, 0, w], [h, lv.x + fr * lv.cw, lv.y, 5], [lv.cw, lv.ch, 1, (n.hp < NEST.hp * 0.35 && Math.sin(sim.time * 10) > 0 ? 2 : 0) | (Math.cos(n.face) < 0 ? 1 : 0)]);
  }
}
function nestMarks(push) {
  for (const n of nests) {
    if (game.tool === 'nest') push(n.x, n.y, NEST.r, 0, [0.95, 0.8, 0.35], 0.35);
    if (n.hp < NEST.hp * 0.5) push(n.x, n.y, 5, 1, [1, 0.3, 0.2], 0.6);
  }
}
