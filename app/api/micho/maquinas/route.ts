import { NextResponse } from 'next/server';
import { resumenFichas } from '@/lib/micho/fichas';
import { claveFicha, colaDe, consumiblesDe, crearMaquina, detallesDe, listarMaquinas } from '@/lib/micho/maquinas';

/**
 * Machines for agents: state, loaded consumables, open queue, details and the
 * ficha task (PATCH it, add notes and subtasks through /api/tasks).
 */
export async function GET() {
  const fichas = resumenFichas();
  return NextResponse.json({
    items: listarMaquinas().map((m) => ({
      ...m,
      consumibles: consumiblesDe(m),
      cola: colaDe(m.id),
      detalles: detallesDe(m.id).map(({ clave, valor }) => ({ clave, valor })),
      ficha: fichas.get(claveFicha(m.slug)) ?? null
    }))
  });
}

/** { nombre, apodo?, tipo?, ranuras? } */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    nombre?: string;
    apodo?: string;
    tipo?: string;
    ranuras?: number;
  } | null;
  if (!body?.nombre?.trim()) return NextResponse.json({ error: 'falta nombre' }, { status: 400 });
  const m = crearMaquina({ nombre: body.nombre.trim(), apodo: body.apodo, tipo: body.tipo, ranuras: body.ranuras });
  return NextResponse.json(m, { status: 201 });
}
