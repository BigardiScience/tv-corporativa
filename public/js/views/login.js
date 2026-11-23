// Tela pública de acesso. Nenhum dado do painel é carregado antes da autenticação.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

// `state`: { ready, configured, unavailable, message }
// `actions`: { submit({ email, password }), retry(), accessibility() }
export function loginView(state, actions) {
  const { ready = false, configured = false, unavailable = false, message = '' } = state;
  let pending = false;
  const error = h('div#login-error.error-box', { role: 'alert', tabindex: '-1', hidden: !message }, message);
  const email = h('input#login-email', {
    name: 'email', type: 'email', autocomplete: 'username', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false', maxlength: '254', required: true,
    placeholder: 'seu.nome@empresa.com.br'
  });
  const password = h('input#login-password', { name: 'password', type: 'password', autocomplete: 'current-password', maxlength: '128', required: true, placeholder: 'Digite sua senha' });
  const toggle = h('button', {
    type: 'button', aria: { controls: 'login-password', label: 'Mostrar senha', pressed: 'false' },
    on: {
      click: event => {
        const visible = password.type === 'password';
        password.type = visible ? 'text' : 'password';
        event.currentTarget.textContent = visible ? 'Ocultar' : 'Mostrar';
        event.currentTarget.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
        event.currentTarget.setAttribute('aria-pressed', String(visible));
      }
    }
  }, 'Mostrar');
  const submit = h('button#login-submit.button.primary.access-submit', { type: 'submit', disabled: !ready || unavailable || !configured }, icon('arrow'), ready ? ' Entrar na plataforma' : ' Verificando conexão…');

  const form = h('form#login-form.access-form', {
    on: {
      submit: async event => {
        event.preventDefault();
        if (pending || !form.reportValidity()) return;
        pending = true; submit.disabled = true; submit.setAttribute('aria-busy', 'true'); error.hidden = true;
        try {
          await actions.submit({ email: email.value, password: password.value });
        } catch (failure) {
          error.textContent = failure?.message || 'Não foi possível entrar.';
          error.hidden = false;
          error.focus();
          password.value = '';
        } finally {
          pending = false;
          if (submit.isConnected) { submit.disabled = !ready || unavailable || !configured; submit.removeAttribute('aria-busy'); }
        }
      }
    }
  },
  h('div.field', h('label', { for: 'login-email' }, 'E-mail corporativo'), email),
  h('div.field', h('label', { for: 'login-password' }, 'Senha'), h('div.password-field', password, toggle)),
  submit);

  const unavailableNotice = unavailable
    ? h('div.notice', icon('info'), h('div', 'Não foi possível conectar ao servidor. Inicie a plataforma na sua máquina e tente novamente.',
      h('button.subtle-link.mt', { type: 'button', on: { click: actions.retry } }, 'Tentar conexão novamente ', icon('arrow'))))
    : ready && !configured
      ? h('div.notice.info', icon('settings'), h('div', h('strong', 'Primeira configuração'),
        'A TI deve executar ', h('code', 'npm.cmd run configure'), ' na pasta do projeto para criar o primeiro administrador. Não existe usuário ou senha padrão.',
        h('button.subtle-link.mt', { type: 'button', on: { click: actions.retry } }, 'Já configurei · verificar novamente ', icon('arrow'))))
      : null;

  return h('main#main.access-page', { tabindex: '-1' },
    h('section.access-story', { aria: { label: 'TV Corporativa, comunicação corporativa' } },
      h('img.access-photo', { src: '/assets/destaque.jpg', alt: 'Ilustração de telas exibindo comunicados' }),
      h('div.access-brand', h('img', { src: '/assets/logo.png', alt: 'TV Corporativa' }), h('span', 'TV CORPORATIVA')),
      h('div.access-message',
        h('div.hero-eyebrow', h('i.live-dot'), 'COMUNICAÇÃO QUE TRANSFORMA'),
        h('h1', 'Informação que conecta.', h('br'), h('span', 'Pessoas que transformam.')),
        h('p', 'Um espaço para compartilhar o que importa.', h('br'), 'Em cada equipe. Em cada unidade.'),
        h('div.access-units', ['Centro', 'Leste', 'Vila Norte', 'Oeste'].map(name => h('span', name)))),
      h('div.access-story-footer', 'TV CORPORATIVA ', h('span', 'Seu ponto de conexão.'))),
    h('section.access-panel', { aria: { labelledby: 'access-title' } },
      h('div.access-top', h('span', icon('shield'), ' ACESSO INDIVIDUAL'),
        h('button.icon-button', { type: 'button', aria: { label: 'Recursos de acessibilidade' }, on: { click: actions.accessibility } }, icon('access'))),
      h('div.access-form-wrap',
        h('span.access-lock', icon('lock')),
        h('p.eyebrow', 'BEM-VINDO À TV CORPORATIVA'),
        h('h2#access-title', 'Sua comunicação', h('br'), 'começa aqui.'),
        h('p.access-intro', 'Entre com o e-mail e a senha fornecidos pelo administrador.'),
        error, unavailableNotice, form,
        h('div.access-help', icon('help'), h('div', h('strong', 'Precisa de acesso ou esqueceu sua senha?'),
          h('p', 'Procure a equipe de TI da empresa. Cadastro de usuário, acessos e redefinição de senha são realizados somente pela TI.')))),
      h('footer.access-footer', `© ${new Date().getFullYear()} TV Corporativa `, h('span', 'Comunicação que conecta.'))));
}
