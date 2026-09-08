'use server';

import { revalidatePath } from 'next/cache';
import { autoArchiveIfEnabled } from '@/lib/hartask/auto-archive';
import {
  addNote,
  archiveAllArchivable,
  archiveTask,
  createTask,
  getTaskByRef,
  setTaskStatus,
  unarchiveTask,
  updateTask
} from '@/lib/hartask/repositories/tasks';
import { ARCHIVABLE_STATUSES, isTaskStatus, type TaskStatus } from '@/lib/hartask/types';

function text(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * A task shows on the board and on its own page, so every mutation refreshes
 * both. The second call uses the route pattern, which covers every task detail
 * page rather than only the one that happened to be edited.
 */
function revalidateTasks(): void {
  revalidatePath('/tasks');
  revalidatePath('/tasks/[id]', 'page');
}

/**
 * A mutation that can push the archivable count up, followed by the
 * auto-archive check.
 *
 * The count can only cross the threshold because something changed, so this is
 * where it is noticed: a page render must not mutate state, and there is no
 * scheduler.
 *
 * Restoring a task is deliberately not one of these. It raises the count too,
 * but the user just asked for that task back — archiving it again immediately
 * would be the feature fighting them.
 */
function afterMutation(): void {
  autoArchiveIfEnabled();
  revalidateTasks();
}

export async function createTaskAction(formData: FormData): Promise<void> {
  const title = text(formData, 'title');
  if (!title) return;

  const status = text(formData, 'status');
  const parentId = text(formData, 'parent_id');

  createTask({
    title,
    status: isTaskStatus(status) ? status : 'BACKLOG',
    nextAction: text(formData, 'next_action'),
    description: text(formData, 'description'),
    parentId: parentId ? Number(parentId) : null
  });

  afterMutation();
}

export async function setTaskStatusAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'public_id');
  const status = text(formData, 'status');
  if (!publicId || !isTaskStatus(status)) return;

  setTaskStatus(publicId, status, { blockedReason: text(formData, 'blocked_reason') });

  afterMutation();
}

export async function setNextActionAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'public_id');
  if (!publicId) return;

  updateTask(publicId, { nextAction: text(formData, 'next_action') });

  revalidateTasks();
}

/** The detail page edits more of a task than a board row does. */
export async function saveTaskDetailsAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'public_id');
  const title = text(formData, 'title');
  if (!publicId || !title) return;

  const priority = text(formData, 'priority');

  updateTask(publicId, {
    title,
    description: text(formData, 'description'),
    nextAction: text(formData, 'next_action'),
    priority: priority !== null && Number.isFinite(Number(priority)) ? Number(priority) : undefined
  });

  revalidateTasks();
}

export async function addNoteAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'public_id');
  const body = text(formData, 'body');
  if (!publicId || !body) return;

  const task = getTaskByRef(publicId);
  if (!task) return;

  // Written from the UI, so it is the human speaking, not the agent.
  addNote(task.id, body, 'human');

  revalidateTasks();
}

export async function archiveTaskAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'public_id');
  if (!publicId) return;

  archiveTask(publicId);

  revalidateTasks();
}

export async function unarchiveTaskAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'public_id');
  if (!publicId) return;

  unarchiveTask(publicId);

  revalidateTasks();
}

/**
 * DONE and BACKLOG are archivable for different reasons, so the button asks
 * which before it fires. An unchecked box sends nothing, and nothing means
 * nothing: an empty selection archives no tasks rather than falling back to
 * all of them, which is the failure mode that would actually cost work.
 */
export async function archiveAllArchivableAction(formData: FormData): Promise<void> {
  const chosen = ARCHIVABLE_STATUSES.filter(
    (status) => formData.get(`status_${status}`) === 'on'
  ) as TaskStatus[];

  if (!chosen.length) return;

  archiveAllArchivable(null, chosen);

  revalidateTasks();
}
