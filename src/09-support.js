// ---------- 火力支援：砲兵、艦砲、空襲、戰斧飛彈（會誤傷自己人） ----------
const SUP = {
  artillery: { name: '砲兵', delay: 3, cd: 18, rounds: 6, spread: 20, r: 11, lethal: 0.9, every: 0.3, fx: 22 },
  naval: { name: '艦砲', delay: 5, cd: 28, rounds: 12, spread: 26, r: 11, lethal: 0.92, every: 0.4, fx: 20 },
  air: { name: '空襲', delay: 6, cd: 45, rounds: 8, len: 220, r: 13, lethal: 0.93, fx: 26 },
  tomahawk: { name: '戰斧', delay: 12, cd: 90, r: 42, lethal: 0.97, fx: 95 },
};
const SUP_KEYS = { KeyZ: 'artillery', KeyX: 'naval', KeyC: 'air', KeyV: 'tomahawk' };
// 外海艦隊（純畫面＋艦砲/飛彈的發射點）
const FLEET = { carrier: [map.fob.x + 190, 70], destroyer: [map.fob.x - 110, 115] };
const support = { cd: { artillery: 0, naval: 0, air: 0, tomahawk: 0 }, missions: [], shells: [], jets: [], missiles: [], trail: [], shake: 0, calls: 0 };

function callSupport(type, x, y, x2, y2) {
  const s = SUP[type];
  if (!s || support.cd[type] > 0) return false;
  if (!spend(SUPPORT_COST[type], s.name)) return false;
  support.cd[type] = s.cd;
  support.calls++;
  const m = { type, x, y, t: s.delay, t0: s.delay, fired: 0, next: 0, done: false };
  if (type === 'air') {
    // 拖曳＝轟炸線方向；只點一下＝從外海往北飛過目標
    let dx = (x2 ?? x) - x, dy = (y2 ?? y) - y, L = Math.hypot(dx, dy);
    if (L < 8) { dx = 0; dy = 1; L = 1; }
    m.dx = dx / L; m.dy = dy / L;
    m.x0 = x - (m.dx * s.len) / 2; m.y0 = y - (m.dy * s.len) / 2;
  }
  support.missions.push(m);
  return true;
}
// 爆炸：殺喪屍＋特效＋焦痕＋震動＋誤傷
function boom(x, y, r, lethal, fx, shake) {
  sim.strikesOnce.push([x, y, r, lethal]);
  game.fx.push([x, y, fx, sim.time]);
  fxExplosion(x, y, fx);
  game.marks.push({ type: 3, x, y, r: r * 0.75, life: 90, max: 90 });
  support.shake = Math.max(support.shake, shake);
  for (const u of [...units]) {
    const d = Math.hypot(u.x - x, u.y - y);
    if (d > r + 6) continue;
    if (u.type === 'squad') {
      let lost = 0;
      for (let k = 0; k < u.men; k++) {
        const [ox, oy] = soldierOffset(u, k), dd = Math.hypot(u.x + ox - x, u.y + oy - y);
        if (dd < r && Math.random() < lethal * (1 - dd / r)) { lost++; fxSoldierDown(u.x + ox, u.y + oy); }
      }
      if (lost) { u.men -= lost; game.lost += lost; game.friendly = (game.friendly || 0) + lost; if (u.men <= 0) removeUnit(u); }
    } else if (u.type === 'tank' && d < r) { u.hp -= 900 * (1 - d / r); game.friendly = (game.friendly || 0) + 1; }
    else if (u.type === 'heli' && d < r && u.z < 12) { u.hp -= 80 * (1 - d / r); }
  }
}
const gauss2 = () => { const a = Math.random() * 6.2831853, r = Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * 0.5; return [Math.cos(a) * r, Math.sin(a) * r]; };

