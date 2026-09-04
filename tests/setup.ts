import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Runs before the test module is imported, so the config module reads this
 * path the first time it is asked. Each test file gets its own temporary
 * database: the repositories are exercised against real SQLite, never against
 * the project's own board.
 */
process.env.HARTASK_DATABASE = join(mkdtempSync(join(tmpdir(), 'hartask-test-')), 'hartask.sqlite');
process.env.HARTASK_PROJECT_NAME = 'Test Project';
