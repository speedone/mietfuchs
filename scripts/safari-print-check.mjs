// Druck der Nebenkostenabrechnung in Safari (WebKit unter macOS), automatisch geprüft (#286). Bisher eine Probe von
// Hand („Als PDF sichern“ in Safari auf dem Mac), weil Playwright mit WebKit unter Linux nicht druckt.
//
// Ablauf: Server aus dem Quellcode mit dem Beispielbestand (demo-stock.mjs, Wegwerf-Ordner, CI=1, Update-Adresse auf
// einem geschlossenen Port), dann je Fall dieselbe Bedienung der Seite Abrechnung zweimal:
//   - Safari: das Swift-Programm in safari-print/main.swift (WKWebView, NSPrintOperation mit Disposition „save“, A4),
//   - Chromium: Playwright mit `page.pdf()`, als Vergleich (dieselbe Seite, derselbe Rechner, dieselben Schriften).
// Die Bedienung (`drivePage` unten) klickt in der Oberfläche wie ein Mensch: Abrechnung, „Drucken / PDF“, Mieter wählen,
// „Anschreiben mitdrucken“, „Drucken“, Rückfragen bejahen. `window.print()` fängt das Vorspiel ab (`prelude`), gedruckt
// wird danach mit dem Zustand, den die Seite vor `window.print()` gesetzt hat. Strg+P ist der Druck ohne Bedienung.
//
// Danach liest pdf.js (client/node_modules) jede PDF und prüft (`checkPdf`): Seitenzahl gleich Chromium, A4, jede
// Mieterabrechnung auf neuer Seite, „Seite x von y“ und Fußvermerk, wo sie hingehören, kein Text außerhalb des
// Satzspiegels (links 25 mm, rechts 20 mm, #438), kein Text der Oberfläche. Jeder Befund: eine Zeile in
// `<out>/bericht.md` und Exit 1. Seitenbilder (PNG) und PDFs liegen in `<out>`.
//
//   node scripts/safari-print-check.mjs --out <ordner>                 (macOS: Safari und Chromium)
//   node scripts/safari-print-check.mjs --out <ordner> --engines chromium   (jedes System, nur der Vergleich)
//   node scripts/safari-print-check.mjs --out <ordner> --evaluate      (nur Auswertung vorhandener PDFs)
//   --cases a,b   nur diese Fälle;   --safari-bin <datei>   fertig übersetztes Swift-Programm
//   --safari-margins l,r,t,b   Ränder der Seiteneinstellung in Punkt (Vorgabe: die von NSPrintInfo, 72/72/90/90)
//
// Exit 0 ohne Befund, 1 mit Befunden (Bericht vollständig), 2 wenn der Lauf selbst scheitert (kein Bericht).
//
// Voraussetzungen: `npm install`, `npm run build`, `npx playwright install chromium`; für Safari macOS mit `swiftc`.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// demo-stock.mjs (und mit ihm Playwright) wird erst im Ablauf geladen, damit auch ein kaputter Import als gescheiterter
// Lauf endet (Exit 2) und nicht wie Befunde (Exit 1).
/** @type {typeof import('./demo-stock.mjs')} */
let stock

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MM = 25.4 / 72

// ---------- Aufruf ----------
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const option = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const out = path.resolve(option('--out') ?? path.join(root, 'safari-print-out'))
const engines = (option('--engines') ?? (process.platform === 'darwin' ? 'safari,chromium' : 'chromium')).split(',')
function checkArguments() {
  for (const e of engines) if (e !== 'safari' && e !== 'chromium') throw new Error(`Unbekannte Engine: ${e}`)
  if (engines.includes('safari') && process.platform !== 'darwin') throw new Error('Safari gibt es nur unter macOS.')
  }

