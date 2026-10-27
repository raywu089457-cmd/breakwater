// ---------- WGSL：屍群模擬（全部在 GPU 上） ----------
const WGSL_COMMON = /* wgsl */`
const WN = ${WN}u;
const NN = ${NN}u;
const CELL = ${CELL}.0;
const INF = 1e9;
const WALL_H = ${WALL_H.toFixed(2)};
const CLIMB_REACH = ${CLIMB_REACH.toFixed(2)};
struct Sim {
  dt: f32, time: f32, n: u32, flags: u32,          // flags: bit0 最後一個子步, bit1 套用單次砲擊
  aware: f32, sepK: f32, speedMul: f32, nTargets: u32,
  nOnce: u32, corpseTime: f32, pileDt: f32, nZones: u32,
  nLines: u32, nUnits: u32, pad0: u32, pad1: u32,
  targets: array<vec4f, ${MAX_TARGETS}>,   // x, y, 半徑, 權重（越大越吸引）
  zones: array<vec4f, ${MAX_ZONES}>,       // 持續殺傷圓：x, y, 半徑, 每隻每秒被打死的機率
  once: array<vec4f, ${MAX_ONCE}>,         // 單次砲擊：x, y, 半徑, 致死率
  lines: array<vec4f, ${MAX_LINES * 2}>,   // 瞄準射擊線：(x0, y0, x1, y1), (寬, 每隻每秒機率, 0, 0)
  units: array<vec4f, ${MAX_SUNITS}>,      // 單位：x, y, 高度（>0 飛行）, 接觸半徑
};
struct R {
  vp: mat4x4f,
  right: vec4f, up: vec4f, back: vec4f,
  misc: vec4f,   // 時間, ppm, 熱圖強度, 俯角
  view: vec4f,   // 內部寬, 內部高, 喪屍數, 圖集開關
  atlas: vec4f,  // 格寬, 格高, 腳底, 影格數（目前 LOD 層）
  atlas2: vec4f, // 該層在圖集裡的 x, y 起點
  catlas: vec4f, // 屍體 LOD：格寬, 格高, x, y
  fatlas: vec4f, // 爆炸 LOD：格寬, 格高, x, y
  sizes: vec4f,  // 屍體寬(m), 屍體高(m), 爆炸格高/格寬, 0
  dcol: array<vec4f, 16>,   // 各區狀態顏色（a＝作戰地圖填色強度）
};
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rnd(v: u32) -> f32 { return f32(pcg(v)) / 4294967295.0; }
`;

// 每隻喪屍丟進 1 m 密度格與 4 m 粗格
const WGSL_COUNT = WGSL_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> S: Sim;
@group(0) @binding(1) var<storage, read> agents: array<vec4f>;
@group(0) @binding(2) var<storage, read> info: array<vec2u>;
@group(0) @binding(3) var<storage, read_write> dens: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> coarse: array<atomic<u32>>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= S.n) { return; }
  if ((info[i].x & 3u) != 1u) { return; }
  let c = vec2u(clamp(vec2i(floor(agents[i].xy)), vec2i(0), vec2i(i32(WN) - 1)));
  atomicAdd(&dens[c.y * WN + c.x], 1u);
  atomicAdd(&coarse[(c.y >> 2u) * NN + (c.x >> 2u)], 1u);
}
`;

// 流場種子：目標格的起始距離 = -權重
const WGSL_SEED = WGSL_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> S: Sim;
@group(0) @binding(1) var<storage, read_write> seed: array<f32>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= NN || g.y >= NN) { return; }
  let c = (vec2f(g.xy) + 0.5) * CELL;
  var best = INF;
  for (var k = 0u; k < S.nTargets; k++) {
    let t = S.targets[k];
    if (distance(c, t.xy) <= t.z + CELL * 0.5) { best = min(best, -t.w); }
  }
  seed[g.y * NN + g.x] = best;
}
`;

