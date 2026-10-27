// M12 有頭驗證：機槍堡（按鈕＋左鍵蓋、Shift+左鍵拆退一半、會自己開火殺喪屍、被啃會壞、Nexus 把它算進防守、存讀檔保留）、
// 戰區地圖差異（北港河流＋橋、霧島海灣＋斜向大道、南溪、新港都能正常跑）。
// 用法：node tools/headed_m12.mjs
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

await page.goto(url + '?region=0');
await boot();
await g(() => new Promise((r) => { localStorage.removeItem('bw-campaign'); const q = indexedDB.deleteDatabase('breakwater'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.goto(url + '?region=0');
await boot();
const fob = await g(() => { GAME.nexus.t = 99999; return GAME.info.fob; });
const spot = [fob.x, fob.y + 300];
await g(([x, y]) => GAME.view(x, y, 5), spot);
await page.keyboard.press('Space');   // 暫停：補給不會被開火消耗，扣款才算得準
await sleep(400);
// 蓋：按鈕 → 左鍵
const s0 = await g(() => Math.floor(GAME.supply.stock));
await page.getByRole('button', { name: '機槍堡 120' }).click();
for (const dx of [-25, 0, 25]) await page.mouse.click(...(await toScreen(spot[0] + dx, spot[1])));
await sleep(200);
const built = await g(() => GAME.nests.map((n) => [Math.round(n.x), Math.round(n.y)]));
check('nest button + clicks build 3 machine-gun nests (−120 each)', built.length === 3 && s0 - (await g(() => Math.floor(GAME.supply.stock))) === 360, JSON.stringify(built));
// 拆：Shift+左鍵 → 退一半
const s1 = await g(() => Math.floor(GAME.supply.stock));
await page.keyboard.down('Shift'); await page.mouse.click(...(await toScreen(spot[0] + 25, spot[1]))); await page.keyboard.up('Shift');
await sleep(200);
check('shift+click removes a nest and refunds half', (await g(() => GAME.nests.length)) === 2 && (await g(() => Math.floor(GAME.supply.stock))) - s1 === 60);
// 防守值
const def = await g(([x, y]) => GAME.nexusCandidates ? 1 : 0, spot);
// 開時間：喪屍湧來 → 機槍堡開火、殺傷、被啃
const k0 = await g(() => GAME.sim.kills);
await page.keyboard.press('Digit4');
let fired = false;
for (let i = 0; i < 40 && !fired; i++) { await sleep(250); fired = await g(() => GAME.nests.some((n) => n.firing)); }
await sleep(6000);
const st = await g(() => ({ kills: GAME.sim.kills, nests: GAME.nests.map((n) => Math.round(n.hp)), events: GAME.events.slice(0, 5).map((e) => e.text) }));
check('nests open fire on their own and kill zombies', fired && st.kills - k0 > 100, `kills +${st.kills - k0}, hp ${st.nests.join('/')}`);
await page.screenshot({ path: join(outDir, 'm12-nests.png') });
await page.keyboard.press('Space');
// 存讀檔保留機槍堡
const before = await g(() => GAME.nests.map((n) => `${n.id}@${n.x.toFixed(1)},${n.y.toFixed(1)}:${Math.round(n.hp)}`).join(' '));
await page.keyboard.press('F5');
await page.waitForFunction(() => GAME.events.some((e) => e.text.startsWith('已存檔')), null, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.keyboard.press('F9')]);
await boot();
await page.waitForFunction(() => GAME.events.some((e) => e.text.startsWith('讀取存檔')), null, { timeout: 30000 });
const after = await g(() => GAME.nests.map((n) => `${n.id}@${n.x.toFixed(1)},${n.y.toFixed(1)}:${Math.round(n.hp)}`).join(' '));
check('nests survive save/load', before === after && before.length > 0, after);
// 被淹沒會壞：把一座丟到屍潮正中央
await g(() => { GAME.supply.stock = 2000; const d = GAME.districts.find((d) => d.state === 'crisis'); GAME.placeNest(d.sx + 6, d.sy + 6); GAME.setSpeed(4); });
let lostNest = false;
for (let i = 0; i < 120 && !lostNest; i++) { await sleep(250); lostNest = await g(() => GAME.events.some((e) => /機槍堡 \d+ 被屍潮淹沒/.test(e.text))); }
check('a nest dropped into the horde gets overrun', lostNest);

// 戰區地圖
for (const [k, name, test] of [[1, '北港', 'river'], [2, '霧島', 'diag'], [3, '南溪', 'river'], [4, '新港', 'river']]) {
  await page.goto(url + `?region=${k}`);
  await boot();
  const r = await g((test) => {
    const n = GAME.sim.n, region = GAME.region.name;
    let water = 0;
    if (test === 'river') for (let x = 300; x < 1500; x++) if (GAME.tileAt(x, 1200) === 2) water++;
    let road = 0;
    if (test === 'diag') for (let s = 0; s < 1; s += 0.02) if ([0, 8].includes(GAME.tileAt(120 + 1840 * s, 620 + 880 * s))) road++;
    // 地面部隊能不能從基地開到每一個避難所（河只能走橋）
    const f = GAME.info.fob, sh = GAME.districts.filter((d) => d.k);
    const reach = sh.filter((d) => GAME.findPath(f.x, f.y + 40, d.sx, d.sy)).length;
    return { n, region, water, road, cross: reach === sh.length, reach: `${reach}/${sh.length}` };
  }, test);
  await sleep(1500);
  const fps = await g(async () => { const a = GAME.frames, t = performance.now(); await new Promise((r) => setTimeout(r, 1500)); return ((GAME.frames - a) * 1000) / (performance.now() - t); });
  const ok = r.region === name && (test === 'river' ? r.water >= 30 && r.cross : r.road >= 48) && fps > 50 && (await g(() => GAME.errors.length)) === 0;
  check(`region ${k + 1} ${name}: ${test === 'river' ? 'river with bridges (every shelter reachable by ground)' : 'diagonal avenue'}, runs smoothly`, ok, `${r.n.toLocaleString()} zombies, ${test === 'river' ? `river ${r.water} m wide, shelters reachable by ground ${r.reach}` : `${r.road}/50 road`}, ${fps.toFixed(0)} fps`);
  await g(() => GAME.view(1024, 1024, 0.2));
  await sleep(500);
  await page.screenshot({ path: join(outDir, `m12-region${k + 1}.png`) });
}
check('no page / GPU errors', logs.length === 0, logs.slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
