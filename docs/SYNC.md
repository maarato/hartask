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

## One store, several projects

Remote rows are scoped by `project_uuid`, so several projects can share one
Turso database without seeing each other. `projects` lists them, which is what
a separate viewer would read to show what is in the store.

The local schema stays single-project. That scope only means anything on the
remote side.

## What sync guarantees, and what it does not

- **Convergence.** Both sides end on the same value for every row.
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
