'use server';

import { revalidatePath } from 'next/cache';
import {
  claimNextPrompt,
  completePrompt,
  createPrompt,
  failPrompt,
  updatePrompt
} from '@/lib/hartask/repositories/prompts';
import { isPromptStatus } from '@/lib/hartask/types';

function text(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/** A prompt shows on the queue and on the task it serves. */
function revalidatePrompts(): void {
  revalidatePath('/prompts');
  revalidatePath('/tasks');
  revalidatePath('/tasks/[id]', 'page');
}

export async function createPromptAction(formData: FormData): Promise<void> {
  const body = text(formData, 'prompt');
  if (!body) return;

  const status = text(formData, 'status');
  const taskId = text(formData, 'task_id');

  createPrompt({
    prompt: body,
    title: text(formData, 'title'),
    status: isPromptStatus(status) ? status : 'DRAFT',
    taskId: taskId ? Number(taskId) : null
  });

  revalidatePrompts();
}

export async function setPromptStatusAction(formData: FormData): Promise<void> {
  const uuid = text(formData, 'uuid');
  const status = text(formData, 'status');
  if (!uuid || !isPromptStatus(status)) return;

  updatePrompt(uuid, { status });

  revalidatePrompts();
}

/**
 * The human pulling from the queue by hand. It is the same operation an agent
 * calls, so the board and the API cannot drift apart.
 */
export async function claimNextPromptAction(formData: FormData): Promise<void> {
  const agent = text(formData, 'agent_id') ?? 'human';

  claimNextPrompt(agent);

  revalidatePrompts();
}

export async function completePromptAction(formData: FormData): Promise<void> {
  const uuid = text(formData, 'uuid');
  if (!uuid) return;

  completePrompt(uuid, text(formData, 'summary'));

  revalidatePrompts();
}

export async function failPromptAction(formData: FormData): Promise<void> {
  const uuid = text(formData, 'uuid');
  const error = text(formData, 'error');
  if (!uuid || !error) return;

  // Unchecked means the box was there and left off, so it is a real "give up".
  failPrompt(uuid, error, { retry: formData.has('retry') });

  revalidatePrompts();
}
