// Estado da versão 1.1.0. Em um banco existente não altera nada; em um banco novo cria as tabelas de base.
export default {
  id: 1,
  name: 'baseline-1.1.0',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind, id));
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, userId TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL, previousHash TEXT NOT NULL, hash TEXT NOT NULL);
    `);
    return {};
  }
};
