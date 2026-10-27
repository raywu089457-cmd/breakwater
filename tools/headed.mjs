// 有頭瀏覽器驗證：真的開一個 Chrome 視窗、用 file:// 開 index.html（跟使用者一樣），
// 用真的滑鼠滾輪／拖曳／點擊／鍵盤操作，逐項檢查並截圖到 tools/out/headed-*.png。
// 用法：node tools/headed.mjs   （HOLD=秒數 讓視窗最後多留一下）
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const require = createRequire('C:/Users/ray/AppData/Roaming/npm/node_modules/');
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
const url = pathToFileURL(join(here, '..', 'index.html')).href + (process.env.Q || '');

const W = 1600, H = 900;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: [`--window-size=${W + 16},${H + 140}`, '--window-position=60,40'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { await page.screenshot({ path: join(outDir, `headed-${name}.png`) }); };
const g = (fn, arg) => page.evaluate(fn, arg);
const fpsOver = async (ms) => {
  const a = await g(() => [GAME.frames, performance.now()]);
  await sleep(ms);
  const b = await g(() => [GAME.frames, performance.now()]);
  return ((b[0] - a[0]) * 1000) / (b[1] - a[1]);
};
// 世界座標 → 視窗座標（用遊戲自己的 vp 矩陣）
const toScreen = (x, y) => g(([x, y]) => {
  const m = GAME.cam.vp; const cx = m[0] * x + m[4] * y + m[12], cy = m[1] * x + m[5] * y + m[13], w = m[3] * x + m[7] * y + m[15];
  return [((cx / w) * 0.5 + 0.5) * innerWidth, (0.5 - (cy / w) * 0.5) * innerHeight];
}, [x, y]);
const hud = () => g(() => Object.fromEntries([...document.querySelectorAll('#statRows .r')].map((r) => [r.children[0].textContent, r.children[1].textContent])));

const t0 = Date.now();
await page.goto(url);
let ready = false;
for (let i = 0; i < 240 && !ready; i++) {
  ready = await g(() => !!(window.GAME && GAME.frames > 30)).catch(() => false);
  if (!ready) {
    const err = await g(() => { const e = document.getElementById('err'); return e && e.style.display === 'block' ? e.textContent : ''; }).catch(() => '');
    if (err) { check('page boots over file://', false, err); break; }
    await sleep(250);
  }
}
check('page boots over file:// with WebGPU', ready, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (!ready) { console.log(logs.join('\n')); await browser.close(); process.exit(1); }
const info = await g(() => ({ ...GAME.info, n: GAME.sim.n, adapter: null }));
check('1,000,000 zombies spawned', info.n === 1000000, `n=${info.n}, buildings=${info.buildings}`);
await sleep(1500);
const fpsStart = await fpsOver(3000);
check('tactical view frame rate', fpsStart > 50, `${fpsStart.toFixed(1)} fps (vsync)`);
await shot('01-start');

// 1) 滾輪拉遠 → 作戰地圖
await page.mouse.move(W / 2, H / 2);
for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 120); await sleep(40); }
await sleep(800);
const opsCam = await g(() => ({ ppm: GAME.cam.ppm, pitch: (GAME.cam.pitch * 180) / Math.PI }));
const mode = await g(() => document.getElementById('mode').textContent);
check('wheel out → ops map (pitch 90°, heatmap)', mode === '作戰地圖' && opsCam.pitch > 89, `ppm ${opsCam.ppm.toFixed(2)}, pitch ${opsCam.pitch.toFixed(0)}°, mode ${mode}`);
const fpsOps = await fpsOver(2500);
check('ops map frame rate', fpsOps > 50, `${fpsOps.toFixed(1)} fps`);
await shot('02-ops');

// 2) 對準市中心滾輪拉近（游標下的地點要留在游標下）
const dt = await g(() => ({ x: GAME.info.fob.x, y: GAME.info.fob.y }));
// 滑鼠事件的 clientX/Y 是整數，所以錨點要用整數像素底下的地面點來量
const [ts0, ts1] = await toScreen(1240, 1000);
const sx = Math.round(ts0), sy = Math.round(ts1) + 150;
const target = await g(([x, y]) => GAME.groundAt(x, y), [sx, sy]);
await page.mouse.move(sx, sy);
for (let i = 0; i < 26; i++) { await page.mouse.wheel(0, -120); await sleep(40); }
await sleep(800);
const [sx2, sy2] = await toScreen(...target);
const zin = await g(() => ({ ppm: GAME.cam.ppm, pitch: (GAME.cam.pitch * 180) / Math.PI }));
check('wheel in keeps the point under the cursor', Math.hypot(sx2 - sx, sy2 - sy) < 12, `drift ${Math.hypot(sx2 - sx, sy2 - sy).toFixed(1)} px, ppm ${zin.ppm.toFixed(2)}, pitch ${zin.pitch.toFixed(0)}°`);
const vis = await g(() => GAME.sim.visible);
await sleep(600);
check('zombies drawn in tactical view', (await g(() => GAME.sim.visible)) > 500, `visible ${await g(() => GAME.sim.visible)}`);
await shot('03-downtown');

