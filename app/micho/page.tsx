import Link from 'next/link';
import { getLatestHandoff } from '@/lib/hartask/repositories/handoff';
import { listTasks } from '@/lib/hartask/repositories/tasks';
import type { Task } from '@/lib/hartask/types';
import { ProductoCard } from '@/components/producto-card';
import { todosLosCosteos } from '@/lib/micho/costos';
import { todosLosPrecios } from '@/lib/micho/precios';
import { stockPorProducto } from '@/lib/micho/stock';
import { resumenFichas } from '@/lib/micho/fichas';
import { ESTADOS, listarParametros, listarProductos } from '@/lib/micho/catalogo';

export const dynamic = 'force-dynamic';

const PRIORIDAD: Record<number, string> = { 3: 'alta', 2: 'media', 1: 'baja' };

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

export default function MichoPage() {
  const productos = listarProductos();
  const fichas = resumenFichas();
  const costeos = todosLosCosteos();
  const stock = stockPorProducto();
  const precios = todosLosPrecios();
  const preciosDe = (slug: string | null) => (slug ? [...(precios.get(slug)?.values() ?? [])] : undefined);
  const listos = productos.filter((p) => p.estado === 'Listo');

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
          <h2>Listos para vender</h2>
          <Link href="/productos" className="muted small">
            Ver todos los productos →
          </Link>
        </header>
        <div className="catalogo">
          {listos.map((p) => (
            <ProductoCard key={p.nombre} p={p} avance={p.slug ? fichas.get(p.slug) : null} costeo={p.slug ? costeos.get(p.slug) : null} stock={p.slug ? stock.get(p.slug)?.total : undefined} precios={preciosDe(p.slug)} />
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
