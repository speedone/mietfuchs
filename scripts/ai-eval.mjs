// KI-Prüflauf (#17): Ein echtes Modell wertet über Mietfuchs erfundene Beispielbelege aus, das
// Ergebnis wird mit den Sollwerten verglichen. Läuft in .github/workflows/ai-eval.yml auf
// GitHub-Runnern, damit für einen Modellvergleich niemand Gigabytes herunterladen muss. Die
// Belege liegen als HTML in scripts/ai-eval/ und sind frei erfunden.
//
// Aus jedem Beleg entstehen mit Chrome bis zu drei Fassungen, so wie sie in Mietfuchs ankommen:
//   text   PDF mit Textebene; den Text liest pdf.js wie im Browser (client/src/pdfIntake.ts)
//   scan   dasselbe PDF ohne Textebene, dazu die Seiten als Bilder (höchstens vier)
//   photo  die erste Seite als schiefes, unscharfes Handyfoto (nur einseitige Belege)
//
// Aufruf gegen eine laufende Instanz, deren Modell geprüft werden soll:
//   node scripts/ai-eval.mjs --url http://127.0.0.1:3001 --ollama http://127.0.0.1:11434 \
//     --model qwen3.5:4b --out ergebnis.json [--only water,waste] [--variants text,scan] [--keep]
// Mehrere Ergebnisse zu einer Tabelle zusammenfassen:
//   node scripts/ai-eval.mjs --summarize ordner-mit-ergebnissen/
//
// Braucht Chrome oder Chromium (--chrome oder CHROME, sonst gesucht) und das installierte Client-
// Paket (pdfjs-dist). Die Tabelle landet in $GITHUB_STEP_SUMMARY, lokal auf der Konsole.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evalDir = path.join(root, 'scripts', 'ai-eval')

// Wie der Browser: Seiten mit Faktor 2 bezogen auf 72 dpi, höchstens vier (client/src/pdf.ts)
const MAX_PAGES = 4
const PAGE_CSS_PX = { width: 794, height: 1123 } // A4 bei 96 dpi
const DEVICE_SCALE = 1.5 // 794 × 1,5 ≈ 1191 px, wie pdf.js mit Faktor 2 auf 595 pt
const TEXT_MAX = 20000
const VARIANT_LABELS = { text: 'Text', scan: 'Scan', photo: 'Foto' }

// ---------- Chrome ----------

function findChrome() {
  const candidates = [
    opt('chrome'),
    process.env.CHROME,
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' })
    if (probe.status === 0) return candidate
  }
  throw new Error('Chrome oder Chromium nicht gefunden. Pfad mit --chrome oder CHROME angeben.')
}

