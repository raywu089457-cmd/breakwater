// ---------- WebGPU 引擎 ----------
const $ = (id) => document.getElementById(id);
const errors = [];
function fail(msg) { const e = $('err'); e.style.display = 'block'; e.textContent = msg; errors.push(msg); throw new Error(msg); }
if (!navigator.gpu) fail('這個瀏覽器不支援 WebGPU，請用最新版 Chrome / Edge。');
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) fail('找不到可用的 GPU。');
const hasTS = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({
  requiredFeatures: hasTS ? ['timestamp-query'] : [],
  requiredLimits: {
    maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 256 << 20),
    maxBufferSize: Math.min(adapter.limits.maxBufferSize, 512 << 20),
  },
});
device.addEventListener('uncapturederror', (e) => { errors.push(e.error.message); console.error('[gpu]', e.error.message); });
device.lost.then((i) => errors.push('device lost: ' + i.message));
const canvas = $('c');
const gctx = canvas.getContext('webgpu');
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
gctx.configure({ device, format: canvasFormat, alphaMode: 'opaque' });
const GBU = GPUBufferUsage, GTU = GPUTextureUsage;
const OFF_FMT = 'rgba8unorm';

function buf(size, usage, data) {
  const b = device.createBuffer({ size: Math.max(16, Math.ceil(size / 16) * 16), usage, mappedAtCreation: !!data });
  if (data) { new data.constructor(b.getMappedRange(0, Math.ceil(data.byteLength / 4) * 4)).set(data); b.unmap(); }
  return b;
}
async function mod(code, label) {
  const m = device.createShaderModule({ code, label });
  const info = await m.getCompilationInfo();
  for (const msg of info.messages) if (msg.type === 'error') {
    const line = (code.split('\n')[msg.lineNum - 1] || '').trim();
    const s = `${label}:${msg.lineNum}:${msg.linePos} ${msg.message} | ${line}`;
    errors.push(s); console.error(s);
  }
  return m;
}

// ----- 世界 -----
const t0 = performance.now();
const map = genCity(REGION.seed, REGION.map || {});
const typeTex = device.createTexture({ size: [WN, WN], format: 'r8uint', usage: GTU.TEXTURE_BINDING | GTU.COPY_DST });
device.queue.writeTexture({ texture: typeTex }, map.t, { bytesPerRow: WN }, [WN, WN]);
const genMs = performance.now() - t0;

