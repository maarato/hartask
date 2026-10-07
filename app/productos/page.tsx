import Link from 'next/link';
import { ProductoCard } from '@/components/producto-card';
import { ProductoFila } from '@/components/producto-fila';
import { todosLosCosteos } from '@/lib/micho/costos';
import { todosLosPrecios } from '@/lib/micho/precios';
import { stockPorProducto } from '@/lib/micho/stock';
import { resumenFichas, todasLasFichas } from '@/lib/micho/fichas';
import { ESTADOS, listarProductos } from '@/lib/micho/catalogo';

export const dynamic = 'force-dynamic';

/** `vista` is 'lista' or absent: the grid is the default and needs no parameter. */
type Filtros = { estado?: string; tecnica?: string; q?: string; vista?: string; costeo?: string };

/** Builds a filter link that keeps the other filters as they are. */
function href(actual: Filtros, cambio: Filtros): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...actual, ...cambio })) if (v) params.set(k, v);
  const qs = params.toString();
  return qs ? `/productos?${qs}` : '/productos';
}

/** '3D (Bambu A1)' and '3D multicolor' both filter as '3D'. */
function familia(tecnica: string): string {
  if (/fibra/i.test(tecnica)) return 'Fibra';
  if (/l[áa]ser/i.test(tecnica)) return 'Láser';
  if (/3d/i.test(tecnica)) return '3D';
  return tecnica || 'Otro';
}

export default async function ProductosPage({ searchParams }: { searchParams: Promise<Filtros> }) {
  const filtros = await searchParams;
  const productos = listarProductos();
  const lista = filtros.vista === 'lista';
  const fichas = resumenFichas();
  const completas = lista ? todasLasFichas() : null;
  const costeos = todosLosCosteos();
  const stock = stockPorProducto();
  const precios = todosLosPrecios();
  const preciosDe = (slug: string | null) => (slug ? [...(precios.get(slug)?.values() ?? [])] : undefined);
  const costeoDe = (p: { slug: string | null }) => (p.slug ? costeos.get(p.slug) ?? null : null);
  const sinCosteo = productos.filter((p) => !costeoDe(p)).length;
  const familias = [...new Set(productos.map((p) => familia(p.tecnica)))];
  const q = filtros.q?.trim().toLowerCase();

  const visibles = productos.filter(
    (p) =>
      (!filtros.estado || p.estado === filtros.estado) &&
      (!filtros.tecnica || familia(p.tecnica) === filtros.tecnica) &&
      (filtros.costeo !== 'falta' || !costeoDe(p)) &&
      (!q || `${p.nombre} ${p.notas ?? ''} ${p.carpeta ?? ''}`.toLowerCase().includes(q))
  );

  return (
    <div className="stack sections">
      <header className="section-head">
        <h1 style={{ margin: 0 }}>Productos</h1>
        <p className="muted">
          {visibles.length} de {productos.length} · leído de <code>_docs/PRODUCTOS.md</code>
        </p>
        <nav className="vista-toggle" aria-label="Vista">
          <Link href={href(filtros, { vista: undefined })} aria-current={!lista ? 'page' : undefined}>
            Rejilla
          </Link>
          <Link href={href(filtros, { vista: 'lista' })} aria-current={lista ? 'page' : undefined}>
            Lista
          </Link>
        </nav>
      </header>

      <div className="stack" style={{ gap: 8 }}>
        <form className="row" action="/productos" style={{ margin: 0 }}>
          {filtros.estado ? <input type="hidden" name="estado" value={filtros.estado} /> : null}
          {filtros.tecnica ? <input type="hidden" name="tecnica" value={filtros.tecnica} /> : null}
          {lista ? <input type="hidden" name="vista" value="lista" /> : null}
          {filtros.costeo ? <input type="hidden" name="costeo" value={filtros.costeo} /> : null}
          <input name="q" defaultValue={filtros.q ?? ''} placeholder="Buscar producto, nota o carpeta" />
          <button type="submit">Buscar</button>
        </form>
        <nav className="row filters">
          <span className="muted small">Estado</span>
          <Link href={href(filtros, { estado: undefined })} className={`chip${!filtros.estado ? ' chip-on' : ''}`}>
            Todos
          </Link>
          {ESTADOS.map((e) => (
            <Link key={e} href={href(filtros, { estado: e })} className={`chip${filtros.estado === e ? ' chip-on' : ''}`}>
              {e}
            </Link>
          ))}
        </nav>
        <nav className="row filters">
          <span className="muted small">Técnica</span>
          <Link href={href(filtros, { tecnica: undefined })} className={`chip${!filtros.tecnica ? ' chip-on' : ''}`}>
            Todas
          </Link>
          {familias.map((f) => (
            <Link key={f} href={href(filtros, { tecnica: f })} className={`chip${filtros.tecnica === f ? ' chip-on' : ''}`}>
              {f}
            </Link>
          ))}
        </nav>
        <nav className="row filters">
          <span className="muted small">Costeo</span>
          <Link href={href(filtros, { costeo: undefined })} className={`chip${!filtros.costeo ? ' chip-on' : ''}`}>
            Todos
          </Link>
          <Link href={href(filtros, { costeo: 'falta' })} className={`chip${filtros.costeo === 'falta' ? ' chip-on' : ''}`}>
            Sin costeo ({sinCosteo})
          </Link>
          <Link href="/insumos" className="muted small" style={{ marginLeft: 'auto' }}>
            Insumos y precios →
          </Link>
        </nav>
      </div>

      {visibles.length && lista ? (
        <div className="stack">
          {visibles.map((p) => (
            <ProductoFila key={`${p.estado}-${p.nombre}`} p={p} ficha={p.slug ? completas!.get(p.slug) : null} costeo={costeoDe(p)} stock={p.slug ? stock.get(p.slug)?.total : undefined} precios={preciosDe(p.slug)} />
          ))}
        </div>
      ) : visibles.length ? (
        <div className="catalogo">
          {visibles.map((p) => (
            <ProductoCard key={`${p.estado}-${p.nombre}`} p={p} avance={p.slug ? fichas.get(p.slug) : null} costeo={costeoDe(p)} stock={p.slug ? stock.get(p.slug)?.total : undefined} precios={preciosDe(p.slug)} />
          ))}
        </div>
      ) : (
        <p className="muted">Nada coincide con esos filtros.</p>
      )}
    </div>
  );
}
