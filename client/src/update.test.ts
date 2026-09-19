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
  const download = (datei: string) => `https://github.com/speedone/mietfuchs/releases/download/v0.5.0/${datei}`

  test('Programmdatei: Download der passenden Datei, das System ergibt sich aus der Datei', () => {
    // Die Anleitung unterscheidet sich: .exe ersetzen, Zip oder tar.gz erst entpacken.
    expect(updateGuide(status())).toEqual({
      kind: 'download', href: download('mietfuchs-win.exe'), system: 'windows', newTab: false,
    })
    expect(updateGuide(status({ downloadUrl: download('mietfuchs-macos-apple-silicon.zip') }))).toMatchObject({ system: 'macos' })
    expect(updateGuide(status({ downloadUrl: download('mietfuchs-macos-intel.zip') }))).toMatchObject({ system: 'macos' })
    expect(updateGuide(status({ downloadUrl: download('mietfuchs-linux.tar.gz') }))).toMatchObject({ system: 'linux' })
  })

  test('Programmdatei ohne passende Datei: Release-Seite in neuem Tab', () => {
    // Die Release-Seite ist kein Download. Im selben Tab verließe man Mietfuchs.
    const seite = 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0'
    expect(updateGuide(status({ downloadUrl: seite }))).toEqual({ kind: 'download', href: seite, system: null, newTab: true })
    expect(updateGuide(status({ downloadUrl: null }))).toEqual({ kind: 'download', href: seite, system: null, newTab: true })
  })

  test('Programmdatei ganz ohne Link: allgemeine Release-Seite', () => {
    expect(updateGuide(status({ downloadUrl: null, releaseUrl: null }))).toEqual({
      kind: 'download', href: 'https://github.com/speedone/mietfuchs/releases/latest', system: null, newTab: true,
    })
  })

  test('Docker: Befehle zum Aktualisieren des Containers, einzeln statt mit &&', () => {
    // && kennt die Windows PowerShell 5.1 nicht. Einzelne Zeilen gehen in jeder Shell.
    expect(updateGuide(status({ mode: 'docker', downloadUrl: null }))).toEqual({
      kind: 'command',
      lines: ['docker compose pull', 'docker compose up -d'],
    })
  })

  test('npm: Befehle zum Aktualisieren des Quellcodes', () => {
    expect(updateGuide(status({ mode: 'npm', downloadUrl: null }))).toEqual({
      kind: 'command',
      lines: ['git pull', 'npm install', 'npm run build'],
    })
  })
})
