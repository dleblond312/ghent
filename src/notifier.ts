// Windows toast wrapper. Click opens the comment URL in the default browser.
import { spawn } from 'node:child_process';
import notifier from 'node-notifier';
import { logEvent } from './logger.js';

export interface NotifyArgs {
  title?: string;
  message?: string;
  url?: string;
  forceFallback?: boolean;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, '&#xA;');
}

/**
 * Show a Windows toast notification via PowerShell WinRT.
 *
 * When a URL is supplied, the toast uses activationType="protocol" so Windows
 * opens the URL natively on click — from the banner AND the Action Center,
 * with no process running.
 *
 * The SnoreToast/node-notifier approach had a fundamental limitation: its
 * named-pipe listener exits when the banner times out (~7 s). After that, any
 * Action Center click tries to COM-activate the Ghent AUMID, but no handler
 * is registered, so the click silently does nothing. The PowerShell WinRT
 * approach has no such limitation — Windows handles the launch directly.
 */
function openInBrowser(url: string): void {
  spawn('cmd.exe', ['/c', 'start', '', url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

function showFallbackToast(title: string, message: string, url?: string): void {
  const payload = {
    title,
    message,
    appID: 'Ghent.1.0',
    wait: !!url,
  };

  // node-notifier's click support is process-bound (unlike WinRT protocol toasts),
  // but it's a reliable fallback when WinRT registration is broken.
  if (url) {
    notifier.once('click', () => openInBrowser(url));
  }

  notifier.notify(payload);
  logEvent({ kind: 'toast_fallback_shown', title, message, url });
}

function showWinRTToast(title: string, message: string, url?: string): void {
  const safeTitle = escapeXml(title);
  const safeMsg   = escapeXml(message);

  // activationType="protocol" makes Windows call ShellExecute on the launch
  // attribute when the toast is clicked. microsoft-edge: forces Edge, matching
  // the previous openInDefaultBrowser() behavior.
  const launchAttrs = url
    ? ` activationType="protocol" launch="${escapeXml(`microsoft-edge:${url}`)}"`
    : '';

  const xml =
    `<toast${launchAttrs}>` +
    `<visual><binding template="ToastGeneric">` +
    `<text>${safeTitle}</text>` +
    `<text>${safeMsg}</text>` +
    `</binding></visual>` +
    `<audio src="ms-winsoundevent:Notification.Default"/>` +
    `</toast>`;

  // Embed the XML in a PowerShell single-quoted string.
  // escapeXml converts " → &quot; and & → &amp;, so no XML-special chars
  // remain. The only remaining PowerShell hazard is a literal apostrophe in
  // the title/message text — escape it as '' (PS single-quoted string rule).
  const psXml = xml.replace(/'/g, "''");

  const psScript = [
    `[void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]`,
    `[void][Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom,ContentType=WindowsRuntime]`,
    `$doc=New-Object Windows.Data.Xml.Dom.XmlDocument`,
    `$doc.LoadXml('${psXml}')`,
    `$t=[Windows.UI.Notifications.ToastNotification]::new($doc)`,
    `$n=[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Ghent.1.0')`,
    `$n.Show($t)`,
  ].join(';');

  // -EncodedCommand accepts base64(UTF-16LE) — sidesteps all shell-quoting
  // issues that would arise from passing the XML on the command line.
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  const child = spawn(
    'powershell.exe',
    ['-NonInteractive', '-WindowStyle', 'Hidden', '-NoProfile', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );

  let stderr = '';
  let stdout = '';
  child.stderr?.on('data', chunk => { stderr += String(chunk); });
  child.stdout?.on('data', chunk => { stdout += String(chunk); });

  child.on('error', (err: Error) => {
    logEvent({ kind: 'toast_error', title, message, url, error: err.message, stderr, stdout });
    showFallbackToast(title, message, url);
  });

  child.on('close', (code: number | null) => {
    if (code === 0) {
      logEvent({ kind: 'toast_shown', title, message, url });
      return;
    }
    logEvent({ kind: 'toast_error', title, message, url, exitCode: code, stderr, stdout });
    showFallbackToast(title, message, url);
  });
}

export function notify({ title, message, url, forceFallback }: NotifyArgs): void {
  const t = title || 'Ghent';
  const m = message || '';
  if (forceFallback) {
    showFallbackToast(t, m, url);
    return;
  }
  showWinRTToast(t, m, url);
}

// CLI smoke test: `npm run test-toast`
if (process.argv.includes('--test')) {
  notify({
    title: 'Ghent test',
    message: "Click me to open GitHub in your default browser.",
    url: 'https://github.com'
  });
}
