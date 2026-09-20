import { describe, expect, test } from 'vitest'
import type { Settings, UpdateStatus } from './types'
import { canQuit, consentPending, hintVisible, updateGuide } from './update'

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
    const consented = settings({ updateCheck: 'on' })
    expect(hintVisible(status({ available: false }), consented)).toBe(false)
    expect(hintVisible(status({ enabled: false }), consented)).toBe(false)
    expect(hintVisible(null, consented)).toBe(false)
  })

  test('„Später" blendet nur diese Version aus, die nächste erscheint wieder', () => {
    const dismissed = settings({ updateCheck: 'on', updateDismissed: '0.5.0' })
    expect(hintVisible(status(), dismissed)).toBe(false)
    expect(hintVisible(status({ latest: '0.6.0' }), dismissed)).toBe(true)
  })
})

describe('Anleitung je Betriebsart', () => {
  const download = (fileName: string) => `https://github.com/speedone/mietfuchs/releases/download/v0.5.0/${fileName}`

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
    const releasePage = 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0'
    expect(updateGuide(status({ downloadUrl: releasePage }))).toEqual({ kind: 'download', href: releasePage, system: null, newTab: true })
    expect(updateGuide(status({ downloadUrl: null }))).toEqual({ kind: 'download', href: releasePage, system: null, newTab: true })
  })

  test('Programmdatei ganz ohne Link: allgemeine Release-Seite', () => {
    expect(updateGuide(status({ downloadUrl: null, releaseUrl: null }))).toEqual({
      kind: 'download', href: 'https://github.com/speedone/mietfuchs/releases/latest', system: null, newTab: true,
    })
  })

  test('Aus einem Paket installiert: Release-Seite statt einer einzelnen Datei', () => {
    // Welche der drei Paketdateien passt, weiß nur die Distribution des Nutzers. Ein Download
    // der Programmdatei führte hier in die Irre: Sie gehört nach /usr/bin, nicht daneben.
    const releasePage = 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0'
    expect(updateGuide(status({ mode: 'package', downloadUrl: null }))).toEqual({
      kind: 'download', href: releasePage, system: 'package', newTab: true,
    })
    expect(updateGuide(status({ mode: 'package', downloadUrl: null, releaseUrl: null }))).toMatchObject({
      href: 'https://github.com/speedone/mietfuchs/releases/latest', system: 'package',
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

describe('Beenden aus der Oberfläche (#45)', () => {
  test('nur als Programmdatei, dort aber in beiden Fassungen', () => {
    // Aus einem Linux-Paket gibt es kein Konsolenfenster, dessen Schließen sonst beendet
    expect(canQuit(status({ mode: 'binary' }))).toBe(true)
    expect(canQuit(status({ mode: 'package' }))).toBe(true)
  })

  test('nicht im Container und nicht aus dem Quellcode', () => {
    // Dort beendet die Umgebung den Dienst, und ein Neustart käme von selbst
    expect(canQuit(status({ mode: 'docker' }))).toBe(false)
    expect(canQuit(status({ mode: 'npm' }))).toBe(false)
    expect(canQuit(null)).toBe(false)
  })
})
