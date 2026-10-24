// Die Seite „Verlauf“ (#318, Schritt 3): was in Mietfuchs wann geändert wurde, je Anfrage eine Zeile, neueste
// zuerst. Aufgeklappt stehen die geänderten Felder mit den Feldnamen der Oberfläche (journalView.ts). Nur
// Anzeige: Rückgängig kommt mit Schritt 4.
import { useEffect, useRef, useState } from 'react'
import { api, errorText } from '../api'
import Card from '../components/Card'
import PageHeader from '../components/PageHeader'
import { NoticeBox } from '../components/Notice'
import { useOptionalProperty, withProperty } from '../property'
import {
  changeTitle, changesText, fieldLines, journalWhen, type JournalDetail, type JournalGroup,
} from '../journalView'

const PAGE = 50

function GroupDetails({ group }: { group: JournalGroup }) {
  const [detail, setDetail] = useState<JournalDetail | null>(null)
  const [error, setError] = useState('')
  // Einmal je Gruppe: Das Ereignis `toggle` kann für dasselbe Aufklappen zweimal kommen.
  const asked = useRef(false)
  const load = () => {
    if (asked.current) return
    asked.current = true
    api<JournalDetail>(`/api/journal/${group.id}`).then(setDetail, (e: unknown) => { asked.current = false; setError(errorText(e)) })
  }
  return (
    <details className="border-b border-line py-2" onToggle={(e) => { if (e.currentTarget.open) load() }}>
      <summary>
        <span className="muted">{journalWhen(group.at)}</span>{' · '}
        <strong>{group.title}</strong>{' '}
        <span className="muted">({changesText(group.rows)})</span>
      </summary>
      {error && <NoticeBox level="error" title="Die Einzelheiten ließen sich nicht laden" action={error} />}
      {!detail && !error && <p className="muted">Wird geladen …</p>}
      {detail && (
        <ul className="mt-1 mb-0 pl-5">
          {detail.changes.map((change) => {
            const lines = fieldLines(change)
            return (
              <li key={change.id}>
                {changeTitle(change)}
                {lines.length > 0 && (
                  <dl className="m-0 grid gap-1 pl-6">
                    {lines.map((line) => (
                      <div key={line.column} className="flex flex-wrap gap-2">
                        <dt className="muted">{line.label}:</dt>
                        <dd className="m-0">
                          {change.op === 'update' ? <>{line.before} → {line.after}</> : (line.after ?? line.before)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </details>
  )
}

export default function Verlauf() {
  const propertyId = useOptionalProperty()?.property?.id ?? null
  const [groups, setGroups] = useState<JournalGroup[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Jeder Objektwechsel beginnt eine neue Liste; eine Antwort zur vorigen gilt dann nicht mehr (K4).
  const generation = useRef(0)
  const busy = useRef(false)

  const fetchPage = (before: number | null) => {
    const query = `/api/journal?limit=${PAGE}${before === null ? '' : `&before=${before}`}`
    return api<JournalGroup[]>(withProperty(query, propertyId))
  }
  useEffect(() => {
    const mine = ++generation.current
    busy.current = false
    setLoading(false)
    setGroups(null)
    setError('')
    fetchPage(null).then(
      (page) => { if (mine === generation.current) { setGroups(page); setMore(page.length === PAGE) } },
      (e: unknown) => { if (mine === generation.current) setError(errorText(e)) },
    )
  }, [propertyId])

  // Ein zweiter Klick, solange die Seite lädt, holt nicht dieselbe Seite noch einmal (K4).
  const loadMore = () => {
    const last = groups?.at(-1)
    if (!last || busy.current) return
    busy.current = true
    setLoading(true)
    const mine = generation.current
    const done = () => { if (mine === generation.current) { busy.current = false; setLoading(false) } }
    fetchPage(last.id).then(
      (page) => { if (mine === generation.current) { setGroups((g) => [...(g ?? []), ...page]); setMore(page.length === PAGE) }; done() },
      (e: unknown) => { if (mine === generation.current) setError(errorText(e)); done() },
    )
  }

  return (
    <>
      <PageHeader
        context="property"
        title="Verlauf"
        subtitle="Was in Mietfuchs wann geändert wurde, neueste Änderung zuerst. Angezeigt werden die Änderungen dieses Objekts und die, die alle Objekte betreffen (etwa die Einstellungen oder ein gelöschtes Objekt)."
      />
      <p className="muted">
        Der Verlauf zeigt auch Angaben, die Sie inzwischen gelöscht haben, etwa Name, Anschrift und IBAN früherer
        Mieter. Jeder, der Mietfuchs auf diesem Rechner öffnen kann, sieht ihn. Einträge verfallen nach zwölf
        Monaten; die automatischen Vorversionen enthalten den Verlauf ebenfalls, ein Backup nur auf Ihren Wunsch.
      </p>
      {error && <NoticeBox level="error" title="Der Verlauf ließ sich nicht laden" action={error} />}
      <Card title="Änderungen">
        {groups === null && !error && <p className="muted">Wird geladen …</p>}
        {groups && groups.length === 0 && (
          <p className="muted">Noch keine Änderungen. Sobald Sie etwas anlegen, ändern oder löschen, steht es hier.</p>
        )}
        {groups?.map((g) => <GroupDetails key={g.id} group={g} />)}
        {more && (
          <div className="row">
            <button className="btn secondary" disabled={loading} onClick={loadMore}>
              {loading && <span className="spinner" />}Ältere Änderungen laden
            </button>
          </div>
        )}
      </Card>
    </>
  )
}
