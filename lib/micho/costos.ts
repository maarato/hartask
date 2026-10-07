import { getDb } from '@/lib/db/client';

/**
 * Production cost, the same shape for every product: a list of supplies
 * (insumos) with quantity and colour. A supply is anything with a price per
 * unit — MDF by the sheet, PLA by the gram, laser time by the hour, a box by
 * the piece — so material, machine time and packaging add up the same way.
 */

export const TIPOS_INSUMO = ['Material', 'Consumible', 'Componente', 'Empaque', 'Máquina', 'Otro'] as const;
export type TipoInsumo = (typeof TIPOS_INSUMO)[number];

export type Insumo = {
  id: number;
  nombre: string;
  tipo: TipoInsumo;
  unidad: string;
  /** MXN per unit; null while the price is not known yet. */
  precio: number | null;
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
export const INSUMOS_BASICOS: { nombre: string; tipo: TipoInsumo; unidad: string }[] = [
  { nombre: 'MDF 3 mm', tipo: 'Material', unidad: 'hoja 30×30 cm' },
  { nombre: 'PLA', tipo: 'Material', unidad: 'g' },
  { nombre: 'PETG', tipo: 'Material', unidad: 'g' },
  { nombre: 'Láser diodo', tipo: 'Máquina', unidad: 'hora' },
  { nombre: 'Impresora 3D', tipo: 'Máquina', unidad: 'hora' }
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
  precio?: number | null;
  notas?: string | null;
};

export function crearInsumo(datos: DatosInsumo): Insumo {
  const db = getDb();
  const info = db
    .prepare(`INSERT INTO micho_insumos (nombre, tipo, unidad, precio, notas) VALUES (?, ?, ?, ?, ?)`)
    .run(datos.nombre, tipoValido(datos.tipo), datos.unidad, datos.precio ?? null, datos.notas ?? null);
  return db.prepare(`SELECT * FROM micho_insumos WHERE id = ?`).get(info.lastInsertRowid) as Insumo;
}

export function actualizarInsumo(id: number, datos: DatosInsumo): void {
  getDb()
    .prepare(
      `UPDATE micho_insumos SET nombre = ?, tipo = ?, unidad = ?, precio = ?, notas = ?,
              updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    )
    .run(datos.nombre, tipoValido(datos.tipo), datos.unidad, datos.precio ?? null, datos.notas ?? null, id);
}

/** How many product lines use each supply, so a used one cannot be deleted from under them. */
export function usosPorInsumo(): Map<number, number> {
  const filas = getDb()
    .prepare(`SELECT insumo_id, COUNT(*) AS n FROM micho_producto_insumos GROUP BY insumo_id`)
    .all() as { insumo_id: number; n: number }[];
  return new Map(filas.map((f) => [f.insumo_id, f.n]));
}

/** Supplies with stock rows or stock history, which keep pointing at them. */
export function insumosConStock(): Set<number> {
  const filas = getDb()
    .prepare(
      `SELECT insumo_id FROM micho_stock_materiales
       UNION SELECT insumo_id FROM micho_movimientos WHERE insumo_id IS NOT NULL`
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
    `INSERT INTO micho_insumos (nombre, tipo, unidad) VALUES (?, ?, ?) ON CONFLICT(nombre) DO NOTHING`
  );
  db.transaction(() => {
    for (const b of INSUMOS_BASICOS) insertar.run(b.nombre, b.tipo, b.unidad);
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
