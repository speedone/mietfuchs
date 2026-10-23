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

  const fetchPage = (before: number | null) => {
    const query = `/api/journal?limit=${PAGE}${before === null ? '' : `&before=${before}`}`
    return api<JournalGroup[]>(withProperty(query, propertyId))
  }
  useEffect(() => {
    setGroups(null)
    fetchPage(null).then((page) => { setGroups(page); setMore(page.length === PAGE) }, (e: unknown) => setError(errorText(e)))
  }, [propertyId])

  const loadMore = () => {
    const last = groups?.at(-1)
    if (!last) return
    fetchPage(last.id).then((page) => { setGroups((g) => [...(g ?? []), ...page]); setMore(page.length === PAGE) }, (e: unknown) => setError(errorText(e)))
  }

  return (
    <>
      <PageHeader
        context="property"
        title="Verlauf"
        subtitle="Was in Mietfuchs wann geändert wurde, neueste Änderung zuerst. Angezeigt werden die Änderungen dieses Objekts und die, die alle Objekte betreffen (etwa die Einstellungen). Mietfuchs bewahrt den Verlauf zwölf Monate auf."
      />
      {error && <NoticeBox level="error" title="Der Verlauf ließ sich nicht laden" action={error} />}
      <Card title="Änderungen">
        {groups === null && !error && <p className="muted">Wird geladen …</p>}
        {groups && groups.length === 0 && (
          <p className="muted">Noch keine Änderungen. Sobald Sie etwas anlegen, ändern oder löschen, steht es hier.</p>
        )}
        {groups?.map((g) => <GroupDetails key={g.id} group={g} />)}
        {more && (
          <div className="row">
            <button className="btn secondary" onClick={loadMore}>Ältere Änderungen laden</button>
          </div>
        )}
      </Card>
    </>
  )
}