function updateSupport(sdt) {
  for (const k in support.cd) support.cd[k] = Math.max(0, support.cd[k] - sdt);
  support.shake = Math.max(0, support.shake - sdt * 2.5);
  for (const m of support.missions) {
    const s = SUP[m.type];
    m.t -= sdt;
    if (m.type === 'artillery' || m.type === 'naval') {
      if (m.t > 0) continue;
      m.next -= sdt;
      while (m.next <= 0 && m.fired < s.rounds) {
        const [gx, gy] = gauss2();
        const tx = m.x + gx * s.spread, ty = m.y + gy * s.spread;
        const from = m.type === 'naval' ? [FLEET.destroyer[0] + 24, FLEET.destroyer[1], 6] : [tx - 40, ty - 60, 140];
        support.shells.push({ tx, ty, from, t: 0, dur: m.type === 'naval' ? 0.9 : 0.5, r: s.r, lethal: s.lethal, fx: s.fx });
        if (m.type === 'naval') game.fx.push([FLEET.destroyer[0] + 26, FLEET.destroyer[1] + 1, 7, sim.time]);
        m.fired++; m.next += s.every;
      }
      if (m.fired >= s.rounds) m.done = true;
    } else if (m.type === 'air') {
      // 噴射機 180 m/s：提早 1.5 秒從 270 m 外進場，經過轟炸線時等距投 8 顆
      if (!m.jet && m.t <= 1.5) {
        m.jet = { x: m.x0 - m.dx * 270, y: m.y0 - m.dy * 270, dx: m.dx, dy: m.dy, dropped: 0, m };
        support.jets.push(m.jet);
      }
      if (m.jet && m.jet.gone) m.done = true;
    } else if (m.type === 'tomahawk') {
      if (!m.missile && m.t <= 4) {
        m.missile = { x: FLEET.carrier[0], y: FLEET.carrier[1], sx: FLEET.carrier[0], sy: FLEET.carrier[1], tx: m.x, ty: m.y, t: 0, dur: 4, m };
        support.missiles.push(m.missile);
      }
      if (m.missile && m.missile.hit) m.done = true;
    }
  }
  support.missions = support.missions.filter((m) => !m.done);
  // 砲彈飛行
  for (const sh of support.shells) {
    sh.t += sdt;
    if (sh.t >= sh.dur && !sh.hit) { sh.hit = true; boom(sh.tx, sh.ty, sh.r, sh.lethal, sh.fx, 0.25); }
  }
  support.shells = support.shells.filter((sh) => !sh.hit);
  // 噴射機
  for (const j of support.jets) {
    j.x += j.dx * 180 * sdt; j.y += j.dy * 180 * sdt;
    const s = SUP.air, along = (j.x - j.m.x0) * j.dx + (j.y - j.m.y0) * j.dy;
    while (j.dropped < s.rounds && along >= (j.dropped / (s.rounds - 1)) * s.len) {
      const bx = j.m.x0 + j.dx * (j.dropped / (s.rounds - 1)) * s.len, by = j.m.y0 + j.dy * (j.dropped / (s.rounds - 1)) * s.len;
      support.shells.push({ tx: bx, ty: by, from: [bx - j.dx * 40, by - j.dy * 40, 30], t: 0, dur: 0.45, r: s.r, lethal: s.lethal, fx: s.fx });
      j.dropped++;
    }
    if (along > s.len + 450) j.gone = true;
  }
  support.jets = support.jets.filter((j) => !j.gone);
  // 戰斧：從航艦起飛、拉高、俯衝；尾煙
  for (const ms of support.missiles) {
    ms.t += sdt;
    const p = Math.min(1, ms.t / ms.dur);
    ms.x = lerp(ms.sx, ms.tx, p); ms.y = lerp(ms.sy, ms.ty, p); ms.z = 10 + 260 * p * (1 - p);
    if (Math.random() < 0.9) support.trail.push([ms.x, ms.y, ms.z, 1.2]);
    if (p >= 1 && !ms.hit) { ms.hit = true; const s = SUP.tomahawk; boom(ms.tx, ms.ty, s.r, s.lethal, s.fx, 1.0); }
  }
  support.missiles = support.missiles.filter((ms) => !ms.hit);
  for (const tp of support.trail) tp[3] -= sdt;
  support.trail = support.trail.filter((tp) => tp[3] > 0).slice(-160);
}

