// M15 有頭驗證：破牆者——約 0.4% 的喪屍是大隻的破牆者；牆切成 4 m 牆板、各有耐久；圍攻時破牆者頂著牆板扣耐久（裂痕）→ 撞出缺口
// （地表與導航都打通）；存讀檔保留耐久與缺口；在破牆上再拖一次＝修牆（照修補比例扣補給）。
// 用法：node tools/headed_m15.mjs
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const require = createRequire('C:/Users/ray/AppData/Roaming/npm/node_modules/');
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
const W = 1600, H = 900;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, args: [`--window-size=${W + 16},${H + 140}`, '--window-position=60,40'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const g = (fn, arg) => page.evaluate(fn, arg);
const boot = () => page.waitForFunction(() => window.GAME && GAME.frames > 20, null, { timeout: 90000 });
const url = pathToFileURL(join(here, '..', 'index.html')).href;
const toScreen = (x, y) => g(([x, y]) => {
  const m = GAME.cam.vp; const cx = m[0] * x + m[4] * y + m[12], cy = m[1] * x + m[5] * y + m[13];
  return [Math.round((cx * 0.5 + 0.5) * innerWidth), Math.round((0.5 - cy * 0.5) * innerHeight)];
}, [x, y]);
const hudRow = (name) => g((n) => [...document.querySelectorAll('#statRows .r')].find((r) => r.children[0].textContent === n)?.children[1].textContent, name);

await page.goto(url + '?region=0');
await boot();
await g(() => new Promise((r) => { localStorage.removeItem('bw-campaign'); const q = indexedDB.deleteDatabase('breakwater'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.goto(url + '?region=0');
await boot();
await g(() => { GAME.nexus.t = 99999; GAME.supply.stock = 9000; });

// 破牆者：依編號決定，約 0.4%；找一隻離基地近的拉近拍照
const nb = await g(() => { let n = 0; for (let i = 0; i < GAME.sim.n; i++) if (GAME.isBrute(i)) n++; return n; });
check('about 0.4% of the horde are brutes', nb > 3000 && nb < 5000, `${nb.toLocaleString()} of ${(await g(() => GAME.sim.n)).toLocaleString()}`);
const brute = await g(async () => {
  for (let i = 0; i < 400000; i++) if (GAME.isBrute(i)) { const a = await GAME.agentAt(i); const inf = await GAME.sampleInfo(1); if (a[0] > 50 && a[0] < 2000 && a[1] > 300 && a[1] < 2000) return [i, a[0], a[1]]; }
  return null;
});
await g(([i, x, y]) => GAME.view(x, y, 22), brute);
await sleep(600);
await page.screenshot({ path: join(outDir, 'm15-brute.png') });

// 拖一道 40 m 的牆 → 切成 10 片牆板
const fob = await g(() => GAME.info.fob);
// 基地北邊找一段 44 m 都不是建築／水的橫向空地
const wy = await g((f) => { for (let y = f.y + 120; y < f.y + 600; y += 2) { let ok = true; for (let x = f.x - 22; x <= f.x + 22 && ok; x++) for (const dy of [-1, 0]) if ([1, 2, 7].includes(GAME.tileAt(x, y + dy))) ok = false; if (ok) return y; } return null; }, fob);
const A = [fob.x - 20, wy], B = [fob.x + 20, wy];
await g(([x, y]) => GAME.view(x, y, 6), [fob.x, wy]);
await sleep(300);
await page.getByRole('button', { name: '築牆' }).click();
const sa = await toScreen(...A), sb = await toScreen(...B);
await page.mouse.move(...sa); await page.mouse.down(); await page.mouse.move(sb[0], sb[1], { steps: 8 }); await page.mouse.up();
await sleep(300);
const p40 = await g(() => GAME.panels.length);
check('a dragged 40 m wall is made of 10 panels (4 m each, full HP)', p40 === 10 && (await g(() => GAME.panels.every((p) => p.hp === 100))), `${p40} panels, HUD 牆 ${await hudRow('牆')}`);
await g(([x, y]) => GAME.removeWallAt(x, y), [fob.x, wy]);

// 圍攻：危機避難所四周 16 m 圍牆，4 倍速
const d = await g(() => { const d = GAME.districts.find((d) => d.state === 'crisis'); return { x: d.sx, y: d.sy, name: d.name }; });
await g(({ x, y }) => { const R = 16; GAME.placeWall(x - R, y + R, x + R, y + R); GAME.placeWall(x - R, y - R, x + R, y - R); GAME.placeWall(x - R, y - R, x - R, y + R); GAME.placeWall(x + R, y - R, x + R, y + R); GAME.view(x, y, 9); GAME.setSpeed(4); }, d);
const P0 = await g(() => GAME.panels.map((p) => [p.x, p.y]));
const nP0 = P0.length;
let dmgSeen = null;
for (let i = 0; i < 120 && !dmgSeen; i++) { await sleep(250); const n = await g(() => GAME.panels.filter((p) => p.hp < 70).length); if (n) dmgSeen = { n, hud: await hudRow('牆'), hits: await g(() => [...GAME.sim.wallHits].reduce((a, b) => a + b, 0)) }; }
check('brutes pressing the wall wear panels down (HUD shows damaged count)', dmgSeen && /受損 \d+/.test(dmgSeen.hud), JSON.stringify(dmgSeen));
await page.screenshot({ path: join(outDir, 'm15-cracks.png') });
let breach = false;
for (let i = 0; i < 240 && !breach; i++) { await sleep(250); breach = await g(() => GAME.breaches > 0); }
await page.keyboard.press('Space');
await sleep(300);
const st = await g((P0) => {
  const ev = GAME.events.find((e) => e.text.includes('破牆者撞開了牆'));
  // 缺口＝圍攻前有、現在沒有的牆板
  const live = new Set(GAME.panels.map((p) => `${p.x},${p.y}`));
  const gaps = P0.filter(([x, y]) => !live.has(`${x},${y}`));
  return { ev: ev && ev.text, n: GAME.panels.length, gaps, tile: gaps.length ? GAME.tileAt(gaps[0][0], gaps[0][1]) : -1, clock: GAME.clockText() };
}, P0);
check('a panel breaks: event, panel gone, ground under the gap is no longer wall', breach && st.ev && st.n < nP0 && st.gaps.length > 0 && st.tile !== 7, `${st.ev} · panels ${nP0} → ${st.n} · gaps ${JSON.stringify(st.gaps.slice(0, 3))} · tile ${st.tile} · ${st.clock}`);
await g(([x, y]) => GAME.view(x, y, 12), st.gaps[0]);
await sleep(500);
await page.screenshot({ path: join(outDir, 'm15-breach.png') });

// 存讀檔：每片牆板的耐久與缺口都保留
const before = await g(() => GAME.panels.map((p) => `${p.x},${p.y}:${p.hp.toFixed(1)}`).sort().join(' '));
await page.keyboard.press('F5');
await page.waitForFunction(() => GAME.events.some((e) => e.text.startsWith('已存檔')), null, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.keyboard.press('F9')]);
await boot();
await page.waitForFunction(() => GAME.events.some((e) => e.text.startsWith('讀取存檔')), null, { timeout: 30000 });
const after = await g(() => GAME.panels.map((p) => `${p.x},${p.y}:${p.hp.toFixed(1)}`).sort().join(' '));
const gapTile = await g(([x, y]) => GAME.tileAt(x, y), st.gaps[0]);
check('save/load keeps every panel’s HP and the gaps', before === after && gapTile !== 7, `${after.split(' ').length} panels, gap tile ${gapTile}`);

// 修牆：築牆工具在缺口上拖一次
await g(() => { GAME.nexus.t = 99999; GAME.supply.stock = 5000; });
const gp = st.gaps[0];
const vertGap = Math.abs(gp[0] - (d.x - 16)) < 0.1 || Math.abs(gp[0] - (d.x + 16)) < 0.1;
const a1 = vertGap ? [gp[0], gp[1] - 6] : [gp[0] - 6, gp[1]], b1 = vertGap ? [gp[0], gp[1] + 6] : [gp[0] + 6, gp[1]];
const cost = await g(([a, b]) => GAME.repairCost(a[0], a[1], b[0], b[1]), [a1, b1]);
await g(([x, y]) => GAME.view(x, y, 10), gp);
await sleep(300);
await page.getByRole('button', { name: '築牆' }).click();
const s0 = await g(() => Math.floor(GAME.supply.stock));
const ra = await toScreen(...a1), rb = await toScreen(...b1);
await page.mouse.move(...ra); await page.mouse.down(); await page.mouse.move(rb[0], rb[1], { steps: 8 }); await page.mouse.up();
await sleep(300);
// 同一條牆線上、拖曳範圍內的牆板都要補滿（轉角另一面的牆不算）
const rep = await g(([x, y, vert]) => ({ ev: GAME.events[0].text, tile: GAME.tileAt(x, y), stock: Math.floor(GAME.supply.stock),
  hp: GAME.panels.filter((p) => (vert ? p.x === x && Math.abs(p.y - y) < 5 : p.y === y && Math.abs(p.x - x) < 5)).map((p) => p.hp) }), [...gp, vertGap]);
check('dragging over the gap repairs it (wall again, full HP, cost charged)', /修好 \d+ 片牆板/.test(rep.ev) && rep.tile === 7 && rep.hp.every((h) => h === 100) && s0 - rep.stock === cost && cost > 0, `${rep.ev} · tile ${rep.tile} · hp ${rep.hp.join('/')} · −${s0 - rep.stock} (expected ${cost})`);
await page.screenshot({ path: join(outDir, 'm15-repaired.png') });
// 效能：100 萬隻、有破牆者與牆板
await g(() => { GAME.setSpeed(1); GAME.setTool('command'); });
await sleep(1500);
const fps = await g(async () => { const a = GAME.frames, t = performance.now(); await new Promise((r) => setTimeout(r, 2000)); return ((GAME.frames - a) * 1000) / (performance.now() - t); });
check('frame rate holds', fps > 50, `${fps.toFixed(0)} fps`);
check('no page / GPU errors', logs.length === 0 && (await g(() => GAME.errors.length)) === 0, logs.slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
