import { describe, expect, test } from 'vitest'
import type { Settings, UpdateStatus } from './types'
import { consentPending, hintVisible, updateGuide } from './update'

const settings = (patch: Partial<Settings> = {}): Settings => ({
  houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30,
  ollamaUrl: '', ollamaModel: '', ...patch,
})

const status = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({
  enabled: true, current: '0.4.0', mode: 'binary', latest: '0.5.0', available: true,
  releaseUrl: 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0',
  downloadUrl: 'https://github.com/speedone/mietfuchs/releases/download/v0.5.0/mietfuchs-win.exe',
  checkedAt: '2026-09-19T08:00:00.000Z', error: null, ...patch,
})

describe('Einwilligung', () => {
  test('wird gefragt, solange weder zugestimmt noch abgelehnt wurde', () => {
    expect(consentPending(settings())).toBe(true)
    expect(consentPending(settings({ updateCheck: 'on' }))).toBe(false)
    expect(consentPending(settings({ updateCheck: 'off' }))).toBe(false)
  })

  test('vor dem Laden der Einstellungen wird nichts gefragt', () => {
    // sonst blitzte die Frage bei jedem Start kurz auf, auch nach einer Antwort
    expect(consentPending(null)).toBe(false)
  })
})

describe('Hinweis in der Seitenleiste', () => {
  test('erscheint bei einer neueren Version', () => {
    expect(hintVisible(status(), settings({ updateCheck: 'on' }))).toBe(true)
  })

  test('bleibt aus ohne neuere Version, ohne Zustimmung oder ohne Antwort vom Server', () => {
    const an = settings({ updateCheck: 'on' })
    expect(hintVisible(status({ available: false }), an)).toBe(false)
    expect(hintVisible(status({ enabled: false }), an)).toBe(false)
    expect(hintVisible(null, an)).toBe(false)
  })

  test('„Später" blendet nur diese Version aus, die nächste erscheint wieder', () => {
    const spaeter = settings({ updateCheck: 'on', updateDismissed: '0.5.0' })
    expect(hintVisible(status(), spaeter)).toBe(false)
    expect(hintVisible(status({ latest: '0.6.0' }), spaeter)).toBe(true)
  })
})

describe('Anleitung je Betriebsart', () => {
  test('Programmdatei: direkter Download der passenden Datei', () => {
    expect(updateGuide(status())).toEqual({
      kind: 'download',
      href: 'https://github.com/speedone/mietfuchs/releases/download/v0.5.0/mietfuchs-win.exe',
    })
  })

  test('Programmdatei ohne passende Datei: Download über die Release-Seite', () => {
    expect(updateGuide(status({ downloadUrl: null }))).toEqual({
      kind: 'download',
      href: 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0',
    })
  })

  test('Docker: Befehl zum Aktualisieren des Containers', () => {
    expect(updateGuide(status({ mode: 'docker', downloadUrl: null }))).toEqual({
      kind: 'command',
      command: 'docker compose pull && docker compose up -d',
    })
  })

  test('npm: Befehl zum Aktualisieren des Quellcodes', () => {
    expect(updateGuide(status({ mode: 'npm', downloadUrl: null }))).toEqual({
      kind: 'command',
      command: 'git pull && npm install && npm run build',
    })
  })
})
