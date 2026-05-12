/**
 * Tests for src/logger.ts
 *
 * HC-ERRORS-SURFACED: logEvent writes structured JSONL
 * HC-NO-SENSITIVE-LOGGING: log rotation and structure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), `ghent-test-logger-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  vi.resetModules();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function getLogger() {
  // Mock config to use our temp dir
  vi.doMock('../../src/config.js', () => ({
    config: { dataDir: TEST_DIR },
  }));
  return import('../../src/logger.js');
}

describe('logEvent()', () => {
  it('writes JSONL lines with timestamp', async () => {
    const { logEvent, LOG_FILE } = await getLogger();
    logEvent({ kind: 'test', data: 'hello' });
    logEvent({ kind: 'test2', count: 42 });

    const content = readFileSync(LOG_FILE, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    const parsed1 = JSON.parse(lines[0]);
    expect(parsed1.ts).toBeDefined();
    expect(parsed1.kind).toBe('test');
    expect(parsed1.data).toBe('hello');

    const parsed2 = JSON.parse(lines[1]);
    expect(parsed2.kind).toBe('test2');
    expect(parsed2.count).toBe(42);
  });

  it('appends to existing log file', async () => {
    const eventsFile = join(TEST_DIR, 'events.jsonl');
    writeFileSync(eventsFile, '{"existing":"line"}\n', 'utf8');

    const { logEvent } = await getLogger();
    logEvent({ kind: 'new' });

    const lines = readFileSync(eventsFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).existing).toBe('line');
    expect(JSON.parse(lines[1]).kind).toBe('new');
  });

  it('rotates when file exceeds 5 MB', async () => {
    const eventsFile = join(TEST_DIR, 'events.jsonl');
    // Create a file slightly over 5 MB
    const bigContent = 'x'.repeat(5 * 1024 * 1024 + 100);
    writeFileSync(eventsFile, bigContent, 'utf8');

    const { logEvent, LOG_FILE } = await getLogger();
    logEvent({ kind: 'after-rotation' });

    // Old file should be renamed
    const oldContent = readFileSync(eventsFile + '.old', 'utf8');
    expect(oldContent.length).toBeGreaterThan(5 * 1024 * 1024);

    // New file should have just the new entry
    const newContent = readFileSync(LOG_FILE, 'utf8').trim();
    expect(JSON.parse(newContent).kind).toBe('after-rotation');
  });
});

describe('patchConsole()', () => {
  it('prepends timestamps to console.log', async () => {
    const { patchConsole } = await getLogger();
    const origLog = console.log;
    const captured: string[] = [];
    console.log = (...args: unknown[]) => { captured.push(args.join(' ')); };

    patchConsole();
    console.log('test message');

    expect(captured).toHaveLength(1);
    // Should have ISO timestamp format
    expect(captured[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.*\[INFO\] test message$/);

    // Restore
    console.log = origLog;
  });

  it('is idempotent — double call does not double-patch', async () => {
    const { patchConsole } = await getLogger();
    const origLog = console.log;
    const captured: string[] = [];
    console.log = (...args: unknown[]) => { captured.push(args.join(' ')); };

    patchConsole();
    patchConsole(); // second call should be no-op
    console.log('test');

    // Should only format once (one [INFO] prefix, not nested)
    expect(captured[0]).not.toMatch(/\[INFO\].*\[INFO\]/);

    console.log = origLog;
  });
});
