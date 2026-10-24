// Die Seite „Verlauf“ (#318): was in Mietfuchs wann geändert wurde, je Aktion ein Eintrag, neueste zuerst. Aufgeklappt
// stehen die geänderten Felder mit den Feldnamen der Oberfläche (journalView.ts). Seit Schritt 4 mit Filtern und dem
// Rücksprung: „Rückgängig …“ am obersten Eintrag, an jedem anderen „Diese und alle späteren Änderungen zurücknehmen …“
// und „Nur die späteren Änderungen zurücknehmen …“, jeweils mit Vorschau in einer Rückfrage (journalRevert.ts).
// Dazwischen die **Sicherungspunkte** (ganze Kopien der Daten im Datenordner: wöchentlich, vor einem Update, vor dem
// Einspielen) als eigene, ruhige Zeilen mit „Zu diesem Stand zurückkehren …“. Geht ein Rücksprung Schritt für Schritt
// nicht, aber liegt der Stand als Sicherung vor, nimmt der Server sie, und die Rückfrage sagt das. Nach dem Einspielen
// einer Sicherung lädt die Seite immer neu.
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
  dropRestoreNotes, EMPTY_FILTER, fileSize, filterActive, isSnapshot, journalQuery, keepRestoreNotes, KIND_OPTIONS, readRestoreNotes,
  revertActions, revertedMessage, revertQuestion, snapshotQuestion, snapshotWhen,
  type JournalFilter, type JournalItem, type JournalKind, type RevertMode, type RevertPreview, type SnapshotPoint, type SnapshotPreview,
} from '../journalRevert'

const PAGE = 50

