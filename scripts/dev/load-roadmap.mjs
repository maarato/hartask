/**
 * Loads Hartask's own remaining roadmap into a running Hartask instance.
 *
 * This is project-specific dev tooling, not part of the product: `db:seed`
 * stays generic because Hartask is meant to be copied into other repositories,
 * where this backlog would be noise.
 *
 * It writes over the HTTP API rather than SQLite on purpose — this is the same
 * path a coding agent uses, so running it exercises the agent interface.
 *
 * Usage: start the server, then `node scripts/dev/load-roadmap.mjs`
 */

const BASE = process.env.HARTASK_URL ?? 'http://localhost:43127';
const AGENT_ID = 'load-roadmap-script';

/** Mirrors docs/NEXT-STEPS.md. Priority orders the board; higher comes first. */
const ROADMAP = [
  {
    title: 'Handoff repository y Summary conectado',
    status: 'READY',
    priority: 100,
    next_action: 'Escribir lib/hartask/repositories/handoff.ts sobre project_handoff',
    description:
      'Sin esto la metodologia solo funciona a medias: "donde me quede" no tiene donde persistirse. Es el paso 5 de NEXT-STEPS.md y el que hace util el cold start.',
    children: [
      {
        title: 'Repositorio de handoff sobre project_handoff',
        status: 'READY',
        next_action: 'getLatest, create y enriquecido con timestamps'
      },
      {
        title: 'Conectar GET/POST /api/handoff',
        next_action: 'Reemplazar el stub que devuelve handoff:null'
      },
      {
        title: 'Summary leyendo Project Context + ultimo handoff',
        next_action: 'Reemplazar el placeholder estatico de /summary'
      },
      {
        title: 'Project Context editable desde la UI',
        next_action: 'Formulario sobre projects.summary'
      }
    ]
  },
  {
    title: 'AGENTS.md honesto apuntando a la interfaz que existe',
    status: 'READY',
    priority: 90,
    next_action: 'Documentar los endpoints HTTP reales en vez de las tools MCP',
    description:
      'AGENTS.bootstrap.example.md describe hartask_start_session y hartask_claim_next_prompt, que no existen todavia. Copiado tal cual, empeora la sesion de cualquier agente.',
    children: []
  },
  {
    title: 'Tests de la capa de repositorio',
    status: 'READY',
    priority: 80,
    next_action: 'Elegir runner y cubrir tasks.ts contra una DB en memoria',
    description:
      'No hay tests. El repositorio es el primer lugar natural: transacciones, generacion de public_id y registro de eventos.',
    children: [
      { title: 'Tests del repositorio de tasks', next_action: 'Cubrir create/update/tree' },
      { title: 'Tests de las rutas de API', next_action: 'Validacion, 400 y 404' }
    ]
  },
  {
    title: 'CLI hartask para agentes sin servidor',
    status: 'BACKLOG',
    priority: 70,
    next_action: 'Decidir si va antes que MCP',
    description:
      'Hoy un agente solo alcanza Hartask si el dev server esta corriendo. Un CLI que hable con el core elimina esa dependencia con mucho menos trabajo que MCP, y no viola la regla de no tocar SQLite directo porque el CLI es Hartask.',
    children: [
      { title: 'hartask context', next_action: 'Equivalente CLI de /api/context' },
      { title: 'hartask task list / update', next_action: 'Lectura y transiciones de estado' }
    ]
  },
  {
    title: 'Vista de detalle de task',
    status: 'BACKLOG',
    priority: 60,
    next_action: 'Ruta /tasks/[id] con notas y timeline completo',
    description:
      'La lista solo muestra los ultimos eventos del proyecto. Falta el timeline por task, que es el paso 4 de NEXT-STEPS.md.',
    children: [
      { title: 'Ruta /tasks/[id]', next_action: 'Server component sobre getTask' },
      { title: 'Listado y alta de notas', next_action: 'Formulario sobre addNote' },
      { title: 'Timeline completo de eventos', next_action: 'Render de listEvents por task' }
    ]
  },
  {
    title: 'Prompt Stack con claim atomico',
    status: 'BACKLOG',
    priority: 50,
    next_action: 'Repositorio de prompts sobre el schema existente',
    description:
      'Pasos 6 y 7. El claim debe ser atomico para que dos agentes no ejecuten el mismo trabajo encolado.',
    children: [
      { title: 'Repositorio de prompts', next_action: 'CRUD sobre la tabla prompts' },
      {
        title: 'Transaccion claim_next_prompt',
        next_action: 'SELECT READY + UPDATE CLAIMED + INSERT run en una transaccion'
      },
      { title: 'Prompt runs y ciclo de vida', next_action: 'start / complete / fail' },
      { title: 'Prompt Stack UI', next_action: 'Cola visible y alta de prompts' }
    ]
  },
  {
    title: 'Transporte MCP real en /mcp',
    status: 'BACKLOG',
    priority: 40,
    next_action: 'Reemplazar el placeholder de /api/mcp por Streamable HTTP',
    description:
      'Pasos 8 y 9. Recien aca el bootstrap original de AGENTS.md se vuelve verdad tal como esta escrito.',
    children: [
      { title: 'Endpoint MCP Streamable HTTP', next_action: 'Mismo proceso y mismo puerto' },
      {
        title: 'Tools semanticas sobre los repositorios',
        next_action: 'lib/mcp/tools.ts hoy es solo una lista de nombres'
      },
      { title: 'Recursos hartask://', next_action: 'project, tasks, handoff, harness' }
    ]
  },
  {
    title: 'Harness scanner',
    status: 'BACKLOG',
    priority: 30,
    next_action: 'Escanear AGENTS.md, CLAUDE.md, .claude, .cursor y .codex',
    description:
      'Paso 10. Hartask observa los archivos del arnes y persiste metadata (path, hash, scope), sin volverse la fuente de verdad.',
    children: [
      { title: 'Scanner de archivos del arnes', next_action: 'Persistir en harness_components' },
      { title: 'Vista Harness conectada', next_action: 'Reemplazar el placeholder estatico' }
    ]
  },
  {
    title: 'Cierre de brechas conocidas',
    status: 'BACKLOG',
    priority: 20,
    next_action: 'Agregar .gitattributes con eol=lf',
    description:
      'Pendientes menores registrados en NEXT-STEPS.md y detectados al publicar el repo.',
    children: [
      {
        title: '.gitattributes con eol=lf',
        next_action: 'Evitar diffs por CRLF al clonar en Linux/macOS'
      },
      {
        title: 'Decidir si las transiciones de estado se restringen',
        next_action: 'Hoy cualquier estado puede ir a cualquier otro'
      },
      { title: 'Diagramas Mermaid en Summary y Harness', next_action: 'Paso 11' },
      { title: 'Adaptadores por host y hooks de sesion', next_action: 'Pasos 12 y 13' }
    ]
  }
];

async function api(path, init) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers }
  });
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} -> ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function createTask(body) {
  const { task } = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ ...body, agent_id: AGENT_ID })
  });
  return task;
}

const { items } = await api('/api/tasks');
if (items.length) {
  console.error(
    `Hartask ya tiene ${items.length} task(s). Borra data/hartask.sqlite si quieres recargar el roadmap.`
  );
  process.exit(1);
}

let created = 0;
for (const epic of ROADMAP) {
  const parent = await createTask({
    title: epic.title,
    description: epic.description,
    status: epic.status,
    priority: epic.priority,
    next_action: epic.next_action
  });
  created++;
  console.log(`${parent.public_id}  ${parent.status.padEnd(11)} ${parent.title}`);

  for (const child of epic.children) {
    const sub = await createTask({
      title: child.title,
      status: child.status ?? 'BACKLOG',
      next_action: child.next_action,
      parent_id: parent.id
    });
    created++;
    console.log(`  ${sub.public_id}  ${sub.status.padEnd(11)} ${sub.title}`);
  }
}

console.log(`\nRoadmap cargado: ${created} tasks.`);
