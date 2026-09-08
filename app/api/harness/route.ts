import { NextResponse } from 'next/server';
import { loadConfig, projectRootPath } from '@/lib/hartask/config';
import {
  lastHarnessScan,
  listHarnessComponents,
  runHarnessScan
} from '@/lib/hartask/repositories/harness';

export const dynamic = 'force-dynamic';

export async function GET() {
  const scan = lastHarnessScan();

  return NextResponse.json({
    components: listHarnessComponents(),
    last_scan: scan && {
      at: scan.finished_at ?? scan.started_at,
      summary: JSON.parse(scan.summary_json ?? 'null')
    },
    // Hartask observes the harness; the files stay the only copy of themselves.
    scanned: { root: projectRootPath(), paths: loadConfig().harnessScan.paths }
  });
}

/** Rescans on demand: there is no filesystem watcher. */
export async function POST() {
  const result = runHarnessScan();
  return NextResponse.json({
    summary: result.summary,
    components: result.components,
    scanned_at: result.scan.finished_at
  });
}
