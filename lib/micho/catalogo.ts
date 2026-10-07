import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
  /** Project-relative path of the first photo found, for /api/micho/archivo. */
  foto: string | null;
  /** Every photo the card carousel shows, first one being `foto`. */
  fotos: string[];
  /**
   * URL segment for /productos/[slug] and the key of the product's ficha. Built
   * from the folder without its state prefix, so moving a product from
   * `3 Prototipos/` to `1 Listos/` keeps its page and its tasks.
   */
  slug: string | null;
};

export type Archivo = {
  /** Project-relative, forward slashes: what /api/micho/archivo takes. */
  ruta: string;
  nombre: string;
  ext: string;
  bytes: number;
  /** Subfolder inside the product folder, '' for the top level. */
  subcarpeta: string;
};

export type DetalleProducto = Omit<Producto, 'fotos'> & {
  existe: boolean;
  fotos: Archivo[];
  archivos: Archivo[];
  /** True when the walk stopped at MAX_ARCHIVOS. */
  truncado: boolean;
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

/** Only the state folders hold products; hartask/, Taller/ and _docs/ are never served. */
const CARPETAS_DE_PRODUCTO = ['1 Listos', '2 Por validar', '3 Prototipos', '4 Ideas'];

/**
 * Resolves a project-relative path inside one of the product folders and
 * refuses anything else, so a crafted query cannot read the rest of the disk
 * — or the Hartask database sitting next to the products.
 */
export function rutaDeProducto(rel: string): string | null {
  const root = projectRootPath();
  const abs = resolve(root, rel);
  const r = relative(root, abs);
  if (!r || r.startsWith('..') || isAbsolute(r)) return null;
  const primero = r.split(sep)[0];
  return CARPETAS_DE_PRODUCTO.includes(primero) ? abs : null;
}

function aRelativa(abs: string): string {
  return relative(projectRootPath(), abs).split(sep).join('/');
}

/** '1 Listos/Laser/Huacal' → 'Laser/Huacal'. */
function sinEstado(carpeta: string): string {
  const [primero, ...resto] = carpeta.split('/');
  return CARPETAS_DE_PRODUCTO.includes(primero) && resto.length ? resto.join('/') : carpeta;
}

/** 'Laser/Huacal 12x12x7cm' → 'laser-huacal-12x12x7cm'. */
export function slugDe(carpeta: string): string {
  return carpeta
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** A card carousel is a preview, not the gallery: the detail page has the rest. */
const MAX_FOTOS_TARJETA = 12;

function imagenesEn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => IMAGENES.has(extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .map((f) => join(dir, f));
  } catch {
    // A folder we cannot read just has no photos.
    return [];
  }
}

function subcarpetas(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(dir, d.name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * A product's photos: `Fotos/` and its direct subfolders first, then images
 * loose in the folder itself. Shallow on purpose — the disk is slow.
 */
function fotosDe(carpeta: string): string[] {
  const abs = rutaDeProducto(carpeta);
  if (!abs || !existsSync(abs)) return [];
  const fotos = join(abs, 'Fotos');
  const encontradas = [
    ...imagenesEn(fotos),
    ...subcarpetas(fotos).flatMap(imagenesEn),
    ...imagenesEn(abs)
  ];
  return encontradas.slice(0, MAX_FOTOS_TARJETA).map(aRelativa);
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
      const fotos = carpeta ? fotosDe(carpeta) : [];
      productos.push({
        nombre: fila['Producto'] ?? '',
        estado,
        detalle: fila['Estado'] || null,
        tecnica: fila['Téc.'] ?? '',
        carpeta,
        canales: fila['Canales'] && !['?', '—', '-'].includes(fila['Canales']) ? fila['Canales'] : null,
        notas: fila['Notas'] || fila['Qué falta'] || null,
        foto: fotos[0] ?? null,
        fotos,
        slug: carpeta ? slugDe(sinEstado(carpeta)) : null
      });
    }
  }
  // Group folders such as `Laser/Cuadros` exist in more than one state; only
  // those keep the state in their slug, since they are different products.
  const vistos = new Map<string, number>();
  for (const p of productos) if (p.slug) vistos.set(p.slug, (vistos.get(p.slug) ?? 0) + 1);
  for (const p of productos) if (p.slug && p.carpeta && vistos.get(p.slug)! > 1) p.slug = slugDe(p.carpeta);
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

/** Product folders are small, but a stray library inside one must not hang the page. */
const MAX_ARCHIVOS = 400;
const MAX_PROFUNDIDAD = 3;

function recorrer(base: string, dir: string, nivel: number, out: Archivo[]): boolean {
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  entradas.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entradas) {
    if (out.length >= MAX_ARCHIVOS) return true;
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      if (nivel < MAX_PROFUNDIDAD && recorrer(base, abs, nivel + 1, out)) return true;
    } else if (e.isFile()) {
      let bytes = 0;
      try {
        bytes = statSync(abs).size;
      } catch {
        // Size is cosmetic.
      }
      out.push({
        ruta: aRelativa(abs),
        nombre: e.name,
        ext: extname(e.name).toLowerCase(),
        bytes,
        subcarpeta: relative(base, dir).split(sep).join('/')
      });
    }
  }
  return false;
}

export function detalleProducto(slug: string): DetalleProducto | null {
  const producto = listarProductos().find((p) => p.slug === slug);
  if (!producto?.carpeta) return null;
  const abs = rutaDeProducto(producto.carpeta);
  const existe = !!abs && existsSync(abs);
  const todos: Archivo[] = [];
  const truncado = existe ? recorrer(abs!, abs!, 1, todos) : false;
  return {
    ...producto,
    existe,
    fotos: todos.filter((a) => IMAGENES.has(a.ext)),
    archivos: todos.filter((a) => !IMAGENES.has(a.ext)),
    truncado
  };
}
