// M3 有頭驗證：點選／Shift 加選／框選、右鍵移動命令、TAB 直接操控（戰車 WASD + 主砲、步兵班瞄準射擊）、直升機 Q/E、實戰截圖。
// 用法：node tools/headed_m3.mjs
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
const shot = (n) => page.screenshot({ path: join(outDir, `m3-${n}.png`) });
const toScreen = (x, y, z = 0) => g(([x, y, z]) => {
  const m = GAME.cam.vp; const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  return [Math.round((cx * 0.5 + 0.5) * innerWidth), Math.round((0.5 - cy * 0.5) * innerHeight)];
}, [x, y, z]);
const unit = (id) => g((id) => { const u = GAME.units.find((v) => v.id === id); return u && { x: u.x, y: u.y, z: u.z, tz: u.tz, path: u.path.length, fireT: u.fireT, firing: u.firing }; }, id);
const selIds = () => g(() => GAME.select ? [...document.querySelectorAll('#statRows .r')].find((r) => r.children[0].textContent === '選取')?.children[1].textContent : '');

await page.goto(pathToFileURL(join(here, '..', 'index.html')).href);
await page.waitForFunction(() => window.GAME && GAME.frames > 30, null, { timeout: 60000 });
const fob = await g(() => GAME.info.fob);
await g((f) => GAME.view(f.x, f.y + 15, 7), fob);
await sleep(500);
check('boots with 4 units (2 squads, tank, heli)', (await g(() => GAME.units.map((u) => u.type).join(','))) === 'squad,squad,tank,heli');

// 點選、Shift 加選、點空地取消
const s1 = await unit(1), s2 = await unit(2);
await page.mouse.click(...(await toScreen(s1.x, s1.y, 1)));
await sleep(300);
const selA = await selIds();
await page.keyboard.down('Shift'); await page.mouse.click(...(await toScreen(s2.x, s2.y, 1))); await page.keyboard.up('Shift');
await sleep(300);
const selB = await selIds();
check('click selects a squad, shift+click adds the second', selA.includes('步兵班') && selB === '2 個單位', `${selA} → ${selB}`);
await page.mouse.click(W / 2, 150);
await sleep(300);
check('click on empty ground clears the selection', (await selIds()) === '—');

// 框選基地裡的單位
const a = await toScreen(fob.x - 45, fob.y + 45), b = await toScreen(fob.x + 45, fob.y - 2);
await page.mouse.move(...a); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(a[0] + ((b[0] - a[0]) * i) / 10, a[1] + ((b[1] - a[1]) * i) / 10); await sleep(16); }
const boxVisible = await g(() => document.getElementById('selbox').style.display === 'block');
await page.mouse.up();
await sleep(300);
const selBox = await selIds();
check('drag draws a selection box and selects the units inside', boxVisible && /個單位/.test(selBox) && +selBox.split(' ')[0] >= 3, selBox);

// 右鍵移動命令
const dest = await toScreen(fob.x, fob.y + 38);
await page.mouse.click(...dest, { button: 'right' });
await sleep(400);
const t1 = await unit(3);
check('right click orders the selection to move (tank gets a path)', t1.path > 0 || Math.hypot(t1.x - fob.x, t1.y - fob.y - 38) < 15, JSON.stringify(t1));
await page.keyboard.press('Escape');

// 戰車：選取 → TAB 直接操控 → W 前進 → 左鍵開主砲
const tk = await unit(3);
await page.mouse.click(...(await toScreen(tk.x, tk.y, 1)));
await page.keyboard.press('Tab');
await sleep(300);
const mode = await g(() => document.getElementById('mode').textContent);
const y0 = (await unit(3)).y;
await page.keyboard.down('KeyW'); await sleep(1200); await page.keyboard.up('KeyW');
const y1 = (await unit(3)).y;
check('TAB takes direct control, W drives the tank north', mode === '直接操控' && y1 - y0 > 4, `mode ${mode}, Δy ${(y1 - y0).toFixed(1)} m`);
const fx0 = await g(() => GAME.game.fx.length);
await page.mouse.move(W / 2 + 200, H / 2 - 150);
await page.mouse.down(); await sleep(150); await page.mouse.up();
await sleep(200);
const tAfter = await unit(3);
check('left click fires the tank main gun at the cursor', tAfter.fireT > 0 && (await g(() => GAME.game.fx.length)) > fx0, `reload ${tAfter.fireT.toFixed(2)} s`);
await shot('01-tank-control');
await page.keyboard.press('Tab');
await sleep(400);
check('TAB again releases control', (await g(() => document.getElementById('mode').textContent)) !== '直接操控');

// 步兵班：TAB 操控、按住左鍵朝準星射擊（瞄準線）
await page.keyboard.press('Escape');
const sq = await unit(1);
await page.mouse.click(...(await toScreen(sq.x, sq.y, 1)));
await page.keyboard.press('Tab');
await page.mouse.move(W / 2 - 250, H / 2 - 200);
await page.mouse.down(); await sleep(600);
const lines = await g(() => GAME.sim.lines.length);
const sqf = await unit(1);
await page.mouse.up();
check('squad under control fires along the aim line while the button is held', lines === 1 && sqf.firing, `lines ${lines}`);
await page.keyboard.press('Escape');

// 直升機：點選（在空中的位置）→ E 降到 15 m
await sleep(3500);   // 等直升機飛到剛才的移動目標停下
const hl = await unit(4);
await page.mouse.click(...(await toScreen(hl.x, hl.y, 4 + hl.z * 0.3)));
await sleep(200);
console.log('heli dbg', JSON.stringify(hl), JSON.stringify(await toScreen(hl.x, hl.y, 4 + hl.z * 0.3)), JSON.stringify(await g(() => GAME.selection)), JSON.stringify(await g(() => GAME.units.map(u => [u.id, Math.round(u.x), Math.round(u.y), Math.round(u.z)]))));
await page.keyboard.press('KeyE');
check('click the heli in the air, E lowers it to 15 m', (await unit(4)).tz === 15, 'tz ' + (await unit(4)).tz);
await page.keyboard.press('Escape');

// 實戰：全部往北壓進屍潮，4 倍速 20 秒
await g((f) => { GAME.select([1, 2, 3]); GAME.order(f.x, f.y + 380); GAME.setSpeed(4); }, fob);
await sleep(20000);
const st = await g(() => GAME.stats());
const lead = st.units.find((u) => u.type !== 'heli');
if (lead) await g((u) => GAME.view(u.x, u.y + 15, 7), lead);
await sleep(400);
await shot('02-battle');
check('units fight the horde (kills rising)', st.kills > 100, `kills ${st.kills}, units ${st.units.map((u) => u.type + (u.men ? u.men : '')).join(' ')}, lost ${st.lost}`);
check('no page / GPU errors', (await g(() => GAME.errors.length)) === 0 && logs.length === 0, logs.slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
