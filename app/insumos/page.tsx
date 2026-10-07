import { INSUMOS_BASICOS, insumosConStock, listarInsumos, pesos, TIPOS_INSUMO, usosPorInsumo } from '@/lib/micho/costos';
import { actualizarInsumoAction, borrarInsumoAction, crearBasicosAction, crearInsumoAction } from './actions';

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

export default function InsumosPage() {
  const insumos = listarInsumos();
  const usos = usosPorInsumo();
  const conStock = insumosConStock();
  const sinPrecio = insumos.filter((i) => i.precio === null).length;

  return (
    <div className="stack sections">
      <header className="section-head">
        <h1 style={{ margin: 0 }}>Insumos</h1>
        <p className="muted">
          Precio por unidad (MXN) de todo lo que cuesta producir: material, horas de máquina, empaque.
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
          {insumos.map((i) => (
            <form key={i.id} action={actualizarInsumoAction} className="card row insumo" style={{ margin: 0 }}>
              <input type="hidden" name="id" value={i.id} />
              <input name="nombre" defaultValue={i.nombre} aria-label="Nombre" required style={{ flex: '1 1 160px' }} />
              <TipoSelect valor={i.tipo} />
              <label className="row insumo-precio" style={{ margin: 0 }}>
                <span className="muted small">$</span>
                <input
                  name="precio"
                  inputMode="decimal"
                  defaultValue={i.precio ?? ''}
                  placeholder="sin precio"
                  aria-label="Precio"
                  style={{ flex: '0 1 100px' }}
                />
                <span className="muted small">por</span>
              </label>
              <input name="unidad" defaultValue={i.unidad} aria-label="Unidad" required style={{ flex: '0 1 140px' }} />
              <input name="notas" defaultValue={i.notas ?? ''} placeholder="Notas (proveedor, presentación…)" />
              <button type="submit">Guardar</button>
              <span className="muted small" style={{ whiteSpace: 'nowrap' }}>
                {i.precio !== null ? `${pesos(i.precio)} / ${i.unidad}` : ''}
                {usos.get(i.id) ? ` · en ${usos.get(i.id)} producto${usos.get(i.id) === 1 ? '' : 's'}` : ''}
              </span>
              {!usos.get(i.id) && !conStock.has(i.id) ? (
                <button type="submit" formAction={borrarInsumoAction} className="mini" aria-label={`Borrar ${i.nombre}`}>
                  Borrar
                </button>
              ) : null}
            </form>
          ))}
        </div>
      )}

      <section className="card stack">
        <h2>Nuevo insumo</h2>
        <form action={crearInsumoAction} className="row form" style={{ marginTop: 0 }}>
          <input name="nombre" placeholder="Nombre (ej. PLA negro Esun, MDF 6 mm, caja kraft)" required />
          <TipoSelect />
          <input name="precio" inputMode="decimal" placeholder="Precio" style={{ flex: '0 1 100px' }} />
          <input name="unidad" placeholder="Unidad (g, hoja 30×30 cm, hora, pieza)" required style={{ flex: '0 1 220px' }} />
          <button type="submit">Agregar</button>
        </form>
        <span className="muted small">
          Usa la unidad en la que lo vas a contar en cada producto. Filamento: si el kilo cuesta $350, pon 0.35 por g.
          Máquina: costo por hora (luz, desgaste).
        </span>
      </section>
    </div>
  );
}
