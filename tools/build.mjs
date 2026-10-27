// 把 src/ 各段串成單一 index.html，並把喪屍圖集內嵌成 data URI（file:// 也能直接開）
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const parts = readdirSync(src).filter((f) => /^\d\d-/.test(f)).sort();
let out = parts.map((f) => readFileSync(join(src, f), 'utf8')).join('\n');
const atlas = readFileSync(join(root, 'art', 'sprites.png')).toString('base64');
const meta = readFileSync(join(root, 'art', 'sprites.json'), 'utf8');
out = out.replace('__SPRITES_URI__', 'data:image/png;base64,' + atlas).replace('__SPRITES_META__', meta);
writeFileSync(join(root, 'index.html'), out);
console.log(`index.html: ${parts.length} parts, ${out.split('\n').length} lines, ${(out.length / 1024).toFixed(1)} KB`);
