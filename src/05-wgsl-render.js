// ---------- WGSL：繪製 ----------
const WGSL_RCOMMON = WGSL_COMMON + /* wgsl */`
fn h21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2f(1.0, 0.0)), u.x), mix(h21(i + vec2f(0.0, 1.0)), h21(i + vec2f(1.0, 1.0)), u.x), u.y);
}
const SUN = vec3f(0.42, -0.55, 0.72);
`;

// 地面：依地表類型上色＋顆粒；作戰地圖時疊屍潮熱圖
const WGSL_GROUND = WGSL_RCOMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> U: R;
@group(0) @binding(1) var tmap: texture_2d<u32>;
@group(0) @binding(2) var<storage, read> coarse: array<u32>;
@group(0) @binding(3) var<storage, read> pile: array<f32>;
@group(0) @binding(4) var dtex: texture_2d<u32>;
struct VO { @builtin(position) pos: vec4f, @location(0) wp: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  var q = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let wp = q[vi] * (f32(WN) + 5000.0) - 2500.0;
  var o: VO;
  o.pos = U.vp * vec4f(wp, 0.0, 1.0);
  o.wp = wp;
  return o;
}
fn typeAt(c: vec2i) -> u32 {
  if (c.x < 0 || c.y < 0 || c.x >= i32(WN) || c.y >= i32(WN)) { return select(3u, 2u, c.y < 300); }
  return textureLoad(tmap, c, 0).r;
}
fn Cn(c: vec2i) -> f32 {
  let q = clamp(c, vec2i(0), vec2i(i32(NN) - 1));
  return f32(coarse[u32(q.y) * NN + u32(q.x)]);
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let p = i.wp;
  let c = vec2i(floor(p));
  let t = typeAt(c);
  let gq = floor(p * 3.0);
  let n = h21(gq);
  let big = vnoise(p * 0.045);
  var col: vec3f;
  switch t {
    case 0u: { col = vec3f(0.19, 0.20, 0.22) * (0.9 + 0.12 * n + 0.1 * big); }
    case 2u: {
      let w = vnoise(vec2f(p.x * 0.08 + U.misc.x * 0.15, p.y * 0.25 - U.misc.x * 0.05));
      col = mix(vec3f(0.05, 0.14, 0.2), vec3f(0.08, 0.22, 0.28), step(0.62, w)) * (0.95 + 0.05 * n);
    }
    case 3u: { col = mix(vec3f(0.17, 0.26, 0.12), vec3f(0.22, 0.31, 0.14), step(0.55, vnoise(p * 0.3))) * (0.9 + 0.15 * n); }
    case 4u: {
      let tile = step(0.1, fract(p.x / 1.5)) * step(0.1, fract(p.y / 1.5));
      col = vec3f(0.42, 0.41, 0.39) * (0.86 + 0.1 * tile + 0.06 * n);
    }
    case 5u: { col = vec3f(0.33, 0.33, 0.32) * (0.88 + 0.1 * n + 0.08 * big); }
    case 6u: { col = vec3f(0.62, 0.55, 0.4) * (0.92 + 0.1 * n); }
    case 7u: { col = vec3f(0.45, 0.44, 0.4); }
    case 8u: { col = vec3f(0.62, 0.55, 0.28) * (0.9 + 0.1 * n); }
    default: { col = vec3f(0.2, 0.2, 0.2); }
  }
  // 建築在南側投下的短影（太陽在東南上方）
  if (t != 1u && t != 2u) {
    if (typeAt(c + vec2i(-1, 1)) == 1u || typeAt(c + vec2i(-2, 2)) == 1u) { col *= 0.72; }
  }
  // 屍堆：越高越偏暗紅肉色
  if (all(c >= vec2i(0)) && all(c < vec2i(i32(WN)))) {
    let pl = pile[u32(c.y) * WN + u32(c.x)];
    if (pl > 0.05) { col = mix(col, vec3f(0.26, 0.12, 0.1) * (0.8 + 0.3 * n), clamp(0.25 + pl / 3.0, 0.0, 0.85)); }
  }
  // 屍潮熱圖（每平方公尺密度，對數色階）
  let hs = U.misc.z;
  if (hs > 0.001 && all(p >= vec2f(0.0)) && all(p < vec2f(f32(WN)))) {
    let q = p / CELL - 0.5; let cc = vec2i(floor(q)); let f = q - floor(q);
    let d = mix(mix(Cn(cc), Cn(cc + vec2i(1, 0)), f.x), mix(Cn(cc + vec2i(0, 1)), Cn(cc + vec2i(1, 1)), f.x), f.y) / (CELL * CELL);
    let base = mix(col, vec3f(dot(col, vec3f(0.33))) * 0.55, hs * 0.85);
    let l = clamp(log2(1.0 + d * 8.0) / 5.2, 0.0, 1.0);
    let heat = mix(mix(vec3f(0.35, 0.03, 0.04), vec3f(0.95, 0.25, 0.05), smoothstep(0.0, 0.55, l)), vec3f(1.0, 0.92, 0.55), smoothstep(0.55, 1.0, l));
    col = mix(base, heat, hs * smoothstep(0.02, 0.25, l) * 0.9);
    // 區域：狀態填色＋邊界（一個畫面像素寬）
    let dn = vec2i(clamp(floor(p / CELL), vec2f(0.0), vec2f(f32(NN) - 1.0)));
    let did = textureLoad(dtex, dn, 0).r;
    if (did < 16u) {
      let dc = U.dcol[did];
      col = mix(col, dc.rgb, hs * dc.a * 0.22);
      let e = 1.2 / max(U.misc.y, 0.05);
      let ida = textureLoad(dtex, vec2i(clamp(floor((p + vec2f(e, 0.0)) / CELL), vec2f(0.0), vec2f(f32(NN) - 1.0))), 0).r;
      let idb = textureLoad(dtex, vec2i(clamp(floor((p + vec2f(0.0, e)) / CELL), vec2f(0.0), vec2f(f32(NN) - 1.0))), 0).r;
      if ((ida != did && ida < 16u) || (idb != did && idb < 16u)) { col = mix(col, vec3f(0.92, 0.94, 0.96), hs * 0.75); }
    }
  }
  if (any(p < vec2f(0.0)) || any(p >= vec2f(f32(WN)))) { col *= 0.5; }  // 世界外壓暗
  return vec4f(col, 1.0);
}
`;

// 建築：立方體擠出（頂面＋四面），窗戶與屋頂細節在片段著色器裡畫
const WGSL_BLD = WGSL_RCOMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> U: R;
@group(0) @binding(1) var<storage, read> bld: array<vec4f>;
struct BO {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) @interpolate(flat) nrm: vec3f,
  @location(2) @interpolate(flat) bdata: vec4f,
  @location(3) @interpolate(flat) rect: vec4f,
  @location(4) uv: vec2f,
};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> BO {
  let r = bld[ii * 2u]; let m = bld[ii * 2u + 1u]; let h = m.x;
  let face = vi / 6u;
  var quad = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let q = quad[vi % 6u];
  var wp: vec3f; var n: vec3f; var uv: vec2f;
  switch face {
    case 0u: { wp = vec3f(mix(r.x, r.z, q.x), mix(r.y, r.w, q.y), h); n = vec3f(0.0, 0.0, 1.0); uv = wp.xy; }
    case 1u: { wp = vec3f(mix(r.x, r.z, q.x), r.y, q.y * h); n = vec3f(0.0, -1.0, 0.0); uv = vec2f(wp.x - r.x, wp.z); }
    case 2u: { wp = vec3f(mix(r.z, r.x, q.x), r.w, q.y * h); n = vec3f(0.0, 1.0, 0.0); uv = vec2f(r.z - wp.x, wp.z); }
    case 3u: { wp = vec3f(r.x, mix(r.w, r.y, q.x), q.y * h); n = vec3f(-1.0, 0.0, 0.0); uv = vec2f(r.w - wp.y, wp.z); }
    default: { wp = vec3f(r.z, mix(r.y, r.w, q.x), q.y * h); n = vec3f(1.0, 0.0, 0.0); uv = vec2f(wp.y - r.y, wp.z); }
  }
  var o: BO;
  o.pos = U.vp * vec4f(wp, 1.0);
  o.wp = wp; o.nrm = n; o.bdata = m; o.rect = r; o.uv = uv;
  return o;
}
// 混凝土 T 牆：1.5 m 一片、接縫、頂緣亮、底部暗；預覽用棋盤格抖動當半透明
fn wallCol(i: BO) -> vec4f {
  if (i.bdata.z > 1.5) {
    if (((u32(i.pos.x) + u32(i.pos.y)) & 1u) == 0u) { discard; }
    return vec4f(select(vec3f(0.35, 0.85, 1.0), vec3f(1.0, 0.35, 0.3), i.bdata.w > 0.5), 1.0);
  }
  let diff = max(dot(i.nrm, normalize(SUN)), 0.0);
  var col = vec3f(0.6, 0.59, 0.54);
  // 受損：w＝0..1，越破越多裂痕和缺角（世界座標的雜訊，相鄰牆板接得起來）
  let dmg = i.bdata.w;
  if (dmg > 0.02) {
    let cn = h21(floor(vec2f(i.wp.x + i.wp.y * 0.7, i.wp.z) * 3.0));
    if (cn < dmg * 0.5) { col *= 0.42; }
    col *= 1.0 - dmg * 0.22;
  }
  if (i.nrm.z > 0.5) {
    let along = select(i.wp.y, i.wp.x, i.rect.z - i.rect.x > i.rect.w - i.rect.y);
    if (fract(along / 1.5) < 0.08) { col *= 0.7; }
    col *= 1.08;
  } else {
    if (fract(i.uv.x / 1.5) < 0.07) { col *= 0.6; }
    col *= 0.86 + 0.14 * h21(vec2f(floor(i.uv.x / 1.5), i.bdata.y * 13.0));
    if (i.uv.y > i.bdata.x - 0.35) { col *= 1.18; }
    if (i.uv.y < 0.5) { col *= 0.72; }
  }
  return vec4f(col * (0.5 + 0.6 * diff), 1.0);
}
@fragment fn fs(i: BO) -> @location(0) vec4f {
  if (i.bdata.z > 0.5) { return wallCol(i); }
  let seedv = i.bdata.y; let h = i.bdata.x;
  let k = u32(seedv * 7.0);
  var pal = array<vec3f, 7>(vec3f(0.55, 0.5, 0.44), vec3f(0.5, 0.33, 0.27), vec3f(0.45, 0.47, 0.5), vec3f(0.62, 0.6, 0.55),
                            vec3f(0.36, 0.4, 0.45), vec3f(0.58, 0.52, 0.4), vec3f(0.42, 0.38, 0.36));
  var base = pal[min(k, 6u)];
  let tall = h > 24.0;
  if (tall) { base = mix(base, vec3f(0.36, 0.42, 0.5), 0.55); }
  let diff = max(dot(i.nrm, normalize(SUN)), 0.0);
  var col: vec3f;
  if (i.nrm.z > 0.5) {
    // 屋頂：女兒牆、冷氣機、通風口
    let r = i.rect;
    let e = min(min(i.wp.x - r.x, r.z - i.wp.x), min(i.wp.y - r.y, r.w - i.wp.y));
    col = base * 0.62;
    let cell = floor(i.wp.xy / 3.0);
    if (h21(cell + seedv * 91.0) > 0.86 && e > 2.0) {
      let f = fract(i.wp.xy / 3.0);
      if (f.x > 0.15 && f.x < 0.75 && f.y > 0.2 && f.y < 0.8) { col = vec3f(0.55, 0.56, 0.56); }
    }
    if (e < 0.7) { col = base * 0.95; }
    if (e < 0.25) { col = base * 0.4; }
    col *= 0.85 + 0.3 * diff;
  } else {
    col = base * (0.42 + 0.62 * diff);
    // 窗戶：每層 3.4 m、每 3 m 一扇
    let fl = i.uv.y / 3.4;
    let fx = fract(i.uv.x / 3.0);
    let fy = fract(fl);
    if (i.uv.y > 3.0 && i.uv.y < h - 1.0 && fx > 0.2 && fx < 0.8 && fy > 0.3 && fy < 0.78) {
      let lit = h21(vec2f(floor(i.uv.x / 3.0), floor(fl)) + seedv * 57.0);
      var g = vec3f(0.12, 0.15, 0.19);
      if (tall) { g = vec3f(0.16, 0.22, 0.3); }
      let nightF = U.atlas2.z;
      if (lit > mix(0.93, 0.78, nightF)) { g = mix(vec3f(0.55, 0.45, 0.25), vec3f(1.0, 0.82, 0.45), nightF); }
      col = mix(col, g, 0.85) * select(0.7 + 0.5 * diff, 1.0, lit > mix(0.93, 0.78, nightF) && nightF > 0.3);
    }
    if (i.uv.y < 3.0) { col *= 0.7; }  // 一樓店面
    if (i.uv.y > h - 0.6) { col *= 1.15; }
  }
  return vec4f(col, 1.0);
}
`;