const BARRIER_NOTE = 'Über diese Stelle führt Schritt für Schritt kein Rücksprung, denn der Stand davor steht nicht in diesem Verlauf. Er steht als Sicherung in der Zeitachse.'

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
          Schritt für Schritt lässt sich dieser Eintrag nicht zurücknehmen: Er stammt von vor dem letzten Update von
          Mietfuchs oder vor dem Einspielen einer Sicherung. Liegt der Stand als Sicherung vor, nimmt die Vorschau sie.
        </p>
      )}
      {actions.length > 0 && (
        <div className="row">
          {actions.length === 1 ? (
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

// Eine Sicherung in der Zeitachse: kein aufklappbarer Eintrag, sondern eine ruhige Zeile mit Symbol, Titel, Zeitpunkt
// und Größe, dazu der Weg zurück.
function SnapshotRow({ point, onReturn }: { point: SnapshotPoint, onReturn: (point: SnapshotPoint) => Promise<string[]> }) {
  const [refusals, setRefusals] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const id = `sicherung-${point.name}`
  const start = async () => {
    if (busy) return
    setBusy(true)
    setRefusals([])
    try {
      setRefusals(await onReturn(point))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-snapshot={point.type} className="border-b border-line bg-chip px-2 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span id={id} className="min-w-0">
          <span aria-hidden="true">💾 </span>
          <span className="muted">{snapshotWhen(point)}</span>{' · '}
          <strong>{point.title}</strong>{' '}
          <span className="muted">·</span> <span className="muted">{fileSize(point.size)}</span>
        </span>
        {/* Welcher Stand, sagt die Zeile (für Vorleser über aria-describedby). */}
        <button className="btn ghost danger-ghost ml-auto" disabled={busy} aria-describedby={id} onClick={() => void start()}>
          Zu diesem Stand zurückkehren …
        </button>
      </div>
      {refusals.length > 0 && (
        <NoticeBox level="warning" title="Diese Sicherung lässt sich nicht einspielen">
          {refusals.map((r) => <p key={r}>{r}</p>)}
        </NoticeBox>
      )}
    </div>
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

export default function Verlauf({ reloadPage = () => window.location.reload() }: { reloadPage?: () => void } = {}) {
  const propertyCtx = useOptionalProperty()
  const propertyId = propertyCtx?.property?.id ?? null
  const confirm = useConfirm()
  const toast = useToast()
  const [filter, setFilter] = useState<JournalFilter>(EMPTY_FILTER)
  const [items, setItems] = useState<JournalItem[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [reloads, setReloads] = useState(0)
  // Die Hinweise nach dem Einspielen einer Sicherung, einmal nach dem Neuladen.
  const [restored] = useState(readRestoreNotes)
  const [restoring, setRestoring] = useState(false)
  useEffect(dropRestoreNotes, [])
  // Jeder Objektwechsel und jeder Filter beginnt eine neue Liste; eine Antwort zur vorigen gilt dann nicht mehr (K4).
  const generation = useRef(0)
  const busy = useRef(false)

  // Geblättert wird ab der ältesten Gruppe; eine Seite ist voll, wenn sie so viele Gruppen trägt wie verlangt.
  const groupsOf = (list: JournalItem[]) => list.filter((i): i is JournalGroup => !isSnapshot(i))
  const fetchPage = (before: number | null) => api<JournalItem[]>(journalQuery(filter, propertyId, before, PAGE))
  useEffect(() => {
    const mine = ++generation.current
    busy.current = false
    setLoading(false)
    setItems(null)
    setError('')
    fetchPage(null).then(
      (page) => { if (mine === generation.current) { setItems(page); setMore(groupsOf(page).length === PAGE) } },
      (e: unknown) => { if (mine === generation.current) setError(errorText(e)) },
    )
    // fetchPage hängt nur an filter und propertyId.
  }, [propertyId, filter, reloads])

  // Ein zweiter Klick, solange die Seite lädt, holt nicht dieselbe Seite noch einmal (K4).
  const loadMore = () => {
    const last = groupsOf(items ?? []).at(-1)
    if (!last || busy.current) return
    busy.current = true
    setLoading(true)
    const mine = generation.current
    const done = () => { if (mine === generation.current) { busy.current = false; setLoading(false) } }
    fetchPage(last.id).then(
      (page) => { if (mine === generation.current) { setItems((g) => [...(g ?? []), ...page]); setMore(groupsOf(page).length === PAGE) }; done() },
      (e: unknown) => { if (mine === generation.current) setError(errorText(e)); done() },
    )
  }

  // Rückfrage und Einspielen einer Sicherung; danach immer neu laden. Liefert die Sätze, warum es nicht geht.
  const restoreSnapshot = async (preview: SnapshotPreview): Promise<string[]> => {
    if (preview.refusals.length > 0) return preview.refusals
    const question = snapshotQuestion(preview)
    const ok = await confirm({
      title: question.title,
      confirmLabel: question.confirmLabel,
      danger: true,
      message: <>{question.lines.map((l) => <p key={l}>{l}</p>)}</>,
    })
    if (!ok) return []
    setRestoring(true)
    try {
      const answer = await api<{ notes?: string[] }>(`/api/prior-versions/${encodeURIComponent(preview.snapshot.name)}/restore`, {
        method: 'POST', body: JSON.stringify({ token: preview.token }),
      })
      const notes = answer?.notes ?? []
      keepRestoreNotes(`Zum Stand „${preview.snapshot.title}“ vom ${snapshotWhen(preview.snapshot)} zurückgekehrt.${notes.length > 0 ? ` ${notes.join(' ')}` : ''}`)
      reloadPage()
      return []
    } catch (e) {
      setRestoring(false)
      toast(errorText(e), 'error')
      const again = e instanceof ApiError ? (e.data.preview as SnapshotPreview | null | undefined) : undefined
      return again?.refusals ?? []
    }
  }

  const onSnapshot = async (point: SnapshotPoint): Promise<string[]> => {
    let preview: SnapshotPreview
    try {
      preview = await api<SnapshotPreview>(`/api/prior-versions/${encodeURIComponent(point.name)}/restore/preview`, { method: 'POST', body: JSON.stringify({}) })
    } catch (e) {
      toast(errorText(e), 'error')
      return []
    }
    return restoreSnapshot(preview)
  }

  // Vorschau, Rückfrage, Rücksprung. Liefert die Sätze, warum es nicht geht (leer, wenn es ging oder abgebrochen wurde).
  // Die Vorschau kann den Weg über eine Sicherung nehmen (`kind: 'snapshot'`).
  const onRevert = async (group: JournalGroup, mode: RevertMode): Promise<string[]> => {
    let preview: RevertPreview | SnapshotPreview
    try {
      preview = await api<RevertPreview | SnapshotPreview>(`/api/journal/${group.id}/revert/preview`, { method: 'POST', body: JSON.stringify({ mode }) })
    } catch (e) {
      toast(errorText(e), 'error')
      return []
    }
    if (preview.kind === 'snapshot') return restoreSnapshot(preview)
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
        subtitle="Was in Mietfuchs wann geändert wurde, neueste Änderung zuerst, dazwischen die Sicherungen Ihrer Daten. Angezeigt werden die Änderungen dieses Objekts und die, die alle Objekte betreffen (etwa die Einstellungen oder ein gelöschtes Objekt)."
      />
      {/* Kurz, die Einzelheiten eingeklappt (Durchsicht von PR #442). */}
      <p className="muted">
        Der Verlauf zeigt auch Angaben, die Sie gelöscht haben, etwa Name und IBAN früherer Mieter. Jeder, der Mietfuchs
        auf diesem Rechner öffnet, kann sie sehen. Einträge verfallen nach zwölf Monaten.
      </p>
      <p className="muted">
        Mit „Rückgängig“ nehmen Sie die letzte Änderung zurück. An älteren Einträgen und an jeder Sicherung (💾) kehren
        Sie zu einem früheren Stand zurück; alles, was danach kam, wird ersetzt. Vorher zeigt Mietfuchs, was sich ändert,
        und bewahrt Ihre aktuellen Daten: Ein Rücksprung steht selbst im Verlauf, und vor dem Einspielen einer Sicherung
        sichert Mietfuchs den bisherigen Stand.
      </p>
      <p className="muted">Die Sicherungen liegen auf diesem Rechner und ersetzen kein Backup.</p>
      <details className="muted">
        <summary>Mehr dazu</summary>
        <p>
          Sicherungen sind ganze Kopien Ihrer Daten im Datenordner: einmal in der Woche (die letzten vier), vor jedem
          Update und vor dem Einspielen eines Backups oder einer Sicherung (je die letzten drei und alle aus zwölf
          Monaten). Sie enthalten den Verlauf, ein Backup nur auf Ihren Wunsch. Spielen Sie ein Backup ohne Verlauf ein,
          ersetzt es den Verlauf auf diesem Rechner; der bisherige steht dann nur noch in der Sicherung „Vor dem
          Einspielen eines Backups“.
        </p>
        <p>
          Abschlüsse einer Abrechnung nimmt der Verlauf nicht Schritt für Schritt zurück; dafür gibt es „Wieder öffnen“
          auf der Seite Abrechnung. Kehren Sie zu einer Sicherung von vor einem Abschluss zurück, gilt danach ihr Stand,
          und die Vorschau nennt die betroffenen Abrechnungen.
        </p>
        <p>Gelöschte Belege liegen im Papierkorb des Datenordners, solange der Verlauf sie nennt.</p>
      </details>
      {restored && <div className="ok" role="status">{restored}</div>}
      {restoring && <div className="ok" role="status">Die Sicherung wird eingespielt, danach lädt die Seite neu …</div>}
      {error && <NoticeBox level="error" title="Der Verlauf ließ sich nicht laden" action={error} />}
      <Card title="Änderungen und Sicherungen">
        <Filters filter={filter} onChange={setFilter} propertyName={propertyCtx?.property?.name ?? null} />
        {items === null && !error && <p className="muted">Wird geladen …</p>}
        {items && items.length === 0 && (
          <p className="muted">
            {unfiltered ? 'Noch keine Änderungen. Sobald Sie etwas anlegen, ändern oder löschen, steht es hier.' : 'Keine Änderung passt zu diesem Filter.'}
          </p>
        )}
        {items?.map((item) => (isSnapshot(item)
          ? <SnapshotRow key={`s:${item.name}`} point={item} onReturn={onSnapshot} />
          : <GroupDetails key={item.id} group={item} newest={item.newest} onRevert={onRevert} />))}
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
