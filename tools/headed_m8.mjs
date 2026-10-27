// M8 有頭驗證：音效（點一下才啟動、爆炸/槍聲/提示音不出錯、M 鍵與按鈕靜音）、日夜（截圖平均亮度：白天 > 黃昏 > 夜晚、夜裡窗戶亮）、爆炸圖更細。
// 用法：node tools/headed_m8.mjs
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { execFileSync } from 'child_process';
const require = createRequire('C:/Users/ray/AppData/Roaming/npm/node_modules/');
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
const PY = join(here, '..', '..', '_ext', 'sprite-gen', '.venv', 'Scripts', 'python.exe');
const W = 1600, H = 900;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, args: [`--window-size=${W + 16},${H + 140}`, '--window-position=60,40', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const g = (fn, arg) => page.evaluate(fn, arg);
const shot = async (n) => { const p = join(outDir, `m8-${n}.png`); await page.screenshot({ path: p, clip: { x: 300, y: 120, width: 1000, height: 600 } }); return p; };
// 截圖中間區域的平均亮度（避開 HUD）
const lum = (p) => +execFileSync(PY, ['-I', '-c', `from PIL import Image; import numpy as np; a=np.asarray(Image.open(r'${p}').convert('L'),dtype=float); print(a.mean())`]).toString().trim();
const bright = (p) => +execFileSync(PY, ['-I', '-c', `from PIL import Image; import numpy as np; a=np.asarray(Image.open(r'${p}').convert('RGB'),dtype=float); m=(a[...,0]>200)&(a[...,1]>160)&(a[...,2]<160); print(int(m.sum()))`]).toString().trim();

await page.goto(pathToFileURL(join(here, '..', 'index.html')).href);
await page.waitForFunction(() => window.GAME && GAME.frames > 30, null, { timeout: 60000 });
check('audio is not started before any input', (await g(() => GAME.sfx.state)) === 'none');
await page.mouse.click(800, 160);
await sleep(300);
check('first click starts the audio engine', (await g(() => GAME.sfx.state)) === 'running', await g(() => GAME.sfx.state));
// 出聲：砲兵（爆炸）、部隊開火（槍聲）、Nexus（提示音）
await g(() => { const f = GAME.info.fob; GAME.view(f.x, f.y + 380, 4); GAME.callSupport('artillery', f.x, f.y + 380); GAME.nexus.t = 0.2; GAME.select([1, 2, 3]); GAME.order(f.x, f.y + 330); GAME.setSpeed(2); });
await sleep(6000);
check('explosions, gunfire and Nexus alert played without errors', logs.length === 0 && (await g(() => GAME.errors.length)) === 0 && (await g(() => GAME.game.fx.length + GAME.events.length)) > 0);
await page.keyboard.press('KeyM');
const m1 = await g(() => [GAME.sfx.muted, document.getElementById('mute').textContent]);
await page.locator('#mute').click();
const m2 = await g(() => [GAME.sfx.muted, document.getElementById('mute').textContent]);
check('M key mutes, the toolbar button unmutes', m1[0] === true && m1[1] === '🔇' && m2[0] === false && m2[1] === '🔊', `${m1} → ${m2}`);

// 日夜：同一個位置、暫停，比較亮度
await page.keyboard.press('Space');
const d = await g(() => { const d = GAME.districts.find((d) => d.name === '金融區'); GAME.view(d.sx, d.sy - 30, 5); return d.name; });
const at = async (min, name) => { await g((m) => { GAME.sim.time = m; }, min); await sleep(500); return shot(name); };
const pDay = await at(5 * 60, 'day'), pDusk = await at(10 * 60 + 45, 'dusk'), pNight = await at(15 * 60, 'night');
const L = [lum(pDay), lum(pDusk), lum(pNight)];
check('screen gets darker toward night (day > dusk > night)', L[0] > L[1] && L[1] > L[2] && L[2] < L[0] * 0.65, L.map((v) => v.toFixed(1)).join(' > '));
const lit = [bright(pDay), bright(pNight)];
check('lit windows glow at night', lit[1] > lit[0] * 2 && lit[1] > 50, `warm bright pixels day ${lit[0]} → night ${lit[1]}`);
check('clock shows the evening time', /22:30/.test(await g(() => GAME.clockText())), await g(() => GAME.clockText()));
const fxh = await g(() => GAME.sprites.fx.cellH);
check('explosion sprite re-cut at finer pixels (cell ≥ 100 px tall)', fxh >= 100, `cell ${fxh} px`);
check('no page / GPU errors', (await g(() => GAME.errors.length)) === 0 && logs.length === 0, logs.slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
