import { randomUUID } from 'node:crypto';
import { legacyRecords, countOf } from './legacy.mjs';

// Playlist (o QUE tocar) e Programação (QUANDO e ONDE) passam a ser estruturas distintas.
// Na 1.1.0 ambos eram um único registro "playlist". Cada um deles vira:
//   1 playlist (com a versão 1 publicada) + 1 programação que fixa essa versão.
// O identificador antigo é mantido na programação, então a trilha de auditoria continua apontando para ela.
export default {
  id: 5,
  name: 'playlists-e-programacoes',
  up(db) {
    db.exec(`
      CREATE TABLE playlists(
        id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL REFERENCES units(id),
        sector_id TEXT NOT NULL REFERENCES sectors(id),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        draft_rev INTEGER NOT NULL DEFAULT 1,
        published_rev INTEGER NOT NULL DEFAULT 0,
        latest_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, created_by TEXT,
        updated_at TEXT NOT NULL, updated_by TEXT
      );
      CREATE INDEX playlists_scope ON playlists(unit_id, sector_id);

      CREATE TABLE playlist_items(
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        media_id TEXT NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
        duration_s INTEGER NOT NULL CHECK (duration_s BETWEEN 5 AND 3600),
        transition TEXT NOT NULL DEFAULT 'cut' CHECK (transition IN ('cut', 'fade', 'dissolve', 'slide', 'zoom')),
        transition_ms INTEGER NOT NULL DEFAULT 0 CHECK (transition_ms BETWEEN 0 AND 3000),
        UNIQUE(playlist_id, position)
      );
      CREATE INDEX playlist_items_media ON playlist_items(media_id);

      CREATE TABLE playlist_versions(
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        version INTEGER NOT NULL CHECK (version >= 1),
        note TEXT NOT NULL DEFAULT '',
        published_at TEXT NOT NULL, published_by TEXT,
        UNIQUE(playlist_id, version)
      );

      -- Itens de uma versão publicada: imutáveis, com cópia de título/nome/tipo para o histórico
      -- continuar legível mesmo que o arquivo seja excluído depois (media_id vira NULL).
      CREATE TABLE playlist_version_items(
        version_id TEXT NOT NULL REFERENCES playlist_versions(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
        title TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
        duration_s INTEGER NOT NULL,
        transition TEXT NOT NULL, transition_ms INTEGER NOT NULL,
        PRIMARY KEY(version_id, position)
      );
      CREATE INDEX playlist_version_items_media ON playlist_version_items(media_id);

      CREATE TRIGGER playlist_versions_immutable BEFORE UPDATE ON playlist_versions
      BEGIN SELECT RAISE(ABORT, 'playlist_version_immutable'); END;

      -- Somente media_id pode mudar (vira NULL se o arquivo for excluído); o restante da versão é imutável.
      CREATE TRIGGER playlist_version_items_immutable
      BEFORE UPDATE OF version_id, position, title, name, type, duration_s, transition, transition_ms ON playlist_version_items
      BEGIN SELECT RAISE(ABORT, 'playlist_version_immutable'); END;

      CREATE TABLE schedules(
        id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL REFERENCES units(id),
        sector_id TEXT NOT NULL REFERENCES sectors(id),
        name TEXT NOT NULL,
        playlist_id TEXT NOT NULL,
        playlist_version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'stopped')),
        start_at TEXT, end_at TEXT,
        rev INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, created_by TEXT,
        updated_at TEXT NOT NULL, updated_by TEXT,
        published_at TEXT, published_by TEXT,
        stopped_at TEXT, stopped_by TEXT,
        FOREIGN KEY (playlist_id, playlist_version) REFERENCES playlist_versions(playlist_id, version) ON DELETE CASCADE,
        FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
      );
      CREATE INDEX schedules_scope ON schedules(unit_id, sector_id, status);
      CREATE INDEX schedules_playlist ON schedules(playlist_id, playlist_version);

      CREATE TABLE schedule_displays(
        schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
        display_id TEXT NOT NULL REFERENCES displays(id) ON DELETE CASCADE,
        PRIMARY KEY (schedule_id, display_id)
      );
      CREATE INDEX schedule_displays_display ON schedule_displays(display_id);
    `);

    const legacy = legacyRecords(db, 'playlists');
    const mediaExists = db.prepare('SELECT title, name, type, unit_id, sector_id FROM media WHERE id=?');
    const displayExists = db.prepare('SELECT 1 AS ok FROM displays WHERE id=?');
    const insertPlaylist = db.prepare(`INSERT INTO playlists(id, unit_id, sector_id, name, draft_rev, published_rev, latest_version, created_at, created_by, updated_at, updated_by)
      VALUES(?,?,?,?,1,1,1,?,?,?,?)`);
    const insertItem = db.prepare('INSERT INTO playlist_items(id, playlist_id, position, media_id, duration_s, transition, transition_ms) VALUES(?,?,?,?,?,?,?)');
    const insertVersion = db.prepare('INSERT INTO playlist_versions(id, playlist_id, version, note, published_at, published_by) VALUES(?,?,1,?,?,?)');
    const insertVersionItem = db.prepare(`INSERT INTO playlist_version_items(version_id, position, media_id, title, name, type, duration_s, transition, transition_ms)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    const insertSchedule = db.prepare(`INSERT INTO schedules(id, unit_id, sector_id, name, playlist_id, playlist_version, status, start_at, end_at, rev,
      created_at, created_by, updated_at, updated_by, published_at, published_by) VALUES(?,?,?,?,?,1,?,?,?,1,?,?,?,?,?,?)`);
    const insertLink = db.prepare('INSERT OR IGNORE INTO schedule_displays(schedule_id, display_id) VALUES(?,?)');

    const skipped = [];
    let playlists = 0, schedules = 0, links = 0, items = 0, over6 = 0, over15 = 0;
    for (const p of legacy) {
      const createdAt = typeof p.createdAt === 'string' ? p.createdAt : new Date(0).toISOString();
      const duration = Number.isInteger(p.duration) ? Math.min(3600, Math.max(5, p.duration)) : 15;
      const media = [];
      for (const id of Array.isArray(p.mediaIds) ? p.mediaIds : []) {
        const m = mediaExists.get(id);
        if (m) media.push({ id, ...m });
      }
      if (!media.length) { skipped.push({ id: p.id, reason: 'sem conteúdos existentes' }); continue; }
      const playlistId = randomUUID(), versionId = randomUUID();
      insertPlaylist.run(playlistId, p.unitId, p.sectorId, p.name, createdAt, p.createdBy ?? null, createdAt, p.createdBy ?? null);
      insertVersion.run(versionId, playlistId, 'Importada da programação da versão 1.1.0', createdAt, p.createdBy ?? null);
      media.forEach((m, index) => {
        insertItem.run(randomUUID(), playlistId, index, m.id, duration, 'cut', 0);
        insertVersionItem.run(versionId, index, m.id, m.title, m.name, m.type, duration, 'cut', 0);
        items++;
      });
      playlists++;
      if (media.length > 6) over6++;
      if (media.length > 15) over15++;
      insertSchedule.run(p.id, p.unitId, p.sectorId, p.name, playlistId, p.active === false ? 'stopped' : 'published',
        p.startAt ?? null, p.endAt ?? null, createdAt, p.createdBy ?? null, createdAt, p.createdBy ?? null, createdAt, p.createdBy ?? null);
      schedules++;
      for (const displayId of Array.isArray(p.displayIds) ? p.displayIds : []) {
        if (displayExists.get(displayId)) { insertLink.run(p.id, displayId); links++; }
      }
    }
    if (countOf(db, 'schedules') !== schedules || countOf(db, 'playlists') !== playlists || schedules + skipped.length !== legacy.length) {
      throw new Error('contagem de playlists/programações divergente após a cópia');
    }
    return { legacyPublications: legacy.length, playlists, schedules, displayLinks: links, items, skipped, withMoreThan6Items: over6, withMoreThan15Items: over15 };
  }
};
