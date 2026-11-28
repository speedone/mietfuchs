// Die Karte „Beim Start“ (#735): womit sich Mietfuchs öffnet, ohne den Standardbrowser des Systems zu ändern. Nur, wo
// Mietfuchs beim Start selbst einen Browser öffnet (Programmdatei, Linux-Paket); dort liefert der Server
// `settings.browsers`, die auf diesem Rechner gefundenen Browser. Gespeichert wird nur deren Kennung. Ändern lässt sich
// die Wahl nur am Rechner selbst (`atThisComputer`); von einem anderen Gerät ist sie nur zu sehen.
// Vorrang beim Start (server/src/browser.ts): diese Wahl, dann die Umgebungsvariable BROWSER, dann der Standardbrowser.
import type { BrowserChoice, BrowserId, Settings } from '../types'
import { BROWSER_LABELS } from '../../../shared/browsers.ts'
import { api } from '../api'
import { useRef } from 'react'
import { useDraft } from '../useDraft'
import { ifUnchanged } from '../staleRecord'
import { BROWSER_KEYS, BROWSER_STALE_FIELDS, seenPart, settingsStaleText, staleCurrent } from '../settingsSeen'
import { useToast } from './feedback'
import Card from './Card'
import DraftActions from './DraftActions'
import Field from './Field'

type Option = { value: '' | BrowserId, label: string }

// Die Optionen des Auswahlfelds. Steht ein gewählter Browser nicht mehr unter den gefundenen, bleibt er als Option
// stehen, sonst zeigte das Feld den ersten Eintrag statt des Gespeicherten.
export function browserOptions(choice: BrowserChoice, stored: BrowserId | null): Option[] {
  const standard = choice.fromEnv ? 'Wie in der Umgebungsvariablen BROWSER angegeben' : 'Standardbrowser'
  const options: Option[] = [{ value: '', label: standard }, ...choice.found.map((b) => ({ value: b.id, label: b.label }))]
  if (stored && !choice.found.some((b) => b.id === stored)) options.push({ value: stored, label: `${BROWSER_LABELS[stored]} (nicht gefunden)` })
  return options
}

export default function BrowserCard({ settings, reload }: { settings: Settings, reload: () => Promise<void> }) {
  const choice = settings.browsers
  const stored = settings.openWith ?? null
  const options = choice ? browserOptions(choice, stored) : []
  const draft = useDraft<'' | BrowserId>(stored ?? '', { isValid: (value) => options.some((o) => o.value === value) })
  const toast = useToast()
  // Der Stand, auf dem der Entwurf steht, als `ifUnchanged` beim Speichern (settingsSeen.ts): Ein zweites Fenster
  // überschreibt die Wahl so nicht still. Gemerkt, solange kein Entwurf offen ist.
  const seen = useRef(seenPart(settings, BROWSER_KEYS))
  if (!draft.dirty) seen.current = seenPart(settings, BROWSER_KEYS)
  if (!choice) return null
  const missing = stored && !choice.found.some((b) => b.id === stored) ? BROWSER_LABELS[stored] : null
  const standard = choice.fromEnv ? 'so, wie die Umgebungsvariable BROWSER es angibt' : 'im Standardbrowser'
  return (
    <Card title="Beim Start">
      <p className="muted">
        Womit sich Mietfuchs öffnet, wenn Sie es starten. Der Standardbrowser Ihres Systems bleibt, wie er ist. Ein hier
        gewählter Browser gilt vor der Umgebungsvariablen BROWSER. Die Wahl gilt ab dem nächsten Start von Mietfuchs.
      </p>
      <div className="row">
        <Field label="Mietfuchs öffnen mit" width="l">
          <select value={draft.value} disabled={!choice.atThisComputer} onChange={(e) => draft.set(e.target.value as '' | BrowserId)}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
      </div>
      {!choice.atThisComputer && <p className="muted">Ändern können Sie das nur am Rechner, auf dem Mietfuchs läuft.</p>}
      {missing && <p className="muted">{`${missing} findet Mietfuchs auf diesem Rechner nicht mehr. Beim Start öffnet sich Mietfuchs deshalb ${standard}.`}</p>}
      {choice.found.length === 0 && (
        <p className="muted">Mietfuchs hat auf diesem Rechner keinen weiteren Browser gefunden (gesucht nach {Object.values(BROWSER_LABELS).join(', ')}).</p>
      )}
      <DraftActions
        draft={draft}
        layout="card"
        what="Mietfuchs öffnen mit"
        onSave={async (value) => {
          try {
            await api('/api/settings', { method: 'PUT', body: JSON.stringify({ openWith: value === '' ? null : value, ...ifUnchanged(seen.current) }) })
          } catch (e) {
            const refused = settingsStaleText(e, seen.current, BROWSER_STALE_FIELDS, 'Ihre Wahl steht weiter da; speichern Sie erneut, wenn sie gelten soll.')
            if (refused === null) throw e
            // Die eigene Wahl bleibt; der Stand von jetzt gilt als gesehen, erneutes Speichern ist bewusst
            const now = staleCurrent(e)
            if (now) seen.current = seenPart(now, BROWSER_KEYS)
            await reload().catch(() => { /* die Meldung steht gleich */ })
            throw new Error(refused)
          }
          await reload()
          toast('Gespeichert. Gilt ab dem nächsten Start von Mietfuchs.')
        }}
      />
    </Card>
  )
}
