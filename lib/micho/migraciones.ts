import type Database from 'better-sqlite3';

/**
 * Micho Store schema changes that are not additive, run on every boot and
 * no-ops once applied. Hartask's own rule is additive-only columns; these
 * are the exceptions, each one detected from the live schema rather than
 * tracked by version, so a database at any point catches up.
 */
export function migrarMicho(db: Database.Database): void {
  insumosUnicoPorMarca(db);
}

/**
 * micho_insumos started with UNIQUE(nombre). With brands, "PETG" from two
 * brands are two supplies, so the constraint becomes UNIQUE(nombre, marca).
 * SQLite cannot alter a constraint: the table is rebuilt the documented way
 * (new table, copy, drop, rename) with foreign keys off, keeping every id so
 * product lines, stock, movements and machine slots still point at the same
 * supply.
 */
function insumosUnicoPorMarca(db: Database.Database): void {
  const fila = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'micho_insumos'`).get() as
    | { sql: string }
    | undefined;
  if (!fila || !/nombre\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(fila.sql)) return;

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE micho_insumos_nueva (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre TEXT NOT NULL COLLATE NOCASE,
          marca TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
          tipo TEXT NOT NULL DEFAULT 'Material',
          unidad TEXT NOT NULL,
          precio REAL,
          precio_compra REAL,
          presentacion REAL NOT NULL DEFAULT 1,
          temp_cama REAL,
          uso TEXT,
          notas TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(nombre, marca)
        );
        INSERT INTO micho_insumos_nueva
          (id, nombre, marca, tipo, unidad, precio, precio_compra, presentacion, temp_cama, uso, notas, updated_at)
          SELECT id, nombre, COALESCE(marca, ''), tipo, unidad, precio, precio_compra, presentacion, temp_cama, uso,
                 notas, updated_at
            FROM micho_insumos;
        DROP TABLE micho_insumos;
        ALTER TABLE micho_insumos_nueva RENAME TO micho_insumos;
      `);
      const rotas = db.pragma('foreign_key_check') as unknown[];
      if (rotas.length) throw new Error(`micho_insumos: ${rotas.length} referencias rotas tras migrar`);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
