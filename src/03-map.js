// ---------- 程序生成港灣城市 ----------
// 南邊是海（航艦在外海），東邊碼頭、西邊沙灘，中央偏東是高樓市中心，北邊是山坡住宅區。
// opts：bay {x, depth, w} 海灣、diag {x0,y0,x1,y1,w} 斜向大道、river {x, w, bridgeEvery} 河流（只有橋能過，天然的咽喉點）
function genCity(seed = 11, opts = {}) {
  const rnd = mulberry32(seed);
  const t = new Uint8Array(WN * WN).fill(T.CONCRETE);
  const coastY = new Float32Array(WN);
  for (let x = 0; x < WN; x++) {
    coastY[x] = 210 + 55 * Math.sin(x * 0.0035 + 1.3) + 22 * Math.sin(x * 0.011 + 0.4) + (x < 520 ? (520 - x) * 0.22 : 0);
    if (opts.bay) coastY[x] += opts.bay.depth * Math.exp(-(((x - opts.bay.x) / opts.bay.w) ** 2));
  }
  const fill = (x0, y0, x1, y1, v) => {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(WN, Math.ceil(x1)); y1 = Math.min(WN, Math.ceil(y1));
    for (let y = y0; y < y1; y++) t.fill(v, y * WN + x0, y * WN + x1);
  };
  const DT = { x: 1240, y: 1020 }; // 市中心
  const dtF = (x, y) => clamp(1 - Math.hypot(x - DT.x, (y - DT.y) * 1.2) / 430, 0, 1);

  // 街道格網
  const landY0 = 330;
  const xs = [], ys = [];
  for (let x = 30 + rnd() * 40; x < WN - 20; x += 72 + rnd() * 64) xs.push([x, rnd() < 0.3 ? 20 : 11]);
  for (let y = landY0 + 40; y < WN - 20; y += 70 + rnd() * 60) ys.push([y, rnd() < 0.3 ? 20 : 11]);
  // 濱海大道
  const coastRoad = (x) => coastY[x] + 34;

  // 先鋪街廓（人行道），再鋪路
  const blocks = [];
  const xb = [[-40, 0], ...xs, [WN + 40, 0]], yb = [[0, 0], ...ys, [WN + 40, 0]];
  for (let j = 0; j < yb.length - 1; j++) for (let i = 0; i < xb.length - 1; i++) {
    const x0 = xb[i][0] + xb[i][1] / 2, x1 = xb[i + 1][0] - xb[i + 1][1] / 2;
    const y0 = yb[j][0] + yb[j][1] / 2, y1 = yb[j + 1][0] - yb[j + 1][1] / 2;
    if (x1 - x0 < 12 || y1 - y0 < 12) continue;
    blocks.push([x0, y0, x1, y1]);
  }
  for (const [x, w] of xs) fill(x - w / 2, 0, x + w / 2, WN, T.ROAD);
  for (const [y, w] of ys) fill(0, y - w / 2, WN, y + w / 2, T.ROAD);

  // 前進基地（碼頭旁空地）
  const fobX = 1520, fob = { x: fobX, y: coastY[fobX] + 120, w: 150, h: 110 };

  const buildings = [];
  const hills = 1720;
  for (const [bx0, by0, bx1, by1] of blocks) {
    // 街廓底邊不能低於濱海大道
    let minCoast = 0;
    for (let x = Math.max(0, bx0 | 0); x < Math.min(WN, bx1); x += 4) minCoast = Math.max(minCoast, coastRoad(x) + 14);
    const y0 = Math.max(by0, minCoast);
    if (by1 - y0 < 16) continue;
    fill(bx0, y0, bx1, by1, T.SIDEWALK);
    const ix0 = bx0 + 3, iy0 = y0 + 3, ix1 = bx1 - 3, iy1 = by1 - 3;
    const cx = (bx0 + bx1) / 2, cy = (y0 + by1) / 2;
    // 基地範圍不蓋房子
    if (Math.abs(cx - fob.x) < fob.w / 2 + 60 && Math.abs(cy - fob.y) < fob.h / 2 + 50) { fill(ix0, iy0, ix1, iy1, T.CONCRETE); continue; }
    const d = dtF(cx, cy);
    const r = rnd();
    const isHills = cy > hills;
    if (r < (isHills ? 0.05 : 0.08)) { fill(ix0, iy0, ix1, iy1, T.GRASS); continue; }       // 公園
    if (r < (isHills ? 0.08 : 0.15)) { fill(ix0, iy0, ix1, iy1, T.CONCRETE); continue; }    // 停車場／廣場
    fill(ix0, iy0, ix1, iy1, isHills ? T.GRASS : T.CONCRETE);
    // 地塊切分
    const lots = [];
    const maxLot = isHills ? 20 + rnd() * 8 : (d > 0.3 ? 34 + rnd() * 20 : 20 + rnd() * 18);
    const split = (x0, y0, x1, y1, depth) => {
      const w = x1 - x0, h = y1 - y0;
      if ((w <= maxLot && h <= maxLot) || depth > 8) { lots.push([x0, y0, x1, y1]); return; }
      if (w >= h) { const s = x0 + w * (0.35 + rnd() * 0.3); split(x0, y0, s, y1, depth + 1); split(s, y0, x1, y1, depth + 1); }
      else { const s = y0 + h * (0.35 + rnd() * 0.3); split(x0, y0, x1, s, depth + 1); split(x0, s, x1, y1, depth + 1); }
    };
    split(ix0, iy0, ix1, iy1, 0);
    for (const [lx0, ly0, lx1, ly1] of lots) {
      const inset = isHills ? 3 + rnd() * 2 : 1 + (rnd() < 0.3 ? 1 : 0);
      const b = [lx0 + inset, ly0 + inset, lx1 - inset, ly1 - inset];
      if (b[2] - b[0] < 5 || b[3] - b[1] < 5) continue;
      if (rnd() < 0.06 && !isHills) continue; // 空地
      let h;
      if (isHills) h = 5 + rnd() * 3;
      else h = 6 + rnd() * 9 + d * d * (24 + rnd() * 36);
      buildings.push([Math.round(b[0]), Math.round(b[1]), Math.round(b[2]), Math.round(b[3]), h, rnd()]);
    }
  }
  // 斜向大道（蓋在街廓上，壓到的建築之後會被跳過）
  if (opts.diag) {
    const { x0, y0, x1, y1, w } = opts.diag, L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    for (let s = 0; s <= L; s += 0.5) {
      const cx = x0 + ux * s, cy = y0 + uy * s;
      fill(cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2, T.ROAD);
    }
  }
  // 濱海大道、海、沙灘、碼頭
  for (let x = 0; x < WN; x++) {
    const c = coastY[x] | 0, cr = coastRoad(x) | 0;
    for (let y = 0; y < Math.min(WN, cr + 9); y++) {
      const i = y * WN + x;
      if (y < c) t[i] = T.WATER;
      else if (y < cr - 9) t[i] = x < 860 ? T.SAND : T.CONCRETE;
      else t[i] = T.ROAD;
    }
  }
  for (let px = 1020; px < 1960; px += 150 + rnd() * 30) {
    const len = 90 + rnd() * 60;
    fill(px, coastY[px | 0] - len, px + 26, coastY[px | 0] + 2, T.CONCRETE);
  }
  // 河流：從海邊往北蜿蜒；東西向街道每隔幾條、還有濱海大道是橋
  if (opts.river) {
    const { x: rx, w: rw, bridgeEvery = 2 } = opts.river;
    const bridgeRow = new Uint8Array(WN);
    ys.forEach(([y, w], k) => { if (k % bridgeEvery === 0) for (let yy = Math.floor(y - w / 2); yy < Math.ceil(y + w / 2); yy++) if (yy >= 0 && yy < WN) bridgeRow[yy] = 1; });
    for (let y = 0; y < WN; y++) {
      const cxr = rx + 70 * Math.sin(y * 0.003 + 0.7) + 25 * Math.sin(y * 0.011);
      for (let x = Math.max(0, Math.floor(cxr - rw / 2)); x < Math.min(WN, Math.ceil(cxr + rw / 2)); x++) {
        const cr = coastRoad(x);
        const onCoastRoad = y >= cr - 9 && y < cr + 9;
        if (y < coastY[x]) continue;   // 出海口
        t[y * WN + x] = bridgeRow[y] || onCoastRoad ? T.ROAD : T.WATER;
      }
    }
  }
  // 基地空地
  fill(fob.x - fob.w / 2, fob.y - fob.h / 2, fob.x + fob.w / 2, fob.y + fob.h / 2, T.CONCRETE);
  // 建築寫進格子
  const bl = [];
  for (const b of buildings) {
    let ok = true;
    for (let y = b[1]; y < b[3] && ok; y += 2) for (let x = b[0]; x < b[2]; x += 2) {
      const v = t[y * WN + x]; if (v === T.ROAD || v === T.WATER) { ok = false; break; }
    }
    if (!ok) continue;
    if (Math.abs((b[0] + b[2]) / 2 - fob.x) < fob.w / 2 + 6 && Math.abs((b[1] + b[3]) / 2 - fob.y) < fob.h / 2 + 6) continue;
    fill(b[0], b[1], b[2], b[3], T.BUILDING);
    bl.push(b);
  }
  // 大道中央虛線
  for (const [x, w] of xs) if (w >= 18) for (let y = 0; y < WN; y++) {
    const xc = Math.round(x);
    if (t[y * WN + xc] !== T.ROAD || (y & 7) > 3) continue;
    if (t[y * WN + Math.round(x - w / 2 - 2)] === T.ROAD || t[y * WN + Math.round(x + w / 2 + 2)] === T.ROAD) continue;
    t[y * WN + xc] = T.MARK;
  }
  for (const [y, w] of ys) if (w >= 18) for (let x = 0; x < WN; x++) {
    const yc = Math.round(y);
    if (t[yc * WN + x] !== T.ROAD || (x & 7) > 3) continue;
    const a = Math.round(y - w / 2 - 2), b = Math.round(y + w / 2 + 2);
    if ((a >= 0 && t[a * WN + x] === T.ROAD) || (b < WN && t[b * WN + x] === T.ROAD)) continue;
    t[yc * WN + x] = T.MARK;
  }

  const cost = computeNavCost(t);
  return { t, cost, buildings: bl, coastY, fob, downtown: DT };
}

