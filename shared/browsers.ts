// Die Browser, mit denen sich Mietfuchs beim Start öffnen kann (#735): Kennung und Name. Der Server sucht sie
// (server/src/browser.ts), die Oberfläche beschriftet damit auch den Verlauf.
import type { BrowserId } from './types.ts'

export const BROWSER_IDS: readonly BrowserId[] = ['firefox', 'chromium', 'chrome', 'edge', 'brave']

export const BROWSER_LABELS: Record<BrowserId, string> = {
  firefox: 'Firefox',
  chromium: 'Chromium',
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
  brave: 'Brave',
}

// Nur eine bekannte Kennung gilt als Wahl, nie ein Pfad oder Befehl; alles andere ist `null` (der Standardbrowser)
export function asBrowserId(value: unknown): BrowserId | null {
  return typeof value === 'string' && (BROWSER_IDS as readonly string[]).includes(value) ? (value as BrowserId) : null
}
