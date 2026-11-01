import { useCallback, useEffect, useId, useState } from 'react'
import { api, ApiError, errorText } from '../api'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import { NoticeBox } from '../components/Notice'
import { useConfirm } from '../components/feedback'
import { adoptedText, candidateFacts, folderBridge, progressText, type AdoptProgress, type AdoptResult, type RelocationCandidate, type RelocationCandidates } from '../relocation'

// Erster Start im Programmfenster (#517), genau einmal bei leerem Bestand: gefunden („Wir haben Ihre bisherigen
// Mietfuchs-Daten gefunden“, Hauptknopf „Daten übernehmen“, klein „Nicht übernehmen, neu beginnen“ mit Rückfrage) oder
// nicht („Willkommen bei Mietfuchs. Haben Sie Mietfuchs schon einmal benutzt?“, „Nein, neu beginnen“ ohne Rückfrage,
// „Ja, Daten übernehmen“ zeigt Backup, Ordnerwahl und neue Suche). Von Hand aus den Einstellungen (`manual`) dieselben
// Wege mit „Zurück“. Die Entscheidungen stehen in relocation.ts, der Ablauf im Server (index.ts, „Umzug ins
// Programmfenster“). Übernehmen heißt kopieren; der alte Ordner bleibt, wie er ist, und bekommt nur einen Vermerk.

type Phase =
  | { kind: 'idle' }
  | { kind: 'busy', what: 'copy' | 'backup' | 'quit' | 'folder' | 'search' }
  | { kind: 'done', text: string, notes: string[] }

const post = <T,>(url: string, body: unknown = {}) => api<T>(url, { method: 'POST', body: JSON.stringify(body) })