// 導航成本（4 m 格）：建築/海一半以上就封閉；牆不封閉、只加成本（喪屍會去推牆、堆屍翻過去）
function computeNavCost(t) {
  const cost = new Float32Array(NN * NN);
  for (let ny = 0; ny < NN; ny++) for (let nx = 0; nx < NN; nx++) {
    let blocked = 0, walls = 0;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const v = t[(ny * CELL + y) * WN + nx * CELL + x];
      if (v === T.BUILDING || v === T.WATER) blocked++;
      else if (v === T.WALL) walls++;
    }
    cost[ny * NN + nx] = blocked >= 8 ? -1 : 1 + blocked * 0.08 + (walls >= 2 ? WALL_NAV_COST : 0);
  }
  // 貼著障礙物的格子加成本：最短路徑會走路中間，不會全部貼著牆角排成一列
  const near = cost.slice();
  for (let ny = 0; ny < NN; ny++) for (let nx = 0; nx < NN; nx++) {
    if (cost[ny * NN + nx] < 0) continue;
    let adj = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = nx + dx, y = ny + dy;
      if (x < 0 || y < 0 || x >= NN || y >= NN || cost[y * NN + x] < 0) adj++;
    }
    if (adj) near[ny * NN + nx] += 0.35 + adj * 0.08;
  }
  cost.set(near);
  return cost;
}

