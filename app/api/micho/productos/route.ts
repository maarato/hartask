import { NextResponse } from 'next/server';
import { listarProductos } from '@/lib/micho/catalogo';
import { resumenFichas } from '@/lib/micho/fichas';

/**
 * The catalogue for agents: every product with its slug and, when it has one,
 * the ficha task to PATCH or add notes and subtasks to through /api/tasks.
 */
export async function GET() {
  const fichas = resumenFichas();
  return NextResponse.json({
    items: listarProductos().map((p) => ({ ...p, ficha: p.slug ? fichas.get(p.slug) ?? null : null }))
  });
}
