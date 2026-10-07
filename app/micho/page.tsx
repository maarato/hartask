import Link from 'next/link';
import { getLatestHandoff } from '@/lib/hartask/repositories/handoff';
import { listTasks } from '@/lib/hartask/repositories/tasks';
import type { Task } from '@/lib/hartask/types';
import { ESTADOS, listarParametros, listarProductos, type Producto } from '@/lib/micho/catalogo';

export const dynamic = 'force-dynamic';

const PRIORIDAD: Record<number, string> = { 3: 'alta', 2: 'media', 1: 'baja' };

function Tarjeta({ p }: { p: Producto }) {
  return (
    <article className="card producto">
      {p.foto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/micho/foto?ruta=${encodeURIComponent(p.foto)}`} alt={p.nombre} loading="lazy" />
      ) : (
        <div className="sin-foto muted small">Sin foto</div>
      )}
      <div className="stack producto-info">
        <strong>{p.nombre}</strong>
        <span className="row">
          <span className="category">{p.tecnica}</span>
          {p.detalle ? <span className="badge">{p.detalle}</span> : null}
          {p.canales ? <span className="badge">{p.canales}</span> : null}
        </span>
        {p.notas ? <span className="muted small">{p.notas}</span> : null}
        {p.carpeta ? <code className="small">{p.carpeta}</code> : null}
      </div>
    </article>
  );
}

function Tareas({ tareas }: { tareas: Task[] }) {
  const porCategoria = new Map<string, Task[]>();
  for (const t of tareas) {
    const c = t.category ?? 'Sin categoría';
    porCategoria.set(c, [...(porCategoria.get(c) ?? []), t]);
  }
  return (
    <div className="grid grid-2">
      {[...porCategoria].map(([categoria, lista]) => (
        <section key={categoria} className="card stack">
          <h3 className="section-head">
            {categoria} <span className="muted small">{lista.length}</span>
          </h3>
          <ul className="linked-list">
            {lista.map((t) => (
              <li key={t.id} className="row" style={{ margin: 0 }}>
                <span className="badge" data-status={t.status}>
                  {t.status}
                </span>
                <Link href={`/tasks/${t.public_id}`} className="task-link small">
                  {t.public_id}
                </Link>
                <span className="small">{t.title.replace(/\*\*/g, '').replace(/`/g, '')}</span>
                {t.priority === 3 ? <span className="category">{PRIORIDAD[3]}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default async function MichoPage({
  searchParams
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;
  const productos = listarProductos();
  const filtro = ESTADOS.find((e) => e === estado);
  const visibles = filtro ? productos.filter((p) => p.estado === filtro) : productos;

  // Root tasks with children are only area headers on this board, not work.
  const todas = listTasks({ includeClosed: false });
  const padres = new Set(todas.map((t) => t.parent_id).filter((id) => id !== null));
  const pendientes = todas.filter((t) => !padres.has(t.id));

  const handoff = getLatestHandoff();
  const parametros = listarParametros();

  return (
    <div className="stack sections">
      <header className="section-head">
        <h1 style={{ margin: 0 }}>Micho Store</h1>
        <p className="muted">
          {ESTADOS.map((e) => `${productos.filter((p) => p.estado === e).length} ${e.toLowerCase()}`).join(' · ')}
          {' · '}
          {pendientes.length} tareas pendientes
        </p>
      </header>

      {handoff?.next_step ? (
        <article className="card">
          <dl className="handoff">
            <dt>Siguiente paso</dt>
            <dd className="next-step">{handoff.next_step}</dd>
          </dl>
        </article>
      ) : null}

      <section className="stack">
        <header className="section-head">
          <h2>Tareas por hacer</h2>
          <Link href="/tasks" className="muted small">
            Ver tablero completo →
          </Link>
        </header>
        <Tareas tareas={pendientes} />
      </section>

      <section className="stack">
        <header className="section-head">
          <h2>Catálogo</h2>
          <p className="muted small">Leído de _docs/PRODUCTOS.md</p>
        </header>
        <nav className="row filters">
          <Link href="/micho" className={`chip${!filtro ? ' chip-on' : ''}`}>
            Todos
          </Link>
          {ESTADOS.map((e) => (
            <Link
              key={e}
              href={`/micho?estado=${encodeURIComponent(e)}`}
              className={`chip${filtro === e ? ' chip-on' : ''}`}
            >
              {e}
            </Link>
          ))}
        </nav>
        <div className="catalogo">
          {visibles.map((p) => (
            <Tarjeta key={`${p.estado}-${p.nombre}`} p={p} />
          ))}
        </div>
      </section>

      <section className="stack">
        <header className="section-head">
          <h2>Parámetros</h2>
          <p className="muted small">Leído de _docs/PARAMETROS.md</p>
        </header>
        <div className="card tabla-wrap">
          <table className="tabla">
            <thead>
              <tr>
                <th>Máquina</th>
                <th>Material</th>
                <th>Operación</th>
                <th>Parámetros</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {parametros.map((p, i) => (
                <tr key={i}>
                  <td className="muted">{p.seccion}</td>
                  <td>{p.material}</td>
                  <td>{p.operacion}</td>
                  <td>
                    <code>{p.parametros}</code>
                  </td>
                  <td className="small">{p.estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
