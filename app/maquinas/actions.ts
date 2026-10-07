'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { addNote, createTask, setTaskStatus, updateTask } from '@/lib/hartask/repositories/tasks';
import { isTaskStatus } from '@/lib/hartask/types';
import { listarProductos } from '@/lib/micho/catalogo';
import { asegurarFicha, FICHA_MAQUINA } from '@/lib/micho/fichas';
import {
  actualizarMaquina,
  borrarTrabajo,
  cambiarEstado,
  cargarConsumible,
  claveFicha,
  crearMaquina,
  encolar,
  esEstadoCola,
  esEstadoMaquina,
  guardarDetalles,
  moverTrabajo,
  obtenerMaquina,
  reordenar
} from '@/lib/micho/maquinas';
import { fabricar } from '@/lib/micho/stock';

function text(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function entero(formData: FormData, field: string): number | null {
  const n = Number(text(formData, field));
  return Number.isInteger(n) ? n : null;
}

/** The machine named by the form's `slug`; throws on an unknown one rather than writing nowhere. */
function maquina(formData: FormData) {
  const m = obtenerMaquina(text(formData, 'slug') ?? '');
  if (!m) throw new Error('Máquina desconocida');
  return m;
}

function ficha(formData: FormData) {
  const m = maquina(formData);
  return asegurarFicha(claveFicha(m.slug), m.apodo ? `${m.apodo} (${m.nombre})` : m.nombre, null, FICHA_MAQUINA);
}

function refrescar(): void {
  revalidatePath('/maquinas');
  revalidatePath('/maquinas/[slug]', 'page');
  revalidatePath('/tasks');
  revalidatePath('/stock');
}

export async function crearMaquinaAction(formData: FormData): Promise<void> {
  const nombre = text(formData, 'nombre');
  if (!nombre) return;
  const m = crearMaquina({
    nombre,
    apodo: text(formData, 'apodo'),
    tipo: text(formData, 'tipo'),
    ranuras: entero(formData, 'ranuras')
  });
  refrescar();
  redirect(`/maquinas/${m.slug}`);
}

export async function editarMaquinaAction(formData: FormData): Promise<void> {
  const m = maquina(formData);
  const nombre = text(formData, 'nombre');
  if (!nombre) return;
  actualizarMaquina(m.id, {
    nombre,
    apodo: text(formData, 'apodo'),
    tipo: text(formData, 'tipo'),
    ranuras: entero(formData, 'ranuras')
  });
  refrescar();
}

export async function estadoMaquinaAction(formData: FormData): Promise<void> {
  const m = maquina(formData);
  const estado = text(formData, 'estado');
  if (!esEstadoMaquina(estado)) return;
  cambiarEstado(m.id, estado);
  // A fault is worth a dated line in the log, so it can be traced later.
  const nota = text(formData, 'nota');
  if (nota || estado === 'Falla') addNote(ficha(formData).id, `**${estado}**${nota ? `: ${nota}` : ''}`, 'human');
  refrescar();
}

/** The detail rows arrive as parallel `clave`/`valor` fields, in page order. */
export async function guardarDetallesAction(formData: FormData): Promise<void> {
  const m = maquina(formData);
  const claves = formData.getAll('clave').map(String);
  const valores = formData.getAll('valor').map(String);
  guardarDetalles(
    m.id,
    claves.map((clave, i) => ({ clave, valor: valores[i] ?? null }))
  );
  refrescar();
}

export async function consumibleAction(formData: FormData): Promise<void> {
  const m = maquina(formData);
  const ranura = entero(formData, 'ranura');
  if (!ranura || ranura < 1 || ranura > m.ranuras) return;
  const vaciar = formData.get('vaciar') === '1';
  cargarConsumible(m.id, ranura, {
    insumoId: vaciar ? null : entero(formData, 'insumo_id'),
    color: vaciar ? null : text(formData, 'color'),
    nota: vaciar ? null : text(formData, 'nota')
  });
  refrescar();
}

export async function encolarAction(formData: FormData): Promise<void> {
  const m = maquina(formData);
  const slug = text(formData, 'producto');
  const producto = slug ? listarProductos().find((p) => p.slug === slug) : undefined;
  const descripcion = text(formData, 'descripcion');
  if (!producto && !descripcion) return;
  encolar(m.id, { productoSlug: producto?.slug ?? null, descripcion, piezas: entero(formData, 'piezas') });
  refrescar();
}

/**
 * Moves a job. Finishing a product job can also register the pieces in stock
 * (and take its materials), which is the point of tying the queue to products.
 */
export async function trabajoAction(formData: FormData): Promise<void> {
  const id = entero(formData, 'id');
  const estado = text(formData, 'estado');
  if (!id) return;
  if (estado === 'borrar') {
    borrarTrabajo(id);
  } else if (estado === 'subir' || estado === 'bajar') {
    reordenar(id, estado === 'subir' ? -1 : 1);
  } else if (esEstadoCola(estado)) {
    const t = moverTrabajo(id, estado);
    if (t && estado === 'Hecho' && t.producto_slug && formData.get('a_stock') === '1') {
      fabricar(t.producto_slug, text(formData, 'variante'), t.piezas, true, 'desde la cola');
    }
  }
  refrescar();
  revalidatePath('/productos/[slug]', 'page');
}

export async function guardarInfoMaquinaAction(formData: FormData): Promise<void> {
  updateTask(ficha(formData).id, { description: text(formData, 'info') });
  refrescar();
}

export async function agregarTareaMaquinaAction(formData: FormData): Promise<void> {
  const title = text(formData, 'title');
  if (!title) return;
  const prioridad = entero(formData, 'priority');
  createTask({
    title,
    parentId: ficha(formData).id,
    category: FICHA_MAQUINA.raiz,
    priority: prioridad && [1, 2, 3].includes(prioridad) ? prioridad : 2
  });
  refrescar();
}

export async function estadoTareaMaquinaAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'public_id');
  const status = text(formData, 'status');
  if (!publicId || !isTaskStatus(status)) return;
  setTaskStatus(publicId, status);
  refrescar();
}

export async function bitacoraMaquinaAction(formData: FormData): Promise<void> {
  const body = text(formData, 'body');
  if (!body) return;
  addNote(ficha(formData).id, body, 'human');
  refrescar();
}
