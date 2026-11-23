// Unidades e setores (cadastro global). Só o Administrador, que tem a permissão settings:manage; o servidor confere de novo.
// Não há exclusão: arquivos, playlists, programações, TVs, pessoas e auditoria ficam ligados ao identificador. Renomear é seguro.
import { h, mount } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openModal } from '../../ui/dialogs.js';
import { button, field, iconButton, notice } from '../../ui/components.js';
import { runBusy, showError } from '../../ui/feedback.js';
import { toast } from '../../ui/toast.js';
import { ORG_KINDS, validateOrganizationForm } from '../../lib/settings-model.js';

// Devolve (pela promessa) o registro salvo, ou undefined se a janela for cancelada.
export function openOrganizationForm(ctx, { kind, item = null }) {
  const spec = ORG_KINDS[kind], editing = !!item;
  const name = h('input#org-name', { name: 'name', type: 'text', maxlength: '120', value: item?.name ?? '', autocomplete: 'off', spellcheck: 'false' });
  const city = kind === 'units' ? h('input#org-city', { name: 'city', type: 'text', maxlength: '120', value: item?.city ?? '', autocomplete: 'off' }) : null;
  let dialog;

  async function submit() {
    const values = { name: name.value, city: city?.value ?? '' };
    const problems = validateOrganizationForm(kind, values, { existing: ctx.state[kind], selfId: item?.id ?? null });
    if (problems.length) { dialog.setError(problems.join(' ')); name.focus(); return; }
    dialog.clearError();
    // A cidade sempre vai junto: o servidor trata a ausência dela como "sem cidade".
    const body = { name: values.name.trim(), ...(city ? { city: values.city.trim() } : {}) };
    const saved = await runBusy(confirm, () => (editing
      ? ctx.api.patch(`/api/${kind}/${encodeURIComponent(item.id)}`, body)
      : ctx.api.post(`/api/${kind}`, body)), { dialog });
    if (saved !== undefined) dialog.close(saved);
  }
  const confirm = button(editing ? 'Salvar alterações' : `Criar ${spec.noun}`, { primary: true, icon: 'check', onClick: submit });

  dialog = openModal({
    title: editing ? `Editar ${spec.noun}` : spec.create, size: 'small',
    subtitle: editing ? item.name : 'Cadastro global: vale para toda a plataforma.',
    body: [
      h('form.form-grid', { on: { submit: event => { event.preventDefault(); submit(); } } },
        field({ label: 'Nome', control: name, full: true, hint: `Como ${spec.article} ${spec.noun} aparece para todas as pessoas. Não pode repetir um nome já usado.` }),
        city ? field({ label: 'Cidade (opcional)', control: city, full: true }) : null),
      notice(editing
        ? `Renomear não perde nada: arquivos, playlists, programações, TVs, pessoas e a auditoria continuam ligados ${spec.to}.`
        : `Depois de criar, libere o acesso em Usuários (${spec.plural} autorizados de cada pessoa). O Administrador já enxerga ${spec.newOne}.`,
      { tone: 'info', iconName: 'info', className: 'mt' })
    ],
    footer: [button('Cancelar', { onClick: () => dialog.close() }), confirm]
  });
  return dialog.closed;
}

// Painel com as duas listas. `ctx.reloadWorkspace()` atualiza unidades e setores do painel inteiro (menu, escolha de espaço…).
export function createOrganizationPanel(ctx) {
  const unitsBox = h('div.org-list', { dataset: { kind: 'units' } }), sectorsBox = h('div.org-list', { dataset: { kind: 'sectors' } });

  function row(kind, item) {
    const spec = ORG_KINDS[kind];
    return h('div.org-row', { dataset: { id: item.id } },
      h('div', h('b', item.name), kind === 'units' ? h('small', item.city || 'Cidade não informada') : null),
      iconButton(spec.edit(item.name), 'edit', () => change(kind, item)));
  }

  function draw() {
    const { units, sectors } = ctx.state;
    mount(unitsBox, units.length ? units.map(item => row('units', item)) : h('p.muted.small', 'Nenhuma unidade cadastrada.'));
    mount(sectorsBox, sectors.length ? sectors.map(item => row('sectors', item)) : h('p.muted.small', 'Nenhum setor cadastrado.'));
  }

  async function change(kind, item = null) {
    const saved = await openOrganizationForm(ctx, { kind, item });
    if (saved === undefined) return;
    try { await ctx.reloadWorkspace(); } catch (error) { showError(error); }
    draw();
    toast(item ? ORG_KINDS[kind].saved : ORG_KINDS[kind].created);
  }

  const column = (kind, title, box) => h('div.org-column',
    h('div.org-head', h('h3', title), button(ORG_KINDS[kind].create, { icon: 'plus', className: 'small', onClick: () => change(kind) })),
    box);

  draw();
  const el = h('section.panel.org-panel', { aria: { label: 'Unidades e setores' } },
    h('div.panel-head', h('div', h('h2', 'Unidades e setores'), h('small', 'Cadastro global da plataforma. Só o Administrador TI altera.')), icon('building')),
    h('div.org-body',
      notice('Unidades e setores não são excluídos: arquivos, playlists, programações e o histórico ficam ligados a eles. Para tirar o acesso de alguém a uma unidade ou a um setor, edite a pessoa em Usuários.', { tone: 'info', iconName: 'info', className: 'mb' }),
      h('div.org-columns', column('units', 'Unidades', unitsBox), column('sectors', 'Setores', sectorsBox))));
  return { el, draw };
}
