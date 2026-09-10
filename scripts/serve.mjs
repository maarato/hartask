import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Starts Next on the port this project is configured for.
 *
 * The port has to be chosen before Next binds it, which is before any of the
 * app's own code runs — so `next dev -p 43127` in package.json was the only
 * thing that ever decided it, and the `port` in the config file was decoration.
 * That mattered as soon as a second project wanted Hartask at the same time.
 *
 * The resolution happens here and the answer is handed down in HARTASK_PORT,
 * so the app reports the port it is actually served on instead of a value that
 * nobody checked against reality.
 */

const DEFAULT_PORT = 43127;

/** Anything outside this cannot be served, so it is a typo worth stopping on. */
function validate(port, source) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error(
      `[hartask] ${source} is not a usable port (${port}). ` +
        `Use a whole number between 1024 and 65535.`
    );
    process.exit(1);
  }
  return port;
}

function configuredPort() {
  const fromEnv = process.env.HARTASK_PORT?.trim();
  if (fromEnv) return validate(Number(fromEnv), 'HARTASK_PORT');

  const file = resolve(process.cwd(), process.env.HARTASK_CONFIG || 'hartask.config.json');
  if (existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8'));
      if (stored.port !== undefined) return validate(stored.port, `port in ${file}`);
    } catch (error) {
      // A broken config file should not decide where the server listens.
      console.warn(`[hartask] could not read ${file}: ${error.message}`);
    }
  }

  return DEFAULT_PORT;
}

const mode = process.argv[2] === 'start' ? 'start' : 'dev';
const port = configuredPort();

// Next's own entry point rather than `npx`: on Windows that would mean
// spawning a .cmd, which Node refuses without a shell, and a shell brings
// quoting rules that have nothing to do with the job.
const nextCli = createRequire(import.meta.url).resolve('next/dist/bin/next');

// The resolved port goes to Next and nowhere else. Setting HARTASK_PORT here
// would make the app report an environment override on every boot, and then
// tell the user their saved port cannot take effect — which would be a new
// lie in place of the old one. The app reads the same file and reaches the
// same answer; the variable stays what it should be, a real user override.
const child = spawn(process.execPath, [nextCli, mode, '-p', String(port)], {
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
