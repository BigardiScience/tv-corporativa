const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// Registro operacional em JSON (uma linha por evento), para leitura por humanos e por ferramentas de log.
// Regra: nunca registrar senhas, tokens, cookies nem corpo de requisições. Quem chama passa só metadados.
export function createLogger({ level = 'info', sink = line => process.stdout.write(`${line}\n`) } = {}) {
  const minimum = LEVELS[level] ?? LEVELS.info;
  const write = (name, message, context = {}) => {
    if (LEVELS[name] < minimum) return;
    sink(JSON.stringify({ time: new Date().toISOString(), level: name, message, ...context }));
  };
  return { debug: (m, c) => write('debug', m, c), info: (m, c) => write('info', m, c), warn: (m, c) => write('warn', m, c), error: (m, c) => write('error', m, c) };
}

export const silentLogger = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });
