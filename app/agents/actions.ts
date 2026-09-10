'use server';

import { revalidatePath } from 'next/cache';
import { writeAgentExport, type ExportHost } from '@/lib/hartask/agents';
import { getContext, removeContext, writeContext } from '@/lib/hartask/repositories/contexts';

function text(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * Roles and documents are the same rows with a different `kind`, so they share
 * the repository. They do not share an action: writing a role from the roles
 * page must not be able to produce a document, and the kind is set here rather
 * than carried in the form where a request could change it.
 */
export async function saveAgentAction(formData: FormData): Promise<void> {
  const slug = text(formData, 'slug');
  if (!slug) return;

  try {
    writeContext({
      slug,
      kind: 'agent',
      title: text(formData, 'title') ?? undefined,
      purpose: text(formData, 'purpose'),
      body: text(formData, 'body'),
      category: text(formData, 'category'),
      validAsOf: text(formData, 'valid_as_of'),
      agentId: 'human'
    });
  } catch {
    // A new role with no title, or a slug that normalises to nothing. The form
    // requires both, so this is a hand-made request.
    return;
  }

  revalidatePath('/agents');
}

export async function removeAgentAction(formData: FormData): Promise<void> {
  const slug = text(formData, 'slug');
  if (!slug) return;

  removeContext(slug, 'human');

  revalidatePath('/agents');
}


/**
 * Writes a role into the host's own tree.
 *
 * This is the one place Hartask writes into a project it otherwise only
 * observes, so it happens on its own submit, after the page has shown the exact
 * path and the exact text. Nothing here runs as a side effect of saving a role.
 */
export async function exportAgentAction(formData: FormData): Promise<void> {
  const slug = text(formData, 'slug');
  const host = text(formData, 'host');
  if (!slug || (host !== 'claude' && host !== 'cursor')) return;

  const role = getContext(slug, 'agent');
  if (!role) return;

  writeAgentExport(role, host as ExportHost);

  revalidatePath('/agents');
  // An exported role is a file on disk, which is what the harness reports.
  revalidatePath('/harness');
}
