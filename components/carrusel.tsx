'use client';

import { useRef, useState } from 'react';

/**
 * Photo strip for a product card. The strip itself is a CSS scroll-snap row,
 * so swiping on a phone works with no script at all; the arrows and the
 * counter are the only parts that need this to be a client component.
 */
export function Carrusel({ fotos, alt }: { fotos: string[]; alt: string }) {
  const pista = useRef<HTMLDivElement>(null);
  const [actual, setActual] = useState(0);

  if (!fotos.length) return <div className="sin-foto muted small carrusel-vacio">Sin foto</div>;

  const ir = (i: number) => {
    const el = pista.current;
    if (!el) return;
    const destino = (i + fotos.length) % fotos.length;
    el.scrollTo({ left: destino * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div className="carrusel">
      <div
        ref={pista}
        className="carrusel-pista"
        onScroll={(e) => {
          const el = e.currentTarget;
          setActual(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1)));
        }}
      >
        {fotos.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt={`${alt} ${i + 1}`} loading="lazy" draggable={false} />
        ))}
      </div>
      {fotos.length > 1 ? (
        <>
          <button type="button" className="carrusel-flecha izq" aria-label="Foto anterior" onClick={() => ir(actual - 1)}>
            ‹
          </button>
          <button type="button" className="carrusel-flecha der" aria-label="Foto siguiente" onClick={() => ir(actual + 1)}>
            ›
          </button>
          <span className="carrusel-cuenta">
            {actual + 1}/{fotos.length}
          </span>
        </>
      ) : null}
    </div>
  );
}
