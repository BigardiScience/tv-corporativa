// Ações da biblioteca que usam janelas de confirmação: criar/renomear/mover/excluir/aprovar. Cada função devolve o resultado
// (ou true/false) e deixa a atualização da tela para quem chamou. Quem decide se a ação é permitida é sempre o servidor.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { confirmDialog, openModal } from '../../ui/dialogs.js';
import { button, field, notice } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { runBusy, showError } from '../../ui/feedback.js';
import { destinationOptions, subtreeHeight } from '../../lib/tree.js';
import { plural } from '../../lib/format.js';

const FORBIDDEN = /[\\/\u0000-\u001f\u007f]/;
export const FOLDER_MAX_DEPTH = 8;

// Janela de um campo de texto (criar e renomear). `submit(nome)` faz a chamada à API; erros aparecem dentro da janela.
export function promptName(ctx, { title, subtitle, label, value = '', confirmLabel = 'Salvar', hint, maxLength = 120, submit }) {
  const input = h('input#name-input', { name: 'name', type: 'text', maxlength: String(maxLength), required: true, value, autocomplete: 'off', spellcheck: 'false' });
  let dialog;
  const save = async () => {
    const name = input.value.trim();
    if (!name) { dialog.setError('Informe um nome.'); input.focus(); return; }
    if (FORBIDDEN.test(name)) { dialog.setError('O nome não pode conter barras (/ ou \\) nem caracteres de controle.'); input.focus(); return; }
    dialog.clearError();
    const result = await runBusy(confirm, () => submit(name), { dialog });
    if (result !== undefined) dialog.close(result);
  };
  const confirm = button(confirmLabel, { primary: true, icon: 'check', onClick: save });
  const form = h('form.form-grid', { on: { submit: event => { event.preventDefault(); save(); } } }, field({ label, control: input, hint, full: true }));
  dialog = openModal({ title, subtitle, size: 'small', body: [form], footer: [button('Cancelar', { onClick: () => dialog.close() }), confirm] });
  input.select();
  return dialog.closed;
}

export async function createFolder(ctx, { space, parentId = null }) {
  const folder = await promptName(ctx, {
    title: 'Nova pasta', subtitle: 'Organize os arquivos como no seu computador.', label: 'Nome da pasta', confirmLabel: 'Criar pasta',
    hint: `Até ${FOLDER_MAX_DEPTH} níveis de pastas.`,
    submit: name => ctx.api.post('/api/folders', { unitId: space.unitId, sectorId: space.sectorId, name, ...(parentId ? { parentId } : {}) })
  });
  if (folder) toast(`Pasta “${folder.name}” criada.`);
  return folder;
}

export async function renameFolder(ctx, folder) {
  const result = await promptName(ctx, {
    title: 'Renomear pasta', subtitle: 'Playlists e programações continuam funcionando: o que muda é só o nome.', label: 'Nome da pasta', value: folder.name, confirmLabel: 'Renomear',
    submit: name => ctx.api.patch(`/api/folders/${encodeURIComponent(folder.id)}`, { name })
  });
  if (result) toast('Pasta renomeada.');
  return result;
}

export async function renameMedia(ctx, media) {
  const result = await promptName(ctx, {
    title: 'Renomear arquivo', subtitle: 'O nome do arquivo original não muda; este é o título que aparece nas playlists.', label: 'Título', value: media.title, confirmLabel: 'Renomear',
    submit: title => ctx.api.patch(`/api/media/${encodeURIComponent(media.id)}`, { title })
  });
  if (result) toast('Arquivo renomeado.');
  return result;
}

const listNames = (names, max = 6) => (names.length > max ? [...names.slice(0, max), `e mais ${names.length - max}`] : names);

// Escolha da pasta de destino. `fromFolderId`: onde os itens estão agora (a opção fica marcada como "aqui").
export function moveItems(ctx, { tree, folders = [], media = [], fromFolderId }) {
  const blocked = folders.map(folder => folder.id);
  const height = Math.max(0, ...blocked.map(id => subtreeHeight(tree, id)));
  const options = destinationOptions(tree, { blocked, movingDepth: height, maxDepth: FOLDER_MAX_DEPTH });
  let choice;
  const confirm = button('Mover', { primary: true, icon: 'move', disabled: true, onClick: () => save() });
  const radio = (id, label, level, disabled, note) => {
    const input = h('input', { type: 'radio', name: 'destination', value: id ?? '', disabled, on: { change: () => { choice = { id }; confirm.disabled = false; } } });
    return h('label.dest-option', { class: { disabled }, style: { '--level': level } }, input, icon(id === null ? 'cloud' : 'folder'), h('span', label), note ? h('small', note) : null);
  };
  let dialog;
  async function save() {
    if (!choice) return;
    const done = await runBusy(confirm, async () => {
      await ctx.api.post('/api/library/batch', { action: 'move', mediaIds: media.map(item => item.id), folderIds: folders.map(folder => folder.id), targetFolderId: choice.id });
      return true;
    }, { dialog });
    if (done) { dialog.close(true); toast(`${plural(folders.length + media.length, 'item movido', 'itens movidos')}.`); }
  }
  dialog = openModal({
    title: 'Mover para…', subtitle: `${plural(folders.length + media.length, 'item selecionado', 'itens selecionados')}. Escolha a pasta de destino.`,
    body: [
      h('div.dest-list', { role: 'radiogroup', aria: { label: 'Pasta de destino' } },
        radio(null, 'Biblioteca (raiz)', 0, false, fromFolderId === null ? 'local atual' : ''),
        options.map(option => radio(option.id, option.name, option.level, option.disabled, option.id === fromFolderId ? 'local atual' : option.disabled ? 'indisponível' : ''))),
      folders.length ? notice('Uma pasta não pode ser movida para dentro dela mesma, de uma subpasta sua, nem para além de 8 níveis.', { tone: 'info', className: 'mt' }) : null
    ],
    footer: [button('Cancelar', { onClick: () => dialog.close(false) }), confirm]
  });
  return dialog.closed.then(Boolean);
}

