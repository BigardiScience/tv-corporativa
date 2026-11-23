// Campo de senha com confirmação, "mostrar/ocultar" e gerador de senha segura (gerador criptográfico do navegador).
// A senha existe só nestes campos, enquanto a janela está aberta: nada é guardado, registrado ou enviado a outro lugar.
// A confirmação existia na redefinição de senha da versão 1.1.0 e continua: uma senha digitada errada seria uma senha que ninguém sabe.
import { h, mount } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { button } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { PASSWORD_MAX, PASSWORD_MIN, generatePassword, validatePasswordPair } from '../../lib/user-model.js';

// `onInput`: chamado quando um valor muda (digitação ou geração), para a janela limpar um aviso de erro que ficou velho.
export function passwordField({ id, label = 'Senha', confirmLabel = 'Confirmar a senha', hint = `Entre ${PASSWORD_MIN} e ${PASSWORD_MAX} caracteres.`, onInput } = {}) {
  const make = (inputId, name) => h('input', {
    id: inputId, name, type: 'password', autocomplete: 'new-password', maxlength: String(PASSWORD_MAX), spellcheck: 'false', autocapitalize: 'off',
    on: { input: () => onInput?.() }
  });
  const input = make(id, 'password'), confirmation = make(`${id}-confirm`, 'confirmPassword');

  const toggle = button('Mostrar', { icon: 'eye', className: 'small', aria: { pressed: 'false' }, onClick: () => setVisible(input.type === 'password') });
  function setVisible(visible) {
    input.type = confirmation.type = visible ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(visible));
    mount(toggle, icon('eye'), visible ? 'Ocultar' : 'Mostrar');
  }

  const generate = button('Gerar senha segura', {
    icon: 'key', className: 'small',
    onClick: () => {
      try {
        input.value = confirmation.value = generatePassword();
        setVisible(true);
        input.focus();
        onInput?.();
      } catch (error) { toast(error?.message || 'Não foi possível gerar a senha neste navegador.', { kind: 'error' }); }
    }
  });
  const copy = button('Copiar', {
    icon: 'copy', className: 'small',
    onClick: async () => {
      if (!input.value) { toast('Não há senha para copiar.', { kind: 'error' }); return; }
      try { await globalThis.navigator.clipboard.writeText(input.value); toast('Senha copiada. Cole-a onde combinou entregar e depois limpe a área de transferência.'); } catch { toast('Não foi possível copiar automaticamente. Selecione e copie manualmente.', { kind: 'error' }); }
    }
  });

  const el = h('div.field.full',
    h('label', { for: id }, label),
    h('div.password-row', input, toggle),
    h('div.password-tools', generate, copy),
    h('label.confirm-label', { for: `${id}-confirm` }, confirmLabel),
    h('div.password-row', confirmation),
    hint ? h('small', hint) : null);
  return {
    el, input, confirmation,
    value: () => input.value, confirmValue: () => confirmation.value,
    // Mensagens de erro (lista vazia = pode enviar): tamanho e confirmação igual.
    problems: () => validatePasswordPair(input.value, confirmation.value),
    focus: () => input.focus()
  };
}
