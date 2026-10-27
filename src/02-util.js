// ---------- 常數、數學、攝影機 ----------
const WN = 2048;            // 世界邊長（公尺）= 細格數（1 m／格）
const NN = 512;             // 導航格數（4 m／格）
const CELL = WN / NN;
const MAX_AGENTS = 1 << 21; // 緩衝區上限（約 210 萬）
const T = { ROAD: 0, BUILDING: 1, WATER: 2, GRASS: 3, SIDEWALK: 4, CONCRETE: 5, SAND: 6, WALL: 7, MARK: 8 };
const INF = 1e9;
const CORPSE_TIME = 45;   // 屍體留在地上的秒數
const WALL_H = 4.0;       // 混凝土 T 牆高度（公尺）
const CLIMB_REACH = 1.7;  // 喪屍從腳下高度能攀上的高度：屍堆 + 這個 ≥ 牆高 就翻得過去
const WALL_NAV_COST = 7;  // 導航格裡有牆：每格成本加這麼多（有缺口就繞缺口，沒有就硬攻）
const MAX_HELI = 4;
const START_MIN = 7 * 60 + 30;

// ---------- 戰役：5 個戰區，難度遞增；區名的順序對應 DISTRICT_ANCHORS 的地理位置（市中心、港灣、西南岸、東南岸、西、…）；進度存在瀏覽器（localStorage，失敗就只在這次有效）----------
const REGIONS = [
  { name: '灣岸市', seed: 11, n: 1000000, nexus: 1.0, names: null },
  { name: '北港', seed: 23, n: 1200000, nexus: 1.15, map: { river: { x: 820, w: 36, bridgeEvery: 2 } }, names: ['市政區', '碼頭區', '燈塔', '漁港', '老街', '體育館', '大學', '中央公園', '醫院', '倉庫區', '新村', '北坡', '火車站', '運河'] },
  { name: '霧島', seed: 37, n: 1400000, nexus: 1.3, map: { bay: { x: 640, depth: 260, w: 220 }, diag: { x0: 120, y0: 620, x1: 1960, y1: 1500, w: 22 } }, names: ['市場', '港務局', '西岬', '渡輪站', '茶街', '球場', '學院', '植物園', '療養院', '溪口', '眷村', '山城', '溫泉區', '觀景台'] },
  { name: '南溪', seed: 41, n: 1600000, nexus: 1.45, map: { river: { x: 1020, w: 44, bridgeEvery: 3 }, diag: { x0: 100, y0: 1900, x1: 1900, y1: 760, w: 22 } }, names: ['商業區', '河港', '南堤', '貨櫃場', '舊市街', '巨蛋', '理工大', '河濱公園', '軍醫院', '工廠區', '社區', '高地', '轉運站', '水門'] },
  { name: '新港', seed: 53, n: 2000000, nexus: 1.6, map: { river: { x: 700, w: 40, bridgeEvery: 2 }, bay: { x: 1150, depth: 170, w: 150 } }, names: ['金融中心', '新碼頭', '海堤', '自貿區', '古城', '競技場', '大學城', '森林公園', '總院', '科學園區', '重劃區', '天際線', '高鐵站', '河口'] },
];
const CAMPAIGN_KEY = 'bw-campaign';
function loadCampaign() {
  try { const c = JSON.parse(localStorage.getItem(CAMPAIGN_KEY) || 'null'); if (c && Number.isInteger(c.current)) return c; } catch { /* 無痕模式或壞掉 */ }
  return { current: 0, done: [], carry: { rescued: 0, squad: 0, tank: 0, heli: 0 } };
}
function saveCampaign(c) { try { localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(c)); return true; } catch { return false; } }
const CAMPAIGN = loadCampaign();
{ const q = new URLSearchParams(location.search).get('region'); if (q != null && REGIONS[+q]) CAMPAIGN.current = +q; }
const REGION = REGIONS[Math.min(CAMPAIGN.current, REGIONS.length - 1)];   // 戰役從第 1 天 07:30 開始（1 模擬秒 = 1 遊戲分鐘）
const MAX_TARGETS = 64, MAX_ZONES = 80, MAX_ONCE = 16, MAX_LINES = 16, MAX_SUNITS = 64;   // 模擬 uniform 的陣列大小
// counters 版面：0 存活 1 擊殺 2 畫面中 3 牆頂 4 最高屍堆 | 16+ 殺傷區內數量（80）| 96+ 射擊線內數量 | 112+ 各區喪屍數 | 256+ 探測（每個 8 個 u32）
// 殺傷區編號：0 近防、1–40 部隊、41–54 避難所民兵、55–63 前哨、64–75 機槍堡
const ZONE_BASE = 16, LINE_BASE = 96, DIST_BASE = 112, MAX_DIST = 16, PROBE_BASE = 256;
const SHELTER_SLOT0 = 20;   // 探測槽：0–19 部隊、20+ 避難所
// 牆板與破牆者：牆切成 PANEL 公尺一片，各 PANEL_HP 耐久；每 1024 隻有 BRUTE_K 隻是破牆者（大隻、慢、不爬牆，頂著牆板每秒扣 BRUTE_DPS）
// counters 在探測之後接 WALL_BASE + 牆板編號：這一幀頂著那片牆板的破牆者數
const WALL_BASE = PROBE_BASE + MAX_SUNITS * 8, MAX_PANELS = 2048, PANEL = 4, PANEL_HP = 100, BRUTE_K = 4, BRUTE_DPS = 1;
const PTILE = 32;                 // 屍堆計算區塊邊長（公尺）
const PTN = WN / PTILE;           // 每邊區塊數
const MAX_PTILES = 4096;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const M4 = {
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  // WebGPU 深度 0..1，看向 -Z
  ortho(l, r, b, t, n, f) {
    const o = new Float32Array(16);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -1 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -n / (f - n); o[15] = 1;
    return o;
  },
  view(rt, up, bk, e) {
    const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const o = new Float32Array(16);
    o[0] = rt[0]; o[4] = rt[1]; o[8] = rt[2]; o[12] = -d(rt, e);
    o[1] = up[0]; o[5] = up[1]; o[9] = up[2]; o[13] = -d(up, e);
    o[2] = bk[0]; o[6] = bk[1]; o[10] = bk[2]; o[14] = -d(bk, e);
    o[15] = 1;
    return o;
  },
};

