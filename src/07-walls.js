// ---------- 牆：放置、拆除，同步更新地表貼圖／離牆距離／導航成本／繪製實例 ----------
// 每道牆切成 PANEL 公尺一片的牆板，各有耐久；破牆者頂著牆板會扣耐久，歸零就碎掉開出缺口
const walls = [];          // { x0, y0, x1, y1, seed, panels: [{ x0, y0, x1, y1, id, hp, cells: [格索引, 原本類型, …] } | null（碎了）], gaps: [碎掉那片的矩形] }
const WALL_T = 2;          // 牆厚（公尺）
const wallInst = new Float32Array(MAX_WALLS * 8);
const panelById = new Array(MAX_PANELS).fill(null);   // 牆板編號 → [牆, 第幾片]
let panelNext = 0, panelsUsed = 0, wallsDirty = false, wallsHit = false;
let wallGhost = null;      // 拖曳中的預覽 { rect, ok }

// 拖曳兩點 → 吸附成水平或垂直、厚 2 m 的矩形（整數公尺）
function wallRect(ax, ay, bx, by) {
  const horiz = Math.abs(bx - ax) >= Math.abs(by - ay);
  let x0, y0, x1, y1;
  if (horiz) { x0 = Math.round(Math.min(ax, bx)); x1 = Math.round(Math.max(ax, bx)); y0 = Math.round(ay) - 1; y1 = y0 + WALL_T; }
  else { y0 = Math.round(Math.min(ay, by)); y1 = Math.round(Math.max(ay, by)); x0 = Math.round(ax) - 1; x1 = x0 + WALL_T; }
  x0 = clamp(x0, 0, WN); x1 = clamp(x1, 0, WN); y0 = clamp(y0, 0, WN); y1 = clamp(y1, 0, WN);
  return { x0, y0, x1, y1 };
}
// 至少 3 m 長，而且一半以上的格子可以蓋（不是建築、海、別的牆）
function wallValid(r) {
  if (Math.max(r.x1 - r.x0, r.y1 - r.y0) < 3) return false;
  let ok = 0, all = 0;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
    const v = map.t[y * WN + x]; all++;
    if (v !== T.BUILDING && v !== T.WATER && v !== T.WALL) ok++;
  }
  return all > 0 && ok * 2 >= all;
}
function uploadTiles(x0, y0, x1, y1) {
  if (x1 <= x0 || y1 <= y0) return;
  device.queue.writeTexture({ texture: typeTex, origin: [x0, y0] }, map.t, { offset: y0 * WN + x0, bytesPerRow: WN }, [x1 - x0, y1 - y0]);
}
function uploadWallIds(x0, y0, x1, y1) {
  if (x1 <= x0 || y1 <= y0) return;
  device.queue.writeTexture({ texture: wallIdTex, origin: [x0, y0] }, wallIdArr, { offset: (y0 * WN + x0) * 2, bytesPerRow: WN * 2 }, [x1 - x0, y1 - y0]);
}
// 重算一塊區域的離牆距離（公尺，最多 254；只算完好的牆板，缺口那裡就不再長屍堆）
function refreshWallDist(r) {
  const R = 12;
  const bx0 = Math.max(0, r.x0 - R), by0 = Math.max(0, r.y0 - R), bx1 = Math.min(WN, r.x1 + R), by1 = Math.min(WN, r.y1 + R);
  const near = [];
  for (const w of walls) if (w.x1 >= bx0 - R && w.x0 <= bx1 + R && w.y1 >= by0 - R && w.y0 <= by1 + R) for (const p of w.panels) if (p) near.push(p);
  for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
    let d = 255;
    for (const w of near) {
      const dx = Math.max(w.x0 - (x + 0.5), 0, x + 0.5 - w.x1), dy = Math.max(w.y0 - (y + 0.5), 0, y + 0.5 - w.y1);
      d = Math.min(d, Math.ceil(Math.hypot(dx, dy)));
    }
    wallDist[y * WN + x] = Math.min(d, 255);
  }
  device.queue.writeTexture({ texture: wallDistTex, origin: [bx0, by0] }, wallDist, { offset: by0 * WN + bx0, bytesPerRow: WN }, [bx1 - bx0, by1 - by0]);
}
function rebuildNav() {
  map.cost = computeNavCost(map.t);
  device.queue.writeBuffer(costB, 0, map.cost);
}
function rebuildWallInstances() {
  let n = 0;
  for (const w of walls) for (const p of w.panels) if (p) wallInst.set([p.x0, p.y0, p.x1, p.y1, WALL_H, w.seed, 1, 1 - p.hp / PANEL_HP], n++ * 8);
  if (wallGhost) { const g = wallGhost.rect; wallInst.set([g.x0, g.y0, g.x1, g.y1, WALL_H, 0, 2, wallGhost.ok ? 0 : 1], n * 8); n++; }
  if (n) device.queue.writeBuffer(wallB, 0, wallInst, 0, n * 8);
  sim.nWalls = n;
}
function setWallGhost(r) {
  wallGhost = r ? { rect: r, ok: wallValid(r) || repairCost(r) > 0 } : null;
  rebuildWallInstances();
}
function allocPanel() {
  for (let k = 0; k < MAX_PANELS; k++) {
    const id = (panelNext + k) % MAX_PANELS;
    if (!panelById[id]) { panelNext = id + 1; panelsUsed++; return id; }
  }
  return -1;
}
function placeWall(r, free = false) {
  if (!wallValid(r)) return false;
  const horiz = r.x1 - r.x0 >= r.y1 - r.y0, L = horiz ? r.x1 - r.x0 : r.y1 - r.y0, np = Math.ceil(L / PANEL);
  if (panelsUsed + np > MAX_PANELS - 2) { logEvent('牆板數量已達上限', 'bad'); return false; }
  if (!free && !spend(L * WALL_COST_PER_M, '築牆')) return false;
  const w = { ...r, seed: (walls.length * 0.6180339) % 1, panels: [], gaps: [] };
  for (let k = 0; k < np; k++) {
    const a = (horiz ? r.x0 : r.y0) + k * PANEL, b = Math.min(a + PANEL, horiz ? r.x1 : r.y1);
    w.panels.push(makePanel(w, k, horiz ? { x0: a, y0: r.y0, x1: b, y1: r.y1 } : { x0: r.x0, y0: a, x1: r.x1, y1: b }));
  }
  walls.push(w);
  uploadTiles(r.x0, r.y0, r.x1, r.y1);
  uploadWallIds(r.x0, r.y0, r.x1, r.y1);
  refreshWallDist(r);
  rebuildNav();
  rebuildUnitBlock();
  rebuildWallInstances();
  return true;
}
// 在矩形上立一片牆板（壓在建築／水／別的牆上的格子跳過；整片都壓到就不算）
function makePanel(w, k, rect) {
  const p = { ...rect, cells: [] };
  for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++) {
    const i = y * WN + x, v = map.t[i];
    if (v === T.BUILDING || v === T.WATER || v === T.WALL) continue;
    p.cells.push(i, v); map.t[i] = T.WALL;
  }
  if (!p.cells.length) return null;
  p.id = allocPanel(); p.hp = PANEL_HP;
  panelById[p.id] = [w, k];
  for (let j = 0; j < p.cells.length; j += 2) wallIdArr[p.cells[j]] = p.id + 1;
  return p;
}
// 修牆：在既有的牆上再拖一次＝補回碎掉的牆板、把受損的補滿；價錢照修補比例（每公尺 WALL_COST_PER_M）
// 跟某道牆平行、中線差不到 1.6 m（滑鼠換算到地面會有 1 m 的取整誤差）、沿牆方向重疊 1.5 m 以上的牆板才算
function repairList(r) {
  const out = [], horiz = r.x1 - r.x0 >= r.y1 - r.y0;
  const a0 = horiz ? r.x0 : r.y0, a1 = horiz ? r.x1 : r.y1, c = horiz ? (r.y0 + r.y1) / 2 : (r.x0 + r.x1) / 2;
  const len = (q) => Math.max(q.x1 - q.x0, q.y1 - q.y0);
  for (const w of walls) {
    if ((w.x1 - w.x0 >= w.y1 - w.y0) !== horiz) continue;
    if (Math.abs((horiz ? (w.y0 + w.y1) / 2 : (w.x0 + w.x1) / 2) - c) > 1.6) continue;
    w.panels.forEach((p, k) => {
      const q = p || w.gaps[k];
      if (!q || Math.min(a1, horiz ? q.x1 : q.y1) - Math.max(a0, horiz ? q.x0 : q.y0) < 1.5) return;
      if (p && p.hp < PANEL_HP) out.push({ w, k, cost: len(p) * WALL_COST_PER_M * (1 - p.hp / PANEL_HP) });
      else if (!p) out.push({ w, k, cost: len(q) * WALL_COST_PER_M, gap: true });
    });
  }
  return out;
}
const repairCost = (r) => Math.ceil(repairList(r).reduce((s, q) => s + q.cost, 0));
function repairWalls(r) {
  const list = repairList(r), cost = Math.ceil(list.reduce((s, q) => s + q.cost, 0));
  if (!list.length || panelsUsed + list.length > MAX_PANELS - 2) return 0;
  if (!spend(cost, '修牆')) return 0;
  let fixed = 0;
  for (const { w, k, gap } of list) {
    if (!gap) { w.panels[k].hp = PANEL_HP; fixed++; continue; }
    const g = w.gaps[k];
    const p = makePanel(w, k, g);
    if (!p) continue;
    w.panels[k] = p; w.gaps[k] = null; fixed++;
    uploadTiles(g.x0, g.y0, g.x1, g.y1); uploadWallIds(g.x0, g.y0, g.x1, g.y1); refreshWallDist(g);
    wallsDirty = true;
  }
  wallsHit = true;
  flushWalls();
  if (fixed) logEvent(`修好 ${fixed} 片牆板（−${cost}）`, 'good');
  return fixed;
}
// 拖曳放開：沿著受損／有缺口的牆拖＝修，否則蓋新牆
const buildOrRepair = (r) => (repairList(r).length ? repairWalls(r) > 0 : placeWall(r));
// 拆掉一片牆板（還原地表、清編號）；整道牆都沒了就從清單移除。導航之後一次重算（wallsDirty）
function dropPanel(w, k) {
  const p = w.panels[k];
  if (!p) return;
  w.gaps[k] = { x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 };
  for (let j = 0; j < p.cells.length; j += 2) { map.t[p.cells[j]] = p.cells[j + 1]; wallIdArr[p.cells[j]] = 0; }
  panelById[p.id] = null; panelsUsed--;
  w.panels[k] = null;
  uploadTiles(p.x0, p.y0, p.x1, p.y1);
  uploadWallIds(p.x0, p.y0, p.x1, p.y1);
  if (w.panels.every((q) => !q)) walls.splice(walls.indexOf(w), 1);
  refreshWallDist(p);
  wallsDirty = true;
}
function flushWalls() {
  if (!wallsDirty && !wallsHit) return;
  if (wallsDirty) { rebuildNav(); rebuildUnitBlock(); }
  wallsDirty = wallsHit = false;
  rebuildWallInstances();
}
function removeWallAt(x, y) {
  const k = walls.findIndex((w) => x >= w.x0 - 1.5 && x <= w.x1 + 1.5 && y >= w.y0 - 1.5 && y <= w.y1 + 1.5);
  if (k < 0) return false;
  const w = walls[k];
  for (let j = 0; j < w.panels.length; j++) dropPanel(w, j);
  if (walls.includes(w)) walls.splice(walls.indexOf(w), 1);
  flushWalls();
  return true;
}
// 破牆者：讀回來的「頂著每片牆板的數量」× 時間扣耐久，碎了就開缺口
function wallPlace(x, y) {
  const o = outposts.find((q) => Math.hypot(q.x - x, q.y - y) < 24);
  return o ? o.name : districts[districtOf(x, y)].name;
}
function updateWalls(sdt) {
  const H = sim.wallHits;
  for (let id = 0; id < MAX_PANELS; id++) {
    if (!H[id] || !panelById[id]) continue;
    const [w, k] = panelById[id], p = w.panels[k];
    p.hp -= H[id] * BRUTE_DPS * sdt;
    wallsHit = true;
    if (p.hp > 0) continue;
    const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2;
    dropPanel(w, k);
    H[id] = 0;
    game.breaches = (game.breaches || 0) + 1;
    game.fx.push([cx, cy, 7, sim.time]);
    game.marks.push({ type: 3, x: cx, y: cy, r: 4, life: 60, max: 60 });
    logEvent(`⚠ 破牆者撞開了牆：${wallPlace(cx, cy)}`, 'bad');
  }
  flushWalls();
}
const livePanels = () => walls.reduce((s, w) => s + w.panels.filter(Boolean).length, 0);
const wallLength = () => walls.reduce((s, w) => s + w.panels.reduce((t, p) => t + (p ? Math.max(p.x1 - p.x0, p.y1 - p.y0) : 0), 0), 0);
const damagedPanels = () => walls.reduce((s, w) => s + w.panels.filter((p) => p && p.hp < PANEL_HP).length, 0);
