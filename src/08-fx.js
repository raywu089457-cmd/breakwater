// ---------- 戰鬥特效：粒子（槍口火光、火星、煙、血、塵）、燃燒殘骸 —— 全在 CPU、池子大小固定，跟喪屍數量無關 ----------
// 每顆粒子 16 個 float：x y z vx vy vz 年齡 壽命 起始大小 結束大小 r g b a 重力 形狀
// 形狀 0 火光（圓、自發光）、1 火星／血滴（方塊、隨時間變暗）、2 煙／塵（雜訊邊、越來越淡）
const MAX_PARTS = 1600, PS = 16;
const parts = new Float32Array(MAX_PARTS * PS);
let nParts = 0;
const wrecks = [];   // 被擊毀的載具：燒焦的車身留在原地冒火冒煙
// 載具圖每個像素幾公尺（重切圖集後格寬變了，畫出來的大小照舊）
const VEH_MPP = { tank: 11 / 99, truck: 9 / 88, heli: 16 / 70, transport: 16 / 88 };
const vehW = (type, sheet) => sheet.cellW * VEH_MPP[type];
const rr = (a, b) => a + Math.random() * (b - a);
function emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav, shape) {
  const i = nParts < MAX_PARTS ? nParts++ : (Math.random() * MAX_PARTS) | 0;   // 滿了就隨便蓋掉一顆
  parts.set([x, y, z, vx, vy, vz, 0, life, s0, s1, r, g, b, a, grav, shape], i * PS);
}
function updateParts(sdt) {
  for (let i = 0; i < nParts; i++) {
    const o = i * PS;
    if ((parts[o + 6] += sdt) >= parts[o + 7]) {   // 壽命到了：拿最後一顆補這個位置
      nParts--;
      if (i < nParts) parts.copyWithin(o, nParts * PS, nParts * PS + PS);
      i--; continue;
    }
    const drag = parts[o + 15] === 2 ? 1.6 : 0.4, k = Math.max(0, 1 - drag * sdt);
    parts[o + 3] *= k; parts[o + 4] *= k; parts[o + 5] = parts[o + 5] * (parts[o + 15] === 2 ? k : 1) - parts[o + 14] * sdt;
    parts[o] += parts[o + 3] * sdt; parts[o + 1] += parts[o + 4] * sdt; parts[o + 2] += parts[o + 5] * sdt;
    if (parts[o + 2] < 0.05) { parts[o + 2] = 0.05; parts[o + 5] *= -0.25; parts[o + 3] *= 0.5; parts[o + 4] *= 0.5; }
  }
}