function blockersDialog(details) {
  const names = (details.media ?? []).map(item => item.title);
  const dialog = openModal({
    title: 'Não é possível excluir agora', subtitle: 'Há arquivos em uso por playlists ou programações no ar.', size: 'small',
    body: [
      names.length ? h('div', h('p.field-label', 'Arquivos em uso'), h('ul.confirm-list', listNames(names).map(name => h('li', name)))) : null,
      details.playlists?.length ? h('div.mt', h('p.field-label', 'Playlists que usam estes arquivos'), h('ul.confirm-list', details.playlists.map(item => h('li', item.name)))) : null,
      details.schedules?.length ? h('div.mt', h('p.field-label', 'Programações no ar'), h('ul.confirm-list', details.schedules.map(item => h('li', item.name)))) : null,
      notice('Retire os arquivos das playlists (e interrompa as programações que dependem deles) e tente de novo.', { tone: 'info', className: 'mt' })
    ],
    footer: [button('Entendi', { primary: true, icon: 'check', onClick: () => dialog.close() })]
  });
  return dialog.closed;
}

// Exclusão em lote, com confirmação. Pasta com conteúdo exige uma segunda confirmação explícita.
export async function deleteItems(ctx, { folders = [], media = [] }) {
  const total = folders.length + media.length;
  const ok = await confirmDialog({
    title: total === 1 ? 'Excluir este item?' : `Excluir ${total} itens?`, danger: true, confirmLabel: 'Excluir',
    message: 'Esta ação não pode ser desfeita.',
    details: listNames([...folders.map(folder => `Pasta: ${folder.name}`), ...media.map(item => item.title)])
  });
  if (!ok) return false;
  const body = { action: 'delete', mediaIds: media.map(item => item.id), folderIds: folders.map(folder => folder.id) };
  try {
    await ctx.api.post('/api/library/batch', body);
  } catch (error) {
    if (error.code === 'FOLDER_NOT_EMPTY') {
      const counts = error.details ?? {};
      const again = await confirmDialog({
        title: 'A pasta não está vazia', danger: true, confirmLabel: 'Excluir tudo',
        message: `Excluir também ${plural(counts.folders ?? 0, 'subpasta', 'subpastas')} e ${plural(counts.media ?? 0, 'arquivo', 'arquivos')} que estão dentro?`,
        note: 'Não há como desfazer.'
      });
      if (!again) return false;
      try { await ctx.api.post('/api/library/batch', { ...body, recursive: true }); } catch (second) {
        if (second.code === 'MEDIA_IN_USE') { await blockersDialog(second.details ?? {}); return false; }
        showError(second); return false;
      }
    } else if (error.code === 'MEDIA_IN_USE') { await blockersDialog(error.details ?? {}); return false; }
    else { showError(error); return false; }
  }
  toast(`${plural(total, 'item excluído', 'itens excluídos')}.`);
  return true;
}

// Aprovar ou rejeitar. Sem antivírus configurado (ambiente local), a aprovação exige ciência explícita.
export async function reviewItems(ctx, { media, decision }) {
  const approve = decision === 'approve';
  const unscanned = approve && media.some(item => item.scanStatus !== 'clean');
  // Em ambiente corporativo a aprovação exige o arquivo verificado pelo antimalware: não há como "assumir o risco" pela tela.
  const blocked = unscanned && ctx.state.mode === 'production';
  const check = h('input#ack-scan', { type: 'checkbox' });
  const confirm = button(approve ? 'Aprovar' : 'Rejeitar', { primary: approve, danger: !approve, icon: approve ? 'check' : 'x-circle', disabled: unscanned, onClick: () => save() });
  if (unscanned && !blocked) check.addEventListener('change', () => { confirm.disabled = !check.checked; });
  let dialog;
  async function save() {
    const done = await runBusy(confirm, async () => {
      await ctx.api.post('/api/library/batch', { action: decision, mediaIds: media.map(item => item.id), ...(unscanned ? { acknowledgeUnscanned: check.checked } : {}) });
      return true;
    }, { dialog });
    if (done) { dialog.close(true); toast(approve ? 'Conteúdo aprovado e disponível para playlists.' : 'Conteúdo rejeitado.'); }
  }
  dialog = openModal({
    title: approve ? (media.length === 1 ? 'Aprovar este arquivo?' : `Aprovar ${media.length} arquivos?`) : (media.length === 1 ? 'Rejeitar este arquivo?' : `Rejeitar ${media.length} arquivos?`),
    subtitle: approve ? 'Só arquivos aprovados podem ser publicados para as TVs.' : 'Arquivos rejeitados não entram em playlists.', size: 'small',
    body: [
      h('ul.confirm-list', listNames(media.map(item => item.title)).map(name => h('li', name))),
      blocked ? h('div.mt', notice('Este ambiente exige verificação antivírus antes da aprovação, e há arquivos sem essa verificação. Procure a equipe de TI.', { iconName: 'shield' })) : null,
      unscanned && !blocked ? h('div.mt', notice('Sem verificação antivírus neste ambiente. A aprovação exige ciência da TI e não representa uma verificação antimalware.', { iconName: 'shield' }),
        h('label.check-item', check, 'Confirmo a revisão local e estou ciente da ausência de varredura antimalware.')) : null
    ],
    footer: [button('Cancelar', { onClick: () => dialog.close(false) }), confirm]
  });
  return dialog.closed.then(Boolean);
}
