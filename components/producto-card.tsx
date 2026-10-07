import Link from 'next/link';
import type { Producto } from '@/lib/micho/catalogo';
import type { ResumenFicha } from '@/lib/micho/fichas';

export function urlArchivo(ruta: string): string {
  return `/api/micho/archivo?ruta=${encodeURIComponent(ruta)}`;
}

/** Catalogue card; the whole card opens the product's detail page when it has a folder. */
export function ProductoCard({ p, avance }: { p: Producto; avance?: ResumenFicha | null }) {
  const cuerpo = (
    <>
      {p.foto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={urlArchivo(p.foto)} alt={p.nombre} loading="lazy" />
      ) : (
        <div className="sin-foto muted small">Sin foto</div>
      )}
      <div className="stack producto-info">
        <strong>{p.nombre}</strong>
        <span className="row">
          <span className="badge" data-estado={p.estado}>
            {p.detalle ?? p.estado}
          </span>
          <span className="category">{p.tecnica}</span>
          {p.canales ? <span className="badge">{p.canales}</span> : null}
        </span>
        {avance?.next_action ? <span className="producto-avance">Sigue: {avance.next_action}</span> : null}
        {avance?.pendientes ? (
          <span className="muted small">
            {avance.pendientes} {avance.pendientes === 1 ? 'tarea pendiente' : 'tareas pendientes'}
          </span>
        ) : null}
        {p.notas ? <span className="muted small">{p.notas}</span> : null}
      </div>
    </>
  );
  return p.slug ? (
    <Link href={`/productos/${p.slug}`} className="card producto producto-link">
      {cuerpo}
    </Link>
  ) : (
    <article className="card producto">{cuerpo}</article>
  );
}
