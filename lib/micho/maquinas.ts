import { getDb } from '@/lib/db/client';
import { slugDe } from '@/lib/micho/catalogo';

/**
 * The workshop's machines. What a machine is (model, nickname, type, how many
 * consumables it holds at once) and its live state (status, what is loaded,
 * its job queue) live here; its info, tasks and log live in its ficha, keyed
 * `maquina:<slug>`, exactly like a product's.
 */

export const TIPOS_MAQUINA = ['Impresora 3D', 'Láser diodo', 'Láser fibra', 'Láser CO2', 'Otra'] as const;
export const ESTADOS_MAQUINA = ['Activa', 'Trabajando', 'Por calibrar', 'Falla', 'Fuera de servicio'] as const;
export const ESTADOS_COLA = ['En cola', 'En curso', 'Hecho', 'Cancelado'] as const;

export type TipoMaquina = (typeof TIPOS_MAQUINA)[number];
export type EstadoMaquina = (typeof ESTADOS_MAQUINA)[number];
export type EstadoCola = (typeof ESTADOS_COLA)[number];

export type Maquina = {
  id: number;
  slug: string;
  nombre: string;
  apodo: string | null;
  tipo: TipoMaquina;
  estado: EstadoMaquina;
  ranuras: number;
  orden: number;
  created_at: string;
  updated_at: string;
};

export type Detalle = { id: number; maquina_id: number; clave: string; valor: string | null; orden: number };

export type Consumible = {
  ranura: number;
  insumo_id: number | null;
  insumo: string | null;
  unidad: string | null;
  color: string | null;
  nota: string | null;
};