// 給模擬：外海艦隊不吸屍；這裡只有畫面
function pushSupportInstances(push) {
  const ships = SPRITES.ships, jets = SPRITES.jet;
  if (ships) {
    const lv = pickLod(cam.ppm, ships, 40);
    const draw = (pos, row, w) => { const h = (w * ships.cellH) / ships.cellW; push([pos[0], pos[1], 2, w], [h, lv.x, lv.y + row * lv.ch, 0], [lv.cw, lv.ch, 1, 0]); };
    draw(FLEET.carrier, 0, 140); draw(FLEET.destroyer, 1, 70);
  }
  for (const sh of support.shells) {
    const p = Math.min(1, sh.t / sh.dur), q = Math.max(0, p - 0.12);
    const at = (s) => [lerp(sh.from[0], sh.tx, s), lerp(sh.from[1], sh.ty, s), lerp(sh.from[2], 0, s) + (sh.from[2] < 20 ? 60 * s * (1 - s) : 0)];
    const a = at(q), b = at(p);
    push([a[0], a[1], a[2], 2], [b[0], b[1], b[2], 4], [1, 0.85, 0.55, 0.95]);
  }
  for (const tp of support.trail) push([tp[0], tp[1], tp[2], 3], [tp[0] + 1.5, tp[1] + 1.5, tp[2] + 0.5, 4], [0.75, 0.75, 0.75, 0.5 * tp[3]]);
  for (const ms of support.missiles) {
    const dx = ms.tx - ms.sx, dy = ms.ty - ms.sy, L = Math.hypot(dx, dy) || 1;
    push([ms.x - (dx / L) * 6, ms.y - (dy / L) * 6, ms.z + 1, 3], [ms.x, ms.y, ms.z, 4], [1, 0.95, 0.7, 1]);
  }
  if (jets) {
    const lv = pickLod(cam.ppm, jets, 12);
    for (const j of support.jets) {
      const dir = angTo8(Math.atan2(j.dy, j.dx)), w = 18, h = (w * jets.cellH) / jets.cellW;
      push([j.x, j.y, 0.08, 12], [7, 0, 0, 1], [0, 0, 0.25, 0]);
      push([j.x, j.y, 22, w], [h, lv.x + (dir % 4) * lv.cw, lv.y + Math.floor(dir / 4) * lv.ch, 0], [lv.cw, lv.ch, 1, 0]);
    }
  }
}
// 瞄準預覽（標記）
function supportMarks(push, gx, gy, gx2, gy2) {
  for (const m of support.missions) {
    const s = SUP[m.type], left = Math.max(0, m.t) / m.t0;
    if (m.type === 'air') for (let k = 0; k < s.rounds; k++) push(m.x0 + (m.dx * k * s.len) / (s.rounds - 1), m.y0 + (m.dy * k * s.len) / (s.rounds - 1), s.r, 1, [1, 0.45, 0.2], 0.6);
    else push(m.x, m.y, m.type === 'tomahawk' ? s.r : s.spread + s.r * 0.5, 1, m.type === 'tomahawk' ? [1, 0.2, 0.2] : [1, 0.5, 0.2], left);
  }
  if (game.tool !== 'support' || gx == null) return;
  const t = game.supType, s = SUP[t], ok = support.cd[t] <= 0;
  const c = ok ? [1, 0.75, 0.3] : [0.6, 0.6, 0.6];
  if (t === 'air') {
    let dx = (gx2 ?? gx) - gx, dy = (gy2 ?? gy) - gy, L = Math.hypot(dx, dy);
    if (L < 8) { dx = 0; dy = 1; L = 1; }
    for (let k = 0; k < s.rounds; k++) { const f = k / (s.rounds - 1) - 0.5; push(gx + (dx / L) * f * s.len, gy + (dy / L) * f * s.len, s.r, 0, c, 0.8); }
  } else push(gx, gy, t === 'tomahawk' ? s.r : s.spread + s.r * 0.5, 0, c, 0.9);
}
