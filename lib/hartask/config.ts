import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type HartaskConfig = {
  port: number;
  projectRoot: string;
  database: string;
  projectName: string;
  /** Archivable root tasks tolerated before the board suggests archiving. */
  archiveReminderThreshold: number;
  /**
   * Archive past the threshold without being asked. Off by default: tasks
   * disappearing from the board unprompted has to be something the user chose.
   */
  autoArchive: boolean;
  /** Hartask instance to sync with, e.g. https://hartask.example.com */
  syncUrl: string;
  /**
   * Shared secret both peers must present. Sync is closed unless it is set:
   * an open endpoint would hand the project's board to anyone who finds the
   * URL. Never returned by the API and never rendered in the UI.
   */
  syncToken: string;
  /**
   * Which project in the remote store this instance is. Each database mints
   * its own project uuid, so a second machine has to be told which project it
   * is joining or it would sync against an empty scope of its own.
   */
  syncProjectId: string;
  harnessScan: { enabled: boolean; paths: string[] };
};

export const DEFAULT_CONFIG: HartaskConfig = {
  port: 43127,
  projectRoot: '..',
  database: './data/hartask.sqlite',
  projectName: 'Current Project',
  archiveReminderThreshold: 15,
  autoArchive: false,
  syncUrl: '',
  syncToken: '',
  syncProjectId: '',
  // Relative to projectRoot, so that one setting decides where the project is.
  harnessScan: {
    enabled: true,
    paths: [
      'AGENTS.md',
      'CLAUDE.md',
      '.claude',
      '.cursor',
      '.codex',
      '.mcp.json',
      '.github/copilot-instructions.md'
    ]
  }
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
  archiveReminderThreshold: 'HARTASK_ARCHIVE_REMINDER_THRESHOLD',
  autoArchive: 'HARTASK_AUTO_ARCHIVE',
  syncUrl: 'HARTASK_SYNC_URL',
  syncToken: 'HARTASK_SYNC_TOKEN',
  syncProjectId: 'HARTASK_SYNC_PROJECT_ID'
} as const;

export type EnvBackedKey = keyof typeof ENV_KEYS;

let cached: HartaskConfig | null = null;

/** The config file this instance reads and writes. */
export function configPath(): string {
  return resolve(process.cwd(), process.env.HARTASK_CONFIG || 'hartask.config.json');
}

/** Accepts the usual spellings; anything else keeps the stored value. */
function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;

  console.warn(`[hartask] ${name} is not a boolean ("${raw}"), using ${fallback}`);
  return fallback;
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
    ),
    autoArchive: readBooleanEnv(ENV_KEYS.autoArchive, merged.autoArchive),
    syncUrl: process.env[ENV_KEYS.syncUrl] || merged.syncUrl,
    syncToken: process.env[ENV_KEYS.syncToken] || merged.syncToken,
    syncProjectId: process.env[ENV_KEYS.syncProjectId] || merged.syncProjectId
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

export function autoArchiveEnabled(): boolean {
  return loadConfig().autoArchive;
}

export function syncSettings(): { url: string; token: string; projectId: string } {
  const config = loadConfig();
  return {
    url: config.syncUrl.trim(),
    token: config.syncToken.trim(),
    projectId: config.syncProjectId.trim()
  };
}
