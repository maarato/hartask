import { NextResponse } from 'next/server';
import { listarProductos } from '@/lib/micho/catalogo';
import { asegurarFicha, obtenerFicha } from '@/lib/micho/fichas';

type Ctx = { params: Promise<{ slug: string }> };

/** The product's ficha with its subtasks and findings; 404 when it has none yet. */
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  const ficha = obtenerFicha(slug);
  return ficha ? NextResponse.json(ficha) : NextResponse.json({ error: 'sin ficha' }, { status: 404 });
}

/** Creates the ficha if missing and returns it, so an agent can start writing to it. */
export async function POST(request: Request, { params }: Ctx) {
  const { slug } = await params;
  const producto = listarProductos().find((p) => p.slug === slug);
  if (!producto) return NextResponse.json({ error: 'producto desconocido' }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { agent_id?: string };
  asegurarFicha(slug, producto.nombre, body.agent_id ?? null);
  return NextResponse.json(obtenerFicha(slug), { status: 201 });
}
