// Einstellungen für die KI-Belegauswertung: Adresse von Ollama und Modell. Die Seite fragt
// beim Öffnen, welche Modelle installiert sind, und bietet sie zur Auswahl an. Was angeboten
// wird und welcher Hinweis gilt, entscheidet modelForm.ts.
import { useCallback, useEffect, useState } from 'react'
import type { OllamaStatus, Settings } from '../types'
import { api } from '../api'
import { ANDERES_MODELL, modelHinweis, modelOptions, pullBefehl } from '../modelForm'
import { useToast } from './feedback'

const README = 'https://github.com/speedone/mietfuchs#ki-belegauswertung-mit-ollama'
const meldung = (e: unknown) => String((e as Error)?.message ?? e)

type Props = { settings: Settings; reload: () => Promise<void> }

export function OllamaSettings({ settings, reload }: Props) {
  const toast = useToast()
  const fest = settings.fixedByEnv ?? []
  const urlFest = fest.includes('ollamaUrl')
  const modellFest = fest.includes('ollamaModel')
  const [form, setForm] = useState({ ollamaUrl: settings.ollamaUrl, ollamaModel: settings.ollamaModel })
  const [status, setStatus] = useState<OllamaStatus | null>(null)
  const [prueft, setPrueft] = useState(true)
  // Beim Öffnen der Seite ist eine fehlende Verbindung nur ein Hinweis (die KI ist optional),
  // nach „Verbindung testen" eine Fehlermeldung
  const [manuell, setManuell] = useState(false)
  const [freieEingabe, setFreieEingabe] = useState(false)

  const statusHolen = useCallback(async () => {
    setPrueft(true)
    try {
      setStatus(await api<OllamaStatus>('/api/ollama/status'))
    } catch (e) {
      setStatus({ ok: false, error: meldung(e) })
    } finally {
      setPrueft(false)
    }
  }, [])
  useEffect(() => { void statusHolen() }, [statusHolen])

  async function speichern(werte = form) {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(werte) })
    await reload()
  }

  async function save() {
    try {
      await speichern()
      toast('Einstellungen gespeichert.')
    } catch (e) {
      toast(`Speichern ging nicht: ${meldung(e)}`, 'error')
    }
  }

  async function testen() {
    setManuell(true)
    try {
      if (!urlFest || !modellFest) await speichern()
    } catch (e) {
      toast(`Speichern ging nicht: ${meldung(e)}`, 'error')
      return
    }
    await statusHolen()
  }

  async function adresseVerwenden(url: string) {
    const neu = { ...form, ollamaUrl: url }
    setForm(neu)
    try {
      await speichern(neu)
    } catch (e) {
      toast(`Speichern ging nicht: ${meldung(e)}`, 'error')
      return
    }
    toast('Adresse übernommen.')
    await statusHolen()
  }

  const modelle = status?.ok ? status.models ?? [] : []
  const auswahl = status?.ok && !freieEingabe && !modellFest
  const hinweis = status?.ok ? modelHinweis(modelle, form.ollamaModel) : null
  const name = form.ollamaModel.trim()

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
            disabled={urlFest}
            onChange={(e) => setForm({ ...form, ollamaUrl: e.target.value })}
            placeholder="http://localhost:11434"
          />
        </label>
        <label className="field grow">
          Modell
          {auswahl ? (
            <select
              value={form.ollamaModel}
              onChange={(e) => {
                if (e.target.value === ANDERES_MODELL) {
                  setFreieEingabe(true)
                  setForm({ ...form, ollamaModel: '' })
                } else {
                  setForm({ ...form, ollamaModel: e.target.value })
                }
              }}
            >
              {modelOptions(modelle, form.ollamaModel).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : (
            <input
              value={form.ollamaModel}
              disabled={modellFest}
              autoFocus={freieEingabe}
              onChange={(e) => setForm({ ...form, ollamaModel: e.target.value })}
              placeholder="Name wie bei „ollama list“"
            />
          )}
        </label>
        {!(urlFest && modellFest) && <button className="btn" onClick={() => void save()}>Speichern</button>}
        <button className="btn secondary" onClick={() => void testen()} disabled={prueft}>
          {prueft && <span className="spinner" />}Verbindung testen
        </button>
      </div>
      {urlFest && <p className="muted">Die Adresse ist über die Umgebungsvariable <code>NKA_OLLAMA_URL</code> festgelegt.</p>}
      {modellFest && <p className="muted">Das Modell ist über die Umgebungsvariable <code>NKA_OLLAMA_MODEL</code> festgelegt.</p>}

      {prueft && <p className="muted">Verbindung wird geprüft …</p>}
      {!prueft && status?.ok && (
        <div className="ok">
          {modelle.length === 0
            ? 'Ollama ist erreichbar, aber es ist noch kein Modell installiert.'
            : `Ollama ist erreichbar, ${modelle.length === 1 ? 'ein Modell' : `${modelle.length} Modelle`} installiert.`}
        </div>
      )}
      {!prueft && status && !status.ok && (
        <div className={manuell ? 'error' : 'notice'}>
          {status.error}
          {status.found && (
            <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
              <span>Unter {status.found} antwortet Ollama.</span>
              <button className="btn secondary small" onClick={() => void adresseVerwenden(status.found!)}>
                Diese Adresse verwenden
              </button>
            </div>
          )}
        </div>
      )}

      {hinweis === 'fehlt' && name && <Befehl text={pullBefehl(name)} vorher={`„${name}“ ist nicht installiert. Zum Laden im Terminal ausführen:`} />}
      {hinweis === 'ohneBilder' && (
        <div className="notice">
          „{name}“ versteht keine Bilder. PDFs mit Textebene wertet es aus, Fotos und gescannte PDFs nicht.
        </div>
      )}
      {hinweis === 'cloud' && (
        <div className="notice">
          „{name}“ läuft nicht auf diesem Rechner. Ollama schickt die Belege dafür an einen Cloud-Dienst.
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

function Befehl({ text, vorher }: { text: string; vorher: string }) {
  const toast = useToast()
  const kopieren = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast('Befehl kopiert.')
    } catch {
      toast('Kopieren ging nicht. Bitte den Befehl von Hand markieren.', 'error')
    }
  }
  return (
    <>
      <p>{vorher}</p>
      <div className="command-box">
        <pre><code>{text}</code></pre>
        <button className="btn secondary small" onClick={() => void kopieren()}>Befehl kopieren</button>
      </div>
    </>
  )
}
