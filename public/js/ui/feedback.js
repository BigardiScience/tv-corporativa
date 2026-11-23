// Tratamento padrão de erros e de "operação em andamento" para botões e formulários.
import { isAbort } from '../lib/api.js';
import { toast } from './toast.js';

// 401 já foi tratado pela sessão (volta ao login); cancelamentos não são erro.
export const isHandled = error => error?.status === 401 || isAbort(error);

export function showError(error, dialog) {
  if (isHandled(error)) return;
  const message = error?.message || 'Não foi possível concluir a ação.';
  if (dialog && dialog.el?.isConnected) dialog.setError(message); else toast(message, { kind: 'error' });
}

// Executa `work` com o botão desabilitado e "aria-busy". Erros viram mensagem na janela (se houver) ou aviso.
export async function runBusy(button, work, { dialog } = {}) {
  if (button?.disabled) return undefined;
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  dialog?.clearError();
  try {
    return await work();
  } catch (error) {
    showError(error, dialog);
    return undefined;
  } finally {
    if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
}

// Atalho para botões: `on: { click: action(async () => {...}) }`.
export const action = (work, options = {}) => event => runBusy(event.currentTarget, () => work(event), options);
