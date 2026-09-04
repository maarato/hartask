'use server';

import { revalidatePath } from 'next/cache';
import { createHandoff } from '@/lib/hartask/repositories/handoff';
import { updateProjectSummary } from '@/lib/hartask/repositories/projects';

function text(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/** Splits a textarea into a list, one entry per line. */
function lines(formData: FormData, field: string): string[] {
  return (text(formData, field) ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function saveProjectContextAction(formData: FormData): Promise<void> {
  const summary = text(formData, 'summary');
  if (summary === null) return;

  updateProjectSummary(summary);

  revalidatePath('/summary');
}

export async function saveHandoffAction(formData: FormData): Promise<void> {
  const done = text(formData, 'done');
  const currentState = text(formData, 'current_state');
  const nextStep = text(formData, 'next');
  const problems = lines(formData, 'problems');

  // Same rule as the API: an empty checkpoint is not worth a row.
  if (!done && !currentState && !nextStep && !problems.length) return;

  createHandoff({
    currentTask: text(formData, 'current_task'),
    whatWasDone: done,
    currentState,
    nextStep,
    knownProblems: problems,
    importantFiles: lines(formData, 'important_files'),
    importantDecisions: text(formData, 'important_decisions'),
    source: 'human-edited'
  });

  revalidatePath('/summary');
  revalidatePath('/tasks');
}
