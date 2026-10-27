// M17 驗證：單位 ↔ 建築碰撞、單位 ↔ 單位碰撞、直升機越樓、爆炸／曳光彈跟 GPU 算到的命中位置對齊、隔著建築打不到、砲彈撞樓。
// 用法：node tools/headed_m17.mjs（本機開 Chrome 視窗；在雲端容器裡自動改用內建 Chromium + SwiftShader 無頭跑，見 tools/browser.mjs）
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { launch, cloud, canvasShot } from './browser.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
const W = 960, H = 540;
const browser = await launch(W, H);
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };
const g = (fn, arg) => page.evaluate(fn, arg);
const shot = (n) => (cloud ? canvasShot(page, join(outDir, `m17-${n}.png`)) : page.screenshot({ path: join(outDir, `m17-${n}.png`) }));
// 在頁面裡每一遊戲幀跑 probe(…)，直到 done(…) 成立或超過 maxFrames 幀；回傳 probe 的最大值與是否完成
// （數的是 GAME.frames：GPU 跟不上時畫面會跳過幀，rAF 次數不算數）
const watch = (probe, done, maxFrames) => g(([p, d, n]) => new Promise((res) => {
  const P = new Function('return ' + p)(), D = new Function('return ' + d)();
  let worst = 0, f = 0, seen = GAME.frames;
  const tick = () => {
    if (GAME.frames !== seen) { seen = GAME.frames; worst = Math.max(worst, P()); f++; if (D() || f >= n) return res({ worst, done: D(), frames: f }); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), [probe.toString(), done.toString(), maxFrames]);

await page.goto(pathToFileURL(join(here, '..', 'index.html')).href + '?n=20000');
await page.waitForFunction(() => window.GAME && GAME.frames > 5, null, { timeout: 300000 });
// 軟體 GPU（SwiftShader）會落後好幾秒，擊殺紀錄晚到也照畫，不然測不到
// 流場鬆弛次數調低、4 倍速：軟體 GPU 每秒只跑 1–2 幀，這樣整組幾分鐘跑得完（測的是單位與命中，不是屍群尋路）
await g(() => { GAME.setSpeed(4); GAME.setRelax(4); GAME.game.ciws = false; GAME.hits.maxAge = 1e9; });

// 找一棟合適的建築：離基地 170–700 m、寬 10–24 m、夠高（直升機要越過）、西邊臨南北向的路（戰車／步兵站得下）；
// 再找一個離它 80–160 m、戰車開得到的點當「穿過街區」的終點
const site = await g(() => {
  const fob = GAME.info.fob, C = GAME.collide;
  for (const b of GAME.buildings()) {
    const [x0, y0, x1, y1, h] = b, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0;
    const df = Math.hypot(cx - fob.x, cy - fob.y);
    if (df < 170 || df > 700 || w < 10 || w > 24 || y1 - y0 < 10 || h < 10) continue;
    if (C.clearAt(x0 - 8, cy) < 3.2 || C.clearAt(x0 - 8, cy - 25) < 2.5 || C.clearAt(x0 - 8, cy + 25) < 2.5) continue;
    let goal = null;
    for (let a = 0; a < 6.28 && !goal; a += 0.2) for (let d = 160; d >= 80 && !goal; d -= 10) { const gx = cx + Math.cos(a) * d, gy = cy + Math.sin(a) * d; if (gx > x1 && C.clearAt(gx, gy) >= 4 && GAME.findPath(x0 - 8, cy, gx, gy, 3)) goal = [gx, gy]; }
    if (goal) return { x0, y0, x1, y1, h, cx, cy, sx: x0 - 8, goal };
  }
  return null;
});
check('found a test building on a street', !!site, JSON.stringify(site));
// 空曠的地方（放一群喪屍、讓 5 個單位擠在一起）：離基地 180 m 以上、9 m 內沒有障礙
const open = await g(() => { const fob = GAME.info.fob, C = GAME.collide; for (let d = 180; d < 900; d += 20) for (let a = 0; a < 6.28; a += 0.15) { const x = fob.x + Math.cos(a) * d, y = fob.y + Math.sin(a) * d; if (C.clearAt(x, y) >= 9 && C.clearAt(x - 18, y + 2) >= 5) return { x, y }; } return null; });
check('found an open square', !!open, JSON.stringify(open));
if (!site || !open) { console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`); await browser.close(); process.exit(1); }
const park = () => g(() => { const f = GAME.info.fob; GAME.units.forEach((u, k) => { u.x = f.x - 60 + (k % 6) * 15; u.y = f.y + 40 + Math.floor(k / 6) * 15; u.tx = u.x; u.ty = u.y; u.path = []; }); });

// ---- 1. 單位 ↔ 建築：硬塞進牆裡的戰車會被推出來；穿過市區開到 80–160 m 外，全程不穿牆 ----
await park();
const tankId = await g(() => GAME.units.find((u) => u.type === 'tank').id);
await g(([s, id]) => { const u = GAME.units.find((v) => v.id === id); u.x = s.x0 + 1; u.y = s.cy; u.tx = u.x; u.ty = u.y; u.path = []; GAME.view(s.cx, s.cy, 7); }, [site, tankId]);
const pushed = await watch(() => 0, () => GAME.collide.penetration() < 0.02, 60);
check('tank shoved into a building gets pushed back out', pushed.done, `after ${pushed.frames} frames, penetration ${(await g(() => GAME.collide.penetration())).toFixed(2)} m`);
await g(([s, id]) => { const u = GAME.units.find((v) => v.id === id); u.x = s.sx; u.y = s.cy; GAME.select([id]); GAME.order(s.goal[0], s.goal[1]); }, [site, tankId]);
const trip = await watch(() => GAME.collide.penetration(), () => { const u = GAME.units.find((v) => v.type === 'tank'); return !u.path.length; }, 3000);
const tankEnd = await g((id) => { const u = GAME.units.find((v) => v.id === id); GAME.view(u.x, u.y, 7); return [u.x, u.y]; }, tankId);
const miss = Math.hypot(tankEnd[0] - site.goal[0], tankEnd[1] - site.goal[1]);
check('tank drives through the city blocks without ever entering a building', trip.done && trip.worst < 0.05 && miss < 6,
  `max penetration ${trip.worst.toFixed(3)} m over ${trip.frames} frames, ended ${miss.toFixed(1)} m from goal`);
await shot('01-tank-route');

// ---- 2. 單位 ↔ 單位：疊在同一點的 5 個單位會散開；一起開到同一點也不會重疊 ----
await park();
const ids = await g((o) => {
  const out = GAME.units.filter((u) => !(u.type === 'heli' || u.type === 'transport')).map((u) => u.id);
  for (const t of ['squad', 'truck']) out.push(GAME.spawnUnit(t, o.x, o.y));
  for (const id of out) { const u = GAME.units.find((v) => v.id === id); u.x = o.x; u.y = o.y; u.tx = u.x; u.ty = u.y; u.path = []; }
  GAME.view(o.x, o.y, 7);
  return out;
}, open);
const spread = await watch(() => 0, () => GAME.collide.overlap() < 0.02 && GAME.collide.penetration() < 0.02, 120);
check('five units stacked on one spot separate', spread.done && ids.length === 5, `overlap ${(await g(() => GAME.collide.overlap())).toFixed(2)} m after ${spread.frames} frames`);
await g(([o, ids]) => { for (const id of ids) { const u = GAME.units.find((v) => v.id === id); u.tx = o.x - 18; u.ty = o.y + 2; u.path = GAME.findPath(u.x, u.y, u.tx, u.ty, GAME.collide.UR[u.type]) || []; } }, [open, ids]);
const crowd = await watch(() => Math.max(GAME.collide.overlap(), GAME.collide.penetration()), () => GAME.units.every((u) => !u.path.length), 2400);
check('units sent to the same point never overlap and all stop', crowd.done && crowd.worst < 0.05, `max overlap / penetration ${crowd.worst.toFixed(3)} m, ${crowd.frames} frames`);
await shot('02-crowd');

// ---- 3. 直升機：設定低空 6 m 飛過比它高的樓，會先爬升，全程不進樓 ----
await park();
await page.evaluate((x) => { window.__m17x1 = x; }, site.x1);   // 下面 watch() 的結束條件讀這個
const heliOk = await g((s) => {
  const h = GAME.helis[0]; if (!h) return false;
  h.x = s.x0 - 40; h.y = s.cy; h.z = 6; h.tz = 6; h.tx = s.x1 + 40; h.ty = s.cy; h.vx = h.vy = 0; h.hang = 0;
  GAME.view(s.cx, s.cy, 5);
  return true;
}, site);
const fly = await watch(() => { const h = GAME.helis[0]; if (!h) return 99; let top = 0; for (let oy = -2; oy <= 2; oy += 2) for (let ox = -2; ox <= 2; ox += 2) top = Math.max(top, GAME.collide.roofAt(h.x + ox, h.y + oy)); return top - h.z; },
  () => { const h = GAME.helis[0]; return h && h.x > window.__m17x1 + 30; }, 1800);
check('low helicopter climbs over a taller building instead of flying through it', heliOk && fly.done && fly.worst < 0.5, `worst roof-above-heli ${fly.worst.toFixed(2)} m (building ${site.h.toFixed(1)} m)`);
await g(() => { const h = GAME.helis[0]; if (h) h.tz = 40; });

// ---- 4. 爆炸：GPU 算到被炸死的喪屍全部在殺傷半徑內，爆炸圖／衝擊波圈／爆心同一個中心、同一個半徑 ----
await park();
const P = { x: open.x, y: open.y };
await g((p) => { GAME.spawnZombies(p.x, p.y, 600, 18); GAME.view(p.x, p.y, 6); }, P);
await watch(() => 0, () => false, 10);
// 爆炸圖跟衝擊波圈只留不到一秒（4 倍速更短），引爆當下就記下來
const { ring, fxSize } = await g((p) => {
  GAME.hits.log.length = 0; GAME.detonate(p.x, p.y, 11);
  const m = GAME.game.marks.find((q) => q.type === 4 && q.x === p.x && q.y === p.y), f = GAME.game.fx.find((q) => q[0] === p.x && q[1] === p.y);
  return { ring: m && m.r, fxSize: f && f[2] };
}, P);
await page.waitForFunction(() => GAME.hits.log.some((e) => e[2] >= 100 && e[2] < 200), null, { timeout: 300000 });
await watch(() => 0, () => false, 20);
const blast = await g((p) => {
  const ks = GAME.hits.log.filter((e) => e[2] >= 100 && e[2] < 200);
  const far = Math.max(...ks.map((e) => Math.hypot(e[0] - p.x, e[1] - p.y)));
  const boom = GAME.hits.booms[GAME.hits.booms.length - 1];
  return { n: ks.length, far, boom };
}, P);
check('every zombie the blast killed lies inside its 11 m kill radius', blast.n >= 20 && blast.far <= 11.01, `${blast.n} killed, farthest ${blast.far.toFixed(2)} m`);
check('explosion sprite, shockwave ring and damage share one center and radius', fxSize && Math.abs(fxSize - 11 * 2.4) < 1e-3 && ring === 11 && blast.boom[0] === P.x && blast.boom[1] === P.y,
  `sprite ${fxSize?.toFixed(1)} m wide, ring r ${ring}, boom at ${blast.boom?.slice(0, 2).map((v) => v.toFixed(1))}`);
await shot('03-blast');

// ---- 5. 曳光彈：打死喪屍的那幾發，終點正好是 GPU 回報的擊殺位置；隔著建築的喪屍打不到 ----
await park();
const sq = await g((s) => { const u = GAME.units.find((v) => v.type === 'squad'); u.x = s.sx; u.y = s.cy; u.tx = u.x; u.ty = u.y; u.path = []; u.face = 0; GAME.view(s.cx, s.cy, 6); return { id: u.id, slot: u.slot }; }, site);
await g((s) => { GAME.hits.log.length = 0; GAME.hits.shots.length = 0; GAME.spawnZombies(s.sx, s.cy - 25, 80, 2.5); GAME.spawnZombies(s.sx, s.cy + 25, 80, 2.5); GAME.spawnZombies(s.x1 + 4, s.cy, 200, 4); }, site);
await page.waitForFunction((id) => GAME.hits.shots.filter((h) => h[2] === id).length >= 8, sq.id, { timeout: 300000 });
const tr = await g((sq) => {
  const zone = 1 + sq.slot * 2, u = GAME.units.find((v) => v.id === sq.id);
  const mine = GAME.hits.log.filter((e) => e[2] === zone);
  const shots = GAME.hits.shots.filter((h) => h[2] === sq.id);
  const matched = shots.filter((h) => GAME.hits.log.some((e) => e[0] === h[0] && e[1] === h[1])).length;
  // 隔著建築：從班的位置到擊殺點，0.5 m 取樣有 3 點以上在建築裡就算
  let hidden = 0;
  for (const e of mine) { let inB = 0; const L = Math.hypot(e[0] - u.x, e[1] - u.y), n = Math.ceil(L / 0.5); for (let k = 1; k < n; k++) if (GAME.collide.roofAt(u.x + ((e[0] - u.x) * k) / n, u.y + ((e[1] - u.y) * k) / n) > 0) inB++; if (inB >= 3) hidden++; }
  return { kills: mine.length, shots: shots.length, matched, hidden };
}, sq);
check('every kill tracer ends exactly where the GPU says the zombie died', tr.shots >= 8 && tr.matched === tr.shots, `${tr.matched}/${tr.shots} tracer ends match the kill log`);
check('the squad cannot shoot zombies hidden behind the building', tr.kills > 0 && tr.hidden === 0, `${tr.kills} kills by this squad, ${tr.hidden} through the building`);
await shot('04-tracers');

// ---- 6. 砲彈撞樓：戰車對著樓後面開砲，在牆面炸；砲兵砲彈落在屋頂上，就在屋頂炸 ----
await park();
const nb0 = await g(([s, id]) => {
  const u = GAME.units.find((v) => v.id === id); u.x = s.sx; u.y = s.cy; u.tx = u.x; u.ty = u.y; u.path = []; u.fireT = 0;
  GAME.control(id); GAME.aimAt(s.x1 + 10, s.cy, true);
  return GAME.hits.booms.length;
}, [site, tankId]);
await page.waitForFunction((n) => GAME.hits.booms.length > n, nb0, { timeout: 300000 });
const tb = await g(() => { GAME.aimAt(0, 0, false); GAME.control(null); return GAME.hits.booms[GAME.hits.booms.length - 1]; });
check('tank shell aimed past a building explodes on its wall, not behind it', tb[0] <= site.x0 + 0.01 && tb[0] > site.x0 - 1.5 && Math.abs(tb[1] - site.cy) < 1, `burst at x ${tb[0].toFixed(2)} (wall at ${site.x0}), z ${tb[3].toFixed(1)}`);
const nb = await g((s) => { GAME.support.shells.push({ tx: s.cx, ty: s.cy, from: [s.cx - 40, s.cy - 60, 140], t: 0, dur: 0.5, r: 11, lethal: 0.9 }); return GAME.hits.booms.length; }, site);
await page.waitForFunction((n) => GAME.hits.booms.length > n, nb, { timeout: 300000 });
const rb = await g(() => GAME.hits.booms[GAME.hits.booms.length - 1]);
check('artillery shell landing on a roof bursts at roof height', rb[3] >= site.h - 1.5 && rb[3] <= site.h + 0.5, `burst z ${rb[3].toFixed(1)} m, roof ${site.h.toFixed(1)} m`);
await shot('05-roof');

// ---- 7. 效能：單位更新（含碰撞、互推、尋路檢查）每幀平均 < 1 ms；蓋一道牆後淨空圖只重算附近，< 60 ms ----
const perf = await g((o) => { GAME.placeWall(o.x - 30, o.y + 30, o.x - 10, o.y + 30); return { ms: GAME.collide.perf.ms, wall: GAME.collide.buildMs(), clr: GAME.collide.clearAt(o.x - 20, o.y + 30.5) }; }, open);
check('unit update incl. collision stays under 1 ms / frame', perf.ms < 1, `avg ${perf.ms.toFixed(3)} ms`);
check('placing a wall updates the clearance map locally in under 60 ms', perf.wall < 60 && perf.clr < 0, `${perf.wall.toFixed(1)} ms, clearance on the wall ${perf.clr}`);
check('no page / GPU errors', (await g(() => GAME.errors.length)) === 0 && logs.length === 0, [...(await g(() => GAME.errors)), ...logs].slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
