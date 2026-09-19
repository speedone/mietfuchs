// Einstellungen für die KI-Belegauswertung: Adresse von Ollama und Modell. Die Seite fragt
// beim Öffnen, welche Modelle installiert sind, und bietet sie zur Auswahl an. Was angeboten
// wird und welcher Hinweis gilt, entscheidet modelForm.ts.
import { useCallback, useEffect, useState } from 'react'
import type { OllamaStatus, Settings } from '../types'
import { api } from '../api'
import { OTHER_MODEL, modelHint, modelOptions, pullInstructions } from '../modelForm'
import { useToast } from './feedback'

const README = 'https://github.com/speedone/mietfuchs#ki-belegauswertung-mit-ollama'
const errorText = (e: unknown) => String((e as Error)?.message ?? e)

type Props = { settings: Settings; reload: () => Promise<void> }

export function OllamaSettings({ settings, reload }: Props) {
  const toast = useToast()
  const fixed = settings.fixedByEnv ?? []
  const urlFixed = fixed.includes('ollamaUrl')
  const modelFixed = fixed.includes('ollamaModel')
  const [form, setForm] = useState({ ollamaUrl: settings.ollamaUrl, ollamaModel: settings.ollamaModel })
  const [status, setStatus] = useState<OllamaStatus | null>(null)
  const [checking, setChecking] = useState(true)
  // Beim Öffnen der Seite ist eine fehlende Verbindung nur ein Hinweis (die KI ist optional),
  // nach „Verbindung testen" eine Fehlermeldung
  const [manualCheck, setManualCheck] = useState(false)
  const [freeInput, setFreeInput] = useState(false)

  const loadStatus = useCallback(async () => {
    setChecking(true)
    try {
      setStatus(await api<OllamaStatus>('/api/ollama/status'))
    } catch (e) {
      setStatus({ ok: false, error: errorText(e) })
    } finally {
      setChecking(false)
    }
  }, [])
  useEffect(() => { void loadStatus() }, [loadStatus])

  async function persist(values = form) {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(values) })
    await reload()
  }

  async function save() {
    try {
      await persist()
      toast('Einstellungen gespeichert.')
    } catch (e) {
      toast(`Speichern ging nicht: ${errorText(e)}`, 'error')
    }
  }

  async function testConnection() {
    setManualCheck(true)
    try {
      if (!urlFixed || !modelFixed) await persist()
    } catch (e) {
      toast(`Speichern ging nicht: ${errorText(e)}`, 'error')
      return
    }
    await loadStatus()
  }

  async function adoptAddress(url: string) {
    const next = { ...form, ollamaUrl: url }
    setForm(next)
    try {
      await persist(next)
    } catch (e) {
      toast(`Speichern ging nicht: ${errorText(e)}`, 'error')
      return
    }
    toast('Adresse übernommen.')
    await loadStatus()
  }

  const models = status?.ok ? status.modelDetails ?? [] : []
  const showSelect = status?.ok && !freeInput && !modelFixed
  const hint = status?.ok ? modelHint(models, form.ollamaModel) : null
  const modelName = form.ollamaModel.trim()

  return (
    <div className="card">
      <h2>KI-Belegauswertung mit Ollama</h2>
      <p className="muted">
        Optional. Ollama liest hochgeladene Belege auf diesem Rechner und schlägt Beträge und
        Kostenarten vor. Übernommen wird erst, was du geprüft hast.
      </p>
      <div className="row">
        <label className="field grow">
          Server-Adresse
          <input
            value={form.ollamaUrl}
            disabled={urlFixed}
            onChange={(e) => setForm({ ...form, ollamaUrl: e.target.value })}
            placeholder="http://localhost:11434"
          />
        </label>
        <label className="field grow">
          Modell
          {showSelect ? (
            <select
              value={form.ollamaModel}
              onChange={(e) => {
                if (e.target.value === OTHER_MODEL) {
                  setFreeInput(true)
                  setForm({ ...form, ollamaModel: '' })
                } else {
                  setForm({ ...form, ollamaModel: e.target.value })
                }
              }}
            >
              {modelOptions(models, form.ollamaModel).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : (
            <input
              value={form.ollamaModel}
              disabled={modelFixed}
              autoFocus={freeInput}
              onChange={(e) => setForm({ ...form, ollamaModel: e.target.value })}
              placeholder="Name wie bei „ollama list“"
            />
          )}
        </label>
        {!(urlFixed && modelFixed) && <button className="btn" onClick={() => void save()}>Speichern</button>}
        <button className="btn secondary" onClick={() => void testConnection()} disabled={checking}>
          {checking && <span className="spinner" />}Verbindung testen
        </button>
      </div>
      {urlFixed && <p className="muted">Die Adresse ist über die Umgebungsvariable <code>NKA_OLLAMA_URL</code> festgelegt.</p>}
      {modelFixed && <p className="muted">Das Modell ist über die Umgebungsvariable <code>NKA_OLLAMA_MODEL</code> festgelegt.</p>}

      {checking && <p className="muted">Verbindung wird geprüft …</p>}
      {!checking && status?.ok && (
        <div className="ok">
          {models.length === 0
            ? 'Ollama ist erreichbar, aber es ist noch kein Modell installiert.'
            : `Ollama ist erreichbar, ${models.length === 1 ? 'ein Modell' : `${models.length} Modelle`} installiert.`}
        </div>
      )}
      {!checking && status && !status.ok && (
        <div className={manualCheck ? 'error' : 'notice'}>
          {status.error}
          {status.found && (
            <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
              <span>Unter {status.found} antwortet Ollama.</span>
              <button className="btn secondary small" onClick={() => void adoptAddress(status.found!)}>
                Diese Adresse verwenden
              </button>
            </div>
          )}
        </div>
      )}

      {hint === 'missing' && modelName && <PullHint model={modelName} ollamaUrl={settings.ollamaUrl} />}
      {hint === 'noVision' && (
        <div className="notice">
          „{modelName}“ versteht keine Bilder. PDFs mit Textebene wertet es aus, Fotos und gescannte PDFs nicht.
        </div>
      )}
      {hint === 'cloud' && (
        <div className="notice">
          „{modelName}“ läuft nicht auf diesem Rechner. Ollama schickt die Belege dafür an einen Cloud-Dienst.
        </div>
      )}

      <p className="muted">
        Für PDFs mit Textebene reicht ein reines Sprachmodell. Fotos und gescannte PDFs brauchen
        ein Modell, das Bilder versteht. Die Auswahl zeigt, welche Modelle das können. Wie man
        Ollama einrichtet, steht im{' '}
        <a href={README} target="_blank" rel="noreferrer">README</a>.
      </p>
    </div>
  )
}

// Die Anleitung richtet sich nach der gespeicherten Adresse, denn nur dort hat Ollama geantwortet
function PullHint({ model, ollamaUrl }: { model: string; ollamaUrl: string }) {
  const toast = useToast()
  const { text, command } = pullInstructions(model, ollamaUrl)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      toast('Befehl kopiert.')
    } catch {
      toast('Kopieren ging nicht. Bitte den Befehl von Hand markieren.', 'error')
    }
  }
  return (
    <>
      <p>„{model}“ ist nicht installiert. {text}</p>
      <div className="command-box">
        <pre><code>{command}</code></pre>
        <button className="btn secondary small" onClick={() => void copy()}>Befehl kopieren</button>
      </div>
    </>
  )
}
