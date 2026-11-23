import { fail } from './errors.mjs';

// Limitador em memória (por processo). Mesma regra da versão 1.1.0: janela fixa por chave.
export function createLimiter() {
  const rates = new Map();
  return function limit(key, max, ms) {
    const current = Date.now();
    if (rates.size > 5000) for (const [k, v] of rates) if (v.until < current) rates.delete(k);
    const entry = rates.get(key);
    if (!entry || entry.until < current) { rates.set(key, { count: 1, until: current + ms }); return; }
    if (entry.count >= max) fail(429, 'Muitas tentativas. Aguarde alguns minutos.');
    entry.count++;
  };
}
