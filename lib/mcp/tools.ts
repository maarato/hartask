/**
 * Planned MCP tool names, not an implementation. Nothing here is callable yet;
 * /api/mcp exposes them as `planned_tools` and serves the HTTP interface that
 * does exist. See lib/hartask/contract.ts.
 */
export const hartaskTools = [
  'hartask_get_context',
  'hartask_start_session',
  'hartask_list_tasks',
  'hartask_get_task',
  'hartask_claim_task',
  'hartask_update_task',
  'hartask_add_note',
  'hartask_claim_next_prompt',
  'hartask_complete_prompt',
  'hartask_fail_prompt',
  'hartask_record_event',
  'hartask_update_handoff',
  'hartask_get_harness'
] as const;
