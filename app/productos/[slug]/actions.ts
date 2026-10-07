'use server';

import { revalidatePath } from 'next/cache';
import { addNote, createTask, setTaskStatus, updateTask } from '@/lib/hartask/repositories/tasks';
import { isTaskStatus } from '@/lib/hartask/types';
import { listarProductos } from '@/lib/micho/catalogo';
import { agregarLinea, borrarLinea } from '@/lib/micho/costos';
import { asegurarFicha, CATEGORIA } from '@/lib/micho/fichas';
import { fijarPrecio } from '@/lib/micho/precios';

function text(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * The slug comes from the form, so it is checked against the catalogue: a
 * ficha can only be created for a product that exists in PRODUCTOS.md.
 */
function ficha(formData: FormData) {
  const slug = text(formData, 'slug');
  const producto = slug ? listarProductos().find((p) => p.slug === slug) : undefined;
  if (!slug || !producto) throw new Error(`Producto desconocido: ${slug}`);
  return asegurarFicha(slug, producto.nombre);
}

function refrescar(): void {
  revalidatePath('/productos');
  revalidatePath('/productos/[slug]', 'page');
  revalidatePath('/micho');
  revalidatePath('/tasks');
}

/** Info in Markdown; an emptied textarea clears it. */
export async function guardarInfoAction(formData: FormData): Promise<void> {
  const tarea = ficha(formData);
  updateTask(tarea.id, { description: text(formData, 'info') });
  refrescar();
}

/** "Cómo va": the ficha's own status and what comes next. */
export async function guardarAvanceAction(formData: FormData): Promise<void> {
  const tarea = ficha(formData);
  const status = text(formData, 'status');
  updateTask(tarea.id, {
    nextAction: text(formData, 'next_action'),
    ...(isTaskStatus(status) ? { status } : {})
  });
  refrescar();
}

export async function agregarTareaAction(formData: FormData): Promise<void> {
  const title = text(formData, 'title');
  if (!title) return;
  const tarea = ficha(formData);
  const prioridad = Number(text(formData, 'priority'));
  createTask({
    title,
    parentId: tarea.id,
    category: CATEGORIA,
    priority: [1, 2, 3].includes(prioridad) ? prioridad : 2
  });
  refrescar();
}

export async function cambiarEstadoTareaAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'public_id');
  const status = text(formData, 'status');
  if (!publicId || !isTaskStatus(status)) return;
  setTaskStatus(publicId, status);
  refrescar();
}

/** A finding is a dated note on the ficha: appended, never edited. */
export async function agregarHallazgoAction(formData: FormData): Promise<void> {
  const body = text(formData, 'body');
  if (!body) return;
  const tarea = ficha(formData);
  addNote(tarea.id, body, 'human');
  refrescar();
}

function numero(formData: FormData, field: string): number | null {
  const raw = text(formData, field)?.replace(',', '.');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** A product's supply line. The product must exist; its ficha is not needed for costs. */
export async function agregarInsumoProductoAction(formData: FormData): Promise<void> {
  const slug = text(formData, 'slug');
  const insumoId = numero(formData, 'insumo_id');
  const cant = numero(formData, 'cantidad');
  if (!slug || !listarProductos().some((p) => p.slug === slug)) return;
  if (!insumoId || !cant || cant <= 0) return;
  agregarLinea(slug, {
    insumoId,
    cantidad: cant,
    color: text(formData, 'color'),
    nota: text(formData, 'nota')
  });
  refrescar();
}

export async function quitarInsumoProductoAction(formData: FormData): Promise<void> {
  const id = numero(formData, 'id');
  if (!id) return;
  borrarLinea(id);
  refrescar();
}

/** The price a product sells for on a channel; a blank field removes it. */
export async function fijarPrecioAction(formData: FormData): Promise<void> {
  const slug = text(formData, 'slug');
  const canalId = numero(formData, 'canal_id');
  if (!slug || !canalId || !listarProductos().some((p) => p.slug === slug)) return;
  const precio = numero(formData, 'precio');
  fijarPrecio(slug, canalId, precio !== null && precio > 0 ? precio : null);
  refrescar();
}
