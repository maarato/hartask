'use server';

import { revalidatePath } from 'next/cache';
import {
  actualizarCanal,
  borrarCanal,
  crearCanal,
  crearCanalesBasicos,
  fijarMargenObjetivo,
  type DatosCanal
} from '@/lib/micho/precios';

function text(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/** Blank means "not known yet", which is different from 0. */
function numero(formData: FormData, field: string): number | null {
  const raw = text(formData, field)?.replace(/[$%\s]/g, '').replace(',', '.');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function datos(formData: FormData): DatosCanal | null {
  const nombre = text(formData, 'nombre');
  if (!nombre) return null;
  return {
    nombre,
    comision_pct: numero(formData, 'comision_pct'),
    cargo_fijo: numero(formData, 'cargo_fijo'),
    envio: numero(formData, 'envio'),
    notas: text(formData, 'notas')
  };
}

/** Rates feed every product's price table. */
function refrescar(): void {
  revalidatePath('/canales');
  revalidatePath('/productos');
  revalidatePath('/productos/[slug]', 'page');
  revalidatePath('/micho');
}

export async function crearCanalAction(formData: FormData): Promise<void> {
  const d = datos(formData);
  if (!d) return;
  try {
    crearCanal(d);
  } catch {
    // Duplicate name: the unique index already refused it.
  }
  refrescar();
}

export async function actualizarCanalAction(formData: FormData): Promise<void> {
  const id = Number(text(formData, 'id'));
  const d = datos(formData);
  if (!id || !d) return;
  try {
    actualizarCanal(id, d);
  } catch {
    // Renamed onto an existing name: left as it was.
  }
  refrescar();
}

/** Needs the confirmation box: the prices set for this channel go with it. */
export async function borrarCanalAction(formData: FormData): Promise<void> {
  const id = Number(text(formData, 'id'));
  if (!id || formData.get('confirmar') !== 'on') return;
  borrarCanal(id);
  refrescar();
}

export async function crearCanalesBasicosAction(): Promise<void> {
  crearCanalesBasicos();
  refrescar();
}

export async function margenAction(formData: FormData): Promise<void> {
  const pct = numero(formData, 'margen');
  if (pct === null || pct >= 100) return;
  fijarMargenObjetivo(pct);
  refrescar();
}
