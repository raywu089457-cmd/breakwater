// M14 有頭驗證：三格手動存檔＋自動存檔——戰役面板的存／讀按鈕、各格顯示內容、自動存檔不卡畫面、
// 屍堆改成只存有值的格（讀回來逐格一樣）、舊版（第 1 版，整張屍堆）存檔還讀得進來。
// 用法：node tools/headed_m14.mjs
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
const openMap = async () => {
  if (!(await page.locator('#cmap').isVisible())) await page.getByRole('button', { name: '戰役', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('#cmap .sl .si')].some((e) => e.textContent.includes('讀取中')), null, { timeout: 15000 });
};
const rows = () => g(() => [...document.querySelectorAll('#cmap .sl')].map((r) => ({ slot: r.dataset.slot, text: r.querySelector('.si').textContent, canLoad: !r.querySelector('[data-load]').disabled })));
const slotRow = (slot) => page.locator(`#cmap .sl[data-slot="${slot}"]`);
const loadVia = async (slot) => {
  await openMap();
  await Promise.all([page.waitForNavigation({ timeout: 60000 }), slotRow(slot).locator('[data-load]').click()]);
  await boot();
  await page.waitForFunction(() => GAME.events.some((e) => e.text.startsWith('讀取存檔')), null, { timeout: 30000 });
};

