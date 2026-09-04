import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type HartaskConfig = {
  port: number;
  projectRoot: string;
  database: string;
  projectName: string;
  /** Archivable root tasks tolerated before the board suggests archiving. */
  archiveReminderThreshold: number;
  harnessScan: { enabled: boolean; paths: string[] };
};

const DEFAULTS: HartaskConfig = {
  port: 43127,
  projectRoot: '..',
  database: './data/hartask.sqlite',
  projectName: 'Current Project',
  archiveReminderThreshold: 15,
  harnessScan: { enabled: true, paths: [] }
};

/**
 * Environment overrides win over hartask.config.json, which wins over the
 * defaults. A settings page will eventually write the config file; the
 * variables stay as the escape hatch for a single run.
 */
const ENV_KEYS = {
  database: 'HARTASK_DATABASE',
  projectName: 'HARTASK_PROJECT_NAME',
  archiveReminderThreshold: 'HARTASK_ARCHIVE_REMINDER_THRESHOLD'
} as const;

let cached: HartaskConfig | null = null;

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(`[hartask] ${name} is not a non-negative number ("${raw}"), using ${fallback}`);
    return fallback;
  }
  return parsed;
}

/** Reads hartask.config.json when present; falls back to defaults otherwise. */
export function loadConfig(): HartaskConfig {
  if (cached) return cached;

  const file = resolve(process.cwd(), 'hartask.config.json');
  let overrides: Partial<HartaskConfig> = {};

  if (existsSync(file)) {
    try {
      overrides = JSON.parse(readFileSync(file, 'utf8')) as Partial<HartaskConfig>;
    } catch (error) {
      console.warn(`[hartask] hartask.config.json is not valid JSON, using defaults:`, error);
    }
  }

  const merged: HartaskConfig = {
    ...DEFAULTS,
    ...overrides,
    harnessScan: { ...DEFAULTS.harnessScan, ...overrides.harnessScan }
  };

  cached = {
    ...merged,
    database: process.env[ENV_KEYS.database] || merged.database,
    projectName: process.env[ENV_KEYS.projectName] || merged.projectName,
    archiveReminderThreshold: readNumberEnv(
      ENV_KEYS.archiveReminderThreshold,
      merged.archiveReminderThreshold
    )
  };
  return cached;
}

/** Drops the memoized config. Only needed by tests that change the env. */
export function resetConfigCache(): void {
  cached = null;
}

export function databasePath(): string {
  return resolve(process.cwd(), loadConfig().database);
}

export function projectRootPath(): string {
  return resolve(process.cwd(), loadConfig().projectRoot);
}

export function archiveReminderThreshold(): number {
  return loadConfig().archiveReminderThreshold;
}
