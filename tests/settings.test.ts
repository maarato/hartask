import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configPath,
  DEFAULT_CONFIG,
  loadConfig,
  readStoredConfig,
  resetConfigCache
} from '@/lib/hartask/config';
import { listSettings, saveSettings } from '@/lib/hartask/settings';

function storedFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath(), 'utf8')) as Record<string, unknown>;
}

beforeEach(() => {
  if (existsSync(configPath())) rmSync(configPath());
  delete process.env.HARTASK_PROJECT_NAME;
  delete process.env.HARTASK_ARCHIVE_REMINDER_THRESHOLD;
  resetConfigCache();
});

afterEach(() => {
  delete process.env.HARTASK_PROJECT_NAME;
  delete process.env.HARTASK_ARCHIVE_REMINDER_THRESHOLD;
  resetConfigCache();
});

describe('loadConfig', () => {
  it('falls back to the defaults when there is no config file', () => {
    expect(loadConfig().archiveReminderThreshold).toBe(DEFAULT_CONFIG.archiveReminderThreshold);
  });

  it('lets the config file win over the defaults', () => {
    writeFileSync(configPath(), JSON.stringify({ archiveReminderThreshold: 3 }), 'utf8');
    resetConfigCache();

    expect(loadConfig().archiveReminderThreshold).toBe(3);
  });

  it('lets the environment win over the config file', () => {
    writeFileSync(configPath(), JSON.stringify({ archiveReminderThreshold: 3 }), 'utf8');
    process.env.HARTASK_ARCHIVE_REMINDER_THRESHOLD = '9';
    resetConfigCache();

    expect(loadConfig().archiveReminderThreshold).toBe(9);
    // The file is unchanged: the override is for this run only.
    expect(readStoredConfig().archiveReminderThreshold).toBe(3);
  });

  it('ignores a malformed environment value instead of crashing', () => {
    process.env.HARTASK_ARCHIVE_REMINDER_THRESHOLD = 'not a number';
    resetConfigCache();

    expect(loadConfig().archiveReminderThreshold).toBe(DEFAULT_CONFIG.archiveReminderThreshold);
  });

  it('survives a config file that is not valid JSON', () => {
    writeFileSync(configPath(), '{ not json', 'utf8');
    resetConfigCache();

    expect(loadConfig().projectName).toBe(DEFAULT_CONFIG.projectName);
  });
});

describe('saveSettings', () => {
  it('writes the value and makes the next read see it', () => {
    saveSettings({ projectName: 'Renamed', archiveReminderThreshold: 4 });

    expect(storedFile()).toMatchObject({ projectName: 'Renamed', archiveReminderThreshold: 4 });
    expect(loadConfig().projectName).toBe('Renamed');
  });

  it('keeps keys it does not manage', () => {
    writeFileSync(
      configPath(),
      JSON.stringify({ port: 5000, harnessScan: { enabled: false, paths: ['../AGENTS.md'] } }),
      'utf8'
    );
    resetConfigCache();

    saveSettings({ projectName: 'Renamed' });

    expect(storedFile()).toMatchObject({
      port: 5000,
      harnessScan: { enabled: false, paths: ['../AGENTS.md'] }
    });
  });

  it('never persists a value that only an environment variable was providing', () => {
    process.env.HARTASK_PROJECT_NAME = 'From The Environment';
    resetConfigCache();
    expect(loadConfig().projectName).toBe('From The Environment');

    // Saving an unrelated field must not write the overridden name to disk as
    // if the user had chosen it.
    saveSettings({ archiveReminderThreshold: 7 });

    expect(storedFile().projectName).toBeUndefined();
    expect(storedFile().archiveReminderThreshold).toBe(7);
  });

  it('rejects a negative threshold', () => {
    expect(() => saveSettings({ archiveReminderThreshold: -1 })).toThrow(/non-negative/i);
  });

  it('truncates a fractional threshold to a whole number of tasks', () => {
    expect(saveSettings({ archiveReminderThreshold: 4.8 }).archiveReminderThreshold).toBe(4);
  });
});

describe('listSettings', () => {
  it('separates what can be edited from what is read at boot', () => {
    const settings = listSettings();
    const editable = settings.filter((setting) => setting.editable).map((setting) => setting.key);
    const readOnly = settings.filter((setting) => !setting.editable).map((setting) => setting.key);

    expect(editable).toEqual(['projectName', 'archiveReminderThreshold']);
    expect(readOnly).toEqual(['port', 'database', 'projectRoot']);
  });

  it('reports the environment variable that is winning, so the page can warn', () => {
    process.env.HARTASK_ARCHIVE_REMINDER_THRESHOLD = '2';
    resetConfigCache();

    const threshold = listSettings().find((s) => s.key === 'archiveReminderThreshold');
    expect(threshold?.override).toEqual({
      name: 'HARTASK_ARCHIVE_REMINDER_THRESHOLD',
      value: '2'
    });
  });

  it('reports no override when the variable is absent', () => {
    const threshold = listSettings().find((s) => s.key === 'archiveReminderThreshold');
    expect(threshold?.override).toBeNull();
  });
});
