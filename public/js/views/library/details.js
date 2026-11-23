// Detalhes de um arquivo: pré-visualização, informações, onde é usado e as ações permitidas à pessoa.
// Os botões só aparecem se a pessoa tem a permissão no escopo do arquivo; mesmo assim o servidor confere cada chamada.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openModal } from '../../ui/dialogs.js';
import { badge, button, notice, tones } from '../../ui/components.js';
import { canIn } from '../../lib/permissions.js';
import { KIND_LABELS, MEDIA_STATUS_LABELS, SCAN_LABELS, SCHEDULE_STATE_LABELS, formatBytes, formatDateTime } from '../../lib/format.js';
import { deleteItems, moveItems, renameMedia, reviewItems } from './actions.js';

function preview(media) {
  if (media.kind === 'image') return h('img.detail-preview', { src: media.url, alt: `Pré-visualização de ${media.title}` });
  if (media.kind === 'video') {
    const video = h('video.detail-preview', { src: media.url, controls: true, preload: 'metadata', aria: { label: `Vídeo ${media.title}` } });
    // MOV que este navegador não decodifica (por exemplo HEVC): o som toca, a imagem não aparece e não há erro. Em vez de um quadro preto sem explicação, orienta.
    if (media.type === 'video/quicktime') {
      video.addEventListener('loadedmetadata', () => {
        if (!video.videoWidth) video.after(h('p.muted.small', { role: 'status' }, 'Este navegador não consegue exibir a imagem deste vídeo (codec sem suporte neste aparelho). Teste a reprodução na TV antes de publicar: se ela também não decodificar, o conteúdo será pulado.'));
      }, { once: true });
    }
    return video;
  }
  if (media.kind === 'pdf') return h('iframe.detail-preview.pdf', { src: media.url, title: `Pré-visualização de ${media.title}` });
  return h('div.detail-preview.none', icon('file'), h('p', 'Sem pré-visualização para este tipo de arquivo.'));
}

const line = (label, value) => h('div.review-line', h('span', label), h('b', value));

export function openMediaDetails(ctx, { mediaId, tree, onChanged }) {
  let changed = false, media = null;
  const closeButton = button('Fechar', { onClick: () => dialog.close() });
  const dialog = openModal({
    title: 'Detalhes do arquivo', size: 'large',
    body: [h('div.loading', { role: 'status' }, h('span.spinner', { aria: { hidden: 'true' } }), ' Carregando…')],
    footer: [closeButton]
  });
  const alive = () => dialog.el.isConnected;

  async function load() {
    try {
      const fresh = await ctx.api.get(`/api/media/${encodeURIComponent(mediaId)}`);
      if (!alive()) return;
      media = fresh;
      draw();
    } catch (error) {
      if (!alive()) return;
      if (error?.status === 404) { dialog.setTitle('Arquivo não encontrado'); dialog.setBody(notice('Este arquivo não existe mais. Ele pode ter sido excluído por outra pessoa.', { tone: 'info' })); changed = true; return; }
      dialog.setBody(notice(error?.message || 'Não foi possível carregar o arquivo.', { iconName: 'alert' }));
    }
  }

  function usageBlock() {
    const { playlists = [], schedules = [] } = media.usage ?? {};
    if (!playlists.length && !schedules.length) return notice('Este arquivo ainda não está em nenhuma playlist.', { tone: 'info', iconName: 'list' });
    const close = () => dialog.close();
    return h('div.detail-usage',
      playlists.length ? h('div', h('h3', 'Playlists (rascunho)'), h('ul.link-list', playlists.map(item => h('li',
        h('a.subtle-link', { href: ctx.link('playlist', { id: item.id }), on: { click: close } }, icon('list'), item.name))))) : null,
      schedules.length ? h('div', h('h3', 'Programações'), h('ul.link-list', schedules.map(item => h('li',
        h('a.subtle-link', { href: ctx.link('schedules'), on: { click: close } }, icon('calendar'), item.name), ' ',
        badge(SCHEDULE_STATE_LABELS[item.status] ?? item.status, tones.schedule[item.status] ?? 'neutral'))))) : null);
  }

  function draw() {
    const here = { unitId: media.unitId, sectorId: media.sectorId };
    const can = permission => canIn(ctx.user, permission, here);
    dialog.setTitle(media.title, `${KIND_LABELS[media.kind] ?? 'Arquivo'} · ${formatBytes(media.size)}`);
    dialog.setBody(h('div.detail-layout',
      h('div.detail-media', preview(media), h('a.subtle-link', { href: media.url, target: '_blank' }, icon('eye'), 'Abrir em uma nova aba')),
      h('div.detail-info',
        line('Situação', badge(MEDIA_STATUS_LABELS[media.status] ?? media.status, tones.media[media.status])),
        line('Local', media.folderPath?.length ? media.folderPath.join(' / ') : 'Biblioteca (raiz)'),
        line('Arquivo original', media.name),
        line('Formato', media.type),
        line('Enviado em', formatDateTime(media.createdAt)),
        media.reviewedAt ? line(media.status === 'rejected' ? 'Rejeitado em' : 'Aprovado em', formatDateTime(media.reviewedAt)) : null,
        line('Verificação antivírus', SCAN_LABELS[media.scanStatus] ?? media.scanStatus),
        media.scanStatus !== 'clean' ? notice('Este arquivo não passou por antivírus. A aprovação em ambiente local exige a ciência de quem aprova.', { iconName: 'shield', className: 'mt' }) : null,
        h('div.mt', h('h3.detail-heading', 'Onde é usado'), usageBlock()))));

    const run = async (work) => { if (await work()) { changed = true; await load(); } };
    const footer = [];
    if (can('media:delete')) footer.push(button('Excluir', { icon: 'trash', danger: true, onClick: async () => { if (await deleteItems(ctx, { media: [media] })) { changed = true; dialog.close(); } } }));
    if (can('media:update')) {
      footer.push(button('Mover', { icon: 'move', onClick: () => run(() => moveItems(ctx, { tree, media: [media], fromFolderId: media.folderId })) }));
      footer.push(button('Renomear', { icon: 'edit', onClick: () => run(() => renameMedia(ctx, media)) }));
    }
    if (can('media:approve') && media.status !== 'rejected') footer.push(button('Rejeitar', { icon: 'x-circle', onClick: () => run(() => reviewItems(ctx, { media: [media], decision: 'reject' })) }));
    if (can('media:approve') && media.status !== 'approved') footer.push(button('Aprovar', { icon: 'check-circle', primary: true, onClick: () => run(() => reviewItems(ctx, { media: [media], decision: 'approve' })) }));
    footer.push(closeButton);
    dialog.setFooter(footer);
  }

  load();
  dialog.closed.then(() => { if (changed) onChanged?.(); });
  return dialog.closed;
}