// 喪屍初始分布：一半成群（屍群），一半散布；基地附近留空
function spawnAgents(map, N, seed = 5) {
  const rnd = mulberry32(seed);
  const a = new Float32Array(N * 4), inf = new Uint32Array(N * 2);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(6.2831853 * rnd());
  const clusters = [];
  for (let k = 0; k < 48; k++) clusters.push([120 + rnd() * 1800, 420 + rnd() * 1550, 25 + rnd() * 80]);
  let i = 0, guard = 0;
  while (i < N && guard++ < N * 20) {
    let x, y;
    if (rnd() < 0.5) { const c = clusters[(rnd() * clusters.length) | 0]; x = c[0] + gauss() * c[2]; y = c[1] + gauss() * c[2]; }
    else { x = rnd() * WN; y = rnd() * WN; if (rnd() > 0.35 + 0.65 * Math.max(0, 1 - Math.hypot(x - map.downtown.x, y - map.downtown.y) / 900)) continue; }
    if (x < 1 || y < 1 || x >= WN - 1 || y >= WN - 1) continue;
    const v = map.t[(y | 0) * WN + (x | 0)];
    if (v === T.BUILDING || v === T.WATER || v === T.WALL) continue;
    if (Math.hypot(x - map.fob.x, y - map.fob.y) < 330) continue;
    a[i * 4] = x; a[i * 4 + 1] = y;
    inf[i * 2] = 1 | (((rnd() * 256) | 0) << 8);
    i++;
  }
  return { a, inf, n: i };
}

