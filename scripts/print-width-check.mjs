// Druckbreite (#647): Nichts im Druck darf breiter werden als die Seite.
//
// Ist ein Element im Druck breiter als die Seite ohne Rand (A4 mit 12 mm Rand: 186 mm), verkleinern Chromium (Chrome, Edge,
// das Programmfenster, auch printToPDF), Firefox und Safari das ganze Dokument, bis es passt, und zwar alle Seiten mit
// demselben Faktor. Dann stehen auch im Anschreiben auf Seite 1 Fußzeile, Falz- und Lochmarken zu hoch (#647: eine
// Spaltenüberschrift „Gesamtkosten bzw. Anteil an der Gemeinschaft“ ohne Umbruch, Fußzeile bei drei Vierteln der Seite).
// Abschalten lässt sich das nicht, nur vermeiden; Abschneiden (`overflow: hidden`) verhindert es zwar, ließe aber Beträge
// verschwinden. Diese Prüfung hält den Grundsatz fest, auch für Eingaben, die der Beispielbestand nicht kennt.
//
// Ablauf: Server mit dem Beispielbestand (demo-stock.mjs), dazu Heizanlage und Extremwerte (Wort ohne Trennstelle als
// Beschreibung und als Leistung nach § 35a, Beträge in Millionenhöhe, lange E-Mail im Kontakt, Wort ohne Trennstelle im
// eigenen Brieftext). Dann je Fall eine Seite, bedient wie Strg+P bzw. ihr Knopf „Drucken“, und zwei Prüfungen:
//   1. Breite, in jeder Engine: Medium print, Fenster so breit wie der Satzspiegel (mit Briefpapier: die ganze Seite, denn
//      dann druckt die Seite ohne Rand); jedes sichtbare Element, das hinausragt, ist ein Befund (mit Klasse und Text).
//   2. PDF, nur Chromium (`page.pdf`, wie der Druck): jede Seite A4, und auf jeder Seite mit Anschreiben steht der Betreff
//      an seiner Stelle (98,46 mm nach DIN 5008) und, wo gedruckt, die Fußzeile unten (ab 275 mm). Das ist die Wirkung, die
//      der Nutzer sieht; Prüfung 1 nennt die Ursache.
// Die Fälle der Seite Abrechnung stehen hier, die übrigen Druckansichten (Ableseformular, Kaution, …) in
// print-width-views.mjs.
//
//   node scripts/print-width-check.mjs [--out <ordner>] [--engines chromium,firefox,webkit] [--cases a,b]
//
// Exit 0 ohne Befund, 1 mit Befunden (Bericht `<out>/bericht.md`), 2 wenn der Lauf selbst scheitert.
// Voraussetzungen: `npm install`, `npm run build`, `npx playwright install chromium` (und je weitere Engine).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const out = path.resolve(option('--out') ?? path.join(os.tmpdir(), 'mietfuchs-druckbreite'))
const engines = (option('--engines') ?? 'chromium').split(',')
const only = option('--cases')?.split(',')

const MM = 25.4 / 72
const PX_PER_MM = 96 / 25.4
// A4 minus 2 × 12 mm Rand (@page in client/src/letter.css), in CSS-Pixeln; mit Briefpapier die ganze Seite
export const TEXT_WIDTH_PX = 186 * PX_PER_MM
const PAGE_WIDTH_PX = 210 * PX_PER_MM
// Die Fußzeile des Anschreibens endet bei 281 mm (12 mm Rand + 269 mm Brief); ihre Textzeile steht knapp darüber
const FOOTER_MIN_MM = 275
// Der Betreff beginnt bei 98,46 mm (DIN 5008 Form B); die Grundlinie seiner Zeile liegt wenige Millimeter darunter
const SUBJECT_MM = [98, 106]
// Ein Wort ohne Trennstelle, wie es als Beschreibung oder Firmenname vorkommt
const LONG_WORD = 'Wartungsvertragsverlängerungsvereinbarungsnachtragsrechnungsposition'
const LONG_MAIL = 'hausverwaltung.klaus.wegener-musterstadt@beispiel-hausverwaltung-mit-langem-namen.example.org'

/** @type {typeof import('./demo-stock.mjs')} */
let stock
/** @type {any} */
let pdfjs = null

/**
 * Ein Fall: welches Objekt, wie man zur gedruckten Ansicht kommt, und was die PDF zeigen muss.
 * @typedef {{ name: string, label: string, property: 'haus' | 'etw', paper?: boolean, letters?: boolean, footer?: boolean,
 *   before?: (api: any, ids: any) => Promise<void>, after?: (api: any, ids: any) => Promise<void>,
 *   open: (page: any, ids: any) => Promise<void> }} PrintCase
 */

