// M10 有頭驗證：作戰中途存檔 → 繼續玩讓狀態改變 → 讀檔，檢查 GPU 上的喪屍資料、部隊、牆、區域、補給、Nexus、時間全部還原。
// 用法：node tools/headed_m10.mjs
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
// 一份狀態摘要（存檔前／讀檔後比對用）
const snap = () => g(async () => ({
  time: +GAME.sim.time.toFixed(3), n: GAME.sim.n, kills: GAME.sim.kills, clock: GAME.clockText(),
  units: GAME.units.map((u) => `${u.id}:${u.type}@${u.x.toFixed(2)},${u.y.toFixed(2)},${u.z.toFixed(1)} men${u.men} hp${Math.round(u.hp)} ${u.mission ? u.mission.kind + '/' + u.phase : ''}`).sort(),
  walls: GAME.walls.map((w) => w.join(',')).sort(), outposts: GAME.outposts.map((o) => `${o.name}@${Math.round(o.x)},${Math.round(o.y)} ${Math.round(o.stock)}`),
  districts: GAME.districts.map((d) => `${d.name}:${d.state}:${d.pop}:${d.dead}`),
  supply: Math.round(GAME.supply.stock), rescued: GAME.rescued, nexus: `${GAME.nexus.phase}:${GAME.nexus.target ? GAME.nexus.target.name : '-'}:${GAME.nexus.attacks}`,
  agents: (await GAME.sampleAgents(64)).map((v) => +v.toFixed(3)), info: await GAME.sampleInfo(64),
}));

await page.goto(url + '?region=0');
await boot();
await g(() => new Promise((r) => { localStorage.removeItem('bw-campaign'); const q = indexedDB.deleteDatabase('breakwater'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.goto(url + '?region=0');
await boot();
// 玩一下：部署、蓋牆、前哨、補給線、砲擊、Nexus 預警
await g(() => {
  const f = GAME.info.fob;
  GAME.supply.stock = 3000;
  const t = GAME.deploy('truck'); GAME.deploy('squad');
  GAME.placeWall(f.x - 60, f.y + 90, f.x + 60, f.y + 90);
  const o = GAME.placeOutpost(f.x + 200, f.y + 150);
  GAME.select([t.id]); GAME.orderAt(o.x, o.y);
  GAME.callSupport('artillery', f.x, f.y + 400);
  GAME.nexus.t = 0.3;
  GAME.setSpeed(4);
});
await sleep(15000);
await page.keyboard.press('Space');            // 暫停後存檔，比對才準
await sleep(300);
const before = await snap();
await page.keyboard.press('F5');
await page.waitForFunction(() => GAME.events.some((e) => e.text.startsWith('已存檔')), null, { timeout: 30000 });
const savedMsg = await g(() => GAME.events.find((e) => e.text.startsWith('已存檔')).text);
check('F5 saves mid-operation (GPU horde data read back)', true, savedMsg);
// 繼續玩，讓狀態跑掉
await page.keyboard.press('Space');
await sleep(8000);
const drift = await snap();
check('state keeps changing after the save', drift.time > before.time + 5 && JSON.stringify(drift.agents) !== JSON.stringify(before.agents), `t ${before.time} → ${drift.time}`);
// F9 讀檔（換頁）
await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.keyboard.press('F9')]);
await boot();
await page.waitForFunction(() => GAME.events.some((e) => e.text.startsWith('讀取存檔')), null, { timeout: 30000 });
await sleep(500);
const after = await snap();
const same = (k) => JSON.stringify(before[k]) === JSON.stringify(after[k]);
check('loaded game starts paused at the saved time', after.time === before.time && (await g(() => GAME.sim.speed)) === 0, `${before.clock} / ${after.clock}`);
check('horde restored bit-for-bit (first 64 zombies: position, velocity, state)', same('agents') && same('info') && after.n === before.n);
check('kills restored', after.kills === before.kills, `${before.kills} / ${after.kills}`);
check('units restored (type, position, health, missions)', same('units'), after.units.length + ' units');
check('walls and outpost restored', same('walls') && same('outposts'), `${after.walls.length} walls, ${after.outposts.join(' ')}`);
check('districts, supply, rescued restored', same('districts') && after.supply === before.supply && after.rescued === before.rescued);
check('Nexus state restored', same('nexus'), after.nexus);
if (!same('units')) console.log('units before', before.units, '\nafter', after.units);
// 讀檔後繼續玩不出錯
await page.keyboard.press('Space');
await sleep(4000);
check('game continues normally after loading', (await g(() => GAME.sim.time)) > after.time + 2 && (await g(() => GAME.errors.length)) === 0);
await page.screenshot({ path: join(outDir, 'm10-after-load.png') });
check('no page / GPU errors', logs.length === 0, logs.slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
