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

## Next

5. Implement the task detail view: description, full note list and the complete
   event timeline for a single task (the list view only shows the last events
   across the project).
6. Implement Prompt Stack and the atomic `claim_next_prompt` transaction.
7. Implement prompt runs.
8. Replace `/api/mcp` placeholder with a real MCP Streamable HTTP endpoint on the
   same port.
9. Expose semantic Hartask MCP tools over the repositories that now exist.
10. Implement project harness scanner.
11. Add generated Mermaid diagrams for Summary and Harness.
12. Add optional adapters/bootstrap injection for AGENTS.md, Claude, Cursor and
    Codex.
13. Add Stop/session-end integration where a host supports hooks.

## Known gaps in the current layer

- No tests yet. The repository layer is the natural first place to add them.
- `tasks`, `prompts` and `project_handoff` have no `project_id`: Hartask is
  single-project by design, so the `projects` table holds exactly one row. If
  multi-project is ever wanted, that is a schema migration, not a config change.
- `listTaskTree()` promotes a task to root level when its parent is filtered out
  of the result set, so a filtered view never hides tasks silently.
- Status transitions are unconstrained: any status can move to any other. If the
  lifecycle should be enforced, that belongs in the repository, not the UI.
- `AGENTS.bootstrap.example.md` still describes `hartask_start_session` and
  `hartask_claim_next_prompt`, which do not exist. Copied as is, it makes an
  agent fail on the first call. Fixing that is the next task on the board.
- An agent can only reach Hartask while the dev server is running. A `hartask`
  CLI would remove that dependency for much less work than MCP, and does not
  break the "never touch the database directly" rule, because the CLI is
  Hartask.