await page.goto(url + '?region=0');
await boot();
await g(() => new Promise((r) => { localStorage.removeItem('bw-campaign'); const q = indexedDB.deleteDatabase('breakwater'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.goto(url + '?region=0');
await boot();
await g(() => { GAME.nexus.t = 99999; });
await openMap();
const r0 = await rows();
check('campaign panel lists 3 manual slots + autosave, all empty', r0.length === 4 && r0.every((r) => r.text === '空' && !r.canLoad) && r0[3].slot === 'auto', JSON.stringify(r0.map((r) => r.slot)));
await page.screenshot({ path: join(outDir, 'm14-slots-empty.png') });
await page.getByRole('button', { name: '關閉' }).click();

// 讓屍堆長出來：在危機避難所前的街上築一道牆，4 倍速跑一下
const sh = await g(() => { const d = GAME.districts.find((d) => d.state === 'crisis'); return [d.sx, d.sy]; });
await g(([x, y]) => { GAME.supply.stock = 5000; for (const [dx, dy] of [[0, 18], [0, -18]]) GAME.placeWall(x - 20, y + dy, x + 20, y + dy); GAME.setSpeed(4); }, sh);
let pile = { n: 0 };
for (let i = 0; i < 60 && pile.n < 50; i++) { await sleep(500); pile = await g(() => GAME.pileStats()); }
await g(() => GAME.setSpeed(0));
await sleep(300);
const pileA = await g(() => GAME.pileStats());
// 存到存檔 2（面板按鈕）
await openMap();
await slotRow('slot2').locator('[data-save]').click();
await page.waitForFunction(() => GAME.events.some((e) => e.text.startsWith('已存檔到存檔 2')), null, { timeout: 30000 });
await sleep(400);
const clock2 = await g(() => GAME.clockText());
const r1 = await rows();
const ev2 = await g(() => GAME.events.find((e) => e.text.startsWith('已存檔到存檔 2')).text);
check('“存” on slot 2 saves there and the row shows region + clock', r1[1].canLoad && r1[1].text.includes('灣岸市') && r1[1].text.includes(clock2) && r1[0].text === '空', `${r1[1].text} | ${ev2}`);
await page.getByRole('button', { name: '關閉' }).click();
// 再跑一段，存到存檔 3
await g(() => GAME.setSpeed(4));
await sleep(4000);
await g(() => GAME.setSpeed(0));
const clock3 = await g(() => GAME.clockText());
await openMap();
await slotRow('slot3').locator('[data-save]').click();
await page.waitForFunction(() => GAME.events.some((e) => e.text.startsWith('已存檔到存檔 3')), null, { timeout: 30000 });
await sleep(400);
const r2 = await rows();
check('slot 3 holds a later save; slot 2 unchanged', r2[2].text.includes(clock3) && r2[1].text.includes(clock2) && clock3 !== clock2, `${r2[1].text} / ${r2[2].text}`);
await page.getByRole('button', { name: '關閉' }).click();

// 自動存檔：倒數設成 2 遊戲分鐘，1 倍速；量自動存檔期間最長的一幀
await g(() => {
  window.__gaps = []; let last = performance.now();
  const tick = (t) => { window.__gaps.push(t - last); last = t; if (window.__gaps.length < 2000) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  GAME.autoT = 2; GAME.setSpeed(1);
});
const autoOk = await page.waitForFunction(() => GAME.events.some((e) => e.text.startsWith('自動存檔')), null, { timeout: 30000 }).then(() => true, () => false);
await sleep(500);
const gaps = await g(() => window.__gaps.slice(2));
const worst = Math.max(...gaps);
const autoEv = await g(() => GAME.events.find((e) => e.text.startsWith('自動存檔'))?.text);
check('autosave fires on its timer without a long freeze', autoOk && worst < 250, `${autoEv}, worst frame ${worst.toFixed(0)} ms`);
await g(() => GAME.setSpeed(0));
await openMap();
const r3 = await rows();
check('autosave row filled (no 存 button on it)', r3[3].canLoad && r3[3].text.includes('灣岸市') && (await slotRow('auto').locator('[data-save]').count()) === 0, r3[3].text);
await page.screenshot({ path: join(outDir, 'm14-slots-filled.png') });

// 讀存檔 2：時間、屍堆逐格一樣
await loadVia('slot2');
const ld2 = await g(() => ({ clock: GAME.clockText(), ev: GAME.events.find((e) => e.text.startsWith('讀取存檔')).text }));
await sleep(500);
const pileB = await g(() => GAME.pileStats());
check('“讀” on slot 2 restores that save (clock)', ld2.clock === clock2 && ld2.ev.includes('存檔 2'), `${ld2.clock} vs ${clock2} | ${ld2.ev}`);
check('sparse pile round-trips exactly', pileA.n > 0 && pileB.n === pileA.n && Math.abs(pileB.sum - pileA.sum) < 1e-3, `saved ${JSON.stringify(pileA)} → loaded ${JSON.stringify(pileB)}`);
const sz = await g(async () => { const r = await GAME.saveGame('slot1'); return r; });
check('pile now stored sparsely (save much smaller than the full 16 MB grid)', sz && sz.pileCells < 200000, `${sz && sz.pileCells} pile cells, ${(sz.bytes / 1048576).toFixed(1)} MB total`);

// 舊版存檔：把存檔 2 轉成第 1 版格式（整張屍堆）放進存檔 3，讀得進來
await g(() => new Promise((res, rej) => {
  const r = indexedDB.open('breakwater', 1);
  r.onsuccess = () => {
    const db = r.result, tx = db.transaction('saves', 'readwrite'), st = tx.objectStore('saves');
    const q = st.get('slot2');
    q.onsuccess = () => {
      const s = q.result, f = new Float32Array(2048 * 2048), idx = new Uint32Array(s.pileIdx), val = new Float32Array(s.pileVal);
      for (let j = 0; j < idx.length; j++) f[idx[j]] = val[j];
      s.pile = f.buffer; delete s.pileIdx; delete s.pileVal; s.ver = 1; s.clock = s.clock;
      st.put(s, 'slot3');
    };
    tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error);
  };
}));
await loadVia('slot3');
await sleep(500);
const pileC = await g(() => GAME.pileStats());
check('a version-1 save (full pile grid) still loads', (await g(() => GAME.clockText())) === clock2 && pileC.n === pileA.n, JSON.stringify(pileC));
// 讀自動存檔
await loadVia('auto');
check('autosave slot loads', (await g(() => GAME.events.find((e) => e.text.startsWith('讀取存檔')).text)).includes('自動存檔'));
check('no page / GPU errors', logs.length === 0 && (await g(() => GAME.errors.length)) === 0, logs.slice(0, 3).join(' | '));
console.log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
await browser.close();