// ---------- Fälle ----------
// Dieselben wie die Druckproben zu #438. `letter`: ob ein Anschreiben gedruckt wird; `paper`: Briefpapier (ohne Rand,
// ohne Seitenzahl); `banner`: der Hinweis „Sicherung vor dem Update angelegt“ steht auf der Seite (darf nicht in den Druck).
/** @typedef {{ name: string, title: string, mode: 'ctrl-p' | 'drawer', tenant?: string, letter: boolean, paper?: boolean, banner?: boolean, setup?: string }} PrintCase */
/** @type {PrintCase[]} */
const CASES = [
  { name: 'strg-p-alle', title: 'Strg+P, alle Mieter', mode: 'ctrl-p', letter: true },
  { name: 'banner-einer-becker', title: 'Ein Mieter, Hinweis der Datenbank auf der Seite', mode: 'drawer', tenant: 'Anna Becker', letter: true, banner: true },
  { name: 'einer-becker-heizung-35a', title: 'Ein Mieter mit Anschreiben, Heizung und § 35a', mode: 'drawer', tenant: 'Anna Becker', letter: true },
  { name: 'auszug-hartmann', title: 'Ein Mieter mit Auszug', mode: 'drawer', tenant: 'Jonas Hartmann', letter: true },
  { name: 'einer-becker-ohne-anschreiben', title: 'Ein Mieter ohne Anschreiben', mode: 'drawer', tenant: 'Anna Becker', letter: false },
  { name: 'strg-p-ohne-anschreiben', title: 'Strg+P, alle Mieter, Vorgabe ohne Anschreiben', mode: 'ctrl-p', letter: false, setup: 'no-letter' },
  { name: 'briefpapier-becker', title: 'Ein Mieter mit Logo und Briefpapier', mode: 'drawer', tenant: 'Anna Becker', letter: true, paper: true, setup: 'paper' },
  { name: 'logo-becker', title: 'Ein Mieter mit Logo', mode: 'drawer', tenant: 'Anna Becker', letter: true, setup: 'logo' },
]
const only = option('--cases')?.split(',')
const cases = only ? CASES.filter((c) => only.includes(c.name)) : CASES

// Texte der Oberfläche, die nie im Druck stehen dürfen: Navigation (ganze Zeile), Knöpfe und Hinweise (Teil der Zeile).
// Nicht dabei sind Wörter, die auch die Abrechnung druckt („Abrechnung“, „Kosten“, „Heizkosten“).
const UI_LINES = ['Cockpit', 'Schnellerfassung', 'Zähler & Stände', 'Belegordner', 'Mietkonto', 'Kostenvergleich', 'Steuer (Anlage V)', 'Stammdaten', 'Einstellungen', 'Verlauf', 'Hilfe & Begriffe', 'Sammeln', 'Abrechnen', 'Einrichten', 'Zu prüfen', 'Kontrolle', 'Ansehen', 'Mehr']
const UI_PARTS = ['Drucken / PDF', 'Was drucken?', 'Anschreiben mitdrucken', 'Hier beheben', 'Sicherung vor dem Update', 'Strg+S druckt', 'Rechenweg zeigen', 'Falz- und Lochmarken drucken']

// ---------- Im Browser: Vorspiel und Bedienung ----------
// Beide Funktionen laufen in der Seite (Safari über das Swift-Programm, Chromium über Playwright) und werden als Text
// übergeben; sie dürfen deshalb nichts von außen verwenden.
/** @param {{ banner: boolean }} options */
function prelude(options) {
  const win = /** @type {any} */ (globalThis)
  try { win.localStorage.setItem('nka-theme', 'light') } catch { /* ohne Speicher hell aus der Vorgabe */ }
  win.__printed = 0
  win.print = () => { win.__printed += 1 }
  const post = (text) => { try { win.webkit?.messageHandlers?.mietfuchs?.postMessage(String(text)) } catch { /* nur Safari */ } }
  win.addEventListener('error', (e) => post(`Fehler: ${e.message}`))
  const consoleError = win.console.error.bind(win.console)
  win.console.error = (...a) => { post(`console.error: ${a.join(' ')}`); consoleError(...a) }
  if (options.banner) {
    // Der Hinweis „Sicherung vor dem Update angelegt“, nachgestellt über die Antwort von /healthz
    const original = win.fetch.bind(win)
    win.fetch = async (input, init) => {
      const res = await original(input, init)
      const url = typeof input === 'string' ? input : input.url
      if (!String(url).endsWith('/healthz')) return res
      const body = await res.clone().json()
      body.database = { ...(body.database ?? {}), migrated: { steps: 2, backup: 'mietfuchs.sqlite.vor-0075_x', at: '2026-10-20T10:00:00.000Z' } }
      return new win.Response(JSON.stringify(body), { status: res.status, headers: { 'content-type': 'application/json' } })
    }
  }
}

