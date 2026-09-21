// Einstellungen der KI-Belegauswertung (#18): Anbieter, Adresse, Schlüssel und Modell, dazu ein
// eigener Anbieter für Fotos und Scans und die Einstellungen für Fortgeschrittene. Die Vorlagen
// kommen vom Server (/api/ai/presets), die Modelle je Platz von /api/ai/status. Was zur Wahl
// steht und welcher Hinweis gilt, entscheiden aiForm.ts und modelForm.ts.
//
// Vorlagen belegen nur vor: Adresse, Modell und Schlüssel bleiben frei änderbar, und „Eigener
// OpenAI-kompatibler Dienst“ nimmt jede Adresse.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiPreset, AiRecommendations, AiSettings as AiSettingsValues, AiSlot, AiSlotName, AiStatus, Settings } from '../types'
import { api, fmtDate } from '../api'
import { pullModel, type PullProgress } from '../aiRequest'
import { OTHER_MODEL, modelHint, modelOptions, pullInstructions } from '../modelForm'
import {
  JSON_MODE_OPTIONS, SLOT_LABELS, VISION_OPTIONS, aiFormFrom, consentState, isFixed, keyState, pageEdgeHint,
  parseOptionalInt, presetGroups, pullText, recommendationsFor, switchPreset, visionFromValue, visionValue,
} from '../aiForm'
import { INTAKE_EDGE } from '../pdf'
import { useToast, useConfirm } from './feedback'

const README = 'https://github.com/speedone/mietfuchs#ki-belegauswertung'
const errorText = (e: unknown) => String((e as Error)?.message ?? e)

// Welche Umgebungsvariable ein Feld festlegt. Adresse und Modell kennen zwei Namen: den neuen
// und den von vor #18.
const ENV_NAMES: Record<string, string> = {
  'ai.text.provider': 'NKA_AI_PROVIDER',
  'ai.text.url': 'NKA_AI_URL oder NKA_OLLAMA_URL',
  'ai.text.model': 'NKA_AI_MODEL oder NKA_OLLAMA_MODEL',
  'ai.timeoutSeconds': 'NKA_AI_TIMEOUT',
  'ai.numCtx': 'NKA_OLLAMA_NUM_CTX',
  'ai.maxOutputTokens': 'NKA_AI_MAX_TOKENS',
  'ai.pageImageEdge': 'NKA_AI_IMAGE_EDGE',
}

function EnvHint({ path }: { path: string }) {
  return <p className="muted">Über die Umgebungsvariable <code>{ENV_NAMES[path] ?? path}</code> festgelegt.</p>
}

type Props = { settings: Settings; reload: () => Promise<void> }

