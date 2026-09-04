import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const dbPath = resolve('data/hartask.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
const schema = readFileSync(resolve('lib/db/schema.sql'), 'utf8');
db.exec(schema);
console.log(`Hartask DB initialized at ${dbPath}`);