// ---------- 區域：15 區（0＝前進基地），最遠點取樣種子 + 導航格 Voronoi；每區一個避難所與倖存者人數 ----------
// 區名依地理位置配（每個名字一個參考點，貪婪地兩兩配最近的）
const DISTRICT_ANCHORS = [['金融區', 1100, 1200], ['港灣區', 1100, 700], ['西灘', 760, 260], ['東碼頭', 1900, 580], ['舊城', 160, 680], ['體育場', 620, 880],
  ['大學城', 340, 1290], ['公園區', 750, 1520], ['醫院區', 1580, 1420], ['工業區', 1890, 1000], ['住宅區', 150, 1900], ['北丘', 960, 1900], ['中央車站', 1430, 1810], ['河濱', 1900, 1830]];   // 對準 genCity(11) 的種子位置
function genDistricts(map, n = 15) {
  const land = [];
  const cand = [];
  for (let ny = 0; ny < NN; ny++) for (let nx = 0; nx < NN; nx++) {
    const i = ny * NN + nx, x = (nx + 0.5) * CELL, y = (ny + 0.5) * CELL;
    if (map.cost[i] >= 0 && y > map.coastY[Math.min(WN - 1, x | 0)] + 30) {
      land.push(i);
      if (x > 140 && x < WN - 140 && y < WN - 140 && y > map.coastY[x | 0] + 70) cand.push(land.length - 1);   // 種子離地圖邊緣至少 140 m
    }
  }
  const P = (i) => [((i % NN) + 0.5) * CELL, (((i / NN) | 0) + 0.5) * CELL];
  const seeds = [[map.fob.x, map.fob.y]];
  const md = new Float32Array(land.length).fill(Infinity);
  const upd = (s) => land.forEach((i, k) => { const [x, y] = P(i); md[k] = Math.min(md[k], Math.hypot(x - s[0], (y - s[1]) * 1.15)); });
  upd(seeds[0]);
  while (seeds.length < n) {
    let best = cand[0];
    for (const k of cand) if (md[k] > md[best]) best = k;
    const s = P(land[best]); seeds.push(s); upd(s);
  }
  const dmap = new Uint8Array(NN * NN).fill(255);
  const vol = new Float64Array(n), cells = new Uint32Array(n), cx = new Float64Array(n), cy = new Float64Array(n);
  for (const i of land) {
    const [x, y] = P(i);
    let b = 0, bd = Infinity;
    seeds.forEach((s, k) => { const d = (x - s[0]) ** 2 + ((y - s[1]) * 1.15) ** 2; if (d < bd) { bd = d; b = k; } });
    dmap[i] = b; cells[b]++; cx[b] += x; cy[b] += y;
  }
  // 沒被歸到的（太靠海、建築格）沿用最近的已分配鄰居，畫邊界才連續
  for (let pass = 0; pass < 6; pass++) for (let i = 0; i < NN * NN; i++) {
    if (dmap[i] !== 255) continue;
    const x = i % NN, y = (i / NN) | 0;
    if (map.t[Math.min(WN - 1, y * CELL + 2) * WN + x * CELL + 2] === T.WATER) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = (y + dy) * NN + x + dx; if (x + dx >= 0 && x + dx < NN && y + dy >= 0 && y + dy < NN && dmap[j] !== 255) { dmap[i] = dmap[j]; break; } }
  }
  for (const b of map.buildings) {
    const k = dmap[Math.floor((b[1] + b[3]) / 2 / CELL) * NN + Math.floor((b[0] + b[2]) / 2 / CELL)];
    if (k !== 255) vol[k] += (b[2] - b[0]) * (b[3] - b[1]) * b[4];
  }
  const totalVol = vol.reduce((a, v, k) => a + (k ? v : 0), 0);
  const names = ['前進基地'];
  {
    const pairs = [];
    for (let k = 1; k < n; k++) DISTRICT_ANCHORS.forEach((a, j) => pairs.push([Math.hypot(seeds[k][0] - a[1], seeds[k][1] - a[2]), k, j]));
    pairs.sort((a, b) => a[0] - b[0]);
    const usedA = new Set();
    const asg = [];
    for (const [, k, j] of pairs) if (asg[k] == null && !usedA.has(j)) { asg[k] = j; usedA.add(j); }
    // 兩兩交換，總距離變小就換，直到不能再改善
    const dist = (k, j) => Math.hypot(seeds[k][0] - DISTRICT_ANCHORS[j][1], seeds[k][1] - DISTRICT_ANCHORS[j][2]);
    for (let improved = true, guard = 0; improved && guard < 100; guard++) {
      improved = false;
      for (let p = 1; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (dist(p, asg[q]) + dist(q, asg[p]) < dist(p, asg[p]) + dist(q, asg[q]) - 1e-6) { [asg[p], asg[q]] = [asg[q], asg[p]]; improved = true; }
      }
    }
    for (let k = 1; k < n; k++) names[k] = DISTRICT_ANCHORS[asg[k]][0];
    if (REGION.names) for (let k = 1; k < n; k++) names[k] = REGION.names[asg[k]];   // 其他戰區：同樣的地理配對，換成自己的區名
  }
  // 地面部隊從基地開得到哪些導航格（跟 08-units 的 unitBlock 同一套規則：4 m 格裡 6 格以上是建築/水就擋；只走上下左右，比 A* 保守）
  const ublock = new Uint8Array(NN * NN);
  for (let ny = 0; ny < NN; ny++) for (let nx = 0; nx < NN; nx++) {
    let hard = 0;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) { const v = map.t[(ny * CELL + y) * WN + nx * CELL + x]; if (v === T.BUILDING || v === T.WATER) hard++; }
    ublock[ny * NN + nx] = hard >= 6 ? 1 : 0;
  }
  const reach = new Uint8Array(NN * NN);
  {
    const s0 = Math.floor((map.fob.y + 40) / CELL) * NN + Math.floor(map.fob.x / CELL);
    const qq = [s0]; reach[s0] = 1;
    for (let h = 0; h < qq.length; h++) {
      const i = qq[h], x = i % NN, y = (i / NN) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= NN || Y >= NN) continue;
        const j = Y * NN + X;
        if (!reach[j] && !ublock[j]) { reach[j] = 1; qq.push(j); }
      }
    }
  }
  const districts = [];
  for (let k = 0; k < n; k++) {
    // 避難所：離種子最近、可走、而且不是道路中央的空地（廣場/人行道優先）
    let sx = seeds[k][0], sy = seeds[k][1], best = Infinity;
    for (let r = 0; r < 120 && best === Infinity; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = Math.round(seeds[k][0]) + dx * 2, y = Math.round(seeds[k][1]) + dy * 2;
      if (x < 2 || y < 2 || x >= WN - 2 || y >= WN - 2) continue;
      const v = map.t[y * WN + x];
      const ni = Math.floor(y / CELL) * NN + Math.floor(x / CELL);
      if ((v === T.CONCRETE || v === T.SIDEWALK || v === T.GRASS) && dmap[ni] === k && (k === 0 || reach[ni])) { const d = dx * dx + dy * dy; if (d < best) { best = d; sx = x; sy = y; } }
    }
    const pop = k === 0 ? 0 : Math.round(clamp((vol[k] / totalVol) * 72000, 1200, 9000) / 10) * 10;
    districts.push({ k, name: names[k] || '區域 ' + k, cx: cx[k] / Math.max(cells[k], 1), cy: cy[k] / Math.max(cells[k], 1), area: cells[k] * CELL * CELL,
      sx, sy, pop0: pop, pop, state: k === 0 ? 'base' : 'hold', calm: 0, dead: 0, turned: 0, rescued: 0 });
  }
  return { dmap, districts };
}
