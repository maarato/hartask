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

export const DEFAULT_CONFIG: HartaskConfig = {
  port: 43127,
  projectRoot: '..',
  database: './data/hartask.sqlite',
  projectName: 'Current Project',
  archiveReminderThreshold: 15,
  harnessScan: { enabled: true, paths: [] }
};

/**
 * Environment overrides win over hartask.config.json, which wins over the
 * defaults. The settings page writes the config file; the variables stay as
 * the escape hatch for a single run, which is why the page has to say when one
 * of them is winning.
 */
export const ENV_KEYS = {
  database: 'HARTASK_DATABASE',
  projectName: 'HARTASK_PROJECT_NAME',
  archiveReminderThreshold: 'HARTASK_ARCHIVE_REMINDER_THRESHOLD'
} as const;

export type EnvBackedKey = keyof typeof ENV_KEYS;

let cached: HartaskConfig | null = null;

/** The config file this instance reads and writes. */
export function configPath(): string {
  return resolve(process.cwd(), process.env.HARTASK_CONFIG || 'hartask.config.json');
}

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

/**
 * What is actually written in the config file, with no defaults or environment
 * applied. The settings page needs this so that saving a value never
 * accidentally persists whatever an environment variable happened to override
 * it with.
 */
export function readStoredConfig(): Partial<HartaskConfig> {
  const file = configPath();
  if (!existsSync(file)) return {};

  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Partial<HartaskConfig>;
  } catch (error) {
    console.warn(`[hartask] ${file} is not valid JSON, using defaults:`, error);
    return {};
  }
}

/** Effective configuration: defaults, then the config file, then the env. */
export function loadConfig(): HartaskConfig {
  if (cached) return cached;

  const stored = readStoredConfig();
  const merged: HartaskConfig = {
    ...DEFAULT_CONFIG,
    ...stored,
    harnessScan: { ...DEFAULT_CONFIG.harnessScan, ...stored.harnessScan }
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

/** Drops the memoized config, so the next read picks up a saved change. */
export function resetConfigCache(): void {
  cached = null;
}

/** The environment value winning over the stored one, if there is one. */
export function envOverrideFor(key: EnvBackedKey): { name: string; value: string } | null {
  const name = ENV_KEYS[key];
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? { name, value } : null;
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
