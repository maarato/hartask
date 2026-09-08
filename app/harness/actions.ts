'use server';

import { revalidatePath } from 'next/cache';
import { runHarnessScan } from '@/lib/hartask/repositories/harness';

export async function scanHarnessAction(): Promise<void> {
  runHarnessScan();

  revalidatePath('/harness');
}
