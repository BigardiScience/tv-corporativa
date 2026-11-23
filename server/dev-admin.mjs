// Criação do primeiro administrador a partir de variáveis de ambiente, SOMENTE em NODE_ENV=development
// (homologação em hospedagem de disco efêmero, como o Render). Nenhuma credencial fica no código-fonte.
export function bootstrapDevAdmin(app, env = process.env, log = console) {
  if (env.NODE_ENV !== 'development' || app.configured()) return false;
  const { TEST_ADMIN_NAME: name, TEST_ADMIN_EMAIL: email, TEST_ADMIN_PASSWORD: password } = env;
  if (!name || !email || !password) return false;
  app.createAdmin(name, email, password);
  log.info?.('Administrador de teste criado a partir das variáveis TEST_ADMIN_* (somente homologação).');
  return true;
}
