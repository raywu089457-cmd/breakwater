// 開測試用的瀏覽器：本機（Windows Chrome、有頭）或雲端容器（Playwright 內建 Chromium、無頭、SwiftShader WebGPU）自動判斷。
// 環境變數照舊可以蓋掉：PW_REQUIRE（playwright 所在的 node_modules）、CHROME（瀏覽器執行檔）、CHROME_ARGS、HEADLESS=1
import { createRequire } from 'module';
import { existsSync, readdirSync } from 'fs';
const PW_DIR = '/opt/pw-browsers';
const CLOUD_CHROME = existsSync(PW_DIR) ? readdirSync(PW_DIR).filter((d) => /^chromium-\d+$/.test(d)).map((d) => `${PW_DIR}/${d}/chrome-linux64/chrome`).find(existsSync) : null;
const WIN_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// SwiftShader 要用完整版 Chromium（headless shell 的 WebGPU 畫布做不出 swap chain，裝置一開就被銷毀）
const CLOUD_ARGS = '--no-sandbox --enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader --use-angle=swiftshader --use-webgpu-adapter=swiftshader --disable-vulkan-surface';
export const cloud = !process.env.CHROME && !!CLOUD_CHROME;
export async function launch(W, H) {
  const req = createRequire(process.env.PW_REQUIRE || (cloud ? '/opt/node-tools/node_modules/' : 'C:/Users/ray/AppData/Roaming/npm/node_modules/'));
  const { chromium } = req('playwright');
  const extra = process.env.CHROME_ARGS ?? (cloud ? CLOUD_ARGS : '');
  return chromium.launch({
    executablePath: process.env.CHROME || (cloud ? CLOUD_CHROME : WIN_CHROME), headless: cloud || !!process.env.HEADLESS,
    args: [`--window-size=${W + 16},${H + 140}`, '--window-position=60,40', ...(extra ? extra.split(' ') : [])],
  });
}
// 截圖：雲端（SwiftShader）頁面截圖拍不到 WebGPU 畫布，改成等下一個遊戲幀畫完、在同一幀裡讀畫布
export async function canvasShot(page, path) {
  const { writeFileSync } = await import('fs');
  const url = await page.evaluate(() => new Promise((res) => {
    const f0 = GAME.frames;
    const tick = () => { if (GAME.frames > f0) res(document.querySelector('canvas').toDataURL('image/png')); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }));
  writeFileSync(path, Buffer.from(url.split(',')[1], 'base64'));
}
