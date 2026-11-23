// Configurações (sem DOM): validação do cadastro de unidades e setores e as linhas de situação do ambiente.
// O servidor valida de novo (permissão settings:manage, tamanho, nome repetido); aqui se evita o vai-e-volta.
import { fold } from './format.js';

export const NAME_MAX = 120;

// Os trechos de gramática ficam aqui (a unidade / o setor) para as telas não montarem frases com remendos.
export const ORG_KINDS = Object.freeze({
  units: Object.freeze({
    noun: 'unidade', article: 'a', to: 'à unidade', plural: 'unidades', newOne: 'a nova unidade', nameOf: 'da unidade', anExisting: 'uma unidade',
    create: 'Nova unidade', created: 'Unidade criada.', saved: 'Unidade salva.', edit: name => `Editar a unidade ${name}`
  }),
  sectors: Object.freeze({
    noun: 'setor', article: 'o', to: 'ao setor', plural: 'setores', newOne: 'o novo setor', nameOf: 'do setor', anExisting: 'um setor',
    create: 'Novo setor', created: 'Setor criado.', saved: 'Setor salvo.', edit: name => `Editar o setor ${name}`
  })
});

// Mesma ideia da chave de unicidade do servidor: sem acentos, minúsculas e espaços normalizados.
export const nameKey = text => fold(text).replace(/\s+/g, ' ').trim();

// kind: 'units' | 'sectors'.  existing: lista atual ({ id, name }).  selfId: o registro em edição (não conflita consigo mesmo).
export function validateOrganizationForm(kind, { name, city = '' }, { existing = [], selfId = null } = {}) {
  const spec = ORG_KINDS[kind];
  if (!spec) throw new RangeError('Tipo de cadastro desconhecido.');
  const problems = [];
  const title = String(name ?? '').trim();
  if (!title) problems.push(`Informe o nome ${spec.nameOf}.`);
  else if (title.length > NAME_MAX) problems.push(`O nome ${spec.nameOf} pode ter até ${NAME_MAX} caracteres.`);
  else if (existing.some(item => item.id !== selfId && nameKey(item.name) === nameKey(title))) problems.push(`Já existe ${spec.anExisting} com este nome.`);
  if (kind === 'units' && String(city ?? '').trim().length > NAME_MAX) problems.push(`A cidade pode ter até ${NAME_MAX} caracteres.`);
  return problems;
}

// Situação dos controles de segurança mostrada na tela. `tone`: ok (ativo), pending (precisa de ação ou não existe ainda).
export function securityRows({ scannerConfigured, mode } = {}) {
  return [
    { label: 'Controle por unidade e setor', status: 'Ativo', tone: 'ok' },
    { label: 'Permissões conferidas no servidor', status: 'Ativas', tone: 'ok' },
    { label: 'Sessão e proteção CSRF', status: 'Ativos', tone: 'ok' },
    { label: 'Trilha de auditoria encadeada', status: 'Ativa', tone: 'ok' },
    scannerConfigured
      ? { label: 'Verificação antivírus dos arquivos', status: 'Configurada', tone: 'ok' }
      : { label: 'Verificação antivírus dos arquivos', status: mode === 'production' ? 'Configuração necessária' : 'Não configurada (ambiente local)', tone: 'pending' },
    { label: 'Login único Microsoft Entra ID (SSO)', status: 'Integração pendente', tone: 'pending' }
  ];
}

export const modeLabel = mode => (mode === 'production' ? 'Ambiente corporativo (produção)' : 'Ambiente local de testes');

// Linhas "rótulo → valor" do cartão Ambiente e suporte. `schema` pode faltar (a consulta ao servidor é opcional).
export function environmentRows({ mode, version, limits = {}, schema } = {}) {
  const rows = [
    ['Modo', modeLabel(mode)],
    ['Versão da plataforma', version ? String(version) : '—'],
    ['Esquema do banco de dados', Number.isInteger(schema) ? String(schema) : '—']
  ];
  if (Number.isFinite(limits.maxUploadMB)) rows.push(['Tamanho máximo por arquivo', `${limits.maxUploadMB} MB`]);
  if (Number.isFinite(limits.playlistMaxItems)) rows.push(['Conteúdos por playlist (máximo)', String(limits.playlistMaxItems)]);
  if (Number.isFinite(limits.folderMaxDepth)) rows.push(['Níveis de pastas (máximo)', String(limits.folderMaxDepth)]);
  return rows;
}