/** @param {{ mode: string, tenant?: string, withLetter: boolean }} args */
async function drivePage(args) {
  const win = /** @type {any} */ (globalThis)
  const doc = win.document
  const steps = []
  const sleep = (ms) => new Promise((r) => win.setTimeout(r, ms))
  const until = async (fn, what, ms = 30000) => {
    const end = Date.now() + ms
    for (;;) {
      const v = fn()
      if (v) return v
      if (Date.now() > end) throw new Error(`Nicht erschienen: ${what} (Schritte: ${steps.join(' → ')})`)
      await sleep(100)
    }
  }
  const text = (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const nav = await until(() => [...doc.querySelectorAll('nav.sidebar button')].find((b) => text(b).includes('Abrechnung')), 'Abrechnung in der Seitenleiste')
  nav.click()
  steps.push('Abrechnung')
  const printButton = await until(() => [...doc.querySelectorAll('button')].find((b) => text(b).includes('Drucken / PDF') && !b.disabled), 'Knopf „Drucken / PDF“')
  await until(() => doc.querySelector('.card.statement'), 'Mieterabrechnungen')
  await sleep(800)
  const imagesReady = () => [...doc.images].every((img) => img.complete)
  if (args.mode === 'drawer') {
    printButton.click()
    steps.push('Drucken / PDF')
    const drawer = await until(() => [...doc.querySelectorAll('dialog[open]')].find((d) => [...d.querySelectorAll('h1, h2, h3')].some((h) => text(h) === 'Drucken')), 'Fenster „Drucken“')
    const select = /** @type {any} */ (drawer.querySelector('select'))
    const option = [...select.options].find((o) => text(o).includes(args.tenant))
    if (!option) throw new Error(`Kein Eintrag für ${args.tenant}: ${[...select.options].map(text).join(' | ')}`)
    // Wie eine Auswahl im Browser: Wert über den Setter des Elements, dann `change` (React hört darauf)
    const setValue = /** @type {any} */ (Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, 'value')).set
    setValue.call(select, option.value)
    select.dispatchEvent(new win.Event('change', { bubbles: true }))
    steps.push(`Was drucken? ${text(option)}`)
    await sleep(200)
    const letterBox = [...drawer.querySelectorAll('label.checkline')].find((l) => text(l).includes('Anschreiben mitdrucken'))?.querySelector('input')
    if (!letterBox) throw new Error('Häkchen „Anschreiben mitdrucken“ fehlt')
    if (letterBox.checked !== args.withLetter) { letterBox.click(); steps.push(`Anschreiben ${args.withLetter ? 'an' : 'aus'}`) }
    await sleep(200)
    const go = await until(() => [...drawer.querySelectorAll('button')].find((b) => text(b) === 'Drucken' && !b.disabled), 'Knopf „Drucken“ frei', 60000)
    go.click()
    steps.push('Drucken')
    const end = Date.now() + 20000
    while (win.__printed === 0) {
      if (Date.now() > end) throw new Error(`window.print() kam nicht (Schritte: ${steps.join(' → ')})`)
      const ask = [...doc.querySelectorAll('dialog[open][role="alertdialog"]')][0]
      if (ask) {
        const buttons = [...ask.querySelectorAll('button')]
        const yes = buttons.find((b) => /drucken/i.test(text(b)) && !/nicht/i.test(text(b))) ?? buttons[buttons.length - 1]
        steps.push(`Rückfrage: ${text(yes)}`)
        yes.click()
      }
      await sleep(150)
    }
    steps.push('window.print()')
  }
  await until(imagesReady, 'Bilder geladen')
  await sleep(500)
  // Steht der Hinweis der Datenbank am Bildschirm? Sonst prüfte der Fall mit Hinweis nichts.
  const banner = (doc.body.textContent ?? '').includes('Sicherung vor dem Update angelegt')
  return JSON.stringify({ steps, banner, title: doc.title, printOne: doc.body.classList.contains('print-one'), pageNumberStyle: doc.querySelectorAll('style[data-page-numbers]').length })
}

