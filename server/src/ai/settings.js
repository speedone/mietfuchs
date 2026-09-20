// Einstellungen der KI-Belegauswertung (#18), gespeichert in `settings.ai`:
//
//   text:   { provider, preset, url, model, vision }  Standard-Anbieter für alle Belege
//   images: null | wie text                           eigener Anbieter für Fotos und Scans
//   timeoutSeconds, numCtx, maxOutputTokens, pageImageEdge, jsonMode, reasoningEffort,
//   extraInstructions                                 für Fortgeschrittene, null = Standard
//   consent: { [Platz]: { url, date } }               Bestätigung eines externen Dienstes
//
// `provider` ist die Art der Schnittstelle ('ollama' oder 'openai' für alle OpenAI-kompatiblen
// Dienste), `preset` die gewählte Vorlage aus presets.js. `vision` ist null, solange unbekannt
// ist, ob das Modell Bilder versteht (Ollama meldet es selbst), sonst die Angabe des Nutzers.
// Die API-Schlüssel liegen getrennt in secrets.ts.
//
// Die früheren Felder `ollamaUrl` und `ollamaModel` bleiben erhalten und spiegeln Adresse und
// Modell, solange Ollama der Standard-Anbieter ist. Eine ältere Version liest sie nach einem
// Downgrade weiter, und ein Tab von vor dem Update schickt nur sie.
import net from 'node:net'
import { presetById, defaultPresetFor } from './presets.js'

export const SLOTS = ['text', 'images']
const PROVIDERS = ['ollama', 'openai']
const JSON_MODES = ['auto', 'schema', 'object', 'prompt']
const DEFAULT_OLLAMA_URL = 'http://localhost:11434'
const SLOT_LABELS = { text: 'Standard-Anbieter', images: 'Anbieter für Fotos und Scans' }
const LIMITS = {
  timeoutSeconds: [10, 7200],
  numCtx: [2048, 1048576],
  maxOutputTokens: [256, 262144],
  // Lange Kante der Seitenbilder eines Scans (#35). Unter 600 Bildpunkten ist auf einer
  // Rechnung nichts mehr zu lesen; über 2600 rechnen auch die großen Dienste die Bilder von
  // sich aus wieder herunter.
  pageImageEdge: [600, 2600],
  modelLength: 200,
  urlLength: 500,
  extraInstructions: 2000,
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const fail = (message) => Object.assign(new Error(message), { status: 400 })
const inRange = (v, [min, max]) => Number.isInteger(v) && v >= min && v <= max

export function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const THIS_MACHINE = ['localhost', '127.0.0.1', '::1']
const onThisMachine = (url) => {
  try {
    return THIS_MACHINE.includes(new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ''))
  } catch {
    return true
  }
}

// ---------- Prüfen ----------

function validateSlot(raw, slot) {
  const label = SLOT_LABELS[slot]
  if (!isObject(raw)) throw fail(`${label}: ungültige Angabe.`)
  const { provider, preset, url, model = '', vision = null } = raw
  if (!PROVIDERS.includes(provider)) throw fail(`${label}: unbekannte Anbieterart „${provider}“.`)
  if (presetById(preset)?.provider !== provider) throw fail(`${label}: Die Vorlage „${preset}“ passt nicht zu diesem Anbieter.`)
  if (typeof url !== 'string' || !isHttpUrl(url) || url.length > LIMITS.urlLength) throw fail(`${label}: Die Adresse muss mit http:// oder https:// beginnen und darf höchstens ${LIMITS.urlLength} Zeichen haben.`)
  if (typeof model !== 'string' || model.length > LIMITS.modelLength) throw fail(`${label}: Der Modellname ist zu lang.`)
  if (vision !== null && typeof vision !== 'boolean') throw fail(`${label}: Die Angabe zum Bildverständnis ist ungültig.`)
  return { provider, preset, url: url.trim(), model: model.trim(), vision }
}

