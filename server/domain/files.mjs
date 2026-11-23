import { writeFile, unlink, stat, open } from 'node:fs/promises';
import path from 'node:path';

// Armazenamento dos arquivos de mídia no disco (separado do banco). Nomes no disco são gerados pelo servidor.
export function createFileStore(mediaDir, logger) {
  const resolve = storageName => path.join(mediaDir, path.basename(storageName));
  return {
    path: resolve,
    write: (storageName, bytes) => writeFile(resolve(storageName), bytes, { mode: 0o600, flag: 'wx' }),
    open: storageName => open(resolve(storageName), 'r'),
    async size(storageName) { try { return (await stat(resolve(storageName))).size; } catch { return null; } },
    async remove(storageName) {
      try { await unlink(resolve(storageName)); } catch (error) {
        if (error.code !== 'ENOENT') logger?.warn('Não foi possível remover arquivo de mídia do disco', { storageName, code: error.code });
      }
    }
  };
}