// ---------- PDF lesen ----------
/** @type {any} */
let pdfjs = null
async function readPdf(file) {
  pdfjs ??= await import(pathToFileURL(path.join(root, 'client/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0, standardFontDataUrl: path.join(root, 'client/node_modules/pdfjs-dist/standard_fonts/') }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items = []
    for (const it of content.items) {
      if (!('str' in it) || it.str.trim() === '') continue
      items.push({ s: it.str, x: it.transform[4] * MM, x2: (it.transform[4] + it.width) * MM, y: (vp.height - it.transform[5]) * MM })
    }
    pages.push({ w: vp.width * MM, h: vp.height * MM, items, lines: toLines(items) })
  }
  // Eine PDF ohne Seite ist ein kaputter Druck, kein Befund über das Aussehen
  if (pages.length === 0) throw new Error(`${path.basename(file)} hat keine Seite`)
  return pages
}
// Textstücke auf einer Höhe (±0,8 mm) zu Zeilen, links nach rechts
function toLines(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines = []
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < 0.8)
    if (line) line.items.push(it)
    else lines.push({ y: it.y, items: [it] })
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x)
    l.text = l.items.map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim()
  }
  return lines
}
const squash = (s) => s.replace(/\s+/g, '')

// Wie footnoteText in client/src/letterView.ts (der Client lädt endungslos und lässt sich hier nicht importieren)
function footnoteText(values) {
  const object = (values.Objekt ?? '').trim()
  const parts = (values.Wohnung ?? '').split(/\s*,\s*/).filter((p) => p !== '')
  const last = object.split(/\s*,\s*/).pop() ?? ''
  const unit = (parts[0] === last && parts.length > 1 ? parts.slice(1) : parts).join(', ')
  return [values.Abrechnung, [object, unit].filter((x) => x).join(', ')].filter((x) => x).join(' · ')
}

// ---------- Prüfungen ----------
const SATZ_LEFT = 25
const SATZ_RIGHT = 210 - 20
const TOLERANCE = 1
const MONEY = /\d,\d\d\s*€/

/**
 * @param {PrintCase} c
 * @param {any[]} pages
 * @param {{ tenants: { name: string, footnote: string }[], referencePages: number | null }} expect
 */