// 流場鬆弛（Bellman-Ford，一次往外推一格；不取自己的舊值，所以目標移動時距離也會正確變大）
const WGSL_RELAX = WGSL_COMMON + /* wgsl */`
@group(0) @binding(0) var<storage, read> cost: array<f32>;
@group(0) @binding(1) var<storage, read> seed: array<f32>;
@group(0) @binding(2) var<storage, read> src: array<f32>;
@group(0) @binding(3) var<storage, read_write> dst: array<f32>;
fn C(x: i32, y: i32) -> f32 {
  if (x < 0 || y < 0 || x >= i32(NN) || y >= i32(NN)) { return -1.0; }
  return cost[u32(y) * NN + u32(x)];
}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= NN || g.y >= NN) { return; }
  let x = i32(g.x); let y = i32(g.y);
  let idx = g.y * NN + g.x;
  let c = cost[idx];
  if (c < 0.0) { dst[idx] = INF; return; }
  var best = seed[idx];
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let nx = x + dx; let ny = y + dy;
      let cn = C(nx, ny);
      if (cn < 0.0) { continue; }
      let diag = dx != 0 && dy != 0;
      if (diag && (C(x + dx, y) < 0.0 || C(x, y + dy) < 0.0)) { continue; }
      let stepLen = select(1.0, 1.41421356, diag) * CELL * 0.5 * (c + cn);
      best = min(best, src[u32(ny) * NN + u32(nx)] + stepLen);
    }
  }
  dst[idx] = min(best, INF);
}
`;

// 由距離場算每格前進方向（開闊處用中央差分，靠牆用最陡下降）
const WGSL_FLOW = WGSL_COMMON + /* wgsl */`
@group(0) @binding(0) var<storage, read> dist: array<f32>;
@group(0) @binding(1) var<storage, read_write> flow: array<vec4f>;
fn D(x: i32, y: i32) -> f32 {
  if (x < 0 || y < 0 || x >= i32(NN) || y >= i32(NN)) { return INF; }
  return dist[u32(y) * NN + u32(x)];
}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= NN || g.y >= NN) { return; }
  let x = i32(g.x); let y = i32(g.y);
  let big = INF * 0.5;
  let d0 = D(x, y);
  let dl = D(x - 1, y); let dr = D(x + 1, y); let dd = D(x, y - 1); let du = D(x, y + 1);
  var dir = vec2f(0.0);
  if (d0 < big && dl < big && dr < big && dd < big && du < big) {
    let gr = vec2f(dr - dl, du - dd);
    if (dot(gr, gr) > 1e-6) { dir = -normalize(gr); }
  } else {
    var offs = array<vec2i, 8>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1), vec2i(1, 1), vec2i(-1, 1), vec2i(1, -1), vec2i(-1, -1));
    var bestScore = 0.0;
    var bestMin = INF;
    for (var j = 0; j < 8; j++) {
      let o = offs[j];
      let dn = D(x + o.x, y + o.y);
      if (dn >= big) { continue; }
      let diag = o.x != 0 && o.y != 0;
      if (d0 < big) {
        if (diag && (D(x + o.x, y) >= big || D(x, y + o.y) >= big)) { continue; }
        let sc = (d0 - dn) / select(1.0, 1.41421356, diag);
        if (sc > bestScore) { bestScore = sc; dir = normalize(vec2f(o)); }
      } else if (dn < bestMin) {
        bestMin = dn; dir = normalize(vec2f(o));
      }
    }
  }
  flow[g.y * NN + g.x] = vec4f(dir, d0, 0.0);
}
`;

