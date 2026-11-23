import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

// Verificação antimalware por programa externo (ex.: clamscan). Retorna 'clean', 'not_configured' ou lança erro.
export function createScanner(command) {
  return {
    configured: !!command,
    async scan(file) {
      if (!command) return 'not_configured';
      await runFile(command, ['--no-summary', '--infected', file], { timeout: 120000, maxBuffer: 64 * 1024, windowsHide: true });
      return 'clean';
    }
  };
}