// Prüft alle Felder außer `consent` und liefert sie bereinigt. Wirft mit `status` 400.
function validateAi(raw) {
  const {
    text, images = null, timeoutSeconds = null, numCtx = null, maxOutputTokens = null, pageImageEdge = null,
    jsonMode = 'auto', reasoningEffort = null, extraInstructions = '',
  } = raw
  if (timeoutSeconds !== null && !inRange(timeoutSeconds, LIMITS.timeoutSeconds)) {
    throw fail(`Das Zeitlimit muss zwischen ${LIMITS.timeoutSeconds[0]} und ${LIMITS.timeoutSeconds[1]} Sekunden liegen.`)
  }
  if (numCtx !== null && !inRange(numCtx, LIMITS.numCtx)) {
    throw fail(`Der Kontext muss zwischen ${LIMITS.numCtx[0]} und ${LIMITS.numCtx[1]} Token liegen.`)
  }
  if (maxOutputTokens !== null && !inRange(maxOutputTokens, LIMITS.maxOutputTokens)) {
    throw fail(`Die Antwortlänge muss zwischen ${LIMITS.maxOutputTokens[0]} und ${LIMITS.maxOutputTokens[1]} Token liegen.`)
  }
  if (pageImageEdge !== null && !inRange(pageImageEdge, LIMITS.pageImageEdge)) {
    throw fail(`Die Größe der Seitenbilder muss zwischen ${LIMITS.pageImageEdge[0]} und ${LIMITS.pageImageEdge[1]} Bildpunkten liegen.`)
  }
  if (!JSON_MODES.includes(jsonMode)) throw fail(`Unbekannte JSON-Stufe „${jsonMode}“.`)
  if (reasoningEffort !== null && !(typeof reasoningEffort === 'string' && /^[a-z]{1,20}$/.test(reasoningEffort))) {
    throw fail('Der Denkaufwand ist ungültig. Erlaubt sind kleine Buchstaben wie low, medium oder none.')
  }
  if (typeof extraInstructions !== 'string' || extraInstructions.length > LIMITS.extraInstructions) {
    throw fail(`Die zusätzlichen Hinweise an das Modell sind zu lang (höchstens ${LIMITS.extraInstructions} Zeichen).`)
  }
  return {
    text: validateSlot(text, 'text'),
    images: images === null ? null : validateSlot(images, 'images'),
    timeoutSeconds,
    numCtx,
    maxOutputTokens,
    pageImageEdge,
    jsonMode,
    reasoningEffort,
    extraInstructions: extraInstructions.trim(),
  }
}

// ---------- Migration ----------

// Ergänzt `settings.ai` beim Laden der db.json. Fehlt es, entsteht es aus ollamaUrl und
// ollamaModel. Unbrauchbare Einzelwerte fallen auf den Standard zurück, statt den Start zu
// verhindern.
export function migrateAi(settings) {
  const stored = isObject(settings.ai) ? settings.ai : {}
  const lenient = (read, fallback) => {
    try {
      return read()
    } catch {
      return fallback
    }
  }
  const legacyUrl = isHttpUrl(settings.ollamaUrl) ? settings.ollamaUrl : DEFAULT_OLLAMA_URL
  const legacyText = {
    provider: 'ollama',
    // Zeigt die Adresse woandershin, passt die Vorlage für ein entferntes Ollama: Nur sie kennt
    // ein Feld für den Schlüssel, etwa für ein Ollama hinter einem Proxy.
    preset: onThisMachine(legacyUrl) ? 'ollama-local' : 'ollama-remote',
    url: legacyUrl,
    model: typeof settings.ollamaModel === 'string' ? settings.ollamaModel : '',
    vision: null,
  }
  const repairPreset = (slot) =>
    isObject(slot) && PROVIDERS.includes(slot.provider) && !presetById(slot.preset)
      ? { ...slot, preset: defaultPresetFor(slot.provider) }
      : slot
  const field = (name, fallback, valid) => (valid(stored[name]) ? stored[name] : fallback)
  settings.ai = {
    text: lenient(() => validateSlot(repairPreset(stored.text), 'text'), legacyText),
    images: stored.images == null ? null : lenient(() => validateSlot(repairPreset(stored.images), 'images'), null),
    timeoutSeconds: field('timeoutSeconds', null, (v) => inRange(v, LIMITS.timeoutSeconds)),
    numCtx: field('numCtx', null, (v) => inRange(v, LIMITS.numCtx)),
    maxOutputTokens: field('maxOutputTokens', null, (v) => inRange(v, LIMITS.maxOutputTokens)),
    pageImageEdge: field('pageImageEdge', null, (v) => inRange(v, LIMITS.pageImageEdge)),
    jsonMode: field('jsonMode', 'auto', (v) => JSON_MODES.includes(v)),
    reasoningEffort: field('reasoningEffort', null, (v) => typeof v === 'string' && /^[a-z]{1,20}$/.test(v)),
    extraInstructions: field('extraInstructions', '', (v) => typeof v === 'string'),
    consent: isObject(stored.consent) ? stored.consent : {},
  }
  // Eine Version von vor #18 ändert beim Speichern nur ollamaUrl und ollamaModel und reicht `ai`
  // unverändert durch. Weichen die Felder beim Laden ab, stammt die jüngere Änderung von dort,
  // denn diese Version hält sie immer deckungsgleich (mirrorLegacy). So geht nach einem
  // Downgrade und einem erneuten Update nichts verloren.
  if (isObject(stored.text) && settings.ai.text.provider === 'ollama') {
    if (isHttpUrl(settings.ollamaUrl) && settings.ollamaUrl !== settings.ai.text.url) settings.ai.text.url = settings.ollamaUrl
    if (typeof settings.ollamaModel === 'string' && settings.ollamaModel !== settings.ai.text.model) settings.ai.text.model = settings.ollamaModel
  }
  mirrorLegacy(settings)
  return settings
}

