import { useCallback, useEffect, useId, useState } from 'react'
import { api, ApiError, errorText } from '../api'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import { NoticeBox } from '../components/Notice'
import { useConfirm } from '../components/feedback'
import { MOBILE_QUERY, useMediaQuery } from '../components/MobileNav'
import {
  adoptedText, candidateFacts, candidateProblem, folderBridge, progressText, rankCandidates, reloadWithArrival,
  type AdoptProgress, type AdoptResult, type Arrival, type RankedCandidate, type RelocationCandidate, type RelocationCandidates,
} from '../relocation'

// Erster Start im Programmfenster (#517), genau einmal bei leerem Bestand: gefunden („Wir haben Ihre bisherigen
// Mietfuchs-Daten gefunden“, Hauptknopf „Daten übernehmen“, klein „Nicht übernehmen, neu beginnen“ mit Rückfrage) oder
// nicht („Willkommen bei Mietfuchs. Haben Sie Mietfuchs schon einmal benutzt?“, „Nein, neu beginnen“ ohne Rückfrage,
// „Ja, Daten übernehmen“ zeigt Backup, Ordnerwahl und neue Suche). Von Hand aus den Einstellungen (`manual`) dieselben
// Wege mit „Zurück“. Die Entscheidungen stehen in relocation.ts, der Ablauf im Server (index.ts, „Umzug ins
// Programmfenster“). Übernehmen heißt kopieren; der alte Ordner bleibt, wie er ist, und bekommt nur einen Vermerk.

type Phase =
  | { kind: 'idle' }
  | { kind: 'busy', what: 'copy' | 'backup' | 'quit' | 'folder' | 'search' }
  | { kind: 'done', arrival: Arrival, text: string, notes: string[] }

const post = <T,>(url: string, body: unknown = {}) => api<T>(url, { method: 'POST', body: JSON.stringify(body) })

// Ein Abbruch ist kein Fehler (Praxistest K-05)
const CANCELLED_TEXT = 'Abgebrochen. Es wurde nichts übernommen; im alten Ordner ist alles unverändert.'
// Mit eigenem Bestand (von Hand) sagt das Ergebnis, dass der Stand vorher gesichert ist (Praxistest P)
const REPLACED_NOTE = 'Ihr bisheriger Stand hier ist gesichert; er steht im Verlauf als „Vor dem Einspielen eines Backups“.'

