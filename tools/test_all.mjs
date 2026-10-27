// 一次跑完全部有頭測試（每組開一個 Chrome 視窗，依序跑），最後印總表。用法：node tools/test_all.mjs
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const here = dirname(fileURLToPath(import.meta.url));
const suites = ['headed', 'headed_m2', 'headed_m3', 'headed_m4', 'headed_m5', 'headed_m6', 'headed_m7', 'headed_m8', 'headed_m9', 'headed_m10', 'headed_m11', 'headed_m12', 'headed_m13', 'headed_m14', 'headed_m15', 'headed_m16', 'headed_m17'];
let pass = 0, total = 0;
const rows = [];
for (const s of suites) {
  const r = spawnSync(process.execPath, [join(here, s + '.mjs')], { encoding: 'utf8', timeout: 900000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/SUMMARY (\d+)\/(\d+)/);
  const fails = out.split('\n').filter((l) => l.startsWith('FAIL'));
  if (m) { pass += +m[1]; total += +m[2]; }
  rows.push(`${s.padEnd(11)} ${m ? `${m[1]}/${m[2]}` : 'CRASH'}${fails.length ? '\n    ' + fails.join('\n    ') : ''}`);
  console.log(rows[rows.length - 1]);
}
console.log(`\nTOTAL ${pass}/${total}${pass === total ? ' — all passed' : ''}`);
process.exit(pass === total ? 0 : 1);