function checkPdf(c, pages, expect) {
  const findings = []
  const n = pages.length
  if (expect.referencePages !== null && n !== expect.referencePages) findings.push(`${n} Seiten, Chromium ${expect.referencePages}`)
  pages.forEach((p, i) => {
    if (Math.abs(p.w - 210) > 1 || Math.abs(p.h - 297) > 1) findings.push(`Seite ${i + 1}: Format ${p.w.toFixed(1)} × ${p.h.toFixed(1)} mm statt A4`)
  })

  // Wo jede Mieterabrechnung beginnt: beim Anschreiben die Anrede, sonst die Zeile „Mieter <Name>“ im Kopf
  const starts = []
  for (const t of expect.tenants) {
    const marker = (l) => (c.letter ? /^Guten Tag /.test(l.text) && l.text.includes(t.name) : squash(l.text).startsWith(squash(`Mieter ${t.name}`)))
    const at = pages.findIndex((p) => p.lines.some(marker))
    if (at < 0) { findings.push(`Beginn der Abrechnung von ${t.name} nicht gefunden (${c.letter ? 'Anrede' : 'Zeile „Mieter“'})`); continue }
    const line = pages[at].lines.find(marker)
    starts.push({ tenant: t, page: at })
    // Was über dem Beginn steht, gehört zum Kopf (Absender, Anschrift, Datum, Betreff) und trägt keinen Betrag; ein Betrag
    // dort ist der Rest der Abrechnung davor.
    const above = pages[at].lines.filter((l) => l.y < line.y - 0.5 && MONEY.test(l.text) && l.y > 15)
    if (above.length) findings.push(`Seite ${at + 1}: Abrechnung von ${t.name} beginnt nicht auf einer neuen Seite (darüber „${above[0].text.slice(0, 60)}“)`)
  }
  for (let i = 1; i < starts.length; i++) {
    if (starts[i].page <= starts[i - 1].page) findings.push(`Seite ${starts[i].page + 1}: Abrechnung von ${starts[i].tenant.name} auf derselben Seite wie die von ${starts[i - 1].tenant.name}`)
  }

  // Seiten je Mieter: vom Beginn bis vor den nächsten Beginn. Die Briefseite ist die Seite der Anrede.
  const ranges = starts.map((s, i) => ({ ...s, end: i + 1 < starts.length ? starts[i + 1].page : n }))
  const pageNumbers = c.mode === 'drawer' && !c.paper
  for (const r of ranges) {
    for (let i = r.page; i < r.end; i++) {
      const lines = pages[i].lines
      const letterPage = c.letter && i === r.page
      // Der Fußvermerk ist die unterste Zeile (unter ihr höchstens die Seitenzahl). Auf der letzten Seite steht der Fuß der
      // Hülle gleich unter dem Inhalt, nicht am Seitenende (so wiederholen Browser einen tfoot).
      const footLine = lines.findLast((l) => squash(l.text).includes(squash(r.tenant.footnote)))
      const foot = !!footLine && lines.every((l) => l.y <= footLine.y + 0.5 || /^Seite \d+ von \d+$/.test(l.text))
      if (!letterPage && !foot) findings.push(`Seite ${i + 1}: Fußvermerk „${r.tenant.footnote}“ fehlt`)
      if (letterPage && foot) findings.push(`Seite ${i + 1}: Fußvermerk auf der Briefseite`)
    }
  }
  pages.forEach((p, i) => {
    const want = `Seite ${i + 1} von ${n}`
    const has = p.lines.some((l) => squash(l.text).includes(squash(want)))
    const any = p.lines.find((l) => /Seite \d+ von \d+/.test(l.text))
    if (pageNumbers && !has) findings.push(`Seite ${i + 1}: „${want}“ fehlt${any ? ` (steht: „${any.text}“)` : ''}`)
    if (!pageNumbers && any) findings.push(`Seite ${i + 1}: Seitenzahl „${any.text}“, die hier nicht hingehört`)
  })

  // Satzspiegel
  pages.forEach((p, i) => {
    const outside = p.items.filter((it) => it.x < SATZ_LEFT - TOLERANCE || it.x2 > SATZ_RIGHT + TOLERANCE || it.y < 5 || it.y > p.h - 3)
    if (outside.length) {
      const e = outside[0]
      findings.push(`Seite ${i + 1}: ${outside.length} Textstück(e) außerhalb des Satzspiegels, etwa „${e.s.slice(0, 40)}“ bei ${e.x.toFixed(1)} bis ${e.x2.toFixed(1)} mm, Höhe ${e.y.toFixed(1)} mm`)
    }
  })

  // Text der Oberfläche
  pages.forEach((p, i) => {
    for (const l of p.lines) {
      const hit = UI_LINES.find((u) => l.text === u) ?? UI_PARTS.find((u) => l.text.includes(u))
      if (hit) findings.push(`Seite ${i + 1}: Text der Oberfläche im Druck: „${hit}“`)
    }
  })
  return findings
}

