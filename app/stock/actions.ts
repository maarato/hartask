'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { listarProductos } from '@/lib/micho/catalogo';
import {
  fabricar,
  fijarMaterial,
  fijarProducto,
  MOTIVOS,
  moverMaterial,
  moverProducto,
  quitarStockMaterial,
  type Motivo
} from '@/lib/micho/stock';

function text(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function numero(formData: FormData, field: string): number | null {
  const raw = text(formData, field)?.replace(',', '.');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function motivo(formData: FormData, porDefecto: Motivo): Motivo {
  const m = text(formData, 'motivo');
  return (MOTIVOS as readonly string[]).includes(m ?? '') ? (m as Motivo) : porDefecto;
}

function productoValido(slug: string | null): slug is string {
  return !!slug && listarProductos().some((p) => p.slug === slug);
}

function refrescar(): void {
  revalidatePath('/stock');
  revalidatePath('/productos');
  revalidatePath('/productos/[slug]', 'page');
  revalidatePath('/micho');
  revalidatePath('/insumos');
}

/** Bought or used material: a positive amount adds, the "salida" button subtracts. */
export async function moverMaterialAction(formData: FormData): Promise<void> {
  const insumoId = numero(formData, 'insumo_id');
  const cant = numero(formData, 'cantidad');
  if (!insumoId || !cant || cant <= 0) return;
  const m = motivo(formData, 'entrada');
  const signo = m === 'entrada' ? 1 : -1;
  moverMaterial(insumoId, text(formData, 'color'), signo * cant, m, text(formData, 'nota'));
  refrescar();
}

/** Counted stock: sets the amount and the minimum. */
export async function fijarMaterialAction(formData: FormData): Promise<void> {
  const insumoId = numero(formData, 'insumo_id');
  const cant = numero(formData, 'cantidad');
  if (!insumoId || cant === null) return;
  fijarMaterial(insumoId, text(formData, 'color'), cant, numero(formData, 'minimo'));
  refrescar();
}

export async function quitarStockMaterialAction(formData: FormData): Promise<void> {
  const id = numero(formData, 'id');
  if (id) quitarStockMaterial(id);
  refrescar();
}

/**
 * Made pieces. Materials come off by default; the checkbox is for stock made
 * before this existed, whose material was never in the count.
 */
export async function fabricarAction(formData: FormData): Promise<void> {
  const slug = text(formData, 'slug');
  const piezas = numero(formData, 'piezas');
  if (!productoValido(slug) || !piezas || piezas <= 0 || !Number.isInteger(piezas)) return;
  const negativos = fabricar(slug, text(formData, 'variante'), piezas, formData.get('descontar') === 'on', text(formData, 'nota'));
  refrescar();
  // Tell the page which materials went below zero, so the count can be fixed.
  const volver = text(formData, 'volver');
  if (volver?.startsWith('/') && negativos.length) {
    redirect(`${volver}${volver.includes('?') ? '&' : '?'}faltan=${encodeURIComponent(negativos.map((n) => `${n.insumo}${n.color ? ` ${n.color}` : ''}`).join(', '))}`);
  }
}

/** Sold or otherwise gone. */
export async function salidaProductoAction(formData: FormData): Promise<void> {
  const slug = text(formData, 'slug');
  const piezas = numero(formData, 'piezas');
  if (!productoValido(slug) || !piezas || piezas <= 0 || !Number.isInteger(piezas)) return;
  moverProducto(slug, text(formData, 'variante'), -piezas, motivo(formData, 'venta'), text(formData, 'nota'));
  refrescar();
}

export async function fijarProductoAction(formData: FormData): Promise<void> {
  const slug = text(formData, 'slug');
  const cant = numero(formData, 'cantidad');
  if (!productoValido(slug) || cant === null || cant < 0 || !Number.isInteger(cant)) return;
  fijarProducto(slug, text(formData, 'variante'), cant);
  refrescar();
}
