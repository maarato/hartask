export const HARTASK_AGENT_CONTRACT = `
You are connected to Hartask for the current project.
Hartask manages project continuity: tasks, task events, notes, prompt stack, prompt runs, project handoff, summary and harness metadata.

Rules:
1. Before substantial work, obtain Hartask context when relevant.
2. Claim queued tasks/prompts before executing them.
3. Record meaningful progress, blockers, failures and completions as events.
4. Update the project handoff after meaningful work and before ending a work session.
5. Never access hartask.sqlite directly. Use Hartask tools/API.
6. Keep Project Context concise and stable; keep Last Context current and actionable.
`;
