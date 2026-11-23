import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openDatabase(config) {
  mkdirSync(path.dirname(config.dbPath), { recursive: true, mode: 0o700 });
  mkdirSync(config.mediaDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  return db;
}

// Transação com aninhamento por SAVEPOINT. O servidor é de processo único e o SQLite é síncrono:
// o corpo da transação NÃO pode conter `await`, senão outra requisição entraria no meio dela.
export function createTransaction(db) {
  let depth = 0;
  return function transaction(body) {
    const outermost = depth === 0, savepoint = `pwc_sp_${depth}`;
    db.exec(outermost ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
    depth++;
    try {
      const result = body();
      if (result && typeof result.then === 'function') throw new Error('Transações do banco não podem ser assíncronas.');
      db.exec(outermost ? 'COMMIT' : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(outermost ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`); } catch { /* A transação já pode ter sido encerrada pelo SQLite. */ }
      throw error;
    } finally {
      depth--;
    }
  };
}