export default function Umzug({ manual = false, onFresh, onClose, reloadPage = () => window.location.reload(), chooseFolder = folderBridge() }: {
  // Von Hand aus den Einstellungen geöffnet statt beim ersten Start; dann „Zurück“ statt „neu beginnen“, und mit eigenem
  // Bestand fragt jede Übernahme vorher, ob sie ihn ersetzen darf
  manual?: boolean
  // Beim ersten Start: „neu beginnen“ ist gespeichert, das Cockpit statt dieses Bildschirms
  onFresh?: () => void
  // Von Hand: zurück zur vorigen Seite
  onClose?: () => void
  reloadPage?: () => void
  chooseFolder?: (() => Promise<string | null>) | null
}) {
  const confirm = useConfirm()
  const [list, setList] = useState<RelocationCandidates | null>(null)
  const [loadError, setLoadError] = useState('')
  const [chosen, setChosen] = useState<RelocationCandidate | null>(null)
  const [error, setError] = useState('')
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

  const load = useCallback(async () => {
    try {
      setList(await api<RelocationCandidates>('/api/relocation/candidates'))
      setLoadError('')
    } catch (e) {
      setLoadError(errorText(e))
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const found = list?.candidates ?? []
  const candidates = chosen ? [chosen, ...found.filter((c) => c.dataDir !== chosen.dataDir)] : found
  const ownStock = list?.ownStock === true

  // Ob ein Fund noch vom alten Mietfuchs benutzt wird, fragt der Server bei jedem Laden neu
  const refresh = async () => {
    await load()
    if (chosen) {
      try {
        setChosen((await post<{ candidate: RelocationCandidate }>('/api/relocation/inspect', { folder: chosen.dataDir })).candidate)
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

  async function adopt(c: RelocationCandidate) {
    if (!(await mayReplace())) return
    setError('')
    setPhase({ kind: 'busy', what: 'copy' })
    try {
      const result = await post<AdoptResult>('/api/relocation/adopt', { dataDir: c.dataDir, ...(ownStock ? { replace: true } : {}) })
      setPhase({ kind: 'done', text: result.counts ? adoptedText(result.counts) : 'Ihre Daten sind übernommen.', notes: result.notes })
    } catch (e) {
      setPhase({ kind: 'idle' })
      setError(errorText(e))
      if (e instanceof ApiError && e.data.running === true) await refresh()
    }
  }

  async function quitOld() {
    setError('')
    setQuitFailed(false)
    setPhase({ kind: 'busy', what: 'quit' })
    try {
      const { stopped } = await post<{ stopped: boolean }>('/api/relocation/quit-old')
      if (!stopped) setQuitFailed(true)
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setPhase({ kind: 'idle' })
    }
  }

  async function restoreBackup(file: File) {
    if (!(await mayReplace())) return
    setError('')
    setPhase({ kind: 'busy', what: 'backup' })
    try {
      const fd = new FormData()
      fd.append('file', file)
      const answer = await api<{ notes?: string[] }>('/api/restore', { method: 'POST', body: fd })
      const notes = answer?.notes ?? []
      // Ohne Hinweise gleich weiter; mit Hinweisen bleiben sie stehen, bis „Weiter“ geklickt ist
      if (notes.length === 0) return reloadPage()
      setPhase({ kind: 'done', text: 'Ihr Backup ist eingespielt.', notes })
    } catch (e) {
      setPhase({ kind: 'idle' })
      setError(errorText(e))
    }
  }

  async function pickFolder() {
    if (!chooseFolder) return
    setError('')
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
      const answer = await post<{ candidate?: RelocationCandidate, backup?: string }>('/api/relocation/inspect', { folder })
      // Ein Backup statt eines Ordners gewählt: einspielen statt ablehnen
      if (answer.backup) {
        if (!(await mayReplace())) {
          setPhase({ kind: 'idle' })
          return
        }
        const restored = await post<{ notes?: string[] }>('/api/relocation/restore-backup', { file: answer.backup, ...(ownStock ? { replace: true } : {}) })
        const notes = restored?.notes ?? []
        if (notes.length === 0) return reloadPage()
        setPhase({ kind: 'done', text: 'Ihr Backup ist eingespielt.', notes })
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
    setError('')
    setPhase({ kind: 'busy', what: 'search' })
    await load()
    setPhase({ kind: 'idle' })
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
    return (
      <>
        <PageHeader title="Ihre bisherigen Daten übernehmen" context="none" />
        <div className="ok" role="status">
          <p>{phase.text}</p>
          {phase.notes.map((note) => <p key={note}>{note}</p>)}
        </div>
        <p>
          Ab jetzt arbeiten Sie nur noch hier. Starten Sie das alte Mietfuchs nicht mehr: Was Sie dort ändern, fehlt hier.
          Die alte Programmdatei und ihre Verknüpfung können Sie löschen, sobald hier alles da ist.
        </p>
        <p>
          Haben Sie Mietfuchs auch vom Handy oder einem zweiten Rechner aus benutzt? Den Zugriff schalten Sie jetzt in den
          Einstellungen unter „Zugriff aus dem Heimnetz“ ein; dort steht auch die neue Adresse.
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={reloadPage}>Weiter</button>
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
  return (
    <>
      <PageHeader title={title} context="none" />
      {loadError && <NoticeBox level="error" title="Die Suche ließ sich nicht starten" action={loadError} />}
      {error && <NoticeBox level="error" title="Nicht übernommen" action={error} />}
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
          <p>Mietfuchs kopiert sie hierher; im alten Ordner bleibt alles, wie es ist.</p>
          {candidates.map((c) => (
            <CandidateCard key={c.dataDir} candidate={c} busy={busy} quitFailed={quitFailed} onAdopt={() => void adopt(c)} onQuit={() => void quitOld()} onCheck={() => void refresh()} />
          ))}
          <div className="row">
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => setImportWays(true)}>Andere Daten wählen …</button>
            {manual
              ? <button type="button" className="btn ghost small" disabled={busy} onClick={onClose}>Zurück</button>
              : <button type="button" className="btn ghost small" disabled={busy} onClick={() => void startFresh(true)}>Nicht übernehmen, neu beginnen</button>}
          </div>
        </>
      )}
      {(list || loadError) && !showFound && !welcome && (
        <>
          {candidates.length === 0 && (
            <p>
              Mietfuchs hat auf diesem Rechner keine Daten Ihres bisherigen Mietfuchs gefunden.
              {list?.complete === false && ' Die Suche hat nicht alle Ordner durchgesehen.'}
            </p>
          )}
          <Card title="Mit einem Backup übernehmen">
            <p>
              Öffnen Sie Ihr bisheriges Mietfuchs noch einmal und klicken Sie in den Einstellungen auf{' '}
              <strong>Backup herunterladen (ZIP)</strong>. Ziehen Sie die Datei dann hierher oder klicken Sie auf{' '}
              <strong>Backup einspielen</strong>.
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
              <p><strong>Backup hierher ziehen</strong> (eine ZIP-Datei)</p>
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
          {/* Klein darunter: die Wahl des Ordners (nur im Fenster mit Dialog) und eine neue Suche */}
          <div className="row">
            {chooseFolder && (
              <button type="button" className="btn ghost small" disabled={busy} onClick={() => void pickFolder()}>Ordner der alten Programmdatei wählen …</button>
            )}
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => void searchAgain()}>Erneut suchen</button>
          </div>
          <div className="row">
            {candidates.length > 0 && (
              <button type="button" className="btn ghost small" disabled={busy} onClick={() => setImportWays(false)}>Zurück zu den gefundenen Daten</button>
            )}
            {manual
              ? <button type="button" className="btn ghost small" disabled={busy} onClick={onClose}>Zurück</button>
              : candidates.length === 0 && <button type="button" className="btn ghost small" disabled={busy} onClick={() => setImportWays(false)}>Zurück</button>}
          </div>
        </>
      )}
    </>
  )
}

const BUSY_TEXT: Record<'copy' | 'backup' | 'quit' | 'folder' | 'search', string> = {
  search: 'Mietfuchs sucht Ihre bisherigen Daten …',
  copy: 'Mietfuchs übernimmt Ihre Daten … Bei vielen Belegen dauert das einige Minuten.',
  backup: 'Mietfuchs spielt Ihr Backup ein … Bei vielen Belegen dauert das einige Minuten.',
  quit: 'Das alte Mietfuchs wird beendet …',
  folder: 'Mietfuchs sieht im gewählten Ordner nach …',
}

function CandidateCard({ candidate, busy, quitFailed, onAdopt, onQuit, onCheck }: {
  candidate: RelocationCandidate
  busy: boolean
  quitFailed: boolean
  onAdopt: () => void
  onQuit: () => void
  onCheck: () => void
}) {
  const facts = candidateFacts(candidate)
  const runningId = useId()
  return (
    <Card title="Gefundene Daten">
      <p className="m-0">Ort: <span className="break-all">{facts.place}</span></p>
      {facts.modified && <p className="m-0">{facts.modified}</p>}
      {facts.stock && <p className="m-0">{facts.stock}</p>}
      {candidate.running && (
        <div id={runningId}>
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
        <button type="button" className="btn" disabled={busy || candidate.running} aria-describedby={candidate.running ? runningId : undefined} onClick={onAdopt}>Daten übernehmen</button>
        {candidate.running && (quitFailed
          ? <button type="button" className="btn secondary" disabled={busy} onClick={onCheck}>Erneut prüfen</button>
          : <button type="button" className="btn secondary" disabled={busy} onClick={onQuit}>Altes Mietfuchs beenden</button>)}
      </div>
    </Card>
  )
}
