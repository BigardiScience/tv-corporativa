// Janelas que não pertencem a uma tela específica: guia, formatos, acessibilidade, perfil e escolha de unidade/setor.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openModal } from '../ui/dialogs.js';
import { button, notice } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { ROLE_LABELS, ROLE_SUMMARIES } from '../lib/permissions.js';
import { groupPermissions } from '../lib/permissions.js';

const step = (number, title, text) => h('div.help-step', h('span', number), h('div', h('h3', title), h('p', text)));

export function helpDialog(ctx) {
  const dialog = openModal({
    title: 'Sua mensagem na TV, passo a passo', subtitle: 'Você cria o conteúdo. A TV Corporativa cuida da distribuição.',
    body: [
      step('1', 'Escolha a unidade e o setor', 'Selecione onde você trabalha e qual equipe é responsável pelo conteúdo. Cada unidade e setor tem a sua própria biblioteca.'),
      step('2', 'Envie o arquivo exportado para a Biblioteca', 'Crie em sua ferramenta preferida, exporte para imagem, vídeo ou PDF e envie. Organize em pastas, como no seu computador.'),
      step('3', 'Revise e aprove', 'Quem tem permissão de aprovação (Gestor ou TI) confere o arquivo e o libera. Isso ajuda a evitar mensagens incorretas.'),
      step('4', 'Monte uma playlist — o que vai passar', 'A playlist é a lista de conteúdos, na ordem, com o tempo e a transição de cada um. Você edita um rascunho e só publica quando estiver pronta.'),
      step('5', 'Programe — quando e onde', 'Escolha uma versão publicada da playlist, as TVs autorizadas pelos administradores e o período. A mesma TV pode receber vários setores em um ciclo único. Consulte “Ver sequência”; o perfil Administrador controla a ordem global.'),
      step('6', 'Conecte as telas', 'O Administrador cadastra a TV, autoriza os setores e usuários e informa o código de pareamento no player.')
    ],
    note: 'Precisa de acesso? Procure a equipe de TI.',
    footer: [button('Vamos começar', { primary: true, icon: 'arrow', onClick: () => { dialog.close(); chooseSpace(ctx); } })]
  });
}

export function formatsDialog(ctx) {
  const max = ctx.state.limits?.maxUploadMB ?? 50;
  openModal({
    title: 'Crie nas ferramentas que você conhece', subtitle: 'A plataforma distribui arquivos exportados; a edição continua nas ferramentas de origem.',
    body: [
      h('div.help-step', h('span', 'P'), h('div', h('h3', 'PowerPoint e Word'), h('p', 'Exporte para PDF ou imagens. Para animações e transições do PowerPoint, exporte para MP4.'))),
      h('div.help-step', h('span', 'X'), h('div', h('h3', 'Excel e Power BI'), h('p', 'Exporte o relatório autorizado como PDF ou imagem. Para atualização ao vivo, a TI deve implementar e homologar integração autenticada. Não use “Publicar na Web” para dados internos.'))),
      h('div.help-step', h('span', 'C'), h('div', h('h3', 'Canva e Photoshop'), h('p', 'Exporte para PNG, JPG ou MP4, conforme a ferramenta. Projetos PSD e arquivos editáveis não são executados no player. Canva é uma ferramenta independente da Microsoft.'))),
      notice('PDF depende do visualizador da TV e não avança as páginas automaticamente. Prefira uma imagem por slide ou vídeo para exibição contínua.', { tone: 'info' }),
      h('p.muted.small', `Formatos aceitos: PNG, JPG, JPEG, WEBP, MP4, MOV, WEBM e PDF. Limite: ${max} MB por arquivo. Macros e executáveis são bloqueados.`)
    ],
    note: 'Recomendação visual: formato horizontal 16:9.',
    footer: [button('Entendi', { primary: true, icon: 'check', onClick: event => event.currentTarget.closest('dialog').close() })]
  });
}