function mirrorLegacy(settings) {
  const { text } = settings.ai
  if (text.provider !== 'ollama') return
  settings.ollamaUrl = text.url
  settings.ollamaModel = text.model
}

// ---------- Umgebungsvariablen ----------

// NKA_AI_PROVIDER, NKA_AI_URL und NKA_AI_MODEL legen den Standard-Anbieter fest, etwa im
// Container. NKA_OLLAMA_URL und NKA_OLLAMA_MODEL aus der Zeit vor #18 gelten weiter, aber nur,
// solange Ollama der Anbieter ist: Wer im Compose-Profil „ki“ trotzdem OpenAI wählt, soll nicht
// an der Ollama-Adresse hängen. Liefert { text, ollama, fixed, error }; `error` ist eine Meldung
// für das Startprotokoll oder null.
export function aiFromEnv(env = process.env) {
  const read = (name) => env[name]?.trim() || null
  const text = {}
  const fixed = []
  const errors = []
  const provider = read('NKA_AI_PROVIDER')
  if (provider) {
    if (PROVIDERS.includes(provider)) {
      text.provider = provider
      fixed.push('ai.text.provider')
    } else {
      errors.push(`NKA_AI_PROVIDER „${provider}“ ist unbekannt. Möglich sind ollama und openai.`)
    }
  }
  const urlVar = (name) => {
    const value = read(name)
    if (value && !isHttpUrl(value)) errors.push(`${name} muss eine Adresse mit http:// oder https:// sein.`)
    return value && isHttpUrl(value) ? value : null
  }
  const url = urlVar('NKA_AI_URL')
  if (url) {
    text.url = url
    fixed.push('ai.text.url')
  }
  const model = read('NKA_AI_MODEL')
  if (model) {
    text.model = model
    fixed.push('ai.text.model')
  }
  const ollama = {}
  const ollamaUrl = urlVar('NKA_OLLAMA_URL')
  if (ollamaUrl && !url) ollama.url = ollamaUrl
  const ollamaModel = read('NKA_OLLAMA_MODEL')
  if (ollamaModel && !model) ollama.model = ollamaModel
  // Zeitlimit für alle Schritte, Kontext für Ollama und Antwortlänge für OpenAI-kompatible
  // Dienste. Anders als in der Oberfläche sind auch sehr kleine Werte erlaubt, die Tests
  // brauchen etwa ein Zeitlimit von zwei Sekunden.
  const advanced = {}
  const positiveInt = (name, key) => {
    const value = read(name)
    if (!value) return
    if (!/^\d+$/.test(value) || Number(value) < 1) {
      errors.push(`${name} muss eine ganze Zahl größer als 0 sein.`)
      return
    }
    advanced[key] = Number(value)
    fixed.push(`ai.${key}`)
  }
  positiveInt('NKA_AI_TIMEOUT', 'timeoutSeconds')
  positiveInt('NKA_OLLAMA_NUM_CTX', 'numCtx')
  positiveInt('NKA_AI_MAX_TOKENS', 'maxOutputTokens')
  positiveInt('NKA_AI_IMAGE_EDGE', 'pageImageEdge')
  return { text, ollama, advanced, fixed, error: errors.length ? errors.join(' ') : null }
}

// Pfade der Felder, die gerade aus der Umgebung kommen (für `fixedByEnv` und beim Speichern)
export function fixedFields(ai, env) {
  const provider = env.text.provider ?? ai.text?.provider
  const fromOllama = provider === 'ollama' ? Object.keys(env.ollama).map((f) => `ai.text.${f}`) : []
  return [...env.fixed, ...fromOllama]
}

// Allgemeine Vorlage je Anbieter, wenn die Umgebung einen anderen Anbieter festlegt als den
// gespeicherten und dessen Vorlage deshalb nicht passt
const GENERIC_PRESETS = { ollama: 'ollama-remote', openai: 'openai-compatible' }

// Was tatsächlich gilt: gespeicherte Einstellungen, überlagert von der Umgebung
export function effectiveAi(ai, env) {
  const text = { ...ai.text, ...env.text }
  if (presetById(text.preset)?.provider !== text.provider) text.preset = GENERIC_PRESETS[text.provider]
  if (text.provider === 'ollama') Object.assign(text, env.ollama)
  return { ...ai, ...env.advanced, text }
}

// ---------- Änderungen aus der Oberfläche ----------

