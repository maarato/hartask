import Link from 'next/link';
import { Carrusel } from '@/components/carrusel';
import type { Producto } from '@/lib/micho/catalogo';
import { pesos, resumenMateriales, type Costeo } from '@/lib/micho/costos';
import type { ResumenFicha } from '@/lib/micho/fichas';

export function urlArchivo(ruta: string): string {
  return `/api/micho/archivo?ruta=${encodeURIComponent(ruta)}`;
}

/**
 * Production cost at a glance. "Sin costeo" is shown on purpose: the point is
 * that every product ends up with one, so the missing ones must stand out.
 */
export function CostoBadge({ costeo }: { costeo?: Costeo | null }) {
  if (!costeo) return <span className="badge costo-falta">Sin costeo</span>;
  return (
    <span className={`badge costo${costeo.completo ? '' : ' costo-incompleto'}`} title={costeo.completo ? undefined : 'Algún insumo no tiene precio'}>
      {costeo.completo ? '' : '≥ '}
      {pesos(costeo.total)}
    </span>
  );
}

/**
 * Catalogue card. The carousel sits outside the link so its arrows do not
 * open the product; the rest of the card does.
 */
export function ProductoCard({
  p,
  avance,
  costeo,
  stock
}: {
  p: Producto;
  avance?: ResumenFicha | null;
  costeo?: Costeo | null;
  /** Finished pieces on hand; undefined when none were ever registered. */
  stock?: number;
}) {
  const materiales = costeo ? resumenMateriales(costeo) : '';
  const info = (
    <>
      <strong>{p.nombre}</strong>
      <span className="row">
        <span className="badge" data-estado={p.estado}>
          {p.detalle ?? p.estado}
        </span>
        <span className="category">{p.tecnica}</span>
        {p.canales ? <span className="badge">{p.canales}</span> : null}
        <CostoBadge costeo={costeo} />
        {stock ? <span className="badge stock">{stock} listas</span> : null}
      </span>
      {materiales ? <span className="small materiales">{materiales}</span> : null}
      {avance?.next_action ? <span className="producto-avance">Sigue: {avance.next_action}</span> : null}
      {avance?.pendientes ? (
        <span className="muted small">
          {avance.pendientes} {avance.pendientes === 1 ? 'tarea pendiente' : 'tareas pendientes'}
        </span>
      ) : null}
      {p.notas ? <span className="muted small">{p.notas}</span> : null}
    </>
  );
  return (
    <article className={`card producto${p.slug ? ' producto-link' : ''}`}>
      <Carrusel fotos={p.fotos.map(urlArchivo)} alt={p.nombre} />
      {p.slug ? (
        <Link href={`/productos/${p.slug}`} className="stack producto-info">
          {info}
        </Link>
      ) : (
        <div className="stack producto-info">{info}</div>
      )}
    </article>
  );
}
