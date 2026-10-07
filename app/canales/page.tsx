import { pesos } from '@/lib/micho/costos';
import { canalCompleto, CANALES_BASICOS, listarCanales, margenObjetivo, todosLosPrecios } from '@/lib/micho/precios';
import {
  actualizarCanalAction,
  borrarCanalAction,
  crearCanalAction,
  crearCanalesBasicosAction,
  margenAction
} from './actions';

export const dynamic = 'force-dynamic';

function Campos({
  comision,
  fijo,
  envio
}: {
  comision?: number | null;
  fijo?: number | null;
  envio?: number | null;
}) {
  return (
    <>
      <label className="row campo-num">
        <span className="muted small">Comisión</span>
        <input name="comision_pct" inputMode="decimal" defaultValue={comision ?? ''} placeholder="?" aria-label="Comisión en porcentaje" />
        <span className="muted small">%</span>
      </label>
      <label className="row campo-num">
        <span className="muted small">Cargo fijo $</span>
        <input name="cargo_fijo" inputMode="decimal" defaultValue={fijo ?? ''} placeholder="?" aria-label="Cargo fijo por venta" />
      </label>
      <label className="row campo-num">
        <span className="muted small">Envío que pagas $</span>
        <input name="envio" inputMode="decimal" defaultValue={envio ?? ''} placeholder="?" aria-label="Envío por venta" />
      </label>
    </>
  );
}

export default function CanalesPage() {
  const canales = listarCanales();
  const margen = margenObjetivo();
  const precios = todosLosPrecios();
  const usos = new Map<number, number>();
  for (const porCanal of precios.values()) for (const id of porCanal.keys()) usos.set(id, (usos.get(id) ?? 0) + 1);

  return (
    <div className="stack sections">
      <header className="section-head">
        <h1 style={{ margin: 0 }}>Canales</h1>
        <p className="muted">Lo que cobra cada canal por venta. Con esto y el costeo sale el precio de cada producto.</p>
      </header>

      <section className="card stack">
        <h2>Margen objetivo</h2>
        <form action={margenAction} className="row" style={{ margin: 0 }}>
          <label className="row campo-num">
            <input name="margen" inputMode="decimal" defaultValue={margen} aria-label="Margen objetivo" />
            <span className="muted small">% del precio de venta</span>
          </label>
          <button type="submit">Guardar</button>
        </form>
        <span className="muted small">
          Lo que quieres que te quede de cada venta después de pagar el costo de producción, la comisión, el cargo
          fijo y el envío. Con esto se calcula el precio sugerido.
        </span>
      </section>

      {!canales.length ? (
        <article className="card stack">
          <p style={{ margin: 0 }}>No hay canales todavía.</p>
          <form action={crearCanalesBasicosAction} className="row" style={{ margin: 0 }}>
            <button type="submit">Crear {CANALES_BASICOS.join(', ')}</button>
            <span className="muted small">vacíos, para que pongas sus tarifas reales.</span>
          </form>
        </article>
      ) : (
        <div className="stack">
          {canales.map((c) => (
            <article key={c.id} className="card stack canal">
              <form action={actualizarCanalAction} className="row" style={{ margin: 0 }}>
                <input type="hidden" name="id" value={c.id} />
                <input name="nombre" defaultValue={c.nombre} required aria-label="Nombre" style={{ flex: '1 1 160px', fontWeight: 600 }} />
                <Campos comision={c.comision_pct} fijo={c.cargo_fijo} envio={c.envio} />
                <input name="notas" defaultValue={c.notas ?? ''} placeholder="Notas (de qué depende la comisión, tipo de publicación…)" />
                <button type="submit">Guardar</button>
              </form>
              <div className="row small" style={{ margin: 0 }}>
                {canalCompleto(c) ? (
                  <span className="muted">
                    Por una venta de $100 se queda {pesos((c.comision_pct ?? 0) + (c.cargo_fijo ?? 0))}
                    {c.envio ? ` y pagas ${pesos(c.envio)} de envío` : ''}.
                  </span>
                ) : (
                  <span className="blocked">Faltan datos: se cuentan como 0 hasta que los pongas.</span>
                )}
                {usos.get(c.id) ? <span className="muted">· precio puesto en {usos.get(c.id)} productos</span> : null}
                <details className="borrar-canal">
                  <summary className="muted">Borrar</summary>
                  <form action={borrarCanalAction} className="row" style={{ margin: 0 }}>
                    <input type="hidden" name="id" value={c.id} />
                    <label className="row checkbox" style={{ margin: 0, alignItems: 'center' }}>
                      <input type="checkbox" name="confirmar" required /> Sí, borrar
                      {usos.get(c.id) ? ` y sus ${usos.get(c.id)} precios` : ''}
                    </label>
                    <button type="submit" className="mini">
                      Borrar canal
                    </button>
                  </form>
                </details>
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="card stack">
        <h2>Nuevo canal</h2>
        <form action={crearCanalAction} className="row form" style={{ marginTop: 0 }}>
          <input name="nombre" placeholder="Nombre (ej. Facebook Marketplace, venta directa, feria)" required style={{ flex: '1 1 220px' }} />
          <Campos />
          <button type="submit">Agregar</button>
        </form>
        <span className="muted small">
          Comisión: todo lo que es porcentaje del precio (comisión, cobro con tarjeta, retenciones). Cargo fijo: lo que
          cobran por venta sin importar el precio. Envío: lo que tú pagas si el envío va por tu cuenta. Deja vacío lo
          que no sepas.
        </span>
      </section>
    </div>
  );
}