export type Trabajo = {
  id: number;
  maquina_id: number;
  producto_slug: string | null;
  descripcion: string | null;
  piezas: number;
  estado: EstadoCola;
  orden: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

/** The key a machine's ficha is stored under, apart from product slugs. */
export function claveFicha(slug: string): string {
  return `maquina:${slug}`;
}

/** Which details each kind of machine starts with: names only, the values are yours. */
export const DETALLES_BASE: Record<string, string[]> = {
  'Impresora 3D': ['Boquilla', 'Volumen de impresión', 'Cama', 'Filamentos que acepta', 'Extrusor', 'Software / perfil', 'Firmware'],
  'Láser diodo': ['Potencia del módulo', 'Área de trabajo', 'Spot / enfoque', 'Asistencia de aire', 'Software', 'Placa / firmware'],
  'Láser fibra': ['Potencia', 'Área de trabajo / lente', 'Software'],
  'Láser CO2': ['Potencia del tubo', 'Área de trabajo', 'Software'],
  Otra: []
};

/** No type given means a 3D printer, the common case here; an unknown one means Otra. */
function tipoValido(t: string | null | undefined): TipoMaquina {
  if (!t) return 'Impresora 3D';
  return (TIPOS_MAQUINA as readonly string[]).includes(t ?? '') ? (t as TipoMaquina) : 'Otra';
}

export function esEstadoMaquina(e: string | null | undefined): e is EstadoMaquina {
  return (ESTADOS_MAQUINA as readonly string[]).includes(e ?? '');
}

export function esEstadoCola(e: string | null | undefined): e is EstadoCola {
  return (ESTADOS_COLA as readonly string[]).includes(e ?? '');
}

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

export function listarMaquinas(): Maquina[] {
  return getDb().prepare(`SELECT * FROM micho_maquinas ORDER BY orden, id`).all() as Maquina[];
}

export function obtenerMaquina(slug: string): Maquina | null {
  return (getDb().prepare(`SELECT * FROM micho_maquinas WHERE slug = ?`).get(slug) as Maquina | undefined) ?? null;
}

export type DatosMaquina = {
  nombre: string;
  apodo?: string | null;
  tipo?: string | null;
  ranuras?: number | null;
};

function ranurasValidas(n: number | null | undefined): number {
  return n && Number.isInteger(n) && n >= 1 && n <= 16 ? n : 1;
}

/** A slug unique among machines; "Creality K1C - 2" and "Creality K1C - 1" stay apart. */
function slugLibre(base: string): string {
  const db = getDb();
  let slug = base || 'maquina';
  for (let i = 2; db.prepare(`SELECT 1 FROM micho_maquinas WHERE slug = ?`).get(slug); i++) slug = `${base}-${i}`;
  return slug;
}

export function crearMaquina(datos: DatosMaquina): Maquina {
  const db = getDb();
  const tipo = tipoValido(datos.tipo);
  return db.transaction((): Maquina => {
    const orden = (db.prepare(`SELECT COALESCE(MAX(orden), 0) + 1 AS n FROM micho_maquinas`).get() as { n: number }).n;
    const info = db
      .prepare(`INSERT INTO micho_maquinas (slug, nombre, apodo, tipo, ranuras, orden) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(slugLibre(slugDe(datos.nombre)), datos.nombre, datos.apodo ?? null, tipo, ranurasValidas(datos.ranuras), orden);
    const id = Number(info.lastInsertRowid);
    const detalle = db.prepare(`INSERT INTO micho_maquina_detalles (maquina_id, clave, orden) VALUES (?, ?, ?)`);
    DETALLES_BASE[tipo].forEach((clave, i) => detalle.run(id, clave, i));
    return db.prepare(`SELECT * FROM micho_maquinas WHERE id = ?`).get(id) as Maquina;
  })();
}

/** Name, nickname, type and slots. The slug stays, so links and the ficha keep working. */
export function actualizarMaquina(id: number, datos: DatosMaquina): void {
  const db = getDb();
  const ranuras = ranurasValidas(datos.ranuras);
  db.transaction(() => {
    db.prepare(
      `UPDATE micho_maquinas SET nombre = ?, apodo = ?, tipo = ?, ranuras = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(datos.nombre, datos.apodo ?? null, tipoValido(datos.tipo), ranuras, id);
    // Fewer slots than before: what was loaded in the removed ones goes away.
    db.prepare(`DELETE FROM micho_maquina_consumibles WHERE maquina_id = ? AND ranura > ?`).run(id, ranuras);
    // A machine with no details yet gets the starting list of its (new) type.
    if (!detallesDe(id).length) {
      const detalle = db.prepare(`INSERT INTO micho_maquina_detalles (maquina_id, clave, orden) VALUES (?, ?, ?)`);
      DETALLES_BASE[tipoValido(datos.tipo)].forEach((clave, i) => detalle.run(id, clave, i));
    }
  })();
}

export function cambiarEstado(id: number, estado: EstadoMaquina): void {
  getDb()
    .prepare(`UPDATE micho_maquinas SET estado = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(estado, id);
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

export function detallesDe(maquinaId: number): Detalle[] {
  return getDb()
    .prepare(`SELECT * FROM micho_maquina_detalles WHERE maquina_id = ? ORDER BY orden, id`)
    .all(maquinaId) as Detalle[];
}

/**
 * Replaces the machine's details with the given list, in that order. A row with
 * an empty name is dropped; one with a name and no value is kept, as a reminder
 * of what is still to be written down.
 */
export function guardarDetalles(maquinaId: number, filas: { clave: string; valor: string | null }[]): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM micho_maquina_detalles WHERE maquina_id = ?`).run(maquinaId);
    const insertar = db.prepare(
      `INSERT INTO micho_maquina_detalles (maquina_id, clave, valor, orden) VALUES (?, ?, ?, ?)`
    );
    filas
      .map((f) => ({ clave: f.clave.trim(), valor: f.valor?.trim() || null }))
      .filter((f) => f.clave)
      .forEach((f, i) => insertar.run(maquinaId, f.clave, f.valor, i));
  })();
}

// ---------------------------------------------------------------------------
// Loaded consumables
// ---------------------------------------------------------------------------