export function accessibilityDialog(ctx) {
  const row = (label, isOn, toggle) => {
    const control = h('button.button', {
      type: 'button', aria: { pressed: String(isOn()) },
      on: { click: () => { toggle(); control.setAttribute('aria-pressed', String(isOn())); toast('Preferência de leitura atualizada.'); } }
    }, 'Alternar');
    return h('div.setting-row', h('span', label), control);
  };
  openModal({
    title: 'Acessibilidade', subtitle: 'Ajuste a leitura e use a plataforma no seu ritmo.',
    body: [
      row('Texto ampliado', () => globalThis.document.body.classList.contains('large-text'), () => ctx.setLargeText(!globalThis.document.body.classList.contains('large-text'))),
      row('Contraste reforçado', () => globalThis.document.body.classList.contains('high-contrast'), () => ctx.setHighContrast(!globalThis.document.body.classList.contains('high-contrast'))),
      h('p.muted.small', 'Use Tab para navegar, Enter para selecionar e Esc para fechar uma janela. Há um link “Pular para o conteúdo” no início da página.')
    ],
    footer: [button('Concluir', { primary: true, icon: 'check', onClick: event => event.currentTarget.closest('dialog').close() })]
  });
}

export function profileDialog(ctx) {
  const { user, catalog, units, sectors } = ctx.state;
  const allowed = new Set(user.permissions ?? []);
  const groups = groupPermissions(catalog).map(group => h('div.perm-summary',
    h('b', group.group),
    h('ul', group.items.map(item => h('li', { class: allowed.has(item.id) ? 'on' : 'off' }, icon(allowed.has(item.id) ? 'check' : 'close'), item.label)))));
  const dialog = openModal({
    title: user.name, subtitle: ROLE_LABELS[user.role] ?? user.role,
    body: [
      h('div.review-line', h('span', 'E-mail'), h('b', user.email)),
      h('div.review-line', h('span', 'Perfil'), h('b', ROLE_LABELS[user.role] ?? user.role)),
      h('div.review-line', h('span', 'Unidades'), h('b', units.map(unit => unit.name).join(', ') || 'Nenhuma')),
      h('div.review-line', h('span', 'Setores'), h('b', sectors.map(sector => sector.name).join(', ') || 'Nenhum')),
      h('p.muted.small', ROLE_SUMMARIES[user.role] ?? ''),
      h('details.perm-details', h('summary', 'O que o meu acesso permite'), h('div.perm-summary-grid', groups)),
      notice('Seu acesso é individual e limitado pelas permissões definidas pela TI. O servidor confere cada ação.', { iconName: 'lock', tone: 'info', className: 'mt' })
    ],
    footer: [button('Sair com segurança', { primary: true, icon: 'logout', onClick: () => { dialog.close(); ctx.logout(); } })]
  });
}

// Escolha de unidade e setor (o "espaço" de trabalho). A biblioteca, as playlists e as programações são sempre de um espaço.
export function chooseSpace(ctx, { unitId } = {}) {
  const { units, sectors, space } = ctx.state;
  if (!units.length || !sectors.length) {
    openModal({
      title: 'Sem unidade ou setor liberados', subtitle: 'Sua conta ainda não tem acesso a nenhum espaço de trabalho.',
      body: [notice('Peça à equipe de TI para liberar ao menos uma unidade e um setor para o seu usuário.', { tone: 'info' })],
      footer: [button('Entendi', { primary: true, icon: 'check', onClick: event => event.currentTarget.closest('dialog').close() })]
    });
    return Promise.resolve(null);
  }
  let chosenUnit = unitId ?? space?.unitId ?? (units.length === 1 ? units[0].id : null);
  const dialog = openModal({ title: 'Onde você vai trabalhar?', subtitle: 'Cada unidade e setor tem a sua própria biblioteca, playlists e programações.', body: [], footer: [] });
  const draw = () => {
    const unit = units.find(item => item.id === chosenUnit);
    dialog.setBody(
      units.length > 1 ? h('div', h('p.field-label', '1. Unidade'),
        h('div.sector-grid.mt', units.map(item => h('button.sector-choice', {
          type: 'button', aria: { pressed: String(item.id === chosenUnit) }, class: { selected: item.id === chosenUnit },
          on: { click: () => { chosenUnit = item.id; draw(); } }
        }, icon('building'), item.name)))) : null,
      unit ? h('div.mt', h('p.field-label', units.length > 1 ? '2. Setor' : 'Setor'),
        h('div.sector-grid.mt', sectors.map(item => h('button.sector-choice', {
          type: 'button', class: { selected: space?.unitId === unit.id && space?.sectorId === item.id },
          on: { click: () => { ctx.setSpace({ unitId: unit.id, sectorId: item.id }); dialog.close(item); toast(`${unit.name} · ${item.name} selecionado.`); } }
        }, icon('users'), item.name)))) : h('p.muted.mt', 'Escolha uma unidade para ver os setores.'));
  };
  draw();
  return dialog.closed;
}
