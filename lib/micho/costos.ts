import { getDb } from '@/lib/db/client';

/**
 * Production cost, the same shape for every product: a list of supplies
 * (insumos) with quantity and colour. A supply is bought as a purchase ($350
 * for a 1000 g spool) and used per unit (40 g), so the per-unit price is
 * derived once and every product's cost adds up the same way.
 */

export const TIPOS_INSUMO = ['Material', 'Consumible', 'Componente', 'Empaque', 'Máquina', 'Otro'] as const;
export type TipoInsumo = (typeof TIPOS_INSUMO)[number];

export type Insumo = {
  id: number;
  nombre: string;
  tipo: TipoInsumo;
  unidad: string;
  /** MXN per unit, derived from precio_compra / presentacion; null while unknown. */
  precio: number | null;
  /** What is paid for one purchase, e.g. 350 for a spool. */
  precio_compra: number | null;
  /** Units in one purchase, e.g. 1000 (g) for a 1 kg spool. */
  presentacion: number;
  notas: string | null;
  updated_at: string;
};

export type Linea = {
  id: number;
  slug: string;
  insumo_id: number;
  cantidad: number;
  color: string | null;
  nota: string | null;
  insumo: string;
  tipo: TipoInsumo;
  unidad: string;
  precio: number | null;
  /** cantidad × precio, or null when the supply has no price yet. */
  subtotal: number | null;
};

export type Costeo = {
  lineas: Linea[];
  /** Sum of the lines that have a price. */
  total: number;
  /** False when some line's supply has no price: the total is then a floor. */
  completo: boolean;
};

/** What the empty catalogue offers to create, without guessing any price. */
export const INSUMOS_BASICOS: { nombre: string; tipo: TipoInsumo; unidad: string; presentacion: number }[] = [
  { nombre: 'MDF 3 mm', tipo: 'Material', unidad: 'hoja 30×30 cm', presentacion: 1 },
  { nombre: 'PLA', tipo: 'Material', unidad: 'g', presentacion: 1000 },
  { nombre: 'PETG', tipo: 'Material', unidad: 'g', presentacion: 1000 }
];

/** No type given means Material, the common case; an unknown one means Otro. */
function tipoValido(tipo: string | null | undefined): TipoInsumo {
  if (!tipo) return 'Material';
  return (TIPOS_INSUMO as readonly string[]).includes(tipo ?? '') ? (tipo as TipoInsumo) : 'Otro';
}

export function listarInsumos(): Insumo[] {
  return getDb()
    .prepare(
      `SELECT * FROM micho_insumos
        ORDER BY CASE tipo WHEN 'Material' THEN 0 WHEN 'Consumible' THEN 1 WHEN 'Componente' THEN 2 WHEN 'Empaque' THEN 3 WHEN 'Máquina' THEN 4 ELSE 5 END, nombre`
    )
    .all() as Insumo[];
}

export type DatosInsumo = {
  nombre: string;
  tipo?: string | null;
  unidad: string;
  /** Price of one purchase ($350 for the spool). */
  precioCompra?: number | null;
  /** Units in one purchase (1000 g); defaults to 1, i.e. the price is per unit. */
  presentacion?: number | null;
  /** Shortcut for a price already per unit: same as precioCompra with presentacion 1. */
  precio?: number | null;
  notas?: string | null;
};

/** Normalises the purchase and derives the per-unit price everything else uses. */
function precios(d: DatosInsumo): { compra: number | null; presentacion: number; unitario: number | null } {
  const presentacion = d.presentacion && d.presentacion > 0 ? d.presentacion : 1;
  const compra = d.precioCompra ?? d.precio ?? null;
  const usaPrecio = d.precioCompra == null && d.precio != null;
  return {
    compra,
    presentacion: usaPrecio ? 1 : presentacion,
    unitario: compra === null ? null : compra / (usaPrecio ? 1 : presentacion)
  };
}

export function crearInsumo(datos: DatosInsumo): Insumo {
  const db = getDb();
  const p = precios(datos);
  const info = db
    .prepare(
      `INSERT INTO micho_insumos (nombre, tipo, unidad, precio, precio_compra, presentacion, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(datos.nombre, tipoValido(datos.tipo), datos.unidad, p.unitario, p.compra, p.presentacion, datos.notas ?? null);
  return db.prepare(`SELECT * FROM micho_insumos WHERE id = ?`).get(info.lastInsertRowid) as Insumo;
}

export function actualizarInsumo(id: number, datos: DatosInsumo): void {
  const p = precios(datos);
  getDb()
    .prepare(
      `UPDATE micho_insumos SET nombre = ?, tipo = ?, unidad = ?, precio = ?, precio_compra = ?, presentacion = ?,
              notas = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    )
    .run(datos.nombre, tipoValido(datos.tipo), datos.unidad, p.unitario, p.compra, p.presentacion, datos.notas ?? null, id);
}

