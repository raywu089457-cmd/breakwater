// M4 有頭驗證：Z/X/C/V 選火力支援、左鍵呼叫、空襲拖曳畫線、冷卻、噴射機與戰斧實際飛過去、殺傷、誤傷自己人。
// 用法：node tools/headed_m4.mjs
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
const shot = (n) => page.screenshot({ path: join(outDir, `m4-${n}.png`) });
const toScreen = (x, y) => g(([x, y]) => {
  const m = GAME.cam.vp; const cx = m[0] * x + m[4] * y + m[12], cy = m[1] * x + m[5] * y + m[13];
  return [Math.round((cx * 0.5 + 0.5) * innerWidth), Math.round((0.5 - cy * 0.5) * innerHeight)];
}, [x, y]);
const kills = () => g(() => GAME.sim.kills);

await page.goto(pathToFileURL(join(here, '..', 'index.html')).href);
await page.waitForFunction(() => window.GAME && GAME.frames > 30, null, { timeout: 60000 });
const fob = await g(() => GAME.info.fob);
const cx = fob.x, cy = fob.y + 520;
await g(([x, y]) => GAME.view(x, y, 2.2), [cx, cy]);
await sleep(600);

// 砲兵：Z → 左鍵
await page.keyboard.press('KeyZ');
check('Z selects artillery (button lit)', await g(() => GAME.game.tool === 'support' && GAME.game.supType === 'artillery' && document.querySelector('[data-sup="artillery"]').classList.contains('on')));
const k0 = await kills();
await page.mouse.click(...(await toScreen(cx - 120, cy + 40)));
await sleep(200);
check('left click calls artillery, cooldown starts', await g(() => GAME.support.cd.artillery > 15 && GAME.support.missions.length === 1));
await page.mouse.click(...(await toScreen(cx - 120, cy + 40)));
check('second call refused during cooldown', await g(() => GAME.support.missions.length === 1));
await sleep(5500);
check('artillery shells land and kill', (await kills()) - k0 > 50, `kills +${(await kills()) - k0}`);
await shot('01-artillery');

// 空襲：C → 拖曳畫線（東西向）
await page.keyboard.press('KeyC');
const a = await toScreen(cx - 90, cy + 50), b = await toScreen(cx + 90, cy + 50);
console.log('air drag px', a, b);
await page.mouse.move(...a); await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(a[0] + ((b[0] - a[0]) * i) / 12, a[1] + ((b[1] - a[1]) * i) / 12); await sleep(20); }
await shot('02-air-aim');
await page.mouse.up();
await sleep(150);
const air = await g(() => { const m = GAME.support.missions.find((m) => m.type === 'air'); return m && { dx: m.dx, dy: m.dy }; });
check('dragging draws an east-west bomb line', air && Math.abs(air.dx) > 0.95, JSON.stringify(air));
let sawJet = false;
for (let i = 0; i < 80 && !sawJet; i++) { await sleep(100); sawJet = await g(() => GAME.support.jets.length > 0); }
await sleep(700);
await shot('03-air-jet');
check('a jet flies in for the airstrike', sawJet);
const k1 = await kills();
await sleep(2500);
check('bombs along the line kill', (await kills()) - k1 > 30, `kills +${(await kills()) - k1}`);
await shot('04-air-after');

// 艦砲：X
await page.keyboard.press('KeyX');
const k2 = await kills();
await page.mouse.click(...(await toScreen(cx + 150, cy - 40)));
await sleep(5600);
await shot('05-naval');
await sleep(4000);
check('naval gunfire (12 rounds) kills', (await kills()) - k2 > 60, `kills +${(await kills()) - k2}`);

// 戰斧：V
await page.keyboard.press('KeyV');
const k3 = await kills();
await page.mouse.click(...(await toScreen(cx, cy + 20)));
let sawMissile = false;
for (let i = 0; i < 120 && !sawMissile; i++) { await sleep(100); sawMissile = await g(() => GAME.support.missiles.length > 0); }
await sleep(2500);
await shot('06-tomahawk-flight');
await sleep(2200);
await shot('07-tomahawk-impact');
check('Tomahawk launches from the carrier and hits (big kill count)', sawMissile && (await kills()) - k3 > 300, `kills +${(await kills()) - k3}`);

// 誤傷：在自己的步兵班頭上叫砲兵
await page.keyboard.press('Escape');
await g((f) => GAME.view(f.x, f.y + 30, 6), fob);
await sleep(300);
await g(() => { GAME.support.cd.artillery = 0; });
await page.keyboard.press('KeyZ');
const sq = await g(() => { const u = GAME.units.find((u) => u.type === 'squad'); return [u.x, u.y, u.men]; });
await page.mouse.click(...(await toScreen(sq[0], sq[1])));
await sleep(6000);
const after = await g(() => ({ friendly: GAME.game.friendly || 0, men: GAME.units.filter((u) => u.type === 'squad').map((u) => u.men) }));
check('artillery on your own squad causes friendly casualties', after.friendly > 0, JSON.stringify(after));
check('no page / GPU errors', (await g(() => GAME.errors.length)) === 0 && logs.length === 0, logs.slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
