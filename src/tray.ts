// System tray icon for Ghent.
// Shows a tray icon with "Open Config" and "Exit" menu items.
// Uses systray2 (pre-compiled Go binary, communicates via stdin/stdout).
//
// systray2 is a CJS module compiled with `__esModule: true`.
// When loaded via Node's native ESM loader (dev/tsx), the entire exports object
// becomes the default export, so the class lives at `.default`.
// When bundled to CJS by esbuild, require() sees __esModule and also puts the
// class at `.default`.  Both paths use the same access pattern — no
// createRequire / import.meta.url needed.
import _systrayModule from 'systray2';
import type SysTrayType from 'systray2';
import type { ClickEvent } from 'systray2';
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';

const SysTray = (_systrayModule as unknown as { default: typeof SysTrayType }).default;

// Derive the base directory from the running entry-point file.
// process.argv[1] is:
//   dev    — absolute path to src/server.ts  → dirname = src/
//   bundle — absolute path to server.cjs     → dirname = build/bundle/
//   MSI    — absolute path to server.cjs     → dirname = C:\Program Files\Ghent\
// This means assets/icon.ico is always resolved relative to the server file,
// which is correct for all three deployment scenarios.
const _dir = dirname(resolve(process.argv[1] ?? ''));

let _tray: InstanceType<typeof SysTrayType> | null = null;

function openInBrowser(url: string): void {
  spawn('cmd.exe', ['/c', 'start', '', url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

/**
 * Start the system tray icon.
 *
 * @param port   HTTP port the config UI is served on.
 * @param onExit Called when the user clicks "Exit" in the tray menu.
 *               Should trigger a graceful server shutdown.
 */
export function startTray(port: number, onExit: (signal: string) => void): void {
  // Absolute path to the ICO file.
  // Dev:    src/assets/icon.ico
  // Bundle: build/bundle/assets/icon.ico  (copied by build-bundle.mjs)
  const iconPath = join(_dir, 'assets', 'icon.ico');
  const configUrl = `http://localhost:${port}/`;

  _tray = new SysTray({
    menu: {
      icon: iconPath,
      title: 'Ghent',
      tooltip: 'Ghent – GHE PR Notifier',
      items: [
        {
          title: 'Open Config',
          tooltip: 'Open the Ghent configuration page',
          checked: false,
          enabled: true,
        },
        SysTray.separator,
        {
          title: 'Exit',
          tooltip: 'Exit Ghent',
          checked: false,
          enabled: true,
        },
      ],
    },
    debug: false,
    // copyDir: false — use the binary in place inside node_modules/systray2/traybin/.
    copyDir: false,
  });

  // onClick awaits ready() internally — safe to call immediately.
  void _tray.onClick((action: ClickEvent) => {
    switch (action.item.title) {
      case 'Open Config':
        openInBrowser(configUrl);
        break;
      case 'Exit':
        // Delegate to the server shutdown handler; it will call stopTray().
        onExit('tray-exit');
        break;
      default:
        break;
    }
  });

  // onError/onExit access _process directly without awaiting ready(), so
  // they must be wired up only after the Go binary has started.
  _tray.ready().then(() => {
    console.log(`[tray] ready  icon=${iconPath}`);
    _tray!.onError((err: Error) => {
      console.error('[tray] error:', err.message);
    });
  }).catch((err: unknown) => {
    console.error('[tray] failed to start:', err instanceof Error ? err.message : String(err));
  });
}

/**
 * Kill the tray process (called during graceful shutdown).
 * Safe to call multiple times; no-ops if already killed.
 */
export function stopTray(): void {
  if (_tray && !_tray.killed) {
    void _tray.kill(false);
  }
  _tray = null;
}