// ---------- Seitenbilder ----------
// pdf.js im Browser (wie client/src/pdf.ts), jede Seite als PNG neben die PDF
async function renderPngs(browser, files) {
  const pdfjsDir = path.join(root, 'client/node_modules/pdfjs-dist')
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><body></body>'); return }
    const file = url.startsWith('/pdfjs/') ? path.join(pdfjsDir, path.normalize(url.slice(7))) : path.join(out, path.basename(url))
    if (!file.startsWith(pdfjsDir) && !file.startsWith(out)) { res.statusCode = 403; res.end(); return }
    if (!fs.existsSync(file)) { res.statusCode = 404; res.end(); return }
    res.setHeader('content-type', file.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)))
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`
  const viewer = await browser.newPage()
  await viewer.goto(base)
  for (const f of files) {
    const urls = await viewer.evaluate(async ({ base, f }) => {
      const win = /** @type {any} */ (globalThis)
      const lib = await import(`${base}/pdfjs/legacy/build/pdf.mjs`)
      lib.GlobalWorkerOptions.workerSrc = `${base}/pdfjs/legacy/build/pdf.worker.mjs`
      const pdf = await lib.getDocument({ url: `${base}/${f}`, standardFontDataUrl: `${base}/pdfjs/standard_fonts/` }).promise
      const list = []
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const vp = page.getViewport({ scale: 1.4 })
        const canvas = win.document.createElement('canvas')
        canvas.width = vp.width
        canvas.height = vp.height
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvasContext: ctx, viewport: vp }).promise
        list.push(canvas.toDataURL('image/png'))
      }
      return list
    }, { base, f })
    urls.forEach((u, i) => fs.writeFileSync(path.join(out, `${f.replace(/\.pdf$/, '')}-s${i + 1}.png`), Buffer.from(u.split(',')[1], 'base64')))
  }
  await viewer.close()
  server.close()
}

// ---------- Safari ----------
function buildSafari() {
  const given = option('--safari-bin')
  if (given) return path.resolve(given)
  const bin = path.join(out, '.bin', 'safari-print')
  fs.mkdirSync(path.dirname(bin), { recursive: true })
  execFileSync('swiftc', ['-O', path.join(root, 'scripts/safari-print/main.swift'), '-o', bin], { stdio: 'inherit' })
  return bin
}
function runSafari(bin, { url, preludeFile, driverFile, args, file, log }) {
  return new Promise((resolve, reject) => {
    const extra = [...(option('--safari-margins') ? ['--margins', /** @type {string} */ (option('--safari-margins'))] : [])]
    const child = spawn(bin, ['--url', url, '--prelude', preludeFile, '--driver', driverFile, '--args', JSON.stringify(args), '--out', file, '--timeout', '150', ...extra], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', reject)
    child.on('exit', (code) => {
      fs.writeFileSync(log, `${stdout}\n${stderr}`)
      // Meldungen der Seite (main.swift schreibt sie mit „seite: “ auf stderr): Fehler und console.error
      const pageErrors = stderr.split('\n').filter((l) => l.startsWith('seite: ')).map((l) => l.slice(7))
      if (code === 0) resolve({ ...JSON.parse(stdout.trim().split('\n').pop() ?? '{}'), pageErrors })
      else reject(new Error(`Safari-Druck endete mit ${code}:\n${stderr.slice(-2000)}`))
    })
  })
}

// ---------- Ablauf ----------
async function produce() {
  fs.mkdirSync(out, { recursive: true })
  const { chromium } = await stock.loadPlaywright()
  const browser = await chromium.launch({ args: ['--lang=de-DE'], env: { ...process.env, LANG: 'de_DE.UTF-8' } })
  /** @type {Awaited<ReturnType<typeof stock.startDemo>> | null} */
  let demo = null
  /** @type {Record<string, any>} */
  const meta = { engines, cases: {}, started: new Date().toISOString() }
  // Ab hier räumt `finally` auf: Ein Fehler beim Übersetzen oder beim Start des Servers ließe sonst Chromium offen.
  try {
    const safariBin = engines.includes('safari') ? buildSafari() : null
    const helper = await browser.newPage()
    const shot = async (html, width, height) => {
      await helper.setViewportSize({ width, height })
      await helper.setContent(html)
      return helper.screenshot({ type: 'png' })
    }
    // Ein Logo und ein Briefpapier als PNG, erfunden wie der übrige Bestand
    const logo = await shot('<body style="margin:0"><div style="width:400px;height:120px;display:flex;align-items:center;justify-content:center;background:#fff;font:bold 54px sans-serif;color:#2f4f8f">WEGENER</div></body>', 400, 120)
    const paper = await shot('<body style="margin:0"><div style="width:1240px;height:1754px;position:relative;background:#fff"><div style="position:absolute;top:0;left:0;right:0;height:60px;background:#2f4f8f"></div><div style="position:absolute;bottom:40px;left:148px;right:118px;border-top:2px solid #2f4f8f;font:20px sans-serif;color:#2f4f8f;padding-top:8px">Hausverwaltung Wegener · Ahornstraße 3 · 12345 Musterstadt · Tel. 0123 456789</div></div></body>', 1240, 1754)
    await helper.close()

    demo = await stock.startDemo({ pdf: (html) => stock.textPdf(html), prefix: 'mietfuchs-safari-print-' })
    const server = demo
    const api = demo.api
    const settings = await api.get('/api/settings')
    await api.put('/api/settings', { ...settings, landlordAddress: 'Ahornstraße 3, 12345 Musterstadt', landlordContact: 'Tel. 0123 456789, E-Mail klaus.wegener@example.org', printFooter: true, printFoldMarks: true })
    // Heizanlage mit der Heizungsposition, damit die Blöcke der Heizung erscheinen (wie im Browserlauf)
    const items = await api.get(`/api/costItems?property=${demo.ids.haus}`)
    const heat = items.find((c) => c.category === 'Heizung und Warmwasser' && c.year === stock.YEAR)
    await api.post(`/api/heating-plants?property=${demo.ids.haus}`, { energy: 'gas', method: 'manual', assignItemIds: heat ? [heat.id] : [] })
    const settlement = await api.get(`/api/settlement/${stock.YEAR}?property=${demo.ids.haus}`)
    const tenants = settlement.statements.map((s) => ({ name: s.tenantName, footnote: footnoteText(settlement.letters?.[s.tenancyId]?.values ?? {}) }))
    if (tenants.length === 0) throw new Error('Die Abrechnung des Beispielbestands hat keine Mieter, es gäbe nichts zu prüfen')
    meta.tenants = tenants

    const design = async (body, files = {}) => {
      const fd = new FormData()
      fd.append('design', JSON.stringify(body))
      for (const [k, v] of Object.entries(files)) fd.append(k, new Blob([v]), `${k}.png`)
      const res = await fetch(`${server.base}/api/letter-design`, { method: 'PUT', body: fd })
      if (!res.ok) throw new Error(`Briefpapier: HTTP ${res.status} ${await res.text()}`)
    }
    const margins = { top: 45, right: 20, bottom: 30, left: 25 }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', locale: 'de-DE', timezoneId: 'Europe/Berlin' })
    const scratch = path.join(out, '.seiten')
    fs.mkdirSync(scratch, { recursive: true })
    const driverFile = path.join(scratch, 'driver.js')
    fs.writeFileSync(driverFile, String(drivePage))

    for (const c of cases) {
      // Zustand je Fall; die Fälle danach erwarten die Vorgabe zurück
      if (c.setup === 'no-letter') await api.put('/api/letter-texts', { texts: {}, printLetter: false })
      if (c.setup === 'paper') await design({ logo: 'new', paper: 'new', paperNextFile: 'keep', paperNext: 'same', margins }, { logo, paper })
      if (c.setup === 'logo') await design({ logo: 'new', paper: 'remove', paperNextFile: 'keep', paperNext: 'none', margins }, { logo })
      const preludeSource = `(${String(prelude)})(${JSON.stringify({ banner: !!c.banner })});`
      const args = { mode: c.mode, tenant: c.tenant, withLetter: c.letter }
      meta.cases[c.name] = {}
      for (const engine of engines) {
        const file = path.join(out, `${c.name}-${engine}.pdf`)
        const t0 = Date.now()
        if (engine === 'chromium') {
          const page = await context.newPage()
          await page.addInitScript(preludeSource)
          const pageErrors = []
          page.on('pageerror', (e) => pageErrors.push(`Fehler: ${e.message}`))
          page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`) })
          await page.goto(server.base)
          await page.waitForLoadState('networkidle')
          const result = JSON.parse(await page.evaluate(drivePage, args))
          await page.pdf({ path: file, preferCSSPageSize: true, printBackground: false })
          await page.close()
          meta.cases[c.name][engine] = { result, pageErrors, ms: Date.now() - t0 }
        } else {
          const preludeFile = path.join(scratch, `${c.name}-prelude.js`)
          fs.writeFileSync(preludeFile, preludeSource)
          const report = await runSafari(/** @type {string} */ (safariBin), { url: server.base, preludeFile, driverFile, args, file, log: path.join(out, `${c.name}-safari.log`) })
          meta.cases[c.name][engine] = { result: typeof report.driver === 'string' ? JSON.parse(report.driver) : report.driver, pageErrors: report.pageErrors, printInfo: report.printInfo, os: report.os, ms: Date.now() - t0 }
        }
        console.log(`${c.name} (${engine}): ${((Date.now() - t0) / 1000).toFixed(1)} s`)
        if (server.problem()) throw new Error(/** @type {string} */ (server.problem()))
      }
      if (c.setup === 'no-letter') await api.put('/api/letter-texts', { texts: {}, printLetter: true })
      if (c.setup === 'paper' || c.setup === 'logo') await design({ logo: 'remove', paper: 'remove', paperNextFile: 'keep', paperNext: 'none', margins })
    }
    await context.close()
    await renderPngs(browser, fs.readdirSync(out).filter((f) => f.endsWith('.pdf')).sort())
  } finally {
    meta.finished = new Date().toISOString()
    fs.writeFileSync(path.join(out, 'lauf.json'), JSON.stringify(meta, null, 2))
    await browser.close()
    await demo?.stop()
  }
}

