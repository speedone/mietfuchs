// Die Seite „Verlauf“ (#318): was in Mietfuchs wann geändert wurde, je Aktion ein Eintrag, neueste zuerst. Aufgeklappt
// stehen die geänderten Felder mit den Feldnamen der Oberfläche (journalView.ts). Seit Schritt 4 mit Filtern und dem
// Rücksprung: „Rückgängig …“ am obersten Eintrag, an jedem anderen „Diese und alle späteren Änderungen zurücknehmen …“
// und „Nur die späteren Änderungen zurücknehmen …“, jeweils mit Vorschau in einer Rückfrage (journalRevert.ts).
import { useEffect, useRef, useState } from 'react'
import { api, ApiError, errorText } from '../api'
import Card from '../components/Card'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import { NoticeBox } from '../components/Notice'
import { useConfirm, useToast } from '../components/feedback'
import { useOptionalProperty } from '../property'
import {
  changeTitle, changesText, fieldLines, journalWhen, type JournalDetail, type JournalGroup,
} from '../journalView'
import {
  EMPTY_FILTER, filterActive, journalQuery, KIND_OPTIONS, revertActions, revertedMessage, revertQuestion,
  type JournalFilter, type JournalKind, type RevertMode, type RevertPreview,
} from '../journalRevert'

const PAGE = 50

const BARRIER_NOTE = 'Über diese Stelle führt kein Rücksprung, denn der Stand davor steht nicht in dieser Datenbank.'

