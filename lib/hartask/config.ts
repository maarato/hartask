import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type HartaskConfig = {
  port: number;
  projectRoot: string;
  database: string;
  projectName: string;
  harnessScan: { enabled: boolean; paths: string[] };
};

const DEFAULTS: HartaskConfig = {
  port: 43127,
  projectRoot: '..',
  database: './data/hartask.sqlite',
  projectName: 'Current Project',
  harnessScan: { enabled: true, paths: [] }
};

let cached: HartaskConfig | null = null;

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

  cached = {
    ...DEFAULTS,
    ...overrides,
    harnessScan: { ...DEFAULTS.harnessScan, ...overrides.harnessScan }
  };
  return cached;
}

export function databasePath(): string {
  return resolve(process.cwd(), loadConfig().database);
}

export function projectRootPath(): string {
  return resolve(process.cwd(), loadConfig().projectRoot);
}
