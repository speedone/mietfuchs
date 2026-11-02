import { describe, expect, test } from 'vitest'
import type { Settings, UpdateStatus } from './types'
import { canQuit, consentPending, desktopHintVisible, desktopLinks, hintVisible, isPrerelease, RELEASES_URL, STORE_URL, statusText, updatedByStore, updateGuide } from './update'

const settings = (patch: Partial<Settings> = {}): Settings => ({
  houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30,
  ollamaUrl: '', ollamaModel: '', ...patch,
})

const status = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({
  enabled: true, current: '0.4.0', mode: 'binary', desktopOffer: null, latest: '0.5.0', available: true,
  releaseUrl: 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0',
  downloadUrl: 'https://github.com/speedone/mietfuchs/releases/download/v0.5.0/mietfuchs-win.exe',
  checkedAt: '2026-09-19T08:00:00.000Z', error: null, ...patch,
})

describe('Einwilligung', () => {
  test('wird gefragt, solange weder zugestimmt noch abgelehnt wurde', () => {
    expect(consentPending(settings(), status())).toBe(true)
    expect(consentPending(settings({ updateCheck: 'on' }), status())).toBe(false)
    expect(consentPending(settings({ updateCheck: 'off' }), status())).toBe(false)
  })

  test('vor dem Laden der Einstellungen wird nichts gefragt', () => {
    // sonst blitzte die Frage bei jedem Start kurz auf, auch nach einer Antwort
    expect(consentPending(null, status())).toBe(false)
  })

  test('vor dem Laden der Betriebsart wird nichts gefragt, aus dem Microsoft Store nie (#500)', () => {
    expect(consentPending(settings(), null)).toBe(false)
    expect(consentPending(settings(), status({ mode: 'store', enabled: false }))).toBe(false)
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

describe('Umstieg auf das Programmfenster (#517)', () => {
  test('erscheint, sobald der Server ihn anbietet, auch ohne Zustimmung zur Update-Prüfung', () => {
    expect(desktopHintVisible(status({ desktopOffer: 'windows', enabled: false, available: false }), settings())).toBe(true)
    expect(desktopHintVisible(status({ desktopOffer: 'macos' }), settings({ updateCheck: 'off' }))).toBe(true)
  })

  test('bleibt aus ohne Angebot, vor dem Laden der Einstellungen und ohne Antwort vom Server', () => {
    expect(desktopHintVisible(status({ desktopOffer: null }), settings())).toBe(false)
    expect(desktopHintVisible(status({ desktopOffer: 'windows' }), null)).toBe(false)
    expect(desktopHintVisible(null, settings())).toBe(false)
  })

  test('„Später" gilt für die installierte Version, nach einem Update der Programmdatei kommt er wieder', () => {
    const dismissed = settings({ desktopHintDismissed: '0.4.0' })
    expect(desktopHintVisible(status({ desktopOffer: 'windows' }), dismissed)).toBe(false)
    expect(desktopHintVisible(status({ desktopOffer: 'windows', current: '0.4.1' }), dismissed)).toBe(true)
  })

  // Geänderte Erwartung: Der Installer zuerst, der Store als zweite Wahl. Bis zur Zertifizierung (einige Tage) liefert
  // der Store noch die Fassung ohne Übernahme der Daten.
  test('Links aus festen Adressen: unter Windows Installer und Store, auf dem Mac das Abbild', () => {
    expect(desktopLinks('windows', '0.15.0')).toEqual([
      { label: 'Installer herunterladen', href: RELEASES_URL, primary: true },
      { label: 'Oder aus dem Microsoft Store, mit automatischen Updates', href: STORE_URL, primary: false },
    ])
    expect(desktopLinks('macos', '0.15.0')).toEqual([{ label: 'Neues Mietfuchs herunterladen', href: RELEASES_URL, primary: true }])
    expect(RELEASES_URL).toBe('https://github.com/speedone/mietfuchs/releases/latest')
  })

  test('Vorabversion: die Seite genau dieses Releases, aus der eigenen Version gebildet, und kein Store', () => {
    // releases/latest überspringt Vorabversionen, und der Store hat sie nie.
    const tag = 'https://github.com/speedone/mietfuchs/releases/tag/v0.15.0-rc.1'
    expect(desktopLinks('windows', '0.15.0-rc.1')).toEqual([{ label: 'Installer herunterladen', href: tag, primary: true }])
    expect(desktopLinks('macos', '0.15.0-rc.1')).toEqual([{ label: 'Neues Mietfuchs herunterladen', href: tag, primary: true }])
  })

  test('Der Store-Link trägt die Store-ID, mit der auch das Release einreicht', async () => {
    // Gelesen mit node:fs wie in printCss.test.ts: Der Client hat keine Node-Typen, deshalb der Name als Ausdruck.
    const fsModule = 'node:fs'
    const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
    const submit = fs.readFileSync(new URL('../../scripts/store-submit.mjs', import.meta.url), 'utf8')
    const appId = /export const APP_ID = '([0-9A-Z]+)'/.exec(submit)?.[1]
    if (!appId) throw new Error('APP_ID fehlt in scripts/store-submit.mjs')
    expect(STORE_URL).toBe(`https://apps.microsoft.com/detail/${appId}?mode=direct`)
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

  test('Programmfenster (#517): neu installieren über die Release-Seite', () => {
    expect(updateGuide(status({ mode: 'desktop', downloadUrl: null }))).toEqual({
      kind: 'download', href: 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0', system: 'desktop', newTab: true,
    })
  })

  test('Programmfenster auf dem Mac (#517): das passende Abbild direkt, Anleitung für den Mac', () => {
    const dmg = 'https://github.com/speedone/mietfuchs/releases/download/v0.5.0/Mietfuchs-0.5.0-apple-silicon.dmg'
    expect(updateGuide(status({ mode: 'desktop', downloadUrl: dmg }))).toEqual({
      kind: 'download', href: dmg, system: 'desktop-mac', newTab: false,
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
    // Aus dem Microsoft Store startet Mietfuchs ebenfalls ohne Konsolenfenster (#500)
    expect(canQuit(status({ mode: 'store' }))).toBe(true)
    expect(canQuit(status({ mode: 'desktop' }))).toBe(true)
  })

  test('nicht im Container und nicht aus dem Quellcode', () => {
    // Dort beendet die Umgebung den Dienst, und ein Neustart käme von selbst
    expect(canQuit(status({ mode: 'docker' }))).toBe(false)
    expect(canQuit(status({ mode: 'npm' }))).toBe(false)
    expect(canQuit(null)).toBe(false)
  })
})

describe('Stand in den Einstellungen (#166)', () => {
  test('erkennt eine Vorabversion am Bindestrich nach den drei Zahlen', () => {
    expect(isPrerelease('0.9.0-rc.2')).toBe(true)
    expect(isPrerelease('0.9.0')).toBe(false)
    expect(isPrerelease('unbekannt')).toBe(false)
  })

  test('eine laufende Vorabversion heißt nicht „aktuelle Version“', () => {
    const text = statusText(status({ current: '0.9.0-rc.2', latest: '0.8.0', available: false, checkedAt: null }))
    expect(text).toBe('Sie nutzen die Vorabversion 0.9.0-rc.2. Neueste veröffentlichte Version: 0.8.0.')
  })

  test('erscheint die fertige Version, gilt der gewöhnliche Hinweis', () => {
    const text = statusText(status({ current: '0.9.0-rc.2', latest: '0.9.0', available: true, checkedAt: null }))
    expect(text).toBe('Version 0.9.0 ist erschienen, installiert ist 0.9.0-rc.2.')
    expect(hintVisible(status({ current: '0.9.0-rc.2', latest: '0.9.0', available: true }), settings())).toBe(true)
  })

  test('eine fertige Version bleibt die aktuelle', () => {
    const text = statusText(status({ current: '0.5.0', latest: '0.5.0', available: false, checkedAt: null }))
    expect(text).toBe('Sie nutzen die aktuelle Version 0.5.0.')
  })
})

describe('Microsoft Store (#500)', () => {
  test('der Stand nennt den Store als Weg zu neuen Versionen', () => {
    const st = status({ mode: 'store', enabled: false, latest: null, available: false, releaseUrl: null, downloadUrl: null, checkedAt: null })
    expect(updatedByStore(st)).toBe(true)
    // Windows ersetzt ein Paket nicht, solange es läuft; Mietfuchs läuft im Hintergrund bis „Beenden“
    expect(statusText(st)).toBe('Installiert ist Version 0.4.0. Neue Versionen installiert der Microsoft Store von selbst, sobald Mietfuchs beendet ist. Sofort geht es im Store unter „Bibliothek“ mit „Updates abrufen“.')
  })

  test('nur aus dem Store', () => {
    expect(updatedByStore(status())).toBe(false)
    expect(updatedByStore(null)).toBe(false)
  })
})
