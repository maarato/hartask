import { getDb } from '@/lib/db/client';

/**
 * Selling price per channel. A channel takes a percentage of the price, may
 * charge a fixed fee per sale, and the seller may absorb shipping. Given a
 * product's production cost, that is enough to say what a price leaves and
 * what price leaves the target margin.
 *
 * Nothing here guesses a channel's rates: unknown values stay null and count
 * as zero in the maths, which the page says out loud.
 */

export type Canal = {
  id: number;
  nombre: string;
  /** Percentage of the sale price the channel keeps (commission, payment fee, withholdings). */
  comision_pct: number | null;
  /** Fixed amount per sale, in MXN. */
  cargo_fijo: number | null;
  /** Shipping the seller pays per sale, in MXN. */
  envio: number | null;
  notas: string | null;
  orden: number;
  updated_at: string;
};

/** The channels the business sells on, created empty: their rates are the owner's to fill in. */
export const CANALES_BASICOS = ['Mercado Libre', 'Instagram', 'Tiendanube'];

export const MARGEN_POR_DEFECTO = 30;

export type DatosCanal = {
  nombre: string;
  comision_pct?: number | null;
  cargo_fijo?: number | null;
  envio?: number | null;
  notas?: string | null;
};

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export function listarCanales(): Canal[] {
  return getDb().prepare(`SELECT * FROM micho_canales ORDER BY orden, id`).all() as Canal[];
}

export function crearCanal(d: DatosCanal): Canal {
  const db = getDb();
  const orden = (db.prepare(`SELECT COALESCE(MAX(orden), 0) + 1 AS n FROM micho_canales`).get() as { n: number }).n;
  const info = db
    .prepare(
      `INSERT INTO micho_canales (nombre, comision_pct, cargo_fijo, envio, notas, orden) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(d.nombre, d.comision_pct ?? null, d.cargo_fijo ?? null, d.envio ?? null, d.notas ?? null, orden);
  return db.prepare(`SELECT * FROM micho_canales WHERE id = ?`).get(info.lastInsertRowid) as Canal;
}

export function actualizarCanal(id: number, d: DatosCanal): void {
  getDb()
    .prepare(
      `UPDATE micho_canales SET nombre = ?, comision_pct = ?, cargo_fijo = ?, envio = ?, notas = ?,
              updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    )
    .run(d.nombre, d.comision_pct ?? null, d.cargo_fijo ?? null, d.envio ?? null, d.notas ?? null, id);
}

/** Deletes a channel together with the prices set for it; returns how many prices went with it. */
export function borrarCanal(id: number): number {
  const db = getDb();
  return db.transaction(() => {
    const n = db.prepare(`DELETE FROM micho_precios WHERE canal_id = ?`).run(id).changes;
    db.prepare(`DELETE FROM micho_canales WHERE id = ?`).run(id);
    return n;
  })();
}

export function crearCanalesBasicos(): void {
  const existentes = new Set(listarCanales().map((c) => c.nombre.toLowerCase()));
  for (const nombre of CANALES_BASICOS) if (!existentes.has(nombre.toLowerCase())) crearCanal({ nombre });
}

// ---------------------------------------------------------------------------
// Target margin
// ---------------------------------------------------------------------------

/** Target margin as a percentage of the sale price. */
export function margenObjetivo(): number {
  const fila = getDb().prepare(`SELECT valor FROM micho_config WHERE clave = 'margen_objetivo'`).get() as
    | { valor: string }
    | undefined;
  const n = Number(fila?.valor);
  return fila && Number.isFinite(n) ? n : MARGEN_POR_DEFECTO;
}

export function fijarMargenObjetivo(pct: number): void {
  getDb()
    .prepare(
      `INSERT INTO micho_config (clave, valor) VALUES ('margen_objetivo', ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
    )
    .run(String(pct));
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/** slug → canal_id → price, for every product with a price somewhere. */
export function todosLosPrecios(): Map<string, Map<number, number>> {
  const filas = getDb().prepare(`SELECT slug, canal_id, precio FROM micho_precios`).all() as {
    slug: string;
    canal_id: number;
    precio: number;
  }[];
  const out = new Map<string, Map<number, number>>();
  for (const f of filas) {
    if (!out.has(f.slug)) out.set(f.slug, new Map());
    out.get(f.slug)!.set(f.canal_id, f.precio);
  }
  return out;
}

export function preciosDe(slug: string): Map<number, number> {
  return todosLosPrecios().get(slug) ?? new Map();
}

/** Sets the price a product sells for on a channel; null removes it. */
export function fijarPrecio(slug: string, canalId: number, precio: number | null): void {
  const db = getDb();
  if (precio === null) {
    db.prepare(`DELETE FROM micho_precios WHERE slug = ? AND canal_id = ?`).run(slug, canalId);
    return;
  }
  db.prepare(
    `INSERT INTO micho_precios (slug, canal_id, precio) VALUES (?, ?, ?)
     ON CONFLICT(slug, canal_id) DO UPDATE SET precio = excluded.precio, updated_at = CURRENT_TIMESTAMP`
  ).run(slug, canalId, precio);
}

// ---------------------------------------------------------------------------
// The maths
// ---------------------------------------------------------------------------

export type Cuenta = {
  /** What the channel keeps of this price: percentage + fixed fee. */
  canal: number;
  envio: number;
  costo: number;
  /** What is left after the channel, shipping and production cost. */
  ganancia: number;
  /** ganancia / precio, as a percentage. */
  margen: number;
};

/** What a given price leaves on a channel, for a production cost. */
export function cuenta(precio: number, costo: number, canal: Canal): Cuenta {
  const comision = (precio * (canal.comision_pct ?? 0)) / 100;
  const fijo = canal.cargo_fijo ?? 0;
  const envio = canal.envio ?? 0;
  const ganancia = precio - comision - fijo - envio - costo;
  return { canal: comision + fijo, envio, costo, ganancia, margen: precio > 0 ? (ganancia / precio) * 100 : 0 };
}

/**
 * The price that leaves the target margin on a channel, rounded up to a whole
 * peso. Null when the channel's percentage and the margin together reach 100%,
 * where no price can work.
 *
 *   precio = (costo + cargo fijo + envío) / (1 − comisión% − margen%)
 */
export function precioSugerido(costo: number, canal: Canal, margenPct: number): number | null {
  const resto = 1 - (canal.comision_pct ?? 0) / 100 - margenPct / 100;
  if (resto <= 0) return null;
  return Math.ceil((costo + (canal.cargo_fijo ?? 0) + (canal.envio ?? 0)) / resto);
}

/** Whether the channel's rates are all written down; the maths treats a missing one as 0. */
export function canalCompleto(canal: Canal): boolean {
  return canal.comision_pct !== null && canal.cargo_fijo !== null && canal.envio !== null;
}
