PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Every origin that participates in sync. The one that created the database
-- keeps an empty public_id prefix, so existing task ids never change.
CREATE TABLE IF NOT EXISTS sync_origins (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  public_id_prefix TEXT NOT NULL DEFAULT '',
  is_local INTEGER NOT NULL DEFAULT 0,
  -- Lamport counter, not a wall clock: two machines with skewed clocks must
  -- still agree on which write happened later.
  lamport INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Row ids are per-database; uuid is what identifies a task across origins.
  uuid TEXT,
  origin TEXT,
  lamport INTEGER NOT NULL DEFAULT 0,
  -- The clock value this row last agreed on with a peer. A row whose lamport
  -- has moved past it was edited locally since the last sync, which is what
  -- separates a real conflict from simply receiving the peer's newer version.
  synced_lamport INTEGER NOT NULL DEFAULT 0,
  public_id TEXT UNIQUE NOT NULL,
  parent_id INTEGER REFERENCES tasks(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'BACKLOG' CHECK(status IN ('BACKLOG','READY','IN_PROGRESS','BLOCKED','REVIEW','DONE','CANCELLED')),
  priority INTEGER NOT NULL DEFAULT 0,
  next_action TEXT,
  blocked_reason TEXT,
  -- Optional label grouping tasks by the part of the product they touch.
  -- Nullable on purpose: a task without one is normal, not incomplete.
  category TEXT,
  -- Orthogonal to status: archiving hides a task from the board without
  -- losing whether it was finished or abandoned.
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT,
  origin TEXT,
  lamport INTEGER NOT NULL DEFAULT 0,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_type TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT,
  origin TEXT,
  lamport INTEGER NOT NULL DEFAULT 0,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  summary TEXT,
  payload_json TEXT,
  agent_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT,
  origin TEXT,
  lamport INTEGER NOT NULL DEFAULT 0,
  synced_lamport INTEGER NOT NULL DEFAULT 0,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','READY','CLAIMED','RUNNING','DONE','FAILED','CANCELLED')),
  priority INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  claimed_by TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prompt_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT,
  origin TEXT,
  lamport INTEGER NOT NULL DEFAULT 0,
  synced_lamport INTEGER NOT NULL DEFAULT 0,
  prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  agent_id TEXT,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  summary TEXT,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS project_handoff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT,
  origin TEXT,
  lamport INTEGER NOT NULL DEFAULT 0,
  current_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  what_was_done TEXT,
  current_state TEXT,
  next_step TEXT,
  known_problems TEXT,
  important_files_json TEXT,
  important_decisions TEXT,
  source TEXT NOT NULL DEFAULT 'agent-generated',
  agent_run_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS harness_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT,
  runtime TEXT,
  scope TEXT,
  metadata_json TEXT,
  content_hash TEXT,
  last_scan_at TEXT
);

CREATE TABLE IF NOT EXISTS harness_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  summary_json TEXT
);

-- Shared contexts: documents an agent writes for the next agent, and for the
-- one on another machine. Rows rather than files on disk, so they sync, carry
-- an event trail, and are addressable in a store that holds several projects.
--
-- The boundary that keeps this from duplicating the repo's own docs: anything
-- that must travel with a clone belongs in git; this table is for what
-- describes the ongoing work of one project.
CREATE TABLE IF NOT EXISTS shared_contexts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT,
  origin TEXT,
  lamport INTEGER NOT NULL DEFAULT 0,
  synced_lamport INTEGER NOT NULL DEFAULT 0,
  -- Addressed by slug, not by row id: the same document on two machines has
  -- two row ids and one slug, and the slug is what an agent asks for.
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  -- One line, carried in listings so a reader can tell whether to open it
  -- without paying for the body.
  purpose TEXT,
  body TEXT,
  -- What this row is for. A document explains a part of the project; an agent
  -- describes a role someone works in. They share every column, which is the
  -- reason they share a table: if telling them apart ever needs more than this,
  -- they were two things after all.
  kind TEXT NOT NULL DEFAULT 'doc' CHECK(kind IN ('doc','agent')),
  -- Same vocabulary as tasks, normalised through the same function.
  category TEXT,
  -- The task this was last known to be true as of, as a public id. A plain
  -- string and not a link: it is a marker on prose rather than a foreign key,
  -- and a document whose reference cannot be resolved should still be
  -- readable rather than fail to load.
  valid_as_of TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Micho Store (rama micho-store): liga cada carpeta de producto con la tarea
