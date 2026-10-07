import Link from 'next/link';
import { Color } from '@/components/color';
import { listarProductos } from '@/lib/micho/catalogo';
import { resumenFichas } from '@/lib/micho/fichas';
import {
  claveFicha,
  colasAbiertas,
  consumiblesDe,
  ESTADOS_MAQUINA,
  listarMaquinas,
  nombreTrabajo,
  TIPOS_MAQUINA
} from '@/lib/micho/maquinas';
import { crearMaquinaAction } from './actions';

export const dynamic = 'force-dynamic';

const PLURAL: Record<string, string> = {
  Activa: 'activas',
  Trabajando: 'trabajando',
  'Por calibrar': 'por calibrar',
  Falla: 'con falla',
  'Fuera de servicio': 'fuera de servicio'
};

export default async function MaquinasPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const { estado } = await searchParams;
  const maquinas = listarMaquinas();
  const visibles = estado ? maquinas.filter((m) => m.estado === estado) : maquinas;
  const colas = colasAbiertas();
  const fichas = resumenFichas();
  const productos = new Map<string | null, string>(listarProductos().map((p) => [p.slug, p.nombre]));

  return (
    <div className="stack sections">
      <header className="section-head">
        <h1 style={{ margin: 0 }}>Máquinas</h1>
        <p className="muted">
          {ESTADOS_MAQUINA.map((e) => ({ e, n: maquinas.filter((m) => m.estado === e).length }))
            .filter(({ n }) => n)
            .map(({ e, n }) => `${n} ${n === 1 ? e.toLowerCase() : PLURAL[e]}`)
            .join(' · ') || 'Sin máquinas todavía'}
        </p>
      </header>

      {maquinas.length ? (
        <nav className="row filters">
          <span className="muted small">Estado</span>
          <Link href="/maquinas" className={`chip${!estado ? ' chip-on' : ''}`}>
            Todas
          </Link>
          {ESTADOS_MAQUINA.map((e) => (
            <Link
              key={e}
              href={`/maquinas?estado=${encodeURIComponent(e)}`}
              className={`chip${estado === e ? ' chip-on' : ''}`}
            >
              {e}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="maquinas">
        {visibles.map((m) => {
          const cola = colas.get(m.id) ?? [];
          const actual = cola.find((t) => t.estado === 'En curso');
          const enCola = cola.filter((t) => t.estado === 'En cola').length;
          const resumen = fichas.get(claveFicha(m.slug));
          return (
            <Link key={m.id} href={`/maquinas/${m.slug}`} className="card stack maquina" data-estado-maquina={m.estado}>
              <header className="maquina-head">
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <strong className="maquina-nombre">{m.apodo ?? m.nombre}</strong>
                  {m.apodo ? <span className="muted small">{m.nombre}</span> : null}
                </div>
                <span className="badge" data-estado-maquina={m.estado}>
                  {m.estado}
                </span>
              </header>
              <span className="row" style={{ margin: 0 }}>
                <span className="category">{m.tipo}</span>
                {m.ranuras > 1 ? <span className="muted small">{m.ranuras} ranuras</span> : null}
              </span>

              <ul className="ranuras">
                {consumiblesDe(m).map((c) => (
                  <li key={c.ranura}>
                    {m.ranuras > 1 ? <span className="muted small ranura-num">{c.ranura}</span> : null}
                    {c.insumo || c.color ? (
                      <span className="small">
                        {c.insumo ? `${c.insumo} ` : ''}
                        {c.color ? <Color nombre={c.color} /> : null}
                      </span>
                    ) : (
                      <span className="muted small">vacía</span>
                    )}
                  </li>
                ))}
              </ul>

              {actual ? (
                <span className="producto-avance">
                  Trabajando: {nombreTrabajo(actual, productos)} · {actual.piezas} pz
                </span>
              ) : null}
              <span className="muted small">
                {enCola ? `${enCola} en cola` : 'Cola vacía'}
                {resumen?.pendientes
                  ? ` · ${resumen.pendientes} ${resumen.pendientes === 1 ? 'tarea' : 'tareas'}`
                  : ''}
              </span>
            </Link>
          );
        })}
      </div>

      <section className="card stack">
        <h2>Nueva máquina</h2>
        <form action={crearMaquinaAction} className="row form" style={{ marginTop: 0 }}>
          <input name="nombre" placeholder="Modelo (ej. Creality K1C)" required />
          <input name="apodo" placeholder="Apodo (opcional)" style={{ flex: '0 1 180px' }} />
          <select name="tipo" defaultValue="Impresora 3D" style={{ flex: '0 0 auto' }}>
            {TIPOS_MAQUINA.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <label className="row small" style={{ margin: 0, flex: '0 0 auto', gap: 6 }}>
            <span className="muted">Consumibles a la vez</span>
            <input name="ranuras" inputMode="numeric" defaultValue="1" style={{ width: 56, flex: '0 0 56px' }} />
          </label>
          <button type="submit">Agregar</button>
        </form>
        <span className="muted small">
          Consumibles a la vez: 4 para una impresora con AMS o multicolor, 1 para las demás.
        </span>
      </section>
    </div>
  );
}