async function evaluate() {
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'lauf.json'), 'utf8'))
  const tenantsAll = meta.tenants
  if (!Array.isArray(tenantsAll) || tenantsAll.length === 0) throw new Error('lauf.json nennt keine Mieter')
  const rows = []
  const lines = []
  let count = 0
  for (const c of cases) {
    const tenants = c.mode === 'drawer' ? tenantsAll.filter((t) => t.name === c.tenant) : tenantsAll
    const read = {}
    for (const engine of ['chromium', 'safari']) {
      const file = path.join(out, `${c.name}-${engine}.pdf`)
      if (fs.existsSync(file)) read[engine] = await readPdf(file)
    }
    const cells = []
    for (const engine of ['safari', 'chromium']) {
      const pages = read[engine]
      if (!pages) { cells.push('–'); continue }
      const findings = checkPdf(c, pages, { tenants, referencePages: engine === 'safari' && read.chromium ? read.chromium.length : null })
      for (const e of meta.cases[c.name]?.[engine]?.pageErrors ?? []) findings.push(`Meldung der Seite: ${e.slice(0, 200)}`)
      if (c.banner && !meta.cases[c.name]?.[engine]?.result?.banner) findings.push('Hinweis „Sicherung vor dem Update angelegt“ stand nicht auf der Seite, der Fall prüft so nichts')
      cells.push(String(pages.length))
      for (const f of findings) lines.push(`- **${c.name}** (${engine === 'safari' ? 'Safari' : 'Chromium'}): ${f}`)
      count += findings.length
    }
    const shown = lines.filter((l) => l.startsWith(`- **${c.name}**`)).length
    rows.push(`| ${c.name} | ${c.title} | ${cells[0]} | ${cells[1]} | ${shown} |`)
  }
  const safariInfo = Object.values(meta.cases).map((v) => v.safari).find((v) => v)
  const report = [
    '# Druck in Safari (WebKit)',
    '',
    `Engines: ${meta.engines.join(', ')}${safariInfo ? ` · ${safariInfo.os} · Ränder von NSPrintInfo (pt): links ${safariInfo.printInfo.leftMargin}, rechts ${safariInfo.printInfo.rightMargin}, oben ${safariInfo.printInfo.topMargin}, unten ${safariInfo.printInfo.bottomMargin}` : ''}`,
    '',
    '| Fall | Was | Seiten Safari | Seiten Chromium | Befunde |',
    '| --- | --- | ---: | ---: | ---: |',
    ...rows,
    '',
    count ? `## ${count} Befund(e)` : '## Keine Befunde',
    '',
    ...lines,
    '',
    'Seitenbilder und PDFs: Artefakt des Laufs (`<fall>-<engine>-s<seite>.png`).',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(out, 'bericht.md'), report)
  console.log(report)
  return count
}

let exitCode = 2
try {
  checkArguments()
  stock = await import('./demo-stock.mjs')
  if (!flag('--evaluate')) await produce()
  const findings = await evaluate()
  exitCode = findings ? 1 : 0
} catch (err) {
  // Ein gescheiterter Lauf ist kein Befund: eigener Code, damit der Workflow beides unterscheidet
  console.error(err)
  exitCode = 2
}
// Ausdrücklich beenden: Ein offener Browser oder Server hielte den Lauf sonst bis zum Timeout auf.
// Erst nach der Ausgabe (unter macOS schreibt Node in eine Pipe asynchron)
process.stdout.write('', () => process.exit(exitCode))