export default function Umzug({ manual = false, onFresh, onClose, reloadPage = reloadWithArrival, chooseFolder = folderBridge() }: {
  // Von Hand aus den Einstellungen geöffnet statt beim ersten Start; dann „Zurück“ statt „neu beginnen“, und mit eigenem
  // Bestand fragt jede Übernahme vorher, ob sie ihn ersetzen darf
  manual?: boolean
  // Beim ersten Start: „neu beginnen“ ist gespeichert, das Cockpit statt dieses Bildschirms
  onFresh?: () => void
  // Von Hand: zurück zur vorigen Seite
  onClose?: () => void
  // Neu laden, mit dem Anlass für die Bestätigung danach (relocation.ts, „Ankunft“)
  reloadPage?: (arrival: Arrival) => void
  chooseFolder?: (() => Promise<string | null>) | null
}) {
  const confirm = useConfirm()
  const mobile = useMediaQuery(MOBILE_QUERY)
  const [list, setList] = useState<RelocationCandidates | null>(null)
  const [loadError, setLoadError] = useState('')
  const [chosen, setChosen] = useState<RelocationCandidate | null>(null)
  const [error, setError] = useState('')
  // Neutral statt rot: Abbruch, beendetes altes Mietfuchs, Ergebnis einer neuen Suche
  const [info, setInfo] = useState('')
  const [quitFailed, setQuitFailed] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  // Die Wege ohne Fund (Backup, Ordner wählen); beim ersten Start nach „Ja, Daten übernehmen“
  const [importWays, setImportWays] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [progress, setProgress] = useState<AdoptProgress | null>(null)
  const busy = phase.kind === 'busy'
  const copying = phase.kind === 'busy' && phase.what === 'copy'
  // Fortschritt beim Kopieren, alle halbe Sekunde gefragt (Ergänzung 4)
  useEffect(() => {
    if (!copying) {
      setProgress(null)
      return
    }
    let stopped = false
    const ask = () => {
      api<AdoptProgress>('/api/relocation/progress').then((p) => { if (!stopped) setProgress(p) }).catch(() => {})
    }
    ask()
    const timer = setInterval(ask, 500)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [copying])

  // `fresh`: „Erneut suchen“ sucht wirklich neu, statt der eine Minute gemerkten Funde (Praxistest G)
  const load = useCallback(async (fresh = false): Promise<RelocationCandidates | null> => {
    try {
      const answer = await api<RelocationCandidates>(`/api/relocation/candidates${fresh ? '?fresh=1' : ''}`)
      setList(answer)
      setLoadError('')
      return answer
    } catch (e) {
      setLoadError(errorText(e))
      return null
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const found = list?.candidates ?? []
  const candidates = chosen ? [chosen, ...found.filter((c) => c.id !== chosen.id)] : found
  const ownStock = list?.ownStock === true

  // Ob ein Fund noch vom alten Mietfuchs benutzt wird, fragt der Server bei jedem Laden neu
  const refresh = async () => {
    await load()
    if (chosen) {
      try {
        setChosen((await post<{ candidate: RelocationCandidate }>('/api/relocation/inspect', { id: chosen.id })).candidate)
      } catch { /* bleibt, wie er war */ }
    }
  }

  // Mit eigenem Bestand (von Hand aus den Einstellungen) ersetzt jede Übernahme ihn: deutlich fragen, gesichert wird vorher
  async function mayReplace(): Promise<boolean> {
    if (!ownStock) return true
    return confirm({
      title: 'Ihre jetzigen Daten ersetzen?',
      message: 'Hier liegen schon Daten. Die Übernahme ersetzt sie vollständig durch die bisherigen. Mietfuchs sichert den Stand von jetzt ' +
        'vorher; er steht danach im Verlauf als „Vor dem Einspielen eines Backups“, und Sie können zu ihm zurückkehren.',
      confirmLabel: 'Ersetzen',
      danger: true,
    })
  }

  const clearMessages = () => {
    setError('')
    setInfo('')
  }

  async function adopt(c: RelocationCandidate) {
    if (!(await mayReplace())) return
    clearMessages()
    setPhase({ kind: 'busy', what: 'copy' })
    try {
      // Nur mit der Kennung, die der Server dem Fund gegeben hat, nie mit dem Pfad (server/src/CLAUDE.md, K11)
      const result = await post<AdoptResult>('/api/relocation/adopt', { id: c.id, ...(ownStock ? { replace: true } : {}) })
      const notes = [...result.notes, ...(ownStock ? [REPLACED_NOTE] : [])]
      setPhase({ kind: 'done', arrival: 'moved', text: result.counts ? adoptedText(result.counts) : 'Ihre Daten sind übernommen.', notes })
    } catch (e) {
      setPhase({ kind: 'idle' })
      if (e instanceof ApiError && e.data.cancelled === true) setInfo(CANCELLED_TEXT)
      else setError(errorText(e))
      if (e instanceof ApiError && e.data.running === true) await refresh()
    }
  }

  async function quitOld() {
    clearMessages()
    setQuitFailed(false)
    setPhase({ kind: 'busy', what: 'quit' })
    try {
      const { stopped } = await post<{ stopped: boolean }>('/api/relocation/quit-old')
      if (!stopped) setQuitFailed(true)
      // Praxistest C: Die Warnung verschwand nur; jetzt steht da, dass es beendet ist
      else setInfo('Das alte Mietfuchs ist beendet. Sie können die Daten jetzt übernehmen.')
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setPhase({ kind: 'idle' })
    }
  }

  // Eingespielt: ohne Hinweise gleich weiter (danach die Bestätigung oben, Praxistest E-04); mit Hinweisen bleiben sie
  // stehen, bis „Weiter“ geklickt ist
  const backupDone = (notes: string[]) => {
    if (notes.length === 0 && !ownStock) return reloadPage('backup')
    setPhase({ kind: 'done', arrival: 'backup', text: 'Ihr Backup ist eingespielt.', notes: [...notes, ...(ownStock ? [REPLACED_NOTE] : [])] })
  }

  async function restoreBackup(file: File) {
    if (!(await mayReplace())) return
    clearMessages()
    setPhase({ kind: 'busy', what: 'backup' })
    try {
      const fd = new FormData()
      fd.append('file', file)
      const answer = await api<{ notes?: string[] }>('/api/restore', { method: 'POST', body: fd })
      backupDone(answer?.notes ?? [])
    } catch (e) {
      setPhase({ kind: 'idle' })
      setError(errorText(e))
    }
  }

  async function pickFolder() {
    if (!chooseFolder) return
    clearMessages()
    let folder: string | null
    try {
      folder = await chooseFolder()
    } catch (e) {
      setError(errorText(e))
      return
    }
    if (!folder) return
    setPhase({ kind: 'busy', what: 'folder' })
    try {
      // Der Pfad des Dialogs geht nur hierhin; weiter geht es mit der Kennung aus der Antwort
      const answer = await post<{ candidate?: RelocationCandidate, backup?: { id: string, name: string } }>('/api/relocation/inspect', { folder })
      // Ein Backup statt eines Ordners gewählt: einspielen statt ablehnen
      if (answer.backup) {
        if (!(await mayReplace())) {
          setPhase({ kind: 'idle' })
          return
        }
        const restored = await post<{ notes?: string[] }>('/api/relocation/restore-backup', { id: answer.backup.id, ...(ownStock ? { replace: true } : {}) })
        backupDone(restored?.notes ?? [])
        return
      }
      if (answer.candidate) setChosen(answer.candidate)
      setImportWays(false)
      setPhase({ kind: 'idle' })
    } catch (e) {
      setError(errorText(e))
      setPhase({ kind: 'idle' })
    }
  }

  async function searchAgain() {
    clearMessages()
    setPhase({ kind: 'busy', what: 'search' })
    const answer = await load(true)
    setPhase({ kind: 'idle' })
    // Praxistest G: Sonst sah man nur kurz das Drehsymbol und denselben Text
    if (answer && (answer.candidates ?? []).length === 0) setInfo('Mietfuchs hat eben noch einmal gesucht und wieder keine Daten gefunden.')
    else if (answer) setImportWays(false)
  }

  async function startFresh(ask: boolean) {
    if (ask) {
      const ok = await confirm({
        title: 'Ohne Ihre bisherigen Daten beginnen?',
        message: 'Mietfuchs fragt danach nicht mehr. Übernehmen können Sie Ihre Daten später in den Einstellungen unter „Daten aus bisherigem Mietfuchs übernehmen …“.',
        confirmLabel: 'Neu beginnen',
      })
      if (!ok) return
    }
    try {
      await post('/api/relocation/decline')
      onFresh?.()
    } catch (e) {
      setError(errorText(e))
    }
  }

  if (phase.kind === 'done') {
    const moved = phase.arrival === 'moved'
    const doneArrival = phase.arrival
    return (
      <>
        <PageHeader title={moved ? 'Ihre Daten sind umgezogen' : 'Ihr Backup ist eingespielt'} context="none" />
        <div className="ok" role="status">
          <p>{phase.text}</p>
          {phase.notes.map((note) => <p key={note}>{note}</p>)}
        </div>
        {moved && <p>Ab jetzt arbeiten Sie nur noch hier. Öffnen Sie die alte Programmdatei nicht mehr. Was Sie dort ändern, fehlt hier.</p>}
        <p>
          Haben Sie Mietfuchs auch vom Handy oder einem zweiten Rechner aus benutzt? Schalten Sie dazu in den Einstellungen
          „Zugriff aus dem Heimnetz“ ein. Dort steht auch die neue Adresse.
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={() => reloadPage(doneArrival)}>Weiter</button>
        </div>
      </>
    )
  }

  const showFound = candidates.length > 0 && !importWays
  // Beim ersten Start ohne Fund zuerst die eine Frage
  const welcome = !manual && list !== null && candidates.length === 0 && !importWays
  const title = welcome ? 'Willkommen bei Mietfuchs'
    : showFound && !manual ? 'Wir haben Ihre bisherigen Mietfuchs-Daten gefunden'
      : manual ? 'Daten aus bisherigem Mietfuchs übernehmen' : 'Ihre bisherigen Daten übernehmen'
  const ranked = rankCandidates(candidates)
  return (
    <>
      <PageHeader title={title} context="none" />
      {loadError && <NoticeBox level="error" title="Die Suche ließ sich nicht starten" action={loadError} />}
      {error && <NoticeBox level="error" title="Nicht übernommen" action={error} />}
      {info && <p className="info" role="status">{info}</p>}
      {phase.kind === 'busy' && <p role="status"><span className="spinner" />{BUSY_TEXT[phase.what]}</p>}
      {copying && progress && progressText(progress) && (
        <div className="row">
          <span className="muted">{progressText(progress)}</span>
          {progress.phase !== 'switch' && (
            <button type="button" className="btn secondary small" onClick={() => { void post('/api/relocation/cancel').catch(() => {}) }}>Abbrechen</button>
          )}
        </div>
      )}
      {!list && !loadError && <p role="status"><span className="spinner" />Mietfuchs sucht Ihre bisherigen Daten …</p>}
      {welcome && (
        <>
          <p>Haben Sie Mietfuchs schon einmal benutzt?</p>
          <div className="row">
            <button type="button" className="btn secondary" disabled={busy} onClick={() => void startFresh(false)}>Nein, neu beginnen</button>
            <button type="button" className="btn secondary" disabled={busy} onClick={() => setImportWays(true)}>Ja, Daten übernehmen</button>
          </div>
        </>
      )}
      {list && showFound && (
        <>
          <p>Mietfuchs kopiert sie in das neue Programm; im alten Ordner bleibt alles, wie es ist.</p>
          {ranked.length > 1 && <p>Meist ist der neueste Stand der richtige.</p>}
          {ranked.map((r) => (
            <CandidateCard key={r.candidate.id} ranked={r} store={list.store === true} busy={busy} quitFailed={quitFailed}
              onAdopt={() => void adopt(r.candidate)} onQuit={() => void quitOld()} onCheck={() => void refresh()} onBackup={() => { clearMessages(); setImportWays(true) }} />
          ))}
          <div className="row">
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => { clearMessages(); setImportWays(true) }}>Andere Daten wählen …</button>
            {manual
              ? <button type="button" className="btn ghost small" disabled={busy} onClick={onClose}>Zurück</button>
              : <button type="button" className="btn ghost small" disabled={busy} onClick={() => void startFresh(true)}>Nicht übernehmen, neu beginnen</button>}
          </div>
        </>
      )}
      {(list || loadError) && !showFound && !welcome && (
        <>
          {/* Steht eine Absage oder das Ergebnis der neuen Suche da, nicht noch eine zweite (Praxistest G) */}
          {candidates.length === 0 && !error && !info && (
            <p>
              Mietfuchs hat auf diesem Rechner keine Daten Ihres bisherigen Mietfuchs gefunden.
              {list?.complete === false && ' Die Suche hat nicht alle Ordner durchgesehen.'}
            </p>
          )}
          <Card title="Mit einem Backup übernehmen">
            {/* Am Handy zieht niemand eine Datei herüber (Praxistest E-02-390) */}
            <p>
              Öffnen Sie Ihr bisheriges Mietfuchs noch einmal und klicken Sie in den Einstellungen auf{' '}
              <strong>Backup herunterladen (ZIP)</strong>.{' '}
              {mobile ? <>Klicken Sie dann hier auf <strong>Backup einspielen</strong>.</> : <>Ziehen Sie die Datei dann hierher oder klicken Sie auf <strong>Backup einspielen</strong>.</>}
            </p>
            <div
              className={`dropzone ${dragOver ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                const file = e.dataTransfer.files[0]
                if (file && !busy) void restoreBackup(file)
              }}
            >
              {!mobile && <p><strong>Backup hierher ziehen</strong> (eine ZIP-Datei)</p>}
              <label className="btn">
                Backup einspielen
                <input
                  type="file"
                  accept=".zip,application/zip"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restoreBackup(f) }}
                />
              </label>
            </div>
          </Card>
          {/* Klein darunter, in einer Reihe mit Abstand (Praxistest E-02-390): die Wahl des Ordners (nur im Fenster mit
              Dialog), eine neue Suche und zurück */}
          <div className="row">
            {chooseFolder && (
              <button type="button" className="btn ghost small" disabled={busy} onClick={() => void pickFolder()}>Ordner der alten Programmdatei wählen …</button>
            )}
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => void searchAgain()}>Erneut suchen</button>
            {candidates.length > 0 && (
              <button type="button" className="btn ghost small" disabled={busy} onClick={() => { clearMessages(); setImportWays(false) }}>Zurück zu den gefundenen Daten</button>
            )}
            {manual
              ? <button type="button" className="btn ghost small" disabled={busy} onClick={onClose}>Zurück</button>
              : candidates.length === 0 && <button type="button" className="btn ghost small" disabled={busy} onClick={() => { clearMessages(); setImportWays(false) }}>Zurück</button>}
          </div>
        </>
      )}
    </>
  )
}


const BUSY_TEXT: Record<'copy' | 'backup' | 'quit' | 'folder' | 'search', string> = {
  search: 'Mietfuchs sucht Ihre bisherigen Daten …',
  copy: 'Mietfuchs übernimmt Ihre Daten … Bei vielen Belegen dauert das einige Minuten. Bitte schließen Sie Mietfuchs währenddessen nicht. Ihre Daten im alten Ordner bleiben unberührt.',
  backup: 'Mietfuchs spielt Ihr Backup ein … Bei vielen Belegen dauert das einige Minuten. Bitte schließen Sie Mietfuchs währenddessen nicht.',
  quit: 'Das alte Mietfuchs wird beendet …',
  folder: 'Mietfuchs sieht im gewählten Ordner nach …',
}

const CARD_TITLES: Record<RankedCandidate['role'], string> = { only: 'Gefundene Daten', newest: 'Neuester Stand', older: 'Älterer Stand' }

function CandidateCard({ ranked, store, busy, quitFailed, onAdopt, onQuit, onCheck, onBackup }: {
  ranked: RankedCandidate
  store: boolean
  busy: boolean
  quitFailed: boolean
  onAdopt: () => void
  onQuit: () => void
  onCheck: () => void
  onBackup: () => void
}) {
  const { candidate, role } = ranked
  const facts = candidateFacts(candidate)
  const problem = candidateProblem(candidate, store)
  const reasonId = useId()
  const blocked = candidate.running || problem !== null
  return (
    <Card title={CARD_TITLES[role]} className={role === 'newest' ? 'border-2 border-accent' : undefined}>
      <p className="m-0">{facts.place}</p>
      {facts.names && <p className="m-0"><strong>{facts.names}</strong></p>}
      {facts.modified && <p className="m-0">{facts.modified}</p>}
      {facts.stock && <p className="m-0">{facts.stock}</p>}
      <details className="mt-2 text-xs text-muted wrap-anywhere">
        <summary className="cursor-pointer">Genauer Ort</summary>
        <span>{facts.path}</span>
      </details>
      {problem && (
        <div id={reasonId}>
          <NoticeBox level={problem.link ? 'warning' : 'error'} title={problem.title} action={problem.text} />
          {problem.link && <p><a href={problem.link.href} target="_blank" rel="noreferrer">{problem.link.label}</a></p>}
        </div>
      )}
      {!problem && candidate.running && (
        <div id={reasonId}>
          <NoticeBox
            level="warning"
            title="Das alte Mietfuchs ist noch geöffnet"
            action={quitFailed
              ? 'Es ließ sich nicht von hier beenden. Schließen Sie bitte das Fenster der alten Programmdatei (unter Windows ein schwarzes Fenster, auf dem Mac das Terminal) und klicken Sie dann auf „Erneut prüfen“. Hilft das nicht, starten Sie den Rechner neu.'
              : 'Beenden Sie es bitte zuerst, damit sich die Daten beim Kopieren nicht ändern.'}
          />
        </div>
      )}
      <div className="row">
        <button type="button" className={role === 'older' ? 'btn secondary' : 'btn'} disabled={busy || blocked} aria-describedby={blocked ? reasonId : undefined} onClick={onAdopt}>
          {role === 'older' ? 'Diesen älteren Stand übernehmen' : 'Daten übernehmen'}
        </button>
        {candidate.problem === 'damaged' && <button type="button" className="btn secondary" disabled={busy} onClick={onBackup}>Backup einspielen …</button>}
        {!problem && candidate.running && (quitFailed
          ? <button type="button" className="btn secondary" disabled={busy} onClick={onCheck}>Erneut prüfen</button>
          : <button type="button" className="btn secondary" disabled={busy} onClick={onQuit}>Altes Mietfuchs beenden</button>)}
      </div>
    </Card>
  )
}
