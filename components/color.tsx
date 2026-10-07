import { colorCss, NOMBRES_COLOR } from '@/lib/micho/colores';

/** Colour name with its swatch. Unknown names show the name alone. */
export function Color({ nombre }: { nombre: string | null | undefined }) {
  if (!nombre) return <span className="muted">—</span>;
  const css = colorCss(nombre);
  return (
    <span className="color">
      {css ? (
        <span
          className={`muestra${css === 'transparent' ? ' muestra-transparente' : ''}`}
          style={css === 'transparent' ? undefined : { background: css }}
          aria-hidden
        />
      ) : null}
      {nombre}
    </span>
  );
}

/** One shared <datalist> for every colour input on a page (`list="colores"`). */
export function ListaColores() {
  return (
    <datalist id="colores">
      {NOMBRES_COLOR.map((n) => (
        <option key={n} value={n} />
      ))}
    </datalist>
  );
}

/**
 * A product's materials in one line, each colour with its swatch:
 * "MDF 3 mm 0.5 hoja natural · PLA 40 g ■ negro".
 */
export function Materiales({ lineas }: { lineas: { id: number; insumo: string; cantidad: number; unidad: string; color: string | null; tipo: string }[] }) {
  const materiales = lineas.filter((l) => l.tipo === 'Material');
  if (!materiales.length) return null;
  return (
    <span className="small materiales">
      {materiales.map((l, i) => (
        <span key={l.id}>
          {i ? ' · ' : ''}
          {l.insumo} {Number(l.cantidad.toFixed(2))} {l.unidad}
          {l.color ? (
            <>
              {' '}
              <Color nombre={l.color} />
            </>
          ) : null}
        </span>
      ))}
    </span>
  );
}
