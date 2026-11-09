// Was die Anmeldung für die Oberfläche bedeutet (#528, Schritt 1): welche Ansicht, welche Sätze, der Einrichtungscode
// aus der Adresse. Ohne Seite und ohne Server prüfbar (accessView.test.ts); die Seiten (Anmeldung.tsx, Einrichtung.tsx,
// AccessCard.tsx) rendern nur.
import type { AccessInfo } from './access'
import type { Problem } from './formProblems'
import { ApiError } from './api'

export type AccessViewKind = 'setup' | 'login' | 'app'

// Verlangt der Server für diese Anfrage eine Anmeldung und fehlt sie: ohne Passwort die Einrichtung, sonst die Anmeldung.
// Ohne lesbaren Zustand bleibt es bei der App; verlangt der Server dann doch etwas, meldet es das Ereignis.
export function accessView(info: AccessInfo | null): AccessViewKind {
  if (!info || !info.required || info.signedIn) return 'app'
  if (info.mode === 'setup') return 'setup'
  if (info.mode === 'password') return 'login'
  return 'app'
}

// Im Übergang (bestehender Bestand im Netz, noch nichts entschieden) ein ruhiger Hinweis in der Seitenleiste
export const showsTransitionHint = (info: AccessInfo | null): boolean => info?.mode === 'transition'
// „Abmelden“ nur mit einer Sitzung; das Fenster ist über seinen Schlüssel angemeldet, ein gekoppeltes Fenster über
// seinen Geräteschlüssel, und beide bleiben es auch nach dem Abmelden
export const showsSignOut = (info: AccessInfo | null): boolean => !!info && info.signedIn && !info.window && !info.device && info.mode === 'password'
// Die Karte „Anmeldung“: im Netz erreichbar, mit Passwort oder im Übergang
export const showsAccessCard = (info: AccessInfo | null): boolean =>
  !!info && (info.reachable === 'network' || info.mode === 'password' || info.mode === 'transition')

// ---------- Einrichtungscode in der Adresse ----------

// Die Programmdatei öffnet den Browser mit `#einrichtung=<Code>`: Das Fragment geht nicht an den Server und nicht in den
// Referer; danach wird es aus der Adresse genommen, damit es nicht in Lesezeichen oder beim Teilen mitgeht.
const HASH_KEY = 'einrichtung'

export function codeFromHash(hash: string): string {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  return params.get(HASH_KEY)?.trim() ?? ''
}

