// ---------- 音效：全部用 Web Audio 現場合成（不用音檔、不花錢）——槍聲、爆炸、旋翼、屍潮低吟、事件提示 ----------
const sfx = (() => {
  let ac = null, master = null, noiseBuf = null, hordeGain = null, rotorGain = null, muted = false, lastShot = 0, shotsThisSec = 0, moanT = 0;
  try { muted = localStorage.getItem('bw-muted') === '1'; } catch { /* 無痕模式 */ }
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ac.createDynamicsCompressor();
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.55;
    master.connect(comp); comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // 屍潮低吟：帶通噪音、慢慢起伏
    const hs = loopNoise(), hf = ac.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 280; hf.Q.value = 0.7;
    hordeGain = ac.createGain(); hordeGain.gain.value = 0;
    hs.connect(hf); hf.connect(hordeGain); hordeGain.connect(master);
    // 旋翼：低通噪音 × 18 Hz 拍打
    const rs = loopNoise(), rf = ac.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 420;
    const chop = ac.createGain(); chop.gain.value = 0.5;
    const lfo = ac.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 18;
    const lfoAmt = ac.createGain(); lfoAmt.gain.value = 0.5; lfo.connect(lfoAmt); lfoAmt.connect(chop.gain); lfo.start();
    rotorGain = ac.createGain(); rotorGain.gain.value = 0;
    rs.connect(rf); rf.connect(chop); chop.connect(rotorGain); rotorGain.connect(master);
  }
  function loopNoise() { const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; }
  // 相對鏡頭的位置 → 音量、左右聲道；small＝小聲音（拉遠就聽不到）
  function place(x, y, small) {
    const dx = (x - cam.x) / Math.max(cam.halfW, 1), dy = (y - cam.y) / Math.max(cam.halfH / Math.sin(cam.pitch), 1);
    const dist = Math.hypot(dx, dy);
    let vol = clamp(1.3 - dist * 0.6, 0, 1);
    if (small) vol *= smoothstep(0.6, 3, cam.ppm);
    return { vol, pan: clamp(dx * 0.8, -1, 1) };
  }
  function voice(vol, pan) {
    const g = ac.createGain(), p = ac.createStereoPanner();
    p.pan.value = pan; g.connect(p); p.connect(master);
    return g;
  }
  function shot(x, y, heavy) {
    if (!ac || muted) return;
    const now = ac.currentTime;
    if (Math.floor(now) !== lastShot) { lastShot = Math.floor(now); shotsThisSec = 0; }
    if (++shotsThisSec > 24) return;   // 同一秒最多 24 聲，避免糊成一片
    const { vol, pan } = place(x, y, true);
    if (vol < 0.02) return;
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = heavy ? 700 : 1600 + Math.random() * 900; f.Q.value = 0.9;
    const g = voice(vol, pan);
    const dur = heavy ? 0.22 : 0.07;
    g.gain.setValueAtTime(vol * (heavy ? 0.9 : 0.35), now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    s.connect(f); f.connect(g); s.start(now, Math.random() * 1.5, dur + 0.02);
  }
  function boom(x, y, size) {
    if (!ac || muted) return;
    const { vol: v0, pan } = place(x, y, false);
    const vol = v0 * clamp(0.35 + size / 40, 0.35, 1.2);
    if (vol < 0.02) return;
    const now = ac.currentTime, dur = clamp(0.5 + size / 25, 0.6, 3.2);
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, now); f.frequency.exponentialRampToValueAtTime(140, now + dur);
    const g = voice(vol, pan);
    g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    s.connect(f); f.connect(g); s.start(now, Math.random(), dur + 0.1);
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70, now); o.frequency.exponentialRampToValueAtTime(32, now + dur * 0.6);
    const og = voice(vol, pan);
    og.gain.setValueAtTime(vol * 0.9, now); og.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.6);
    o.connect(og); o.start(now); o.stop(now + dur);
  }
  function moan() {
    if (!ac || muted) return;
    const now = ac.currentTime, dur = 0.9 + Math.random() * 0.8;
    const o = ac.createOscillator(); o.type = 'sawtooth';
    const base = 110 + Math.random() * 90;
    o.frequency.setValueAtTime(base, now); o.frequency.linearRampToValueAtTime(base * 0.7, now + dur);
    const vib = ac.createOscillator(); vib.frequency.value = 5 + Math.random() * 3;
    const va = ac.createGain(); va.gain.value = 4; vib.connect(va); va.connect(o.frequency); vib.start(now); vib.stop(now + dur);
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 650;
    const g = voice(0, (Math.random() - 0.5) * 1.4);
    const v = 0.05 * smoothstep(1.5, 6, cam.ppm);
    g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(v, now + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(f); f.connect(g); o.start(now); o.stop(now + dur);
  }
  function tone(freqs, step, vol, type = 'triangle') {
    if (!ac || muted) return;
    const now = ac.currentTime;
    freqs.forEach((fr, k) => {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = fr;
      const g = voice(0, 0);
      const t = now + k * step;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.6);
      o.connect(g); o.start(t); o.stop(t + step * 1.8);
    });
  }
  function alert(kind, text = '') {
    if (/NEXUS/.test(text)) tone([196, 185, 175, 165], 0.22, 0.22, 'sawtooth');
    else if (kind === 'bad') tone([660, 494], 0.14, 0.14);
    else if (kind === 'warn') tone([587, 587], 0.11, 0.12);
    else if (kind === 'good') tone([523, 659, 784], 0.09, 0.1);
  }
  // 每幀：屍潮音量看畫面中喪屍數、旋翼音量看最近的直升機；新的爆炸／曳光彈出聲
  function tick(dt) {
    if (!ac) return;
    const now = ac.currentTime;
    const crowd = clamp(Math.log10(1 + sim.visible) / 4.5, 0, 1) * smoothstep(1.2, 5, cam.ppm);
    hordeGain.gain.setTargetAtTime(muted ? 0 : crowd * 0.16, now, 0.4);
    let rv = 0;
    for (const u of units) if (u.type === 'heli' || u.type === 'transport') rv = Math.max(rv, place(u.x, u.y, false).vol);
    for (const j of support.jets) rv = Math.max(rv, place(j.x, j.y, false).vol * 0.6);
    rotorGain.gain.setTargetAtTime(muted ? 0 : rv * 0.18, now, 0.15);
    for (const f of game.fx) if (!f.heard) { f.heard = true; boom(f[0], f[1], f[2]); }
    for (const t of tracers) if (!t.heard) { t.heard = true; shot(t[0], t[1], t[7] === 1); }
    moanT -= dt;
    if (moanT <= 0) { moanT = 0.3 + Math.random() * (2.5 - crowd * 2); if (crowd > 0.15 && sim.speed) moan(); }
  }
  function toggle() {
    muted = !muted;
    try { localStorage.setItem('bw-muted', muted ? '1' : '0'); } catch { /* 無痕模式 */ }
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.55, ac.currentTime, 0.05);
    return muted;
  }
  addEventListener('pointerdown', init);
  addEventListener('keydown', init);
  return { init, tick, alert, toggle, boom, shot, get muted() { return muted; }, get state() { return ac ? ac.state : 'none'; } };
})();