// 3) 右鍵拖曳平移（M3 起左鍵拖曳是框選）
const camA = await g(() => ({ x: GAME.cam.x, y: GAME.cam.y }));
await page.mouse.move(W / 2, H / 2);
await page.mouse.down({ button: 'right' });
for (let i = 1; i <= 15; i++) { await page.mouse.move(W / 2 - i * 20, H / 2 + i * 6); await sleep(16); }
await page.mouse.up({ button: 'right' });
await sleep(300);
const camB = await g(() => ({ x: GAME.cam.x, y: GAME.cam.y, ppm: GAME.cam.ppm }));
const expDx = (300 / W) * 2 * (await g(() => GAME.cam.halfW));
check('drag pans the map (no strike fired)', camB.x - camA.x > expDx * 0.8 && (await g(() => GAME.game.pending.length)) === 0,
  `cam.x +${(camB.x - camA.x).toFixed(1)} m (expected ≈ ${expDx.toFixed(1)}), y +${(camB.y - camA.y).toFixed(1)}`);

// 4) 砲兵（M4 起取代單發砲擊）+ 左鍵：預警 → 6 發 → 擊殺
await page.getByRole('button', { name: '砲兵' }).click();
const killsA = await g(() => GAME.sim.kills);
const pt = await g(() => [GAME.cam.x, GAME.cam.y]);
const [px, py] = await toScreen(pt[0], pt[1]);
await page.mouse.click(px, py);
await sleep(200);
const pend = await g(() => GAME.support.missions.length);
check('left click calls an artillery mission', pend === 1, `missions ${pend}`);
await shot('04-warning');
await sleep(3600);
await shot('05-boom');
await sleep(2500);
const killsB = await g(() => GAME.sim.kills);
check('strike kills zombies', killsB - killsA > 20, `kills +${killsB - killsA}`);
await shot('06-after');

// 5) 右鍵信標、工具列按鈕
await page.keyboard.press('Escape');
await page.getByRole('button', { name: '指揮' }).click();
await page.mouse.click(px + 200, py, { button: 'right' });
await sleep(150);
const nb = await g(() => GAME.game.beacons.length);
check('right click places a beacon', nb === 1, `beacons ${nb}`);
await page.getByRole('button', { name: '近防' }).click();
await sleep(100);
const ciwsOff = await g(() => !GAME.game.ciws && GAME.sim.zones[0][2] === 0);
await page.getByRole('button', { name: '近防' }).click();
await sleep(100);
const ciwsOn = await g(() => GAME.game.ciws && GAME.sim.zones[0][2] === 118);
check('CIWS toolbar toggle', ciwsOff && ciwsOn);
await page.getByRole('button', { name: '信標' }).click();
await page.mouse.click(px - 200, py);
await sleep(150);
check('beacon tool via toolbar + left click', (await g(() => GAME.game.beacons.length)) === 2 && (await g(() => GAME.game.pending.length)) === 0);
await page.getByRole('button', { name: '指揮' }).click();

// 6) 鍵盤：4 倍速、暫停、像素大小
await page.keyboard.press('Digit4');
const sp = await g(() => [GAME.sim.speed, document.querySelector('[data-speed="4"]').classList.contains('on')]);
check('key 4 → 4× speed (button lit)', sp[0] === 4 && sp[1]);
const simT0 = await g(() => GAME.sim.time);
const fps4 = await fpsOver(3000);
const simT1 = await g(() => GAME.sim.time);
check('4× speed advances sim time ~4× real time', (simT1 - simT0) / 3 > 3.2, `${((simT1 - simT0) / 3).toFixed(2)}× , ${fps4.toFixed(1)} fps`);
await page.keyboard.press('Space');
const tP0 = await g(() => GAME.sim.time); await sleep(1000); const tP1 = await g(() => GAME.sim.time);
check('space pauses', (await g(() => GAME.sim.speed)) === 0 && tP1 === tP0);
await page.keyboard.press('Space');
check('space resumes at previous speed', (await g(() => GAME.sim.speed)) === 4);
await page.keyboard.press('BracketRight');
await sleep(400);
await shot('07-pixel3');
await page.keyboard.press('BracketLeft');

// 7) 4 倍速跑 40 秒（模擬約 160 秒）看屍潮湧向基地
await sleep(40000);
await g((p) => GAME.view(p.x, p.y + 100, 2.4), dt);
await sleep(1500);
await shot('08-siege-mid');
const st = await g(() => GAME.stats());
const hudNow = await hud();
check('HUD shows live numbers', hudNow['喪屍存活'] && hudNow['擊殺'] !== '0', JSON.stringify(hudNow));
await g(() => GAME.view(GAME.info.fob.x, GAME.info.fob.y, 0.35));
await sleep(1500);
await shot('09-ops-late');
check('no GPU / page errors', (await g(() => GAME.errors.length)) === 0 && !logs.some((l) => /pageerror|\[gpu\]|error/i.test(l)), logs.slice(0, 5).join(' | '));

console.log('STATS', JSON.stringify(st));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
if (logs.length) console.log('CONSOLE\n' + logs.slice(0, 20).join('\n'));
if (process.env.HOLD) await sleep(+process.env.HOLD * 1000);
await browser.close();
