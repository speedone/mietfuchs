// Welche Ansicht die Anmeldung verlangt und welche Sätze dazu gehören (#528): reine Entscheidungen, ohne Seite.
import { describe, expect, test } from 'vitest'
import type { AccessInfo } from './access'
import {
  accessView, codeFromHash, codePlaces, failedAttemptsText, passwordProblems, showsAccessCard, showsSignOut,
  setupErrorField, showsTransitionHint, takeSetupCode, waitText, withoutSetupHash,
} from './accessView'
import { ApiError } from './api'
import { passphrase, PASSPHRASE_WORDS } from './passphrase'

const info = (over: Partial<AccessInfo> = {}): AccessInfo => ({
  mode: 'password', required: true, signedIn: false, window: false, reachable: 'network', envFixed: false, minLength: 15, runtime: 'docker', ...over,
})

describe('Ansicht', () => {
  test('verlangt und noch ohne Passwort: Einrichtung; mit Passwort: Anmeldung', () => {
    expect(accessView(info({ mode: 'setup' }))).toBe('setup')
    expect(accessView(info({ mode: 'password' }))).toBe('login')
  })
  test('angemeldet, nicht verlangt, Übergang, aus oder unbekannt: die App', () => {
    expect(accessView(info({ signedIn: true }))).toBe('app')
    expect(accessView(info({ required: false }))).toBe('app')
    expect(accessView(info({ mode: 'transition', required: false }))).toBe('app')
    expect(accessView(info({ mode: 'off', required: false }))).toBe('app')
    expect(accessView(null)).toBe('app')
  })
  test('Übergang mit Hinweis; Abmelden nur mit Sitzung und nicht im Fenster', () => {
    expect(showsTransitionHint(info({ mode: 'transition', required: false }))).toBe(true)
    expect(showsTransitionHint(info({ mode: 'off', required: false }))).toBe(false)
    expect(showsTransitionHint(null)).toBe(false)
    expect(showsSignOut(info({ signedIn: true }))).toBe(true)
    expect(showsSignOut(info({ signedIn: true, window: true }))).toBe(false)
    expect(showsSignOut(info({ signedIn: false }))).toBe(false)
  })
  test('die Karte in den Einstellungen: im Netz, mit Passwort oder im Übergang', () => {
    expect(showsAccessCard(info({ mode: 'none', reachable: 'network', required: false }))).toBe(true)
    expect(showsAccessCard(info({ mode: 'password', reachable: 'local' }))).toBe(true)
    expect(showsAccessCard(info({ mode: 'transition', reachable: 'local' }))).toBe(true)
    expect(showsAccessCard(info({ mode: 'none', reachable: 'local', required: false }))).toBe(false)
    expect(showsAccessCard(null)).toBe(false)
  })
})

describe('Einrichtungscode aus der Adresse', () => {
  test('#einrichtung=… wird gelesen, sonst nichts', () => {
    expect(codeFromHash('#einrichtung=K7QM-4XPA-9TRW')).toBe('K7QM-4XPA-9TRW')
    expect(codeFromHash('#einrichtung=k7qm%204xpa')).toBe('k7qm 4xpa')
    expect(codeFromHash('#anderes=1')).toBe('')
    expect(codeFromHash('')).toBe('')
  })
  test('danach steht er nicht mehr in der Adresse (history.replaceState)', () => {
    expect(withoutSetupHash('http://127.0.0.1:3001/?x=1#einrichtung=K7QM-4XPA-9TRW')).toBe('http://127.0.0.1:3001/?x=1')
    const calls: string[] = []
    const code = takeSetupCode(
      { hash: '#einrichtung=K7QM-4XPA-9TRW', href: 'http://127.0.0.1:3001/#einrichtung=K7QM-4XPA-9TRW' },
      { state: null, replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { calls.push(String(url)) } },
    )
    expect(code).toBe('K7QM-4XPA-9TRW')
    expect(calls).toEqual(['http://127.0.0.1:3001/'])
    // Ohne Code bleibt die Adresse, wie sie ist
    const none: string[] = []
    expect(takeSetupCode({ hash: '', href: 'http://x/' }, { state: null, replaceState: () => { none.push('x') } })).toBe('')
    expect(none).toEqual([])
  })
})

