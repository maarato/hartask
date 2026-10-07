import Link from 'next/link';
import { notFound } from 'next/navigation';
import { urlArchivo } from '@/components/producto-card';
import { Markdown } from '@/components/markdown';
import { listTasks } from '@/lib/hartask/repositories/tasks';
import { CLOSED_STATUSES, TASK_STATUSES, type TaskStatus } from '@/lib/hartask/types';
import { obtenerFicha } from '@/lib/micho/fichas';
import {
  agregarHallazgoAction,
  agregarTareaAction,
  cambiarEstadoTareaAction,
  guardarAvanceAction,
  guardarInfoAction
} from './actions';
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

/** SQLite stores CURRENT_TIMESTAMP in UTC; shown in the machine's time. */
function fechaLocal(utc: string): string {
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime())
    ? utc
    : d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function porSubcarpeta(archivos: Archivo[]): [string, Archivo[]][] {
  const grupos = new Map<string, Archivo[]>();
  for (const a of archivos) grupos.set(a.subcarpeta, [...(grupos.get(a.subcarpeta) ?? []), a]);
  return [...grupos].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
}

function EstadoBoton({ publicId, status, label }: { publicId: string; status: TaskStatus; label: string }) {
  return (
    <form action={cambiarEstadoTareaAction}>
      <input type="hidden" name="public_id" value={publicId} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className="mini">
        {label}
      </button>
    </form>
  );
}