export function withoutSetupHash(href: string): string {
  const url = new URL(href)
  url.hash = ''
  return url.href.replace(/#$/, '')
}

type Place = { hash: string; href: string }
type History = { state: unknown; replaceState: (data: unknown, unused: string, url?: string | URL | null) => void }

export function takeSetupCode(place: Place = window.location, history: History = window.history): string {
  const code = codeFromHash(place.hash)
  if (code) history.replaceState(history.state, '', withoutSetupHash(place.href))
  return code
}

// ---------- Sätze ----------

export type PasswordField = 'password' | 'repeat'
// Alle Felder der Anmeldung: Code, bisheriges Passwort, neues Passwort und Wiederholung
export type AccessField = PasswordField | 'code' | 'current'

// Dieselbe Regel wie der Server (passwordProblem in server/src/access.ts): gezählt je Zeichen. Ungleiche Felder gehen
// gar nicht erst hinaus.
export function passwordProblems(password: string, repeat: string, minLength: number): Problem<PasswordField>[] {
  if (!password) return [{ field: 'password', short: 'Passwort fehlt', text: 'Bitte geben Sie ein Passwort ein.' }]
  if ([...password].length < minLength) {
    return [{ field: 'password', short: `mindestens ${minLength} Zeichen`, text: `Das Passwort braucht mindestens ${minLength} Zeichen. Ein Satz aus drei, vier Wörtern lässt sich gut merken.` }]
  }
  if (password !== repeat) return [{ field: 'repeat', short: 'stimmt nicht überein', text: 'Die beiden Passwörter stimmen nicht überein.' }]
  return []
}

// Einrichtung (Seite und Karte): ohne Code geht es nur im Fenster; mit `value` dazu die Regeln für das Passwort
export function setupProblems(info: AccessInfo, code: string, value: { password: string; repeat: string } | null): Problem<AccessField>[] {
  const problems: Problem<AccessField>[] = []
  if (!info.window && !code.trim()) problems.push({ field: 'code', short: 'Code fehlt', text: 'Bitte geben Sie den Einrichtungscode ein.' })
  if (value) problems.push(...passwordProblems(value.password, value.repeat, info.minLength))
  return problems
}

// Welches Feld eine Ablehnung des Servers betrifft, damit sie wie jede Meldung auch dort steht: der Code (fehlt: 403,
// falsch: 400 mit „Code“), das bisherige Passwort (403 oder „bisherige“), sonst bei 400 das neue Passwort.
export function setupErrorField(e: unknown): AccessField | null {
  if (!(e instanceof ApiError)) return null
  if (/code/i.test(e.message) && (e.status === 400 || e.status === 403)) return 'code'
  if (/bisherige/.test(e.message) || e.status === 403) return 'current'
  if (e.status === 400) return 'password'
  return null
}

// Wo der Einrichtungscode steht, je Betriebsart. Den vollen Pfad nennt der Server nur am Rechner selbst.
export function codePlaces(info: AccessInfo): string[] {
  const file = info.codeFile ?? (info.codeFileName ? `${info.codeFileName} im Datenordner von Mietfuchs` : 'einrichtungscode.txt im Datenordner von Mietfuchs')
  const log = info.runtime === 'docker'
    ? 'Auf dem Rechner, auf dem der Container läuft, zeigt ihn der Befehl docker compose logs mietfuchs.'
    : info.runtime === 'package'
      ? 'Er steht im Protokoll von Mietfuchs (etwa mit journalctl).'
      : 'Er steht im Konsolenfenster von Mietfuchs auf dem Rechner, auf dem Mietfuchs läuft.'
  return [log, `Außerdem steht er in der Datei ${file}.`]
}

export function failedAttemptsText(count: number): string | null {
  if (!(count > 0)) return null
  return count === 1 ? 'Ein Fehlversuch seit Ihrer letzten Anmeldung.' : `${count} Fehlversuche seit Ihrer letzten Anmeldung.`
}

// Nur, wenn der Server bei 429 keinen eigenen Satz schickt; sonst gilt seiner.
export function waitText(seconds: number): string {
  if (seconds < 60) return `Bitte versuchen Sie es in ${seconds === 1 ? 'einer Sekunde' : `${seconds} Sekunden`} erneut.`
  const minutes = Math.ceil(seconds / 60)
  return `Bitte versuchen Sie es in ${minutes === 1 ? 'einer Minute' : `${minutes} Minuten`} erneut.`
}

// Der Zustand in Worten, für die Karte „Anmeldung“ in den Einstellungen
export function accessStateText(info: AccessInfo): string {
  switch (info.mode) {
    case 'password':
      return info.window
        ? 'Mietfuchs verlangt auf anderen Geräten ein Passwort. Dieses Fenster ist ohne Anmeldung zugelassen.'
        : 'Mietfuchs verlangt ein Passwort. Ohne Aktivität endet eine Anmeldung nach 30 Minuten, spätestens nach 8 Stunden.'
    case 'transition':
      return 'Mietfuchs ist im Netz ohne Passwort erreichbar: Jedes Gerät in Ihrem Netz kann Ihre Daten sehen und ändern.'
    case 'off':
      return 'Die Anmeldung ist ausgeschaltet. Jedes Gerät in Ihrem Netz kann Ihre Daten sehen und ändern.'
    case 'setup':
      return 'Mietfuchs verlangt ein Passwort, es ist aber noch keines festgelegt.'
    case 'none':
      return info.envFixed
        ? 'Die Anmeldung ist abgeschaltet. Jedes Gerät, das Mietfuchs erreicht, kann Ihre Daten sehen und ändern.'
        : 'Mietfuchs ist nur von diesem Rechner aus erreichbar und braucht kein Passwort.'
  }
}

export const TRANSITION_NOTE = 'Ab Version 1.0.0-rc.1, der ersten Testversion von 1.0, verlangt Mietfuchs hier ein Passwort.'
export const ENV_FIXED_NOTE = 'Von der Umgebung festgelegt (NKA_AUTH)'
// Dieselbe Warnung an jeder Stelle, an der man ohne Passwort weitergeht oder die Anmeldung ausschaltet
export const WITHOUT_PASSWORD_WARNING = 'Ohne Passwort kann jedes Gerät in Ihrem Netz Ihre Daten sehen und ändern. Wählen Sie das nur in einem Netz, dem Sie vertrauen, nicht in einem öffentlichen WLAN.'
