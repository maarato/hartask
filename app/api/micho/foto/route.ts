import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { NextResponse } from 'next/server';
import { dentroDelProyecto, IMAGENES } from '@/lib/micho/catalogo';

const TIPOS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

/** Serves a product photo by project-relative path. Images only, never outside the root. */
export async function GET(request: Request) {
  const rel = new URL(request.url).searchParams.get('ruta') ?? '';
  const ext = extname(rel).toLowerCase();
  const abs = IMAGENES.has(ext) ? dentroDelProyecto(rel) : null;
  if (!abs) return NextResponse.json({ error: 'ruta no válida' }, { status: 400 });
  try {
    if (!statSync(abs).isFile()) throw new Error();
    return new NextResponse(readFileSync(abs), {
      headers: { 'Content-Type': TIPOS[ext], 'Cache-Control': 'private, max-age=300' }
    });
  } catch {
    return NextResponse.json({ error: 'no encontrada' }, { status: 404 });
  }
}