/** One entry per slot, empty slots included, so the page always shows all of them. */
export function consumiblesDe(maquina: Pick<Maquina, 'id' | 'ranuras'>): Consumible[] {
  const filas = getDb()
    .prepare(
      `SELECT c.ranura, c.insumo_id, i.nombre AS insumo, i.unidad, c.color, c.nota
         FROM micho_maquina_consumibles c LEFT JOIN micho_insumos i ON i.id = c.insumo_id
        WHERE c.maquina_id = ?`
    )
    .all(maquina.id) as Consumible[];
  const porRanura = new Map(filas.map((f) => [f.ranura, f]));
  return Array.from({ length: maquina.ranuras }, (_, i) => {
    const ranura = i + 1;
    return porRanura.get(ranura) ?? { ranura, insumo_id: null, insumo: null, unidad: null, color: null, nota: null };
  });
}

/** Loads a slot; with neither supply nor colour nor note, the slot is emptied. */
export function cargarConsumible(
  maquinaId: number,
  ranura: number,
  datos: { insumoId: number | null; color?: string | null; nota?: string | null }
): void {
  const db = getDb();
  if (!datos.insumoId && !datos.color && !datos.nota) {
    db.prepare(`DELETE FROM micho_maquina_consumibles WHERE maquina_id = ? AND ranura = ?`).run(maquinaId, ranura);
    return;
  }
  db.prepare(
    `INSERT INTO micho_maquina_consumibles (maquina_id, ranura, insumo_id, color, nota) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(maquina_id, ranura) DO UPDATE SET insumo_id = excluded.insumo_id, color = excluded.color,
       nota = excluded.nota, updated_at = CURRENT_TIMESTAMP`
  ).run(maquinaId, ranura, datos.insumoId, datos.color ?? null, datos.nota ?? null);
}

// ---------------------------------------------------------------------------
// Job queue
// ---------------------------------------------------------------------------

/** Open jobs first (running, then queued in order), finished ones after, newest first. */
export function colaDe(maquinaId: number, incluirTerminados = false): Trabajo[] {
  return getDb()
    .prepare(
      `SELECT * FROM micho_cola WHERE maquina_id = ?
         ${incluirTerminados ? '' : `AND estado IN ('En cola','En curso')`}
       ORDER BY CASE estado WHEN 'En curso' THEN 0 WHEN 'En cola' THEN 1 ELSE 2 END,
                CASE WHEN estado IN ('En cola','En curso') THEN orden END, finished_at DESC, id`
    )
    .all(maquinaId) as Trabajo[];
}

export function encolar(
  maquinaId: number,
  datos: { productoSlug?: string | null; descripcion?: string | null; piezas?: number | null }
): void {
  const db = getDb();
  const orden = (
    db.prepare(`SELECT COALESCE(MAX(orden), 0) + 1 AS n FROM micho_cola WHERE maquina_id = ?`).get(maquinaId) as {
      n: number;
    }
  ).n;
  const piezas = datos.piezas && Number.isInteger(datos.piezas) && datos.piezas > 0 ? datos.piezas : 1;
  db.prepare(
    `INSERT INTO micho_cola (maquina_id, producto_slug, descripcion, piezas, orden) VALUES (?, ?, ?, ?, ?)`
  ).run(maquinaId, datos.productoSlug ?? null, datos.descripcion ?? null, piezas, orden);
}

export function obtenerTrabajo(id: number): Trabajo | null {
  return (getDb().prepare(`SELECT * FROM micho_cola WHERE id = ?`).get(id) as Trabajo | undefined) ?? null;
}

/**
 * Moves a job along. Starting one puts the machine in "Trabajando"; finishing
 * or cancelling the last running job puts it back to "Activa" — unless it was
 * marked with a fault or for calibration meanwhile, which a job does not undo.
 */
