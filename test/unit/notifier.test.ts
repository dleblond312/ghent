/**
 * Tests for src/notifier.ts
 *
 * HC-SAFE-SIDE-EFFECTS: toast XML is well-formed and properly escaped
 * HC-ERRORS-SURFACED: spawn failures are handled
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted runs before vi.mock hoisting — safe for mock refs
const { mockSpawn } = vi.hoisted(() => {
  const mockSpawn = vi.fn(() => ({
    unref: vi.fn(),
    on: vi.fn(),
    pid: 12345,
  }));
  return { mockSpawn };
});

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));
vi.mock('../../src/logger.js', () => ({
  logEvent: vi.fn(),
  patchConsole: vi.fn(),
  LOG_FILE: '/tmp/test-events.jsonl',
  TASK_LOG: '/tmp/test-task.log',
}));
vi.mock('../../src/config.js', () => ({
  config: { dataDir: '/tmp/ghent-test' },
}));

import { notify } from '../../src/notifier.js';

beforeEach(() => {
  mockSpawn.mockClear();
});

describe('notify()', () => {
  it('spawns powershell with -EncodedCommand', () => {
    notify({ title: 'Test', message: 'Hello', url: 'https://example.com' });
    expect(mockSpawn).toHaveBeenCalledOnce();
    const [exe, args] = mockSpawn.mock.calls[0];
    expect(exe).toBe('powershell.exe');
    expect(args).toContain('-EncodedCommand');
    expect(args).toContain('-NonInteractive');
    expect(args).toContain('-NoProfile');
  });

  it('produces valid toast XML in the encoded command', () => {
    notify({ title: 'Test Title', message: 'Test message', url: 'https://example.com/pr/1' });
    const args = mockSpawn.mock.calls[0][1] as string[];
    const encodedIdx = args.indexOf('-EncodedCommand');
    const encoded = args[encodedIdx + 1];

    // Decode base64 → UTF-16LE → string
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');

    // Should contain toast XML elements
    expect(decoded).toContain('<toast');
    expect(decoded).toContain('Test Title');
    expect(decoded).toContain('Test message');
    expect(decoded).toContain('microsoft-edge:https://example.com/pr/1');
    expect(decoded).toContain('activationType="protocol"');
  });

  it('escapes XML special characters in title and message', () => {
    notify({ title: '<script>alert("xss")</script>', message: 'A & B > C' });
    const args = mockSpawn.mock.calls[0][1] as string[];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');

    // Should contain escaped XML, not raw angle brackets
    expect(decoded).toContain('&lt;script&gt;');
    expect(decoded).toContain('&amp;');
    expect(decoded).toContain('&gt;');
    expect(decoded).toContain('&quot;xss&quot;');
    expect(decoded).not.toContain('<script>');
  });

  it('escapes newlines as XML entities', () => {
    notify({ title: 'T', message: 'line1\nline2\r\nline3' });
    const args = mockSpawn.mock.calls[0][1] as string[];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');

    expect(decoded).toContain('&#xA;');
    expect(decoded).not.toContain('\n');
  });

  it('escapes single quotes for PowerShell single-quoted strings', () => {
    notify({ title: "It's a test", message: "O'Brien's PR" });
    const args = mockSpawn.mock.calls[0][1] as string[];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');

    // PS single-quoted strings escape ' as ''
    expect(decoded).toContain("It''s a test");
    expect(decoded).toContain("O''Brien''s PR");
  });

  it('omits launch attributes when no URL provided', () => {
    notify({ title: 'No URL', message: 'Body' });
    const args = mockSpawn.mock.calls[0][1] as string[];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');

    expect(decoded).not.toContain('activationType');
    expect(decoded).not.toContain('microsoft-edge');
  });

  it('defaults title to Ghent and message to empty', () => {
    notify({});
    const args = mockSpawn.mock.calls[0][1] as string[];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');

    expect(decoded).toContain('Ghent');
  });

  it('spawns powershell with hidden window and piped stdio', () => {
    notify({ title: 'T' });
    const [, , opts] = mockSpawn.mock.calls[0];
    expect(opts.detached).toBeUndefined();
    expect(opts.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(opts.windowsHide).toBe(true);
  });
});
