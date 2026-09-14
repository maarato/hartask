'use server';

import { revalidatePath } from 'next/cache';
import { runHarnessScan } from '@/lib/hartask/repositories/harness';
import { bundledSkills, installSkill } from '@/lib/hartask/skills';

export async function scanHarnessAction(): Promise<void> {
  runHarnessScan();

  revalidatePath('/harness');
}

/**
 * Puts one of Hartask's skills where this project's host will read it.
 *
 * This and exporting a role are the only things Hartask writes into a project
 * it otherwise observes, so it is its own submit, after the page has shown the
 * exact path and the exact text. A rescan follows, because the file that just
 * landed is a harness component now.
 */
export async function installSkillAction(formData: FormData): Promise<void> {
  const name = formData.get('name');
  if (typeof name !== 'string') return;

  const skill = bundledSkills().find((candidate) => candidate.name === name);
  if (!skill) return;

  installSkill(skill);
  runHarnessScan();

  revalidatePath('/harness');
  revalidatePath('/agents');
}