// 正交攝影機：世界 z 朝上，鏡頭朝北（+y）往下看。拉遠時俯角漸變成 90°（作戰地圖），拉近是 52° 的戰術視角。
const cam = { x: 1500, y: 520, ppm: 7, pitch: 1, vp: new Float32Array(16), eye: [0, 0, 0],
  right: [1, 0, 0], up: [0, 1, 0], back: [0, 0, 1], fwd: [0, 0, -1], halfW: 1, halfH: 1, iw: 1, ih: 1 };
const PPM_MAX = 28;
function pitchFor(ppm) { return lerp(Math.PI / 2, 52 * Math.PI / 180, smoothstep(0.8, 4.5, ppm)); }
function updateCam(iw, ih) {
  cam.iw = iw; cam.ih = ih;
  cam.ppm = clamp(cam.ppm, Math.min(iw, ih) / 2300, PPM_MAX);
  cam.pitch = pitchFor(cam.ppm);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  cam.fwd = [0, cp, -sp]; cam.back = [0, -cp, sp]; cam.right = [1, 0, 0]; cam.up = [0, sp, cp];
  cam.halfH = ih / (2 * cam.ppm); cam.halfW = iw / (2 * cam.ppm);
  // 鏡頭中心可動範圍（以世界中心為準的半徑）：畫面小時＝畫面不超出世界＋MARGIN，畫面大時＝世界留在畫面內；
  // 再加上 0.3 倍畫面半寬的餘裕，兩種情況之間連續，游標縮放才不會被卡住。拉遠時另外往中心收（zoomCenterPull）。
  const MARGIN = 120, gx = cam.halfW, gy = cam.halfH / sp;
  const rx = Math.abs(WN / 2 + MARGIN - gx) + 0.3 * gx, ry = Math.abs(WN / 2 + MARGIN - gy) + 0.3 * gy;
  cam.x = clamp(cam.x, WN / 2 - rx, WN / 2 + rx);
  cam.y = clamp(cam.y, WN / 2 - ry, WN / 2 + ry);
  const D = 3000;
  cam.eye = [cam.x + cam.back[0] * D, cam.y + cam.back[1] * D, cam.back[2] * D];
  const V = M4.view(cam.right, cam.up, cam.back, cam.eye);
  const P = M4.ortho(-cam.halfW, cam.halfW, -cam.halfH, cam.halfH, 1, 6000);
  cam.vp = M4.mul(P, V);
}
// 拉遠超過世界大小時，依超出比例把鏡頭往世界中心拉（全拉遠時地圖置中）
function zoomCenterPull() {
  const tx = clamp((2 * cam.halfW - WN) / WN, 0, 1), ty = clamp((2 * cam.halfH / Math.sin(cam.pitch) - WN) / WN, 0, 1);
  cam.x = lerp(cam.x, WN / 2, tx); cam.y = lerp(cam.y, WN / 2, ty);
}
// 螢幕座標（0..1）→ 地面座標
function screenToGround(u, v) {
  const ox = (u * 2 - 1) * cam.halfW, oy = (1 - v * 2) * cam.halfH;
  const P = [0, 1, 2].map((k) => cam.eye[k] + cam.right[k] * ox + cam.up[k] * oy);
  const t = -P[2] / cam.fwd[2];
  return [P[0] + cam.fwd[0] * t, P[1] + cam.fwd[1] * t];
}
