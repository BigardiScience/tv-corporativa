// Exportação de CSV da auditoria, com proteção contra "injeção de fórmula": uma célula que começa com = + - @ (ou tab/retorno)
// seria executada como fórmula ao abrir no Excel. Prefixar com apóstrofo faz a planilha tratar a célula como texto.
import { describeAudit } from './audit-model.js';
import { auditActionLabel } from './format.js';

export function csvCell(value) {
  return `"${String(value ?? '').replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""')}"`;
}

export function buildAuditCsv(events, { unitName = id => id, sectorName = id => id } = {}) {
  // As quatro primeiras colunas seguem o formato da versão 1.1.0; a data é ISO 8601 em UTC.
  const header = ['Data', 'Responsável', 'Ação', 'Detalhes', 'Descrição', 'Unidade', 'Setor', 'Resumo'];
  const rows = events.map(event => [
    event.at, event.actor, event.action, JSON.stringify(event.detail ?? {}), auditActionLabel(event.action),
    event.unitId ? unitName(event.unitId) : '', event.sectorId ? sectorName(event.sectorId) : '', describeAudit(event)
  ]);
  // BOM no começo: o Excel reconhece o arquivo como UTF-8 e mostra os acentos corretamente.
  return `﻿${[header, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n')}`;
}

export const auditCsvName = (date = new Date()) => `tvcorp-auditoria-${date.toISOString().slice(0, 10)}.csv`;
