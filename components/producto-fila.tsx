import Link from 'next/link';
import { Materiales } from '@/components/color';
import { CostoBadge, PrecioBadge, urlArchivo } from '@/components/producto-card';
import { CLOSED_STATUSES } from '@/lib/hartask/types';
import type { Producto } from '@/lib/micho/catalogo';
import type { Costeo } from '@/lib/micho/costos';
import type { Ficha } from '@/lib/micho/fichas';

const MAX_TAREAS = 5;

/** First lines of the Markdown info as plain text: enough to recognise it, not to read it. */
function extracto(md: string, max = 220): string {
  const plano = md
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    // Tables read as word soup once flattened; the detail page shows them properly.
    .replace(/^\s*\|.*$/gm, '')
    .replace(/\*\*|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plano.length > max ? `${plano.slice(0, max).trimEnd()}…` : plano;
}

/**
 * List row: the card's facts plus what lives in the ficha — next step, pending
 * tasks, an excerpt of the info and the latest finding.
 */
export function ProductoFila({
  p,
  ficha,
  costeo,
  stock,
  precios
}: {
  p: Producto;
  ficha?: Ficha | null;
  costeo?: Costeo | null;
  stock?: number;
  precios?: number[];
}) {
  const pendientes = ficha?.subtareas.filter((t) => !CLOSED_STATUSES.includes(t.status)) ?? [];
  const ultimo = ficha?.hallazgos[0];
  const titulo = p.slug ? (
    <Link href={`/productos/${p.slug}`} className="fila-nombre">
      {p.nombre}
    </Link>
  ) : (
    <strong>{p.nombre}</strong>
  );

  return (
    <article className="card fila">
      {p.foto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={urlArchivo(p.foto)} alt={p.nombre} loading="lazy" className="fila-foto" />
      ) : (
        <div className="fila-foto sin-foto muted small">Sin foto</div>
      )}

      <div className="stack fila-info">
        {titulo}
        <span className="row" style={{ margin: 0 }}>
          <span className="badge" data-estado={p.estado}>
            {p.detalle ?? p.estado}
          </span>
          <span className="category">{p.tecnica}</span>
          {p.canales ? <span className="badge">{p.canales}</span> : null}
          <PrecioBadge precios={precios} />
          <CostoBadge costeo={costeo} />
          {stock ? <span className="badge stock">{stock} listas</span> : null}
          {ficha ? (
            <Link href={`/tasks/${ficha.tarea.public_id}`} className="task-link small">
              {ficha.tarea.public_id}
            </Link>
          ) : null}
        </span>
        {costeo ? <Materiales lineas={costeo.lineas} /> : null}
        {ficha?.tarea.next_action ? (
          <span className="producto-avance">Sigue: {ficha.tarea.next_action}</span>
        ) : null}
        {ficha?.tarea.description ? (
          <span className="small fila-extracto">{extracto(ficha.tarea.description)}</span>
        ) : null}
        {p.notas ? <span className="muted small">{p.notas}</span> : null}
        {ultimo ? (
          <span className="small muted">
            Último hallazgo: <span className="fila-hallazgo">{extracto(ultimo.body, 140)}</span>
          </span>
        ) : null}
        {p.carpeta ? <code className="small fila-carpeta">{p.carpeta}</code> : null}
      </div>

      <div className="stack fila-tareas">
        <span className="muted small">
          {pendientes.length
            ? `${pendientes.length} ${pendientes.length === 1 ? 'tarea pendiente' : 'tareas pendientes'}`
            : ficha
              ? 'Sin tareas pendientes'
              : 'Sin ficha todavía'}
        </span>
        {pendientes.length ? (
          <ul className="linked-list">
            {pendientes.slice(0, MAX_TAREAS).map((t) => (
              <li key={t.id} className="row" style={{ margin: 0, flexWrap: 'nowrap', alignItems: 'baseline' }}>
                <span className="badge" data-status={t.status}>
                  {t.status}
                </span>
                <Link href={`/tasks/${t.public_id}`} className="small fila-tarea">
                  {t.title}
                </Link>
              </li>
            ))}
            {pendientes.length > MAX_TAREAS && p.slug ? (
              <li>
                <Link href={`/productos/${p.slug}`} className="task-link small">
                  +{pendientes.length - MAX_TAREAS} más
                </Link>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
