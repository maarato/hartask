import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { HARTASK_AGENT_CONTRACT } from '@/lib/hartask/contract';
import { onboarding } from '@/lib/hartask/onboarding';
import { createHandoff, getLatestHandoff } from '@/lib/hartask/repositories/handoff';
import {
  claimNextPrompt,
  completePrompt,
  createPrompt,
  failPrompt,
  listPrompts
} from '@/lib/hartask/repositories/prompts';
import { ensureProject } from '@/lib/hartask/repositories/projects';
import {
  addNote,
  countTasksByStatus,
  createTask,
  getCurrentTask,
  getTaskByRef,
  listEvents,
  listNotes,
  listTaskTree,
  recordEvent,
  setTaskStatus,
  updateTask
} from '@/lib/hartask/repositories/tasks';
import { TASK_STATUSES } from '@/lib/hartask/types';

/**
 * Hartask over MCP.
 *
 * The tools are the semantic operations the README asks for — complete_task,
 * not query_sql. An agent depends on Hartask's concepts, so the database schema
 * stays free to change underneath it.
 *
 * `hartask_get_harness` is deliberately absent. The harness scanner is not
 * built, and a tool that answers nothing useful is worse than one that is not
 * offered: an agent would call it and act on the emptiness.
 *
 * create_task and create_prompt are not in the README's list, which is an
 * oversight there rather than a decision: docs/FIRST-RUN.md tells an agent to
 * migrate an existing task file, and without them it could only read.
 */

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
});

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

const failure = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true
});

/** The cold-start briefing, in the shape both the tool and the UI answer from. */
function briefing() {
  const project = ensureProject();
  const handoff = getLatestHandoff();
  const current = getCurrentTask();
  const counts = countTasksByStatus();
  const queued = listPrompts({ status: ['READY'] });

  return {
    project: { name: project.name, context: project.summary },
    current_task: current && {
      id: current.public_id,
      title: current.title,
      status: current.status,
      next_action: current.next_action
    },
    task_counts: counts,
    handoff: handoff && {
      at: handoff.created_at,
      what_was_done: handoff.what_was_done,
      current_state: handoff.current_state,
      next_step: handoff.next_step,
      known_problems: handoff.known_problems?.split('\n').filter(Boolean) ?? [],
      important_files: handoff.important_files
    },
    queued_prompts: queued.length,
    recent_events: listEvents({ limit: 10 }).map((event) => ({
      at: event.created_at,
      type: event.event_type,
      summary: event.summary
    })),
    onboarding: onboarding()
  };
}

