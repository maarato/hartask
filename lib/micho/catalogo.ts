import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { projectRootPath } from '@/lib/hartask/config';

/**
 * Micho Store keeps its catalogue in `_docs/PRODUCTOS.md` (one markdown table
 * per state) and one folder per product. This module reads both, read-only:
 * the markdown stays the source of truth and the page only shows it.
 */

export const ESTADOS = ['Listo', 'Por validar', 'Prototipo'] as const;
export type Estado = (typeof ESTADOS)[number];

/** Section heading in PRODUCTOS.md → the state every row in it has. */
const SECCIONES: Record<string, Estado> = {
  '1 Listos': 'Listo',
  '2 Por validar': 'Por validar',
  '3 Prototipos': 'Prototipo'
};

export type Producto = {
  nombre: string;
  estado: Estado;
  /** Finer state from the table (Fotos, Publicado...), when the section has one. */
  detalle: string | null;
  tecnica: string;
  carpeta: string | null;
  canales: string | null;
  notas: string | null;
  /** Project-relative path of the first photo found, for /api/micho/foto. */
  foto: string | null;
};

export type Parametro = {
  seccion: string;
  material: string;
  operacion: string;
  parametros: string;
  estado: string;
};

export const IMAGENES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function leerDoc(nombre: string): string | null {
  const ruta = join(projectRootPath(), '_docs', nombre);
  return existsSync(ruta) ? readFileSync(ruta, 'utf8') : null;
}

/** Strips the markdown a cell may carry: code spans, bold, links. */
function limpiar(celda: string): string {
  return celda
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
}

type Tabla = { seccion: string; filas: Record<string, string>[] };

/** Every table in the document, keyed by the `##` heading above it. */
function tablas(md: string): Tabla[] {
  const out: Tabla[] = [];
  let seccion = '';
  let encabezados: string[] | null = null;
  let actual: Tabla | null = null;

  for (const linea of md.split(/\r?\n/)) {
    const h = /^##\s+(.+)$/.exec(linea);
    if (h) {
      seccion = h[1].trim();
      encabezados = null;
      actual = null;
      continue;
    }
    if (!linea.trim().startsWith('|')) {
      encabezados = null;
      actual = null;
      continue;
    }
    const celdas = linea.trim().replace(/^\||\|$/g, '').split('|').map(limpiar);
    if (!encabezados) {
      encabezados = celdas;
      actual = { seccion, filas: [] };
      out.push(actual);
    } else if (celdas.every((c) => /^:?-+:?$/.test(c))) {
      continue;
    } else if (actual && celdas.some(Boolean)) {
      actual.filas.push(Object.fromEntries(encabezados.map((e, i) => [e, celdas[i] ?? ''])));
    }
  }
  return out;
}

/**
 * Resolves a project-relative path and refuses anything that escapes the
 * project root, so a crafted query cannot read the rest of the disk.
 */
export function dentroDelProyecto(rel: string): string | null {
  const root = projectRootPath();
  const abs = resolve(root, rel);
  const r = relative(root, abs);
  if (!r || r.startsWith('..') || r.includes(`..${sep}`)) return null;
  return abs;
}

/**
 * First image of a product: its `Fotos/` folder first, then the folder itself,
 * one level deep — the disk is slow, so no recursive walk.
 */
function primeraFoto(carpeta: string): string | null {
  const abs = dentroDelProyecto(carpeta);
  if (!abs || !existsSync(abs)) return null;
  for (const dir of [join(abs, 'Fotos'), abs]) {
    try {
      if (!statSync(dir).isDirectory()) continue;
      const img = readdirSync(dir)
        .filter((f) => IMAGENES.has(extname(f).toLowerCase()))
        .sort((a, b) => a.localeCompare(b))[0];
      if (img) return relative(projectRootPath(), join(dir, img)).split(sep).join('/');
    } catch {
      // A folder we cannot read just has no photo.
    }
  }
  return null;
}

export function listarProductos(): Producto[] {
  const md = leerDoc('PRODUCTOS.md');
  if (!md) return [];
  const productos: Producto[] = [];
  for (const tabla of tablas(md)) {
    const estado = SECCIONES[tabla.seccion];
    if (!estado) continue;
    for (const fila of tabla.filas) {
      const carpeta = fila['Carpeta'] || null;
      productos.push({
        nombre: fila['Producto'] ?? '',
        estado,
        detalle: fila['Estado'] || null,
        tecnica: fila['Téc.'] ?? '',
        carpeta,
        canales: fila['Canales'] && !['?', '—', '-'].includes(fila['Canales']) ? fila['Canales'] : null,
        notas: fila['Notas'] || fila['Qué falta'] || null,
        foto: carpeta ? primeraFoto(carpeta) : null
      });
    }
  }
  return productos;
}

export function listarParametros(): Parametro[] {
  const md = leerDoc('PARAMETROS.md');
  if (!md) return [];
  return tablas(md).flatMap((t) =>
    t.filas
      .filter((f) => f['Material'] && 'Parámetros' in f)
      .map((f) => ({
        seccion: t.seccion,
        material: f['Material'],
        operacion: f['Operación'] ?? f['Uso'] ?? '',
        parametros: f['Parámetros'],
        estado: f['Estado'] ?? ''
      }))
  );
}
