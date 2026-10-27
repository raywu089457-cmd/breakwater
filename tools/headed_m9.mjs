// M9 有頭驗證：戰役流程——第 1 戰區結案 → 結算評等 → 按「前往下一戰區」真的換地圖（北港 120 萬、區名、帶過來的兵力與補給、進度存檔）→ 戰役地圖 → 撤出結算 → 重新開始戰役。
// 用法：node tools/headed_m9.mjs
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
const shot = (n) => page.screenshot({ path: join(outDir, `m9-${n}.png`) });
const boot = () => page.waitForFunction(() => window.GAME && GAME.frames > 30, null, { timeout: 90000 });

await page.goto(pathToFileURL(join(here, '..', 'index.html')).href);
await boot();
await g(() => localStorage.removeItem('bw-campaign'));
await page.goto(pathToFileURL(join(here, '..', 'index.html')).href + '?region=0');
await boot();
check('campaign starts in region 1 (灣岸市, 1,000,000)', (await g(() => [GAME.region.name, GAME.sim.n].join())) === '灣岸市,1000000', await g(() => document.getElementById('regionName').textContent));

// 結案：救出 18,000，其餘死亡，全部區域結束
await g(() => { GAME.debugRescue(18000); for (const d of GAME.districts.filter((d) => d.k)) { d.dead += d.pop; d.pop = 0; } });
await page.waitForFunction(() => GAME.op.over, null, { timeout: 15000 });
await sleep(300);
const res = await g(() => ({ ...GAME.op.result, shown: document.getElementById('result').style.display === 'block' }));
check('operation ends when every district is resolved; result screen with grade', res.shown && res.reason === 'cleared' && res.grade === 'B', `grade ${res.grade}, rescued ${res.rescued}/${res.pop0}`);
check('time is locked after the operation ends', await g(() => { GAME.setSpeed(4); return GAME.sim.speed === 0; }));
await shot('01-result');

// 前往下一戰區（真的點按鈕 → 換頁）
await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.locator('#rNext').click()]);
await boot();
const r2 = await g(() => ({ name: GAME.region.name, n: GAME.sim.n, url: location.search, names: GAME.districts.slice(1, 4).map((d) => d.name), units: GAME.units.map((u) => u.type).join(','), supply: Math.floor(GAME.supply.stock), saved: JSON.parse(localStorage.getItem('bw-campaign')) }));
check('next region loads: 北港 with 1,200,000 zombies and its own district names', r2.name === '北港' && r2.n === 1200000 && /region=1/.test(r2.url) && r2.names.every((n) => !['港灣區', '舊城', '金融區'].includes(n)), `${r2.name} ${r2.n.toLocaleString()} [${r2.names.join(', ')}]`);
check('rescued survivors carry over as supply and squads', r2.supply === 1500 + 3000 && (r2.units.match(/squad/g) || []).length >= 2 + 6, `supply ${r2.supply}, units ${r2.units}`);
check('progress saved (region 1 recorded with grade)', r2.saved && r2.saved.current === 1 && r2.saved.done[0]?.region === '灣岸市' && r2.saved.done[0]?.grade === 'B', JSON.stringify(r2.saved?.done));
await sleep(1500);
await g(() => GAME.view(1024, 1024, 0.2));
await sleep(800);
await shot('02-region2-ops');
const fps = await g(async () => { const a = GAME.frames, t = performance.now(); await new Promise((r) => setTimeout(r, 2000)); return ((GAME.frames - a) * 1000) / (performance.now() - t); });
check('region 2 runs smoothly with 1.2M zombies', fps > 50 && (await g(() => GAME.errors.length)) === 0, `${fps.toFixed(0)} fps`);

// 戰役地圖 → 撤出
await page.locator('#camp').click();
await sleep(300);
const rows = await g(() => [...document.querySelectorAll('#cmap .cr')].map((r) => r.textContent));
check('campaign map lists 5 regions, region 1 graded, region 2 current', rows.length === 5 && /評等 B/.test(rows[0]) && /目前戰區/.test(rows[1]), rows.slice(0, 2).join(' | '));
await shot('03-campaign-map');
await page.locator('#cWithdraw').click();
await sleep(400);
check('withdrawing ends the operation (remaining survivors count as dead)', await g(() => GAME.op.result?.reason === 'withdraw' && GAME.op.result.dead > 0));
// 重新開始戰役
await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.locator('#rReset').click()]);
await boot();
check('reset campaign goes back to region 1 with a clean save', (await g(() => [GAME.region.name, localStorage.getItem('bw-campaign')].join('|'))) === '灣岸市|');
check('no page / GPU errors', logs.length === 0, logs.slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
