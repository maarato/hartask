'use server';

import { revalidatePath } from 'next/cache';
import { renameProject } from '@/lib/hartask/repositories/projects';
import { saveSettings } from '@/lib/hartask/settings';
import { syncWithPeer } from '@/lib/hartask/sync/peer';

function text(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export async function saveSettingsAction(formData: FormData): Promise<void> {
  const projectName = text(formData, 'projectName');
  const threshold = text(formData, 'archiveReminderThreshold');
  const parsed = threshold === null ? null : Number(threshold);

  const config = saveSettings({
    projectName: projectName ?? undefined,
    archiveReminderThreshold:
      parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined,
    syncUrl: formData.has('syncUrl') ? (text(formData, 'syncUrl') ?? '') : undefined,
    // Empty means "leave the stored one": the field is never pre-filled,
    // because the page does not know the secret.
    syncToken: text(formData, 'syncToken') ?? undefined
  });

  // The project row carries its own name, so a rename has to reach it as well.
  if (projectName) renameProject(config.projectName);

  revalidatePath('/settings');
  revalidatePath('/summary');
  revalidatePath('/tasks');
}

export async function syncNowAction(): Promise<void> {
  await syncWithPeer();

  revalidatePath('/settings');
  revalidatePath('/summary');
  revalidatePath('/tasks');
}
