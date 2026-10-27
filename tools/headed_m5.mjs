// M5 有頭驗證：區域面板點擊跳轉、作戰地圖區域標籤、時間軸、圍攻 → 危機 → 失守、事件紀錄。
// 用法：node tools/headed_m5.mjs
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
const shot = (n) => page.screenshot({ path: join(outDir, `m5-${n}.png`) });

await page.goto(pathToFileURL(join(here, '..', 'index.html')).href);
await page.waitForFunction(() => window.GAME && GAME.frames > 30, null, { timeout: 60000 });
const rows = await page.locator('#dpanel .dr').count();
check('district panel lists 15 districts', rows === 15, `${rows} rows`);
const opening = await g(() => GAME.districts.filter((d) => d.state === 'crisis').map((d) => d.name));
check('one district starts under siege', opening.length === 1, opening.join(','));

// 點面板的「西灘」→ 鏡頭跳過去
await page.locator('#dpanel .dr', { hasText: '西灘' }).click();
await sleep(400);
const jump = await g(() => { const d = GAME.districts.find((d) => d.name === '西灘'); return Math.hypot(GAME.cam.x - d.sx, GAME.cam.y - d.sy); });
check('clicking a district row jumps the camera there', jump < 5, `off by ${jump.toFixed(1)} m`);

// 滾輪拉到作戰地圖 → 區域標籤出現、有圍攻中的顏色
await page.mouse.move(W / 2, H / 2);
for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 120); await sleep(30); }
await sleep(600);
const labels = await g(() => ({ shown: document.getElementById('dlabels').style.display !== 'none', n: document.querySelectorAll('#dlabels .dl').length, crisis: document.querySelectorAll('#dlabels .dl.crisis').length }));
check('ops map shows district labels (crisis one highlighted)', labels.shown && labels.n === 15 && labels.crisis >= 1, JSON.stringify(labels));
await shot('01-ops');
// 拉近 → 標籤收起
for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, -120); await sleep(30); }
await sleep(400);
check('labels hide in tactical view', (await g(() => document.getElementById('dlabels').style.display)) === 'none');

// 時間軸：4 倍速跑 25 秒
const c0 = await g(() => GAME.clockText());
await page.keyboard.press('Digit4');
await sleep(25000);
const c1 = await g(() => GAME.clockText());
const mins = (c) => { const m = c.match(/第 (\d+) 天 (\d+):(\d+)/); return (m[1] - 1) * 1440 + +m[2] * 60 + +m[3]; };
check('campaign clock advances ~4 game min per real s at 4×', mins(c1) - mins(c0) > 70, `${c0} → ${c1}`);
const st = await g(() => GAME.districts.filter((d) => d.k).map((d) => ({ n: d.name, s: d.state, p: d.pop, dead: d.dead })));
const hit = st.filter((d) => d.dead > 0);
check('besieged districts lose survivors', hit.length >= 1, hit.map((d) => `${d.n} ${d.s} 剩 ${d.p} 死 ${d.dead}`).join(' / '));
const evs = await g(() => document.querySelectorAll('#elog .ev').length);
check('event log shows siege warnings on screen', evs >= 1, `${evs} events`);
await page.locator('#dpanel .dr.crisis').first().click();
await sleep(500);
await shot('02-siege');
const hud = await g(() => [...document.querySelectorAll('#statRows .r')].map((r) => r.textContent).filter((t) => /倖存者|時間/.test(t)));
check('HUD shows clock and survivor totals', hud.length === 2, hud.join(' | '));
check('no page / GPU errors', (await g(() => GAME.errors.length)) === 0 && logs.length === 0, logs.slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
