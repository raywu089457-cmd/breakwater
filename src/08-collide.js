// ---------- 碰撞：單位 ↔ 建築／牆／水、單位 ↔ 單位、砲彈 ↔ 建築 —— 全在 CPU，只跟單位數（≤ 20）有關，跟喪屍數量無關 ----------
// 單位用圓形：半徑也是單位之間互推的距離；質量大的推得動質量小的
const UR = { squad: 2.2, tank: 3.0, truck: 2.5, heli: 6, transport: 6.5 };
const UMASS = { squad: 1, tank: 5, truck: 3, heli: 1, transport: 1.5 };
const NEST_R = 2.6;   // 機槍堡（沙包）對地面部隊來說也是障礙
const hardTile = (v) => v === T.BUILDING || v === T.WATER || v === T.WALL;
const hardAt = (x, y) => x < 0 || y < 0 || x >= WN || y >= WN || hardTile(map.t[(y | 0) * WN + (x | 0)]);

// 屋頂高度（1 m 格，存 0.1 m 為單位；0＝不是建築）：砲彈打到屋頂就在屋頂炸、直升機飛太低會撞樓
const roofH = new Uint16Array(WN * WN);
for (const b of map.buildings) {
  const h = Math.min(65535, Math.round(b[4] * 10));
  for (let y = Math.max(0, b[1]); y < Math.min(WN, b[3]); y++) roofH.fill(h, y * WN + Math.max(0, b[0]), y * WN + Math.min(WN, b[2]));
}
const roofAt = (x, y) => (x < 0 || y < 0 || x >= WN || y >= WN ? 0 : map.t[(y | 0) * WN + (x | 0)] === T.BUILDING ? roofH[(y | 0) * WN + (x | 0)] / 10 : 0);
// 擋飛行單位的高度：建築＝屋頂、牆＝牆高
const solidTop = (x, y) => { const v = x < 0 || y < 0 || x >= WN || y >= WN ? T.ROAD : map.t[(y | 0) * WN + (x | 0)]; return v === T.BUILDING ? roofH[(y | 0) * WN + (x | 0)] / 10 : v === T.WALL ? WALL_H : 0; };

