import {
  cantidad,
  INSUMOS_BASICOS,
  insumosConStock,
  listarInsumos,
  nombreInsumo,
  pesos,
  TIPOS_INSUMO,
  resumenUso,
  todosLosPuntosTemp,
  usosPorInsumo
} from '@/lib/micho/costos';
import { EstimadorTemp } from '@/components/estimador-temp';
import {
  actualizarInsumoAction,
  borrarInsumoAction,
  borrarPuntoTempAction,
  crearBasicosAction,
  crearInsumoAction,
  guardarUsoAction,
  puntoTempAction
} from './actions';

export const dynamic = 'force-dynamic';

function TipoSelect({ valor }: { valor?: string }) {
  return (
    <select name="tipo" defaultValue={valor ?? 'Material'} style={{ flex: '0 0 auto' }}>
      {TIPOS_INSUMO.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

/** "Pago $[350] por [1000] [g]": the purchase as it is bought, not the per-unit price. */
function Compra({
  precioCompra,
  presentacion,
  unidad
}: {
  precioCompra?: number | null;
  presentacion?: number;
  unidad?: string;
}) {
  return (
    <span className="row insumo-precio" style={{ margin: 0 }}>
      <span className="muted small">Pago $</span>
      <input
        name="precio_compra"
        inputMode="decimal"
        defaultValue={precioCompra ?? ''}
        placeholder="precio"
        aria-label="Precio de la compra"
        style={{ flex: '0 1 90px' }}
      />
      <span className="muted small">por</span>
      <input
        name="presentacion"
        inputMode="decimal"
        defaultValue={presentacion ?? 1}
        aria-label="Cantidad que trae la compra"
        style={{ flex: '0 1 80px' }}
      />
      <input
        name="unidad"
        defaultValue={unidad ?? ''}
        placeholder="unidad (g, hoja…)"
        aria-label="Unidad"
        required
        style={{ flex: '0 1 130px' }}
      />
    </span>
  );
}

/** Per-gram prices are fractions of a peso; two decimals would round them to nothing. */
function pesoUnitario(n: number): string {
  return n >= 1 ? pesos(n) : `$${Number(n.toFixed(4))}`;
}

export default function InsumosPage() {
  const insumos = listarInsumos();
  const usos = usosPorInsumo();
  const conStock = insumosConStock();
  const puntosPorInsumo = todosLosPuntosTemp();
  const sinPrecio = insumos.filter((i) => i.precio === null).length;

  return (
    <div className="stack sections">
      <header className="section-head">
        <h1 style={{ margin: 0 }}>Insumos</h1>
        <p className="muted">
          Los materiales con lo que pagas por cada compra; el precio por unidad se calcula solo.
          {sinPrecio ? <span className="blocked"> · {sinPrecio} sin precio</span> : null}
        </p>
      </header>

      {!insumos.length ? (
        <article className="card stack">
          <p style={{ margin: 0 }}>No hay insumos todavía.</p>
          <form action={crearBasicosAction} className="row" style={{ margin: 0 }}>
            <button type="submit">Crear los básicos</button>
            <span className="muted small">
              {INSUMOS_BASICOS.map((b) => `${b.nombre} (${b.unidad})`).join(' · ')} — sin precio, para que tú los pongas.
            </span>
          </form>
        </article>
      ) : (
        <div className="stack">
          {insumos.map((i) => {
            const puntos = puntosPorInsumo.get(i.id) ?? [];
            const resumen = resumenUso(i, puntos);
            return (
              <article key={i.id} className="card stack insumo-card">
                <form action={actualizarInsumoAction} className="row insumo" style={{ margin: 0 }}>
                  <input type="hidden" name="id" value={i.id} />
                  <input name="nombre" defaultValue={i.nombre} aria-label="Nombre" required style={{ flex: '1 1 120px' }} />
                  <input name="marca" defaultValue={i.marca} placeholder="Marca" aria-label="Marca" style={{ flex: '0 1 120px' }} />
                  <TipoSelect valor={i.tipo} />
                  <Compra precioCompra={i.precio_compra} presentacion={i.presentacion} unidad={i.unidad} />
                  <input name="notas" defaultValue={i.notas ?? ''} placeholder="Notas (proveedor, presentación…)" />
                  <button type="submit">Guardar</button>
                  <span className="small precio-unitario" style={{ whiteSpace: 'nowrap' }}>
                    {i.precio !== null ? `= ${pesoUnitario(i.precio)} / ${i.unidad}` : <span className="blocked">sin precio</span>}
                    {usos.get(i.id) ? ` · en ${usos.get(i.id)} producto${usos.get(i.id) === 1 ? '' : 's'}` : ''}
                  </span>
                  {!usos.get(i.id) && !conStock.has(i.id) ? (
                    <button type="submit" formAction={borrarInsumoAction} className="mini" aria-label={`Borrar ${nombreInsumo(i)}`}>
                      Borrar
                    </button>
                  ) : null}
                </form>

                {i.tipo === 'Material' ? (
                  <details className="uso">
                    <summary className="small">
                      <span className="muted">Uso</span>
                      {resumen ? <span className="uso-resumen"> · {resumen}</span> : null}
                    </summary>
                    <div className="uso-cuerpo">
                      <div className="stack" style={{ gap: 8 }}>
                        <h3 className="small uso-titulo">Boquilla por velocidad</h3>
                        {puntos.length ? (
                          <ul className="puntos">
                            {puntos.map((pt) => (
                              <li key={pt.id}>
                                <span>
                                  {cantidad(pt.velocidad)} mm/s → <strong>{cantidad(pt.boquilla)} °C</strong>
                                </span>
                                <form action={borrarPuntoTempAction}>
                                  <input type="hidden" name="punto_id" value={pt.id} />
                                  <button type="submit" className="mini" aria-label={`Quitar ${pt.velocidad} mm/s`}>
                                    ×
                                  </button>
                                </form>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <form action={puntoTempAction} className="row" style={{ margin: 0 }}>
                          <input type="hidden" name="id" value={i.id} />
                          <label className="row campo-num">
                            <input name="velocidad" inputMode="decimal" placeholder="150" aria-label="Velocidad" required />
                            <span className="muted small">mm/s →</span>
                            <input name="boquilla" inputMode="decimal" placeholder="250" aria-label="Temperatura de boquilla" required />
                            <span className="muted small">°C</span>
                          </label>
                          <button type="submit" className="mini">
                            Agregar
                          </button>
                        </form>
                        <EstimadorTemp puntos={puntos.map(({ velocidad, boquilla }) => ({ velocidad, boquilla }))} />
                      </div>
                      <form action={guardarUsoAction} className="stack" style={{ gap: 8 }}>
                        <input type="hidden" name="id" value={i.id} />
                        <label className="row campo-num">
                          <span className="muted small">Cama</span>
                          <input name="temp_cama" inputMode="decimal" defaultValue={i.temp_cama ?? ''} placeholder="?" aria-label="Temperatura de cama" />
                          <span className="muted small">°C</span>
                        </label>
                        <textarea
                          name="uso"
                          rows={3}
                          defaultValue={i.uso ?? ''}
                          placeholder="Secado, ventilador, enclosure, adherencia, retracción…"
                          aria-label="Notas de uso"
                        />
                        <button type="submit" className="mini" style={{ alignSelf: 'flex-start' }}>
                          Guardar uso
                        </button>
                      </form>
                    </div>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <section className="card stack">
        <h2>Nuevo insumo</h2>
        <form action={crearInsumoAction} className="row form" style={{ marginTop: 0 }}>
          <input name="nombre" placeholder="Material (ej. PETG, PLA, MDF 6 mm, caja kraft)" required />
          <input name="marca" placeholder="Marca (ej. Jayo)" style={{ flex: '0 1 140px' }} />
          <TipoSelect />
          <Compra />
          <button type="submit">Agregar</button>
        </form>
        <span className="muted small">
          Pon lo que pagas y lo que trae cada compra, en la unidad en que lo vas a usar en cada producto. Filamento:
          $350 por 1000 g (carrete de 1 kg) → $0.35 / g. MDF: $45 por 1 hoja 30×30 cm. El color va en el stock y en
          cada producto, no aquí: un PLA sirve para todos los colores que compres al mismo precio.
        </span>
      </section>
    </div>
  );
}
