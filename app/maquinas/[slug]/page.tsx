import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Color, ListaColores } from '@/components/color';
import { Markdown } from '@/components/markdown';
import { CLOSED_STATUSES, type TaskStatus } from '@/lib/hartask/types';
import { listarProductos } from '@/lib/micho/catalogo';
import { listarInsumos } from '@/lib/micho/costos';
import { obtenerFicha } from '@/lib/micho/fichas';
import {
  claveFicha,
  colaDe,
  consumiblesDe,
  detallesDe,
  ESTADOS_MAQUINA,
  nombreTrabajo,
  obtenerMaquina,
  TIPOS_MAQUINA
} from '@/lib/micho/maquinas';
import {
  agregarTareaMaquinaAction,
  borrarMaquinaAction,
  bitacoraMaquinaAction,
  consumibleAction,
  editarMaquinaAction,
  encolarAction,
  estadoMaquinaAction,
  estadoTareaMaquinaAction,
  guardarDetallesAction,
  guardarInfoMaquinaAction,
  trabajoAction
} from '../actions';

export const dynamic = 'force-dynamic';

/** Empty rows at the end of the details form, for adding new ones without a separate button. */
const FILAS_EXTRA = 2;

function fechaLocal(utc: string | null): string {
  if (!utc) return '';
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? utc : d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

function Boton({
  accion,
  campos,
  children
}: {
  accion: (f: FormData) => Promise<void>;
  campos: Record<string, string | number>;
  children: React.ReactNode;
}) {
  return (
    <form action={accion}>
      {Object.entries(campos).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" className="mini">
        {children}
      </button>
    </form>
  );
}

export default async function MaquinaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = obtenerMaquina(slug);
  if (!m) notFound();

  const ficha = obtenerFicha(claveFicha(m.slug));
  const consumibles = consumiblesDe(m);
  const detalles = detallesDe(m.id);
  const cola = colaDe(m.id, true);
  const abiertos = cola.filter((t) => t.estado === 'En curso' || t.estado === 'En cola');
  const terminados = cola.filter((t) => t.estado === 'Hecho' || t.estado === 'Cancelado').slice(0, 15);
  const productosLista = listarProductos().filter((p) => p.slug);
  const productos = new Map<string | null, string>(productosLista.map((p) => [p.slug, p.nombre]));
  const insumos = listarInsumos().filter((i) => i.tipo !== 'Máquina');
  const tareas = ficha?.subtareas.filter((t) => !CLOSED_STATUSES.includes(t.status)) ?? [];
  const tareasHechas = ficha?.subtareas.filter((t) => CLOSED_STATUSES.includes(t.status)) ?? [];
  const ultimoEnCola = abiertos.filter((t) => t.estado === 'En cola').at(-1)?.id;
  const primeroEnCola = abiertos.find((t) => t.estado === 'En cola')?.id;

  return (
    <div className="stack sections">
      <ListaColores />
      <Link href="/maquinas" className="muted small">
        ← Máquinas
      </Link>

      <header className="stack" style={{ gap: 8 }}>
        <h1 className="detail-title">{m.apodo ?? m.nombre}</h1>
        <span className="row" style={{ margin: 0 }}>
          {m.apodo ? <span className="muted">{m.nombre}</span> : null}
          <span className="category">{m.tipo}</span>
          <span className="badge" data-estado-maquina={m.estado}>
            {m.estado}
          </span>
          {ficha ? (
            <Link href={`/tasks/${ficha.tarea.public_id}`} className="task-link small">
              Ficha {ficha.tarea.public_id}
            </Link>
          ) : null}
        </span>
      </header>

      <section className="card stack">
        <h2>Estado</h2>
        <form action={estadoMaquinaAction} className="row form" style={{ marginTop: 0 }}>
          <input type="hidden" name="slug" value={m.slug} />
          <div className="segmentos" role="radiogroup" aria-label="Estado">
            {ESTADOS_MAQUINA.map((e) => (
              <label key={e} className="segmento" data-estado-maquina={e}>
                <input type="radio" name="estado" value={e} defaultChecked={m.estado === e} />
                <span>{e}</span>
              </label>
            ))}
          </div>
          <input name="nota" placeholder="Nota (opcional: qué falló, qué calibrar…)" />
          <button type="submit">Guardar</button>
        </form>
        <span className="muted small">
          Al empezar un trabajo de la cola pasa sola a “Trabajando”, y al terminarlo regresa a “Activa”. Una falla
          queda anotada en la bitácora.
        </span>
      </section>

      <section className="card stack">
        <h2>{m.ranuras > 1 ? `Consumibles cargados (${m.ranuras})` : 'Consumible cargado'}</h2>
        <div className="stack" style={{ gap: 8 }}>
          {consumibles.map((c) => (
            <form key={c.ranura} action={consumibleAction} className="row ranura-form" style={{ margin: 0 }}>
              <input type="hidden" name="slug" value={m.slug} />
              <input type="hidden" name="ranura" value={c.ranura} />
              {m.ranuras > 1 ? <span className="ranura-num">{c.ranura}</span> : null}
              <span className="ranura-actual">
                {c.insumo || c.color ? (
                  <>
                    {c.insumo ? <strong>{c.insumo}</strong> : null} {c.color ? <Color nombre={c.color} /> : null}
                    {c.nota ? <span className="muted small"> · {c.nota}</span> : null}
                  </>
                ) : (
                  <span className="muted">Vacía</span>
                )}
              </span>
              <select name="insumo_id" defaultValue={c.insumo_id ?? ''} style={{ flex: '1 1 160px' }} aria-label="Material">
                <option value="">Material…</option>
                {insumos.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nombre}
                  </option>
                ))}
              </select>
              <input name="color" list="colores" defaultValue={c.color ?? ''} placeholder="Color" style={{ flex: '0 1 140px' }} />
              <input name="nota" defaultValue={c.nota ?? ''} placeholder="Nota (marca, restante…)" style={{ flex: '1 1 160px' }} />
              <button type="submit" className="mini">
                Cargar
              </button>
              {c.insumo || c.color || c.nota ? (
                <button type="submit" name="vaciar" value="1" className="mini">
                  Vaciar
                </button>
              ) : null}
            </form>
          ))}
        </div>
        {!insumos.length ? (
          <span className="small">
            Da de alta tus materiales en <Link href="/insumos" className="task-link">Insumos</Link> para elegirlos aquí.
          </span>
        ) : null}
      </section>

      <section className="card stack">
        <header className="section-head">
          <h2>Cola</h2>
          <span className="muted small">{abiertos.length ? `${abiertos.length} pendientes` : 'vacía'}</span>
        </header>
        {abiertos.length ? (
          <ol className="cola">
            {abiertos.map((t) => (
              <li key={t.id} className="row tarea-fila" data-estado-cola={t.estado} style={{ margin: 0 }}>
                <span className="badge" data-estado-cola={t.estado}>
                  {t.estado}
                </span>
                <span className="tarea-titulo">
                  {t.producto_slug ? (
                    <Link href={`/productos/${t.producto_slug}`} className="task-link">
                      {productos.get(t.producto_slug) ?? t.producto_slug}
                    </Link>
                  ) : null}
                  {t.descripcion ? <span>{t.producto_slug ? ` — ${t.descripcion}` : t.descripcion}</span> : null}
                  <span className="muted small"> · {t.piezas} pz</span>
                  {t.started_at ? <span className="muted small"> · desde {fechaLocal(t.started_at)}</span> : null}
                </span>
                <span className="tarea-acciones">
                  {t.estado === 'En cola' && t.id !== primeroEnCola ? (
                    <Boton accion={trabajoAction} campos={{ id: t.id, estado: 'subir' }}>
                      ↑
                    </Boton>
                  ) : null}
                  {t.estado === 'En cola' && t.id !== ultimoEnCola ? (
                    <Boton accion={trabajoAction} campos={{ id: t.id, estado: 'bajar' }}>
                      ↓
                    </Boton>
                  ) : null}
                  {t.estado === 'En cola' ? (
                    <Boton accion={trabajoAction} campos={{ id: t.id, estado: 'En curso' }}>
                      Empezar
                    </Boton>
                  ) : null}
                  {t.producto_slug ? (
                    <Boton accion={trabajoAction} campos={{ id: t.id, estado: 'Hecho', a_stock: '1' }}>
                      Hecho + stock
                    </Boton>
                  ) : null}
                  <Boton accion={trabajoAction} campos={{ id: t.id, estado: 'Hecho' }}>
                    Hecho
                  </Boton>
                  {t.estado === 'En cola' ? (
                    <Boton accion={trabajoAction} campos={{ id: t.id, estado: 'borrar' }}>
                      Quitar
                    </Boton>
                  ) : (
                    <Boton accion={trabajoAction} campos={{ id: t.id, estado: 'Cancelado' }}>
                      Cancelar
                    </Boton>
                  )}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted small">Nada en cola.</p>
        )}
        <form action={encolarAction} className="row form">
          <input type="hidden" name="slug" value={m.slug} />
          <select name="producto" defaultValue="" style={{ flex: '1 1 200px' }} aria-label="Producto">
            <option value="">Producto (opcional)…</option>
            {productosLista.map((p) => (
              <option key={p.slug} value={p.slug!}>
                {p.nombre}
              </option>
            ))}
          </select>
          <input name="descripcion" placeholder="Qué es / nota (ej. tanda para feria, prueba de color)" />
          <input name="piezas" inputMode="numeric" defaultValue="1" aria-label="Piezas" style={{ flex: '0 0 64px', width: 64 }} />
          <button type="submit">A la cola</button>
        </form>
        <span className="muted small">
          “Hecho + stock” suma las piezas al stock del producto y descuenta sus materiales, como “Fabriqué”.
        </span>
        {terminados.length ? (
          <details>
            <summary className="small muted">Terminados recientes</summary>
            <ul className="plain small" style={{ marginTop: 8 }}>
              {terminados.map((t) => (
                <li key={t.id}>
                  {fechaLocal(t.finished_at)} · {t.estado} · {nombreTrabajo(t, productos)} · {t.piezas} pz
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="card stack">
        <header className="section-head">
          <h2>Tareas</h2>
          <span className="muted small">mantenimiento, calibraciones, mejoras</span>
        </header>
        {tareas.length ? (
          <ul className="linked-list">
            {tareas.map((t) => (
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
                    <Boton accion={estadoTareaMaquinaAction} campos={{ public_id: t.public_id, status: 'IN_PROGRESS' satisfies TaskStatus }}>
                      Empezar
                    </Boton>
                  ) : null}
                  <Boton accion={estadoTareaMaquinaAction} campos={{ public_id: t.public_id, status: 'DONE' satisfies TaskStatus }}>
                    Hecha
                  </Boton>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Sin tareas pendientes.</p>
        )}
        <form action={agregarTareaMaquinaAction} className="row form">
          <input type="hidden" name="slug" value={m.slug} />
          <input name="title" placeholder="Nueva tarea (ej. cambiar boquilla, nivelar cama, limpiar lente)" required />
          <select name="priority" defaultValue="2" style={{ flex: '0 0 auto' }}>
            <option value="3">Alta</option>
            <option value="2">Media</option>
            <option value="1">Baja</option>
          </select>
          <button type="submit">Agregar</button>
        </form>
        {tareasHechas.length ? (
          <details>
            <summary className="small muted">{tareasHechas.length} terminadas</summary>
            <ul className="plain small" style={{ marginTop: 8 }}>
              {tareasHechas.map((t) => (
                <li key={t.id}>
                  {t.public_id} · {t.title}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="card stack">
        <h2>Detalles</h2>
        <form action={guardarDetallesAction} className="stack" style={{ gap: 8 }}>
          <input type="hidden" name="slug" value={m.slug} />
          <div className="detalles">
            {[...detalles, ...Array.from({ length: FILAS_EXTRA }, () => null)].map((d, i) => (
              <div key={d?.id ?? `nuevo-${i}`} className="detalle-fila">
                <input name="clave" defaultValue={d?.clave ?? ''} placeholder="Dato (ej. Boquilla)" aria-label="Dato" />
                <input name="valor" defaultValue={d?.valor ?? ''} placeholder={d ? 'sin anotar' : 'Valor (ej. 0.4 mm)'} aria-label="Valor" />
              </div>
            ))}
          </div>
          <span className="muted small">Borra el nombre de un dato para quitarlo. Las filas vacías de abajo son para agregar.</span>
          <button type="submit" style={{ alignSelf: 'flex-start' }}>
            Guardar detalles
          </button>
        </form>
      </section>

      <section className="card stack">
        <h2>Información</h2>
        {ficha?.tarea.description ? (
          <Markdown>{ficha.tarea.description}</Markdown>
        ) : (
          <p className="muted small">Mejoras hechas, refacciones, ligas a manuales, perfiles que funcionan…</p>
        )}
        <details open={!ficha?.tarea.description}>
          <summary className="small muted">{ficha?.tarea.description ? 'Editar' : 'Escribir'}</summary>
          <form action={guardarInfoMaquinaAction} className="stack form">
            <input type="hidden" name="slug" value={m.slug} />
            <textarea name="info" rows={10} defaultValue={ficha?.tarea.description ?? ''} />
            <span className="muted small">Markdown: # títulos, - listas, **negritas**, tablas.</span>
            <button type="submit" style={{ alignSelf: 'flex-start' }}>
              Guardar
            </button>
          </form>
        </details>
      </section>

      <section className="card stack">
        <header className="section-head">
          <h2>Bitácora</h2>
          <span className="muted small">fallas, calibraciones, cambios — con fecha</span>
        </header>
        <form action={bitacoraMaquinaAction} className="stack form">
          <input type="hidden" name="slug" value={m.slug} />
          <textarea name="body" rows={3} placeholder="Ej. cambié la boquilla a 0.6; la cama quedó nivelada a 0.1" required />
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

      <details className="card">
        <summary className="small muted">Editar máquina</summary>
        <form action={editarMaquinaAction} className="row form">
          <input type="hidden" name="slug" value={m.slug} />
          <input name="nombre" defaultValue={m.nombre} required aria-label="Modelo" />
          <input name="apodo" defaultValue={m.apodo ?? ''} placeholder="Apodo" aria-label="Apodo" style={{ flex: '0 1 180px' }} />
          <select name="tipo" defaultValue={m.tipo} style={{ flex: '0 0 auto' }}>
            {TIPOS_MAQUINA.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <label className="row small" style={{ margin: 0, flex: '0 0 auto', gap: 6 }}>
            <span className="muted">Consumibles a la vez</span>
            <input name="ranuras" inputMode="numeric" defaultValue={m.ranuras} style={{ width: 56, flex: '0 0 56px' }} />
          </label>
          <button type="submit">Guardar</button>
        </form>
        <form action={borrarMaquinaAction} className="row form borrar-maquina">
          <input type="hidden" name="slug" value={m.slug} />
          <label className="row checkbox small" style={{ margin: 0, alignItems: 'center' }}>
            <input type="checkbox" name="confirmar" required /> Sí, borrar esta máquina con sus detalles y su cola
          </label>
          <button type="submit" className="mini">
            Borrar máquina
          </button>
        </form>
        {ficha ? (
          <span className="muted small">Su ficha ({ficha.tarea.public_id}) y sus tareas se quedan en el tablero.</span>
        ) : null}
      </details>
    </div>
  );
}
