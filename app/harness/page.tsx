export default function HarnessPage(){
  return <section><h1>Harness</h1><p className="muted">Vista del arnés efectivo del proyecto.</p>
    <div className="grid grid-2">
      <article className="card"><h2>Instructions</h2><p>AGENTS.md / CLAUDE.md / reglas por folder.</p></article>
      <article className="card"><h2>Skills</h2><p>Skills de proyecto y usuario.</p></article>
      <article className="card"><h2>Hooks</h2><p>Lifecycle hooks y automatizaciones detectadas.</p></article>
      <article className="card"><h2>MCP / Tools</h2><p>Hartask MCP y herramientas externas disponibles.</p></article>
    </div>
  </section>
}
