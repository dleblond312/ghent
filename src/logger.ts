// Append-only JSONL event log + console timestamp patcher.
// Log files live in %LOCALAPPDATA%\Ghent\ (or dev logs/ folder).
// stdout/stderr are already redirected to task.log by run-hidden-msi.vbs;
// patchConsole() just prepends timestamps so entries are readable.
import { mkdirSync, appendFileSync, existsSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB before rotation

export const LOG_FILE   = join(config.dataDir, 'events.jsonl');
export const TASK_LOG   = join(config.dataDir, 'task.log');

mkdirSync(config.dataDir, { recursive: true });

function rotateSafe(path: string): void {
  try {
    if (existsSync(path) && statSync(path).size > MAX_BYTES) {
      renameSync(path, path + '.old');
    }
  } catch (err) {
    // Non-fatal — log rotation failures are tolerated so the subsequent write can still attempt.
    // Most common cause: concurrent write racing the rename, or a transient permissions blip.
    console.warn('[logger] rotation failed:', (err as Error).message);
  }
}

export function logEvent(record: Record<string, unknown>): void {
  rotateSafe(LOG_FILE);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...record });
  appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

// Prepend ISO timestamps to all console output so task.log is readable.
// Call once at startup — idempotent (won't double-patch).
let _patched = false;
export function patchConsole(): void {
  if (_patched) return;
  _patched = true;

  const fmt = (level: string, args: unknown[]): string => {
    const ts = new Date().toISOString();
    const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    return `${ts} [${level}] ${msg}`;
  };

  const orig = { log: console.log.bind(console), error: console.error.bind(console), warn: console.warn.bind(console) };

  console.log   = (...args: unknown[]) => orig.log(fmt('INFO',  args));
  console.warn  = (...args: unknown[]) => orig.warn(fmt('WARN',  args));
  console.error = (...args: unknown[]) => orig.error(fmt('ERROR', args));
}