describe('Sätze', () => {
  test('Passwort: fehlt, zu kurz mit Mindestlänge, ungleich', () => {
    expect(passwordProblems('', '', 15).map((p) => p.field)).toEqual(['password'])
    const short = passwordProblems('kurz', 'kurz', 15)
    expect(short).toHaveLength(1)
    expect(short[0]?.text).toMatch(/mindestens 15 Zeichen/)
    const differ = passwordProblems('tisch-garten-wolke', 'tisch-garten-wolkf', 15)
    expect(differ.map((p) => p.field)).toEqual(['repeat'])
    expect(differ[0]?.text).toMatch(/nicht überein/)
    expect(passwordProblems('tisch-garten-wolke', 'tisch-garten-wolke', 15)).toEqual([])
    // Gezählt wird je Zeichen, nicht je UTF-16-Einheit
    expect(passwordProblems('😀'.repeat(14), '😀'.repeat(14), 15)).toHaveLength(1)
  })
  test('wo der Code steht: je Betriebsart, mit Datei', () => {
    expect(codePlaces(info({ runtime: 'docker', codeFileName: 'einrichtungscode.txt' })).join(' ')).toMatch(/docker compose logs mietfuchs/)
    expect(codePlaces(info({ runtime: 'docker', codeFileName: 'einrichtungscode.txt' })).join(' ')).toMatch(/einrichtungscode\.txt/)
    expect(codePlaces(info({ runtime: 'binary', codeFile: 'C:\\Mietfuchs\\data\\einrichtungscode.txt' })).join(' ')).toMatch(/Konsolenfenster/)
    expect(codePlaces(info({ runtime: 'binary', codeFile: 'C:\\Mietfuchs\\data\\einrichtungscode.txt' })).join(' ')).toContain('C:\\Mietfuchs\\data\\einrichtungscode.txt')
  })
  test('Fehlversuche seit der letzten Anmeldung, Wartezeit', () => {
    expect(failedAttemptsText(0)).toBeNull()
    expect(failedAttemptsText(1)).toBe('Ein Fehlversuch seit Ihrer letzten Anmeldung.')
    expect(failedAttemptsText(4)).toBe('4 Fehlversuche seit Ihrer letzten Anmeldung.')
    expect(waitText(30)).toBe('Bitte versuchen Sie es in 30 Sekunden erneut.')
    expect(waitText(61)).toBe('Bitte versuchen Sie es in 2 Minuten erneut.')
    expect(waitText(60)).toBe('Bitte versuchen Sie es in einer Minute erneut.')
  })
})

describe('Vorschlag einer Passphrase', () => {
  test('vier Wörter aus der Liste, lang genug, mit dem Zufall des Browsers', () => {
    let n = 0
    const fixed = (buf: Uint32Array<ArrayBuffer>) => { buf.fill(n++); return buf }
    const p = passphrase(15, fixed)
    expect(p.split('-')).toHaveLength(4)
    for (const w of p.split('-')) expect(PASSPHRASE_WORDS).toContain(w)
    expect([...p].length).toBeGreaterThanOrEqual(15)
    expect(new Set(PASSPHRASE_WORDS).size).toBe(PASSPHRASE_WORDS.length)
    expect(PASSPHRASE_WORDS.length).toBeGreaterThanOrEqual(256)
    // Nur Kleinbuchstaben ohne Umlaut: am Handy ohne Umschalten zu tippen
    for (const w of PASSPHRASE_WORDS) expect(w).toMatch(/^[a-z]{3,9}$/)
  })
})

describe('Ablehnungen des Servers am Feld', () => {
  test('Code, bisheriges Passwort, neues Passwort', () => {
    expect(setupErrorField(new ApiError('Der Code stimmt nicht.', 400, {}))).toBe('code')
    expect(setupErrorField(new ApiError('Bitte geben Sie den Einrichtungscode ein. Er steht im Protokoll von Mietfuchs.', 403, {}))).toBe('code')
    expect(setupErrorField(new ApiError('Das bisherige Passwort stimmt nicht.', 403, {}))).toBe('current')
    expect(setupErrorField(new ApiError('Bitte geben Sie Ihr bisheriges Passwort ein.', 400, {}))).toBe('current')
    expect(setupErrorField(new ApiError('Das Passwort braucht mindestens 15 Zeichen.', 400, {}))).toBe('password')
    expect(setupErrorField(new ApiError('Bitte melden Sie sich an.', 401, {}))).toBeNull()
    expect(setupErrorField(new Error('Netz weg'))).toBeNull()
  })
})
