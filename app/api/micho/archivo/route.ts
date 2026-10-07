import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { NextResponse } from 'next/server';
import { rutaDeProducto } from '@/lib/micho/catalogo';

const IMAGEN: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};
const TEXTO: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8'
};

/**
 * Serves a file from a product folder by project-relative path. Images and the
 * few types a browser shows well open inline; everything else (.lbrn2, .gc,
 * .3mf, .stl...) downloads under its own name.
 */
export async function GET(request: Request) {
  const rel = new URL(request.url).searchParams.get('ruta') ?? '';
  const abs = rutaDeProducto(rel);
  if (!abs) return NextResponse.json({ error: 'ruta no válida' }, { status: 400 });
  try {
    if (!statSync(abs).isFile()) throw new Error();
  } catch {
    return NextResponse.json({ error: 'no encontrado' }, { status: 404 });
  }
  const ext = extname(abs).toLowerCase();
  const inline = IMAGEN[ext] ?? TEXTO[ext];
  const nombre = encodeURIComponent(basename(abs));
  return new NextResponse(readFileSync(abs), {
    headers: {
      'Content-Type': inline ?? 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${nombre}`,
      // An SVG opened inline must not run script against this origin.
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300'
    }
  });
}
