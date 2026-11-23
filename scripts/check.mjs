import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const collect = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? collect(file) : /\.(?:mjs|js)$/.test(entry.name) ? [file] : [];
});
const files = ['server', 'public', 'scripts', 'tests'].flatMap(dir => collect(path.join(root, dir))).sort();
let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) {
    failures++;
    console.error(`Falha de sintaxe: ${path.relative(root, file)}`);
    if (result.error) console.error(result.error.message);
  }
}
console.log(`${files.length} arquivos JavaScript verificados; ${failures} falhas.`);
process.exitCode = failures ? 1 : 0;
