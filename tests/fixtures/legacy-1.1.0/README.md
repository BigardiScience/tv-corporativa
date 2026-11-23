# Fixture: servidor da versão 1.1.0

`core.mjs` é uma cópia **sem alterações** do `server/core.mjs` da versão 1.1.0. Ele existe apenas para os testes de
migração criarem, com o código real da versão antiga, um banco SQLite autêntico (usuários, TVs pareadas, mídias,
publicações e auditoria) e provarem que a versão atual o atualiza sem perder dados.

Não é carregado pelo servidor e não deve ser editado.