export function AiSettings({ settings, reload }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const [presets, setPresets] = useState<AiPreset[]>([])
  const [form, setForm] = useState<AiSettingsValues>(() => aiFormFrom(settings))
  // Zahlenfelder und Denkaufwand als Text, damit ein leeres Feld „Standard“ heißen kann
  const [advanced, setAdvanced] = useState(() => ({
    timeoutSeconds: String(settings.ai?.timeoutSeconds ?? ''),
    numCtx: String(settings.ai?.numCtx ?? ''),
    maxOutputTokens: String(settings.ai?.maxOutputTokens ?? ''),
    pageImageEdge: String(settings.ai?.pageImageEdge ?? ''),
    reasoningEffort: settings.ai?.reasoningEffort ?? '',
  }))
  const [status, setStatus] = useState<Partial<Record<AiSlotName, { of: string; value: AiStatus }>>>({})
  const [checking, setChecking] = useState<Partial<Record<AiSlotName, boolean>>>({})
  const [saving, setSaving] = useState(false)
  const [recommendations, setRecommendations] = useState<AiRecommendations | null>(null)
  // Läuft gerade ein Download? Dann Fortschritt zeigen und Abbrechen anbieten (#33)
  const [pull, setPull] = useState<{ slot: AiSlotName; model: string; progress: PullProgress | null } | null>(null)
  const pullAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    void api<AiPreset[]>('/api/ai/presets').then(setPresets).catch(() => setPresets([]))
    void api<AiRecommendations>('/api/ai/recommendations').then(setRecommendations).catch(() => setRecommendations(null))
  }, [])
  // Wer die Seite verlässt, wartet nicht mehr auf den Download
  useEffect(() => () => pullAbort.current?.abort(), [])

  // Die Modellliste gehört zu einer Adresse: Nach einer Änderung im Formular passt sie nicht
  // mehr, dann gibt es statt der Auswahl ein freies Feld.
  const slotKey = (slot: AiSlot) => `${slot.provider}|${slot.url}`

  const loadStatus = useCallback(async (name: AiSlotName, slot: AiSlot) => {
    setChecking((c) => ({ ...c, [name]: true }))
    try {
      const value = await api<AiStatus>(`/api/ai/status?slot=${name}`)
      setStatus((s) => ({ ...s, [name]: { of: slotKey(slot), value } }))
    } catch (e) {
      setStatus((s) => ({ ...s, [name]: { of: slotKey(slot), value: { ok: false, error: errorText(e) } } }))
    } finally {
      setChecking((c) => ({ ...c, [name]: false }))
    }
  }, [])

  useEffect(() => {
    const saved = settings.ai
    if (!saved) return
    void loadStatus('text', saved.text)
    if (saved.images) void loadStatus('images', saved.images)
    // Nur beim Öffnen: später entscheiden „Speichern“ und „Verbindung testen“
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadStatus])

  async function persist(values = form): Promise<Settings | null> {
    const numbers = {
      timeoutSeconds: parseOptionalInt(advanced.timeoutSeconds),
      numCtx: parseOptionalInt(advanced.numCtx),
      maxOutputTokens: parseOptionalInt(advanced.maxOutputTokens),
      pageImageEdge: parseOptionalInt(advanced.pageImageEdge),
    }
    if (Object.values(numbers).some((v) => v === undefined)) {
      toast('Bitte in den Zahlenfeldern eine ganze Zahl eintragen oder das Feld leer lassen.', 'error')
      return null
    }
    const ai = {
      ...values,
      timeoutSeconds: numbers.timeoutSeconds ?? null,
      numCtx: numbers.numCtx ?? null,
      maxOutputTokens: numbers.maxOutputTokens ?? null,
      pageImageEdge: numbers.pageImageEdge ?? null,
      reasoningEffort: advanced.reasoningEffort.trim() || null,
    }
    setSaving(true)
    try {
      const updated = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ai }) })
      setForm(aiFormFrom(updated))
      await reload()
      return updated
    } catch (e) {
      toast(`Speichern ging nicht: ${errorText(e)}`, 'error')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function save() {
    const updated = await persist()
    if (!updated) return
    toast('Einstellungen gespeichert.')
    void loadStatus('text', updated.ai!.text)
    if (updated.ai?.images) void loadStatus('images', updated.ai.images)
  }

  async function test(name: AiSlotName) {
    const updated = await persist()
    if (!updated) return
    const slot = name === 'text' ? updated.ai?.text : updated.ai?.images
    if (slot) await loadStatus(name, slot)
  }

  async function adoptAddress(name: AiSlotName, url: string) {
    const slot = name === 'text' ? { ...form.text, url } : form.images && { ...form.images, url }
    if (!slot) return
    const next = name === 'text' ? { ...form, text: slot } : { ...form, images: slot }
    setForm(next)
    const updated = await persist(next)
    if (!updated) return
    toast('Adresse übernommen.')
    await loadStatus(name, slot)
  }

  // Ein Modell laden. Modelle sind mehrere Gigabyte groß, deshalb erst nachfragen. Bricht der
  // Download ab, setzt ein neuer Versuch dort an, wo er aufgehört hat.
  async function startPull(name: AiSlotName, model: string, sizeGb?: number) {
    const ok = await confirm({
      title: `„${model}“ laden?`,
      message: sizeGb
        ? `Der Download ist rund ${sizeGb.toLocaleString('de-DE')} GB groß und läuft über Ollama. Solange er läuft, kannst du weiterarbeiten.`
        : 'Die Größe ist unbekannt, Modelle sind meist mehrere Gigabyte groß. Der Download läuft über Ollama.',
      confirmLabel: 'Laden',
    })
    if (!ok) return
    const controller = new AbortController()
    pullAbort.current = controller
    setPull({ slot: name, model, progress: null })
    try {
      await pullModel(model, {
        slot: name,
        signal: controller.signal,
        onProgress: (progress) => setPull((p) => (p ? { ...p, progress } : p)),
      })
      toast(`„${model}“ ist geladen.`)
      const slot = name === 'text' ? form.text : form.images
      if (slot) await loadStatus(name, slot)
    } catch (e) {
      if (!controller.signal.aborted) toast(`Laden ging nicht: ${errorText(e)}`, 'error')
    } finally {
      pullAbort.current = null
      setPull(null)
    }
  }

  async function withReload(action: () => Promise<unknown>, done: string) {
    try {
      await action()
      await reload()
      toast(done)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const slots: AiSlotName[] = form.images ? ['text', 'images'] : ['text']
  const usesOllama = [form.text, form.images].some((s) => s?.provider === 'ollama')
  const usesOpenAi = [form.text, form.images].some((s) => s?.provider === 'openai')

  return (
    <div className="card">
      <h2>KI-Belegauswertung</h2>
      <p className="muted">
        Optional. Ein Sprachmodell liest hochgeladene Belege und schlägt Beträge und Kostenarten
        vor. Übernommen wird erst, was du geprüft hast. Am einfachsten läuft das mit Ollama auf
        diesem Rechner; Dienste im Internet sind schneller, dafür verlassen die Belege das Haus.
      </p>

      {slots.map((name) => (
        <SlotEditor
          key={name}
          name={name}
          slot={name === 'text' ? form.text : form.images!}
          settings={settings}
          presets={presets}
          status={status[name]?.of === slotKey(name === 'text' ? form.text : form.images!) ? status[name]?.value ?? null : null}
          checking={Boolean(checking[name])}
          onChange={(slot) => setForm(name === 'text' ? { ...form, text: slot } : { ...form, images: slot })}
          recommendations={recommendations}
          suggestions={recommendationsFor(recommendations?.models ?? [], name === 'text' ? form.text : form.images!, status[name]?.value.models ?? [])}
          pull={pull?.slot === name ? pull : null}
          onPull={(model, sizeGb) => void startPull(name, model, sizeGb)}
          onCancelPull={() => pullAbort.current?.abort()}
          onTest={() => void test(name)}
          onAdopt={(url) => void adoptAddress(name, url)}
          onKey={(key) => void withReload(() => api('/api/ai/key', { method: 'PUT', body: JSON.stringify({ slot: name, key }) }), 'Schlüssel gespeichert.')}
          onDeleteKey={() => void withReload(() => api(`/api/ai/key/${name}`, { method: 'DELETE' }), 'Schlüssel gelöscht.')}
          onConsent={() => void withReload(() => api('/api/ai/consent', { method: 'POST', body: JSON.stringify({ slot: name }) }), 'Übermittlung bestätigt.')}
          onRevoke={() => void withReload(() => api(`/api/ai/consent/${name}`, { method: 'DELETE' }), 'Bestätigung widerrufen.')}
        />
      ))}

      <details className="extra-details" style={{ marginTop: 12 }}>
        <summary>Erweitert</summary>
        <label className="ai-toggle">
          <input
            type="checkbox"
            checked={form.images !== null}
            onChange={(e) => setForm({ ...form, images: e.target.checked ? { ...form.text } : null })}
          />
          Eigenen Anbieter für Fotos und Scans verwenden
        </label>
        <p className="muted">
          Damit liest zum Beispiel ein Dienst im Internet die Bilder, während Belege mit Textebene
          auf diesem Rechner bleiben.
        </p>
        <div className="row">
          <label className="field">
            Zeitlimit je Schritt (Sekunden)
            <input
              value={advanced.timeoutSeconds}
              disabled={isFixed(settings, 'ai.timeoutSeconds')}
              placeholder="Standard: 20 Minuten fürs Auslesen"
              onChange={(e) => setAdvanced({ ...advanced, timeoutSeconds: e.target.value })}
            />
          </label>
          {usesOllama && (
            <label className="field">
              Kontext (Token, nur Ollama)
              <input
                value={advanced.numCtx}
                disabled={isFixed(settings, 'ai.numCtx')}
                placeholder="Standard: 16384"
                onChange={(e) => setAdvanced({ ...advanced, numCtx: e.target.value })}
              />
            </label>
          )}
          {usesOpenAi && (
            <label className="field">
              Länge der Antwort (Token)
              <input
                value={advanced.maxOutputTokens}
                disabled={isFixed(settings, 'ai.maxOutputTokens')}
                placeholder="Standard: 16384"
                onChange={(e) => setAdvanced({ ...advanced, maxOutputTokens: e.target.value })}
              />
            </label>
          )}
          <label className="field">
            Seitenbilder eines Scans (Bildpunkte)
            <input
              value={advanced.pageImageEdge}
              disabled={isFixed(settings, 'ai.pageImageEdge')}
              placeholder={`Standard: ${INTAKE_EDGE}`}
              onChange={(e) => setAdvanced({ ...advanced, pageImageEdge: e.target.value })}
            />
          </label>
        </div>
        <p className="muted">
          Lange Kante der Seiten, die ein Scan an das Modell schickt. {pageEdgeHint(advanced.pageImageEdge, INTAKE_EDGE)} Mehr
          verlängert die Auswertung, ohne die Trefferquote zu verbessern; deutlich weniger übersieht Beträge.
        </p>
        {isFixed(settings, 'ai.timeoutSeconds') && <EnvHint path="ai.timeoutSeconds" />}
        {isFixed(settings, 'ai.numCtx') && <EnvHint path="ai.numCtx" />}
        {isFixed(settings, 'ai.maxOutputTokens') && <EnvHint path="ai.maxOutputTokens" />}
        {isFixed(settings, 'ai.pageImageEdge') && <EnvHint path="ai.pageImageEdge" />}
        <div className="row">
          {usesOpenAi && (
            <>
              <label className="field">
                JSON-Stufe
                <select value={form.jsonMode} onChange={(e) => setForm({ ...form, jsonMode: e.target.value as AiSettingsValues['jsonMode'] })}>
                  {JSON_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="field">
                Denkaufwand
                <input
                  value={advanced.reasoningEffort}
                  placeholder="Standard des Modells, z. B. none oder low"
                  onChange={(e) => setAdvanced({ ...advanced, reasoningEffort: e.target.value })}
                />
              </label>
            </>
          )}
        </div>
        <label className="field">
          Zusätzliche Hinweise an das Modell
          <textarea
            value={form.extraInstructions}
            rows={2}
            placeholder="z. B. Eigenheiten der eigenen Belege"
            onChange={(e) => setForm({ ...form, extraInstructions: e.target.value })}
          />
        </label>
      </details>

      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn" onClick={() => void save()} disabled={saving}>
          {saving && <span className="spinner" />}Speichern
        </button>
      </div>
      <p className="muted">
        Welches Modell wofür taugt und wie man Ollama einrichtet, steht im{' '}
        <a href={README} target="_blank" rel="noreferrer">README</a>. API-Schlüssel liegen in einer
        eigenen Datei neben der Datenbank und sind nicht im Backup.
      </p>
    </div>
  )
}

type SlotProps = {
  name: AiSlotName
  slot: AiSlot
  settings: Settings
  presets: AiPreset[]
  status: AiStatus | null
  checking: boolean
  recommendations: AiRecommendations | null
  suggestions: ReturnType<typeof recommendationsFor>
  pull: { model: string; progress: PullProgress | null } | null
  onChange: (slot: AiSlot) => void
  onTest: () => void
  onPull: (model: string, sizeGb?: number) => void
  onCancelPull: () => void
  onAdopt: (url: string) => void
  onKey: (key: string) => void
  onDeleteKey: () => void
  onConsent: () => void
  onRevoke: () => void
}

function SlotEditor(props: SlotProps) {
  const { name, slot, settings, presets, status, checking, onChange, onTest, onAdopt } = props
  const { recommendations, suggestions, pull, onPull, onCancelPull } = props
  const [freeModel, setFreeModel] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [replacingKey, setReplacingKey] = useState(false)

  const preset = presets.find((p) => p.id === slot.preset)
  const fixedPath = (field: string) => `ai.${name}.${field}`
  const fixed = (field: string) => isFixed(settings, fixedPath(field))
  const models = status?.ok ? status.models ?? [] : []
  const showModelSelect = Boolean(status?.ok) && !freeModel && !fixed('model')
  const key = keyState(preset, settings.aiKeys?.[name])
  const consent = consentState(settings, name, models)
  const hint = status?.ok ? modelHint(models, slot.model, slot.provider) : null
  const localOllama = slot.provider === 'ollama' && !settings.aiExternal?.[name]

  return (
    <fieldset className="ai-slot">
      <legend>{SLOT_LABELS[name]}</legend>
      <div className="row">
        <label className="field grow">
          Anbieter
          <select
            value={slot.preset}
            disabled={fixed('provider')}
            onChange={(e) => {
              const chosen = presets.find((p) => p.id === e.target.value)
              if (chosen) onChange(switchPreset(slot, chosen))
              setFreeModel(false)
            }}
          >
            {presetGroups(presets, slot.preset).map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field grow">
          Adresse
          <input
            value={slot.url}
            disabled={fixed('url')}
            placeholder={preset?.url || 'https://dienst.example.com/v1'}
            onChange={(e) => onChange({ ...slot, url: e.target.value })}
          />
        </label>
        <button className="btn secondary" onClick={onTest} disabled={checking}>
          {checking && <span className="spinner" />}Verbindung testen
        </button>
      </div>
      {fixed('provider') && <EnvHint path={fixedPath('provider')} />}
      {fixed('url') && <EnvHint path={fixedPath('url')} />}

      {key !== 'none' && (
        <div className="row">
          {key === 'fromEnv' ? (
            <p className="muted">
              Der Schlüssel ist über die Umgebungsvariable <code>{settings.aiKeys?.[name]?.fromEnv}</code> festgelegt.
            </p>
          ) : key === 'set' && !replacingKey ? (
            <>
              <p className="muted">Schlüssel gespeichert ({settings.aiKeys?.[name]?.hint || 'ohne Hinweis'}).</p>
              <button className="btn secondary small" onClick={() => setReplacingKey(true)}>Ersetzen</button>
              <button className="btn secondary small" onClick={props.onDeleteKey}>Schlüssel löschen</button>
            </>
          ) : (
            <>
              <label className="field grow">
                API-Schlüssel
                <input type="password" value={keyInput} autoComplete="off" placeholder={key === 'optional' ? 'nur falls der Dienst einen verlangt' : ''} onChange={(e) => setKeyInput(e.target.value)} />
              </label>
              <button
                className="btn secondary"
                onClick={() => {
                  props.onKey(keyInput.trim())
                  setKeyInput('')
                  setReplacingKey(false)
                }}
                disabled={!keyInput.trim()}
              >
                Schlüssel speichern
              </button>
              {preset?.keyUrl && (
                <a className="btn secondary small" href={preset.keyUrl} target="_blank" rel="noreferrer">Schlüssel bekommen …</a>
              )}
            </>
          )}
        </div>
      )}

      <div className="row">
        <label className="field grow">
          Modell
          {showModelSelect ? (
            <select
              value={slot.model}
              onChange={(e) => {
                if (e.target.value === OTHER_MODEL) {
                  setFreeModel(true)
                  onChange({ ...slot, model: '' })
                } else {
                  onChange({ ...slot, model: e.target.value })
                }
              }}
            >
              {modelOptions(models, slot.model, slot.provider).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input
              value={slot.model}
              disabled={fixed('model')}
              placeholder={slot.provider === 'ollama' ? 'Name wie bei „ollama list“' : 'Name beim Dienst, z. B. gpt-5.4-nano'}
              onChange={(e) => onChange({ ...slot, model: e.target.value })}
            />
          )}
        </label>
        {slot.provider === 'openai' && (
          <label className="field">
            Versteht das Modell Bilder?
            <select value={visionValue(slot.vision)} onChange={(e) => onChange({ ...slot, vision: visionFromValue(e.target.value) })}>
              {VISION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
      </div>
      {fixed('model') && <EnvHint path={fixedPath('model')} />}

      {checking && <p className="muted">Verbindung wird geprüft …</p>}
      {!checking && status?.ok && (
        <div className="ok">
          {models.length === 0
            ? 'Der Dienst antwortet, nennt aber kein Modell.'
            : `Der Dienst antwortet, ${models.length === 1 ? 'ein Modell' : `${models.length} Modelle`} stehen zur Wahl.`}
        </div>
      )}
      {!checking && status && !status.ok && (
        <div className="notice">
          {status.error}
          {status.found && (
            <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
              <span>Unter {status.found} antwortet Ollama.</span>
              <button className="btn secondary small" onClick={() => onAdopt(status.found!)}>Diese Adresse verwenden</button>
            </div>
          )}
        </div>
      )}

      {suggestions.length > 0 && (
        <details className="extra-details" open={!slot.model.trim()}>
          <summary>Empfehlungen{recommendations?.updated ? ` (Stand ${fmtDate(recommendations.updated)})` : ''}</summary>
          <ul className="recommendations">
            {suggestions.map((r) => (
              <li key={r.name}>
                <div>
                  <strong>{r.name}</strong>
                  {r.sizeGb ? ` · ${r.sizeGb.toLocaleString('de-DE')} GB` : ''}
                  {r.installed ? ' · installiert' : ''}
                  {r.scores?.text != null && ` · ${r.scores.text} % bei PDFs mit Textebene`}
                  {r.scores?.photo != null && `, ${r.scores.photo} % bei Fotos`}
                </div>
                <div className="muted">{r.note}</div>
                <div className="row">
                  <button className="btn secondary small" onClick={() => onChange({ ...slot, model: r.name, vision: slot.provider === 'openai' ? r.vision : slot.vision })}>
                    Übernehmen
                  </button>
                  {localOllama && !r.installed && (
                    <button className="btn secondary small" onClick={() => onPull(r.name, r.sizeGb)} disabled={Boolean(pull)}>
                      Laden …
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {pull && (
        <div className="ok">
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="spinner" />
            <span>„{pull.model}“: {pullText(pull.progress)}</span>
            <button className="btn secondary small" onClick={onCancelPull}>Abbrechen</button>
          </div>
        </div>
      )}

      {hint === 'missing' && slot.model.trim() && (
        localOllama
          ? (
            <PullHint
              model={slot.model.trim()}
              url={slot.url}
              busy={Boolean(pull)}
              onPull={() => onPull(slot.model.trim(), suggestions.find((r) => r.name === slot.model.trim())?.sizeGb)}
            />
          )
          : <p className="notice">„{slot.model.trim()}“ steht nicht in der Liste des Dienstes. Stimmt der Name?</p>
      )}
      {hint === 'noVision' && (
        <div className="notice">„{slot.model.trim()}“ versteht keine Bilder. PDFs mit Textebene wertet es aus, Fotos und gescannte PDFs nicht.</div>
      )}

      {consent && !consent.given && (
        <div className="notice">
          {consent.kind === 'external'
            ? `Belege gehen an ${consent.target}, einen Dienst außerhalb dieses Rechners und des Heimnetzes.`
            : `Das Modell „${consent.target}“ läuft nicht auf diesem Rechner, Ollama reicht die Belege an einen Cloud-Dienst weiter.`}
          {' '}In Belegen stehen personenbezogene Daten, etwa Namen und Adressen. Wer sie einem
          Dienst gibt, braucht dafür in der Regel einen Vertrag zur Auftragsverarbeitung mit dem
          Anbieter. Ohne Bestätigung schickt Mietfuchs nichts dorthin.
          {preset?.notice && <> {preset.notice}</>}
          <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
            <button className="btn secondary small" onClick={props.onConsent}>Übermittlung bestätigen</button>
            {preset?.privacyUrl && (
              <a href={preset.privacyUrl} target="_blank" rel="noreferrer">Bedingungen des Anbieters</a>
            )}
          </div>
        </div>
      )}
      {consent?.given && (
        <div className="row" style={{ alignItems: 'center' }}>
          <p className="muted">Übermittlung an {consent.target} bestätigt am {fmtDate(consent.given.date)}.</p>
          <button className="btn secondary small" onClick={props.onRevoke}>Widerrufen</button>
        </div>
      )}
    </fieldset>
  )
}

// Nur für ein Ollama auf diesem Rechner oder im Heimnetz: wie man ein fehlendes Modell lädt
// Mietfuchs kann das Modell selbst laden (#33). Der Befehl fürs Terminal bleibt daneben stehen,
// denn wer lieber dort arbeitet, soll das weiter können.
function PullHint({ model, url, onPull, busy }: { model: string; url: string; onPull: () => void; busy: boolean }) {
  const toast = useToast()
  const { text, command } = pullInstructions(model, url)
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
      <p>„{model}“ ist nicht installiert.</p>
      <div className="row">
        <button className="btn secondary" onClick={onPull} disabled={busy}>Modell laden</button>
        <span className="muted">oder {text.replace(/^Zum Laden im/, 'im')}</span>
      </div>
      <div className="command-box">
        <pre><code>{command}</code></pre>
        <button className="btn secondary small" onClick={() => void copy()}>Befehl kopieren</button>
      </div>
    </>
  )
}
