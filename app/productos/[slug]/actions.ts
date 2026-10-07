'use server';

import { revalidatePath } from 'next/cache';
import { addNote, createTask, setTaskStatus, updateTask } from '@/lib/hartask/repositories/tasks';
import { isTaskStatus } from '@/lib/hartask/types';
import { listarProductos } from '@/lib/micho/catalogo';
import { asegurarFicha, CATEGORIA } from '@/lib/micho/fichas';

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
