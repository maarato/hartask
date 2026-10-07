import Link from 'next/link';
import { listarProductos } from '@/lib/micho/catalogo';
import { cantidad, listarInsumos } from '@/lib/micho/costos';
import { listarStockMateriales, listarStockProductos, movimientos } from '@/lib/micho/stock';
import {
  fabricarAction,
  fijarMaterialAction,
  fijarProductoAction,
  moverMaterialAction,
  quitarStockMaterialAction,
  salidaProductoAction
} from './actions';

export const dynamic = 'force-dynamic';

function fechaLocal(utc: string): string {
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? utc : d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

function signo(n: number): string {
  return `${n > 0 ? '+' : ''}${cantidad(n)}`;
}

export default async function StockPage({ searchParams }: { searchParams: Promise<{ faltan?: string }> }) {
  const { faltan } = await searchParams;
  const productos = listarProductos();
  const nombre = new Map(productos.map((p) => [p.slug, p.nombre]));
  const stockProductos = listarStockProductos().filter((s) => s.cantidad !== 0);
  const totalPiezas = stockProductos.reduce((s, x) => s + x.cantidad, 0);
  const materiales = listarStockMateriales();
  const bajos = materiales.filter((m) => m.bajo).length;
  const insumosConStock = listarInsumos().filter((i) => i.tipo === 'Material' || i.tipo === 'Empaque');
  const historial = movimientos({ limite: 40 });

  return (
    <div className="stack sections">
      <header className="section-head">
        <h1 style={{ margin: 0 }}>Stock</h1>
        <p className="muted">
          {totalPiezas} piezas listas · {materiales.length} materiales
          {bajos ? <span className="blocked"> · {bajos} por acabarse</span> : null}
        </p>
      </header>

      {faltan ? (
        <article className="card notice">
          <span>
            Se fabricó, pero no alcanzaba el material registrado: <strong>{faltan}</strong> quedó en negativo. Ajusta
            el conteo abajo.
          </span>
        </article>
      ) : null}

      <section className="card stack">
        <header className="section-head">
          <h2>Productos listos</h2>
          <span className="muted small">piezas fabricadas que tienes para vender</span>
        </header>

        <form action={fabricarAction} className="row form" style={{ marginTop: 0 }}>
          <input type="hidden" name="volver" value="/stock" />
          <select name="slug" required defaultValue="" style={{ flex: '1 1 220px' }}>
            <option value="" disabled>
              Producto…
            </option>
            {productos
              .filter((p) => p.slug)
              .map((p) => (
                <option key={p.slug} value={p.slug!}>
                  {p.nombre}
                </option>
              ))}
          </select>
          <input name="variante" placeholder="Variante / color (opcional)" style={{ flex: '0 1 180px' }} />
          <input name="piezas" inputMode="numeric" placeholder="Piezas" required style={{ flex: '0 1 90px' }} />
          <label className="row checkbox small" style={{ margin: 0, flex: '0 0 auto', alignItems: 'center' }}>
            <input type="checkbox" name="descontar" defaultChecked /> Descontar materiales
          </label>
          <button type="submit">Registrar fabricación</button>
        </form>

        {stockProductos.length ? (
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Variante</th>
                  <th style={{ textAlign: 'right' }}>Piezas</th>
                  <th>Movimiento</th>
                </tr>
              </thead>
              <tbody>
                {stockProductos.map((s) => (
                  <tr key={`${s.slug}-${s.variante}`}>
                    <td>
                      <Link href={`/productos/${s.slug}`} className="task-link">
                        {nombre.get(s.slug) ?? s.slug}
                      </Link>
                    </td>
                    <td>{s.variante || <span className="muted">—</span>}</td>
                    <td style={{ textAlign: 'right' }} className={s.cantidad < 0 ? 'blocked' : undefined}>
                      <strong>{s.cantidad}</strong>
                    </td>
                    <td>
                      <div className="row" style={{ margin: 0, flexWrap: 'nowrap' }}>
                        <form action={salidaProductoAction} className="row mini-form">
                          <input type="hidden" name="slug" value={s.slug} />
                          <input type="hidden" name="variante" value={s.variante} />
                          <input name="piezas" inputMode="numeric" placeholder="Pz" required aria-label="Piezas vendidas" />
                          <button type="submit" className="mini">
                            Vendí
                          </button>
                        </form>
                        <form action={fijarProductoAction} className="row mini-form">
                          <input type="hidden" name="slug" value={s.slug} />
                          <input type="hidden" name="variante" value={s.variante} />
                          <input name="cantidad" inputMode="numeric" placeholder="Total" required aria-label="Conteo" />
                          <button type="submit" className="mini">
                            Ajustar
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">Sin piezas registradas. Usa “Registrar fabricación” cuando hagas un lote.</p>
        )}
      </section>

      <section className="card stack">
        <header className="section-head">
          <h2>Materiales</h2>
          <span className="muted small">por color, en la unidad de cada insumo</span>
          <Link href="/insumos" className="muted small" style={{ marginLeft: 'auto' }}>
            Insumos y precios →
          </Link>
        </header>

        {materiales.length ? (
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Color</th>
                  <th style={{ textAlign: 'right' }}>Hay</th>
                  <th style={{ textAlign: 'right' }}>Mínimo</th>
                  <th>Movimiento</th>
                </tr>
              </thead>
              <tbody>
                {materiales.map((m) => (
                  <tr key={m.id} className={m.bajo ? 'stock-bajo' : undefined}>
                    <td>
                      {m.insumo}
                      {m.bajo ? <span className="badge costo-incompleto" style={{ marginLeft: 8 }}>por acabarse</span> : null}
                    </td>
                    <td>{m.color || <span className="muted">—</span>}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <strong>{cantidad(m.cantidad)}</strong> <span className="muted small">{m.unidad}</span>
                    </td>
                    <td className="muted" style={{ textAlign: 'right' }}>
                      {m.minimo === null ? '—' : cantidad(m.minimo)}
                    </td>
                    <td>
                      <div className="row" style={{ margin: 0, flexWrap: 'nowrap' }}>
                        <form action={moverMaterialAction} className="row mini-form">
                          <input type="hidden" name="insumo_id" value={m.insumo_id} />
                          <input type="hidden" name="color" value={m.color} />
                          <input name="cantidad" inputMode="decimal" placeholder={m.unidad} required aria-label="Cantidad" />
                          <button type="submit" name="motivo" value="entrada" className="mini">
                            Compré
                          </button>
                          <button type="submit" name="motivo" value="salida" className="mini">
                            Usé
                          </button>
                        </form>
                        <details className="mini-details">
                          <summary className="small muted">Ajustar</summary>
                          <form action={fijarMaterialAction} className="row mini-form">
                            <input type="hidden" name="insumo_id" value={m.insumo_id} />
                            <input type="hidden" name="color" value={m.color} />
                            <input name="cantidad" inputMode="decimal" defaultValue={cantidad(m.cantidad)} aria-label="Conteo" required />
                            <input name="minimo" inputMode="decimal" defaultValue={m.minimo ?? ''} placeholder="mín." aria-label="Mínimo" />
                            <button type="submit" className="mini">
                              Guardar
                            </button>
                          </form>
                          {m.cantidad === 0 ? (
                            <form action={quitarStockMaterialAction}>
                              <input type="hidden" name="id" value={m.id} />
                              <button type="submit" className="mini">
                                Quitar renglón
                              </button>
                            </form>
                          ) : null}
                        </details>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">Sin materiales registrados.</p>
        )}

        {insumosConStock.length ? (
          <form action={fijarMaterialAction} className="row form">
            <select name="insumo_id" required defaultValue="" style={{ flex: '1 1 180px' }}>
              <option value="" disabled>
                Material…
              </option>
              {insumosConStock.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre} ({i.unidad})
                </option>
              ))}
            </select>
            <input name="color" placeholder="Color (opcional)" style={{ flex: '0 1 150px' }} />
            <input name="cantidad" inputMode="decimal" placeholder="Cuánto hay" required style={{ flex: '0 1 120px' }} />
            <input name="minimo" inputMode="decimal" placeholder="Mínimo (opcional)" style={{ flex: '0 1 140px' }} />
            <button type="submit">Agregar</button>
          </form>
        ) : (
          <p className="small">
            Primero da de alta tus materiales en <Link href="/insumos" className="task-link">Insumos</Link>.
          </p>
        )}
        <span className="muted small">
          El mínimo es para el aviso “por acabarse”. Si ya existe ese material y color, “Agregar” lo reemplaza por el
          conteo que pongas.
        </span>
      </section>

      <section className="card stack">
        <h2>Movimientos</h2>
        {historial.length ? (
          <div className="tabla-wrap">
            <table className="tabla">
              <tbody>
                {historial.map((m) => (
                  <tr key={m.id}>
                    <td className="muted small" style={{ whiteSpace: 'nowrap' }}>
                      {fechaLocal(m.created_at)}
                    </td>
                    <td>
                      <span className="badge">{m.motivo}</span>
                    </td>
                    <td>
                      {m.tipo === 'producto' ? (
                        <Link href={`/productos/${m.slug}`} className="task-link">
                          {nombre.get(m.slug) ?? m.slug}
                        </Link>
                      ) : (
                        m.insumo
                      )}
                      {m.detalle ? <span className="muted"> · {m.detalle}</span> : null}
                      {m.tipo === 'material' && m.slug ? (
                        <span className="muted small"> · para {nombre.get(m.slug) ?? m.slug}</span>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} className={m.delta < 0 ? 'blocked' : undefined}>
                      {signo(m.delta)} {m.tipo === 'producto' ? 'pz' : m.unidad}
                    </td>
                    <td className="muted small">{m.nota}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">Todavía no hay movimientos.</p>
        )}
      </section>
    </div>
  );
}
