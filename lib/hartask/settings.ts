import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  configPath,
  ENV_KEYS,
  envOverrideFor,
  loadConfig,
  readStoredConfig,
  resetConfigCache,
  type EnvBackedKey,
  type HartaskConfig
} from '@/lib/hartask/config';

/**
 * Settings live in hartask.config.json rather than in SQLite. The loader
 * already resolves env > file > default, so writing the file keeps that chain
 * intact; a settings table would have added a fourth level to it.
 *
 * Only values that take effect immediately are editable. Port, database and
 * project root are read at boot, so offering them here would let someone save
 * a change that silently does nothing until a restart.
 */
export const EDITABLE_KEYS = ['projectName', 'archiveReminderThreshold'] as const;
export type EditableKey = (typeof EDITABLE_KEYS)[number];

export type SettingView = {
  key: keyof HartaskConfig;
  label: string;
  value: string | number;
  editable: boolean;
  /** Present when an environment variable is winning over the stored value. */
  override: { name: string; value: string } | null;
  note?: string;
};

const LABELS: Record<keyof HartaskConfig, string> = {
  projectName: 'Nombre del proyecto',
  archiveReminderThreshold: 'Umbral de recordatorio de archivado',
  port: 'Puerto',
  database: 'Base de datos',
  projectRoot: 'Raíz del proyecto',
  harnessScan: 'Escaneo del harness'
};

const RESTART_NOTE = 'Se lee al arrancar; cambiarlo aquí no tendría efecto hasta reiniciar.';

const ENV_BACKED = new Set<string>(Object.keys(ENV_KEYS));

function overrideFor(key: keyof HartaskConfig) {
  return ENV_BACKED.has(key) ? envOverrideFor(key as EnvBackedKey) : null;
}

export function listSettings(): SettingView[] {
  const config = loadConfig();

  const editable: SettingView[] = EDITABLE_KEYS.map((key) => ({
    key,
    label: LABELS[key],
    value: config[key],
    editable: true,
    override: overrideFor(key)
  }));

  const readOnly: SettingView[] = (['port', 'database', 'projectRoot'] as const).map((key) => ({
    key,
    label: LABELS[key],
    value: config[key],
    editable: false,
    override: overrideFor(key),
    note: RESTART_NOTE
  }));

  return [...editable, ...readOnly];
}

export type SettingsPatch = Partial<Pick<HartaskConfig, EditableKey>>;

/**
 * Merges the patch into what the file already holds — never into the effective
 * config — so an environment override is not accidentally written to disk as
 * if the user had chosen it.
 */
export function saveSettings(patch: SettingsPatch): HartaskConfig {
  const stored = readStoredConfig();
  const next: Partial<HartaskConfig> = { ...stored };

  if (patch.projectName !== undefined) next.projectName = patch.projectName;
  if (patch.archiveReminderThreshold !== undefined) {
    const threshold = Math.trunc(patch.archiveReminderThreshold);
    if (!Number.isFinite(threshold) || threshold < 0) {
      throw new Error('archiveReminderThreshold must be a non-negative number');
    }
    next.archiveReminderThreshold = threshold;
  }

  const file = configPath();
  mkdirSync(dirname(file), { recursive: true });

  // Write then rename, so an interrupted save cannot leave the config file
  // half written and unparseable.
  const temp = join(dirname(file), `.${Date.now()}.hartask.config.tmp`);
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  renameSync(temp, file);

  resetConfigCache();
  return loadConfig();
}
