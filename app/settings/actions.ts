'use server';

import { revalidatePath } from 'next/cache';
import { renameProject } from '@/lib/hartask/repositories/projects';
import { saveSettings } from '@/lib/hartask/settings';

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
      parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
  });

  // The project row carries its own name, so a rename has to reach it as well.
  if (projectName) renameProject(config.projectName);

  revalidatePath('/settings');
  revalidatePath('/summary');
  revalidatePath('/tasks');
}
