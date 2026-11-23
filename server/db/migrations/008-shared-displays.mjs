import { randomUUID } from 'node:crypto';

// Adição compatível: preserva IDs, credenciais, mídias, versões e o setor legado da TV.
export default {
  id: 8,
  name: 'telas-compartilhadas-acessos-fila',
  up(db) {
    db.exec(`
      ALTER TABLE displays ADD COLUMN access_rev INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE displays ADD COLUMN order_rev INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE displays ADD COLUMN removed_at TEXT;
      CREATE TABLE display_grants(
        id TEXT PRIMARY KEY, display_id TEXT NOT NULL REFERENCES displays(id),
        principal_type TEXT NOT NULL CHECK(principal_type IN ('sector','user')), principal_id TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL, created_by TEXT,
        revoked_at TEXT, revoked_by TEXT
      );
      CREATE UNIQUE INDEX display_grants_active ON display_grants(display_id,principal_type,principal_id) WHERE active=1;
      ALTER TABLE schedule_displays ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE schedule_displays ADD COLUMN link_status TEXT NOT NULL DEFAULT 'active' CHECK(link_status IN ('active','suspended','removed'));
      ALTER TABLE schedule_displays ADD COLUMN authorized_by TEXT;
      ALTER TABLE schedule_displays ADD COLUMN legacy_authorized INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE schedule_displays ADD COLUMN suspended_at TEXT;
      ALTER TABLE schedule_displays ADD COLUMN suspension_reason TEXT;
      ALTER TABLE schedule_displays ADD COLUMN linked_at TEXT;
      CREATE TABLE schedule_display_history(
        id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_id TEXT NOT NULL, display_id TEXT NOT NULL,
        action TEXT NOT NULL, actor_id TEXT, at TEXT NOT NULL, detail TEXT NOT NULL
      );
      CREATE INDEX schedule_display_history_link ON schedule_display_history(schedule_id,display_id,id);
    `);
    const at=new Date().toISOString();
    const grant=db.prepare('INSERT INTO display_grants(id,display_id,principal_type,principal_id,created_at,created_by) VALUES(?,?,?,?,?,NULL)');
    for(const display of db.prepare('SELECT id,sector_id FROM displays').all())grant.run(randomUUID(),display.id,'sector',display.sector_id,at);
    const links=db.prepare(`SELECT sd.schedule_id,sd.display_id,s.published_by,s.updated_by,s.created_by,s.published_at,s.created_at
      FROM schedule_displays sd JOIN schedules s ON s.id=sd.schedule_id ORDER BY sd.display_id,s.published_at,s.id`).all();
    const positions=new Map();let legacyAnonymous=0;
    for(const link of links){
      const author=link.published_by??link.updated_by??link.created_by??null;
      // Somente ausência histórica de autor recebe compatibilidade. ID inexistente ou conta desativada nunca é liberado.
      const legacy=author===null?1:0;legacyAnonymous+=legacy;
      const position=positions.get(link.display_id)??0;positions.set(link.display_id,position+1);
      db.prepare('UPDATE schedule_displays SET position=?,authorized_by=?,legacy_authorized=?,linked_at=? WHERE schedule_id=? AND display_id=?')
        .run(position,author,legacy,link.published_at??link.created_at??at,link.schedule_id,link.display_id);
    }
    return { displays:db.prepare('SELECT COUNT(*) AS n FROM displays').get().n,grants:db.prepare('SELECT COUNT(*) AS n FROM display_grants').get().n,links:links.length,legacyWithoutAuthor:legacyAnonymous };
  }
};
