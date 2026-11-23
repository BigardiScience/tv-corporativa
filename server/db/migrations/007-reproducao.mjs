// Fase 2 (carrossel e reprodução): duas configurações novas, ambas com um padrão que reproduz exatamente o que a Fase 1 já fazia.
//
//   loop_enabled (playlists e versões publicadas)
//     1 = a sequência recomeça sem parar (o player sempre fez isso). 0 = a TV exibe a sequência uma vez e mantém o último conteúdo.
//   duration_mode (itens do rascunho e itens de versões publicadas)
//     'fixed'   = tempo definido em duration_s. Em vídeo, é um LIMITE: o vídeo que termina antes avança antes (como na Fase 1).
//     'natural' = o vídeo toca até o fim. Só vale para vídeo; duration_s continua guardado como valor de segurança.
//
// Nada que já existe muda de comportamento: playlists, versões e programações em uso continuam tocando do mesmo jeito.
// As versões publicadas continuam imutáveis: o gatilho de itens é recriado para proteger também a nova coluna.
export default {
  id: 7,
  name: 'reproducao-repeticao-e-duracao-natural',
  up(db) {
    db.exec(`
      ALTER TABLE playlists ADD COLUMN loop_enabled INTEGER NOT NULL DEFAULT 1 CHECK (loop_enabled IN (0, 1));
      ALTER TABLE playlist_versions ADD COLUMN loop_enabled INTEGER NOT NULL DEFAULT 1 CHECK (loop_enabled IN (0, 1));
      ALTER TABLE playlist_items ADD COLUMN duration_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (duration_mode IN ('fixed', 'natural'));
      ALTER TABLE playlist_version_items ADD COLUMN duration_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (duration_mode IN ('fixed', 'natural'));

      DROP TRIGGER playlist_version_items_immutable;
      -- Somente media_id pode mudar (vira NULL se o arquivo for excluído); o restante da versão é imutável.
      CREATE TRIGGER playlist_version_items_immutable
      BEFORE UPDATE OF version_id, position, title, name, type, duration_s, duration_mode, transition, transition_ms ON playlist_version_items
      BEGIN SELECT RAISE(ABORT, 'playlist_version_immutable'); END;
    `);

    const count = (table, where = '1=1') => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get().n;
    const playlists = count('playlists'), versions = count('playlist_versions'), items = count('playlist_items'), versionItems = count('playlist_version_items');
    // Conferência: todo registro antigo recebeu o padrão que preserva o comportamento anterior.
    if (count('playlists', 'loop_enabled=1') !== playlists || count('playlist_versions', 'loop_enabled=1') !== versions
      || count('playlist_items', "duration_mode='fixed'") !== items || count('playlist_version_items', "duration_mode='fixed'") !== versionItems) {
      throw new Error('os registros existentes não receberam os valores padrão da reprodução');
    }
    return { playlists, versions, items, versionItems };
  }
};
