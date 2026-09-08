# Sync

Hartask always runs locally. Sync exists so a board can also live somewhere
else — a database in the cloud, or another machine — without giving up the
local database as the source of truth.

There are two shapes, chosen by the URL you configure:

| URL | Remote is | Use |
| --- | --- | --- |
| `libsql://…`, `file:…` | a passive database | Turso, or a second machine sharing one store |
| `https://…` | another Hartask instance | two machines talking to each other directly |

Both use the same merge engine. It always runs locally, against local SQLite.

## Setting up a Turso store

Create an **empty** database. Do not import your local `hartask.sqlite`: the
identity of this instance lives in its `sync_origins` table, so a copy would
make the other side believe it is the same origin, and both would collide on
Lamport clocks and on ids.

```bash
turso db create hartask-cloud
turso db show hartask-cloud --url      # libsql://hartask-cloud-<org>.turso.io
turso db tokens create hartask-cloud
```

Then, on the machine that has the project:

```bash
HARTASK_SYNC_URL=libsql://hartask-cloud-<org>.turso.io \
HARTASK_SYNC_TOKEN=<the token> \
npm run dev
```

`/settings` also writes both values, and the token is never displayed once
stored. Press **Sincronizar ahora**, or `POST /api/sync` with
`{"action":"sync"}`.

The remote schema is created on the first sync. Nothing has to be prepared.

## Adding a second machine

Each database mints its own project uuid, so a second machine has to be told
which project it is joining — otherwise it syncs an empty scope of its own and
sees none of the board.

Copy the id from the first machine (it is on `/settings`, and in
`GET /api/sync` as `project_uuid`), then:

```bash
HARTASK_SYNC_PROJECT_ID=<that uuid> npm run dev
```

## Adding another project to the same store

A new project mints its own uuid and becomes a separate row in `projects`. It
needs the URL and the token, and **not** `HARTASK_SYNC_PROJECT_ID`:

| | Second machine, same project | New project, same store |
| --- | --- | --- |
| `HARTASK_SYNC_URL` | same | same |
| `HARTASK_SYNC_TOKEN` | same | same |
| `HARTASK_SYNC_PROJECT_ID` | the project's uuid | leave empty |
| Result | the board reaches the other machine | a separate project in the store |

Setting the project id on a genuinely new project makes it write into the
existing project's scope, and the two boards end up merged into one. Copying an
`.env.local` from another project is how that happens, so check that line before
the first sync.

Install Hartask by cloning it, not by copying the folder from another project.
A copy carries `data/hartask.sqlite`, and with it that project's `sync_origins`
identity — two instances would then believe they are the same origin, which is
the same collision that makes importing a database into the store a bad idea.

## One store, several projects

Remote rows are scoped by `project_uuid`, so several projects can share one
Turso database without seeing each other. `projects` lists them, which is what
a separate viewer would read to show what is in the store.

The local schema stays single-project. That scope only means anything on the
remote side.

## What travels, and what does not

| Table | Syncs | Why |
| --- | --- | --- |
| `projects`, `tasks`, `task_notes`, `task_events`, `project_handoff` | yes | the project's state and its history |
| `prompts`, `prompt_runs` | yes | the queue is worth nothing if it only exists on one machine |
| `sync_origins` | no | the identity of *this* database; copying it would make two instances believe they are the same origin |
| `harness_components`, `harness_scans` | no | they describe files on one machine's disk |

Some columns stay local too. `id`, `parent_id`, `task_id` and `prompt_id` are
per-database row ids, replaced on the wire by uuids. `synced_lamport` is this
instance's record of what it last agreed with a peer. `projects.root_path` is a
path on one machine's disk.

## Claiming across machines

The Prompt Stack promises that claiming queued work is atomic, so two agents
cannot execute the same prompt. That holds **within one instance**. It cannot
hold across machines: if two of them claim the same prompt while disconnected,
both agents have already run the work by the time they meet, and no merge can
undo that.

Sync does not pretend otherwise. When a merge finds the same prompt claimed by
two different agents, it records a `SYNC_DOUBLE_CLAIM` event naming both,
instead of quietly keeping one. Treat a queue shared across machines as
advisory, not as a lock.

## What sync guarantees, and what it does not

- **Convergence.** Both sides end on the same value for every row.
- **Queued work is not locked across machines.** See above: a double claim is
  recorded, not prevented.
- **No silent loss.** When a remote version overrides a locally modified row,
  the discarded one is written to the task's history as a `SYNC_CONFLICT`
  event, with both versions in the payload.
- **Conflicts resolve per row, not per field.** Two origins editing different
  fields of one task keep one version and record the other.
- **`public_id` is a label, not a global id.** After pairing each origin mints
  in its own prefixed range, but tasks created before two origins ever met can
  end up labelled differently on each side — renaming an existing task would
  break every reference to it. The uuid always agrees, and `getTaskByRef`
  accepts either.
- **Every exchange sends everything.** Idempotent and correct, but not minimal.
- **Ordering uses a Lamport counter, not a wall clock**, so a machine with a
  skewed clock cannot win every conflict.

## Security

The `libsql`/Turso shape only makes outbound connections, so nothing of yours
is exposed to the network.

The `https` peer shape is different: it opens `POST /api/sync` on both
instances. That route is closed unless `HARTASK_SYNC_TOKEN` is set, compares
tokens in constant time, and answers 404 rather than 401 when sync is off. But
the rest of the UI has no authentication at all, so an instance reachable from
the internet exposes its board to anyone with the URL. Put access control in
front of it — Cloudflare Access, basic auth on a proxy, a private network —
before exposing one.
