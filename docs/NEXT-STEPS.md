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

## Next

4. Implement the task detail view: description, full note list and the complete
   event timeline for a single task (the list view only shows the last events
   across the project).
5. Implement the handoff repository and wire `/summary` and `/api/handoff` to
   `project_handoff`.
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