// Die Seite Abrechnung wie Strg+P: alle Mieter, mit Anschreiben
async function openSettlement(page) {
  await page.locator('nav.sidebar button', { hasText: 'Abrechnung' }).first().click()
  await page.locator('.card.statement').first().waitFor({ state: 'attached' })
  await page.waitForLoadState('networkidle')
  // Logo und Briefpapier lädt die Seite nach (bis dahin druckt sie ohne)
  await page.waitForFunction(() => [.../** @type {any} */ (globalThis).document.images].every((img) => img.complete))
  await page.waitForTimeout(500)
}

// Logo und Briefpapier als PNG, erfunden wie der übrige Bestand (wie in safari-print-check.mjs)
async function designImages(browser) {
  const page = await browser.newPage()
  const shot = async (html, width, height) => {
    await page.setViewportSize({ width, height })
    await page.setContent(html)
    return page.screenshot({ type: 'png' })
  }
  const logo = await shot('<body style="margin:0"><div style="width:400px;height:120px;display:flex;align-items:center;justify-content:center;background:#fff;font:bold 54px sans-serif;color:#2f4f8f">WEGENER</div></body>', 400, 120)
  const paper = await shot('<body style="margin:0"><div style="width:1240px;height:1754px;position:relative;background:#fff"><div style="position:absolute;top:0;left:0;right:0;height:60px;background:#2f4f8f"></div><div style="position:absolute;bottom:40px;left:148px;right:118px;border-top:2px solid #2f4f8f;font:20px sans-serif;color:#2f4f8f;padding-top:8px">Hausverwaltung Wegener · Ahornstraße 3 · 12345 Musterstadt</div></div></body>', 1240, 1754)
  await page.close()
  return { logo, paper }
}

async function putDesign(base, body, files = {}) {
  const fd = new FormData()
  fd.append('design', JSON.stringify(body))
  for (const [k, v] of Object.entries(files)) fd.append(k, new Blob([v]), `${k}.png`)
  const res = await fetch(`${base}/api/letter-design`, { method: 'PUT', body: fd })
  if (!res.ok) throw new Error(`Briefpapier: HTTP ${res.status} ${await res.text()}`)
}

// Was alle Fälle brauchen: Heizanlage (Blöcke der Heizung in der Aufstellung) und Extremwerte
async function addStock(api, ids) {
  const settings = await api.get('/api/settings')
  await api.put('/api/settings', { ...settings, landlordAddress: 'Ahornstraße 3, 12345 Musterstadt', landlordContact: `Tel. 0123 456789, E-Mail ${LONG_MAIL}`, printFooter: true, printFoldMarks: true })
  const items = await api.get(`/api/costItems?property=${ids.haus}`)
  const heat = items.find((c) => c.category === 'Heizung und Warmwasser' && c.year === stock.YEAR)
  await api.post(`/api/heating-plants?property=${ids.haus}`, { energy: 'gas', method: 'manual', assignItemIds: heat ? [heat.id] : [] })
  // Mit Lohnanteil, damit das Wort auch in der Tabelle nach § 35a EStG steht
  await api.post(`/api/costItems?property=${ids.haus}`, { year: stock.YEAR, category: 'Sonstige Betriebskosten', description: LONG_WORD, vendor: LONG_WORD, amountCents: 987654321, labor35aCents: 123456789, key: 'area' })
  await api.post(`/api/costItems?property=${ids.etw}`, { year: stock.YEAR, category: 'Sonstige Betriebskosten', description: LONG_WORD, vendor: LONG_WORD, amountCents: 987654321, key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 9876543210 } })
  // Ein eigener Schlusssatz mit einem Wort ohne Trennstelle (Fließtext im Brief)
  await api.put('/api/letter-texts', { texts: { closing: `Für Rückfragen stehe ich Ihnen gern zur Verfügung: ${LONG_WORD}${LONG_WORD}` } })
}

// Läuft in der Seite: alles Sichtbare, das hinausragt
function overflowingElements(limit) {
  // Die Skripte kennen die Typen des DOM nicht (wie safari-print-check.mjs)
  const win = /** @type {any} */ (globalThis)
  const document = win.document
  // Wie weit ein Element im Druck reicht; null, wenn es nicht gedruckt wird. Text, der aus seinem Block ragt, macht dessen
  // Box nicht breiter, nur seinen Inhalt (scrollWidth).
  const reach = (el) => {
    const style = win.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return { left: r.left, right: style.overflowX === 'visible' ? Math.max(r.right, r.left + el.scrollWidth) : r.right }
  }
  const outside = (x) => x !== null && (x.right > limit + 0.5 || x.left < -0.5)
  const found = []
  for (const el of document.querySelectorAll('body *')) {
    const x = reach(el)
    if (!outside(x)) continue
    // Nur das innerste Element nennen: ragt ein Kind hinaus, ist das Elternteil meist nur deshalb so breit
    if ([...el.children].some((c) => outside(reach(c)))) continue
    found.push({ tag: el.tagName.toLowerCase(), cls: String(el.className), right: Math.round(/** @type {any} */ (x).right), text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) })
  }
  return { documentWidth: document.documentElement.scrollWidth, found }
}

