// Headless WebGPU test: serves the project, captures console/GPU errors and screenshots.
// usage: node shot.mjs <name> [jsonSteps]
//   steps: [{ "eval": "GAME.preset('storm')" }, { "wait": 120 }, { "shot": "storm" }]
import { createRequire } from 'module';
import http from 'http';
import { readFileSync, mkdirSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
const require = createRequire('C:/Users/ray/AppData/Roaming/npm/node_modules/');
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const srv = http.createServer((q, s) => {
  try {
    const p = join(root, decodeURIComponent(q.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0]));
    const b = readFileSync(p);
    s.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
    s.end(b);
  } catch { s.writeHead(404); s.end(); }
}).listen(0);
const port = srv.address().port;
const steps = JSON.parse(process.env.STEPS || process.argv[3] || '[{"wait":150},{"shot":"default"}]');
const size = (process.env.SIZE || '1600x900').split('x').map(Number);
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--headless=new', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', ...(process.env.UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])],
});
const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:${port}/${process.env.Q || ""}`);
const waitFrames = async (n) => {
  const start = await page.evaluate(() => (window.GAME ? GAME.frames : 0));
  const t0 = Date.now();
  while (Date.now() - t0 < +(process.env.WAIT_MS || 240000)) {
    const f = await page.evaluate(() => (window.GAME ? GAME.frames : 0));
    if (f - start >= n) return;
    if (logs.some((l) => l.includes('pageerror'))) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  logs.push('[harness] timeout waiting for frames');
};
for (const st of steps) {
  if (st.wait) await waitFrames(st.wait);
  if (st.eval) logs.push('[eval] ' + JSON.stringify(await page.evaluate(st.eval)));
  if (st.sleep) await new Promise((r) => setTimeout(r, st.sleep));
  if (st.shot) {
    const file = join(outDir, `${process.argv[2] || 'run'}-${st.shot}.png`);
    await page.screenshot({ path: file });
    logs.push('[shot] ' + file);
  }
}
const info = await page.evaluate(() => window.GAME ? { frames: GAME.frames, errors: GAME.errors, info: GAME.info, stats: GAME.stats() } : null);
console.log(logs.join('\n'));
console.log('INFO', JSON.stringify(info));
await browser.close();
srv.close();