function chrome(binary, profileDir, args, url) {
  const result = spawnSync(
    binary,
    ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profileDir}`, ...args, url],
    { encoding: 'utf8', timeout: 60000 },
  )
  if (result.status !== 0) throw new Error(`Chrome scheiterte: ${result.stderr || result.error}`)
}

// Legt je Beleg das PDF, die Seitenbilder (Scan) und das Foto an und liefert die Pfade
function render(binary, workDir, testCase) {
  const html = path.join(evalDir, testCase.file)
  const url = (query = '') => `${pathToFileURL(html).href}${query}`
  const profile = path.join(workDir, 'chrome-profil')
  const out = path.join(workDir, testCase.name)
  fs.mkdirSync(out, { recursive: true })
  const pdf = path.join(out, `${testCase.name}.pdf`)
  chrome(binary, profile, ['--no-pdf-header-footer', '--print-to-pdf-no-header', `--print-to-pdf=${pdf}`], url())
  const screenshot = (file, query) => {
    const target = path.join(out, file)
    chrome(binary, profile, [`--window-size=${PAGE_CSS_PX.width},${PAGE_CSS_PX.height}`, `--force-device-scale-factor=${DEVICE_SCALE}`, `--screenshot=${target}`], url(query))
    return target
  }
  const pages = []
  for (let n = 1; n <= Math.min(testCase.pages, MAX_PAGES); n++) pages.push(screenshot(`seite-${n}.png`, `?page=${n}&scan`))
  const photo = testCase.photo ? screenshot('foto.png', '?page=1&photo') : null
  return { pdf, pages, photo }
}

// ---------- Textebene wie im Browser ----------

async function pdfText(pdfPath) {
  const pdfjsPath = path.join(root, 'client', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')
  const { getDocument, VerbosityLevel } = await import(pathToFileURL(pdfjsPath).href)
  const task = getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), verbosity: VerbosityLevel.ERRORS })
  try {
    const doc = await task.promise
    let text = ''
    for (let n = 1; n <= doc.numPages && text.length < TEXT_MAX; n++) {
      const page = await doc.getPage(n)
      // wie seitenText() in client/src/pdfIntake.ts
      text += (await page.getTextContent()).items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : ' ') : '')).join('') + '\n'
    }
    return text
  } finally {
    await task.destroy()
  }
}

// ---------- Auswertung über Mietfuchs ----------

// Wie der Browser: als Strom (Accept: application/x-ndjson), damit auch Läufe über fünf Minuten
// ankommen. Liefert Ergebnis oder Fehler, die Kennzahlen und die Dauer.
async function extract(baseUrl, { file, mimeType, fileName, text, pages = [] }) {
  const fd = new FormData()
  fd.append('file', new Blob([fs.readFileSync(file)], { type: mimeType }), fileName)
  if (text !== undefined) fd.append('pdfText', text)
  for (const [i, page] of pages.entries()) fd.append('pages', new Blob([fs.readFileSync(page)], { type: 'image/png' }), `seite-${i + 1}.png`)
  const start = Date.now()
  const res = await fetch(`${baseUrl}/api/extract`, { method: 'POST', body: fd, headers: { accept: 'application/x-ndjson' } })
  const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const seconds = Math.round((Date.now() - start) / 100) / 10
  const last = lines.at(-1) ?? {}
  if (last.type === 'result') return { extraction: last.data.extraction, stats: last.data.stats ?? [], seconds }
  return { error: last.error ?? `unerwartete Antwort (HTTP ${res.status})`, stats: last.stats ?? [], seconds }
}

// ---------- Bewertung ----------

const near = (actual, expected, tolerance = 0.011) => typeof actual === 'number' && Math.abs(actual - expected) <= tolerance

// Jede Prüfung zählt gleich. Zusätzliche Positionen (etwa Abschläge oder Nettobeträge als eigene
// Zeile) zählen als Fehler, Positionen über 0,00 € (gebührenfreie Tonne) nicht.
export function score(expected, extraction) {
  const checks = []
  const add = (name, ok) => checks.push({ name, ok: Boolean(ok) })
  add('Summe', near(extraction?.totalGrossEur, expected.total))
  add('Aussteller', String(extraction?.vendor ?? '').toLowerCase().includes(expected.vendor.toLowerCase()))
  const positions = (Array.isArray(extraction?.positions) ? extraction.positions : []).filter((p) => Math.abs(Number(p?.amountEur) || 0) > 0.001)
  if (expected.positions) {
    const unused = [...positions]
    for (const e of expected.positions) {
      const i = unused.findIndex((p) => near(p.amountEur, e.amount))
      const found = i >= 0 ? unused.splice(i, 1)[0] : null
      add(`Betrag ${e.amount}`, found)
      add(`Kostenart ${e.category}`, found?.category === e.category)
    }
    for (const p of unused) add(`zusätzliche Position ${p.amountEur}`, false)
  }
  if (expected.allCategory) add(`Kostenart ${expected.allCategory}`, positions.length > 0 && positions.every((p) => p.category === expected.allCategory))
  if (expected.labor35a != null) {
    const labor = positions.reduce((sum, p) => sum + (Number(p.labor35aEur) || 0), 0)
    add('Lohnanteil § 35a', near(labor, expected.labor35a, 0.021))
  }
  const passed = checks.filter((c) => c.ok).length
  return { points: checks.length ? passed / checks.length : 0, passed, total: checks.length, failed: checks.filter((c) => !c.ok).map((c) => c.name) }
}

// ---------- Ausgabe ----------

const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)} %`)
const secs = (x) => (x == null ? '–' : x >= 60 ? `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')} min` : `${Math.round(x)} s`)
const gb = (bytes) => (bytes ? `${(bytes / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB` : '–')
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

