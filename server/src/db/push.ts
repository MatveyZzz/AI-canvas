// Simple migration runner: applies schema.sql (idempotent) to the configured DB.
import { initDb, getDb } from './index.js';

initDb();
const count = getDb().prepare('SELECT COUNT(*) c FROM workspaces').get() as { c: number };
console.log('Database ready. Workspaces:', count.c);
