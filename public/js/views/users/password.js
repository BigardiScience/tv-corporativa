// Redefinição de senha por um Administrador (função que já existia na versão 1.1.0 e continua só com a TI).
// Quem define a senha a conhece; por isso a janela orienta a entrega por canal seguro. O fluxo "Esqueci minha senha" com
// aprovação administrativa, em que o administrador não vê a senha nova, é uma fase posterior e ainda não existe.
import { h } from '../../ui/dom.js';
import { openModal } from '../../ui/dialogs.js';
import { button, notice } from '../../ui/components.js';
import { runBusy } from '../../ui/feedback.js';
import { passwordField } from './password-field.js';
import { hasPermission } from '../../lib/permissions.js';

// Devolve (pela promessa) o usuário atualizado, ou undefined se a janela for cancelada.
export function openResetPassword(ctx, user) {
  if (!hasPermission(ctx.user, 'user:manage')) return Promise.resolve(undefined);
  const self = user.id === ctx.user.id;
  let dialog;
  const password = passwordField({ id: 'reset-password', label: 'Nova senha', confirmLabel: 'Confirmar a nova senha', onInput: () => dialog?.clearError() });
  async function submit() {
    const problems = password.problems();
    if (problems.length) { dialog.setError(problems.join(' ')); password.focus(); return; }
    dialog.clearError();
    const saved = await runBusy(confirm, () => ctx.api.patch(`/api/users/${encodeURIComponent(user.id)}`, { password: password.value() }), { dialog });
    if (saved !== undefined) dialog.close(saved);
  }
  const confirm = button('Redefinir senha', { primary: true, icon: 'key', onClick: submit });
  dialog = openModal({
    title: 'Redefinir senha', subtitle: `${user.name} · ${user.email}`, size: 'small',
    body: [
      notice(self ? 'Você está redefinindo a sua própria senha. Ao salvar, sua sessão será encerrada.' : 'A nova senha vale na hora e a pessoa é desconectada de todos os aparelhos.', { tone: 'warning', iconName: 'alert', className: 'mb' }),
      h('form.form-grid', { on: { submit: event => { event.preventDefault(); submit(); } } }, password.el),
      notice('Copie ou anote a senha antes de salvar e entregue-a por um canal seguro. Ela não é exibida de novo nem registrada.', { tone: 'info', iconName: 'lock', className: 'mt' })
    ],
    footer: [button('Cancelar', { onClick: () => dialog.close() }), confirm]
  });
  return dialog.closed;
}