export function createHartaskMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'hartask', version: '0.1.0' },
    { instructions: HARTASK_AGENT_CONTRACT, capabilities: { tools: {}, resources: {} } }
  );

  // -------------------------------------------------------------------------
  // Session and context
  // -------------------------------------------------------------------------

  server.registerTool(
    'hartask_start_session',
    {
      description:
        'The cold-start briefing: what this project is, what was being worked on, what is next, and what is queued. Call this before substantial work.',
      inputSchema: {}
    },
    async () => json(briefing())
  );

  server.registerTool(
    'hartask_get_context',
    {
      description: 'The same project state as hartask_start_session. Use either.',
      inputSchema: {}
    },
    async () => json(briefing())
  );

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  server.registerTool(
    'hartask_list_tasks',
    {
      description: 'The task board, as a hierarchy. Archived tasks are excluded.',
      inputSchema: {
        status: z.array(z.enum(TASK_STATUSES)).optional().describe('Filter by status'),
        include_closed: z.boolean().optional().describe('Defaults to true')
      }
    },
    async ({ status, include_closed }) =>
      json({
        counts: countTasksByStatus(),
        tasks: listTaskTree({ status, includeClosed: include_closed ?? true })
      })
  );

  server.registerTool(
    'hartask_create_task',
    {
      description:
        'Create a task. Use parent_id to nest it under another, which is how a goal gets its steps.',
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        status: z.enum(TASK_STATUSES).optional().describe('Defaults to BACKLOG'),
        next_action: z.string().optional(),
        parent_id: z.string().optional().describe('Public or numeric id of the parent task'),
        priority: z.number().optional(),
        agent_id: z.string().optional()
      }
    },
    async ({ title, description, status, next_action, parent_id, priority, agent_id }) => {
      const parent = parent_id ? getTaskByRef(parent_id) : null;
      if (parent_id && !parent) return failure(`Parent task not found: ${parent_id}`);
      return json(
        createTask({
          title,
          description,
          status,
          nextAction: next_action,
          parentId: parent?.id ?? null,
          priority,
          agentId: agent_id ?? 'mcp'
        })
      );
    }
  );

  server.registerTool(
    'hartask_get_task',
    {
      description: 'One task with its notes and its full event history.',
      inputSchema: { id: z.string().describe('Public id such as TASK-001, or the numeric id') }
    },
    async ({ id }) => {
      const task = getTaskByRef(id);
      if (!task) return failure(`Task not found: ${id}`);
      return json({ task, notes: listNotes(task.id), events: listEvents({ taskId: task.id }) });
    }
  );

  server.registerTool(
    'hartask_claim_task',
    {
      description: 'Take a task and mark it in progress, before starting work on it.',
      inputSchema: {
        id: z.string(),
        agent_id: z.string().optional().describe('Who is taking it')
      }
    },
    async ({ id, agent_id }) => {
      const task = getTaskByRef(id);
      if (!task) return failure(`Task not found: ${id}`);
      return json(setTaskStatus(task.id, 'IN_PROGRESS', { agentId: agent_id ?? 'mcp' }));
    }
  );

  server.registerTool(
    'hartask_update_task',
    {
      description:
        'Change a task. A status transition is recorded as an event on its own; renaming is not.',
      inputSchema: {
        id: z.string(),
        status: z.enum(TASK_STATUSES).optional(),
        title: z.string().optional(),
        next_action: z.string().optional(),
        blocked_reason: z.string().optional().describe('Why it is blocked, when status is BLOCKED'),
        agent_id: z.string().optional()
      }
    },
    async ({ id, status, title, next_action, blocked_reason, agent_id }) => {
      const task = getTaskByRef(id);
      if (!task) return failure(`Task not found: ${id}`);
      return json(
        updateTask(task.id, {
          status,
          title,
          nextAction: next_action,
          blockedReason: blocked_reason,
          agentId: agent_id ?? 'mcp'
        })
      );
    }
  );

  server.registerTool(
    'hartask_add_note',
    {
      description: 'Write a note on a task. Notes are what was written; events are what happened.',
      inputSchema: { id: z.string(), body: z.string() }
    },
    async ({ id, body }) => {
      const task = getTaskByRef(id);
      if (!task) return failure(`Task not found: ${id}`);
      return json(addNote(task.id, body, 'agent'));
    }
  );

  server.registerTool(
    'hartask_record_event',
    {
      description:
        'Record something meaningful that happened. Meaningful, not every file write: status transitions are recorded automatically.',
      inputSchema: {
        event_type: z.string().describe('Such as TEST_FAILED or DECISION_MADE'),
        summary: z.string().optional(),
        task_id: z.string().optional(),
        agent_id: z.string().optional()
      }
    },
    async ({ event_type, summary, task_id, agent_id }) => {
      const task = task_id ? getTaskByRef(task_id) : null;
      if (task_id && !task) return failure(`Task not found: ${task_id}`);
      return json(
        recordEvent({
          taskId: task?.id ?? null,
          eventType: event_type,
          summary,
          agentId: agent_id ?? 'mcp'
        })
      );
    }
  );

  // -------------------------------------------------------------------------
  // Prompt Stack
  // -------------------------------------------------------------------------

  server.registerTool(
    'hartask_create_prompt',
    {
      description:
        'Queue an instruction for an agent to execute. Created as DRAFT unless status says READY, so nothing is claimable by accident.',
      inputSchema: {
        prompt: z.string().describe('The instruction itself'),
        title: z.string().optional(),
        task_id: z.string().optional().describe('The task this prompt serves'),
        status: z.enum(['DRAFT', 'READY']).optional(),
        priority: z.number().optional()
      }
    },
    async ({ prompt, title, task_id, status, priority }) => {
      const task = task_id ? getTaskByRef(task_id) : null;
      if (task_id && !task) return failure(`Task not found: ${task_id}`);
      return json(
        createPrompt({ prompt, title, taskId: task?.id ?? null, status, priority })
      );
    }
  );

  server.registerTool(
    'hartask_claim_next_prompt',
    {
      description:
        'Take the next queued prompt. Claim, never get: two agents calling this never receive the same prompt. Finish with complete or fail.',
      inputSchema: { agent_id: z.string().describe('Who is taking the work') }
    },
    async ({ agent_id }) => {
      const claim = claimNextPrompt(agent_id);
      if (!claim) return text('The queue is empty; there is nothing to claim.');
      return json({ prompt: claim.prompt, run: claim.run });
    }
  );

  server.registerTool(
    'hartask_complete_prompt',
    {
      description: 'Close a claimed prompt as done, with what was accomplished.',
      inputSchema: { id: z.string().describe('Prompt uuid or numeric id'), summary: z.string().optional() }
    },
    async ({ id, summary }) => {
      try {
        return json(completePrompt(/^\d+$/.test(id) ? Number(id) : id, summary));
      } catch (error) {
        return failure((error as Error).message);
      }
    }
  );

  server.registerTool(
    'hartask_fail_prompt',
    {
      description:
        'Record a failed attempt. The prompt returns to the queue by default, keeping the attempt; pass retry false to give up on it.',
      inputSchema: {
        id: z.string(),
        error: z.string().describe('What went wrong'),
        retry: z.boolean().optional().describe('Defaults to true')
      }
    },
    async ({ id, error, retry }) => {
      try {
        return json(failPrompt(/^\d+$/.test(id) ? Number(id) : id, error, { retry: retry ?? true }));
      } catch (caught) {
        return failure((caught as Error).message);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Handoff
  // -------------------------------------------------------------------------

  server.registerTool(
    'hartask_update_handoff',
    {
      description:
        'Write a checkpoint: where the work stands and what comes next. After meaningful progress and before ending a session, not after every tool call.',
      inputSchema: {
        current_task: z.string().optional(),
        done: z.string().optional().describe('What was implemented'),
        current_state: z.string().optional().describe('What works right now'),
        next: z.string().optional().describe('The single next action'),
        problems: z.array(z.string()).optional(),
        important_files: z.array(z.string()).optional(),
        important_decisions: z.string().optional(),
        agent_run_id: z.string().optional()
      }
    },
    async (input) => {
      if (!input.done && !input.current_state && !input.next && !input.problems?.length) {
        return failure('A handoff needs at least one of: done, current_state, next, problems');
      }
      return json(
        createHandoff({
          currentTask: input.current_task,
          whatWasDone: input.done,
          currentState: input.current_state,
          nextStep: input.next,
          knownProblems: input.problems,
          importantFiles: input.important_files,
          importantDecisions: input.important_decisions,
          agentRunId: input.agent_run_id ?? 'mcp'
        })
      );
    }
  );

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------

  const resource = (uri: string, name: string, description: string, read: () => unknown) =>
    server.registerResource(name, uri, { description, mimeType: 'application/json' }, async () => ({
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(read(), null, 2) }]
    }));

  resource('hartask://project', 'project', 'The project and its Project Context', () => {
    const project = ensureProject();
    return { name: project.name, context: project.summary };
  });

  resource('hartask://project/summary', 'summary', 'Project Context plus the last handoff', () => ({
    context: ensureProject().summary,
    handoff: getLatestHandoff()
  }));

  resource('hartask://tasks', 'tasks', 'The task board as a hierarchy', () => listTaskTree());

  resource('hartask://tasks/current', 'current-task', 'The task a session should resume', () =>
    getCurrentTask()
  );

  resource('hartask://prompts/queue', 'prompt-queue', 'Prompts waiting to be claimed', () =>
    listPrompts({ status: ['READY'] })
  );

  resource('hartask://history/recent', 'recent-history', 'What happened lately', () =>
    listEvents({ limit: 50 })
  );

  return server;
}

/** Exposed for the discovery response, so the two never disagree. */
export function hartaskToolNames(): string[] {
  return [
    'hartask_start_session',
    'hartask_get_context',
    'hartask_list_tasks',
    'hartask_create_task',
    'hartask_get_task',
    'hartask_claim_task',
    'hartask_update_task',
    'hartask_add_note',
    'hartask_record_event',
    'hartask_create_prompt',
    'hartask_claim_next_prompt',
    'hartask_complete_prompt',
    'hartask_fail_prompt',
    'hartask_update_handoff'
  ];
}

