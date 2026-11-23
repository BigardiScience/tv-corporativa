// Leitura dos registros do formato 1.1.0 (tabela genérica `records`) para as migrações.
export function legacyRecords(db, kind) {
  return db.prepare('SELECT id, data FROM records WHERE kind=? ORDER BY rowid').all(kind).map(row => {
    try {
      const value = JSON.parse(row.data);
      if (!value || typeof value !== 'object') throw new Error('não é um objeto');
      return { ...value, id: value.id ?? row.id };
    } catch (error) {
      throw new Error(`o registro ${kind}/${row.id} está ilegível no banco de origem (${error.message})`);
    }
  });
}

export const countOf = (db, table) => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