function GroupDetails({ group, newest, onRevert }: {
  group: JournalGroup
  newest: boolean
  onRevert: (group: JournalGroup, mode: RevertMode) => Promise<string[]>
}) {
  const [detail, setDetail] = useState<JournalDetail | null>(null)
  const [error, setError] = useState('')
  const [refusals, setRefusals] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  // Einmal je Gruppe: Das Ereignis `toggle` kann für dasselbe Aufklappen zweimal kommen.
  const asked = useRef(false)
  const load = () => {
    if (asked.current) return
    asked.current = true
    api<JournalDetail>(`/api/journal/${group.id}`).then(setDetail, (e: unknown) => { asked.current = false; setError(errorText(e)) })
  }
  const actions = revertActions(group, newest)
  const start = async (mode: RevertMode) => {
    if (busy) return
    setBusy(true)
    setRefusals([])
    try {
      setRefusals(await onRevert(group, mode))
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="border-b border-line py-2" onToggle={(e) => { if (e.currentTarget.open) load() }}>
      <summary>
        <span className="muted">{journalWhen(group.at)}</span>{' · '}
        <strong>{group.title}</strong>{' '}
        {group.barrier === null && <span className="muted">({changesText(group.rows)})</span>}
        {group.revertedBy !== null && <span className="muted"> · zurückgenommen</span>}
      </summary>
      {group.barrier !== null && <p className="muted">{BARRIER_NOTE}</p>}
      {group.barrier === null && group.readOnly && (
        <p className="muted">
          Dieser Eintrag lässt sich nur lesen: Er stammt von vor dem letzten Update von Mietfuchs oder vor dem Einspielen
          einer Sicherung. Den Stand davor enthält die Sicherung, die Mietfuchs dabei im Datenordner angelegt hat.
        </p>
      )}
      {actions.length > 0 && (
        <div className="row">
          {newest ? (
            <button className="btn ghost danger-ghost ml-auto" disabled={busy} onClick={() => void start('including')}>Rückgängig …</button>
          ) : (
            <>
              <button className="btn ghost danger-ghost ml-auto" disabled={busy} onClick={() => void start('including')}>Diese und alle späteren Änderungen zurücknehmen …</button>
              <button className="btn ghost danger-ghost" disabled={busy} onClick={() => void start('after')}>Nur die späteren Änderungen zurücknehmen …</button>
            </>
          )}
        </div>
      )}
      {refusals.length > 0 && (
        <NoticeBox level="warning" title="Dieser Rücksprung geht nicht">
          {refusals.map((r) => <p key={r}>{r}</p>)}
        </NoticeBox>
      )}
      {error && <NoticeBox level="error" title="Die Einzelheiten ließen sich nicht laden" action={error} />}
      {group.barrier === null && !detail && !error && <p className="muted">Wird geladen …</p>}
      {detail && (
        <ul className="mt-1 mb-0 pl-5">
          {detail.changes.map((change) => {
            const lines = fieldLines(change)
            return (
              <li key={change.id}>
                {changeTitle(change)}
                {lines.length > 0 && (
                  <dl className="m-0 grid grid-cols-1 gap-1 pl-6">
                    {lines.map((line) => (
                      <div key={line.column} className="flex min-w-0 flex-wrap gap-2">
                        <dt className="muted">{line.label}:</dt>
                        <dd className="m-0 min-w-0 break-words">
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

function Filters({ filter, onChange, propertyName }: { filter: JournalFilter, onChange: (f: JournalFilter) => void, propertyName: string | null }) {
  // Der Suchtext gilt nach einer kurzen Pause, nicht bei jedem Tastendruck.
  const [q, setQ] = useState(filter.q)
  useEffect(() => {
    if (q === filter.q) return
    const timer = setTimeout(() => onChange({ ...filter, q }), 300)
    return () => clearTimeout(timer)
  }, [q, filter, onChange])
  return (
    <div className="field-grid" role="search" aria-label="Verlauf filtern">
      {propertyName !== null && (
        <Field label="Objekt">
          <select value={filter.scope} onChange={(e) => onChange({ ...filter, scope: e.target.value === 'all' ? 'all' : 'property' })}>
            <option value="property">Nur gewähltes Objekt</option>
            <option value="all">Alle Objekte</option>
          </select>
        </Field>
      )}
      <Field label="Bereich">
        <select value={filter.kind} onChange={(e) => onChange({ ...filter, kind: (KIND_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '') as JournalKind | '' })}>
          {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Von" width="s">
        <input type="date" value={filter.from} onChange={(e) => onChange({ ...filter, from: e.target.value })} />
      </Field>
      <Field label="Bis" width="s">
        <input type="date" value={filter.to} onChange={(e) => onChange({ ...filter, to: e.target.value })} />
      </Field>
      <Field label="Suche" width="m" hint="Name, Beschreibung oder Satz">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </Field>
    </div>
  )
}

export default function Verlauf() {
  const propertyCtx = useOptionalProperty()
  const propertyId = propertyCtx?.property?.id ?? null
  const confirm = useConfirm()
  const toast = useToast()
  const [filter, setFilter] = useState<JournalFilter>(EMPTY_FILTER)
  const [groups, setGroups] = useState<JournalGroup[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [reloads, setReloads] = useState(0)
  // Jeder Objektwechsel und jeder Filter beginnt eine neue Liste; eine Antwort zur vorigen gilt dann nicht mehr (K4).
  const generation = useRef(0)
  const busy = useRef(false)

  const fetchPage = (before: number | null) => api<JournalGroup[]>(journalQuery(filter, propertyId, before, PAGE))
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
    // fetchPage hängt nur an filter und propertyId.
  }, [propertyId, filter, reloads])

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

  // Vorschau, Rückfrage, Rücksprung. Liefert die Sätze, warum es nicht geht (leer, wenn es ging oder abgebrochen wurde).
  const onRevert = async (group: JournalGroup, mode: RevertMode): Promise<string[]> => {
    let preview: RevertPreview
    try {
      preview = await api<RevertPreview>(`/api/journal/${group.id}/revert/preview`, { method: 'POST', body: JSON.stringify({ mode }) })
    } catch (e) {
      toast(errorText(e), 'error')
      return []
    }
    if (preview.refusals.length > 0) return preview.refusals
    const question = revertQuestion(preview)
    const ok = await confirm({
      title: question.title,
      confirmLabel: question.confirmLabel,
      danger: true,
      message: (
        <>
          <p>{question.intro}</p>
          {question.entries.length > 0 && (
            <ul>
              {question.entries.map((e) => <li key={e}>{e}</li>)}
              {question.more > 0 && <li>und {question.more} weitere</li>}
            </ul>
          )}
          {question.notes.map((n) => <p key={n}>{n}</p>)}
        </>
      ),
    })
    if (!ok) return []
    try {
      await api(`/api/journal/${group.id}/revert`, { method: 'POST', body: JSON.stringify({ mode, token: preview.token }) })
      toast(revertedMessage(preview), 'ok')
      // Objekte und ihr Zeitraum können sich mit dem Rücksprung geändert haben.
      await propertyCtx?.reload()
      setReloads((n) => n + 1)
      return []
    } catch (e) {
      setReloads((n) => n + 1)
      const again = e instanceof ApiError ? (e.data.preview as RevertPreview | null | undefined) : undefined
      toast(errorText(e), 'error')
      return again?.refusals ?? []
    }
  }

  const unfiltered = !filterActive(filter)
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
        Die Sicherungen, die Mietfuchs vor einem Update und vor dem Einspielen eines Backups im Datenordner anlegt,
        enthalten ihn ohne diese Frist. Spielen Sie ein Backup ohne Verlauf ein, ersetzt es den Verlauf auf diesem
        Rechner; der bisherige steht dann nur noch in dieser Sicherung.
      </p>
      <p className="muted">
        Zurücknehmen geht immer vom neuesten Eintrag rückwärts: „Rückgängig“ nimmt die letzte Änderung zurück, an jedem
        älteren Eintrag kehren Sie zum Stand vor oder nach ihm zurück, und alles, was danach kam, wird mit zurückgenommen.
        Abschlüsse einer Abrechnung nimmt der Verlauf nicht zurück; dafür gibt es „Wieder öffnen“ auf der Seite
        Abrechnung. Gelöschte Belege liegen bis dahin im Papierkorb des Datenordners.
      </p>
      {error && <NoticeBox level="error" title="Der Verlauf ließ sich nicht laden" action={error} />}
      <Card title="Änderungen">
        <Filters filter={filter} onChange={setFilter} propertyName={propertyCtx?.property?.name ?? null} />
        {groups === null && !error && <p className="muted">Wird geladen …</p>}
        {groups && groups.length === 0 && (
          <p className="muted">
            {unfiltered ? 'Noch keine Änderungen. Sobald Sie etwas anlegen, ändern oder löschen, steht es hier.' : 'Keine Änderung passt zu diesem Filter.'}
          </p>
        )}
        {groups?.map((g) => <GroupDetails key={g.id} group={g} newest={g.newest} onRevert={onRevert} />)}
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
