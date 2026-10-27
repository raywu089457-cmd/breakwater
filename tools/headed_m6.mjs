// M6 有頭驗證：部署按鈕扣補給、補給不足擋下、前哨（按鈕 + 左鍵放）、卡車右鍵前哨＝補給線、運輸直升機右鍵避難所＝撤離、救出人數、補給船。
// 用法：node tools/headed_m6.mjs
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
const shot = (n) => page.screenshot({ path: join(outDir, `m6-${n}.png`) });
const toScreen = (x, y, z = 0) => g(([x, y, z]) => {
  const m = GAME.cam.vp; const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  return [Math.round((cx * 0.5 + 0.5) * innerWidth), Math.round((0.5 - cy * 0.5) * innerHeight)];
}, [x, y, z]);
// 把幾個點都框進畫面中間 60%（點擊一定要在畫面內、而且避開右上的區域面板）
const frame = async (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * 1.8, 40);
  await g(([x, y, p]) => GAME.view(x, y, p), [cx, cy, Math.min(8, (800 * 0.6) / span)]);
  await sleep(300);
};
const stock = () => g(() => Math.floor(GAME.supply.stock));

await page.goto(pathToFileURL(join(here, '..', 'index.html')).href);
await page.waitForFunction(() => window.GAME && GAME.frames > 30, null, { timeout: 60000 });
const fob = await g(() => GAME.info.fob);

// 部署按鈕
const s0 = await stock();
await page.getByRole('button', { name: '運輸直升機 150' }).click();
await page.getByRole('button', { name: '卡車 80' }).click();
const s1 = await stock();
const types = await g(() => GAME.units.map((u) => u.type).join(','));
check('deploy buttons spawn units and cost supply', s0 - s1 === 230 && /transport/.test(types) && /truck/.test(types), `${s0} → ${s1}, ${types}`);

// 前哨：按鈕 → 左鍵放在基地東北空地
await g((f) => GAME.view(f.x + 150, f.y + 120, 4), fob);   // 前哨點要在畫面中間（右上是區域面板）
await sleep(400);
await page.getByRole('button', { name: '前哨 250' }).click();
const op = [fob.x + 200, fob.y + 150];
await page.mouse.click(...(await toScreen(...op)));
await sleep(300);
const ops = await g(() => GAME.outposts.map((o) => ({ x: Math.round(o.x), y: Math.round(o.y), stock: o.stock })));
check('outpost button + click builds an outpost (walls, −250)', ops.length === 1 && (await g(() => GAME.walls.length)) >= 3 && s1 - (await stock()) === 250, JSON.stringify(ops));
await shot('01-outpost');

// 卡車：點選 → 右鍵前哨 ＝ 補給線
const truck = await g(() => { const u = GAME.units.find((u) => u.type === 'truck'); return [u.x, u.y]; });
await frame([truck, op]);
await page.mouse.click(...(await toScreen(truck[0], truck[1], 1)));
await sleep(200);
await page.mouse.click(...(await toScreen(...op)), { button: 'right' });
await sleep(300);
const tm = await g(() => { const u = GAME.units.find((u) => u.type === 'truck'); return u.mission && u.mission.kind; });
check('right-click outpost with a truck selected = supply run', tm === 'supply', tm);
await page.keyboard.press('Escape');

// 運輸直升機：點選 → 右鍵港灣區避難所 ＝ 撤離
const d = await g(() => { const d = GAME.districts.find((d) => d.name === '港灣區'); return { sx: d.sx, sy: d.sy, pop: d.pop }; });
const tr0 = await g(() => { const u = GAME.units.find((u) => u.type === 'transport'); return [u.x, u.y]; });
await frame([tr0, [d.sx, d.sy]]);
await sleep(400);
const tr = await g(() => { const u = GAME.units.find((u) => u.type === 'transport'); return [u.x, u.y, u.z]; });
await page.mouse.click(...(await toScreen(tr[0], tr[1], 4 + tr[2] * 0.3)));
await sleep(200);
const selTxt = await g(() => [...document.querySelectorAll('#statRows .r')].find((r) => r.children[0].textContent === '選取').children[1].textContent);
await page.mouse.click(...(await toScreen(d.sx, d.sy)), { button: 'right' });
await sleep(300);
const hm = await g(() => { const u = GAME.units.find((u) => u.type === 'transport'); return u.mission && u.mission.kind; });
check('right-click a shelter with the transport selected = evacuation', hm === 'evac', `${selTxt} → ${hm}`);
await page.keyboard.press('Escape');

// 4 倍速：等它載人回來
await page.keyboard.press('Digit4');
let res = 0, sawLoad = false;
for (let i = 0; i < 90 && res === 0; i++) {
  await sleep(500);
  const st = await g(() => { const u = GAME.units.find((u) => u.type === 'transport'); return { phase: u && u.phase, cargo: u && u.cargo, rescued: GAME.rescued, x: u && u.x, y: u && u.y }; });
  if (st.phase === 'load' && !sawLoad) { sawLoad = true; await g(([x, y]) => GAME.view(x, y, 8), [st.x, st.y]); await sleep(400); await shot('02-loading'); }
  res = st.rescued;
}
check('transport lands, loads survivors and brings them back (rescued > 0)', res > 0 && sawLoad, `rescued ${res}`);
const sup = await g(() => GAME.outposts[0].stock);
check('supply truck delivered to the outpost', sup > 150 || (await g(() => GAME.units.find((u) => u.type === 'truck')?.phase)) === 'deliver', `outpost stock ${Math.round(sup)}`);
const hudTxt = await g(() => [...document.querySelectorAll('#statRows .r')].map((r) => r.textContent).filter((t) => /補給|救出/.test(t)));
check('HUD shows supply (with ship countdown) and rescued', hudTxt.length === 2, hudTxt.join(' | '));

// 補給不足：把庫存歸零再按戰車
await g(() => { GAME.supply.stock = 50; });
const n0 = await g(() => GAME.units.length);
await page.getByRole('button', { name: '戰車 300' }).click();
await sleep(200);
const refused = (await g(() => GAME.units.length)) === n0 && (await g(() => GAME.events[0].text)).includes('補給不足');
check('deploy is refused when supply is short (event shown)', refused, await g(() => GAME.events[0].text));
// 補給船：把倒數設成 1 分鐘
await g(() => { GAME.supply.shipT = 1; });
await sleep(1500);
check('supply ship arrives and adds +500', (await stock()) >= 500, `stock ${await stock()}`);
await shot('03-after');
check('no page / GPU errors', (await g(() => GAME.errors.length)) === 0 && logs.length === 0, logs.slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
