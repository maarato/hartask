import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Runs before the test module is imported, so the config module reads this
 * path the first time it is asked. Each test file gets its own temporary
 * database: the repositories are exercised against real SQLite, never against
 * the project's own board.
 */
const dir = mkdtempSync(join(tmpdir(), 'hartask-test-'));

process.env.HARTASK_DATABASE = join(dir, 'hartask.sqlite');
// The settings module writes this file, so it must never be the project's own.
process.env.HARTASK_CONFIG = join(dir, 'hartask.config.json');

// Deliberately not HARTASK_PROJECT_NAME: that variable overrides the config
// file, and the settings tests need to observe what the file actually holds.
