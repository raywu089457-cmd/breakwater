// M11 有頭驗證：檢疫站——按鈕切換政策；快速放行漏掉大部分感染者、隔離觀察幾乎全抓到；漏檢的在基地內屍變（爆發）；排太久的在門口屍變；篩檢花補給；真的撤離會送進隊伍。
// 用法：node tools/headed_m11.mjs
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
const Q = () => g(() => ({ ...GAME.quarantine, queue: GAME.queueLen(), iso: GAME.quarantine.isolation.length, ainf: GAME.quarantine.admittedInf.length }));
const waitQueueEmpty = (ms) => page.waitForFunction(() => GAME.queueLen() === 0, null, { timeout: ms });

await page.goto(pathToFileURL(join(here, '..', 'index.html')).href);
await page.waitForFunction(() => window.GAME && GAME.frames > 30, null, { timeout: 60000 });
await g(() => { GAME.nexus.t = 99999; GAME.supply.stock = 5000; GAME.game.ciws = false; });
check('quarantine panel shows, standard screening is the default', await g(() => document.querySelector('[data-qp="standard"]').classList.contains('on') && /排隊/.test(document.getElementById('qstat').textContent)));

// 快速放行：200 人裡 40 個感染（潛伏很久，不會在測試中屍變）
await page.locator('[data-qp="fast"]').click();
await g(() => GAME.qEnqueue(200, 40, 9999));
await page.keyboard.press('Digit4');
await waitQueueEmpty(60000);
let q = await Q();
const fastMissed = q.ainf, fastCaught = q.detected;
check('fast admit clears 200 people quickly but lets most infected through', fastMissed >= 22 && fastMissed + fastCaught === 40, `missed ${fastMissed}/40, caught ${fastCaught}`);

// 隔離觀察：同樣 200 人 40 感染
await page.locator('[data-qp="strict"]').click();
const s0 = await g(() => GAME.supply.stock);
const t0 = await g(() => GAME.sim.time);
await g(() => GAME.qEnqueue(200, 40, 9999));
await waitQueueEmpty(150000);
q = await Q();
const strictMissed = q.ainf - fastMissed, strictCaught = q.detected - fastCaught;
const minutes = (await g(() => GAME.sim.time)) - t0, spent = s0 - (await g(() => GAME.supply.stock));
check('quarantine observation catches almost everyone (much slower)', strictMissed <= 4 && strictCaught >= 36 && minutes > 50, `missed ${strictMissed}/40, ${minutes.toFixed(0)} game-min for 200 people`);
check('screening costs supply (0.5 per person)', spent > 80, `spent ~${spent.toFixed(0)} (incl. other use)`);

// 漏檢的感染者在基地內屍變 → 爆發
await page.locator('[data-qp="fast"]').click();
const n0 = await g(() => GAME.sim.n);
await g(() => GAME.qEnqueue(60, 20, 8));
await page.waitForFunction(() => GAME.quarantine.outbreaks > 0, null, { timeout: 60000 });
await sleep(400);
q = await Q();
check('undetected infected turn inside the base (outbreak, new zombies)', q.outbreaks > 0 && (await g(() => GAME.sim.n)) > n0 && (await g(() => GAME.events.some((e) => /基地內有人屍變/.test(e.text)))), `outbreaks ${q.outbreaks}`);
await g((f) => GAME.view(GAME.info.fob.x, GAME.info.fob.y + 30, 8));
await sleep(400);
await page.screenshot({ path: join(outDir, 'm11-outbreak.png') });

// 隊伍太長、潛伏期短 → 在門口屍變
await page.locator('[data-qp="strict"]').click();
await g(() => GAME.qEnqueue(300, 30, 6));
await page.waitForFunction(() => GAME.quarantine.queueTurned > 0, null, { timeout: 60000 });
check('infected waiting too long in the queue turn at the gate', (await Q()).queueTurned > 0 && (await g(() => GAME.events.some((e) => /隊伍裡有人屍變/.test(e.text)))));
await page.screenshot({ path: join(outDir, 'm11-queue.png') });

// 真的撤離：運輸直升機從西灘撤人 → 進隊伍
await page.locator('[data-qp="standard"]').click();
await g(() => { GAME.quarantine.queue.length = 0; const h = GAME.deploy('transport'); const d = GAME.districts.find((d) => d.name === '西灘'); GAME.select([h.id]); GAME.orderAt(d.sx, d.sy); });
await page.waitForFunction(() => GAME.events.some((e) => /撤回 \d+ 人，送檢疫站/.test(e.text)), null, { timeout: 90000 });
check('a real evacuation delivers people into the quarantine queue', /撤回 \d+ 人/.test(await g(() => GAME.events.find((e) => /撤回/.test(e.text)).text)));
check('panel shows queue, isolation and outbreak counts', await g(() => /排隊 .* · 隔離 \d+ · 爆發 \d+/.test(document.getElementById('qstat').textContent)), await g(() => document.getElementById('qstat').textContent));
check('no page / GPU errors', logs.length === 0 && (await g(() => GAME.errors.length)) === 0, logs.slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
