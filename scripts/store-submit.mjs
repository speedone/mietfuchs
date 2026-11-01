// Reicht ein Release im Microsoft Store ein (#500): Paket, Bildschirmfotos, Beschreibung,
// Funktionen, Suchbegriffe und „Neuigkeiten in dieser Version“ in einer Einreichung, danach
// „nach der Zertifizierung sofort veröffentlichen“. Läuft in store.yml.
//
// Spricht die Submission-API des Partner Centers unmittelbar an statt über die Store-CLI: Paket und
// Bilder gehen dort in ein und dasselbe ZIP, und `msstore publish` lädt nur Pakete hoch. Außerdem
// legt die CLI unter Linux die Zugangsdaten im Schlüsselbund ab, den ein Runner nicht hat.
//
// Ablauf (https://learn.microsoft.com/windows/uwp/monetize/manage-app-submissions):
//   1. Token für die Entra-Anwendung (Client-Credentials)
//   2. offenen Entwurf löschen, neue Einreichung anlegen (Kopie der zuletzt veröffentlichten)
//   3. Einreichung umbauen (buildSubmission) und zurückschreiben
//   4. ZIP mit Paket und Bildern an die Upload-Adresse der Einreichung
//   5. abschicken, warten, bis die Prüfung des Uploads durch ist
//
// Nutzung:
//   node scripts/store-submit.mjs --bundle <Datei.msixbundle> --tag v0.14.0
//   node scripts/store-submit.mjs --bundle <…> --tag <…> --dry-run <Ordner>
// Mit --dry-run wird nur gelesen: Die zuletzt veröffentlichte Einreichung wird geholt, umgebaut
// und mit dem ZIP in den Ordner geschrieben, am Store ändert sich nichts.
// Zugangsdaten aus MSSTORE_TENANT_ID, MSSTORE_CLIENT_ID, MSSTORE_CLIENT_SECRET.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const APP_ID = '9PMHZ0ZJPZDZ'
export const LANGUAGE = 'de-de'
const API = 'https://manage.devcenter.microsoft.com/v1.0/my'

// Reihenfolge wie im Store. Die Dateien entstehen mit `npm run screenshots` beim Release neu;
// „belegordner“ zeigt die Seite „Belege“ (Reiter „Ordner“), der Dateiname ist älter.
export const SCREENSHOTS = [
  { file: 'cockpit.png', description: 'Cockpit: was im Abrechnungsjahr noch fehlt' },
  { file: 'kosten.png', description: 'Kosten mit Umlageschlüssel und Rechenweg' },
  { file: 'abrechnung.png', description: 'Fertige Nebenkostenabrechnung für einen Mieter' },
  { file: 'belegordner.png', description: 'Belege: Eingang und Ordner' },
]

/**
 * Liest Beschreibung, Funktionen und Suchbegriffe aus packaging/msix/store-eintrag.md, dazu aus den
 * Eigenschaften Website, Datenschutzrichtlinie und Supportkontakt. Harte Zeilenumbrüche eines Absatzes
 * werden zusammengezogen, Aufzählungspunkte („• “) bleiben je eine Zeile.
 * @param {string} md
 * @returns {{ description: string, features: string[], keywords: string[], websiteUrl: string, privacyPolicy: string, supportContact: string }}
 */
