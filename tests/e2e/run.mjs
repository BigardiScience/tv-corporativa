// Executa os cenários de ponta a ponta (navegador de verdade). Uso: npm run test:e2e   (opcional: nome parcial do cenário)
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] ?? '';
const files = readdirSync(here).filter(name => name.endsWith('.e2e.mjs') && name.includes(filter)).sort();
if (!files.length) { console.log('Nenhum cenário encontrado.'); process.exit(1); }
const results = [];
for (const name of files) results.push(await (await import(pathToFileURL(path.join(here, name)))).default());
const skipped = results.filter(item => item.skipped).length, failed = results.filter(item => item.ok === false).length;
console.log(`\n${results.length - skipped - failed} cenário(s) passaram, ${failed} falharam, ${skipped} ignorado(s).`);
process.exit(failed ? 1 : 0);
