// Contas existentes (versão 1.1.0) mantêm perfil, escopo, senha e situação exatamente como estavam.
//
// Permissões: o novo catálogo concede, por padrão, mais capacidades a Gestor e Editor (cadastrar/ativar TVs, gerenciar
// usuários de forma limitada, consultar a auditoria do escopo). Para NINGUÉM ganhar poder administrativo sem que o
// Administrador decida, estas contas recebem "permissões retiradas" (revokes) equivalentes ao que o perfil podia na 1.1.0.
// Nada que a pessoa já podia fazer é retirado. O Administrador libera cada capacidade nova em Usuários → Permissões.
const PRESERVE_1_1_0 = Object.freeze({
  manager: ['user:manage', 'audit:read', 'screen:create', 'screen:activate', 'screen:update', 'screen:delete'],
  editor: ['screen:create']
});

export default {
  id: 6,
  name: 'usuarios-permissoes-individuais',
  up(db) {
    const rows = db.prepare('SELECT id, data FROM users').all();
    const update = db.prepare('UPDATE users SET data=? WHERE id=?');
    let changed = 0, restricted = 0;
    for (const row of rows) {
      const user = JSON.parse(row.data);
      const hadPermissionFields = Array.isArray(user.grants) || Array.isArray(user.revokes);
      const revokes = Array.isArray(user.revokes) ? user.revokes : (hadPermissionFields ? [] : [...(PRESERVE_1_1_0[user.role] ?? [])]);
      const next = {
        ...user, grants: Array.isArray(user.grants) ? user.grants : [], revokes,
        unitIds: Array.isArray(user.unitIds) ? user.unitIds : [], sectorIds: Array.isArray(user.sectorIds) ? user.sectorIds : []
      };
      if (revokes.length && !Array.isArray(user.revokes)) restricted++;
      if (JSON.stringify(next) !== JSON.stringify(user)) { update.run(JSON.stringify(next), row.id); changed++; }
    }
    return { users: rows.length, updated: changed, withPreservedPrivileges: restricted };
  }
};