export default async function ProductoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = detalleProducto(slug);
  if (!p) notFound();

  const ficha = obtenerFicha(slug);
  const abiertas = ficha?.subtareas.filter((t) => !CLOSED_STATUSES.includes(t.status)) ?? [];
  const cerradas = ficha?.subtareas.filter((t) => CLOSED_STATUSES.includes(t.status)) ?? [];

  // Board tasks that name this product's folder but are not in its ficha:
  // a loose match, good enough to point the way.
  const propias = new Set([ficha?.tarea.id, ...(ficha?.subtareas.map((t) => t.id) ?? [])]);
  const clave = sinAcentos(p.carpeta!.split('/').pop() ?? '');
  const relacionadas = clave
    ? listTasks({ includeClosed: false }).filter(
        (t) => !propias.has(t.id) && sinAcentos(`${t.title} ${t.next_action ?? ''}`).includes(clave)
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
          {ficha ? (
            <Link href={`/tasks/${ficha.tarea.public_id}`} className="task-link small">
              Ficha {ficha.tarea.public_id}
            </Link>
          ) : null}
        </span>
      </header>

      <article className="card">
        <dl className="handoff">
          {p.notas ? (
            <>
              <dt>Notas del catálogo</dt>
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

      <section className="card stack">
        <header className="section-head">
          <h2>Cómo va</h2>
          {ficha ? (
            <span className="badge" data-status={ficha.tarea.status}>
              {ficha.tarea.status}
            </span>
          ) : null}
        </header>
        {ficha?.tarea.next_action ? (
          <dl className="handoff">
            <dt>Siguiente paso</dt>
            <dd className="next-step">{ficha.tarea.next_action}</dd>
          </dl>
        ) : (
          <p className="muted small">Todavía no hay siguiente paso.</p>
        )}
        <details>
          <summary className="small muted">Cambiar</summary>
          <form action={guardarAvanceAction} className="row form">
            <input type="hidden" name="slug" value={slug} />
            <select name="status" defaultValue={ficha?.tarea.status ?? 'BACKLOG'} style={{ flex: '0 0 auto' }}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input name="next_action" defaultValue={ficha?.tarea.next_action ?? ''} placeholder="¿Qué sigue?" />
            <button type="submit">Guardar</button>
          </form>
        </details>
      </section>

      <section className="card stack">
        <header className="section-head">
          <h2>Tareas</h2>
          {abiertas.length ? <span className="muted small">{abiertas.length} pendientes</span> : null}
        </header>
        {abiertas.length ? (
          <ul className="linked-list">
            {abiertas.map((t) => (
              <li key={t.id} className="row tarea-fila" style={{ margin: 0 }}>
                <span className="badge" data-status={t.status}>
                  {t.status}
                </span>
                <Link href={`/tasks/${t.public_id}`} className="task-link small">
                  {t.public_id}
                </Link>
                <span className="small tarea-titulo">{t.title}</span>
                {t.priority === 3 ? <span className="category">alta</span> : null}
                <span className="tarea-acciones">
                  {t.status !== 'IN_PROGRESS' ? (
                    <EstadoBoton publicId={t.public_id} status="IN_PROGRESS" label="Empezar" />
                  ) : null}
                  <EstadoBoton publicId={t.public_id} status="DONE" label="Hecha" />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Sin tareas pendientes.</p>
        )}
        <form action={agregarTareaAction} className="row form">
          <input type="hidden" name="slug" value={slug} />
          <input name="title" placeholder="Nueva tarea para este producto" required />
          <select name="priority" defaultValue="2" style={{ flex: '0 0 auto' }}>
            <option value="3">Alta</option>
            <option value="2">Media</option>
            <option value="1">Baja</option>
          </select>
          <button type="submit">Agregar</button>
        </form>
        {cerradas.length ? (
          <details>
            <summary className="small muted">{cerradas.length} terminadas</summary>
            <ul className="linked-list" style={{ marginTop: 10 }}>
              {cerradas.map((t) => (
                <li key={t.id} className="row tarea-fila" style={{ margin: 0, opacity: 0.7 }}>
                  <span className="badge" data-status={t.status}>
                    {t.status}
                  </span>
                  <span className="small tarea-titulo">{t.title}</span>
                  <span className="tarea-acciones">
                    <EstadoBoton publicId={t.public_id} status="BACKLOG" label="Reabrir" />
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {relacionadas.length ? (
          <div className="stack" style={{ gap: 6 }}>
            <span className="muted small">En el tablero y parecen de este producto:</span>
            <ul className="linked-list">
              {relacionadas.map((t) => (
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
          </div>
        ) : null}
      </section>

      <section className="card stack">
        <h2>Información</h2>
        {ficha?.tarea.description ? (
          <Markdown>{ficha.tarea.description}</Markdown>
        ) : (
          <p className="muted small">
            Medidas, materiales, costos, variantes, cómo se arma… lo que quieras tener a la mano.
          </p>
        )}
        <details open={!ficha?.tarea.description}>
          <summary className="small muted">{ficha?.tarea.description ? 'Editar' : 'Escribir'}</summary>
          <form action={guardarInfoAction} className="stack form">
            <input type="hidden" name="slug" value={slug} />
            <textarea
              name="info"
              rows={12}
              defaultValue={ficha?.tarea.description ?? ''}
              placeholder={'## Medidas\n- 12 × 12 × 7 cm\n\n## Material\n- MDF 3 mm'}
            />
            <span className="muted small">Markdown: # títulos, - listas, **negritas**, tablas.</span>
            <button type="submit" style={{ alignSelf: 'flex-start' }}>
              Guardar
            </button>
          </form>
        </details>
      </section>

      <section className="card stack">
        <header className="section-head">
          <h2>Hallazgos</h2>
          <span className="muted small">bitácora: lo que vas descubriendo, con fecha</span>
        </header>
        <form action={agregarHallazgoAction} className="stack form">
          <input type="hidden" name="slug" value={slug} />
          <textarea
            name="body"
            rows={3}
            placeholder="Ej. con 5 pasadas no cortaba completo en las esquinas; con 6 sí."
            required
          />
          <button type="submit" style={{ alignSelf: 'flex-start' }}>
            Anotar
          </button>
        </form>
        {ficha?.hallazgos.length ? (
          <ul className="notes">
            {ficha.hallazgos.map((n) => (
              <li key={n.id}>
                <span className="muted small">
                  {fechaLocal(n.created_at)} · {n.author_type === 'human' ? 'tú' : 'agente'}
                </span>
                <Markdown>{n.body}</Markdown>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

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