async function readPages(file) {
  pdfjs ??= await import(pathToFileURL(path.join(root, 'client/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href)
  const fonts = path.join(root, 'client/node_modules/pdfjs-dist/standard_fonts/').split(path.sep).join('/')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0, standardFontDataUrl: fonts }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    const items = (await page.getTextContent()).items.filter((it) => 'str' in it && it.str.trim() !== '').map((it) => ({ s: it.str, y: (vp.height - it.transform[5]) * MM }))
    pages.push({ w: vp.width * MM, h: vp.height * MM, items, text: items.map((it) => it.s).join(' ') })
  }
  return pages
}

/** @param {any} browser @param {any} demo @param {{ name: string, label: string, property: string, paper?: boolean }} c */
async function openPage(browser, demo, c, open) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', colorScheme: 'light' })
  const page = await context.newPage()
  /** @type {string[]} */
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.addInitScript((id) => {
    const win = /** @type {any} */ (globalThis)
    try { win.localStorage.setItem('mietfuchs.property', id) } catch { /* ohne Speicher das erste Objekt */ }
    // Gedruckt wird von außen (page.pdf); die Seite setzt vor window.print() ihren Zustand
    win.__printed = 0
    win.print = () => { win.__printed += 1 }
  }, demo.ids[c.property])
  await page.goto(demo.base)
  await page.waitForLoadState('networkidle')
  await open(page, demo.ids)
  return { context, page, pageErrors }
}

/** @returns {PrintCase[]} */
function settlementCases(images, base) {
  const margins = { top: 45, right: 20, bottom: 30, left: 25 }
  return [
    { name: 'abrechnung', label: 'Abrechnung Lindenweg 12 (mit Heizung)', property: 'haus', letters: true, footer: true, open: openSettlement },
    { name: 'abrechnung-etw', label: 'Abrechnung Eigentumswohnung Kastanienallee 5', property: 'etw', letters: true, footer: true, open: openSettlement },
    {
      name: 'abrechnung-briefpapier', label: 'Abrechnung Lindenweg 12 mit Logo und Briefpapier', property: 'haus', paper: true, letters: true, footer: false,
      before: () => putDesign(base, { logo: 'new', paper: 'new', paperNextFile: 'keep', paperNext: 'same', margins }, images),
      after: () => putDesign(base, { logo: 'remove', paper: 'remove', paperNextFile: 'keep', paperNext: 'none', margins }),
      open: openSettlement,
    },
  ]
}

