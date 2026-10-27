// M16 有頭驗證：戰鬥特效與指揮回饋 —— 開火的槍口火光／命中、爆炸的衝擊波與粒子、士兵倒下的血跡、載具殘骸、下令落點圈、粒子池上限。
// 用法：node tools/headed_m16.mjs（PW_REQUIRE／CHROME／CHROME_ARGS／HEADLESS=1 可改成其他機器的 Playwright 與瀏覽器）
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const require = createRequire(process.env.PW_REQUIRE || 'C:/Users/ray/AppData/Roaming/npm/node_modules/');
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
const W = 1600, H = 900;
const browser = await chromium.launch({
  executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: !!process.env.HEADLESS,
  args: [`--window-size=${W + 16},${H + 140}`, '--window-position=60,40', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(' ') : [])],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };
const g = (fn, arg) => page.evaluate(fn, arg);
const frames = async (n) => { const f0 = await g(() => GAME.frames); await page.waitForFunction((f) => GAME.frames >= f, f0 + n, { timeout: 300000 }); };
const shot = (n) => page.screenshot({ path: join(outDir, `m16-${n}.png`) });

// 喪屍少一點就好（特效只跟單位有關）
await page.goto(pathToFileURL(join(here, '..', 'index.html')).href + '?n=60000');
await page.waitForFunction(() => window.GAME && GAME.frames > 5, null, { timeout: 300000 });
// 部隊全部搬到開局就被圍的避難所旁邊
const s = await g(() => {
  const s = GAME.game.survivors[0], off = [[-4, -14], [18, -22], [6, -8], [30, -30]];
  GAME.units.forEach((u, k) => { u.x = s[0] + off[k][0]; u.y = s[1] + off[k][1]; u.tx = u.x; u.ty = u.y; u.path = []; if (u.type === 'heli') { u.z = 30; u.tz = 30; } });
  GAME.view(s[0] + 8, s[1] - 22, 12);
  return s;
});
await page.waitForFunction(() => GAME.units.some((u) => u.firing) && GAME.fx.particles > 0, null, { timeout: 300000 });
check('firing units spawn muzzle flashes / impacts (particles > 0)', (await g(() => GAME.fx.particles)) > 0, `particles ${await g(() => GAME.fx.particles)}`);

// 右鍵下令：落點圈、選取單位的虛線路徑與血條
await g((s) => { GAME.select([2]); GAME.orderAt(s[0] + 24, s[1] - 34); }, s);
check('move order leaves a contracting ping at the destination', (await g(() => GAME.fx.marks(5))) === 1);
await frames(2);
const inst = await g(() => GAME.fx.instances);
await shot('01-order');

// 爆炸：衝擊波圈＋火星／煙
const p0 = await g(() => GAME.fx.particles);
await g((s) => GAME.fx.explode(s[0] + 10, s[1] - 10, 22), s);
check('explosion adds a shockwave ring and particles', (await g(() => GAME.fx.marks(4))) >= 1 && (await g(() => GAME.fx.particles)) > p0 + 20, `ring ${await g(() => GAME.fx.marks(4))}, particles ${p0} → ${await g(() => GAME.fx.particles)}`);
await frames(3);
await shot('02-explosion');

// 士兵倒下＝血跡；戰車／直升機被毀＝殘骸
const blood0 = await g(() => GAME.fx.marks(6));
await g(() => { const u = GAME.units; u.find((v) => v.type === 'squad').dmg = 350; u.find((v) => v.type === 'tank').hp = 0; u.find((v) => v.type === 'heli').hp = 0; });
await frames(3);
check('three soldiers down leave (at least) three blood pools', (await g(() => GAME.fx.marks(6))) - blood0 >= 3, `blood ${blood0} → ${await g(() => GAME.fx.marks(6))}`);
check('destroyed tank and heli leave burning wrecks', (await g(() => GAME.fx.wrecks)) === 2, `wrecks ${await g(() => GAME.fx.wrecks)}`);
await frames(60);
await shot('03-wrecks');

// 粒子池有上限：連炸 60 次也不會超過，實例數也不會超過緩衝區
await g(() => { for (let k = 0; k < 60; k++) GAME.fx.explode(1000 + k * 3, 1000, 95); });
await frames(2);
const pn = await g(() => GAME.fx.particles), pi = await g(() => GAME.fx.instances);
check('particle pool stays bounded under 60 big explosions', pn <= (await g(() => GAME.fx.maxParticles)) && pi <= (await g(() => GAME.fx.maxInstances)), `particles ${pn}, instances ${pi} (before ${inst})`);
check('no page / GPU errors', (await g(() => GAME.errors.length)) === 0 && logs.length === 0, [...(await g(() => GAME.errors)), ...logs].slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
