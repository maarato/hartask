# Suggested implementation order

## Done

1. ~~Add a SQLite repository layer around `better-sqlite3`.~~
   `lib/db/client.ts` (connection, WAL, foreign keys, schema bootstrap),
   `lib/hartask/config.ts`, `lib/hartask/types.ts` and
   `lib/hartask/repositories/{projects,tasks}.ts`.
2. ~~Seed one project row and basic sample tasks.~~
   `npm run db:seed` (idempotent: skipped when tasks already exist). The project
   row is also created automatically by `ensureProject()` on first request.
3. ~~Replace the Tasks UI samples with DB-backed data.~~
   `/tasks` renders the `parent_id` hierarchy from SQLite and mutates through
   server actions; `/api/tasks`, `/api/tasks/[id]` and `/api/context` return
   real rows.
4. ~~Implement the handoff repository and wire `/summary` and `/api/handoff` to
   `project_handoff`.~~
   `lib/hartask/repositories/handoff.ts` is append-only: each checkpoint is a
   new row and the current handoff is the latest one, so the project keeps the
   trail of how its state was understood over time. `/api/context` now returns
   it, which makes that endpoint a real cold-start briefing.

Hartask's own backlog is loaded into Hartask with
`node scripts/dev/load-roadmap.mjs` against a running server. That script is
project-specific dev tooling and writes over the HTTP API, which is the same
path an agent uses; `db:seed` stays generic because Hartask is meant to be
copied into other repositories.

5. ~~Write an AGENTS.md that points at the interface that exists.~~
   `AGENTS.bootstrap.example.md` now documents the HTTP API instead of MCP
   tools that do not exist, the repository has its own `AGENTS.md`, and
   `lib/hartask/contract.ts` separates the durable rules from what is callable
   today. `/api/mcp` no longer advertises unimplemented tools.

6. ~~Implement the task detail view.~~
   `/tasks/[id]` accepts a public id or a row id, and shows the task's own
   notes and its complete event timeline, with status transitions rendered from
   the recorded payload. The board links to it from each public id.

7. ~~Add a settings page.~~
   `/settings` writes `hartask.config.json`, chosen over a settings table
   because the loader already resolves env > file > default and a table would
   have added a fourth level to that chain. Only values that take effect
   immediately are editable; port, database and project root are read at boot
   and are shown read-only. A value being overridden by an environment variable
   is flagged on the field, because otherwise it would save and appear to do
   nothing.

## Next

7. Implement Prompt Stack and the atomic `claim_next_prompt` transaction.
8. Implement prompt runs.
9. Replace `/api/mcp` placeholder with a real MCP Streamable HTTP endpoint on the
   same port.
10. Expose semantic Hartask MCP tools over the repositories that now exist.
11. Implement project harness scanner.
12. Add generated Mermaid diagrams for Summary and Harness.
13. Add optional adapters/bootstrap injection for AGENTS.md, Claude, Cursor and
    Codex.
14. Add Stop/session-end integration where a host supports hooks.

## Known gaps in the current layer

- The repository layer is covered by `npm test`; the API routes and the UI are
  not. Both were verified by hand against a running server, which is weaker.
- Notes are not events. Adding a note does not record a `task_events` row, so
  the timeline shows what happened to a task, not what was written about it.
  The detail view lists both, side by side.
- `tasks`, `prompts` and `project_handoff` have no `project_id`: Hartask is
  single-project by design, so the `projects` table holds exactly one row. If
  multi-project is ever wanted, that is a schema migration, not a config change.
- `listTaskTree()` promotes a task to root level when its parent is filtered out
  of the result set, so a filtered view never hides tasks silently.
- Status transitions are unconstrained: any status can move to any other. If the
  lifecycle should be enforced, that belongs in the repository, not the UI.
- An agent can only reach Hartask while the dev server is running. A `hartask`
  CLI would remove that dependency for much less work than MCP, and does not
  break the "never touch the database directly" rule, because the CLI is
  Hartask.

## Sync

Bidirectional sync. Two shapes, chosen by the configured URL: a passive
libSQL/Turso database, or another Hartask instance over HTTP. The merge engine
always runs locally against local SQLite, so the passive store needs no logic
of its own — read its rows, merge here, write the result back. Full setup in
`docs/SYNC.md`.

- Identity is `uuid` + `origin` + a Lamport counter per row. Ordering does not
  use wall clocks, which would let a machine with a fast clock win every
  conflict.
- Only tasks can conflict. Notes, events and handoffs are append-only, and
  nothing is ever deleted, so there are no tombstones.
- Conflicts are last-write-wins per row, not per field. Two origins editing
  different fields of one task keep one version; the other is recorded as a
  `SYNC_CONFLICT` event so nothing is lost silently.
- `public_id` is a label, not a global id. After pairing each origin mints in
  its own prefixed range. Tasks created before two origins ever met can carry
  different labels on each side, because renaming an existing task would break
  every reference to it. The uuid always agrees, and `getTaskByRef` takes
  either.
- Exporting marks rows as agreed before the peer has accepted them. If A's
  version beats B's and B receives it later, B applies it without flagging a
  conflict. Detecting that needs version vectors rather than one clock per row.
  Convergence is unaffected.
- A second machine must be told the project uuid it is joining
  (`HARTASK_SYNC_PROJECT_ID`); every database mints its own, so without it the
  machine syncs an empty scope of its own.
- Every exchange sends the full changeset. Resending is idempotent, so this is
  correct but not minimal; a per-peer cursor would trade that for state that
  has to stay right across failed exchanges.
