// M2 有頭驗證：真的 Chrome 視窗、file://、真滑鼠鍵盤 —— 築牆拖曳/預覽/拆牆、直升機工具與 Q/E、右鍵拖曳平移 vs 右鍵信標、
// 屍堆翻牆與直升機被抓的實況截圖。用法：node tools/headed_m2.mjs
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
const shot = (n) => page.screenshot({ path: join(outDir, `m2-${n}.png`) });
const toScreen = (x, y, z = 0) => g(([x, y, z]) => {
  const m = GAME.cam.vp; const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  return [Math.round((cx * 0.5 + 0.5) * innerWidth), Math.round((0.5 - cy * 0.5) * innerHeight)];
}, [x, y, z]);

await page.goto(pathToFileURL(join(here, '..', 'index.html')).href);
await page.waitForFunction(() => window.GAME && GAME.frames > 30, null, { timeout: 60000 });
check('boots', true);
const fob = await g(() => GAME.info.fob);
// 基地北邊空地（混凝土），拉近一點
await g((f) => GAME.view(f.x, f.y + 60, 7), fob);
await sleep(500);

// 1) 築牆：按鈕 → 左鍵拖曳（中途有預覽）→ 放開蓋好
await page.getByRole('button', { name: '築牆' }).click();
const a = await toScreen(fob.x - 40, fob.y + 70), b = await toScreen(fob.x + 40, fob.y + 72);
await page.mouse.move(...a); await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(a[0] + ((b[0] - a[0]) * i) / 12, a[1] + ((b[1] - a[1]) * i) / 12); await sleep(16); }
const ghost = await g(() => [GAME.sim.nWalls, GAME.walls.length]);
await shot('01-ghost');
await page.mouse.up();
await sleep(200);
const wl = await g(() => GAME.walls);
check('wall drag shows a preview, release builds it', ghost[0] === 1 && ghost[1] === 0 && wl.length === 1, `preview ${JSON.stringify(ghost)} → walls ${JSON.stringify(wl)}`);
check('wall snapped horizontal, 2 m thick', wl[0] && wl[0][3] - wl[0][1] === 2 && wl[0][2] - wl[0][0] >= 75);
await shot('02-wall');
// Shift+左鍵拆牆
const mid = await toScreen((wl[0][0] + wl[0][2]) / 2, (wl[0][1] + wl[0][3]) / 2, 2);
await page.keyboard.down('Shift'); await page.mouse.click(...mid); await page.keyboard.up('Shift');
await sleep(150);
check('shift+click removes the wall', (await g(() => GAME.walls.length)) === 0);

// 2) 右鍵拖曳平移（不放信標）、右鍵點一下放信標
const cam0 = await g(() => GAME.cam.x);
await page.mouse.move(W / 2, H / 2); await page.mouse.down({ button: 'right' });
for (let i = 1; i <= 10; i++) { await page.mouse.move(W / 2 - i * 20, H / 2); await sleep(16); }
await page.mouse.up({ button: 'right' });
const cam1 = await g(() => GAME.cam.x);
check('right-drag pans without a beacon', cam1 - cam0 > 5 && (await g(() => GAME.game.beacons.length)) === 0, `cam.x +${(cam1 - cam0).toFixed(1)}`);
await page.mouse.click(W / 2, H / 2 + 100, { button: 'right' });
check('right click places a beacon', (await g(() => GAME.game.beacons.length)) === 1);

// 3) 直升機：指揮工具點選（畫在壓縮後的高度）→ 右鍵指定位置、E/E 降到低、Q 升到中、按「高」
await page.getByRole('button', { name: '指揮' }).click();
const h0 = await g(() => { const h = GAME.helis[0]; GAME.view(h.x + 30, h.y + 20, 7); return [h.x, h.y, h.z]; });
await sleep(300);
await page.mouse.click(...(await toScreen(h0[0], h0[1], 4 + h0[2] * 0.3)));
const HX = h0[0] + 50, HY = h0[1] + 25;
const tgt = await toScreen(HX, HY);
await page.mouse.click(...tgt, { button: 'right' });
const ht = await g(() => [GAME.helis[0].tx, GAME.helis[0].ty]);
check('select heli, right click sets its destination', Math.hypot(ht[0] - HX, ht[1] - HY) < 3, JSON.stringify(ht.map((v) => +v.toFixed(1))));
await page.keyboard.press('KeyE'); await page.keyboard.press('KeyE');
const z1 = await g(() => GAME.helis[0].tz);
await page.keyboard.press('KeyQ');
const z2 = await g(() => GAME.helis[0].tz);
await page.getByRole('button', { name: '高', exact: true }).click();
const z3 = await g(() => GAME.helis[0].tz);
check('E/E → 6 m, Q → 15 m, 高 button → 40 m', z1 === 6 && z2 === 15 && z3 === 40, `${z1} / ${z2} / ${z3}`);
await sleep(7000);
await g(([x, y]) => GAME.view(x, y - 10, 8), [HX, HY]);
await sleep(400);
await shot('03-heli-flying');
check('heli flew to the destination', await g(([x, y]) => Math.hypot(GAME.helis[0].x - x, GAME.helis[0].y - y) < 25, [HX, HY]));

// 4) 實況：市中心低空懸停 → 屍潮聚集、疊塔、被抓
await page.keyboard.press('Escape');
await page.keyboard.press('Digit4');
const s0 = await g(() => GAME.game.survivors[0]);
await g((s) => GAME.heliTo(s[0] + 30, s[1] - 40, 6), s0);
let hung = null;
for (let i = 0; i < 600 && !hung; i++) {
  await sleep(100);
  const st = await g(() => { const h = GAME.helis[0]; return h ? { state: 'fly', z: +h.z.toFixed(1), hang: h.hang, hp: +h.hp.toFixed(0), reach: +h.reach.toFixed(1), crowd: h.crowd } : { state: 'down' }; });
  if (st.hang >= 1) { hung = st; await g(() => { const h = GAME.helis[0]; GAME.view(h.x, h.y - 6, 12); }); await sleep(300); await shot('04-heli-grabbed'); }
  if (st.state === 'down') break;
}
check('low hover over the horde → zombies grab the heli', !!hung, JSON.stringify(hung));
let downed = false;
for (let i = 0; i < 60 && !downed; i++) { await sleep(500); downed = (await g(() => GAME.helis.length)) === 0; }
await shot('05-heli-down');
check('grabbed heli is dragged down and crashes', downed);

// 5) 實況：牆圍起來的目標點 → 屍堆 → 翻牆
await g((s) => { GAME.placeWall(s[0] - 12, s[1] - 12, s[0] + 12, s[1] - 12); GAME.placeWall(s[0] - 12, s[1] - 12, s[0] - 12, s[1] + 10); GAME.placeWall(s[0] + 12, s[1] - 12, s[0] + 12, s[1] + 10); }, s0);
let climb = 0, pile = 0;
for (let i = 0; i < 120 && !(climb >= 50 && pile > 2.3); i++) { await sleep(500); ({ climbing: climb, maxPile: pile } = await g(() => GAME.stats())); }
await g((s) => GAME.view(s[0], s[1] - 14, 11), s0);
await sleep(400);
await shot('06-wall-climb');
check('horde piles up against the wall and climbs over', climb >= 50 && pile > 2, `climbing ${climb}, max pile ${pile} m`);
check('no page / GPU errors', (await g(() => GAME.errors.length)) === 0 && logs.length === 0, logs.slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
