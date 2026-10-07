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
          {insumos.map((i) => (
            <form key={i.id} action={actualizarInsumoAction} className="card row insumo" style={{ margin: 0 }}>
              <input type="hidden" name="id" value={i.id} />
              <input name="nombre" defaultValue={i.nombre} aria-label="Nombre" required style={{ flex: '1 1 160px' }} />
              <TipoSelect valor={i.tipo} />
              <Compra precioCompra={i.precio_compra} presentacion={i.presentacion} unidad={i.unidad} />
              <input name="notas" defaultValue={i.notas ?? ''} placeholder="Notas (proveedor, presentación…)" />
              <button type="submit">Guardar</button>
              <span className="small precio-unitario" style={{ whiteSpace: 'nowrap' }}>
                {i.precio !== null ? `= ${pesoUnitario(i.precio)} / ${i.unidad}` : <span className="blocked">sin precio</span>}
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
