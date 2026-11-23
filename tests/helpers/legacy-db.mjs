import { randomBytes } from 'node:crypto';
import { createApp as createLegacyApp } from '../fixtures/legacy-1.1.0/core.mjs';
import { apiClient, PNG } from './http.mjs';

// Cria, com o servidor REAL da versão 1.1.0, um banco com dados de uso de verdade.
// Retorna os identificadores e credenciais para os testes conferirem depois da migração.
export async function buildLegacyDatabase(dataDir, { password = `Legada-${randomBytes(12).toString('base64url')}` } = {}) {
  const app = createLegacyApp({ dataDir, port: 0, production: false, scanner: '' });
  const api = apiClient(app);
  try {
    const admin = app.createAdmin('Admin Legado', 'admin@legado.example', password);
    const login = await api.login(admin.email, password);
    const session = login.session;
    const user = async (role, email, unitIds, sectorIds) => {
      const r = await api.call('/api/users', { method: 'POST', session, body: { name: `Legado ${role}`, email, password, role, unitIds, sectorIds } });
      if (r.status !== 201) throw new Error(`usuário legado: ${r.status} ${JSON.stringify(r.data)}`);
      return r.data;
    };
    const manager = await user('manager', 'gestor@legado.example', ['leste'], ['rh']);
    const editor = await user('editor', 'editor@legado.example', ['leste'], ['rh']);
    const viewer = await user('viewer', 'visualizador@legado.example', ['centro'], ['seguranca']);
    const inactive = await user('editor', 'inativo@legado.example', ['leste'], ['rh']);
    const deactivated = await api.call(`/api/users/${inactive.id}`, { method: 'PATCH', session, body: { active: false } });
    if (deactivated.status !== 200) throw new Error('desativação legada falhou');
    const upload = async (name, title, unitId, sectorId, body = PNG) => {
      const r = await api.call(`/api/media?name=${name}&title=${encodeURIComponent(title)}&unitId=${unitId}&sectorId=${sectorId}`, { method: 'POST', session, body });
      if (r.status !== 201) throw new Error(`mídia legada: ${r.status} ${JSON.stringify(r.data)}`);
      return r.data;
    };
    const media = [];
    for (const [name, title] of [['a.png', 'Comunicado A'], ['b.png', 'Comunicado B'], ['c.png', 'Comunicado C']]) {
      const item = await upload(name, title, 'leste', 'rh', Buffer.concat([PNG, Buffer.from(name)]));
      const approved = await api.call(`/api/media/${item.id}/approve`, { method: 'POST', session, body: { acknowledgeUnscanned: true } });
      if (approved.status !== 200) throw new Error('aprovação legada falhou');
      media.push(item);
    }
    const pending = await upload('pendente.png', 'Pendente de revisão', 'leste', 'rh', Buffer.concat([PNG, Buffer.from('pendente')]));
    const other = await upload('centro.png', 'Segurança Centro', 'centro', 'seguranca', Buffer.concat([PNG, Buffer.from('centro')]));
    const mkDisplay = async (name, unitId, sectorId) => {
      const r = await api.call('/api/displays', { method: 'POST', session, body: { name, unitId, sectorId } });
      if (r.status !== 201) throw new Error('TV legada falhou');
      return r.data;
    };
    const tvPaired = await mkDisplay('TV Recepção', 'leste', 'rh');
    const paired = await api.call('/api/player/pair', { method: 'POST', body: { code: tvPaired.pairingCode } });
    const tvWaiting = await mkDisplay('TV Refeitório', 'leste', 'rh');
    const endAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const publish = async body => {
      const r = await api.call('/api/playlists', { method: 'POST', session, body });
      if (r.status !== 201) throw new Error(`publicação legada: ${r.status} ${JSON.stringify(r.data)}`);
      return r.data;
    };
    const live = await publish({ name: 'Comunicados da semana', unitId: 'leste', sectorId: 'rh', mediaIds: media.map(m => m.id), displayIds: [tvPaired.display.id, tvWaiting.display.id], duration: 20, endAt });
    const stopped = await publish({ name: 'Campanha encerrada', unitId: 'leste', sectorId: 'rh', mediaIds: [media[0].id], displayIds: [tvPaired.display.id], duration: 10 });
    await api.call(`/api/playlists/${stopped.id}`, { method: 'DELETE', session });
    const legacyManifest = (await api.call('/api/player/manifest', { token: paired.data.token })).data;
    const legacyState = (await api.call('/api/state', { session })).data;
    return { password, admin, manager, editor, viewer, inactive, media, pending, other, tvPaired, tvWaiting, deviceToken: paired.data.token, live, stopped, legacyManifest, legacyState };
  } finally {
    await app.close();
  }
}
