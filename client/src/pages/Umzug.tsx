import { useCallback, useEffect, useId, useState } from 'react'
import { api, ApiError, errorText } from '../api'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import { NoticeBox } from '../components/Notice'
import { useConfirm } from '../components/feedback'
import { adoptedText, candidateFacts, folderBridge, type AdoptResult, type RelocationCandidate, type RelocationCandidates } from '../relocation'

// „Ihre bisherigen Daten übernehmen“ (#517): erscheint im Programmfenster statt des Cockpits, solange kein Bestand da und
// nichts entschieden ist. Die Entscheidungen stehen in relocation.ts, der Ablauf im Server (index.ts, „Umzug ins
// Programmfenster“). Übernehmen heißt kopieren; der alte Ordner bleibt, wie er ist, und bekommt nur einen Vermerk.

type Phase =
  | { kind: 'idle' }
  | { kind: 'busy', what: 'copy' | 'backup' | 'quit' | 'folder' }
  | { kind: 'done', text: string, notes: string[] }

const post = <T,>(url: string, body: unknown = {}) => api<T>(url, { method: 'POST', body: JSON.stringify(body) })

export default function Umzug({ onFresh, reloadPage = () => window.location.reload(), chooseFolder = folderBridge() }: {
  // „Neu anfangen“ ist gespeichert: das Cockpit statt dieses Bildschirms
  onFresh: () => void
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
  const [otherWays, setOtherWays] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const busy = phase.kind === 'busy'

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

  // Ob ein Fund noch vom alten Mietfuchs benutzt wird, fragt der Server bei jedem Laden neu
  const refresh = async () => {
    await load()
    if (chosen) {
      try {
        setChosen((await post<{ candidate: RelocationCandidate }>('/api/relocation/inspect', { folder: chosen.dataDir })).candidate)
      } catch { /* bleibt, wie er war */ }
    }
  }

  async function adopt(c: RelocationCandidate) {
    setError('')
    setPhase({ kind: 'busy', what: 'copy' })
    try {
      const result = await post<AdoptResult>('/api/relocation/adopt', { dataDir: c.dataDir })
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
      setChosen((await post<{ candidate: RelocationCandidate }>('/api/relocation/inspect', { folder })).candidate)
      setOtherWays(false)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setPhase({ kind: 'idle' })
    }
  }

  async function startFresh() {
    const ok = await confirm({
      title: 'Ohne Ihre bisherigen Daten anfangen?',
      message: 'Mietfuchs fragt danach nicht mehr nach Ihren alten Daten. Ein Backup können Sie jederzeit in den Einstellungen einspielen.',
      confirmLabel: 'Neu anfangen',
    })
    if (!ok) return
    try {
      await post('/api/relocation/decline')
      onFresh()
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
        <div className="row">
          <button type="button" className="btn" onClick={reloadPage}>Weiter</button>
        </div>
      </>
    )
  }

  const showFound = candidates.length > 0 && !otherWays
  return (
    <>
      <PageHeader title="Ihre bisherigen Daten übernehmen" context="none" />
      {loadError && <NoticeBox level="error" title="Die Suche ließ sich nicht starten" action={loadError} />}
      {error && <NoticeBox level="error" title="Nicht übernommen" action={error} />}
      {phase.kind === 'busy' && <p role="status"><span className="spinner" />{BUSY_TEXT[phase.what]}</p>}
      {!list && !loadError && <p role="status"><span className="spinner" />Mietfuchs sucht Ihre bisherigen Daten …</p>}
      {list && showFound && (
        <>
          <p>Mietfuchs hat Daten Ihres bisherigen Mietfuchs gefunden. Sie werden hierher kopiert; im alten Ordner bleibt alles, wie es ist.</p>
          {candidates.map((c) => (
            <CandidateCard key={c.dataDir} candidate={c} busy={busy} quitFailed={quitFailed} onAdopt={() => void adopt(c)} onQuit={() => void quitOld()} onCheck={() => void refresh()} />
          ))}
          <p className="muted">
            Nicht die richtigen Daten?{' '}
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => setOtherWays(true)}>Andere Wege zeigen</button>
          </p>
        </>
      )}
      {(list || loadError) && !showFound && (
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
              <strong>Backup herunterladen</strong>. Ziehen Sie die Datei dann hierher oder klicken Sie auf{' '}
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
          {/* Klein darunter: die Wahl des Ordners (nur im Fenster mit Dialog), zuletzt der Neuanfang */}
          {chooseFolder && (
            <p className="muted">
              Wissen Sie, wo die alte Programmdatei liegt?{' '}
              <button type="button" className="btn ghost small" disabled={busy} onClick={() => void pickFolder()}>Ordner der alten Programmdatei wählen …</button>
            </p>
          )}
          <div className="row">
            {candidates.length > 0 && (
              <button type="button" className="btn ghost small" disabled={busy} onClick={() => setOtherWays(false)}>Zurück zu den gefundenen Daten</button>
            )}
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => void startFresh()}>Neu anfangen …</button>
          </div>
        </>
      )}
    </>
  )
}

const BUSY_TEXT: Record<'copy' | 'backup' | 'quit' | 'folder', string> = {
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
