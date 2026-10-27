// ---------- 戰役外殼：作戰結束判定（全部區域結案／基地被攻破／主動撤出）、結算評等、戰役地圖、帶到下一戰區的兵力 ----------
const FOB_PROBE_R = 40;
const op = { over: false, result: null, overrunT: 0, pop0: 0 };

const fobProbe = () => [fob.x, fob.y, 0, FOB_PROBE_R];
const fobProbeIdx = () => SHELTER_SLOT0 + shelters.length;
function gradeOf(r) {
  if (!r.win) return 'F';
  const k = r.rescued / Math.max(r.pop0, 1);
  return k >= 0.5 ? 'S' : k >= 0.35 ? 'A' : k >= 0.2 ? 'B' : k >= 0.1 ? 'C' : 'D';
}
function updateCampaign(sdt) {
  if (op.over) return;
  if (!op.pop0) op.pop0 = shelters.reduce((s, d) => s + d.pop0, 0);
  // 基地被攻破：基地 40 m 內平均密度 > 2.5/m² 連續 30 遊戲分鐘
  const contact = sim.probe[fobProbeIdx() * 8];
  const dens = contact / (Math.PI * FOB_PROBE_R * FOB_PROBE_R);
  op.overrunT = dens > 2.5 ? op.overrunT + sdt : Math.max(0, op.overrunT - sdt * 2);
  if (op.overrunT > 0 && op.overrunT - sdt <= 0) logEvent('前進基地遭到突破！', 'bad');
  if (op.overrunT >= 30) return endOperation('overrun');
  if (shelters.every((d) => d.state === 'evac' || d.state === 'lost')) endOperation('cleared');
}
function endOperation(reason) {
  if (op.over) return op.result;
  op.over = true;
  if (!op.pop0) op.pop0 = shelters.reduce((s, d) => s + d.pop0, 0);
  const abandoned = reason === 'withdraw' ? survivorsLeft() : 0;
  const r = {
    region: REGION.name, reason, win: reason !== 'overrun',
    rescued, dead: survivorsDead() + abandoned, pop0: op.pop0, kills: sim.kills, lostUnits: game.lost, clock: clockText(),
    carry: { tank: units.filter((u) => u.type === 'tank').length, heli: units.filter((u) => u.type === 'heli').length },
  };
  r.grade = gradeOf(r);
  op.result = r;
  setSpeed(0);
  logEvent(reason === 'overrun' ? '作戰失敗：前進基地失守' : reason === 'withdraw' ? `撤出${REGION.name}` : `${REGION.name} 作戰結束`, r.win ? 'good' : 'bad');
  showResult(r);
  return r;
}
// 結算畫面
function showResult(r) {
  const el = $('result');
  const next = REGIONS[CAMPAIGN.current + 1];
  const reasonText = { cleared: '所有區域已結案', overrun: '前進基地被屍潮攻破', withdraw: '主動撤出戰區' }[r.reason];
  el.innerHTML = `<div class="rt">${r.win ? '作戰結束' : '作戰失敗'} · ${r.region}</div>
    <div class="grade g${r.grade}">${r.grade}</div>
    <div class="rr">${reasonText}　${r.clock}</div>
    <table>
      <tr><td>救出倖存者</td><td>${r.rescued.toLocaleString()} / ${r.pop0.toLocaleString()}（${Math.round((r.rescued / Math.max(r.pop0, 1)) * 100)}%）</td></tr>
      <tr><td>罹難</td><td>${r.dead.toLocaleString()}</td></tr>
      <tr><td>擊殺喪屍</td><td>${r.kills.toLocaleString()}</td></tr>
      <tr><td>部隊損失</td><td>${r.lostUnits}</td></tr>
      ${r.win && next ? `<tr><td>帶往${next.name}</td><td>補給 +${Math.min(3000, Math.floor(r.rescued / 4))}、步兵班 +${Math.min(6, Math.floor(r.rescued / 400))}、戰車 ${Math.min(4, r.carry.tank)}、攻擊直升機 ${Math.min(4, r.carry.heli)}</td></tr>` : ''}
    </table>
    <div class="rb">
      ${r.win && next ? `<button id="rNext" class="on">前往下一戰區：${next.name}</button>` : ''}
      ${r.win && !next ? '<div class="rr">全部戰區完成！</div>' : ''}
      <button id="rRetry">重打這個戰區</button>
      <button id="rReset">重新開始戰役</button>
    </div>`;
  el.style.display = 'block';
  $('rRetry').onclick = () => location.reload();
  $('rReset').onclick = () => { try { localStorage.removeItem(CAMPAIGN_KEY); } catch { /* */ } goRegion(0); };
  if ($('rNext')) $('rNext').onclick = () => advanceCampaign(r);
}
function advanceCampaign(r) {
  CAMPAIGN.done = CAMPAIGN.done.filter((d) => d.region !== r.region).concat([{ region: r.region, grade: r.grade, rescued: r.rescued, dead: r.dead, kills: r.kills }]);
  CAMPAIGN.carry = { rescued: r.rescued, squad: Math.min(6, Math.floor(r.rescued / 400)), tank: Math.min(4, r.carry.tank), heli: Math.min(4, r.carry.heli) };
  CAMPAIGN.current = Math.min(CAMPAIGN.current + 1, REGIONS.length - 1);
  saveCampaign(CAMPAIGN);
  goRegion(CAMPAIGN.current);
}
function goRegion(k) {
  const q = new URLSearchParams(location.search);
  q.set('region', k);
  location.search = q.toString();
}
// 戰役地圖（右上「戰役」按鈕）
function showCampaignMap() {
  const el = $('cmap');
  if (el.style.display === 'block') { el.style.display = 'none'; return; }
  el.innerHTML = `<div class="rt">戰役 · 航艦戰鬥群</div>
    ${REGIONS.map((g, k) => {
      const done = CAMPAIGN.done.find((d) => d.region === g.name);
      const cur = REGION === g;
      return `<div class="cr ${cur ? 'cur' : ''}"><b>${k + 1}. ${g.name}</b><span>屍潮 ${(g.n / 10000).toFixed(0)} 萬 · Nexus ×${g.nexus}</span><span>${cur ? '目前戰區' : done ? `評等 ${done.grade} · 救出 ${done.rescued.toLocaleString()}` : k < CAMPAIGN.current ? '—' : '未到達'}</span></div>`;
    }).join('')}
    <div class="slots">${SLOTS.map(([k, label]) => `<div class="sl" data-slot="${k}"><b>${label}</b><span class="si">讀取中…</span>${k === 'auto' ? '<i></i>' : `<button data-save="${k}">存</button>`}<button data-load="${k}" disabled>讀</button></div>`).join('')}</div>
    <div class="rr">F5 快速存到存檔 1、F9 讀存檔 1；自動存檔每 ${AUTOSAVE_EVERY / 60} 遊戲小時一次</div>
    <div class="rb"><button id="cWithdraw">撤出目前戰區（結算）</button><button id="cClose">關閉</button></div>`;
  el.style.display = 'block';
  const refreshInfo = () => listSaves().then((list) => list.forEach((i, k) => {
    const row = el.querySelector(`.sl[data-slot="${SLOTS[k][0]}"]`);
    if (!row) return;
    row.querySelector('.si').textContent = i ? `${i.regionName} ${i.clock} · 救出 ${(i.rescued || 0).toLocaleString()} · ${new Date(i.savedAt).toLocaleString()}` : '空';
    row.querySelector('[data-load]').disabled = !i;
  }));
  refreshInfo();
  el.querySelectorAll('[data-save]').forEach((b) => { b.onclick = async () => { if (!op.over) { b.disabled = true; await saveGame(b.dataset.save); b.disabled = false; refreshInfo(); } }; });
  el.querySelectorAll('[data-load]').forEach((b) => { b.onclick = () => requestLoad(b.dataset.load); });
  $('cClose').onclick = () => { el.style.display = 'none'; };
  $('cWithdraw').onclick = () => { el.style.display = 'none'; endOperation('withdraw'); };
}
// 上一戰區帶過來的兵力與補給
function applyCarry() {
  const c = CAMPAIGN.carry || {};
  if (!c.rescued && !c.squad && !c.tank && !c.heli) return;
  supply.stock += Math.min(3000, Math.floor((c.rescued || 0) / 4));
  for (let k = 0; k < (c.squad || 0); k++) spawnUnit('squad', fob.x - 60 + k * 20, fob.y + 50);
  for (let k = 0; k < (c.tank || 0); k++) spawnUnit('tank', fob.x + 40 + k * 14, fob.y + 5);
  for (let k = 0; k < (c.heli || 0); k++) spawnUnit('heli', fob.x - 70 + k * 20, fob.y - 20);
  logEvent(`從上一個戰區帶來：補給 +${Math.min(3000, Math.floor((c.rescued || 0) / 4))}、步兵班 ${c.squad || 0}、戰車 ${c.tank || 0}、直升機 ${c.heli || 0}`, 'good');
}