/** How many product lines use each supply, so a used one cannot be deleted from under them. */
export function usosPorInsumo(): Map<number, number> {
  const filas = getDb()
    .prepare(`SELECT insumo_id, COUNT(*) AS n FROM micho_producto_insumos GROUP BY insumo_id`)
    .all() as { insumo_id: number; n: number }[];
  return new Map(filas.map((f) => [f.insumo_id, f.n]));
}

/** Supplies with stock rows, stock history or loaded in a machine, which keep pointing at them. */
export function insumosConStock(): Set<number> {
  const filas = getDb()
    .prepare(
      `SELECT insumo_id FROM micho_stock_materiales
       UNION SELECT insumo_id FROM micho_movimientos WHERE insumo_id IS NOT NULL
       UNION SELECT insumo_id FROM micho_maquina_consumibles WHERE insumo_id IS NOT NULL`
    )
    .all() as { insumo_id: number }[];
  return new Set(filas.map((f) => f.insumo_id));
}

/** Deletes a supply only when no product and no stock uses it; returns whether it did. */
export function borrarInsumo(id: number): boolean {
  if (usosPorInsumo().get(id) || insumosConStock().has(id)) return false;
  getDb().prepare(`DELETE FROM micho_insumos WHERE id = ?`).run(id);
  return true;
}

/** Creates the basic supplies that are missing, with no price. */
export function crearInsumosBasicos(): void {
  const db = getDb();
  const insertar = db.prepare(
    `INSERT INTO micho_insumos (nombre, tipo, unidad, presentacion) VALUES (?, ?, ?, ?) ON CONFLICT(nombre) DO NOTHING`
  );
  db.transaction(() => {
    for (const b of INSUMOS_BASICOS) insertar.run(b.nombre, b.tipo, b.unidad, b.presentacion);
  })();
}

export function agregarLinea(
  slug: string,
  datos: { insumoId: number; cantidad: number; color?: string | null; nota?: string | null }
): void {
  getDb()
    .prepare(`INSERT INTO micho_producto_insumos (slug, insumo_id, cantidad, color, nota) VALUES (?, ?, ?, ?, ?)`)
    .run(slug, datos.insumoId, datos.cantidad, datos.color ?? null, datos.nota ?? null);
}

export function borrarLinea(id: number): void {
  getDb().prepare(`DELETE FROM micho_producto_insumos WHERE id = ?`).run(id);
}

const SELECT_LINEAS = `
  SELECT l.id, l.slug, l.insumo_id, l.cantidad, l.color, l.nota,
         i.nombre AS insumo, i.tipo, i.unidad, i.precio
    FROM micho_producto_insumos l JOIN micho_insumos i ON i.id = l.insumo_id`;

function armar(filas: Omit<Linea, 'subtotal'>[]): Costeo {
  const lineas = filas.map((f) => ({ ...f, subtotal: f.precio === null ? null : f.cantidad * f.precio }));
  return {
    lineas,
    total: lineas.reduce((s, l) => s + (l.subtotal ?? 0), 0),
    completo: lineas.every((l) => l.subtotal !== null)
  };
}

/** Null when the product has no lines yet — "not costed" is not the same as costing $0. */
export function costeoDe(slug: string): Costeo | null {
  const filas = getDb()
    .prepare(`${SELECT_LINEAS} WHERE l.slug = ? ORDER BY l.id`)
    .all(slug) as Omit<Linea, 'subtotal'>[];
  return filas.length ? armar(filas) : null;
}

export function todosLosCosteos(): Map<string, Costeo> {
  const filas = getDb().prepare(`${SELECT_LINEAS} ORDER BY l.slug, l.id`).all() as Omit<Linea, 'subtotal'>[];
  const porSlug = new Map<string, Omit<Linea, 'subtotal'>[]>();
  for (const f of filas) porSlug.set(f.slug, [...(porSlug.get(f.slug) ?? []), f]);
  return new Map([...porSlug].map(([slug, lineas]) => [slug, armar(lineas)]));
}

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

export function pesos(n: number): string {
  return MXN.format(n);
}

/** 1 → '1', 0.5 → '0.5', 12.345 → '12.35': quantities read like a person wrote them. */
export function cantidad(n: number): string {
  return Number(n.toFixed(2)).toString();
}

/** 'MDF 3 mm 0.5 hoja · PLA 40 g negro', for cards and list rows. */
export function resumenMateriales(costeo: Costeo): string {
  return costeo.lineas
    .filter((l) => l.tipo === 'Material')
    .map((l) => [l.insumo, `${cantidad(l.cantidad)} ${l.unidad}`, l.color].filter(Boolean).join(' '))
    .join(' · ');
}