export function moverTrabajo(id: number, estado: EstadoCola): Trabajo | null {
  const db = getDb();
  return db.transaction((): Trabajo | null => {
    const t = obtenerTrabajo(id);
    if (!t) return null;
    const marcas =
      estado === 'En curso'
        ? `started_at = COALESCE(started_at, CURRENT_TIMESTAMP), finished_at = NULL`
        : estado === 'Hecho' || estado === 'Cancelado'
          ? `finished_at = CURRENT_TIMESTAMP`
          : `started_at = NULL, finished_at = NULL`;
    db.prepare(`UPDATE micho_cola SET estado = ?, ${marcas} WHERE id = ?`).run(estado, id);

    const enCurso = (
      db.prepare(`SELECT COUNT(*) AS n FROM micho_cola WHERE maquina_id = ? AND estado = 'En curso'`).get(t.maquina_id) as {
        n: number;
      }
    ).n;
    if (enCurso > 0) {
      db.prepare(
        `UPDATE micho_maquinas SET estado = 'Trabajando', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND estado = 'Activa'`
      ).run(t.maquina_id);
    } else {
      db.prepare(
        `UPDATE micho_maquinas SET estado = 'Activa', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND estado = 'Trabajando'`
      ).run(t.maquina_id);
    }
    return obtenerTrabajo(id);
  })();
}

/** Moves a queued job one place up or down among the queued ones. */
export function reordenar(id: number, direccion: -1 | 1): void {
  const db = getDb();
  db.transaction(() => {
    const t = obtenerTrabajo(id);
    if (!t || t.estado !== 'En cola') return;
    const vecino = db
      .prepare(
        `SELECT id, orden FROM micho_cola WHERE maquina_id = ? AND estado = 'En cola' AND orden ${direccion < 0 ? '<' : '>'} ?
         ORDER BY orden ${direccion < 0 ? 'DESC' : 'ASC'} LIMIT 1`
      )
      .get(t.maquina_id, t.orden) as { id: number; orden: number } | undefined;
    if (!vecino) return;
    db.prepare(`UPDATE micho_cola SET orden = ? WHERE id = ?`).run(vecino.orden, t.id);
    db.prepare(`UPDATE micho_cola SET orden = ? WHERE id = ?`).run(t.orden, vecino.id);
  })();
}

export function borrarTrabajo(id: number): void {
  getDb().prepare(`DELETE FROM micho_cola WHERE id = ? AND estado = 'En cola'`).run(id);
}

/** Open jobs per machine, for the overview cards. */
export function colasAbiertas(): Map<number, Trabajo[]> {
  const filas = getDb()
    .prepare(
      `SELECT * FROM micho_cola WHERE estado IN ('En cola','En curso')
       ORDER BY maquina_id, CASE estado WHEN 'En curso' THEN 0 ELSE 1 END, orden`
    )
    .all() as Trabajo[];
  const out = new Map<number, Trabajo[]>();
  for (const f of filas) out.set(f.maquina_id, [...(out.get(f.maquina_id) ?? []), f]);
  return out;
}

/** "Huacal 12x12x7 cm — tanda para feria": the product, the note, or both. */
export function nombreTrabajo(t: Trabajo, productos: Map<string | null, string>): string {
  const producto = t.producto_slug ? productos.get(t.producto_slug) ?? t.producto_slug : null;
  return [producto, t.descripcion].filter(Boolean).join(' — ');
}

/**
 * Deletes a machine with its details, loaded consumables and queue. Its ficha
 * task, if it has one, stays on the board — tasks are not deleted from here —
 * but loses the link, so a new machine with the same slug starts clean.
 */
export function borrarMaquina(id: number): void {
  const db = getDb();
  db.transaction(() => {
    const m = db.prepare(`SELECT slug FROM micho_maquinas WHERE id = ?`).get(id) as { slug: string } | undefined;
    if (!m) return;
    db.prepare(`DELETE FROM micho_cola WHERE maquina_id = ?`).run(id);
    db.prepare(`DELETE FROM micho_maquina_consumibles WHERE maquina_id = ?`).run(id);
    db.prepare(`DELETE FROM micho_maquina_detalles WHERE maquina_id = ?`).run(id);
    db.prepare(`DELETE FROM micho_product_tasks WHERE slug = ?`).run(claveFicha(m.slug));
    db.prepare(`DELETE FROM micho_maquinas WHERE id = ?`).run(id);
  })();
}
