import Link from 'next/link';
import { Color, ListaColores } from '@/components/color';
import { notFound } from 'next/navigation';
import { CostoBadge, urlArchivo } from '@/components/producto-card';
import { Markdown } from '@/components/markdown';
import { listTasks } from '@/lib/hartask/repositories/tasks';
import { CLOSED_STATUSES, TASK_STATUSES, type TaskStatus } from '@/lib/hartask/types';
import { cantidad, costeoDe, listarInsumos, nombreInsumo, pesos } from '@/lib/micho/costos';
import { obtenerFicha } from '@/lib/micho/fichas';
import { canalCompleto, cuenta, listarCanales, margenObjetivo, precioSugerido, preciosDe } from '@/lib/micho/precios';
import { movimientos, stockPorProducto } from '@/lib/micho/stock';
import { fabricarAction, salidaProductoAction } from '../../stock/actions';
import {
  agregarHallazgoAction,
  agregarInsumoProductoAction,
  fijarPrecioAction,
  agregarTareaAction,
  cambiarEstadoTareaAction,
  guardarAvanceAction,
  guardarInfoAction,
  quitarInsumoProductoAction
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

export default async function ProductoPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ faltan?: string }>;
}) {
  const { slug } = await params;
  const { faltan } = await searchParams;
  const p = detalleProducto(slug);
  if (!p) notFound();

  const ficha = obtenerFicha(slug);
  const costeo = costeoDe(slug);
  const insumos = listarInsumos();
  const stock = stockPorProducto().get(slug);
  const canales = listarCanales();
  const precios = preciosDe(slug);
  const margen = margenObjetivo();
  const movs = movimientos({ slug, limite: 10 });
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
      <ListaColores />
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
        <header className="section-head">
          <h2>Stock</h2>
          <span className="badge stock">{stock?.total ?? 0} listas</span>
          <Link href="/stock" className="muted small" style={{ marginLeft: 'auto' }}>
            Todo el stock →
          </Link>
        </header>
        {faltan ? (
          <p className="blocked small" style={{ margin: 0 }}>
            Se fabricó, pero no alcanzaba el material registrado: {faltan} quedó en negativo. Ajusta el conteo en{' '}
            <Link href="/stock" className="task-link">
              Stock
            </Link>
            .
          </p>
        ) : null}
        {stock?.variantes.some((v) => v.cantidad !== 0) ? (
          <ul className="linked-list">
            {stock.variantes
              .filter((v) => v.cantidad !== 0)
              .map((v) => (
                <li key={v.variante} className="row tarea-fila" style={{ margin: 0 }}>
                  <strong className={v.cantidad < 0 ? 'blocked' : undefined}>{v.cantidad} pz</strong>
                  <span className="small tarea-titulo">{v.variante ? <Color nombre={v.variante} /> : 'sin variante'}</span>
                  <form action={salidaProductoAction} className="row mini-form tarea-acciones">
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="variante" value={v.variante} />
                    <input name="piezas" inputMode="numeric" placeholder="Pz" required aria-label="Piezas vendidas" />
                    <button type="submit" className="mini">
                      Vendí
                    </button>
                  </form>
                </li>
              ))}
          </ul>
        ) : null}
        <form action={fabricarAction} className="row form" style={{ marginTop: 0 }}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="volver" value={`/productos/${slug}`} />
          <input name="piezas" inputMode="numeric" placeholder="Piezas" required style={{ flex: '0 1 90px' }} />
          <input name="variante" list="colores" placeholder="Variante / color (opcional)" style={{ flex: '0 1 200px' }} />
          <label className="row checkbox small" style={{ margin: 0, flex: '0 0 auto', alignItems: 'center' }}>
            <input type="checkbox" name="descontar" defaultChecked={!!costeo} disabled={!costeo} /> Descontar materiales
          </label>
          <button type="submit">Fabriqué</button>
        </form>
        {!costeo ? (
          <span className="muted small">Sin costeo no hay materiales que descontar: se suman solo las piezas.</span>
        ) : null}
        {movs.length ? (
          <details>
            <summary className="small muted">Últimos movimientos</summary>
            <ul className="plain small" style={{ marginTop: 8 }}>
              {movs.map((m) => (
                <li key={m.id}>
                  {fechaLocal(m.created_at)} · {m.motivo} ·{' '}
                  {m.tipo === 'producto'
                    ? `${m.delta > 0 ? '+' : ''}${m.delta} pz${m.detalle ? ` ${m.detalle}` : ''}`
                    : `${m.delta > 0 ? '+' : ''}${cantidad(m.delta)} ${m.unidad} ${m.insumo}${m.detalle ? ` ${m.detalle}` : ''}`}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="card stack">
        <header className="section-head">
          <h2>Producción y costo</h2>
          <CostoBadge costeo={costeo} />
          <Link href="/insumos" className="muted small" style={{ marginLeft: 'auto' }}>
            Insumos y precios →
          </Link>
        </header>
        {costeo ? (
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th>Cantidad</th>
                  <th>Color</th>
                  <th style={{ textAlign: 'right' }}>Precio</th>
                  <th style={{ textAlign: 'right' }}>Subtotal</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {costeo.lineas.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.insumo} <span className="muted small">{l.tipo}</span>
                      {l.nota ? <div className="muted small">{l.nota}</div> : null}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {cantidad(l.cantidad)} {l.unidad}
                    </td>
                    <td>
                      <Color nombre={l.color} />
                    </td>
                    <td className="muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {l.precio === null ? (
                        <Link href="/insumos" className="blocked small">
                          sin precio
                        </Link>
                      ) : (
                        `${pesos(l.precio)} / ${l.unidad}`
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {l.subtotal === null ? '—' : pesos(l.subtotal)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <form action={quitarInsumoProductoAction}>
                        <input type="hidden" name="id" value={l.id} />
                        <button type="submit" className="mini" aria-label={`Quitar ${l.insumo}`}>
                          Quitar
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4} style={{ textAlign: 'right' }}>
                    <strong>Costo de producción{costeo.completo ? '' : ' (incompleto)'}</strong>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <strong>{pesos(costeo.total)}</strong>
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">
            Sin costeo todavía. Agrega lo que lleva una pieza: material (cuánto y de qué color), tiempo de máquina,
            empaque…
          </p>
        )}
        {insumos.length ? (
          <form action={agregarInsumoProductoAction} className="row form">
            <input type="hidden" name="slug" value={slug} />
            <select name="insumo_id" required defaultValue="" style={{ flex: '1 1 180px' }}>
              <option value="" disabled>
                Insumo…
              </option>
              {insumos.map((i) => (
                <option key={i.id} value={i.id}>
                  {nombreInsumo(i)} ({i.unidad})
                </option>
              ))}
            </select>
            <input name="cantidad" inputMode="decimal" placeholder="Cantidad" required style={{ flex: '0 1 110px' }} />
            <input name="color" list="colores" placeholder="Color (opcional)" style={{ flex: '0 1 150px' }} />
            <input name="nota" placeholder="Nota (opcional)" />
            <button type="submit">Agregar</button>
          </form>
        ) : (
          <p className="small">
            Primero da de alta tus insumos en <Link href="/insumos" className="task-link">Insumos</Link>.
          </p>
        )}
        <span className="muted small">
          Por pieza: si una hoja de MDF rinde 2 piezas, pon 0.5 hojas. Las horas de máquina se ponen en horas (30 min = 0.5).
        </span>
      </section>

      <section className="card stack">
        <header className="section-head">
          <h2>Precio de venta</h2>
          <span className="muted small">margen objetivo {margen}%</span>
          <Link href="/canales" className="muted small" style={{ marginLeft: 'auto' }}>
            Canales y comisiones →
          </Link>
        </header>
        {!canales.length ? (
          <p className="small">
            Primero da de alta tus canales en <Link href="/canales" className="task-link">Canales</Link>.
          </p>
        ) : !costeo ? (
          <p className="muted small">
            Sin costeo no se puede calcular: agrega los insumos de una pieza en “Producción y costo”. Puedes anotar ya lo
            que cobras.
          </p>
        ) : null}
        {canales.length ? (
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Canal</th>
                  <th style={{ textAlign: 'right' }}>Sugerido</th>
                  <th>Cobras</th>
                  <th style={{ textAlign: 'right' }}>Canal + envío</th>
                  <th style={{ textAlign: 'right' }}>Te queda</th>
                  <th style={{ textAlign: 'right' }}>Margen</th>
                </tr>
              </thead>
              <tbody>
                {canales.map((c) => {
                  const precio = precios.get(c.id);
                  const sugerido = costeo ? precioSugerido(costeo.total, c, margen) : null;
                  const r = precio !== undefined && costeo ? cuenta(precio, costeo.total, c) : null;
                  return (
                    <tr key={c.id}>
                      <td>
                        {c.nombre}
                        {!canalCompleto(c) ? (
                          <Link href="/canales" className="blocked small" style={{ display: 'block' }}>
                            faltan sus tarifas
                          </Link>
                        ) : null}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} className="muted">
                        {sugerido !== null ? pesos(sugerido) : costeo ? 'no alcanza' : '—'}
                      </td>
                      <td>
                        <form action={fijarPrecioAction} className="row mini-form">
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="canal_id" value={c.id} />
                          <input name="precio" inputMode="decimal" defaultValue={precio ?? ''} placeholder="$" aria-label={`Precio en ${c.nombre}`} />
                          <button type="submit" className="mini">
                            Guardar
                          </button>
                        </form>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} className="muted">
                        {r ? pesos(r.canal + r.envio) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} className={r && r.ganancia < 0 ? 'blocked' : undefined}>
                        {r ? <strong>{pesos(r.ganancia)}</strong> : '—'}
                      </td>
                      <td
                        style={{ textAlign: 'right', whiteSpace: 'nowrap' }}
                        className={r ? (r.margen < 0 ? 'blocked' : r.margen < margen ? 'margen-bajo' : 'margen-ok') : undefined}
                      >
                        {r ? `${r.margen.toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {costeo && !costeo.completo ? (
          <span className="small margen-bajo">El costeo está incompleto (algún insumo sin precio): lo que te queda es menos.</span>
        ) : null}
        <span className="muted small">
          Sugerido = (costo + cargo fijo + envío) ÷ (1 − comisión − margen), redondeado hacia arriba. Deja vacío
          “Cobras” si no lo vendes en ese canal.
        </span>
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