// ----- 緩衝區 -----
const SIM_BYTES = 64 + 16 * (MAX_TARGETS + MAX_ZONES + MAX_ONCE + MAX_LINES * 2 + MAX_SUNITS), SIM_STRIDE = Math.ceil(SIM_BYTES / 256) * 256;
const CTR_WORDS = WALL_BASE + MAX_PANELS;
const simU = [0, 1, 2, 3].map(() => buf(SIM_STRIDE, GBU.UNIFORM | GBU.COPY_DST));
const renderU = buf(480, GBU.UNIFORM | GBU.COPY_DST);
const { dmap, districts } = genDistricts(map);
const dmapB = buf(NN * NN, GBU.STORAGE | GBU.COPY_DST, new Uint32Array(dmap.buffer));
const distTex = device.createTexture({ size: [NN, NN], format: 'r8uint', usage: GTU.TEXTURE_BINDING | GTU.COPY_DST });
device.queue.writeTexture({ texture: distTex }, dmap, { bytesPerRow: NN }, [NN, NN]);
const MAX_FX = 64;
const fxB = buf(MAX_FX * 32, GBU.STORAGE | GBU.COPY_DST);   // 每個爆炸 2 個 vec4：(x, y, 寬, 開始時間) (高度, 0, 0, 0)
const agentsB = buf(MAX_AGENTS * 16, GBU.STORAGE | GBU.COPY_DST | GBU.COPY_SRC);   // COPY_SRC：存檔要讀回來
const infoB = buf(MAX_AGENTS * 8, GBU.STORAGE | GBU.COPY_DST | GBU.COPY_SRC);
const densB = buf(WN * WN * 4, GBU.STORAGE | GBU.COPY_DST);
const coarseB = buf(NN * NN * 4, GBU.STORAGE | GBU.COPY_DST | GBU.COPY_SRC);
const costB = buf(NN * NN * 4, GBU.STORAGE | GBU.COPY_DST, map.cost);
const seedB = buf(NN * NN * 4, GBU.STORAGE);
const distA = buf(NN * NN * 4, GBU.STORAGE | GBU.COPY_DST, new Float32Array(NN * NN).fill(INF));
const distB = buf(NN * NN * 4, GBU.STORAGE | GBU.COPY_DST, new Float32Array(NN * NN).fill(INF));
const flowB = buf(NN * NN * 16, GBU.STORAGE);
const countersB = buf(CTR_WORDS * 4, GBU.STORAGE | GBU.COPY_SRC | GBU.COPY_DST);   // 0 存活 1 累計擊殺 2 畫面中 3 牆頂 4 最高屍堆 16+k 殺傷區內數量 64+k 射擊線內數量 PROBE_BASE+ 單位探測
const pileA = buf(WN * WN * 4, GBU.STORAGE | GBU.COPY_DST | GBU.COPY_SRC);
const pileB = buf(WN * WN * 4, GBU.STORAGE | GBU.COPY_DST);
// 離最近的牆幾公尺（255＝很遠）：屍堆只在牆邊長
const wallDist = new Uint8Array(WN * WN).fill(255);
const wallDistTex = device.createTexture({ size: [WN, WN], format: 'r8uint', usage: GTU.TEXTURE_BINDING | GTU.COPY_DST });
device.queue.writeTexture({ texture: wallDistTex }, wallDist, { bytesPerRow: WN }, [WN, WN]);
// 牆板編號（0＝不是牆，否則＝牆板編號＋1）：破牆者頂到哪一片
const wallIdArr = new Uint16Array(WN * WN);
const wallIdTex = device.createTexture({ size: [WN, WN], format: 'r16uint', usage: GTU.TEXTURE_BINDING | GTU.COPY_DST });
device.queue.writeTexture({ texture: wallIdTex }, wallIdArr, { bytesPerRow: WN * 2 }, [WN, WN]);
const MAX_WALLS = MAX_PANELS;   // 繪製實例＝每片完好的牆板
const wallB = buf(MAX_WALLS * 32, GBU.STORAGE | GBU.COPY_DST);
const visibleB = buf(MAX_AGENTS * 4, GBU.STORAGE);
const indirectB = buf(16, GBU.INDIRECT | GBU.STORAGE | GBU.COPY_DST | GBU.COPY_SRC, new Uint32Array([6, 0, 0, 0]));
const bldData = new Float32Array(map.buildings.length * 8);
map.buildings.forEach((b, k) => bldData.set([b[0], b[1], b[2], b[3], b[4], b[5], 0, 0], k * 8));
const bldB = buf(bldData.byteLength, GBU.STORAGE, bldData);
const MAX_MARKS = 512;
const markB = buf(MAX_MARKS * 32, GBU.STORAGE | GBU.COPY_DST);
const blitU = buf(16, GBU.UNIFORM | GBU.COPY_DST);
const ctrRead = device.createBuffer({ size: CTR_WORDS * 4, usage: GBU.MAP_READ | GBU.COPY_DST });
const KILL_BYTES = 16 + KILL_CAP * 16;
const killB = buf(KILL_BYTES, GBU.STORAGE | GBU.COPY_SRC | GBU.COPY_DST);
const killRead = device.createBuffer({ size: KILL_BYTES, usage: GBU.MAP_READ | GBU.COPY_DST });
let qs = null, tsResolve = null, tsRead = null;
if (hasTS) {
  qs = device.createQuerySet({ type: 'timestamp', count: 4 });
  tsResolve = device.createBuffer({ size: 32, usage: GBU.QUERY_RESOLVE | GBU.COPY_SRC });
  tsRead = device.createBuffer({ size: 32, usage: GBU.MAP_READ | GBU.COPY_DST });
}

