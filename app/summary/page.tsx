export default function SummaryPage(){
  return <section>
    <h1>Summary</h1>
    <div className="grid grid-2">
      <article className="card"><h2>Project Context</h2><p className="muted">README reducido para recuperar rápidamente qué es el proyecto.</p><p>Hartask es una capa local de continuidad de proyecto para humanos y coding agents.</p><pre>{`Human / Agent\n      ↓\n   Hartask\n      ↓\nTasks · Handoff · Harness`}</pre></article>
      <article className="card"><h2>Último contexto</h2><p className="muted">Dónde te quedaste y qué debería suceder después.</p><p><strong>Trabajabas en:</strong> bootstrap inicial de Hartask.</p><p><strong>Estado:</strong> arquitectura V1 definida.</p><p><strong>Siguiente:</strong> conectar UI/API a SQLite y completar MCP.</p><p><strong>Problemas:</strong> ninguno registrado.</p></article>
    </div>
  </section>
}
