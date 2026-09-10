'use server';

import { revalidatePath } from 'next/cache';
import { renameProject } from '@/lib/hartask/repositories/projects';
import { saveSettings } from '@/lib/hartask/settings';
import { autoArchiveIfEnabled } from '@/lib/hartask/auto-archive';
import { runSync } from '@/lib/hartask/sync/run';

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
  const port = text(formData, 'port');
  const parsedPort = port === null ? null : Number(port);

  const config = saveSettings({
    projectName: projectName ?? undefined,
    // saveSettings rejects a port that cannot be served; passing undefined for
    // something unparseable keeps the stored one rather than throwing at a
    // user who mistyped a digit.
    port: parsedPort !== null && Number.isFinite(parsedPort) ? parsedPort : undefined,
    archiveReminderThreshold:
      parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined,
    syncUrl: formData.has('syncUrl') ? (text(formData, 'syncUrl') ?? '') : undefined,
    // Empty means "leave the stored one": the field is never pre-filled,
    // because the page does not know the secret.
    syncToken: text(formData, 'syncToken') ?? undefined,
    syncProjectId: formData.has('syncProjectId')
      ? (text(formData, 'syncProjectId') ?? '')
      : undefined,
    // An unchecked checkbox is simply absent, so presence is the value.
    autoArchive: formData.has('autoArchiveSubmitted')
      ? formData.has('autoArchive')
      : undefined
  });

  // The project row carries its own name, so a rename has to reach it as well.
  if (projectName) renameProject(config.projectName);

  // Lowering the threshold can put the board over it without any task having
  // changed, so the check belongs here too.
  autoArchiveIfEnabled();

  revalidatePath('/settings');
  revalidatePath('/summary');
  revalidatePath('/tasks');
}

/**
 * A sync that fails is not a broken app, and it must not look like one.
 *
 * The refusal in particular is the guard working: it stops a board from being
 * folded into another project. Letting that surface as an unhandled error
 * would teach the user to distrust the one thing standing between them and a
 * merge no later sync can undo.
 *
 * The outcome is left in the event trail rather than thrown, and `/settings`
 * reads it after the revalidate — which also means a sync run from the API
 * shows up the same way.
 */
export async function syncNowAction(): Promise<void> {
  try {
    await runSync();
  } catch {
    // Already recorded as SYNC_REFUSED or SYNC_FAILED by runSync.
  }

  revalidatePath('/settings');
  revalidatePath('/summary');
  revalidatePath('/tasks');
}
