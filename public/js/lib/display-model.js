// Regras de apoio da tela de TVs (sem DOM): estado do pareamento, ações disponíveis e validação do nome.
// O servidor decide de verdade (permissão + unidade + setor); aqui só se evita mostrar botões que não fazem sentido.
import { relativeTime } from './format.js';

// Situação do pareamento para quem olha a lista. "Pareada" não quer dizer "no ar": só que a TV já recebeu a sua credencial.
export function pairingState(display) {
  if (display.status !== 'active') return { key: 'inactive', label: 'Aguardando ativação', tone: 'warning' };
  if (display.pairingOpen) return { key: 'open', label: 'Código aberto, aguardando a TV', tone: 'warning' };
  if (display.paired) return { key: 'paired', label: 'Pareada', tone: '' };
  return { key: 'none', label: 'Sem código ativo', tone: 'neutral' };
}

// `can`: { activate, update, delete, pair } já avaliados para a unidade e o setor da pessoa (`pair`: permissão própria de gerar o código + acesso à TV).
export function displayActions(display, can) {
  return {
    activate: !!can.activate && display.status === 'pending',
    pairing: !!can.activate && display.status === 'active',
    // Editor e Gestor: gera um código novo SEM desconectar a TV (quem administra TVs usa `pairing`, que desconecta).
    generateCode: !!can.pair && !can.activate && display.status === 'active',
    rename: !!can.update,
    remove: !!can.delete
  };
}

export function validateDisplayName(name) {
  const value = String(name ?? '').trim();
  if (!value) return ['Informe o nome da TV.'];
  if (value.length > 120) return ['O nome pode ter até 120 caracteres.'];
  return [];
}

// "até 14:32" a partir do instante de validade do código (ISO).
export function expiryLabel(expiresAt, { timeZone } = {}) {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return '';
  return `até ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone }).format(date)}`;
}

// Código de 6 números separado em dois grupos para leitura em voz alta: "123 456".
export const spokenCode = code => String(code ?? '').replace(/\D/g, '').replace(/^(\d{3})(\d{3})$/, '$1 $2');

// Texto de contato sob o nome da TV. "Online" é decidido pelo servidor; aqui só se descreve o último contato.
export function contactLabel(display, now = Date.now()) {
  if (display.status !== 'active') return `Cadastrada ${relativeTime(display.createdAt, now)}`;
  return display.lastSeen ? `Último contato: ${relativeTime(display.lastSeen, now)}` : 'Ainda sem contato com o servidor';
}