-- que hace de su ficha. Por uuid y no por id, para que el vínculo siga
-- apuntando a la misma tarea después de sincronizar.
CREATE TABLE IF NOT EXISTS micho_product_tasks (
  slug TEXT PRIMARY KEY,
  task_uuid TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Micho Store: insumos con precio por unidad (material, horas de máquina,
-- empaque...) y lo que cada producto usa de ellos. El costo de un producto
-- se calcula de aquí; precio NULL = todavía sin precio.
CREATE TABLE IF NOT EXISTS micho_insumos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL COLLATE NOCASE,
  -- '' = sin marca. Con la marca, "PETG" de Jayo y de Esun son dos insumos.
  marca TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  tipo TEXT NOT NULL DEFAULT 'Material',
  unidad TEXT NOT NULL,
  precio REAL,
  -- Lo que se paga por la presentación y cuántas unidades trae: $350 por
  -- 1000 g. precio (por unidad) se calcula de estos dos.
  precio_compra REAL,
  presentacion REAL NOT NULL DEFAULT 1,
  -- Uso: temperatura de cama (°C) y notas (secado, ventilador...). La de
  -- boquilla depende de la velocidad: micho_insumo_temperaturas.
  temp_cama REAL,
  uso TEXT,
  notas TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(nombre, marca)
);

CREATE TABLE IF NOT EXISTS micho_producto_insumos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  insumo_id INTEGER NOT NULL REFERENCES micho_insumos(id),
  cantidad REAL NOT NULL,
  color TEXT,
  nota TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_micho_producto_insumos_slug ON micho_producto_insumos(slug);

-- Micho Store: existencias. Color y variante usan '' en vez de NULL para que
-- el UNIQUE agrupe "sin color" como un solo renglón.
CREATE TABLE IF NOT EXISTS micho_stock_materiales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insumo_id INTEGER NOT NULL REFERENCES micho_insumos(id),
  color TEXT NOT NULL DEFAULT '',
  cantidad REAL NOT NULL DEFAULT 0,
  minimo REAL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(insumo_id, color)
);

CREATE TABLE IF NOT EXISTS micho_stock_productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  variante TEXT NOT NULL DEFAULT '',
  cantidad INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(slug, variante)
);

-- Historial de todo cambio de existencias, de materiales o de productos.
CREATE TABLE IF NOT EXISTS micho_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK(tipo IN ('material','producto')),
  insumo_id INTEGER REFERENCES micho_insumos(id),
  slug TEXT,
  detalle TEXT NOT NULL DEFAULT '',
  delta REAL NOT NULL,
  motivo TEXT NOT NULL,
  nota TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Micho Store: máquinas del taller. La info, las tareas y la bitácora viven
-- en su ficha (micho_product_tasks con slug 'maquina:<slug>').
CREATE TABLE IF NOT EXISTS micho_maquinas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  apodo TEXT,
  tipo TEXT NOT NULL DEFAULT 'Impresora 3D',
  estado TEXT NOT NULL DEFAULT 'Activa',
  -- Consumibles que puede tener cargados a la vez: 4 con AMS, 1 normalmente.
  ranuras INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Detalles clave/valor: boquilla, volumen, potencia, área de trabajo...
CREATE TABLE IF NOT EXISTS micho_maquina_detalles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maquina_id INTEGER NOT NULL REFERENCES micho_maquinas(id) ON DELETE CASCADE,
  clave TEXT NOT NULL,
  valor TEXT,
  orden INTEGER NOT NULL DEFAULT 0
);

-- Lo que tiene cargado cada ranura ahora mismo.
CREATE TABLE IF NOT EXISTS micho_maquina_consumibles (
  maquina_id INTEGER NOT NULL REFERENCES micho_maquinas(id) ON DELETE CASCADE,
  ranura INTEGER NOT NULL,
  insumo_id INTEGER REFERENCES micho_insumos(id),
  color TEXT,
  nota TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (maquina_id, ranura)
);

-- Cola de trabajos de cada máquina.
CREATE TABLE IF NOT EXISTS micho_cola (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maquina_id INTEGER NOT NULL REFERENCES micho_maquinas(id) ON DELETE CASCADE,
  producto_slug TEXT,
  descripcion TEXT,
  piezas INTEGER NOT NULL DEFAULT 1,
  estado TEXT NOT NULL DEFAULT 'En cola' CHECK(estado IN ('En cola','En curso','Hecho','Cancelado')),
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_micho_cola_maquina ON micho_cola(maquina_id, estado);

-- Micho Store: canales de venta con lo que cobran, y el precio de cada
-- producto en cada canal. NULL = todavía no se sabe.
CREATE TABLE IF NOT EXISTS micho_canales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  comision_pct REAL,
  cargo_fijo REAL,
  envio REAL,
  notas TEXT,
  orden INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS micho_precios (
  slug TEXT NOT NULL,
  canal_id INTEGER NOT NULL REFERENCES micho_canales(id),
  precio REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (slug, canal_id)
);

-- Ajustes sueltos de Micho Store (margen objetivo, ...).
CREATE TABLE IF NOT EXISTS micho_config (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

-- Temperatura de boquilla probada a cada velocidad (mm/s) para un material.
-- Con dos o más puntos se estima la de cualquier otra velocidad en línea recta.
CREATE TABLE IF NOT EXISTS micho_insumo_temperaturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insumo_id INTEGER NOT NULL REFERENCES micho_insumos(id) ON DELETE CASCADE,
  velocidad REAL NOT NULL,
  boquilla REAL NOT NULL,
  UNIQUE(insumo_id, velocidad)
);
