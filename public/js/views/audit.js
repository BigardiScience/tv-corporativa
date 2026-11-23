// Auditoria: quem fez o quê, onde e quando. O Administrador vê tudo; quem tem a permissão audit:read vê só as unidades e os
// setores que possui (o servidor filtra; esta tela nunca recebe eventos de fora do escopo).
// A busca e os filtros trabalham sobre os eventos já carregados; "Carregar mais" traz os mais antigos (paginação por "before").
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button, emptyState, iconButton, notice, pageHeading } from '../ui/components.js';
import { openModal } from '../ui/dialogs.js';
import { downloadBlob } from '../ui/download.js';
import { runBusy, showError } from '../ui/feedback.js';
import { toast } from '../ui/toast.js';
import { auditActionLabel, formatDateTimeSeconds, plural } from '../lib/format.js';
import {
  AUDIT_CATEGORIES, AUDIT_PERIODS, actorLabel, categoryLabel, categoryOf, coversPeriod, describeAudit, filterEvents, mergeEvents, placeLabel
} from '../lib/audit-model.js';
import { auditCsvName, buildAuditCsv } from '../lib/csv.js';
import { debounce, selectBox } from './shared.js';

const PAGE = 200;
const EXPORT_PAGE = 500, EXPORT_MAX_PAGES = 20;   // até 10.000 eventos por exportação
const COVER_MAX_PAGES = 10;                       // até 2.000 eventos ao procurar o início de um período

const oneOf = (value, options) => (options.some(([option]) => option === value) ? value : '');