export function parseListing(md) {
  /** @param {string} start @param {string} end */
  const between = (start, end) => {
    const a = md.indexOf(start)
    if (a < 0) throw new Error(`„${start}“ fehlt in store-eintrag.md`)
    const b = md.indexOf(end, a + start.length)
    if (b < 0) throw new Error(`„${end}“ fehlt in store-eintrag.md`)
    return md.slice(a + start.length, b)
  }
  const paragraphs = between('**Beschreibung**\n', '**Funktionen**').trim().split(/\n\s*\n/)
  const description = paragraphs
    .map((p) => {
      /** @type {string[]} */
      const out = []
      for (const line of p.split('\n').map((l) => l.trim())) {
        if (out.length === 0 || line.startsWith('• ')) out.push(line)
        else out[out.length - 1] += ` ${line}`
      }
      return out.join('\n')
    })
    .join('\n\n')
  const features = between('**Funktionen**', '**Suchbegriffe**')
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
  const keywords = between('**Suchbegriffe**:', '\n\n')
    .split(',')
    .map((k) => k.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  // Grenzen des Partner Centers
  if (description.length > 10000) throw new Error('Beschreibung länger als 10.000 Zeichen')
  if (features.length > 20 || features.some((f) => f.length > 200)) throw new Error('Höchstens 20 Funktionen zu je 200 Zeichen')
  if (keywords.length > 7 || keywords.some((k) => k.length > 40)) throw new Error('Höchstens 7 Suchbegriffe zu je 40 Zeichen')
  if (keywords.join(' ').split(/\s+/).length > 21) throw new Error('Suchbegriffe zusammen höchstens 21 Wörter')
  /** @param {string} label */
  const property = (label) => {
    const m = new RegExp(`^- ${label}: (https://\\S+)$`, 'm').exec(md)
    if (!m?.[1]) throw new Error(`„${label}“ fehlt in den Eigenschaften von store-eintrag.md`)
    return m[1]
  }
  return { description, features, keywords, websiteUrl: property('Website'), privacyPolicy: property('Datenschutzrichtlinie'), supportContact: property('Supportkontakt') }
}

/** @param {string} tag */
export function releaseNotes(tag, repository = 'speedone/mietfuchs') {
  return `Mietfuchs ${tag.replace(/^v/, '')}. Was neu ist und was beim Update zu beachten ist, steht unter https://github.com/${repository}/releases/tag/${tag}`
}

/**
 * Baut aus der frisch angelegten Einreichung (Kopie der zuletzt veröffentlichten) die neue. Wie
 * `msstore publish`: Ein hochgeladenes Paket mit derselben Endung wird zum Löschen markiert, ein
 * noch nicht hochgeladenes entfernt. Alle Bildschirmfotos der Sprache werden ersetzt, andere Bilder
 * (Logos, Trailer-Bilder) bleiben. Das ZIP ist flach: Ob das Partner Center „/“ in Pfaden annimmt,
 * ist nicht belegt (die Doku zeigt nur „\\“). Die neuen Bilder tragen deshalb den Tag im Namen und
 * fallen so nicht mit den alten zusammen, die im selben Zug gelöscht werden; das Bündel heißt
 * ohnehin je Version anders.
 * @param {any} submission
 * @param {{ bundle: string, tag: string, listing: { description: string, features: string[], keywords: string[], websiteUrl: string, privacyPolicy: string, supportContact: string }, notes: string }} input
 */
export function buildSubmission(submission, { bundle, tag, listing, notes }) {
  const next = structuredClone(submission)
  const ext = path.extname(bundle)
  const packages = (next.applicationPackages ?? []).filter((/** @type {any} */ p) => !(p.fileStatus === 'PendingUpload' && path.extname(p.fileName) === ext))
  for (const p of packages) if (path.extname(p.fileName) === ext) p.fileStatus = 'PendingDelete'
  packages.push({ fileName: path.basename(bundle), fileStatus: 'PendingUpload' })
  next.applicationPackages = packages

  const base = next.listings?.[LANGUAGE]?.baseListing
  if (!base) throw new Error(`Die Einreichung hat keinen Eintrag für ${LANGUAGE}`)
  const images = (base.images ?? []).filter((/** @type {any} */ i) => !(i.imageType === 'Screenshot' && i.fileStatus === 'PendingUpload'))
  for (const i of images) if (i.imageType === 'Screenshot') i.fileStatus = 'PendingDelete'
  for (const s of SCREENSHOTS) images.push({ fileName: screenshotName(tag, s.file), fileStatus: 'PendingUpload', imageType: 'Screenshot', description: s.description })
  base.images = images
  base.description = listing.description
  base.features = listing.features
  base.keywords = listing.keywords
  base.websiteUrl = listing.websiteUrl
  base.privacyPolicy = listing.privacyPolicy
  base.supportContact = listing.supportContact
  base.releaseNotes = notes

  next.targetPublishMode = 'Immediate'
  return next
}

/** @param {string} tag @param {string} file */
const screenshotName = (tag, file) => `${tag}-${file}`

// Nach dem Abschicken: CommitStarted, solange der Store den Upload prüft; danach PreProcessing und die
// Schritte der Zertifizierung. Alles andere ist ein Fehler, auch ein Status, den das Skript nicht kennt,
// und jede Fehlerliste in statusDetails (so bricht auch die Store-CLI ab).
const GOOD = new Set(['PreProcessing', 'Certification', 'Release', 'Publishing', 'Published', 'PendingPublication'])
/**
 * @param {{ status?: string, statusDetails?: any }} status
 * @returns {'wait' | 'ok' | 'failed'}
 */
export function commitOutcome({ status, statusDetails }) {
  if (statusDetails?.errors?.length) return 'failed'
  if (status === 'CommitStarted') return 'wait'
  return status && GOOD.has(status) ? 'ok' : 'failed'
}

// Nur Codes und Texte der Fehler und Warnungen: Berichte der Zertifizierung können signierte Adressen
// enthalten, und das Log eines öffentlichen Repos liest jeder.
/** @param {any} details */
const describeDetails = (details) =>
  ['errors', 'warnings']
    .flatMap((k) => (details?.[k] ?? []).map((/** @type {any} */ e) => `${k === 'errors' ? 'Fehler' : 'Warnung'} ${e.code}: ${e.details ?? ''}`))
    .join('; ')

// Einen Entwurf, den jemand im Partner Center begonnen hat (etwa mit „Aktualisieren“), darf die API
// weder ändern noch löschen; er blockiert jede Einreichung, bis er dort gelöscht ist.
/** @param {string} message */
export function draftHint(message) {
  return /created through the API/.test(message)
    ? 'Im Partner Center liegt ein Entwurf, der dort von Hand begonnen wurde. Die API darf ihn nicht löschen. Löschen Sie ihn im Partner Center (Mietfuchs → Einreichungen) und starten Sie store.yml mit der Nummer des Release-Laufs neu. Texte des Eintrags gehören in packaging/msix/store-eintrag.md.'
    : null
}

/** @param {string} url @param {RequestInit & { token: string }} init */
async function api(url, { token, ...init }) {
  const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url}: HTTP ${res.status} ${text.slice(0, 800)}`)
  return text ? JSON.parse(text) : null
}

async function getToken() {
  const env = process.env
  for (const name of ['MSSTORE_TENANT_ID', 'MSSTORE_CLIENT_ID', 'MSSTORE_CLIENT_SECRET']) {
    if (!env[name]) throw new Error(`${name} fehlt`)
  }
  const res = await fetch(`https://login.microsoftonline.com/${env.MSSTORE_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: String(env.MSSTORE_CLIENT_ID),
      client_secret: String(env.MSSTORE_CLIENT_SECRET),
      grant_type: 'client_credentials',
      scope: 'https://manage.devcenter.microsoft.com/.default',
    }),
  })
  /** @type {any} */
  const body = await res.json()
  if (!body.access_token) throw new Error(`Anmeldung bei Microsoft Entra gescheitert: ${body.error} ${String(body.error_description ?? '').split('\n')[0]}`)
  return String(body.access_token)
}