async function main() {
  fs.mkdirSync(out, { recursive: true })
  stock = await import('./demo-stock.mjs')
  const views = /** @type {any[]} */ ((await import('./print-width-views.mjs')).PRINT_VIEWS)
  const pw = await stock.loadPlaywright()
  /** @type {Record<string, any>} */
  const browsers = {}
  for (const e of engines) {
    if (!['chromium', 'firefox', 'webkit'].includes(e)) throw new Error(`Unbekannte Engine: ${e}`)
    browsers[e] = await pw[e].launch()
  }
  /** @type {Awaited<ReturnType<typeof stock.startDemo>> | null} */
  let demo = null
  /** @type {string[]} */
  const findings = []
  try {
    demo = await stock.startDemo({ pdf: (html) => stock.textPdf(html), prefix: 'mietfuchs-druckbreite-' })
    await addStock(demo.api, demo.ids)
    for (const v of views) await v.setup?.(demo.api, demo.ids, stock)
    const images = await designImages(browsers.chromium ?? Object.values(browsers)[0])
    /** @type {PrintCase[]} */
    const cases = [
      ...settlementCases(images, demo.base),
      ...views.map((v) => ({ name: v.name, label: v.label, property: v.property ?? 'haus', open: v.open })),
    ].filter((c) => !only || only.includes(c.name))
    if (cases.length === 0) throw new Error('Kein Fall gewählt')

    for (const c of cases) {
      await c.before?.(demo.api, demo.ids)
      try {
        for (const engine of engines) {
          const { context, page, pageErrors } = await openPage(browsers[engine], demo, c, c.open)
          try {
            const tag = engines.length > 1 ? `${c.label} [${engine}]` : c.label
            // Erst messen, dann die PDF: page.pdf() löst `afterprint` aus, und Blätter wie Ableseformular und
            // Monatsinformation räumen dann ihre Druckklasse ab (die Messung danach sähe die ganze Oberfläche)
            const limit = c.paper ? PAGE_WIDTH_PX : TEXT_WIDTH_PX
            await page.emulateMedia({ media: 'print' })
            await page.setViewportSize({ width: Math.floor(limit), height: 900 })
            await page.waitForTimeout(300)
            const width = await page.evaluate(overflowingElements, limit)
            /** @type {string | null} */
            let file = null
            if (engine === 'chromium') {
              await page.emulateMedia({ media: null })
              await page.setViewportSize({ width: 1440, height: 900 })
              await page.waitForTimeout(300)
              file = path.join(out, `${c.name}.pdf`)
              await page.pdf({ path: file, preferCSSPageSize: true })
            }
            if (width.found.length > 0 || width.documentWidth > limit + 1) {
              // Eine zu breite Tabelle schiebt jede ihrer Zellen mit hinaus; je Fall eine Zeile und die ersten verschiedenen Elemente
              const seen = new Set()
              const distinct = width.found.filter((f) => { const k = `${f.tag}.${f.cls}`; if (seen.has(k)) return false; seen.add(k); return true })
              const sample = distinct.slice(0, 8).map((f) => `<${f.tag}${f.cls ? ` class="${f.cls}"` : ''}> „${f.text}“ (bis ${f.right} px)`)
              findings.push(`${tag}: im Druck ${width.documentWidth} px breit, erlaubt ${Math.floor(limit)} px; ${width.found.length} Elemente ragen hinaus, darunter ${sample.join('; ') || 'keines einzeln erkennbar'}`)
            }
            for (const e of pageErrors) findings.push(`${tag}: Fehler in der Seite: ${e}`)
            let summary = `${width.found.length} Elemente zu breit`
            if (file) {
              const pages = await readPages(file)
              let letters = 0
              pages.forEach((p, i) => {
                if (Math.abs(p.w - 210) > 1 || Math.abs(p.h - 297) > 1) findings.push(`${tag}: Seite ${i + 1} ist ${p.w.toFixed(1)} × ${p.h.toFixed(1)} mm, nicht A4`)
                if (!c.letters || !p.text.includes(`Nebenkostenabrechnung ${stock.YEAR}, `)) return
                const subject = p.items.find((it) => it.s.startsWith(`Nebenkostenabrechnung ${stock.YEAR}, `))
                if (!subject) return
                letters += 1
                if (subject.y < SUBJECT_MM[0] || subject.y > SUBJECT_MM[1]) findings.push(`${tag}: Seite ${i + 1} (Anschreiben): Betreff bei ${subject.y.toFixed(1)} mm statt bei 98,46 mm, der Druck ist verkleinert oder verschoben`)
                if (!c.footer) return
                const footer = p.items.filter((it) => it.s.includes('Ahornstraße 3')).sort((a, b) => b.y - a.y)[0]
                if (!footer) findings.push(`${tag}: Seite ${i + 1} (Anschreiben) ohne Fußzeile`)
                else if (footer.y < FOOTER_MIN_MM) findings.push(`${tag}: Seite ${i + 1} (Anschreiben): Fußzeile bei ${footer.y.toFixed(1)} mm statt unten (ab ${FOOTER_MIN_MM} mm), der Druck ist verkleinert`)
              })
              if (c.letters && letters === 0) findings.push(`${tag}: kein Anschreiben im Druck, die Prüfung von Betreff und Fußzeile lief ins Leere`)
              summary = `${pages.length} Seiten${c.letters ? `, ${letters} Anschreiben` : ''}, ${summary}`
            }
            console.log(`${tag}: ${summary}`)
          } finally {
            await context.close()
          }
          if (demo.problem()) throw new Error(/** @type {string} */ (demo.problem()))
        }
      } finally {
        await c.after?.(demo.api, demo.ids)
      }
    }
  } finally {
    for (const b of Object.values(browsers)) await b.close()
    await demo?.stop()
  }
  const report = findings.length === 0 ? '# Druckbreite\n\nKeine Befunde.\n' : `# Druckbreite\n\n${findings.map((f) => `- ${f}`).join('\n')}\n`
  fs.writeFileSync(path.join(out, 'bericht.md'), report)
  if (findings.length > 0) {
    console.log(`\n${findings.length} Befunde:`)
    for (const f of findings) console.log(`- ${f}`)
    console.log(`Bericht und PDFs: ${out}`)
    return 1
  }
  console.log(`Keine Befunde. PDFs: ${out}`)
  return 0
}

main().then((code) => { process.exitCode = code }, (err) => {
  console.error(err)
  process.exitCode = 2
})