// ----- 預設效果 -----
function fxMuzzle(x, y, z, big) {
  emit(x, y, z, 0, 0, 0, big ? 0.09 : 0.05, big ? 2.6 : 0.75, big ? 1.4 : 0.35, 1, 0.92, 0.55, 1, 0, 0);
}
// 子彈打在屍群裡：多半噴血，偶爾揚塵
function fxImpact(x, y) {
  if (Math.random() < 0.7) {
    for (let k = 0; k < 2; k++) emit(x, y, 1.1, rr(-2.5, 2.5), rr(-2.5, 2.5), rr(2, 5), rr(0.3, 0.45), 0.32, 0.22, 0.55, 0.04, 0.04, 1, 14, 1);
  } else emit(x, y, 0.3, rr(-1, 1), rr(-1, 1), rr(0.5, 1.5), 0.5, 0.4, 1.3, 0.55, 0.5, 0.42, 0.55, 0, 2);
}
// 爆炸（size＝爆炸圖寬度 m，13 戰車主砲 … 95 戰斧）：衝擊波圈、火球、四散火星、升起的煙
function fxExplosion(x, y, size) {
  const s = size / 20, rs = Math.sqrt(s);
  game.marks.push({ type: 4, x, y, r: size * 0.75, life: 0.45, max: 0.45 });
  emit(x, y, 1.5 * rs, 0, 0, 0, 0.14, size * 0.45, size * 0.7, 1, 0.9, 0.6, 1, 0, 0);
  const nSp = clamp(Math.round(14 * s), 6, 48);
  for (let k = 0; k < nSp; k++) {
    const a = Math.random() * 6.2832, v = rr(6, 20) * rs;
    emit(x, y, rr(0.5, 2) * rs, Math.cos(a) * v, Math.sin(a) * v, rr(5, 15) * rs, rr(0.45, 1.0), rr(0.3, 0.5) * rs, 0.2, 1, rr(0.65, 0.9), 0.3, 1, 22, 1);
  }
  const nSm = clamp(Math.round(6 * s), 3, 20);
  for (let k = 0; k < nSm; k++) {
    const a = Math.random() * 6.2832, d = rr(0, size * 0.22), g = rr(0.2, 0.3);
    emit(x + Math.cos(a) * d, y + Math.sin(a) * d, rr(1, 3) * rs, Math.cos(a) * rr(1, 3), Math.sin(a) * rr(1, 3), rr(2.5, 5) * rs, rr(2.2, 4.2) * Math.min(rs, 2),
      size * 0.18, Math.min(size * 0.45, 26), g, g * 0.95, g * 0.9, 0.62, 0, 2);
  }
  // 地面揚起的塵環
  const nD = clamp(Math.round(8 * rs), 6, 20);
  for (let k = 0; k < nD; k++) {
    const a = (k / nD) * 6.2832, v = rr(6, 10) * rs;
    emit(x + Math.cos(a) * size * 0.15, y + Math.sin(a) * size * 0.15, 0.4, Math.cos(a) * v, Math.sin(a) * v, 0.6, rr(0.8, 1.3), size * 0.1, size * 0.25, 0.5, 0.45, 0.37, 0.5, 0, 2);
  }
}
// 一個士兵倒下：噴血＋地上一灘血
function fxSoldierDown(x, y) {
  for (let k = 0; k < 5; k++) emit(x, y, 1.0, rr(-3, 3), rr(-3, 3), rr(2, 5), rr(0.35, 0.6), 0.35, 0.22, 0.6, 0.03, 0.03, 1, 14, 1);
  game.marks.push({ type: 6, x, y, r: rr(0.8, 1.2), life: 60, max: 60 });
  const blood = game.marks.filter((m) => m.type === 6);
  if (blood.length > 80) game.marks.splice(game.marks.indexOf(blood[0]), 1);   // 血跡太多就清掉最舊的
}
// 右鍵下令：目的地一個收縮的落點圈（綠＝移動、青＝撤離／補給任務）
function fxOrderPing(x, y, mission) {
  game.marks.push({ type: 5, x, y, r: 7, life: 0.6, max: 0.6, c: mission ? [0.35, 0.9, 1] : [0.45, 1, 0.5] });
}
function addWreck(u) {
  wrecks.push({ type: u.type, x: u.x, y: u.y, z: isAir(u) ? 0.8 : 0.6, dir: u.dir, t: 0, life: 45 });
  if (wrecks.length > 12) wrecks.shift();
}
// 受損的載具冒煙、殘骸燒；喪屍數量多少都一樣，只跟單位數有關
function updateCombatFx(sdt) {
  if (sdt <= 0) return;
  updateParts(sdt);
  for (const w of wrecks) {
    w.t += sdt;
    const heat = Math.max(0, 1 - w.t / w.life);
    if (Math.random() < 14 * heat * sdt) emit(w.x + rr(-2, 2), w.y + rr(-1.5, 1.5), 1.5, rr(-0.4, 0.4), rr(-0.4, 0.4), rr(1.5, 3), rr(0.3, 0.6), rr(1, 1.8), 0.5, 1, rr(0.45, 0.7), 0.15, 1, -1, 0);
    if (Math.random() < 7 * (0.25 + heat) * sdt) { const g = rr(0.24, 0.34); emit(w.x + rr(-1.5, 1.5), w.y + rr(-1, 1), 2.5, rr(0.5, 1.5), rr(-0.3, 0.6), rr(2, 3.5), rr(3, 5), 2, 7, g, g, g * 0.95, 0.6 * (0.35 + heat), 0, 2); }
  }
  for (let k = wrecks.length - 1; k >= 0; k--) if (wrecks[k].t > wrecks[k].life + 20) wrecks.splice(k, 1);
  for (const u of units) {
    const max = UT[u.type].hp;
    if (!max || u.type === 'squad') continue;
    const hp = u.hp / max;
    if (hp < 0.55 && Math.random() < (hp < 0.25 ? 9 : 4) * sdt) {
      const g = hp < 0.25 ? 0.2 : 0.4, z = isAir(u) ? visZ(u) : 2.2;
      emit(u.x + rr(-1, 1), u.y + rr(-1, 1), z, -u.vx * 0.3 + rr(-0.5, 0.5), -u.vy * 0.3 + rr(-0.5, 0.5), rr(1.5, 3), rr(1.5, 2.8), 1.2, 4.5, g, g, g, 0.65, 0, 2);
      if (hp < 0.25 && Math.random() < 0.5) emit(u.x, u.y, z, 0, 0, 2, 0.25, 1.1, 0.4, 1, 0.55, 0.15, 1, 0, 0);
    }
    // 直升機低飛：旋翼把地上的灰塵吹開
    if (isAir(u) && u.z < 14 && Math.random() < (14 - u.z) * 1.2 * sdt) {
      const a = Math.random() * 6.2832, v = rr(7, 12);
      emit(u.x + Math.cos(a) * 3, u.y + Math.sin(a) * 3, 0.3, Math.cos(a) * v, Math.sin(a) * v, 0.3, rr(0.6, 1), 1, 3, 0.55, 0.5, 0.42, 0.4, 0, 2);
    }
  }
}

// ----- 繪製實例：殘骸畫在單位前面（被壓在底下），粒子畫在最後 -----
function pushWrecks(push) {
  const ts = SPRITES.tank;
  for (const w of wrecks) {
    const spr = w.type === 'truck' ? SPRITES.truck : w.type === 'heli' ? SPRITES.heli : w.type === 'transport' ? SPRITES.transport : ts;
    if (!spr) continue;
    const wid = vehW(w.type, spr), h = (wid * spr.cellH) / spr.cellW, lv = pickLod(cam.ppm, spr, h);
    const fade = clamp(1 - (w.t - w.life) / 20, 0, 1);
    push([w.x, w.y, w.z, wid], [h, lv.x + (w.dir % 4) * lv.cw, lv.y + Math.floor(w.dir / 4) * lv.ch, 0], [lv.cw, lv.ch, fade, 4]);
  }
}
// 種類 6 粒子：(x, y, z, 大小m) (形狀, 進度0..1, 種子, 6) (r, g, b, a)
function pushParticles(push) {
  for (let i = 0; i < nParts; i++) {
    const o = i * PS, t = parts[o + 6] / parts[o + 7];
    push([parts[o], parts[o + 1], parts[o + 2], lerp(parts[o + 8], parts[o + 9], t)], [parts[o + 15], t, i & 63, 6], [parts[o + 10], parts[o + 11], parts[o + 12], parts[o + 13]]);
  }
}