function modelTable(result) {
  const rows = result.runs.map((r) => {
    const stat = r.stats?.find((s) => s.step === 'extraction')
    const detail = r.error ? `Fehler: ${r.error.slice(0, 120)}` : r.score.failed.length ? `falsch: ${r.score.failed.join(', ')}` : 'alles richtig'
    return `| ${r.label} | ${VARIANT_LABELS[r.variant]} | ${r.error ? '0 %' : pct(r.score.points)} | ${secs(r.seconds)} | ${stat?.promptTokens ?? '–'} | ${detail} |`
  })
  return [
    `### ${result.model}`,
    '',
    `Speicher im Betrieb: ${gb(result.memoryBytes)}, Download: ${gb(result.sizeBytes)}, erstes Laden: ${secs(result.warmupSeconds)}`,
    '',
    '| Beleg | Fassung | Treffer | Dauer | Eingabe-Token | Anmerkung |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

function summaryTable(results) {
  const byVariant = (result, variant) => {
    const runs = result.runs.filter((r) => r.variant === variant)
    return { points: mean(runs.map((r) => (r.error ? 0 : r.score.points))), seconds: mean(runs.map((r) => r.seconds)) }
  }
  const rows = results
    .sort((a, b) => (a.memoryBytes ?? 0) - (b.memoryBytes ?? 0))
    .map((r) => {
      const cells = ['text', 'scan', 'photo'].map((v) => {
        const x = byVariant(r, v)
        return x.points == null ? '–' : `${pct(x.points)}, Ø ${secs(x.seconds)}`
      })
      return `| ${r.model} | ${gb(r.memoryBytes)} | ${cells.join(' | ')} |`
    })
  return ['## KI-Prüflauf: Übersicht', '', '| Modell | Speicher | Text | Scan | Foto |', '|---|---|---|---|---|', ...rows, ''].join('\n')
}

function report(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
  console.log(markdown)
}

// ---------- Ablauf ----------

async function ollamaInfo(ollamaUrl, model) {
  if (!ollamaUrl) return {}
  try {
    const tags = await (await fetch(`${ollamaUrl}/api/tags`)).json()
    const ps = await (await fetch(`${ollamaUrl}/api/ps`)).json()
    const wanted = model.includes(':') ? model : `${model}:latest`
    return {
      sizeBytes: tags.models?.find((m) => m.name === wanted)?.size ?? null,
      memoryBytes: ps.models?.find((m) => m.name === wanted)?.size ?? null,
    }
  } catch {
    return {}
  }
}

async function evaluate() {
  const baseUrl = opt('url', 'http://127.0.0.1:3001').replace(/\/+$/, '')
  const ollamaUrl = opt('ollama')?.replace(/\/+$/, '')
  const model = opt('model', 'unbekannt')
  const only = opt('only')?.split(',')
  const variants = (opt('variants') ?? 'text,scan,photo').split(',')
  const { cases } = JSON.parse(fs.readFileSync(path.join(evalDir, 'cases.json'), 'utf8'))
  const selected = cases.filter((c) => !only || only.includes(c.name))
  const binary = findChrome()
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-ki-pruefung-'))
  console.log(`KI-Prüflauf mit ${model} gegen ${baseUrl} (Chrome: ${binary})`)

  const prepared = []
  for (const testCase of selected) {
    const files = render(binary, workDir, testCase)
    prepared.push({ testCase, files, text: await pdfText(files.pdf) })
  }

  // Einmal vorab auswerten, damit das Laden des Modells nicht in die erste Messung fällt
  const first = prepared[0]
  const warmup = await extract(baseUrl, { file: first.files.pdf, mimeType: 'application/pdf', fileName: 'aufwaermen.pdf', text: first.text })
  console.log(`  Aufwärmen: ${secs(warmup.seconds)}${warmup.error ? ` (Fehler: ${warmup.error})` : ''}`)

  const runs = []
  for (const { testCase, files, text } of prepared) {
    const inputs = {
      text: { file: files.pdf, mimeType: 'application/pdf', fileName: `${testCase.name}.pdf`, text },
      scan: { file: files.pdf, mimeType: 'application/pdf', fileName: `${testCase.name}-scan.pdf`, text: '', pages: files.pages },
      photo: files.photo && { file: files.photo, mimeType: 'image/png', fileName: `${testCase.name}-foto.png` },
    }
    for (const variant of variants) {
      if (!inputs[variant]) continue
      const answer = await extract(baseUrl, inputs[variant])
      const run = { case: testCase.name, label: testCase.label, variant, seconds: answer.seconds, stats: answer.stats }
      if (answer.error) run.error = answer.error
      else {
        run.score = score(testCase.expected, answer.extraction)
        run.extraction = answer.extraction
      }
      runs.push(run)
      console.log(`  ${testCase.name} ${variant}: ${answer.error ? `Fehler: ${answer.error}` : pct(run.score.points)} in ${secs(answer.seconds)}`)
    }
  }

  const result = { format: 1, model, date: new Date().toISOString(), warmupSeconds: warmup.seconds, ...(await ollamaInfo(ollamaUrl, model)), runs }
  const out = opt('out')
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2))
  report(modelTable(result))
  // --keep lässt PDFs und Bilder zum Ansehen liegen
  if (argv.includes('--keep')) console.log(`Erzeugte Belege: ${workDir}`)
  else fs.rmSync(workDir, { recursive: true, force: true })
}

function summarize(dir) {
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.json'))
  const results = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, String(f)), 'utf8'))).filter((r) => r.format === 1)
  if (results.length === 0) throw new Error(`Keine Ergebnisse in ${dir}`)
  report(summaryTable(results))
}

const summarizeDir = opt('summarize')
const task = summarizeDir ? Promise.resolve().then(() => summarize(summarizeDir)) : evaluate()
task.catch((err) => {
  console.error(`\n✗ ${err.message}`)
  process.exitCode = 1
})
