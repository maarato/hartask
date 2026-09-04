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

## Next

6. Implement the task detail view: description, full note list and the complete
   event timeline for a single task (the list view only shows the last events
   across the project).
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
