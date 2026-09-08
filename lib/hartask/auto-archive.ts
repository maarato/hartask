import { archiveReminderThreshold, autoArchiveEnabled } from '@/lib/hartask/config';
import { archiveAllArchivable, countArchivableRoots } from '@/lib/hartask/repositories/tasks';
import type { Task } from '@/lib/hartask/types';

/**
 * Clears the board past the threshold without being asked, when the user has
 * turned that on.
 *
 * It runs after a mutation rather than during a render: a page render must not
 * change state, and the count can only cross the threshold because something
 * changed — a task was created, one was marked DONE, or the threshold itself
 * was lowered. Hooking those covers every crossing without a scheduler.
 *
 * Archiving is attributed to `auto-archive`, so the events on each task say
 * plainly that nobody clicked. Otherwise a board quietly emptying itself would
 * be indistinguishable from someone having done it by hand.
 */
export function autoArchiveIfEnabled(): Task[] {
  if (!autoArchiveEnabled()) return [];
  if (countArchivableRoots() <= archiveReminderThreshold()) return [];

  return archiveAllArchivable('auto-archive');
}
