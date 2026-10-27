// M7 有頭驗證：Nexus 預警橫幅、點橫幅跳過去、預警 → 屍潮來襲（目標區喪屍變多）、車隊伏擊追著卡車、駐軍讓目標排名下降、攻擊升級。
// 用法：node tools/headed_m7.mjs
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
const shot = (n) => page.screenshot({ path: join(outDir, `m7-${n}.png`) });

await page.goto(pathToFileURL(join(here, '..', 'index.html')).href);
await page.waitForFunction(() => window.GAME && GAME.frames > 30, null, { timeout: 60000 });
check('no Nexus banner at the start', (await g(() => document.getElementById('nexus').style.display)) === 'none');

// 駐軍：把兩個步兵班＋戰車派到第一名候選旁邊 → 它的防守值上升、排名下降
const top0 = await g(() => { const c = GAME.nexusCandidates()[0]; return { name: c.name, x: c.x, y: c.y, defense: c.defense }; });
await g((t) => { for (const u of GAME.units.filter((u) => u.type === 'squad' || u.type === 'tank')) { u.x = t.x + (Math.random() - 0.5) * 20; u.y = t.y + (Math.random() - 0.5) * 20; u.path = []; } }, top0);
await sleep(300);
const after = await g((n) => { const c = GAME.nexusCandidates(); const i = c.findIndex((q) => q.name === n); return { rank: i, defense: c[i].defense, top: c[0].name }; }, top0.name);
check('garrisoning the top target raises its defense and drops its rank', after.defense > top0.defense && after.rank > 0, `${top0.name}: defense ${top0.defense.toFixed(0)} → ${after.defense.toFixed(0)}, rank 0 → ${after.rank} (now top: ${after.top})`);
await g(() => { const f = GAME.info.fob; GAME.units.filter((u) => u.type === 'squad' || u.type === 'tank').forEach((u, k) => { u.x = f.x - 30 + k * 25; u.y = f.y + 25; }); });

// 預警
await g(() => { GAME.nexus.t = 0.3; });
await page.keyboard.press('Digit4');
await page.waitForFunction(() => GAME.nexus.phase === 'warn', null, { timeout: 15000 });
await sleep(400);   // HUD 每 250 ms 更新一次
const tgt = await g(() => ({ name: GAME.nexus.target.name, kind: GAME.nexus.target.kind, x: GAME.nexus.target.x, y: GAME.nexus.target.y }));
const banner = await g(() => ({ shown: document.getElementById('nexus').style.display !== 'none', text: document.getElementById('nexus').textContent }));
check('Nexus picks a target and shows a warning banner with countdown', banner.shown && banner.text.includes(tgt.name) && /分鐘後抵達/.test(banner.text), banner.text);
check('warning also lands in the event log', (await g(() => GAME.events[0].text)).includes('NEXUS'));
await page.locator('#nexus').click();
await sleep(300);
const camD = await g((t) => Math.hypot(GAME.cam.x - t.x, GAME.cam.y - t.y), tgt);
check('clicking the banner jumps the camera to the target', camD < 5, `off ${camD.toFixed(1)} m`);
await shot('01-warning');

// 來襲：目標周圍喪屍變多
const did = await g((t) => GAME.districts.find((d) => d.name === t.name)?.k ?? 0, tgt);
const near0 = await g((k) => GAME.sim.distCounts[k], did);
await page.waitForFunction(() => GAME.nexus.phase === 'attack', null, { timeout: 30000 });
await sleep(400);
check('after the warning the attack begins (banner pulses)', (await g(() => document.getElementById('nexus').className)).includes('attack'));
await sleep(12000);
const near1 = await g((k) => GAME.sim.distCounts[k], did);
const sieged = await g((n) => { const d = GAME.districts.find((d) => d.name === n); return d ? d.state + ' ' + d.siege.toFixed(1) : '—'; }, tgt.name);
check('the horde surges into the target district', near1 > near0 * 1.03 || /crisis/.test(sieged), `${tgt.name}: ${near0.toLocaleString()} → ${near1.toLocaleString()} zombies, ${sieged}`);
await g((t) => GAME.view(t.x, t.y, 2.5), tgt);
await sleep(400);
await shot('02-attack');

// 車隊伏擊：卡車在補給線上 → 候選裡有車隊；強制當目標 → 標記追著卡車前方
await g(() => { GAME.supply.stock = 2000; const t = GAME.deploy('truck'); const f = GAME.info.fob; const o = GAME.placeOutpost(f.x - 260, f.y + 420) || GAME.placeOutpost(f.x + 260, f.y + 380); GAME.select([t.id]); GAME.orderAt(o.x, o.y); });
await sleep(2500);
const conv = await g(() => GAME.nexusCandidates().find((c) => c.kind === 'convoy'));
check('a truck on a supply run shows up as a convoy target', !!conv, conv ? `${conv.name} score ${conv.score.toFixed(1)}` : 'none');
const track = await g(() => {
  const c = GAME.nexusCandidates().find((c) => c.kind === 'convoy');
  GAME.nexus.target = c; GAME.nexus.phase = 'attack'; GAME.nexus.attackT = 60;
  return true;
});
const p0 = await g(() => [GAME.nexus.target.x, GAME.nexus.target.y, GAME.nexus.target.ref.x, GAME.nexus.target.ref.y]);
await sleep(3000);
const p1 = await g(() => [GAME.nexus.target.x, GAME.nexus.target.y, GAME.nexus.target.ref.x, GAME.nexus.target.ref.y]);
const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), gap = Math.hypot(p1[0] - p1[2], p1[1] - p1[3]);
check('ambush point follows the moving truck (just ahead of it)', track && moved > 5 && gap < 60, `ambush moved ${moved.toFixed(0)} m, ${gap.toFixed(0)} m from truck`);
// 升級：結束這波 → 下一波更快
const a0 = await g(() => GAME.nexus.attacks);
await g(() => { GAME.nexus.attackT = 0.1; });
await sleep(600);
const esc = await g(() => ({ attacks: GAME.nexus.attacks, phase: GAME.nexus.phase, t: GAME.nexus.t }));
check('waves escalate (attack count up, next wave sooner than 75 min)', esc.attacks === a0 + 1 && esc.phase === 'idle' && esc.t < 75, JSON.stringify(esc));
check('no page / GPU errors', (await g(() => GAME.errors.length)) === 0 && logs.length === 0, logs.slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
