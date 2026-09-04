## Hartask

This project uses Hartask for local task/state/project-continuity management.

- Use the Hartask MCP server when project context, task state, prompt queue or handoff information is needed.
- At the beginning of substantial work, call `hartask_start_session` or `hartask_get_context`.
- When instructed to execute queued work, use `hartask_claim_next_prompt` before starting.
- Record meaningful progress, blockers and completions through Hartask.
- Before ending meaningful work, update the Hartask handoff.
- Do not access `./hartask/data/hartask.sqlite` directly; use Hartask MCP tools/API.
