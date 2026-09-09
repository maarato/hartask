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