// 喪屍：從 visible 清單拿編號，畫成面向鏡頭的像素精靈；死掉的畫成倒地屍體
const WGSL_AGENT = WGSL_RCOMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> U: R;
@group(0) @binding(1) var<storage, read> agents: array<vec4f>;
@group(0) @binding(2) var<storage, read> info: array<vec2u>;
@group(0) @binding(3) var<storage, read> visible: array<u32>;
@group(0) @binding(4) var atlasTex: texture_2d<f32>;
@group(0) @binding(5) var tmap: texture_2d<u32>;
@group(0) @binding(6) var<storage, read> pile: array<f32>;
struct AO {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) d: vec4u,   // 狀態, 雜湊, 方向列, 影格
  @location(2) @interpolate(flat) f: vec4f,   // 年齡
};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> AO {
  let i = visible[ii];
  let a = agents[i];
  let inf = info[i];
  let st = inf.x & 3u;
  let h = pcg(i * 3u + 17u);
  let brute = st == 1u && ((h >> 20u) & 1023u) < ${BRUTE_K}u;
  var quad = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let q = quad[vi];
  var o: AO;
  var age = 0.0;
  var row = 0u; var frame = 0u;
  let aw = U.atlas.x; let ah = U.atlas.y;
  let spriteH = select(1.95, 2.9, brute);
  let spriteW = spriteH * aw / ah;
  let cc = clamp(vec2i(floor(a.xy)), vec2i(0), vec2i(i32(WN) - 1));
  var z = pile[u32(cc.y) * WN + u32(cc.x)];
  if (textureLoad(tmap, cc, 0).r == 7u) { z = WALL_H; }
  if (st == 2u) {
    age = U.misc.x - bitcast<f32>(inf.y);
    let c = vec3f(a.xy, z) + U.back.xyz * 0.8;
    let wp = c + U.right.xyz * (q.x - 0.5) * U.sizes.x + U.up.xyz * (q.y - 0.5) * U.sizes.y;
    o.pos = U.vp * vec4f(wp, 1.0);
    row = (h >> 4u) & 7u;
    frame = (h >> 7u) & 1u;
  } else {
    let v = a.zw;
    let sp = length(v);
    // 方向：0 下（朝鏡頭）1 左 2 右 3 上（背對）
    if (abs(v.x) > abs(v.y) * 1.2) { row = select(2u, 1u, v.x < 0.0); } else { row = select(0u, 3u, v.y > 0.0); }
    if (sp < 0.05) { row = 0u; }
    let ph = U.misc.x * (select(1.2, 0.7, brute) + sp * 2.6) + f32(h & 255u) / 64.0;
    frame = u32(ph) % u32(U.atlas.w);
    // 深度當成「站在腳底的直立卡片」：螢幕上越高的像素越靠近鏡頭（tan(俯角) 倍），
    // 貼牆站的不會被牆切掉，站在建築後面的照樣被擋住。往鏡頭方向位移在正交投影下不改變畫面位置。
    let foot = vec3f(a.xy, z) + U.back.xyz * 0.3;
    let sv = (q.y - U.atlas.z / ah) * spriteH;
    let kd = min(tan(U.misc.w), 2.5);
    let wp = foot + U.right.xyz * (q.x - 0.5) * spriteW + U.up.xyz * sv + U.back.xyz * (max(sv, 0.0) * kd);
    o.pos = U.vp * vec4f(wp, 1.0);
  }
  o.uv = q;
  o.d = vec4u(st, h, row, frame);
  o.f = vec4f(age, select(0.0, 1.0, brute), 0.0, 0.0);
  return o;
}
fn hue(c: vec3f, l: f32) -> vec3f { return c * l * 1.75; }
// 依材質群組換顏色（活的和屍體共用，同一隻換一樣的衣服）
fn recolor(tx: vec4f, h: u32) -> vec3f {
  let grp = u32(round((1.0 - tx.a) * 255.0 / 8.0));
  var col = tx.rgb;
  let l = dot(col, vec3f(0.3, 0.55, 0.15));
  let vr = (h >> 12u);
  var tops = array<vec3f, 10>(vec3f(0.42, 0.4, 0.42), vec3f(0.42, 0.2, 0.18), vec3f(0.22, 0.26, 0.36), vec3f(0.3, 0.33, 0.24),
                              vec3f(0.44, 0.4, 0.32), vec3f(0.52, 0.52, 0.5), vec3f(0.17, 0.18, 0.24), vec3f(0.44, 0.41, 0.24),
                              vec3f(0.34, 0.25, 0.2), vec3f(0.24, 0.24, 0.25));
  var pants = array<vec3f, 5>(vec3f(0.14, 0.2, 0.38), vec3f(0.12, 0.12, 0.13), vec3f(0.3, 0.24, 0.16), vec3f(0.36, 0.33, 0.24), vec3f(0.2, 0.26, 0.2));
  let tk = vr % 10u;
  if (grp == 3u && tk != 0u) { col = hue(tops[tk], l); }
  if (grp == 4u) { let pk = (vr / 10u) % 5u; if (pk != 0u) { col = hue(pants[pk], l); } }
  if (grp == 2u) { col *= mix(vec3f(1.0), vec3f(0.82, 0.95, 0.78), f32((vr >> 6u) & 3u) / 3.0); }
  return col;
}
@fragment fn fs(i: AO) -> @location(0) vec4f {
  let h = i.d.y;
  if (i.d.x == 2u) {
    // 屍體：8 種姿勢（左右隨機鏡像），最後 6 秒用抖動淡出
    let cw = i32(U.catlas.x); let ch = i32(U.catlas.y);
    var ux = i.uv.x;
    if (((h >> 3u) & 1u) == 1u) { ux = 1.0 - ux; }
    let lx = clamp(i32(ux * f32(cw)), 0, cw - 1);
    let ly = clamp(i32((1.0 - i.uv.y) * f32(ch)), 0, ch - 1);
    let k = i.d.z;
    let tx = textureLoad(atlasTex, vec2i(i32(U.catlas.z) + i32(k % 4u) * cw + lx, i32(U.catlas.w) + i32(k / 4u % 2u) * ch + ly), 0);
    if (tx.a < 0.01) { discard; }
    let rem = ${CORPSE_TIME.toFixed(1)} - i.f.x;
    if (rem < 6.0 && h21(vec2f(f32(lx), f32(ly)) + f32(h & 255u)) > rem / 6.0) { discard; }
    return vec4f(recolor(tx, h) * 0.85, 1.0);
  }
  let cw = i32(U.atlas.x); let ch = i32(U.atlas.y);
  let lx = clamp(i32(i.uv.x * f32(cw)), 0, cw - 1);
  let ly = clamp(i32((1.0 - i.uv.y) * f32(ch)), 0, ch - 1);
  let tx = textureLoad(atlasTex, vec2i(i32(U.atlas2.x) + i32(i.d.w) * cw + lx, i32(U.atlas2.y) + i32(i.d.z) * ch + ly), 0);
  if (tx.a < 0.01) { discard; }
  if (i.f.y > 0.5) {
    // 破牆者：灰白腫脹的皮膚、深色衣服
    let grp = u32(round((1.0 - tx.a) * 255.0 / 8.0));
    var c = tx.rgb;
    let l = dot(c, vec3f(0.3, 0.55, 0.15));
    if (grp == 2u) { c = vec3f(0.78, 0.8, 0.72) * (0.35 + l * 1.1); } else if (grp == 3u || grp == 4u) { c = vec3f(0.22, 0.2, 0.2) * (0.6 + l); }
    return vec4f(c, 1.0);
  }
  return vec4f(recolor(tx, h), 1.0);
}
`;

// 地面標記：信標、砲擊預警、爆炸閃光、焦痕
const WGSL_MARK = WGSL_RCOMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> U: R;
@group(0) @binding(1) var<storage, read> mk: array<vec4f>;
struct MO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) a: vec4f, @location(2) @interpolate(flat) b: vec4f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> MO {
  let a = mk[ii * 2u]; let b = mk[ii * 2u + 1u];
  var quad = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let q = quad[vi];
  var o: MO;
  o.pos = U.vp * vec4f(a.xy + q * a.z, 0.06, 1.0);
  o.uv = q; o.a = a; o.b = b;
  return o;
}
@fragment fn fs(i: MO) -> @location(0) vec4f {
  let r = length(i.uv);
  let typ = u32(i.a.w);
  let px = 1.0 / max(i.a.z * U.misc.y, 1.0);   // 一個內部像素在 uv 裡的寬度
  let w = max(px * 1.2, 0.004);
  var al = 0.0;
  if (typ == 0u) { al = step(abs(r - 0.92), w) + step(abs(r - 0.55), w) * 0.5 * step(0.5, fract(atan2(i.uv.y, i.uv.x) * 3.0)); }
  else if (typ == 1u) {
    let pulse = 0.6 + 0.4 * sin(U.misc.x * 14.0);
    al = (step(abs(r - 0.96), w) + step(abs(r - i.b.w), w) + (step(abs(i.uv.x), w) + step(abs(i.uv.y), w)) * step(r, 0.25)) * pulse;
  }
  else if (typ == 2u) { al = smoothstep(1.0, 0.2, r) * i.b.w; }
  else { al = step(r, 0.85 + 0.12 * h21(floor(i.uv * 10.0))) * (0.5 + 0.3 * h21(floor(i.uv * 7.0) + 3.0)) * i.b.w; }
  if (al < 0.01) { discard; }
  return vec4f(i.b.rgb, clamp(al, 0.0, 1.0));
}
`;