// 喪屍圖集（l0veyou 生成 → make_zombie_atlas.py；建置時內嵌）
const SPRITES = __SPRITES_META__;
const ATLAS_META = SPRITES.zombie;
const atlasBmp = await createImageBitmap(await (await fetch('__SPRITES_URI__')).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
const atlasTex = device.createTexture({ size: [atlasBmp.width, atlasBmp.height], format: 'rgba8unorm', usage: GTU.TEXTURE_BINDING | GTU.COPY_DST | GTU.RENDER_ATTACHMENT });
device.queue.copyExternalImageToTexture({ source: atlasBmp }, { texture: atlasTex, premultipliedAlpha: false }, [atlasBmp.width, atlasBmp.height]);

// ----- 管線 -----
const cpipe = async (code, label) => device.createComputePipeline({ layout: 'auto', compute: { module: await mod(code, label), entryPoint: 'main' } });
const [countP, seedP, relaxP, flowP, moveP, cullP, pileP, probeP] = await Promise.all([
  cpipe(WGSL_COUNT, 'count'), cpipe(WGSL_SEED, 'seed'), cpipe(WGSL_RELAX, 'relax'),
  cpipe(WGSL_FLOW, 'flow'), cpipe(WGSL_MOVE, 'move'), cpipe(WGSL_CULL, 'cull'), cpipe(WGSL_PILE, 'pile'), cpipe(WGSL_PROBE, 'probe')]);
const dcountP = await cpipe(WGSL_DCOUNT, 'dcount');
const depthState = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
const rpipe = async (code, label, extra = {}) => {
  const m = await mod(code, label);
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: m, entryPoint: 'vs' },
    fragment: { module: m, entryPoint: 'fs', targets: [extra.blend ? { format: OFF_FMT, blend: extra.blend } : { format: OFF_FMT }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: extra.depth || depthState,
  });
};
const alphaBlend = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
const [groundP, bldP, agentP, markP, fxP, unitP] = await Promise.all([
  rpipe(WGSL_GROUND, 'ground'), rpipe(WGSL_BLD, 'bld'), rpipe(WGSL_AGENT, 'agent'),
  rpipe(WGSL_MARK, 'mark', { blend: alphaBlend, depth: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' } }),
  rpipe(WGSL_FX, 'fx', { depth: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' } }),
  rpipe(WGSL_UNITS, 'units', { blend: alphaBlend, depth: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' } })]);
const blitM = await mod(WGSL_BLIT, 'blit');
const blitP = device.createRenderPipeline({ layout: 'auto', vertex: { module: blitM, entryPoint: 'vs' },
  fragment: { module: blitM, entryPoint: 'fs', targets: [{ format: canvasFormat }] }, primitive: { topology: 'triangle-list' } });

const bg = (pipe, entries) => device.createBindGroup({ layout: pipe.getBindGroupLayout(0),
  entries: entries.map((r, i) => ({ binding: i, resource: r.createView ? r.createView() : { buffer: r } })) });
const countBG = bg(countP, [simU[0], agentsB, infoB, densB, coarseB]);
const seedBG = bg(seedP, [simU[0], seedB]);
const relaxBG = [bg(relaxP, [costB, seedB, distA, distB]), bg(relaxP, [costB, seedB, distB, distA])];
const flowBG = bg(flowP, [distA, flowB]);
const moveBG = simU.map((u) => bg(moveP, [u, agentsB, infoB, densB, flowB, typeTex, countersB, pileA, wallIdTex, killB]));
const probeBG = bg(probeP, [simU[0], densB, pileA, countersB]);
const ptileB = buf(MAX_PTILES * 4, GBU.STORAGE | GBU.COPY_DST);
const ptileArr = new Uint32Array(MAX_PTILES);
let ptileN = 0, ptileSet = new Set();
const zeroRow = new Float32Array(PTILE);
// 作用中區塊：牆的範圍外擴 10 m、低空直升機 12 m 內。從作用中變成不作用的區塊把屍堆清零（兩張都清）。
const pileBG = [bg(pileP, [simU[0], typeTex, wallDistTex, densB, pileA, pileB, countersB, ptileB]), bg(pileP, [simU[0], typeTex, wallDistTex, densB, pileB, pileA, countersB, ptileB])];
function updatePileTiles() {
  const set = new Set();
  const addRect = (x0, y0, x1, y1) => {
    const a = clamp(Math.floor(x0 / PTILE), 0, PTN - 1), b = clamp(Math.floor((x1 - 1) / PTILE), 0, PTN - 1);
    const c = clamp(Math.floor(y0 / PTILE), 0, PTN - 1), d = clamp(Math.floor((y1 - 1) / PTILE), 0, PTN - 1);
    for (let ty = c; ty <= d; ty++) for (let tx = a; tx <= b; tx++) set.add(ty * PTN + tx);
  };
  for (const w of walls) addRect(w.x0 - 10, w.y0 - 10, w.x1 + 10, w.y1 + 10);
  for (const u of sim.units) if (u[2] > 0.5 && u[2] < 16) addRect(u[0] - 12, u[1] - 12, u[0] + 12, u[1] + 12);
  let same = set.size === ptileSet.size;
  if (same) for (const t of set) if (!ptileSet.has(t)) { same = false; break; }
  if (same) return;
  for (const t of ptileSet) if (!set.has(t)) {
    const x0 = (t % PTN) * PTILE, y0 = Math.floor(t / PTN) * PTILE;
    for (let y = y0; y < y0 + PTILE; y++) { device.queue.writeBuffer(pileA, (y * WN + x0) * 4, zeroRow); device.queue.writeBuffer(pileB, (y * WN + x0) * 4, zeroRow); }
  }
  ptileSet = set; ptileN = 0;
  for (const t of set) if (ptileN < MAX_PTILES) ptileArr[ptileN++] = t;
  if (ptileN) device.queue.writeBuffer(ptileB, 0, ptileArr, 0, ptileN);
}
const MAX_UNITS = 4096;   // 單位＋支援＋粒子（粒子池 1600）
const unitB = buf(MAX_UNITS * 48, GBU.STORAGE | GBU.COPY_DST);
const unitBG = bg(unitP, [renderU, unitB, atlasTex]);
const cullBG = bg(cullP, [renderU, agentsB, infoB, visibleB, indirectB]);
const groundBG = bg(groundP, [renderU, typeTex, coarseB, pileA, distTex]);
const dcountBG = bg(dcountP, [coarseB, dmapB, countersB]);
const bldBG = bg(bldP, [renderU, bldB]);
const wallBG = bg(bldP, [renderU, wallB]);
const agentBG = bg(agentP, [renderU, agentsB, infoB, visibleB, atlasTex, typeTex, pileA]);
const markBG = bg(markP, [renderU, markB]);
const fxBG = bg(fxP, [renderU, fxB, atlasTex]);

// ----- 畫面大小（像素風：內部低解析度，最近鄰放大） -----
let blitScale = 1;
const blitArr = new Float32Array(4);
// 日夜：1 模擬秒 = 1 遊戲分鐘；回傳 [夜晚程度, 黃昏程度]
function dayNight() {
  const h = (((START_MIN + sim.time) / 60) % 24 + 24) % 24;
  const day = smoothstep(5, 7.5, h) * (1 - smoothstep(17, 19.5, h));
  const dusk = Math.max(0, 1 - Math.abs(h - 18.2) / 1.6) + Math.max(0, 1 - Math.abs(h - 6.2) / 1.2) * 0.6;
  return [1 - day, Math.min(1, dusk) * (1 - (1 - day) * 0.6)];
}
let pixelScale = 2, iw = 0, ih = 0, colorTex = null, depthTex = null, blitBG = null;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.max(1, Math.round(canvas.clientWidth * dpr)), ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
  const niw = Math.ceil(cw / (pixelScale * dpr)), nih = Math.ceil(ch / (pixelScale * dpr));
  if (canvas.width === cw && canvas.height === ch && niw === iw && nih === ih && colorTex) return;
  canvas.width = cw; canvas.height = ch; iw = niw; ih = nih;
  colorTex?.destroy(); depthTex?.destroy();
  colorTex = device.createTexture({ size: [iw, ih], format: OFF_FMT, usage: GTU.RENDER_ATTACHMENT | GTU.TEXTURE_BINDING });
  depthTex = device.createTexture({ size: [iw, ih], format: 'depth24plus', usage: GTU.RENDER_ATTACHMENT | GTU.TEXTURE_BINDING });
  blitBG = bg(blitP, [colorTex, blitU, depthTex]);
  blitScale = cw / iw;
}

// ----- 模擬狀態 -----
const sim = { time: 0, speed: 1, n: 0, aware: 900, sepK: 2.6, speedMul: 1, relaxIters: 32,
  targets: [], strikesOnce: [], zones: [], lines: [], units: [], kills: 0, alive: 0, visible: 0, climbing: 0, maxPile: 0,
  zoneCounts: new Uint32Array(MAX_ZONES), distCounts: new Uint32Array(MAX_DIST), lineCounts: new Uint32Array(MAX_LINES), probe: new Uint32Array(MAX_SUNITS * 8), wallHits: new Uint32Array(MAX_PANELS),
  nWalls: 0 };
const simAB = new ArrayBuffer(SIM_BYTES), simF = new Float32Array(simAB), simI = new Uint32Array(simAB);
const OFF_T = 16, OFF_Z = OFF_T + MAX_TARGETS * 4, OFF_O = OFF_Z + MAX_ZONES * 4, OFF_L = OFF_O + MAX_ONCE * 4, OFF_U = OFF_L + MAX_LINES * 8;
function writeSim(slot, dt, last, applyOnce, pileDt) {
  simF[0] = dt; simF[1] = sim.time; simI[2] = sim.n; simI[3] = (last ? 1 : 0) | (applyOnce ? 2 : 0);
  simF[4] = sim.aware; simF[5] = sim.sepK; simF[6] = sim.speedMul; simI[7] = Math.min(MAX_TARGETS, sim.targets.length);
  const once = applyOnce ? sim.strikesOnce.slice(0, MAX_ONCE) : [];
  simI[8] = once.length; simF[9] = CORPSE_TIME; simF[10] = pileDt; simI[11] = Math.min(MAX_ZONES, sim.zones.length);
  simI[12] = Math.min(MAX_LINES, sim.lines.length); simI[13] = Math.min(MAX_SUNITS, sim.units.length);
  sim.targets.slice(0, MAX_TARGETS).forEach((t, k) => simF.set(t, OFF_T + k * 4));
  sim.zones.slice(0, MAX_ZONES).forEach((z, k) => simF.set(z, OFF_Z + k * 4));
  once.forEach((s, k) => simF.set(s, OFF_O + k * 4));
  sim.lines.slice(0, MAX_LINES).forEach((l, k) => simF.set(l, OFF_L + k * 8));
  sim.units.slice(0, MAX_SUNITS).forEach((u, k) => simF.set(u, OFF_U + k * 4));
  device.queue.writeBuffer(simU[slot], 0, simAB);
}
function setAgents(n) {
  const r = spawnAgents(map, Math.min(n, MAX_AGENTS), 5);
  device.queue.writeBuffer(agentsB, 0, r.a);
  device.queue.writeBuffer(infoB, 0, r.inf);
  if (sim.n > r.n) device.queue.writeBuffer(infoB, r.n * 8, new Uint32Array((sim.n - r.n) * 2));
  sim.n = r.n;
  return r.n;
}

// ----- 每幀 -----
const gpuMs = { sim: 0, render: 0 };
let ctrBusy = false, tsBusy = false, killBusy = false, frames = 0;
const rU = new Float32Array(120);
const dcolArr = new Float32Array(64);
// 依畫面上的精靈高度挑最接近、不超過 1.2 倍縮小的 LOD 層
function pickLod(ppm, sheet = ATLAS_META, worldH = 1.95) {
  const px = worldH * ppm;
  const lv = sheet.levels;
  for (const l of lv) if (l.ch <= px * 1.2) return l;
  return lv[lv.length - 1];
}
// 屍體跟站立喪屍同一個像素比例（兩張表都用 4.6 的像素格縮）
const M_PER_PX = 1.95 / ATLAS_META.cellH;
const CORPSE_W = SPRITES.corpse.cellW * M_PER_PX, CORPSE_H = SPRITES.corpse.cellH * M_PER_PX;
function encodeFrame(dtReal, marks, fxList, unitList) {
  resize();
  updateCam(iw, ih);
  const sub = sim.speed;
  const dt = Math.min(dtReal, 1 / 30);
  const enc = device.createCommandEncoder();
  const ts = (b, e) => (hasTS ? { timestampWrites: { querySet: qs, ...(b != null ? { beginningOfPassWriteIndex: b } : {}), ...(e != null ? { endOfPassWriteIndex: e } : {}) } } : {});
  const simRan = sub > 0 && sim.n > 0;
  if (simRan) {
    updatePileTiles();
    for (let s = 0; s < sub; s++) { sim.time += dt; writeSim(s, dt, s === sub - 1, s === 0, (dt * sub) / 2); }
    sim.strikesOnce.splice(0, MAX_ONCE);   // 一幀超過上限的留到下一幀，不會有畫面炸了、喪屍沒死的情況
    enc.clearBuffer(countersB, 0, 4);
    enc.clearBuffer(countersB, 8, CTR_WORDS * 4 - 8);
    const np = enc.beginComputePass(ts(0, null));
    np.setPipeline(seedP); np.setBindGroup(0, seedBG); np.dispatchWorkgroups(NN / 16, NN / 16);
    np.setPipeline(relaxP);
    for (let k = 0; k < sim.relaxIters; k++) { np.setBindGroup(0, relaxBG[k & 1]); np.dispatchWorkgroups(NN / 16, NN / 16); }
    np.setPipeline(flowP); np.setBindGroup(0, flowBG); np.dispatchWorkgroups(NN / 16, NN / 16);
    np.end();
    const wg = Math.ceil(sim.n / 256);
    for (let s = 0; s < sub; s++) {
      enc.clearBuffer(densB); enc.clearBuffer(coarseB);
      const cp = enc.beginComputePass(s === sub - 1 ? ts(null, 1) : {});
      cp.setPipeline(countP); cp.setBindGroup(0, countBG); cp.dispatchWorkgroups(wg);
      cp.setPipeline(moveP); cp.setBindGroup(0, moveBG[s]); cp.dispatchWorkgroups(wg);
      if (s === sub - 1) {
        // 屍堆：兩次半步（A→B→A），用最後一個子步的密度
        if (ptileN) {
          cp.setPipeline(pileP);
          cp.setBindGroup(0, pileBG[0]); cp.dispatchWorkgroups(ptileN * 4);
          cp.setBindGroup(0, pileBG[1]); cp.dispatchWorkgroups(ptileN * 4);
        }
        cp.setPipeline(dcountP); cp.setBindGroup(0, dcountBG); cp.dispatchWorkgroups((NN * NN) / 256);
        if (sim.units.length) { cp.setPipeline(probeP); cp.setBindGroup(0, probeBG); cp.dispatchWorkgroups(Math.min(MAX_SUNITS, sim.units.length)); }
      }
      cp.end();
    }
  }
  // 繪製參數
  const showAgents = cam.ppm >= 1.0;
  const heat = 1 - smoothstep(0.9, 2.1, cam.ppm);
  rU.set(cam.vp, 0);
  rU.set([...cam.right, 0], 16); rU.set([...cam.up, 0], 20); rU.set([...cam.back, 0], 24);
  rU.set([sim.time, cam.ppm, heat, cam.pitch], 28);
  rU.set([iw, ih, sim.n, 1], 32);
  const lod = pickLod(cam.ppm);
  rU.set([lod.cw, lod.ch, (ATLAS_META.foot * lod.ch) / ATLAS_META.cellH, ATLAS_META.frames], 36);
  const [night, dusk] = dayNight();
  rU.set([lod.x, lod.y, night, 0], 40);
  blitArr.set([blitScale, night * (1 - heat * 0.75), dusk * (1 - heat * 0.75), 1 - heat]);
  device.queue.writeBuffer(blitU, 0, blitArr);
  const cl = pickLod(cam.ppm, SPRITES.corpse, CORPSE_H), fl = pickLod(cam.ppm, SPRITES.fx, 22);
  rU.set([cl.cw, cl.ch, cl.x, cl.y], 44);
  rU.set([fl.cw, fl.ch, fl.x, fl.y], 48);
  rU.set([CORPSE_W, CORPSE_H, SPRITES.fx.cellH / SPRITES.fx.cellW, 0], 52);
  rU.set(dcolArr, 56);
  device.queue.writeBuffer(renderU, 0, rU);
  const nMarks = Math.min(MAX_MARKS, marks.length / 8);
  if (nMarks) device.queue.writeBuffer(markB, 0, marks, 0, nMarks * 8);
  const nUnits = Math.min(MAX_UNITS, unitList.length / 12);
  if (nUnits) device.queue.writeBuffer(unitB, 0, unitList, 0, nUnits * 12);
  const nFx = Math.min(MAX_FX, fxList.length / 8);
  if (nFx) device.queue.writeBuffer(fxB, 0, fxList, 0, nFx * 8);
  if (showAgents) {
    device.queue.writeBuffer(indirectB, 0, new Uint32Array([6, 0, 0, 0]));
    const cp = enc.beginComputePass(ts(2, null));
    cp.setPipeline(cullP); cp.setBindGroup(0, cullBG); cp.dispatchWorkgroups(Math.ceil(Math.max(sim.n, 1) / 256));
    cp.end();
  }
  const rp = enc.beginRenderPass({
    colorAttachments: [{ view: colorTex.createView(), clearValue: { r: 0.03, g: 0.05, b: 0.07, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
    depthStencilAttachment: { view: depthTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    ...ts(showAgents ? null : 2, 3),
  });
  rp.setPipeline(groundP); rp.setBindGroup(0, groundBG); rp.draw(6);
  if (map.buildings.length) { rp.setPipeline(bldP); rp.setBindGroup(0, bldBG); rp.draw(30, map.buildings.length); }
  if (sim.nWalls) { rp.setPipeline(bldP); rp.setBindGroup(0, wallBG); rp.draw(30, sim.nWalls); }
  if (showAgents && sim.n) { rp.setPipeline(agentP); rp.setBindGroup(0, agentBG); rp.drawIndirect(indirectB, 0); }
  if (nMarks) { rp.setPipeline(markP); rp.setBindGroup(0, markBG); rp.draw(6, nMarks); }
  if (nUnits) { rp.setPipeline(unitP); rp.setBindGroup(0, unitBG); rp.draw(6, nUnits); }
  if (nFx) { rp.setPipeline(fxP); rp.setBindGroup(0, fxBG); rp.draw(6, nFx); }
  rp.end();
  const bp = enc.beginRenderPass({ colorAttachments: [{ view: gctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
  bp.setPipeline(blitP); bp.setBindGroup(0, blitBG); bp.draw(3); bp.end();
  // 讀回（非同步，不卡畫面）
  const readCtr = !ctrBusy && frames % 6 === 0;
  if (readCtr) { enc.copyBufferToBuffer(countersB, 0, ctrRead, 0, CTR_WORDS * 4); enc.copyBufferToBuffer(indirectB, 4, ctrRead, 8, 4); }
  // 擊殺紀錄每幀讀（讀走就清空；上一次還沒讀完就先累積著）
  const readKill = !killBusy && simRan;
  if (readKill) { enc.copyBufferToBuffer(killB, 0, killRead, 0, KILL_BYTES); enc.clearBuffer(killB, 0, 16); }
  const readTs = hasTS && !tsBusy;
  if (readTs) { enc.resolveQuerySet(qs, 0, 4, tsResolve, 0); enc.copyBufferToBuffer(tsResolve, 0, tsRead, 0, 32); }
  device.queue.submit([enc.finish()]);
  frames++;
  if (readCtr) {
    ctrBusy = true;
    const shown = showAgents;
    ctrRead.mapAsync(GPUMapMode.READ).then(() => {
      const u = new Uint32Array(ctrRead.getMappedRange().slice(0));
      ctrRead.unmap(); ctrBusy = false;
      if (simRan) {
        sim.alive = u[0]; sim.climbing = u[3]; sim.maxPile = u[4] / 100;
        sim.zoneCounts.set(u.subarray(ZONE_BASE, ZONE_BASE + MAX_ZONES)); sim.lineCounts.set(u.subarray(LINE_BASE, LINE_BASE + MAX_LINES));
        sim.distCounts.set(u.subarray(DIST_BASE, DIST_BASE + MAX_DIST));
        sim.probe.set(u.subarray(PROBE_BASE, PROBE_BASE + MAX_SUNITS * 8));
        sim.wallHits.set(u.subarray(WALL_BASE, WALL_BASE + MAX_PANELS));
        sim.probeTime = sim.time;
      }
      sim.kills = u[1]; sim.visible = shown ? u[2] : 0;
    }).catch(() => { ctrBusy = false; });
  }
  if (readKill) {
    killBusy = true;
    killRead.mapAsync(GPUMapMode.READ).then(() => {
      const raw = killRead.getMappedRange();
      const n = Math.min(new Uint32Array(raw, 0, 1)[0], KILL_CAP);
      const e = n ? new Float32Array(raw.slice(16, 16 + n * 16)) : null;
      killRead.unmap(); killBusy = false;
      if (e) onKills(e, n);
    }).catch(() => { killBusy = false; });
  }
  if (readTs) {
    tsBusy = true;
    tsRead.mapAsync(GPUMapMode.READ).then(() => {
      const t = new BigUint64Array(tsRead.getMappedRange().slice(0));
      tsRead.unmap(); tsBusy = false;
      const ms = (a, b) => Number(t[b] - t[a]) / 1e6;
      if (simRan && t[1] > t[0]) gpuMs.sim = lerp(gpuMs.sim, ms(0, 1), 0.2);
      if (t[3] > t[2]) gpuMs.render = lerp(gpuMs.render, ms(2, 3), 0.2);
    }).catch(() => { tsBusy = false; });
  }
}