/** @param {string} zipFile @param {string} tag @param {string} bundle */
function buildZip(zipFile, tag, bundle) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-store-'))
  /** @type {string[]} */
  const names = [path.basename(bundle)]
  fs.copyFileSync(bundle, path.join(stage, names[0]))
  for (const s of SCREENSHOTS) {
    names.push(screenshotName(tag, s.file))
    fs.copyFileSync(path.join(root, 'docs', 'screenshots', s.file), path.join(stage, names[names.length - 1]))
  }
  fs.rmSync(zipFile, { force: true })
  execFileSync('zip', ['-q', '-X', path.resolve(zipFile), ...names], { cwd: stage })
  fs.rmSync(stage, { recursive: true, force: true })
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`Unklarer Aufruf bei „${argv[i]}“`)
    args[argv[i].slice(2)] = argv[i + 1]
  }
  if (!args.bundle || !args.tag) throw new Error('Aufruf: --bundle <Datei> --tag <vX.Y.Z> [--dry-run <Ordner>]')
  if (!/^v\d+\.\d+\.\d+$/.test(args.tag)) throw new Error(`Kein Tag ohne Bindestrich: ${args.tag}`)
  if (!fs.existsSync(args.bundle)) throw new Error(`Paket fehlt: ${args.bundle}`)
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const listing = parseListing(fs.readFileSync(path.join(root, 'packaging', 'msix', 'store-eintrag.md'), 'utf8'))
  const notes = releaseNotes(args.tag, process.env.GITHUB_REPOSITORY)
  const token = await getToken()
  const app = await api(`/applications/${APP_ID}`, { token })
  const published = app.lastPublishedApplicationSubmission?.id
  if (!published) throw new Error('Keine veröffentlichte Einreichung; die erste geht von Hand im Partner Center')

  if (args['dry-run']) {
    const out = args['dry-run']
    fs.mkdirSync(out, { recursive: true })
    const last = await api(`/applications/${APP_ID}/submissions/${published}`, { token })
    const next = buildSubmission(last, { bundle: args.bundle, tag: args.tag, listing, notes })
    fs.writeFileSync(path.join(out, 'submission.json'), JSON.stringify(next, null, 2))
    buildZip(path.join(out, 'upload.zip'), args.tag, args.bundle)
    console.log(`Probelauf: ${path.join(out, 'submission.json')} und upload.zip geschrieben, am Store nichts geändert.`)
    return
  }

  const pending = app.pendingApplicationSubmission?.id
  if (pending) {
    // Ein Entwurf von Hand im Partner Center geht dabei verloren; Texte gehören in store-eintrag.md
    const draft = await api(`/applications/${APP_ID}/submissions/${pending}`, { token })
    console.log(`Offenen Entwurf ${pending} (${draft.status}) löschen`)
    await api(`/applications/${APP_ID}/submissions/${pending}`, { token, method: 'DELETE' }).catch((err) => {
      const hint = draftHint(String(err?.message))
      throw hint ? new Error(`${hint}\n${err.message}`) : err
    })
  }
  const created = await api(`/applications/${APP_ID}/submissions`, { token, method: 'POST' })
  console.log(`Einreichung ${created.id} angelegt`)
  const next = buildSubmission(created, { bundle: args.bundle, tag: args.tag, listing, notes })
  const updated = await api(`/applications/${APP_ID}/submissions/${created.id}`, { token, method: 'PUT', body: JSON.stringify(next) })
  const uploadUrl = String(updated?.fileUploadUrl ?? created.fileUploadUrl)

  const zipFile = path.join(os.tmpdir(), `mietfuchs-store-${args.tag}.zip`)
  buildZip(zipFile, args.tag, args.bundle)
  console.log(`ZIP hochladen (${Math.round(fs.statSync(zipFile).size / 1e6)} MB)`)
  const upload = await fetch(uploadUrl.replaceAll('+', '%2B'), {
    method: 'PUT',
    headers: { 'x-ms-blob-type': 'BlockBlob', 'x-ms-version': '2021-08-06', 'Content-Type': 'application/zip' },
    body: fs.readFileSync(zipFile),
  })
  if (!upload.ok) throw new Error(`Upload: HTTP ${upload.status} ${(await upload.text()).slice(0, 400)}`)

  await api(`/applications/${APP_ID}/submissions/${created.id}/commit`, { token, method: 'POST' })
  console.log('Abgeschickt, warte auf die Prüfung des Uploads')
  // Die Prüfung des Uploads dauert meist Minuten; ein Token gilt rund eine Stunde, deshalb je Abfrage neu
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 30_000))
    const status = await api(`/applications/${APP_ID}/submissions/${created.id}/status`, { token: await getToken() })
    const outcome = commitOutcome(status)
    if (outcome === 'wait') continue
    const details = describeDetails(status.statusDetails)
    if (outcome === 'failed') throw new Error(`Einreichung ${created.id} abgelehnt, Status ${status.status}. ${details}`)
    console.log(`Status ${status.status}. Nach der Zertifizierung veröffentlicht der Store von selbst. ${details}`)
    return
  }
  throw new Error('Nach einer Stunde immer noch CommitStarted; Stand im Partner Center ansehen')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