// 爆炸：8 格動畫 billboard，腳底貼地，不受光（自發光）
const WGSL_FX = WGSL_RCOMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> U: R;
@group(0) @binding(1) var<storage, read> fx: array<vec4f>;   // x, y, 寬(m), 開始時間
@group(0) @binding(2) var atlasTex: texture_2d<f32>;
struct FO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) fr: u32 };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FO {
  let e = fx[ii];
  var quad = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let q = quad[vi];
  let age = U.misc.x - e.w;
  var o: FO;
  let foot = vec3f(e.xy, 0.0) + U.back.xyz * 1.0;
  let sv = (q.y - 0.04) * e.z * U.sizes.z;
  let wp = foot + U.right.xyz * (q.x - 0.5) * e.z + U.up.xyz * sv + U.back.xyz * (max(sv, 0.0) * min(tan(U.misc.w), 2.5));
  o.pos = U.vp * vec4f(wp, 1.0);
  o.uv = q;
  o.fr = u32(max(age, 0.0) / 0.14);
  return o;
}
@fragment fn fs(i: FO) -> @location(0) vec4f {
  if (i.fr >= 8u) { discard; }
  let cw = i32(U.fatlas.x); let ch = i32(U.fatlas.y);
  let lx = clamp(i32(i.uv.x * f32(cw)), 0, cw - 1);
  let ly = clamp(i32((1.0 - i.uv.y) * f32(ch)), 0, ch - 1);
  let tx = textureLoad(atlasTex, vec2i(i32(U.fatlas.z) + i32(i.fr % 4u) * cw + lx, i32(U.fatlas.w) + i32(i.fr / 4u) * ch + ly), 0);
  if (tx.a < 0.5) { discard; }
  return vec4f(tx.rgb, 1.0);
}
`;

// 單位：每個實例 3 個 vec4 —— (x, y, z, 寬m) (高m, 圖集x, 圖集y, 種類) (格寬, 格高, 透明度, 旗標)
// 種類 0 機身／載具（面向鏡頭、中心錨點）、1 地面影子、2 旋翼（水平圓盤）、3 吊掛的喪屍、4 曳光彈（a.xyz→b.xyz，a.w 像素寬，c＝顏色）、
// 5 地面人物（腳底錨點、直立卡片深度，跟喪屍一樣）；旗標 bit0 左右翻、bit1 閃紅
const WGSL_UNITS = WGSL_RCOMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> U: R;
@group(0) @binding(1) var<storage, read> un: array<vec4f>;
@group(0) @binding(2) var atlasTex: texture_2d<f32>;
struct UO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) b: vec4f, @location(2) @interpolate(flat) c: vec4f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> UO {
  let a = un[ii * 3u]; let b = un[ii * 3u + 1u]; let c = un[ii * 3u + 2u];
  var quad = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let q = quad[vi];
  let kind = u32(b.w);
  var wp: vec3f;
  var o: UO;
  if (kind == 4u) {
    let c0 = U.vp * vec4f(a.xyz, 1.0); let c1 = U.vp * vec4f(b.xyz, 1.0);
    var d = (c1.xy - c0.xy) * U.view.xy;
    d = select(vec2f(1.0, 0.0), normalize(d), dot(d, d) > 1e-6);
    let perp = vec2f(-d.y, d.x) * a.w / U.view.xy;
    var cp = mix(c0, c1, q.x);
    cp = vec4f(cp.xy + perp * (q.y - 0.5) * 2.0, cp.z - 0.0005, cp.w);
    o.pos = cp; o.uv = q; o.b = b; o.c = c;
    return o;
  }
  if (kind == 1u || kind == 2u) {
    wp = vec3f(a.xy + (q - 0.5) * vec2f(a.w, b.x), a.z);              // 水平面
  } else if (kind == 5u) {
    let sv = q.y * b.x;
    wp = vec3f(a.x, a.y, a.z) + U.back.xyz * 0.3 + U.right.xyz * (q.x - 0.5) * a.w + U.up.xyz * sv + U.back.xyz * (sv * min(tan(U.misc.w), 2.5));
  } else {
    wp = vec3f(a.x, a.y, a.z) + U.right.xyz * (q.x - 0.5) * a.w + U.up.xyz * (q.y - 0.5) * b.x + U.back.xyz * 1.5;
  }
  o.pos = U.vp * vec4f(wp, 1.0);
  o.uv = q; o.b = b; o.c = c;
  return o;
}
@fragment fn fs(i: UO) -> @location(0) vec4f {
  let kind = u32(i.b.w);
  let flags = u32(i.c.w);
  if (kind == 4u) { return i.c; }
  if (kind == 1u) {
    let r = length(floor((i.uv - 0.5) * 24.0) / 12.0);
    if (r > 1.0) { discard; }
    return vec4f(0.0, 0.0, 0.0, i.c.z * (1.0 - r * r * 0.6));
  }
  if (kind == 2u) {
    let p = (i.uv - 0.5) * 2.0;
    let r = length(p);
    if (r > 1.0) { discard; }
    let ang = atan2(p.y, p.x) - U.misc.x * 31.0;
    let blade = pow(abs(cos(ang)), 60.0);
    return vec4f(0.12, 0.13, 0.12, i.c.z * (0.16 + 0.55 * blade) * smoothstep(1.0, 0.85, r));
  }
  var ux = i.uv.x;
  if ((flags & 1u) != 0u) { ux = 1.0 - ux; }
  let cw = i32(i.c.x); let ch = i32(i.c.y);
  let lx = clamp(i32(ux * f32(cw)), 0, cw - 1);
  let ly = clamp(i32((1.0 - i.uv.y) * f32(ch)), 0, ch - 1);
  let tx = textureLoad(atlasTex, vec2i(i32(i.b.y) + lx, i32(i.b.z) + ly), 0);
  if (tx.a < 0.01) { discard; }
  var col = tx.rgb;
  if ((flags & 2u) != 0u && fract(U.misc.x * 6.0) < 0.5) { col = mix(col, vec3f(1.0, 0.2, 0.15), 0.45); }
  return vec4f(col, i.c.z);
}
`;

