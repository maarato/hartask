import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const configPath = resolve('hartask.config.json');
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
const dbPath = resolve(config.database ?? './data/hartask.sqlite');

mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.exec(readFileSync(resolve('lib/db/schema.sql'), 'utf8'));

const { total } = db.prepare('SELECT COUNT(*) AS total FROM tasks').get();
if (total > 0) {
  console.log(`Hartask DB already has ${total} task(s); seed skipped.`);
  process.exit(0);
}

const insertProject = db.prepare(
  `INSERT INTO projects (name, root_path, summary) VALUES (?, ?, ?)`
);
const insertTask = db.prepare(
  `INSERT INTO tasks (public_id, parent_id, title, description, status, priority, next_action)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const insertEvent = db.prepare(
  `INSERT INTO task_events (task_id, event_type, summary) VALUES (?, ?, ?)`
);

const seed = db.transaction(() => {
  const hasProject = db.prepare('SELECT COUNT(*) AS total FROM projects').get().total > 0;
  if (!hasProject) {
    insertProject.run(
      config.projectName ?? 'Current Project',
      resolve(config.projectRoot ?? '..'),
      'Hartask: local project continuity and task control plane for humans and coding agents.'
    );
  }

  const rows = [
    {
      title: 'Definir contexto inicial del proyecto',
      status: 'IN_PROGRESS',
      priority: 30,
      next_action: 'Completar Project Context y primer handoff',
      children: [
        { title: 'Escribir Project Context', status: 'DONE', next_action: null },
        { title: 'Escribir primer handoff', status: 'READY', next_action: 'Resumir estado actual' }
      ]
    },
    {
      title: 'Configurar Hartask MCP',
      status: 'READY',
      priority: 20,
      next_action: 'Registrar el endpoint /mcp en el agente',
      children: []
    },
    {
      title: 'Agregar primer Prompt Stack',
      status: 'BACKLOG',
      priority: 10,
      next_action: 'Crear prompt y reclamarlo desde el agente',
      children: []
    }
  ];

  let counter = 0;
  const nextId = () => `TASK-${String(++counter).padStart(3, '0')}`;

  for (const row of rows) {
    const parent = insertTask.run(
      nextId(),
      null,
      row.title,
      null,
      row.status,
      row.priority,
      row.next_action
    );
    insertEvent.run(parent.lastInsertRowid, 'TASK_CREATED', `${row.title} (seed)`);

    for (const child of row.children) {
      const sub = insertTask.run(
        nextId(),
        parent.lastInsertRowid,
        child.title,
        null,
        child.status,
        0,
        child.next_action
      );
      insertEvent.run(sub.lastInsertRowid, 'TASK_CREATED', `${child.title} (seed)`);
    }
  }
});

seed();

const seeded = db.prepare('SELECT COUNT(*) AS total FROM tasks').get().total;
console.log(`Hartask DB seeded at ${dbPath} (${seeded} tasks).`);
