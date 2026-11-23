// Configurações. Todas as pessoas veem leitura/acessibilidade, a situação dos controles de segurança, as integrações (com
// honestidade sobre o que ainda não está conectado) e o ambiente. Só quem tem settings:manage vê o cadastro de unidades e setores.
import { h, mount } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, button, notice, pageHeading } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { environmentRows, securityRows } from '../../lib/settings-model.js';
import { helpDialog } from '../common-dialogs.js';
import { createOrganizationPanel } from './organization.js';

const body = () => globalThis.document.body;

// Botão de liga/desliga das preferências de leitura. A fonte da verdade é a classe aplicada ao <body> (ctx.setXxx a aplica e guarda).
function toggleRow(label, className, set) {
  const isOn = () => body().classList.contains(className);
  const control = h('button.button', { type: 'button', aria: { pressed: String(isOn()), label: `${label}: ${isOn() ? 'ligado' : 'desligado'}` } }, isOn() ? 'Desativar' : 'Ativar');
  control.addEventListener('click', () => {
    set(!isOn());
    control.setAttribute('aria-pressed', String(isOn()));
    control.setAttribute('aria-label', `${label}: ${isOn() ? 'ligado' : 'desligado'}`);
    control.textContent = isOn() ? 'Desativar' : 'Ativar';
    toast('Preferência de leitura atualizada.');
  });
  return h('div.setting-row', h('span', label), control);
}

const statusChip = row => h(`span.chip.${row.tone}`, row.status);

export async function mountSettings(ctx, route, container, view) {
  const { mode, version, scannerConfigured, limits } = ctx.state;
  const canManage = ctx.can('settings:manage');

  // O esquema do banco vem de /healthz (público, sem dados sensíveis). Se falhar, a linha fica com "—": é só informação.
  const environment = h('div.setting-rows');
  const drawEnvironment = schema => mount(environment, environmentRows({ mode, version, limits, schema }).map(([label, value]) => h('div.setting-row', h('span', label), h('span', value))));
  drawEnvironment(undefined);
  ctx.api.get('/healthz', { public: true }).then(data => { if (view.alive()) drawEnvironment(data?.schema); }, () => {});

  const organization = canManage ? createOrganizationPanel(ctx) : null;

  mount(container,
    pageHeading({ eyebrow: 'PREFERÊNCIAS E SEGURANÇA', title: 'Configurações', description: 'Preferências, segurança e integrações da plataforma.' }),
    h('div.settings-grid',
      h('article.setting-card',
        h('h2', icon('access'), 'Uma experiência para todos'),
        h('p', 'Navegação por teclado, foco visível, formulários identificados e avisos acessíveis. Ajuste a leitura ao seu conforto; a preferência fica salva neste navegador.'),
        toggleRow('Texto ampliado', 'large-text', on => ctx.setLargeText(on)),
        toggleRow('Contraste reforçado', 'high-contrast', on => ctx.setHighContrast(on))),

      h('article.setting-card',
        h('h2', icon('shield'), 'Segurança e governança'),
        h('p', 'Controles técnicos de apoio à gestão de segurança da informação. Certificações como a ISO/IEC 27001 e avaliações como o TISAX dependem também de políticas, processos e auditoria da organização: esta plataforma, sozinha, não é certificada nem avaliada.'),
        securityRows({ scannerConfigured, mode }).map(row => h('div.setting-row', { dataset: { control: row.label } }, h('span', row.label), statusChip(row)))),

      h('article.setting-card',
        h('h2', icon('cloud'), 'Microsoft e ferramentas de criação'),
        h('p', 'Envie exportações em PDF, imagem ou vídeo. As integrações autenticadas com o Microsoft 365 e o Power BI precisam ser implementadas e homologadas no ambiente da empresa; hoje não há conexão.'),
        h('div.setting-row', h('span', 'Arquivos exportados'), badge('Disponível')),
        h('div.setting-row', h('span', 'SharePoint / OneDrive'), h('span.chip.pending', 'Não conectado')),
        h('div.setting-row', h('span', 'Power BI Embedded'), h('span.chip.pending', 'Não conectado')),
        h('div.mt', button('Ver orientações', { icon: 'file', onClick: () => ctx.openFormats() }))),

      h('article.setting-card',
        h('h2', icon('settings'), 'Ambiente e suporte'),
        h('p', mode === 'production'
          ? 'Você está conectado ao ambiente corporativo. A TI administra o serviço, os backups e a infraestrutura.'
          : 'Você está conectado a um ambiente local de testes. A TI administra o serviço, os backups e a infraestrutura.'),
        environment,
        h('div.setting-row', h('span', 'Ajuda para sua equipe'), h('button.subtle-link', { type: 'button', on: { click: () => helpDialog(ctx) } }, 'Abrir guia ', icon('arrow'))))),
    organization ? organization.el : notice('O cadastro de unidades e setores é feito pelo Administrador TI. Se precisar de uma unidade ou de um setor novo, peça à TI.', { tone: 'info', iconName: 'building', className: 'mt' }));
}
