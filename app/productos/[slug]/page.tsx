import Link from 'next/link';
import { notFound } from 'next/navigation';
import { urlArchivo } from '@/components/producto-card';
import { listTasks } from '@/lib/hartask/repositories/tasks';
import { detalleProducto, type Archivo } from '@/lib/micho/catalogo';

export const dynamic = 'force-dynamic';

/** What each design extension is, so the list reads as "what can I cut/print". */
const TIPOS: Record<string, string> = {
  '.lbrn2': 'LightBurn',
  '.lbrn': 'LightBurn',
  '.gc': 'G-code láser',
  '.nc': 'G-code láser',
  '.gcode': 'G-code 3D',
  '.3mf': 'Proyecto 3D',
  '.stl': 'Modelo 3D',
  '.obj': 'Modelo 3D',
  '.step': 'CAD',
  '.svg': 'Vector',
  '.dxf': 'Vector',
  '.ai': 'Vector',
  '.orzx': 'MR Carve',
  '.pdf': 'PDF',
  '.json': 'Datos',
  '.zip': 'Comprimido'
};

function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function porSubcarpeta(archivos: Archivo[]): [string, Archivo[]][] {
  const grupos = new Map<string, Archivo[]>();
  for (const a of archivos) grupos.set(a.subcarpeta, [...(grupos.get(a.subcarpeta) ?? []), a]);
  return [...grupos].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
}

export default async function ProductoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = detalleProducto(slug);
  if (!p) notFound();

  // Tasks that name this product's folder: a loose match, good enough to point the way.
  const clave = sinAcentos(p.carpeta!.split('/').pop() ?? '');
  const tareas = clave
    ? listTasks({ includeClosed: false }).filter((t) =>
        sinAcentos(`${t.title} ${t.next_action ?? ''}`).includes(clave)
      )
    : [];

  return (
    <div className="stack sections">
      <Link href="/productos" className="muted small">
        ← Productos
      </Link>

      <header className="stack" style={{ gap: 8 }}>
        <h1 className="detail-title">{p.nombre}</h1>
        <span className="row" style={{ margin: 0 }}>
          <span className="badge" data-estado={p.estado}>
            {p.detalle ?? p.estado}
          </span>
          <span className="category">{p.tecnica}</span>
          {p.canales ? <span className="badge">{p.canales}</span> : null}
        </span>
      </header>

      <article className="card">
        <dl className="handoff">
          {p.notas ? (
            <>
              <dt>Notas</dt>
              <dd>{p.notas}</dd>
            </>
          ) : null}
          <dt>Carpeta</dt>
          <dd>
            <code>{p.carpeta}</code>
            {!p.existe ? <span className="blocked small"> · no existe en disco</span> : null}
          </dd>
        </dl>
      </article>

      {tareas.length ? (
        <section className="card stack">
          <h2>Tareas</h2>
          <ul className="linked-list">
            {tareas.map((t) => (
              <li key={t.id} className="row" style={{ margin: 0 }}>
                <span className="badge" data-status={t.status}>
                  {t.status}
                </span>
                <Link href={`/tasks/${t.public_id}`} className="task-link small">
                  {t.public_id}
                </Link>
                <span className="small">{t.title.replace(/\*\*|`/g, '')}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="stack">
        <h2>Fotos {p.fotos.length ? <span className="muted small">{p.fotos.length}</span> : null}</h2>
        {p.fotos.length ? (
          <div className="galeria">
            {p.fotos.map((f) => (
              <a key={f.ruta} href={urlArchivo(f.ruta)} target="_blank" rel="noreferrer" title={f.ruta}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={urlArchivo(f.ruta)} alt={f.nombre} loading="lazy" />
              </a>
            ))}
          </div>
        ) : (
          <p className="muted">Sin fotos todavía.</p>
        )}
      </section>

      <section className="stack">
        <h2>Archivos {p.archivos.length ? <span className="muted small">{p.archivos.length}</span> : null}</h2>
        {p.archivos.length ? (
          <div className="card tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Tipo</th>
                  <th style={{ textAlign: 'right' }}>Tamaño</th>
                </tr>
              </thead>
              <tbody>
                {porSubcarpeta(p.archivos).map(([sub, lista]) => [
                  sub ? (
                    <tr key={`h-${sub}`}>
                      <td colSpan={3} className="muted small subcarpeta">
                        {sub}/
                      </td>
                    </tr>
                  ) : null,
                  ...lista.map((a) => (
                    <tr key={a.ruta}>
                      <td>
                        <a href={urlArchivo(a.ruta)} className="task-link">
                          {a.nombre}
                        </a>
                      </td>
                      <td className="muted">{TIPOS[a.ext] ?? a.ext.replace('.', '').toUpperCase()}</td>
                      <td className="muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {tamano(a.bytes)}
                      </td>
                    </tr>
                  ))
                ])}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Sin archivos.</p>
        )}
        {p.truncado ? <p className="muted small">La carpeta tiene más archivos de los que se muestran.</p> : null}
      </section>
    </div>
  );
}