// Übernimmt `body.ai` aus PUT /api/settings in `settings.ai`. Felder aus der Umgebung behalten
// ihren gespeicherten Wert, damit Werte aus der Umgebung nicht in die db.json gelangen, und
// `consent` ändert nur die eigene Route. Ein Tab von vor dem Update schickt statt `ai` nur
// ollamaUrl und ollamaModel; die gelten, solange Ollama der Anbieter ist. Wirft mit `status` 400
// und ändert dann nichts.
export function applyAiChanges(settings, body, env) {
  const current = settings.ai
  let raw
  if (isObject(body.ai)) {
    raw = { ...body.ai, text: isObject(body.ai.text) ? { ...body.ai.text } : body.ai.text }
  } else if (typeof body.ollamaUrl === 'string' || typeof body.ollamaModel === 'string') {
    if (current.text.provider !== 'ollama') return settings
    raw = { ...current, text: { ...current.text, url: body.ollamaUrl ?? current.text.url, model: body.ollamaModel ?? current.text.model } }
  } else {
    return settings
  }
  // Vor der Prüfung: Die Oberfläche schickt die wirksamen Werte zurück, auch solche aus der
  // Umgebung, und die dürfen außerhalb der Grenzen der Oberfläche liegen
  for (const path of fixedFields(raw, env)) {
    const [, key, field] = path.split('.')
    if (field === undefined) {
      raw[key] = current[key]
    } else if (isObject(raw[key])) {
      raw[key][field] = current[key][field]
      // Die Vorlage gehört zum Anbieter: Bleibt der gespeicherte, bleibt auch seine Vorlage
      if (field === 'provider') raw[key].preset = current[key].preset
    }
  }
  settings.ai = { ...validateAi(raw), consent: current.consent }
  mirrorLegacy(settings)
  return settings
}

// ---------- Wahl des Anbieters ----------

// Der Platz, der einen Beleg auswertet: Fotos und Scans gehen an den eigenen Bilder-Anbieter,
// falls einer eingerichtet ist, alles andere an den Standard
export function slotFor(ai, { images }) {
  return images && ai.images ? { slot: 'images', ...ai.images } : { slot: 'text', ...ai.text }
}

// ---------- Externe Dienste ----------

// Namen, die im Heimnetz oder im Container aufgelöst werden. Namen ohne Punkt (`nas`, `ollama`)
// gelten ebenfalls als lokal. Alles andere gilt als extern, auch ein eigener Server unter einer
// öffentlichen Domain: Dann verlassen die Belege das Haus, und eine einmalige Bestätigung
// schadet nicht.
const LOCAL_SUFFIXES = ['.localhost', '.local', '.lan', '.home.arpa', '.internal', '.intern', '.fritz.box']
const LOCAL_NAMES = ['localhost', 'fritz.box']

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number)
  return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) // Link-local, Carrier-NAT (etwa Tailscale)
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  const mapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mapped) {
    const [hi, lo] = mapped.slice(1).map((h) => parseInt(h, 16))
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) // Unique Local und Link-local
}

export function isExternalUrl(url) {
  let host
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  } catch {
    return true
  }
  if (net.isIPv4(host)) return !isPrivateIPv4(host)
  if (net.isIPv6(host)) return !isPrivateIPv6(host)
  if (!host.includes('.') || LOCAL_NAMES.includes(host)) return false
  return !LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

// ---------- Bestätigung externer Dienste ----------

// Verlassen die Belege das Haus, schickt Mietfuchs sie erst nach einer einmaligen Bestätigung
// in den Einstellungen (POST /api/ai/consent). Das gilt für eine Adresse außerhalb dieses
// Rechners und des Heimnetzes und für ein Modell, das ein lokales Ollama an einen Cloud-Dienst
// weiterreicht. Die Bestätigung gilt für genau diese Adresse, beim weitergereichten Modell auch
// nur für dieses Modell. Liefert die Meldung, wenn sie fehlt, sonst null. `config` stammt aus
// providerConfig (ai/index.js), `remoteModel` meldet der Anbieter.
export function consentProblem(config, { remoteModel }) {
  const { url, model, consent } = config
  const where = config.slot === 'images' ? 'beim Anbieter für Fotos und Scans' : 'beim KI-Anbieter'
  if (isExternalUrl(url)) {
    if (consent?.url === url) return null
    const host = new URL(url).host
    return `Die Belege gingen an ${host}, also an einen Dienst außerhalb dieses Rechners und des Heimnetzes. Das muss einmal in den Einstellungen ${where} bestätigt werden.`
  }
  if (remoteModel && !(consent?.url === url && consent?.model === model)) {
    return `Das Modell „${model}“ läuft nicht auf diesem Rechner, Ollama reicht die Belege an einen Cloud-Dienst weiter. Das muss einmal in den Einstellungen ${where} bestätigt werden.`
  }
  return null
}