// 離最近障礙物的距離（倒角距離轉換，5＝1 格、7＝斜 1 格；上限 CLR_CAP＝20 m）：尋路挑夠寬的路、終點挑站得下的位置。
// 蓋牆／牆被打穿時只重算變動範圍外擴 20 m（距離有上限，再遠的格子不受影響），不會整張 2048² 重算卡一下
const CLR_CAP = 100;
const clr = new Uint8Array(WN * WN);
const hardPrev = new Uint8Array(WN * WN).fill(2);   // 上次算的時候哪些格是障礙（2＝還沒算過）
const cellPt = new Float32Array(NN * NN * 2);   // 每個導航格裡最空曠的點（路徑點用這個，不用格中心，免得落在建築邊上）
const cellClr = new Float32Array(NN * NN);      // 那個點的淨空（m）
let clearanceMs = 0;
function rebuildClearance() {
  const t0 = performance.now(), t = map.t, N = WN;
  let x0 = N, y0 = N, x1 = -1, y1 = -1;
  for (let y = 0; y < N; y++) for (let x = 0, i = y * N; x < N; x++, i++) {
    const h = hardTile(t[i]) ? 1 : 0;
    if (h !== hardPrev[i]) { hardPrev[i] = h; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) { clearanceMs = performance.now() - t0; return; }
  const R = CLR_CAP / 5;
  // 外圈（多 R）只當鄰居讀，內圈（變動範圍 ± R）的結果才寫回
  const wx0 = Math.max(0, x0 - 2 * R), wy0 = Math.max(0, y0 - 2 * R), wx1 = Math.min(N - 1, x1 + 2 * R), wy1 = Math.min(N - 1, y1 + 2 * R);
  const W = wx1 - wx0 + 1, Hh = wy1 - wy0 + 1, d = new Uint8Array(W * Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) d[y * W + x] = hardPrev[(wy0 + y) * N + wx0 + x] ? 0 : CLR_CAP;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let v = d[i];
    if (!v) continue;
    if (x > 0) v = Math.min(v, d[i - 1] + 5);
    if (y > 0) { v = Math.min(v, d[i - W] + 5); if (x > 0) v = Math.min(v, d[i - W - 1] + 7); if (x < W - 1) v = Math.min(v, d[i - W + 1] + 7); }
    d[i] = v;
  }
  for (let y = Hh - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    let v = d[i];
    if (!v) continue;
    if (x < W - 1) v = Math.min(v, d[i + 1] + 5);
    if (y < Hh - 1) { v = Math.min(v, d[i + W] + 5); if (x < W - 1) v = Math.min(v, d[i + W + 1] + 7); if (x > 0) v = Math.min(v, d[i + W - 1] + 7); }
    d[i] = v;
  }
  const ix0 = Math.max(0, x0 - R), iy0 = Math.max(0, y0 - R), ix1 = Math.min(N - 1, x1 + R), iy1 = Math.min(N - 1, y1 + R);
  for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) clr[y * N + x] = d[(y - wy0) * W + x - wx0];
  for (let ny = Math.floor(iy0 / CELL); ny <= Math.floor(iy1 / CELL); ny++) for (let nx = Math.floor(ix0 / CELL); nx <= Math.floor(ix1 / CELL); nx++) {
    let best = -1, bx = 0, by = 0;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const c = clr[(ny * CELL + y) * N + nx * CELL + x];
      const sc = Math.min(c, 30) * 10 - Math.abs(x - 1.5) - Math.abs(y - 1.5);   // 一樣空曠就挑靠中間的
      if (sc > best) { best = sc; bx = x; by = y; }
    }
    const j = ny * NN + nx;
    cellPt[j * 2] = nx * CELL + bx + 0.5; cellPt[j * 2 + 1] = ny * CELL + by + 0.5;
    cellClr[j] = clr[(ny * CELL + by) * N + nx * CELL + bx] / 5 - 0.5;
  }
  clearanceMs = performance.now() - t0;
}
// 點到最近障礙物邊緣的距離（m，約略）
const clearAt = (x, y) => (x < 0 || y < 0 || x >= WN || y >= WN ? -1 : clr[(y | 0) * WN + (x | 0)] / 5 - 0.5);
// 離 (x, y) 最近、站得下半徑 r 的點（螺旋往外找，最遠 maxR m）
function nearestClear(x, y, r, maxR = 24) {
  if (clearAt(x, y) >= r) return [x, y];
  const cx = Math.floor(x), cy = Math.floor(y);
  let best = null, bd = Infinity;
  for (let d = 1; d <= maxR && !best; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
    const px = cx + dx + 0.5, py = cy + dy + 0.5;
    if (clearAt(px, py) < r) continue;
    const dd = (px - x) ** 2 + (py - y) ** 2;
    if (dd < bd) { bd = dd; best = [px, py]; }
  }
  return best || [x, y];
}

// 圓（單位）推出障礙格：每次推出穿得最深的那一格，最多 4 次；中心整個陷進去（例如牆蓋在身上）就搬到最近站得下的點
function pushOutTiles(u, r, solid) {
  for (let it = 0; it < 4; it++) {
    const x0 = Math.floor(u.x - r), x1 = Math.floor(u.x + r), y0 = Math.floor(u.y - r), y1 = Math.floor(u.y + r);
    let pen = 0, nx = 0, ny = 0;
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (!solid(tx, ty)) continue;
      const dx = u.x - clamp(u.x, tx, tx + 1), dy = u.y - clamp(u.y, ty, ty + 1), d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d < 1e-6) {
        const [px, py] = nearestClear(u.x, u.y, r * 0.5);
        u.x = px; u.y = py; return true;
      }
      if (r - d > pen) { pen = r - d; nx = dx / d; ny = dy / d; }
    }
    if (pen <= 0) return it > 0;
    u.x += nx * (pen + 1e-3); u.y += ny * (pen + 1e-3);
  }
  return true;
}
// 單位的碰撞半徑：卡住時會暫時縮小（擠過窄巷），順了再慢慢長回來
const unitRadius = (u) => UR[u.type] * (u.squeeze || 1);
function collideGround(u) { return pushOutTiles(u, unitRadius(u), (tx, ty) => hardAt(tx, ty)); }
function collideAir(u) { return pushOutTiles(u, Math.min(unitRadius(u), 3.5), (tx, ty) => solidTop(tx, ty) > u.z - 1.5); }   // 機身（不含旋翼）撞樓

