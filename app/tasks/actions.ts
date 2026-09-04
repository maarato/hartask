'use server';

import { revalidatePath } from 'next/cache';
import {
  archiveTask,
  createTask,
  setTaskStatus,
  unarchiveTask,
  updateTask
} from '@/lib/hartask/repositories/tasks';
import { isTaskStatus } from '@/lib/hartask/types';

function text(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
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

  revalidatePath('/tasks');
}

export async function setTaskStatusAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'public_id');
  const status = text(formData, 'status');
  if (!publicId || !isTaskStatus(status)) return;

  setTaskStatus(publicId, status, { blockedReason: text(formData, 'blocked_reason') });

  revalidatePath('/tasks');
}

export async function setNextActionAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'public_id');
  if (!publicId) return;

  updateTask(publicId, { nextAction: text(formData, 'next_action') });

  revalidatePath('/tasks');
}

export async function archiveTaskAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'public_id');
  if (!publicId) return;

  archiveTask(publicId);

  revalidatePath('/tasks');
}

export async function unarchiveTaskAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'public_id');
  if (!publicId) return;

  unarchiveTask(publicId);

  revalidatePath('/tasks');
}
