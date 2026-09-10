'use server';

import { revalidatePath } from 'next/cache';
import { removeContext, writeContext } from '@/lib/hartask/repositories/contexts';

function text(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * A document is read far more often than it is written, and it rides in every
 * agent briefing, so a change to one shows up in the cold-start payload too.
 */
function revalidateContexts(): void {
  revalidatePath('/contexts');
  revalidatePath('/summary');
}

/**
 * Creating and correcting are the same operation, because a document is
 * addressed by its name: writing a slug that exists corrects it in place.
 *
 * Every field is submitted by both forms, so an emptied field clears its value
 * rather than keeping the old one — which is what someone deleting the text and
 * pressing save means.
 */
export async function saveContextAction(formData: FormData): Promise<void> {
  const slug = text(formData, 'slug');
  if (!slug) return;

  try {
    writeContext({
      slug,
      title: text(formData, 'title') ?? undefined,
      purpose: text(formData, 'purpose'),
      body: text(formData, 'body'),
      category: text(formData, 'category'),
      validAsOf: text(formData, 'valid_as_of'),
      agentId: 'human'
    });
  } catch {
    // A new document with no title, or a slug that normalises to nothing. The
    // form requires both, so this is a hand-made request rather than a user
    // mistake worth a screen of its own.
    return;
  }

  revalidateContexts();
}

export async function removeContextAction(formData: FormData): Promise<void> {
  const slug = text(formData, 'slug');
  if (!slug) return;

  removeContext(slug, 'human');

  revalidateContexts();
}