// 低解析度畫面放大到 canvas（最近鄰）＋輕微暗角
const WGSL_BLIT = /* wgsl */`
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> ps: vec4f;     // 放大倍數, 夜晚程度, 黃昏程度, 外框強度
@group(0) @binding(2) var dep: texture_depth_2d;
@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(p[vi], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dim = vec2i(textureDimensions(src));
  let c = clamp(vec2i(floor(fc.xy / ps.x)), vec2i(0), dim - 1);
  var col = textureLoad(src, c, 0).rgb;
  // 像素外框：鄰居比自己遠 8 m 以上（建築邊緣、屋頂邊）→ 壓暗這一格
  let d0 = textureLoad(dep, c, 0);
  let dn = max(max(textureLoad(dep, min(c + vec2i(1, 0), dim - 1), 0), textureLoad(dep, max(c - vec2i(1, 0), vec2i(0)), 0)),
               max(textureLoad(dep, min(c + vec2i(0, 1), dim - 1), 0), textureLoad(dep, max(c - vec2i(0, 1), vec2i(0)), 0)));
  if (dn - d0 > 0.0013) { col *= 1.0 - 0.42 * ps.w; }
  // 日夜：黃昏偏橘、夜晚偏藍變暗；很亮的東西（火光、曳光彈、亮著的窗）不跟著變暗
  let lum = dot(col, vec3f(0.3, 0.59, 0.11));
  var g = mix(vec3f(1.0), vec3f(1.06, 0.84, 0.7), ps.z);
  g = mix(g, vec3f(0.33, 0.41, 0.66), ps.y);
  col = mix(col * g, col * 1.1, smoothstep(0.5, 0.85, lum) * ps.y);
  let uv = fc.xy / (vec2f(dim) * ps.x) - 0.5;
  col *= 1.0 - dot(uv, uv) * 0.35;
  col = pow(col, vec3f(0.95));
  return vec4f(col, 1.0);
}
`;
