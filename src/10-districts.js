// ---------- 區域狀態：守住 → 危機 → 失守；避難所倖存者、民兵、時間軸、事件紀錄 ----------
const SHELTER_R = 15;      // 圍攻判定半徑（公尺）
const SIEGE_D = 1.6;       // 避難所周圍每平方公尺超過這個密度 = 被圍攻（危機）
const CALM_D = 0.6;        // 低於這個密度連續 20 秒 = 解圍（守住）
const DSTATE = {
  base: { name: '基地', col: [0.35, 0.75, 1] },
  hold: { name: '守住', col: [0.35, 0.9, 0.45] },
  crisis: { name: '危機', col: [1, 0.68, 0.2] },
  lost: { name: '失守', col: [0.9, 0.2, 0.18] },
  evac: { name: '已撤離', col: [0.62, 0.68, 0.78] },
};
const shelters = districts.filter((d) => d.k > 0);
const events = [];
function logEvent(text, kind = 'info') {
  // 同樣的訊息 10 遊戲分鐘內重複出現：合併成一行加「×N」，也不重播提示音
  const top = events[0];
  if (top && top.text === text && sim.time - top.t < 10) { top.count = (top.count || 1) + 1; top.t = sim.time; top.clock = clockText(); renderEvents(); return; }
  events.unshift({ text, kind, t: sim.time, clock: clockText() });
  sfx.alert(kind, text);
  if (events.length > 30) events.pop();
  renderEvents();
}
// 1 模擬秒 = 1 遊戲分鐘；第 1 天 07:30 開始
function clockText() {
  const m = START_MIN + sim.time, day = Math.floor(m / 1440) + 1, hh = Math.floor((m % 1440) / 60), mm = Math.floor(m % 60);
  return `第 ${day} 天 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
function setDistrictState(d, s) {
  if (d.state === s) return;
  const prev = d.state;
  d.state = s;
  if (s === 'crisis') logEvent(`${d.name} 遭到圍攻，倖存者 ${d.pop.toLocaleString()} 人`, 'warn');
  else if (s === 'hold' && prev === 'crisis') logEvent(`${d.name} 解圍`, 'good');
  else if (s === 'lost') logEvent(`${d.name} 失守`, 'bad');
}
// 開局：最靠近市中心的避難所已經被圍（第一個任務）
{
  const first = shelters.slice().sort((a, b) => Math.hypot(a.sx - map.downtown.x, a.sy - map.downtown.y) - Math.hypot(b.sx - map.downtown.x, b.sy - map.downtown.y))[0];
  first.state = 'crisis'; first.opening = true;
}
function updateDistricts(sdt) {
  const P = sim.probe;
  for (const d of shelters) {
    const b = (SHELTER_SLOT0 + d.k - 1) * 8;
    const contact = P[b];
    d.siege = contact / (Math.PI * SHELTER_R * SHELTER_R);
    d.near = P[b + 1];
    if (d.state === 'lost' || d.state === 'evac') continue;
    if (d.siege > SIEGE_D) { setDistrictState(d, 'crisis'); d.calm = 0; }
    else if (d.state === 'crisis' && !d.opening) { d.calm = d.siege < CALM_D ? d.calm + sdt : 0; if (d.calm > 20) setDistrictState(d, 'hold'); }
    if (d.opening && d.siege > SIEGE_D) d.opening = false;   // 開局的圍攻真的到了之後，照一般規則
    if (d.state === 'crisis' && d.siege > SIEGE_D * 0.6) {
      // 被突破：每秒死的人跟貼著避難所的喪屍數成正比，三成屍變加入屍潮
      d.lossF = (d.lossF || 0) + Math.min(contact, 600) * 0.05 * sdt;
      const k = Math.min(d.pop, Math.floor(d.lossF));
      if (k > 0) {
        d.lossF -= k; d.pop -= k; d.dead += k;
        const tn = Math.round(k * 0.3);
        for (let j = 0; j < tn; j++) spawnZombieAt(d.sx + (Math.random() - 0.5) * 8, d.sy + (Math.random() - 0.5) * 8);
        d.turned += tn;
      }
    }
    if (d.pop <= 0 && d.state !== 'evac' && d.state !== 'lost') {
      // 人都沒了：救出的比死的多＝撤離完成，否則失守
      setDistrictState(d, (d.evacuated || 0) >= d.dead ? 'evac' : 'lost');
      if (d.state === 'evac') logEvent(`${d.name} 撤離完成：撤出 ${(d.evacuated || 0).toLocaleString()} 人`, 'good');
    }
  }
}
// 給模擬：危機中的避難所很吵（吸屍）；有人的避難所有民兵（小殺傷區）；每個避難所一個探測槽
function districtTargets() {
  const t = [];
  for (const d of shelters) if (d.state === 'crisis' && d.pop > 0) t.push([d.sx, d.sy, 8, d.opening ? 140 : 110]);
  return t;
}
function districtZones(z) {
  for (const d of shelters) {
    const i = 41 + d.k - 1;
    z[i] = d.pop > 0 && d.state !== 'evac' ? [d.sx, d.sy, 30, Math.min(4, (1.5 + d.pop / 2500) / Math.max(sim.zoneCounts[i], 1))] : [0, 0, 0, 0];
  }
}
function districtProbes() { return shelters.map((d) => [d.sx, d.sy, 0, SHELTER_R]); }
function updateDistrictColors() {
  const pulse = 0.65 + 0.35 * Math.sin(sim.time * 5);
  for (const d of districts) {
    const s = DSTATE[d.state];
    dcolArr.set([...s.col, d.state === 'crisis' ? pulse : d.state === 'hold' ? 0.5 : 1], d.k * 4);
  }
}

// ----- 介面：右側區域面板、作戰地圖標籤、事件紀錄 -----
const dpanel = $('dpanel'), dlabels = $('dlabels'), elog = $('elog');
dpanel.innerHTML = '<div class="t">區域</div>' + districts.map((d) => `<div class="dr" data-k="${d.k}"><i></i><span class="n">${d.name}</span><span class="v"></span></div>`).join('');
dlabels.innerHTML = districts.map((d) => `<div class="dl" data-k="${d.k}"><b>${d.name}</b><span></span></div>`).join('');
dpanel.querySelectorAll('.dr').forEach((row) => row.addEventListener('click', () => {
  const d = districts[+row.dataset.k];
  cam.x = d.k ? d.sx : fob.x; cam.y = d.k ? d.sy : fob.y; cam.ppm = Math.max(cam.ppm, 4);
}));
function renderEvents() {
  elog.innerHTML = events.filter((e) => sim.time - e.t < 90).slice(0, 4).map((e) => `<div class="ev ${e.kind}"><span>${e.clock}</span>${e.text}${e.count > 1 ? ` ×${e.count}` : ''}</div>`).join('');
}
function updateDistrictUI() {
  for (const row of dpanel.querySelectorAll('.dr')) {
    const d = districts[+row.dataset.k], s = DSTATE[d.state];
    row.querySelector('i').style.background = `rgb(${s.col.map((c) => Math.round(c * 255)).join(',')})`;
    row.querySelector('.v').textContent = d.k ? `${s.name} · ${d.pop.toLocaleString()}` : `屍 ${sim.distCounts[0].toLocaleString()}`;
    row.classList.toggle('crisis', d.state === 'crisis');
  }
}
function placeLabels() {
  const show = cam.ppm < 1.6 && !control;
  dlabels.style.display = show ? '' : 'none';
  if (!show) return;
  const r = canvas.getBoundingClientRect();
  for (const el of dlabels.children) {
    const d = districts[+el.dataset.k];
    const [x, y] = projectPx(d.cx, d.cy, 0, r);
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
    el.querySelector('span').textContent = d.k ? `${DSTATE[d.state].name} · ${d.pop.toLocaleString()} 人 · 屍 ${sim.distCounts[d.k].toLocaleString()}` : `屍 ${sim.distCounts[0].toLocaleString()}`;
    el.className = 'dl ' + d.state;
  }
}
const survivorsLeft = () => shelters.reduce((s, d) => s + d.pop, 0);
const survivorsDead = () => shelters.reduce((s, d) => s + d.dead, 0);
