const marks = ids => ids.map(() => '?').join(',');

// Onde cada conteúdo é usado. Um conteúdo "em uso" não pode ser excluído sem antes sair das playlists
// (rascunho) e das programações publicadas que dependem dele.
export function createUsage({ db }) {
  function forMedia(ids) {
    const result = new Map(ids.map(id => [id, { playlists: [], schedules: [], versions: 0 }]));
    if (!ids.length) return result;
    const drafts = db.prepare(`SELECT i.media_id AS mediaId, p.id AS id, p.name AS name FROM playlist_items i JOIN playlists p ON p.id=i.playlist_id
      WHERE i.media_id IN (${marks(ids)}) GROUP BY i.media_id, p.id ORDER BY p.name`).all(...ids);
    for (const row of drafts) result.get(row.mediaId).playlists.push({ id: row.id, name: row.name });
    const schedules = db.prepare(`SELECT vi.media_id AS mediaId, s.id AS id, s.name AS name, s.status AS status
      FROM playlist_version_items vi JOIN playlist_versions v ON v.id=vi.version_id
      JOIN schedules s ON s.playlist_id=v.playlist_id AND s.playlist_version=v.version
      WHERE vi.media_id IN (${marks(ids)}) GROUP BY vi.media_id, s.id ORDER BY s.name`).all(...ids);
    for (const row of schedules) result.get(row.mediaId).schedules.push({ id: row.id, name: row.name, status: row.status });
    const versions = db.prepare(`SELECT media_id AS mediaId, COUNT(DISTINCT version_id) AS versions FROM playlist_version_items
      WHERE media_id IN (${marks(ids)}) GROUP BY media_id`).all(...ids);
    for (const row of versions) result.get(row.mediaId).versions = row.versions;
    return result;
  }

  // O que impede a exclusão: está em rascunho de playlist ou em programação PUBLICADA.
  function blockers(ids) {
    const map = forMedia(ids);
    const playlists = new Map(), schedules = new Map(), mediaIds = [];
    for (const [id, usage] of map) {
      const live = usage.schedules.filter(s => s.status === 'published');
      if (usage.playlists.length || live.length) mediaIds.push(id);
      for (const p of usage.playlists) playlists.set(p.id, p);
      for (const s of live) schedules.set(s.id, s);
    }
    return { blocked: mediaIds.length > 0, mediaIds, playlists: [...playlists.values()], schedules: [...schedules.values()] };
  }

  return { forMedia, blockers };
}