// 移動：流場 + 密度梯度推擠 + 撞牆滑動 + 砲擊判定
const WGSL_MOVE = WGSL_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> S: Sim;
@group(0) @binding(1) var<storage, read_write> agents: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> info: array<vec2u>;
@group(0) @binding(3) var<storage, read> dens: array<u32>;
@group(0) @binding(4) var<storage, read> flow: array<vec4f>;
@group(0) @binding(5) var tmap: texture_2d<u32>;
@group(0) @binding(6) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(7) var<storage, read> pile: array<f32>;
@group(0) @binding(8) var wallIds: texture_2d<u32>;
struct KillLog { n: atomic<u32>, p0: u32, p1: u32, p2: u32, e: array<vec4f, ${KILL_CAP}> };   // e：x, y, 來源, 時間
@group(0) @binding(9) var<storage, read_write> killLog: KillLog;
var<workgroup> wAlive: atomic<u32>;
var<workgroup> wKills: atomic<u32>;
var<workgroup> wClimb: atomic<u32>;

fn tileAt(c: vec2i) -> u32 {
  if (c.x < 0 || c.y < 0 || c.x >= i32(WN) || c.y >= i32(WN)) { return 1u; }
  return textureLoad(tmap, c, 0).r;
}
fn hard(t: u32) -> bool { return t == 1u || t == 2u; }
fn blockedAt(c: vec2i) -> bool { let t = tileAt(c); return hard(t) || t == 7u; }
// 地面射手的視線：從喪屍往射手每 1.5 m 取樣，中間隔著建築就打不到（牆 4 m，打得過去）
fn losClear(a: vec2f, b: vec2f) -> bool {
  let n = u32(ceil(distance(a, b) / 1.5));
  for (var s = 1u; s < n; s++) {
    if (tileAt(vec2i(floor(mix(a, b, f32(s) / f32(n))))) == 1u) { return false; }
  }
  return true;
}
fn pileAt(c: vec2i) -> f32 {
  let q = clamp(c, vec2i(0), vec2i(i32(WN) - 1));
  return pile[u32(q.y) * WN + u32(q.x)];
}
// 能不能從 c0 走進 c1：建築/海不行；牆＝已經在牆上，或腳下屍堆＋攀高 ≥ 牆高（破牆者不爬）
fn canEnter(c0: vec2i, c1: vec2i, hereT: u32, hereP: f32, climb: bool) -> bool {
  if (all(c0 == c1)) { return true; }
  let t = tileAt(c1);
  if (hard(t)) { return false; }
  if (t == 7u) { return hereT == 7u || (climb && hereP + CLIMB_REACH >= WALL_H); }
  return true;
}
fn Dn(c: vec2i) -> f32 {
  let q = clamp(c, vec2i(0), vec2i(i32(WN) - 1));
  return f32(dens[u32(q.y) * WN + u32(q.x)]);
}
fn densBil(p: vec2f) -> f32 {
  let q = p - 0.5; let c = vec2i(floor(q)); let f = q - floor(q);
  return mix(mix(Dn(c), Dn(c + vec2i(1, 0)), f.x), mix(Dn(c + vec2i(0, 1)), Dn(c + vec2i(1, 1)), f.x), f.y);
}
fn Fl(c: vec2i) -> vec4f {
  let q = clamp(c, vec2i(0), vec2i(i32(NN) - 1));
  return flow[u32(q.y) * NN + u32(q.x)];
}
fn flowBil(p: vec2f) -> vec2f {
  let q = p / CELL - 0.5; let c = vec2i(floor(q)); let f = q - floor(q);
  return mix(mix(Fl(c).xy, Fl(c + vec2i(1, 0)).xy, f.x), mix(Fl(c + vec2i(0, 1)).xy, Fl(c + vec2i(1, 1)).xy, f.x), f.y);
}

