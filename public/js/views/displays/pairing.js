// Janela com o código de pareamento de uma TV. O código aparece SOMENTE aqui e agora: o servidor guarda apenas o hash,
// então não há como consultá-lo depois (para outro código, use "Código de pareamento" na lista).
import { h } from '../../ui/dom.js';
import { openModal } from '../../ui/dialogs.js';
import { button, notice } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { expiryLabel, spokenCode } from '../../lib/display-model.js';

export function openPairingDialog(ctx, { display, code, expiresAt }) {
  const address = `${globalThis.location.origin}/player.html`;
  const copy = async text => {
    try { await globalThis.navigator.clipboard.writeText(text); toast('Copiado.'); } catch { toast('Não foi possível copiar automaticamente. Selecione e copie manualmente.', { kind: 'error' }); }
  };
  const addressInput = h('input#player-address', { type: 'text', readOnly: true, value: address, aria: { label: 'Endereço do player' }, on: { click: event => event.target.select() } });
  const dialog = openModal({
    title: 'Código de pareamento', subtitle: `${display.name} · ${ctx.unitName(display.unitId)}`, size: 'small',
    body: [
      h('p.muted.pair-help', 'Na TV ou no mini-PC, abra o endereço abaixo e digite este código. Ele vale por 10 minutos e só pode ser usado uma vez.'),
      h('div.pair-code', { role: 'group', aria: { label: `Código de pareamento: ${spokenCode(code)}` } }, code),
      h('p.pair-expiry', `Válido ${expiryLabel(expiresAt)}. Ele aparece só agora: se fechar esta janela, gere outro na lista de TVs.`),
      h('div.field', h('label', { for: 'player-address' }, 'Endereço do player'), addressInput),
      notice('Para outras TVs, a TI precisa disponibilizar este servidor na rede da empresa, com HTTPS. O endereço 127.0.0.1 só funciona neste computador.', { tone: 'info', className: 'mt' })
    ],
    footer: [button('Copiar código', { icon: 'copy', onClick: () => copy(code) }), button('Concluir', { primary: true, icon: 'check', onClick: () => dialog.close() })]
  });
  return dialog.closed;
}