export async function mountAudit(ctx, route, container, view) {
  const filters = {
    q: String(route.query.q ?? '').slice(0, 100),
    category: oneOf(route.query.categoria, AUDIT_CATEGORIES),
    period: oneOf(route.query.periodo, AUDIT_PERIODS)
  };
  let events = [], hasMore = false, requestId = 0, busyMore = false, loaded = false;
  const names = { unitName: ctx.unitName, sectorName: ctx.sectorName };
  const everyone = ctx.user.role === 'admin';

  const search = h('input#audit-search', { type: 'search', placeholder: 'Buscar por pessoa, ação, arquivo, TV…', maxlength: '100', autocomplete: 'off', value: filters.q, aria: { label: 'Buscar nos eventos carregados' } });
  const categorySelect = selectBox({ id: 'audit-category', label: 'Filtrar por categoria', value: filters.category, options: AUDIT_CATEGORIES, onChange: value => { filters.category = value; changed(); } });
  const periodSelect = selectBox({ id: 'audit-period', label: 'Filtrar por período', value: filters.period, options: AUDIT_PERIODS, onChange: value => { filters.period = value; changed(); } });
  const count = h('p.library-count', { role: 'status' });
  const results = h('div.audit-results');
  const more = h('div.audit-more', { hidden: true });

  const syncUrl = () => ctx.replaceUrl('audit', {}, { q: filters.q, categoria: filters.category, periodo: filters.period });
  const active = () => !!(filters.q || filters.category || filters.period);

  async function fetchPage(before, limit = PAGE) {
    const data = await ctx.api.get('/api/audit', { query: { limit, before } });
    return data.events ?? [];
  }

  // Primeira página (ou atualização silenciosa): o que for novo entra no topo sem perder o que já foi carregado.
  async function load({ silent = false } = {}) {
    const id = ++requestId;
    if (!silent) results.setAttribute('aria-busy', 'true');
    try {
      const page = await fetchPage();
      if (id !== requestId || !view.alive()) return;
      // Se entraram mais eventos novos do que cabe numa página, a página nova não encosta no que já havia: recomeça dela.
      const gap = loaded && page.length >= PAGE && page.at(-1).id > (events[0]?.id ?? 0);
      if (!loaded || gap) { events = page; hasMore = page.length >= PAGE; } else events = mergeEvents(page, events);
      loaded = true;
      await ensureCovered();
      if (id !== requestId || !view.alive()) return;
      draw();
    } catch (error) {
      if (id !== requestId || !view.alive()) return;
      if (loaded) { if (!silent) showError(error); return; }
      mount(results, emptyState({
        iconName: 'alert', title: 'Não foi possível carregar a auditoria', text: error?.message,
        actions: [button('Tentar novamente', { primary: true, icon: 'refresh', onClick: () => load() })]
      }));
    } finally {
      if (id === requestId) results.removeAttribute('aria-busy');
    }
  }

  async function loadOlder() {
    if (!hasMore || busyMore || !events.length) return false;
    busyMore = true;
    try {
      const page = await fetchPage(events.at(-1).id);
      if (!view.alive()) return false;
      events = mergeEvents(events, page);
      hasMore = page.length >= PAGE;
      return page.length > 0;
    } finally {
      busyMore = false;
    }
  }

  // Um período só é confiável se os eventos carregados chegam até antes do início dele.
  async function ensureCovered() {
    for (let pages = 0; pages < COVER_MAX_PAGES && !coversPeriod(events, hasMore, filters.period); pages++) {
      if (!(await loadOlder())) break;
    }
  }

  async function changed() {
    syncUrl();
    if (!coversPeriod(events, hasMore, filters.period)) {
      results.setAttribute('aria-busy', 'true');
      try { await ensureCovered(); } catch (error) { showError(error); } finally { results.removeAttribute('aria-busy'); }
      if (!view.alive()) return;
    }
    draw();
  }

  async function showMore(trigger) {
    await runBusy(trigger, async () => {
      const gotSome = await loadOlder();
      if (!gotSome) toast('Não há registros mais antigos.');
      if (view.alive()) draw();
    });
  }

  // ---- exportação ---------------------------------------------------------------------------------------------------------
  async function exportCsv(trigger) {
    await runBusy(trigger, async () => {
      const all = [];
      let before, exhausted = false;
      for (let pages = 0; pages < EXPORT_MAX_PAGES; pages++) {
        const page = await fetchPage(before, EXPORT_PAGE);
        all.push(...page);
        if (page.length < EXPORT_PAGE) { exhausted = true; break; }
        before = page.at(-1).id;
      }
      const rows = filterEvents(mergeEvents(all), filters, { names });
      if (!rows.length) { toast('Nenhum evento para exportar com os filtros atuais.', { kind: 'error' }); return; }
      downloadBlob(auditCsvName(), new Blob([buildAuditCsv(rows, names)], { type: 'text/csv;charset=utf-8' }));
      toast(`${plural(rows.length, 'evento exportado', 'eventos exportados')}${active() ? ' (com os filtros atuais)' : ''}.${exhausted ? '' : ` Há registros mais antigos fora desta exportação (limite de ${(EXPORT_PAGE * EXPORT_MAX_PAGES).toLocaleString('pt-BR')} eventos).`}`);
    });
  }

  // ---- detalhes de um evento ----------------------------------------------------------------------------------------------
  function openEvent(event) {
    const line = (label, value) => h('div.review-line', h('span', label), h('b', value));
    const dialog = openModal({
      title: auditActionLabel(event.action), subtitle: `Evento nº ${event.id}`, size: 'normal',
      body: [
        line('Data e hora (neste navegador)', formatDateTimeSeconds(event.at)),
        line('Data e hora (UTC)', event.at),
        line('Responsável', actorLabel(event.actor) === event.actor ? event.actor : `${actorLabel(event.actor)} (${event.actor})`),
        line('Categoria', categoryLabel(categoryOf(event.action))),
        line('Código da ação', h('code', event.action)),
        line('Unidade e setor', placeLabel(event, names) || 'Não se aplica'),
        describeAudit(event) ? h('p.audit-summary', describeAudit(event)) : null,
        h('p.field-label.mt', 'Detalhes gravados'),
        h('pre.audit-json', { tabindex: '0', aria: { label: 'Detalhes gravados do evento, em formato JSON' } }, JSON.stringify(event.detail ?? {}, null, 2)),
        h('p.field-label.mt', 'Integridade'),
        line('Código deste evento (hash)', h('code.audit-hash', event.hash)),
        line('Código do evento anterior', h('code.audit-hash', event.previousHash)),
        h('p.muted.small', 'Cada evento guarda o código do anterior. Se alguém alterar um evento antigo, a cadeia deixa de bater. A TI confere isso no servidor com o comando npm run audit:verify.')
      ],
      footer: [button('Fechar', { primary: true, icon: 'check', onClick: () => dialog.close() })]
    });
  }

  // ---- desenho ------------------------------------------------------------------------------------------------------------
  function row(event) {
    const place = placeLabel(event, names), summary = describeAudit(event);
    return h('tr', { dataset: { eventId: event.id, action: event.action, category: categoryOf(event.action) } },
      h('td.audit-when', h('time', { datetime: event.at, title: `${event.at} (UTC)` }, formatDateTimeSeconds(event.at))),
      h('td.audit-actor', actorLabel(event.actor)),
      h('td', h('b', auditActionLabel(event.action)), h('small.audit-category', categoryLabel(categoryOf(event.action)))),
      h('td.audit-detail', summary || '—'),
      h('td.audit-place', place || '—'),
      h('td.col-actions', iconButton(`Ver detalhes do evento ${event.id}`, 'eye', () => openEvent(event))));
  }

  function drawMore() {
    more.hidden = !hasMore;
    if (!hasMore) { mount(more); return; }
    const note = active() ? 'A busca e os filtros valem para os eventos já carregados. Carregue mais para procurar em registros antigos.' : 'Há registros mais antigos.';
    mount(more, h('span', note), button('Carregar mais eventos', { icon: 'down', onClick: event => showMore(event.currentTarget) }));
  }

  function draw() {
    const visible = filterEvents(events, filters, { names });
    count.textContent = events.length
      ? `${plural(visible.length, 'evento', 'eventos')}${visible.length !== events.length ? ` de ${events.length} carregados` : ''}${hasMore ? ' · há registros mais antigos' : ''}`
      : '';
    drawMore();
    if (!events.length) {
      mount(results, emptyState({
        iconName: 'shield', title: 'Nenhum evento registrado ainda',
        text: everyone ? 'Quando alguém usar o painel, as ações aparecem aqui.' : 'Ainda não há eventos nas unidades e nos setores que você possui.'
      }));
      return;
    }
    if (!visible.length) {
      mount(results, emptyState({
        iconName: 'search', title: 'Nenhum evento encontrado',
        text: hasMore ? 'Ajuste a busca ou os filtros, ou carregue registros mais antigos.' : 'Ajuste a busca ou os filtros para ver os demais eventos.',
        actions: [button('Limpar filtros', { icon: 'close', onClick: clearFilters })]
      }));
      return;
    }
    mount(results, h('div.panel.table-wrap', h('table.data-table.audit-table',
      h('thead', h('tr', ['Data e hora', 'Responsável', 'Ação', 'Detalhes', 'Onde', ''].map(label => h('th', { scope: 'col' }, label)))),
      h('tbody', visible.map(row)))));
  }

  function clearFilters() {
    filters.q = ''; filters.category = ''; filters.period = '';
    search.value = ''; categorySelect.value = ''; periodSelect.value = '';
    changed();
  }

  const onSearch = debounce(() => { filters.q = search.value.trim(); syncUrl(); draw(); }, 150);
  search.addEventListener('input', onSearch);
  view.onDispose(() => onSearch.cancel());
  view.refresh = () => load({ silent: true });

  mount(container,
    pageHeading({
      eyebrow: 'ADMINISTRAÇÃO', title: 'Auditoria',
      description: 'Quem fez o quê, onde e quando na plataforma.',
      actions: [
        button('Atualizar', { icon: 'refresh', onClick: event => runBusy(event.currentTarget, () => load({ silent: false })) }),
        button('Exportar CSV', { primary: true, icon: 'download', onClick: event => exportCsv(event.currentTarget) })
      ]
    }),
    notice(everyone
      ? 'Você vê os eventos de todas as unidades e de todos os setores.'
      : 'Você vê somente os eventos das unidades e dos setores que possui.', { tone: 'info', iconName: 'shield', className: 'mb' }),
    h('p.muted.small.audit-note', icon('lock'), ' Cada evento é ligado ao anterior por um código de verificação (hash), o que ajuda a perceber alterações indevidas; isso não substitui a guarda de cópias externas nem a política de retenção da TI. Os horários na tela seguem o fuso deste navegador; o arquivo CSV traz a data em UTC. Senhas e chaves nunca são gravadas.'),
    h('div.toolbar', h('div.field-search', icon('search'), search), categorySelect, periodSelect),
    count, results, more);

  await load();
}