fn stepAgent(i: u32) {
  let inf = info[i];
  let state = inf.x & 3u;
  if (state == 0u) { return; }
  if (state == 2u) { // 屍體：時間到就回收
    if (S.time - bitcast<f32>(inf.y) > S.corpseTime) { info[i] = vec2u(inf.x & ~3u, 0u); }
    return;
  }
  let a = agents[i];
  let p = a.xy;
  var v = a.zw;
  let h0 = pcg(i * 3u + 17u);
  let tick = u32(S.time * 60.0);
  // 殺傷判定：持續區（近防/機槍，每子步）、單次砲擊（只在第一個子步）、瞄準射擊線（每子步）
  let last = (S.flags & 1u) != 0u;
  let rbase = pcg(i ^ (tick * 2654435761u));
  var dead = false;
  var fling = vec2f(0.0);
  var src = 0u;
  for (var k = 0u; k < S.nZones && !dead; k++) {
    let s = S.zones[k];
    let d = distance(p, s.xy);
    if (d >= abs(s.z)) { continue; }
    if (s.z < 0.0 && !losClear(p, s.xy)) { continue; }   // 半徑負的＝地面射手，要看得到
    if (last) { atomicAdd(&counters[${ZONE_BASE}u + k], 1u); }   // 區內數量（讀回去算命中率）
    if (rnd(rbase + k * 7919u) < s.w * S.dt) { dead = true; src = k; if (d > 0.01) { fling = (p - s.xy) / d * 0.3; } }
  }
  if ((S.flags & 2u) != 0u) {
    for (var k = 0u; k < S.nOnce && !dead; k++) {
      let s = S.once[k];
      let d = distance(p, s.xy);
      if (d >= s.z) { continue; }
      let q = d / s.z;
      if (rnd(rbase + k * 104729u + 17u) < s.w * (1.0 - 0.75 * q * q)) { dead = true; src = 100u + k; if (d > 0.01) { fling = (p - s.xy) / d * (1.0 - q) * 3.0; } }
    }
  }
  for (var k = 0u; k < S.nLines && !dead; k++) {
    let a0 = S.lines[k * 2u]; let a1 = S.lines[k * 2u + 1u];
    let ab = a0.zw - a0.xy;
    let t = clamp(dot(p - a0.xy, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    let d = distance(p, a0.xy + ab * t);
    if (d >= a1.x) { continue; }
    if (last) { atomicAdd(&counters[${LINE_BASE}u + k], 1u); }
    if (rnd(rbase + k * 31337u + 5u) < a1.y * S.dt) { dead = true; src = 200u + k; fling = normalize(ab + vec2f(1e-4)) * 0.4; }
  }
  if (dead) {
    let w = atomicAdd(&killLog.n, 1u);
    if (w < ${KILL_CAP}u) { killLog.e[w] = vec4f(p, f32(src), S.time); }
    var cp = p + fling;
    if (blockedAt(vec2i(floor(cp)))) { cp = p; }
    agents[i] = vec4f(cp, 0.0, 0.0);
    info[i] = vec2u((inf.x & ~3u) | 2u, bitcast<u32>(S.time));
    atomicAdd(&wKills, 1u);
    return;
  }
  atomicAdd(&wAlive, 1u);
  let brute = ((h0 >> 20u) & 1023u) < ${BRUTE_K}u;   // 破牆者：大隻、慢、不爬牆，頂到牆板就撞
  let runner = !brute && (h0 & 1023u) < 41u;
  let sp01 = f32((h0 >> 10u) & 255u) / 255.0;
  var baseSpeed = select(0.8 + sp01 * 0.75, 3.0 + sp01 * 1.0, runner) * S.speedMul;
  if (brute) { baseSpeed = (0.9 + sp01 * 0.4) * S.speedMul; }
  let here = Fl(vec2i(p / CELL));
  var desired: vec2f;
  if (here.z < S.aware) {
    let fb = flowBil(p);
    let l = length(fb);
    var dir = here.xy;
    if (l > 0.05) { dir = fb / l; }
    let bias = (f32((h0 >> 18u) & 255u) / 255.0 - 0.5) * 0.9 + sin(S.time * 0.13 + f32(h0 & 1023u)) * 0.25;
    let cb = cos(bias); let sb = sin(bias);
    dir = vec2f(dir.x * cb - dir.y * sb, dir.x * sb + dir.y * cb);
    desired = dir * baseSpeed;
  } else {
    // 沒察覺目標：慢慢遊蕩
    let slot = u32(S.time * 0.18 + f32(h0 & 255u) / 47.0);
    let ang = rnd(i * 7u + slot * 977u) * 6.2831853;
    desired = vec2f(cos(ang), sin(ang)) * 0.28 * S.speedMul;
  }
  // 人擠人：密度梯度往外推，越擠走越慢
  let e = 0.75;
  let rho = densBil(p);
  let grad = vec2f(densBil(p + vec2f(e, 0.0)) - densBil(p - vec2f(e, 0.0)),
                   densBil(p + vec2f(0.0, e)) - densBil(p - vec2f(0.0, e))) / (2.0 * e);
  desired *= 1.0 / (1.0 + max(rho - 2.0, 0.0) * select(0.25, 0.06, brute));   // 破牆者很重：人擠人也擠不太動它
  let cHere = vec2i(floor(p));
  let tHere = tileAt(cHere);
  let pHere = pileAt(cHere);
  if (tHere == 7u) { desired *= 0.45; atomicAdd(&wClimb, 1u); }  // 正在牆頂上爬
  let jit = vec2f(rnd(i * 31u + tick * 7919u), rnd(i * 17u + tick * 104729u)) - 0.5;
  v += (desired - v) * min(1.0, S.dt * 4.0) - grad * S.sepK * select(1.0, 0.2, brute) * S.dt + jit * 0.6 * S.dt;
  let vmax = baseSpeed * 1.8 + 0.5;
  let vl = length(v);
  if (vl > vmax) { v *= vmax / vl; }
  var np = p + v * S.dt;
  let c1 = vec2i(floor(np));
  if (!hard(tHere) && !canEnter(cHere, c1, tHere, pHere, !brute)) {
    if (brute && last && tileAt(c1) == 7u) {
      let wid = textureLoad(wallIds, c1, 0).r;
      if (wid > 0u) { atomicAdd(&counters[${WALL_BASE}u + wid - 1u], 1u); }
    }
    let nx = vec2f(np.x, p.y); let ny = vec2f(p.x, np.y);
    if (canEnter(cHere, vec2i(floor(nx)), tHere, pHere, !brute)) { np = nx; v.y = 0.0; }
    else if (canEnter(cHere, vec2i(floor(ny)), tHere, pHere, !brute)) { np = ny; v.x = 0.0; }
    else { np = p; v = vec2f(0.0); }
  }
  np = clamp(np, vec2f(0.5), vec2f(f32(WN) - 0.5));
  agents[i] = vec4f(np, v);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_index) li: u32) {
  if (li == 0u) { atomicStore(&wAlive, 0u); atomicStore(&wKills, 0u); atomicStore(&wClimb, 0u); }
  workgroupBarrier();
  if (g.x < S.n) { stepAgent(g.x); }
  workgroupBarrier();
  if (li == 0u) {
    let al = atomicLoad(&wAlive); let k = atomicLoad(&wKills); let cl = atomicLoad(&wClimb);
    if ((S.flags & 1u) != 0u && al > 0u) { atomicAdd(&counters[0], al); }
    if ((S.flags & 1u) != 0u && cl > 0u) { atomicAdd(&counters[3], cl); }
    if (k > 0u) { atomicAdd(&counters[1], k); }
  }
}
`;

// 屍堆（1 m 格的身體堆疊高度）：牆邊或低空直升機底下、擠得夠密就往上長；
// 每格最多比旁邊可走格高 SLOPE，所以會自然長成斜坡；牆本身當支撐（不限制）。人散了就慢慢塌。
const WGSL_PILE = WGSL_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> S: Sim;
@group(0) @binding(1) var tmap: texture_2d<u32>;
@group(0) @binding(2) var wdist: texture_2d<u32>;
@group(0) @binding(3) var<storage, read> dens: array<u32>;
@group(0) @binding(4) var<storage, read> src: array<f32>;
@group(0) @binding(5) var<storage, read_write> dst: array<f32>;
@group(0) @binding(6) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(7) var<storage, read> tiles: array<u32>;   // 作用中區塊編號（每塊 4 個 16×16 工作群組）
const SLOPE = 0.9;
const WALL_CAP = WALL_H - CLIMB_REACH + 0.8;   // 牆邊堆到這麼高就翻得過去，不再往上長
const D0 = 2.2;      // 每平方公尺超過這個密度才開始疊
const GROW = 0.05;   // 每多 1 隻/m² 每秒長幾公尺
const DECAY = 0.3;
const MAXP = 7.0;
fn T(c: vec2i) -> u32 {
  if (c.x < 0 || c.y < 0 || c.x >= i32(WN) || c.y >= i32(WN)) { return 1u; }
  return textureLoad(tmap, c, 0).r;
}
@compute @workgroup_size(16, 16)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u) {
  let tile = tiles[wg.x / 4u];
  let sub = wg.x % 4u;
  let gx = (tile % ${PTN}u) * ${PTILE}u + (sub % 2u) * 16u + l.x;
  let gy = (tile / ${PTN}u) * ${PTILE}u + (sub / 2u) * 16u + l.y;
  if (gx >= WN || gy >= WN) { return; }
  let c = vec2i(i32(gx), i32(gy));
  let idx = gy * WN + gx;
  let t = T(c);
  let old = src[idx];
  if (t == 1u || t == 2u || t == 7u) { dst[idx] = 0.0; return; }
  var motive = textureLoad(wdist, c, 0).r <= 7u;
  var capTop = WALL_CAP;
  for (var k = 0u; k < S.nUnits; k++) {
    let h = S.units[k];
    if (h.z > 0.5 && h.z < 16.0 && distance(vec2f(c) + 0.5, h.xy) < 9.0) { motive = true; capTop = MAXP; }   // 低空直升機底下可以疊成高塔
  }
  if (!motive) { dst[idx] = max(old - S.pileDt * 1.5, 0.0); return; }
  var capv = capTop;
  var offs = array<vec2i, 4>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1));
  for (var j = 0; j < 4; j++) {
    let n = c + offs[j];
    let tn = T(n);
    if (tn == 1u || tn == 2u || tn == 7u) { continue; }
    capv = min(capv, src[u32(n.y) * WN + u32(n.x)] + SLOPE);
  }
  let d = f32(dens[idx]);
  let p = clamp(old + S.pileDt * (GROW * max(d - D0, 0.0) - select(0.0, DECAY, d < 1.0)), 0.0, capv);
  dst[idx] = p;
  if (p > 0.05) { atomicMax(&counters[4], u32(p * 100.0)); }
}
`;

// 單位探測：每個單位一個工作群組，掃周圍 96×96 m。寫進 counters[PROBE_BASE + k*8 + …]：
// 0 接觸半徑內喪屍數、1 48 m 內喪屍數、2/3 它們相對位置總和（各加 64 免得負數）、4 8 m 內最高屍堆（公分）、
// 5 8–48 m 內最密的 3×3 m（高 10 位＝隻數、低 22 位＝中心格編號）：戰車主砲瞄這裡，不瞄可能是空地的重心
const WGSL_PROBE = WGSL_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> S: Sim;
@group(0) @binding(1) var<storage, read> dens: array<u32>;
@group(0) @binding(2) var<storage, read> pile: array<f32>;
@group(0) @binding(3) var<storage, read_write> counters: array<atomic<u32>>;
var<workgroup> wc: array<atomic<u32>, 6>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let k = wg.x;
  if (li < 6u) { atomicStore(&wc[li], 0u); }
  workgroupBarrier();
  let u = S.units[k];
  let base = vec2i(floor(u.xy)) - vec2i(48);
  var contact = 0u; var inr = 0u; var sx = 0u; var sy = 0u; var mp = 0u; var best = 0u;
  for (var j = li; j < 9216u; j += 256u) {
    let c = base + vec2i(i32(j % 96u), i32(j / 96u));
    if (c.x < 0 || c.y < 0 || c.x >= i32(WN) || c.y >= i32(WN)) { continue; }
    let idx = u32(c.y) * WN + u32(c.x);
    let n = dens[idx];
    let off = vec2f(c) + 0.5 - u.xy;
    let d = length(off);
    if (d < 8.0) { mp = max(mp, u32(pile[idx] * 100.0)); }
    if (n == 0u) { continue; }
    if (d < u.w) { contact += n; }
    if (d < 48.0) { inr += n; sx += n * u32(off.x + 64.0); sy += n * u32(off.y + 64.0); }
    if (d > 8.0 && d < 48.0 && c.x > 0 && c.y > 0 && c.x < i32(WN) - 1 && c.y < i32(WN) - 1) {
      var s3 = 0u;
      for (var oy = -1; oy <= 1; oy++) { for (var ox = -1; ox <= 1; ox++) { s3 += dens[u32(c.y + oy) * WN + u32(c.x + ox)]; } }
      best = max(best, (min(s3, 1023u) << 22u) | idx);
    }
  }
  atomicAdd(&wc[0], contact); atomicAdd(&wc[1], inr); atomicAdd(&wc[2], sx); atomicAdd(&wc[3], sy); atomicMax(&wc[4], mp); atomicMax(&wc[5], best);
  workgroupBarrier();
  if (li < 6u) { atomicStore(&counters[${PROBE_BASE}u + k * 8u + li], atomicLoad(&wc[li])); }
}
`;

// 各區喪屍數：掃 4 m 粗密度格，工作群組內先加總 16 區，再各加一次到全域
const WGSL_DCOUNT = WGSL_COMMON + /* wgsl */`
@group(0) @binding(0) var<storage, read> coarse: array<u32>;
@group(0) @binding(1) var<storage, read> dmap: array<u32>;
@group(0) @binding(2) var<storage, read_write> counters: array<atomic<u32>>;
var<workgroup> wd: array<atomic<u32>, 16>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_index) li: u32) {
  if (li < 16u) { atomicStore(&wd[li], 0u); }
  workgroupBarrier();
  let i = g.x;
  if (i < NN * NN) {
    let d = (dmap[i / 4u] >> ((i % 4u) * 8u)) & 255u;
    let c = coarse[i];
    if (d < 16u && c > 0u) { atomicAdd(&wd[d], c); }
  }
  workgroupBarrier();
  if (li < 16u) { let v = atomicLoad(&wd[li]); if (v > 0u) { atomicAdd(&counters[${DIST_BASE}u + li], v); } }
}
`;

// 畫面剔除：把看得到的喪屍編號擠進 visible，數量寫進間接繪製參數
const WGSL_CULL = WGSL_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> U: R;
@group(0) @binding(1) var<storage, read> agents: array<vec4f>;
@group(0) @binding(2) var<storage, read> info: array<vec2u>;
@group(0) @binding(3) var<storage, read_write> visible: array<u32>;
@group(0) @binding(4) var<storage, read_write> ind: array<atomic<u32>>;
var<workgroup> wc: atomic<u32>;
var<workgroup> wbase: u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_index) li: u32) {
  if (li == 0u) { atomicStore(&wc, 0u); }
  workgroupBarrier();
  let i = g.x;
  var slot = 0xffffffffu;
  if (i < u32(U.view.z)) {
    if ((info[i].x & 3u) != 0u) {
      let c = U.vp * vec4f(agents[i].xy, 0.0, 1.0);
      let m = 4.4 * U.misc.y / U.view.y;
      if (abs(c.x) < 1.0 + m && c.y > -1.0 - m && c.y < 1.0 + m) { slot = atomicAdd(&wc, 1u); }
    }
  }
  workgroupBarrier();
  if (li == 0u) { wbase = atomicAdd(&ind[1], atomicLoad(&wc)); }
  workgroupBarrier();
  if (slot != 0xffffffffu) { visible[wbase + slot] = i; }
}
`;
