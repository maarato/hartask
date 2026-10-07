import { getDb } from '@/lib/db/client';
import { costeoDe, NOMBRE_INSUMO_SQL } from '@/lib/micho/costos';

/**
 * What is on the shelf: materials by supply and colour, finished products by
 * product and variant. Every change goes through `mover…` so it also lands in
 * micho_movimientos — a stock number nobody can explain is not worth keeping.
 */

export const MOTIVOS = ['entrada', 'fabricación', 'venta', 'salida', 'ajuste'] as const;
export type Motivo = (typeof MOTIVOS)[number];

export type StockMaterial = {
  id: number;
  insumo_id: number;
  insumo: string;
  tipo: string;
  unidad: string;
  color: string;
  cantidad: number;
  minimo: number | null;
  /** At or under its minimum, or already negative. */
  bajo: boolean;
};

export type StockProducto = { slug: string; variante: string; cantidad: number };

export type Movimiento = {
  id: number;
  tipo: 'material' | 'producto';
  insumo_id: number | null;
  slug: string | null;
  detalle: string;
  delta: number;
  motivo: string;
  nota: string | null;
  created_at: string;
  insumo: string | null;
  unidad: string | null;
};

function limpio(s: string | null | undefined): string {
  return (s ?? '').trim();
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export function listarStockMateriales(): StockMaterial[] {
  const filas = getDb()
    .prepare(
      `SELECT s.id, s.insumo_id, ${NOMBRE_INSUMO_SQL} AS insumo, i.tipo, i.unidad, s.color, s.cantidad, s.minimo
         FROM micho_stock_materiales s JOIN micho_insumos i ON i.id = s.insumo_id
        ORDER BY i.nombre COLLATE NOCASE, i.marca COLLATE NOCASE, s.color COLLATE NOCASE`
    )
    .all() as Omit<StockMaterial, 'bajo'>[];
  return filas.map((f) => ({ ...f, bajo: f.cantidad < 0 || (f.minimo !== null && f.cantidad <= f.minimo) }));
}

/** Adds (or with a negative delta, takes) material; creates the row the first time. */
export function moverMaterial(
  insumoId: number,
  color: string | null,
  delta: number,
  motivo: Motivo,
  nota?: string | null,
  slug?: string | null
): void {
  const db = getDb();
  const c = limpio(color);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO micho_stock_materiales (insumo_id, color, cantidad) VALUES (?, ?, ?)
       ON CONFLICT(insumo_id, color) DO UPDATE SET cantidad = cantidad + excluded.cantidad,
                                                   updated_at = CURRENT_TIMESTAMP`
    ).run(insumoId, c, delta);
    db.prepare(
      `INSERT INTO micho_movimientos (tipo, insumo_id, slug, detalle, delta, motivo, nota)
       VALUES ('material', ?, ?, ?, ?, ?, ?)`
    ).run(insumoId, slug ?? null, c, delta, motivo, nota ?? null);
  })();
}

/** Sets the counted amount (and the minimum); the difference is logged as an ajuste. */
export function fijarMaterial(
  insumoId: number,
  color: string | null,
  cantidad: number,
  minimo: number | null,
  nota?: string | null
): void {
  const db = getDb();
  const c = limpio(color);
  db.transaction(() => {
    const actual = db
      .prepare(`SELECT cantidad FROM micho_stock_materiales WHERE insumo_id = ? AND color = ?`)
      .get(insumoId, c) as { cantidad: number } | undefined;
    const delta = cantidad - (actual?.cantidad ?? 0);
    if (delta !== 0) moverMaterial(insumoId, c, delta, 'ajuste', nota);
    db.prepare(
      `INSERT INTO micho_stock_materiales (insumo_id, color, cantidad, minimo) VALUES (?, ?, ?, ?)
       ON CONFLICT(insumo_id, color) DO UPDATE SET minimo = excluded.minimo, updated_at = CURRENT_TIMESTAMP`
    ).run(insumoId, c, cantidad, minimo);
  })();
}

/** Removes an empty material row, e.g. a colour you no longer buy. */
export function quitarStockMaterial(id: number): boolean {
  const info = getDb().prepare(`DELETE FROM micho_stock_materiales WHERE id = ? AND cantidad = 0`).run(id);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export function listarStockProductos(): StockProducto[] {
  return getDb()
    .prepare(`SELECT slug, variante, cantidad FROM micho_stock_productos ORDER BY slug, variante COLLATE NOCASE`)
    .all() as StockProducto[];
}

/** slug → total units and the per-variant breakdown. */
export function stockPorProducto(): Map<string, { total: number; variantes: StockProducto[] }> {
  const out = new Map<string, { total: number; variantes: StockProducto[] }>();
  for (const s of listarStockProductos()) {
    const e = out.get(s.slug) ?? { total: 0, variantes: [] };
    e.total += s.cantidad;
    e.variantes.push(s);
    out.set(s.slug, e);
  }
  return out;
}

export function moverProducto(
  slug: string,
  variante: string | null,
  delta: number,
  motivo: Motivo,
  nota?: string | null
): void {
  const db = getDb();
  const v = limpio(variante);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO micho_stock_productos (slug, variante, cantidad) VALUES (?, ?, ?)
       ON CONFLICT(slug, variante) DO UPDATE SET cantidad = cantidad + excluded.cantidad,
                                                updated_at = CURRENT_TIMESTAMP`
    ).run(slug, v, delta);
    db.prepare(
      `INSERT INTO micho_movimientos (tipo, slug, detalle, delta, motivo, nota) VALUES ('producto', ?, ?, ?, ?, ?)`
    ).run(slug, v, delta, motivo, nota ?? null);
  })();
}

