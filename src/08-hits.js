// ---------- 命中對齊：爆炸畫面跟模擬用同一個點、同一個半徑；GPU 回報的擊殺位置拿來畫曳光彈與血花 ----------
// 爆炸圖寬 ÷ 殺傷半徑：圖上的火球約占圖寬 70%，所以火球半徑 ≈ 殺傷半徑 × 0.85；衝擊波圈＝殺傷半徑
const FX_PER_R = 2.4;
// 測試用：最近的爆炸（x, y, 殺傷半徑, 高度）、擊殺紀錄（x, y, 來源）、真的打死人的曳光彈終點
const hitStats = { kills: 0, booms: [], log: [], shots: [], maxAge: 0.5 };   // maxAge：擊殺紀錄晚到超過幾秒（模擬時間）就不畫
const keep = (arr, v, n = 256) => { arr.push(v); if (arr.length > n) arr.shift(); };
// 所有爆炸（戰車主砲、砲兵、艦砲、空襲、戰斧、載具被毀、測試砲擊）都走這裡：殺傷、爆炸圖、粒子、焦痕同一個中心
// z＞0＝打在屋頂上（爆炸畫在屋頂，地面不留焦痕）
function detonate(x, y, r, lethal, z = 0, scorchLife = 90) {
  sim.strikesOnce.push([x, y, r, lethal]);
  keep(hitStats.booms, [x, y, r, z, sim.time], 64);
  const size = r * FX_PER_R;
  game.fx.push([x, y, size, sim.time, z]);
  fxExplosion(x, y, size, r, z);
  if (z < 0.5) game.marks.push({ type: 3, x, y, r: r * 0.75, life: scorchLife, max: scorchLife });
  return size;
}
// 誰開的槍：殺傷區 1+2s＝部隊 s 的火力、2+2s＝輾壓；機槍堡 NEST.zone0+k；射擊線＝直接操控的單位
function onKills(e, n) {
  let splash = 0;
  hitStats.kills += n;
  for (let k = 0; k < n; k++) {
    const x = e[k * 4], y = e[k * 4 + 1], src = e[k * 4 + 2] | 0, t = e[k * 4 + 3];
    if (sim.time - t > hitStats.maxAge) continue;   // 讀回太晚（GPU 落後、切頁）就不畫了
    keep(hitStats.log, [x, y, src, t], 512);
    if (src >= 100 && src < 200) { if (splash++ < 48) fxKillSplash(x, y); continue; }   // 被炸死的：在屍體原位噴血
    if (src >= 200) { if (control) shotAt(control, x, y); continue; }
    if (src >= 1 && src <= USLOTS * 2) {
      const u = slots[(src - 1) >> 1];
      if (u && ((src - 1) & 1) === 0) shotAt(u, x, y); else fxImpact(x, y);
      continue;
    }
    if (src >= NEST.zone0 && src < NEST.zone0 + NEST.max) { const ns = nests[src - NEST.zone0]; if (ns) nestShotAt(ns, x, y); continue; }
    fxImpact(x, y);   // 近防、避難所民兵、前哨：只在打中的地方噴血
  }
}
// 槍口位置：步兵班挑一個士兵、載具從車身、直升機從機身（畫面高度）
function muzzleOf(u) {
  if (u.type === 'squad') { const [sx, sy] = soldierPos(u, (Math.random() * u.men) | 0); return [sx + Math.cos(u.face) * 0.7, sy + Math.sin(u.face) * 0.7, 1.25]; }
  return [u.x + Math.cos(u.face) * 2, u.y + Math.sin(u.face) * 2, isAir(u) ? visZ(u) : u.type === 'tank' ? 2.4 : 1.25];
}
// 一發真的打死喪屍的子彈：曳光彈從槍口畫到那隻喪屍倒下的位置，血花也在那裡
function shotAt(u, x, y) {
  const [mx, my, mz] = muzzleOf(u);
  tracers.push([mx, my, mz, x, y, 0.8, 0.07, 0]);
  keep(hitStats.shots, [x, y, u.id]);
  fxMuzzle(mx, my, mz, false);
  fxImpact(x, y, true);
  u.lastHit = [x, y, sim.time];
}
function nestShotAt(ns, x, y) {
  tracers.push([ns.x, ns.y, 1.2, x, y, 0.8, 0.07, 0]);
  fxImpact(x, y, true);
  ns.lastHit = [x, y, sim.time];
}
// 沒打死人的子彈（純畫面，讓槍聲連續）：瞄最近打中的地方附近；中間隔著建築就打在牆上
function missShot(mx, my, mz, u, r, ground) {
  const h = u.lastHit && sim.time - u.lastHit[2] < 1.5 ? u.lastHit : [u.aimX, u.aimY];
  let hx = h[0] + (Math.random() - 0.5) * r * 2, hy = h[1] + (Math.random() - 0.5) * r * 2, hz = 0.8;
  const hit = ground ? rayHitBuilding(mx, my, mz, hx, hy, hz) : null;
  if (hit) [hx, hy, hz] = hit;
  tracers.push([mx, my, mz, hx, hy, hz, 0.07, 0]);
  fxMiss(hx, hy, hz);
}
