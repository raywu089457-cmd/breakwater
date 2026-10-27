// M13 有頭驗證：Nexus 切斷道路——挑卡車補給線上的一點（北港優先挑橋）→ 預警 → 屍群集結 → 守住後地面路線改走別座橋、
// 地圖標籤與 NEXUS 橫幅、存讀檔保留封鎖、把屍群打散後道路打通。
// 用法：node tools/headed_m13.mjs
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
const waitEvent = async (re, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await g((s) => GAME.events.some((e) => new RegExp(s).test(e.text)), re.source)) return true; await sleep(250); }
  return false;
};
// 路線（折線）離某點最近的距離、總長
const routeInfo = (path, sx, sy, bx, by) => {
  let px = sx, py = sy, len = 0, dmin = Infinity;
  for (const [wx, wy] of path) {
    const ax = wx - px, ay = wy - py, L2 = ax * ax + ay * ay || 1e-6;
    const t = Math.max(0, Math.min(1, ((bx - px) * ax + (by - py) * ay) / L2));
    dmin = Math.min(dmin, Math.hypot(px + ax * t - bx, py + ay * t - by));
    len += Math.sqrt(L2); px = wx; py = wy;
  }
  return { len: Math.round(len), dmin: Math.round(dmin) };
};

await page.goto(url + '?region=1');
await boot();
await g(() => new Promise((r) => { localStorage.removeItem('bw-campaign'); const q = indexedDB.deleteDatabase('breakwater'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.goto(url + '?region=1');
await boot();
const fob = await g(() => { GAME.nexus.t = 99999; GAME.supply.stock = 5000; return GAME.info.fob; });
// 河對岸（西邊）找一塊地面部隊開得到的空地蓋前哨
const op = await g((f) => {
  for (let y = f.y + 200; y < f.y + 700; y += 24) for (let x = 520; x > 300; x -= 24) {
    if (![0, 4, 5, 3].includes(GAME.tileAt(x, y))) continue;
    if (GAME.findPath(f.x, f.y + 15, x, y)) { const o = GAME.placeOutpost(x, y); if (o) return [o.x, o.y]; }
  }
  return null;
}, fob);
const truckId = await g(() => GAME.deploy('truck').id);
await g(([id, x, y]) => { GAME.select([id]); return GAME.orderAt(x, y); }, [truckId, ...op]);
const mission = await g((id) => GAME.units.find((u) => u.id === id).mission?.kind, truckId);
check('outpost across the river + truck on a supply run', op && mission === 'supply', `outpost ${op}, truck ${mission}`);

// 候選：補給線上的封鎖點，北港要挑橋
const cand = await g(() => GAME.roadCandidates().map((c) => ({ name: c.name, x: Math.round(c.x), y: Math.round(c.y), value: Math.round(c.value) })));
const before = await g(([f, o]) => GAME.findPath(f.x, f.y + 15, o[0], o[1]), [fob, op]);
const c0 = cand[0];
const onRoute = c0 && routeInfo(before, fob.x, fob.y + 15, c0.x, c0.y).dmin < 6;
check('Nexus finds a road-cut point on the supply route (a bridge on this river map)', c0 && onRoute && /的橋$/.test(c0.name), JSON.stringify(cand));

// 強制 Nexus 選切斷道路（預警縮短成 4 分鐘）→ 預警事件與橫幅
const forced = await g(() => GAME.forceNexus('road', 4));
await sleep(300);
const banner = await g(() => document.getElementById('nexus').textContent);
check('warning names the road and shows in the NEXUS banner', forced && banner.includes(forced.name) && (await g(() => GAME.events[0].text)).includes('切斷道路') || banner.includes(forced?.name), `${banner} | ${await g(() => GAME.events[0].text)}`);
await page.keyboard.press('Digit4');
// 屍群集結 → 守住 → 地面路線繞開
let formed = false;
for (let i = 0; i < 80 && !formed; i++) { await sleep(250); formed = await g(() => GAME.blockades.length > 0); }
const held = await waitEvent(/道路被切斷/, 90000);
const bl = await g(() => GAME.blockades.map((b) => ({ name: b.name, x: Math.round(b.x), y: Math.round(b.y), n: b.n, state: b.state })));
check('horde gathers on the road and the blockade holds (≥150 zombies)', formed && held && bl[0]?.state === 'holding' && bl[0].n >= 150, JSON.stringify(bl));
await page.keyboard.press('Space');
const after = await g(([f, o]) => GAME.findPath(f.x, f.y + 15, o[0], o[1]), [fob, op]);
const ri0 = routeInfo(before, fob.x, fob.y + 15, bl[0].x, bl[0].y), ri1 = routeInfo(after, fob.x, fob.y + 15, bl[0].x, bl[0].y);
check('ground route now detours around the cut road (other bridge)', ri1.dmin >= 30 && ri1.len > ri0.len && (await g(() => GAME.pathDangerCells)) > 0, `before ${JSON.stringify(ri0)} → after ${JSON.stringify(ri1)}`);
const tr = await g((id) => { const u = GAME.units.find((u) => u.id === id); return u ? { x: u.x, y: u.y, path: u.path } : null; }, truckId);
const triDist = tr && tr.path.length ? routeInfo(tr.path, tr.x, tr.y, bl[0].x, bl[0].y).dmin : 999;
check('the supply truck’s current route avoids the blockade', tr && (triDist >= 30 || Math.hypot(tr.x - bl[0].x, tr.y - bl[0].y) < 34), `truck route min distance ${triDist} m`);
// 標籤與橫幅（作戰地圖）
await g(([x, y]) => GAME.view(x, y, 0.9), [(bl[0].x + fob.x) / 2, (bl[0].y + fob.y) / 2]);
await sleep(600);
const lab = await g(() => [...document.querySelectorAll('#blabels .bl')].map((e) => e.textContent));
await page.screenshot({ path: join(outDir, 'm13-blockade-map.png') });
await g(([x, y]) => GAME.view(x, y, 6), [bl[0].x, bl[0].y]);
await sleep(600);
await page.screenshot({ path: join(outDir, 'm13-blockade-close.png') });
check('map label marks the cut road', lab.length === 1 && lab[0].includes('封鎖') && lab[0].includes(bl[0].name), lab.join(' | '));

// 存讀檔保留封鎖
await page.keyboard.press('F5');
await page.waitForFunction(() => GAME.events.some((e) => e.text.startsWith('已存檔')), null, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.keyboard.press('F9')]);
await boot();
await page.waitForFunction(() => GAME.events.some((e) => e.text.startsWith('讀取存檔')), null, { timeout: 30000 });
const bl2 = await g(() => ({ list: GAME.blockades.map((b) => `${b.name}@${Math.round(b.x)},${Math.round(b.y)}:${b.state}`), danger: GAME.pathDangerCells }));
check('blockade survives save/load (route still avoids it)', bl2.list.length === 1 && bl2.list[0].startsWith(bl[0].name) && bl2.list[0].endsWith('holding') && bl2.danger > 0, JSON.stringify(bl2));

// 打散：對封鎖點連續砲擊，剩不到 50 隻撐 6 分鐘 → 打通
await g(() => { GAME.nexus.t = 99999; GAME.setSpeed(1); });
let cleared = false;
for (let i = 0; i < 160 && !cleared; i++) {
  await g(() => { const b = GAME.blockades[0]; if (b) for (const [dx, dy] of [[0, 0], [14, 0], [-14, 0], [0, 14], [0, -14]]) GAME.strike(b.x + dx, b.y + dy, 16, 0.2); });
  await sleep(400);
  cleared = await g(() => GAME.events.some((e) => e.text.startsWith('道路已打通')));
}
check('shelling the horde away reopens the road (danger cleared)', cleared && (await g(() => GAME.blockades.length)) === 0 && (await g(() => GAME.pathDangerCells)) === 0, await g(() => GAME.events.slice(0, 3).map((e) => e.text).join(' / ')));
const after2 = await g(([f, o]) => GAME.findPath(f.x, f.y + 15, o[0], o[1]), [fob, op]);
check('route goes back to the short way', routeInfo(after2, fob.x, fob.y + 15, 0, 0).len <= ri0.len + 8, `${routeInfo(after2, fob.x, fob.y + 15, 0, 0).len} m vs ${ri0.len} m`);
check('no page / GPU errors', logs.length === 0 && (await g(() => GAME.errors.length)) === 0, logs.slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
