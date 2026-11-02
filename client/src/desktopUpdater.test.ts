// Automatische Updates im Programmfenster (#517): wer zuständig ist, wann der Hinweis erscheint, was „Über Mietfuchs“
// sagt. Die Komponenten prüft components/DesktopUpdater.test.tsx.
import { expect, test } from 'vitest'
import { readyHintVisible, releaseNotesUrl, serverHintAllowed, updateOwner, updaterBridge, updaterText, type UpdaterState } from './desktopUpdater'

const state = (patch: Partial<UpdaterState> = {}): UpdaterState => ({
  phase: 'idle', current: '0.14.1', version: null, percent: null, choice: null, error: null, checkedAt: null, ...patch,
})

test('Brücke: nur mit allen Teilen, sonst wie ein Fenster ohne Updates', () => {
  const fn = async () => state()
  const full = { get: fn, check: fn, later: fn, restart: fn, onChange: () => () => {} }
  expect(updaterBridge({ mietfuchsDesktop: { updater: full } })).toBe(full)
  expect(updaterBridge({ mietfuchsDesktop: { updater: { get: fn } } })).toBeNull()
  expect(updaterBridge({ mietfuchsDesktop: {} })).toBeNull()
  expect(updaterBridge(undefined)).toBeNull()
})

test('Zuständig: im Browser der Server, im Fenster unter Windows das Fenster, auf dem Mac wieder der Server', () => {
  expect(updateOwner(false, null)).toBe('server')
  expect(updateOwner(true, null)).toBe('pending')
  expect(updateOwner(true, state({ phase: 'off' }))).toBe('server')
  for (const phase of ['idle', 'checking', 'latest', 'downloading', 'ready', 'error'] as const) {
    expect(updateOwner(true, state({ phase }))).toBe('window')
  }
})

test('Hinweis „bereit“: nur mit heruntergeladener Version und bis „Beim nächsten Start“', () => {
  expect(readyHintVisible(null)).toBe(false)
  expect(readyHintVisible(state({ phase: 'downloading', version: '0.15.0' }))).toBe(false)
  expect(readyHintVisible(state({ phase: 'ready', version: '0.15.0' }))).toBe(true)
  expect(readyHintVisible(state({ phase: 'ready', version: '0.15.0', choice: 'later' }))).toBe(false)
  expect(readyHintVisible(state({ phase: 'ready', version: null }))).toBe(false)
})

test('„Über Mietfuchs“: der Stand des Fensters in einem Satz', () => {
  expect(updaterText(state())).toBe('Installiert ist Version 0.14.1.')
  expect(updaterText(state({ phase: 'checking' }))).toMatch(/sucht nach einer neuen Version/)
  expect(updaterText(state({ phase: 'latest', checkedAt: '2026-11-02T08:00:00.000Z' }))).toMatch(/^Sie nutzen die aktuelle Version 0\.14\.1\. Zuletzt geprüft: /)
  expect(updaterText(state({ phase: 'downloading', version: '0.15.0', percent: 42 }))).toBe('Version 0.15.0 wird heruntergeladen … (42 %) Installiert ist 0.14.1.')
  expect(updaterText(state({ phase: 'ready', version: '0.15.0' }))).toMatch(/^Version 0\.15\.0 ist bereit, installiert ist 0\.14\.1\./)
  expect(updaterText(state({ phase: 'ready', version: '0.15.0', choice: 'later' }))).toMatch(/wird installiert, wenn Sie Mietfuchs beenden/)
  expect(updaterText(state({ phase: 'error', error: 'GitHub ist nicht erreichbar.' }))).toBe('Installiert ist Version 0.14.1. Die letzte Prüfung ist fehlgeschlagen: GitHub ist nicht erreichbar.')
  expect(updaterText(state({ phase: 'error', error: 'Die Aktualisierung ist fehlgeschlagen: kaputt' }))).toMatch(/kaputt\.$/)
})

test('„Was ist neu?“ zeigt fest ins eigene Repo', () => {
  expect(releaseNotesUrl('0.15.0')).toBe('https://github.com/speedone/mietfuchs/releases/tag/v0.15.0')
  expect(releaseNotesUrl('../x')).toBe('https://github.com/speedone/mietfuchs/releases/tag/v..%2Fx')
})

// Durchsicht K3: Scheitert das Fenster, bleibt der Hinweis des Servers als Weg zur neuen Version
test('Durchsicht K3: Hinweis des Servers, wenn der Updater des Fensters nicht weiterkommt', () => {
  expect(serverHintAllowed('server', null)).toBe(true)
  expect(serverHintAllowed('pending', null)).toBe(false)
  expect(serverHintAllowed('window', state({ phase: 'error', error: 'GitHub ist nicht erreichbar.' }))).toBe(true)
  for (const phase of ['idle', 'checking', 'latest', 'downloading', 'ready'] as const) {
    expect(serverHintAllowed('window', state({ phase }))).toBe(false)
  }
})