export function fijarProducto(slug: string, variante: string | null, cantidad: number, nota?: string | null): void {
  const actual = listarStockProductos().find((s) => s.slug === slug && s.variante === limpio(variante));
  const delta = cantidad - (actual?.cantidad ?? 0);
  if (delta !== 0) moverProducto(slug, variante, delta, 'ajuste', nota);
}

/**
 * Registers `piezas` made of a product. With `descontar`, the materials and
 * packaging in its cost sheet are taken from stock: quantity per piece × pieces,
 * matching the line's colour (a line without colour takes the colourless row).
 * Machine time has no stock and is skipped; everything else (material,
 * packaging, consumables, parts) comes off. Returns the rows left negative, so
 * the page can say what you did not actually have.
 */
export function fabricar(
  slug: string,
  variante: string | null,
  piezas: number,
  descontar: boolean,
  nota?: string | null
): StockMaterial[] {
  const db = getDb();
  let tocados: { insumo_id: number; color: string }[] = [];
  db.transaction(() => {
    moverProducto(slug, variante, piezas, 'fabricación', nota);
    if (!descontar) return;
    const lineas = costeoDe(slug)?.lineas.filter((l) => l.tipo !== 'Máquina') ?? [];
    for (const l of lineas) {
      moverMaterial(l.insumo_id, l.color, -l.cantidad * piezas, 'fabricación', `${piezas} pz`, slug);
    }
    tocados = lineas.map((l) => ({ insumo_id: l.insumo_id, color: limpio(l.color) }));
  })();
  return listarStockMateriales().filter(
    (s) => s.cantidad < 0 && tocados.some((t) => t.insumo_id === s.insumo_id && t.color === s.color)
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export function movimientos(filtro: { slug?: string; limite?: number } = {}): Movimiento[] {
  const where = filtro.slug ? `WHERE m.slug = ?` : '';
  const params: unknown[] = filtro.slug ? [filtro.slug] : [];
  return getDb()
    .prepare(
      `SELECT m.*, ${NOMBRE_INSUMO_SQL} AS insumo, i.unidad FROM micho_movimientos m
         LEFT JOIN micho_insumos i ON i.id = m.insumo_id
       ${where} ORDER BY m.id DESC LIMIT ?`
    )
    .all(...params, filtro.limite ?? 50) as Movimiento[];
}
