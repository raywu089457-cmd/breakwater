// ---------- 檢疫站：撤回來的人要排隊篩檢；有人帶著潛伏感染，篩得快漏得多（進基地才屍變＝基地內爆發），篩得慢隊伍排長（在隊伍裡屍變＝門口爆發）----------
const QPOLICY = {
  fast: { name: '快速放行', rate: 30, detect: 0.2, cost: 0 },
  standard: { name: '標準篩檢', rate: 8, detect: 0.75, cost: 0.2 },
  strict: { name: '隔離觀察', rate: 3, detect: 0.97, cost: 0.5 },
};
const quarantine = {
  policy: 'standard', queue: [], admittedInf: [], isolation: [], procF: 0,
  admitted: 0, detected: 0, isolatedTurned: 0, outbreaks: 0, queueTurned: 0, recentFound: 0, foundT: 0,
};
// 載人時就決定誰帶著感染（危機區、被圍得越緊越高）；潛伏 15–60 遊戲分鐘
function infectRate(d) { return 0.03 + (d.state === 'crisis' ? 0.07 : 0) + Math.min((d.siege || 0) / 20, 0.08); }
function pickupInfected(k, d) {
  const out = [];
  const rate = infectRate(d);
  for (let i = 0; i < k; i++) if (Math.random() < rate) out.push(sim.time + 15 + Math.random() * 45);
  return out;
}
const qGate = () => [fob.x, fob.y + 58];
function quarantineEnqueue(n, infected, dk) {
  if (n <= 0) return;
  quarantine.queue.push({ clean: n - infected.length, inf: infected.slice(), d: dk });
}
const queueLen = () => quarantine.queue.reduce((s, b) => s + b.clean + b.inf.length, 0);
function updateQuarantine(sdt) {
  const q = quarantine, P = QPOLICY[q.policy];
  // 篩檢：每遊戲分鐘處理 rate 人，從隊伍最前面開始
  q.procF += P.rate * sdt;
  while (q.procF >= 1 && q.queue.length) {
    if (P.cost > 0 && supply.stock < P.cost) break;   // 沒補給（試劑）就停擺
    q.procF -= 1;
    useSupply(P.cost);
    const b = q.queue[0];
    const total = b.clean + b.inf.length;
    const d = districts[b.d];
    if (Math.random() < b.inf.length / total) {
      const turnAt = b.inf.splice(Math.floor(Math.random() * b.inf.length), 1)[0];
      if (Math.random() < P.detect) { q.isolation.push(turnAt); q.detected++; q.recentFound++; }
      else { q.admittedInf.push({ turnAt, d: b.d }); rescued++; d.rescued++; q.admitted++; }   // 漏網：以為是健康的
    } else { b.clean--; rescued++; d.rescued++; q.admitted++; }
    if (b.clean + b.inf.length <= 0) q.queue.shift();
  }
  if (!q.queue.length) q.procF = Math.min(q.procF, 1);
  // 潛伏期到了就屍變
  const now = sim.time;
  for (const b of q.queue) {
    for (let i = b.inf.length - 1; i >= 0; i--) if (b.inf[i] <= now) {
      b.inf.splice(i, 1); districts[b.d].dead++; q.queueTurned++;
      const [gx, gy] = qGate(); spawnZombieAt(gx + (Math.random() - 0.5) * 16, gy + (Math.random() - 0.5) * 6);
      logEvent('檢疫隊伍裡有人屍變！', 'bad');
    }
  }
  q.queue = q.queue.filter((b) => b.clean + b.inf.length > 0);
  for (let i = q.admittedInf.length - 1; i >= 0; i--) {
    const a = q.admittedInf[i];
    if (a.turnAt > now) continue;
    q.admittedInf.splice(i, 1); rescued--; districts[a.d].rescued--; districts[a.d].dead++; q.outbreaks++;
    spawnZombieAt(fob.x + (Math.random() - 0.5) * 40, fob.y + (Math.random() - 0.5) * 30);
    logEvent('⚠ 基地內有人屍變（漏檢的感染者）！', 'bad');
  }
  for (let i = q.isolation.length - 1; i >= 0; i--) if (q.isolation[i] <= now) { q.isolation.splice(i, 1); q.isolatedTurned++; }
  // 每 10 遊戲分鐘彙整一次「檢出」訊息，不要洗版
  q.foundT += sdt;
  if (q.foundT >= 10) { if (q.recentFound) logEvent(`檢疫站檢出 ${q.recentFound} 名感染者，已隔離`, 'warn'); q.recentFound = 0; q.foundT = 0; }
}
function setQPolicy(p) {
  if (!QPOLICY[p]) return;
  quarantine.policy = p;
  document.querySelectorAll('[data-qp]').forEach((b) => b.classList.toggle('on', b.dataset.qp === p));
}
function updateQuarantineUI() {
  const q = quarantine, P = QPOLICY[q.policy], n = queueLen();
  $('qstat').textContent = `排隊 ${n.toLocaleString()} · 隔離 ${q.isolation.length} · 爆發 ${q.outbreaks + q.queueTurned}`;
  $('qinfo').textContent = `${P.rate} 人/分 · 檢出率 ${Math.round(P.detect * 100)}%${P.cost ? ` · 每人 ${P.cost} 補給` : ''}${n ? ` · 約 ${Math.ceil(n / P.rate)} 分鐘清完` : ''}`;
}
function quarantineMarks(push) {
  const n = queueLen();
  if (n > 0) { const [gx, gy] = qGate(); push(gx, gy, 6 + Math.min(14, Math.sqrt(n)), 0, n > 200 ? [1, 0.5, 0.2] : [0.95, 0.85, 0.4], 0.9); }
}