// 單位 ↔ 單位：地面跟地面、空中跟空中（高度差 8 m 內）互推；地面部隊也繞開機槍堡。
// 互推完再推出建築（建築說了算）；被擠到牆邊又會跟別人重疊，所以兩步交替做到沒有重疊為止（最多 6 輪）
function separateUnits(list) {
  for (let pass = 0; pass < 6; pass++) {
    let worst = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i], ra = unitRadius(a), airA = isAir(a);
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (airA !== isAir(b) || (airA && Math.abs(a.z - b.z) > 8)) continue;
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        const min = ra + unitRadius(b);
        if (d >= min) continue;
        if (d < 1e-4) { const ang = ((a.id * 7 + b.id * 13) % 16) * 0.3927; dx = Math.cos(ang); dy = Math.sin(ang); d = 0; } else { dx /= d; dy /= d; }
        const pen = min - d + 1e-3, ma = UMASS[a.type], mb = UMASS[b.type];
        worst = Math.max(worst, pen);
        const ka = (pen * mb) / (ma + mb), kb = (pen * ma) / (ma + mb);
        a.x -= dx * ka; a.y -= dy * ka; b.x += dx * kb; b.y += dy * kb;
      }
      if (!airA) for (const n of nests) {
        const dx = a.x - n.x, dy = a.y - n.y, d = Math.hypot(dx, dy), min = ra + NEST_R;
        if (d < min && d > 1e-4) { a.x += (dx / d) * (min - d); a.y += (dy / d) * (min - d); worst = Math.max(worst, min - d); }
      }
    }
    for (const u of list) { if (isAir(u)) collideAir(u); else collideGround(u); u.x = clamp(u.x, 1, WN - 1); u.y = clamp(u.y, 1, WN - 1); }
    if (worst < 0.01) break;
  }
}

// 砲彈／子彈打建築：從 (x0, y0, z0) 直線到 (x1, y1, z1)，每 0.5 m 取樣，碰到比當下高度高的屋頂就停，
// 再在前後兩點之間二分 8 次找到表面（牆面或屋頂，誤差 < 1 cm）。回傳 null（沒擋到）或 [x, y, z]（表面外側的撞點）
function rayHitBuilding(x0, y0, z0, x1, y1, z1) {
  const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0), n = Math.max(1, Math.ceil(L / 0.5));
  const at = (f) => [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, z0 + (z1 - z0) * f];
  const inside = (p) => roofAt(p[0], p[1]) > p[2];
  if (inside(at(0))) return [x0, y0, Math.max(0, z0)];
  for (let k = 1; k <= n; k++) {
    if (!inside(at(k / n))) continue;
    let a = (k - 1) / n, b = k / n;
    for (let i = 0; i < 8; i++) { const m = (a + b) / 2; if (inside(at(m))) b = m; else a = m; }
    const p = at(a);
    p[2] = Math.max(0, p[2]);
    return p;
  }
  return null;
}
// 地面直線視線（只算建築；牆 4 m，戰車與步兵從牆後面打得過去）
const groundLos = (x0, y0, x1, y1) => !rayHitBuilding(x0, y0, 1.5, x1, y1, 1.5);
