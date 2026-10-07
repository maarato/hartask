'use server';

import { revalidatePath } from 'next/cache';
import {
  actualizarInsumo,
  borrarInsumo,
  crearInsumo,
  crearInsumosBasicos,
  type DatosInsumo
} from '@/lib/micho/costos';

function text(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/** A blank price means "not known yet", which is different from $0. */
function precio(formData: FormData): number | null {
  const raw = text(formData, 'precio')?.replace(/[$,\s]/g, '');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function datos(formData: FormData): DatosInsumo | null {
  const nombre = text(formData, 'nombre');
  const unidad = text(formData, 'unidad');
  if (!nombre || !unidad) return null;
  return { nombre, unidad, tipo: text(formData, 'tipo'), precio: precio(formData), notas: text(formData, 'notas') };
}

/** Prices feed every product's cost, so every page that shows one is refreshed. */
function refrescar(): void {
  revalidatePath('/insumos');
  revalidatePath('/productos');
  revalidatePath('/productos/[slug]', 'page');
  revalidatePath('/micho');
}

export async function crearInsumoAction(formData: FormData): Promise<void> {
  const d = datos(formData);
  if (!d) return;
  try {
    crearInsumo(d);
  } catch {
    // Duplicate name: the unique index already says no, nothing else to do.
  }
  refrescar();
}

export async function actualizarInsumoAction(formData: FormData): Promise<void> {
  const id = Number(text(formData, 'id'));
  const d = datos(formData);
  if (!id || !d) return;
  try {
    actualizarInsumo(id, d);
  } catch {
    // Renamed onto an existing name: left as it was.
  }
  refrescar();
}

export async function borrarInsumoAction(formData: FormData): Promise<void> {
  const id = Number(text(formData, 'id'));
  if (id) borrarInsumo(id);
  refrescar();
}

export async function crearBasicosAction(): Promise<void> {
  crearInsumosBasicos();
  refrescar();
}
