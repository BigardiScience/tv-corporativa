// Filtros da Biblioteca ↔ endereço (hash) ↔ consulta à API. Sem DOM.
// Endereço: #/biblioteca/<pasta>?q=…&tipo=image&situacao=pending&ordenar=date&ordem=desc&plano=1&tudo=1
//   plano=1  → lista plana (inclui subpastas)         tudo=1 → pesquisa em todo o espaço (não só na pasta aberta)

export const TYPE_VALUES = Object.freeze(['image', 'video', 'pdf']);
export const STATUS_VALUES = Object.freeze(['pending', 'approved', 'rejected']);
export const SORT_VALUES = Object.freeze(['name', 'date', 'type', 'size', 'status']);
export const PAGE_SIZE = 60;

export const defaultFilters = () => ({ q: '', type: '', status: '', sort: 'name', order: 'asc', flat: false, wholeSpace: false });

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export function parseLibraryQuery(query = {}) {
  return {
    q: String(query.q ?? '').trim().slice(0, 100),
    type: pick(query.tipo, TYPE_VALUES, ''),
    status: pick(query.situacao, STATUS_VALUES, ''),
    sort: pick(query.ordenar, SORT_VALUES, 'name'),
    order: pick(query.ordem, ['asc', 'desc'], 'asc'),
    flat: query.plano === '1',
    wholeSpace: query.tudo === '1'
  };
}

// Só o que difere do padrão vai para o endereço, para ele ficar curto e legível.
export function toRouteQuery(filters) {
  const base = defaultFilters(), query = {};
  if (filters.q) query.q = filters.q;
  if (filters.type) query.tipo = filters.type;
  if (filters.status) query.situacao = filters.status;
  if (filters.sort !== base.sort) query.ordenar = filters.sort;
  if (filters.order !== base.order) query.ordem = filters.order;
  if (filters.flat) query.plano = '1';
  if (filters.wholeSpace) query.tudo = '1';
  return query;
}

// Consulta para GET /api/library. "Pesquisar em todo o espaço" só faz sentido com texto digitado.
export function toApiQuery({ space, folderId, filters, offset = 0, limit = PAGE_SIZE }) {
  const query = { unitId: space.unitId, sectorId: space.sectorId, limit, offset, sort: filters.sort, order: filters.order };
  if (folderId) query.folderId = folderId;
  if (filters.q) query.q = filters.q;
  if (filters.type) query.type = filters.type;
  if (filters.status) query.status = filters.status;
  if (filters.flat) query.flat = '1';
  if (filters.q && filters.wholeSpace) query.search = 'space';
  return query;
}

// Há algo além da navegação normal (ordenação não conta)?
export const hasActiveFilters = filters => !!(filters.q || filters.type || filters.status || filters.flat);

// A lista mostra arquivos de várias pastas (precisa indicar de onde cada um vem)?
export const isFlatListing = response => !!response?.query?.flat;
