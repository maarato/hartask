import { NextResponse } from 'next/server';
import { configPath } from '@/lib/hartask/config';
import { renameProject } from '@/lib/hartask/repositories/projects';
import { EDITABLE_KEYS, listSettings, redactedConfig, saveSettings } from '@/lib/hartask/settings';

export const dynamic = 'force-dynamic';

/** An agent should be able to read the effective configuration, not just the human. */
export async function GET() {
  return NextResponse.json({
    // Redacted: an agent needs to know whether a secret is set, not what it is.
    config: redactedConfig(),
    settings: listSettings(),
    config_path: configPath(),
    resolution: 'environment variable, then hartask.config.json, then defaults'
  });
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const unknown = Object.keys(body).filter(
    (key) => !(EDITABLE_KEYS as readonly string[]).includes(key)
  );
  if (unknown.length) {
    return NextResponse.json(
      { error: `Not editable: ${unknown.join(', ')}. Editable: ${EDITABLE_KEYS.join(', ')}` },
      { status: 400 }
    );
  }

  const projectName = typeof body.projectName === 'string' ? body.projectName.trim() : undefined;
  if (body.projectName !== undefined && !projectName) {
    return NextResponse.json({ error: '`projectName` cannot be empty' }, { status: 400 });
  }

  const threshold = body.archiveReminderThreshold;
  if (threshold !== undefined && (typeof threshold !== 'number' || !Number.isFinite(threshold))) {
    return NextResponse.json(
      { error: '`archiveReminderThreshold` must be a number' },
      { status: 400 }
    );
  }

  try {
    const config = saveSettings({
      projectName,
      archiveReminderThreshold: threshold as number | undefined
    });
    if (projectName) renameProject(config.projectName);

    return NextResponse.json({ config, settings: listSettings() });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
