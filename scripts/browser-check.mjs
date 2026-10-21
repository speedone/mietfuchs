// Der Browserlauf vor jedem Release (#340, Schritt 11 von #346): jede Seite der Navigation in Chromium,
// Firefox und WebKit (die Engine von Safari), am Rechner (1440 × 900) und am Handy (390 × 844), hell und
// dunkel, mit dem Beispielbestand der Bildschirmfotos (demo-stock.mjs).
//
//   npx playwright install chromium firefox webkit   # einmalig, unter Linux ggf. mit --with-deps
//   npm run browser-check                            # baut die Oberfläche, prüft alle drei Engines
//   npm run browser-check -- --skip-build --engines chromium --out /tmp/browserlauf
//   npm run browser-check -- --skip-build --engines webkit --views mobile --pages stammdaten,kosten
//   npm run browser-check -- --merge <Ordner>   # die axe-Messungen mehrerer Läufe zusammen (CI, je Engine ein Lauf)
//
// WebKit braucht unter Linux GTK4 und weitere Bibliotheken (`npx playwright install --with-deps webkit`). Fehlen
// sie und lassen sie sich nicht installieren, läuft es im Container der Playwright-Fassung des Repos (die Fotos
// dann in .browserlauf/, das nicht eingecheckt wird):
//   docker run --rm --ipc=host -v "$PWD:/repo" -w /repo mcr.microsoft.com/playwright:v1.64.1-noble \
//     node scripts/browser-check.mjs --skip-build --engines webkit --out /repo/.browserlauf
//
// Je Seite, Engine, Ansicht und Design wird geprüft:
//   - keine Meldung in der Konsole der Stufe „error“ und kein Fehler in der Seite (`pageerror`),
//   - keine sichtbare Fehlermeldung der Oberfläche,
//   - die Seite ist nicht breiter als das Fenster (`scrollWidth` ≤ `clientWidth`, MOB1),
//   - kein Feld schneidet Wert, Platzhalter oder gewählten Eintrag ab, auch in den Seitenfenstern der Seite
//     (#346 Schritt 7b; ein voll breites Feld als eigene Art, Ausnahmen in browser-check-fields.json),
//   - axe-core ohne Verstöße der Stufen „serious“ und „critical“, außer den Ausnahmen in
//     browser-check-axe.json, deren Anzahl nur sinken darf.
// Dazu je Engine und Ansicht die Bedienproben: Seitenfenster (Esc fragt, Enter auf „Abbrechen“ lässt es
// offen, „Verwerfen“ schließt), Monatsfeld (Text und Raster per Tastatur), Begriffserklärung (öffnen, Esc),
// Fehler nach dem Speichern (sichtbar, mit Fokus) und am Handy Menüblatt und untere Leiste.
//
// Jeder Befund ergibt einen Exit-Code ungleich 0. Der Bericht steht als Markdown in `<out>/bericht.md` und,
// in GitHub Actions, in der Zusammenfassung des Laufs. Die Fotos je Seite liegen in `<out>/<engine>/…`;
// sie gehören nicht ins Repo, die Vorgabe für `--out` liegt deshalb im Temp-Ordner.
//
// Server und Bestand kommen aus demo-stock.mjs, mit den drei Angaben jedes Prüfstarts (CLAUDE.md). Der
// Bestand bekommt zusätzlich eine Heizanlage (freie Schlüssel, ändert keine Zahl), damit auch die Seite
// Heizkosten in der Navigation steht. Die Bedienproben speichern nichts: Jede verwirft, was sie eingibt.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { navFor } from '../client/src/nav.ts'
import { loadPlaywright, startDemo, textPdf } from './demo-stock.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}
const list = (value) => String(value).split(',').map((s) => s.trim()).filter(Boolean)

const ENGINES = ['chromium', 'firefox', 'webkit']
const VIEWS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } }
const THEMES = ['light', 'dark']

const engines = list(opt('engines', ENGINES.join(',')))
const views = list(opt('views', Object.keys(VIEWS).join(',')))
const themes = list(opt('themes', THEMES.join(',')))
const OUT = path.resolve(opt('out', path.join(os.tmpdir(), 'mietfuchs-browserlauf')))
const SKIP_BUILD = argv.includes('--skip-build')
// Nur diese Seiten (Kennung wie im Bericht, etwa „stammdaten“), zum Nachprüfen eines Befunds; „-“ prüft keine
// Seite und nur die Bedienproben. Ohne Angabe alle Seiten der Navigation.
const PAGES = opt('pages', null) === null ? null : list(opt('pages', '')).filter((p) => p !== '-')
const EXCEPTIONS_FILE = path.join(root, 'scripts', 'browser-check-axe.json')
// Ob dieser Lauf alles prüft: Nur dann sagt eine kleinere Anzahl, dass eine Ausnahme sinken kann.
const FULL = PAGES === null && ENGINES.every((e) => engines.includes(e)) && Object.keys(VIEWS).every((v) => views.includes(v)) && THEMES.every((t) => themes.includes(t))

for (const e of engines) if (!ENGINES.includes(e)) throw new Error(`Unbekannte Engine „${e}“ (möglich: ${ENGINES.join(', ')})`)
for (const v of views) if (!(v in VIEWS)) throw new Error(`Unbekannte Ansicht „${v}“ (möglich: ${Object.keys(VIEWS).join(', ')})`)
for (const t of themes) if (!THEMES.includes(t)) throw new Error(`Unbekanntes Design „${t}“ (möglich: ${THEMES.join(', ')})`)

// ---------- Befunde ----------
/** @typedef {{ engine: string, view: string, theme: string, page: string, kind: string, text: string }} Finding */
/** @type {Finding[]} */
const findings = []
/** @type {Record<string, number>} */
const runtimes = {}
let checkedPages = 0

// ---------- axe-Ausnahmen ----------
// Je Eintrag: Regel und Seite, die größte erlaubte Zahl betroffener Elemente in einer Kombination aus
// Engine, Ansicht und Design, und der Grund. Optional `ansicht`, `design` oder `engine`, wenn der Verstoß
// nur dort auftritt. Die Zahl darf nur sinken: Mehr ist ein Befund, und misst ein vollständiger Lauf
// weniger, ist das ebenfalls einer, bis die Zahl in der Datei gesenkt ist.
/** @typedef {{ regel: string, seite: string, anzahl: number, grund: string, ansicht?: string, design?: string, engine?: string }} AxeException */
/** @type {AxeException[]} */
const axeExceptions = JSON.parse(fs.readFileSync(EXCEPTIONS_FILE, 'utf8')).ausnahmen
for (const ex of axeExceptions) {
  if (!ex.regel || !ex.seite || !Number.isInteger(ex.anzahl) || ex.anzahl < 1 || !ex.grund?.trim()) {
    throw new Error(`browser-check-axe.json: Eintrag ohne Regel, Seite, Anzahl ≥ 1 oder Grund: ${JSON.stringify(ex)}`)
  }
}
/** Die größte gemessene Zahl je Ausnahme. @type {Map<AxeException, number>} */
const axeSeen = new Map(axeExceptions.map((ex) => [ex, 0]))
const exceptionFor = (rule, pageId, combo) => axeExceptions.find((ex) => ex.regel === rule && ex.seite === pageId
  && (!ex.ansicht || ex.ansicht === combo.view) && (!ex.design || ex.design === combo.theme) && (!ex.engine || ex.engine === combo.engine))

const exceptionKey = (ex) => [ex.regel, ex.seite, ex.ansicht ?? '', ex.design ?? '', ex.engine ?? ''].join('|')
// Nach einem vollständigen Lauf: Ausnahmen, die nicht mehr oder seltener auftreten, als die Datei erlaubt
/** @param {Record<string, number>} seen @returns {Finding[]} */
const staleExceptions = (seen) => axeExceptions.flatMap((ex) => {
  const n = seen[exceptionKey(ex)] ?? 0
  if (n >= ex.anzahl) return []
  return [{ engine: 'alle', view: '–', theme: '–', page: ex.seite, kind: 'axe-Ausnahme', text: n === 0
    ? `Ausnahme ${ex.regel} tritt nicht mehr auf: bitte aus browser-check-axe.json streichen.`
    : `Ausnahme ${ex.regel} tritt höchstens ${n}× auf: bitte die Anzahl in browser-check-axe.json auf ${n} senken.` }]
})

// ---------- Hilfen ----------
const slug = (label) => label.toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(300)
}


// Breiter als das Fenster? Nennt bis zu drei Elemente, die über den rechten Rand ragen und nicht in einem
// Bereich mit eigenem Rollen oder Abschneiden stehen.
async function overflow(page) {
  return page.evaluate(() => {
    const win = /** @type {any} */ (globalThis)
    const doc = win.document
    const width = doc.documentElement.clientWidth
    const scroll = doc.documentElement.scrollWidth
    if (scroll <= width) return null
    const clipped = (el) => {
      for (let p = el.parentElement; p && p !== doc.body; p = p.parentElement) {
        if (win.getComputedStyle(p).overflowX !== 'visible') return true
      }
      return false
    }
    const out = []
    for (const el of doc.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.right <= width + 0.5 || clipped(el)) continue
      const name = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''}`
      out.push(`${name} („${(el.textContent ?? '').trim().slice(0, 40)}“, rechts ${Math.round(r.right)} px)`)
      if (out.length === 3) break
    }
    return { width, scroll, elements: out }
  })
}

// Felder, die ihren Inhalt abschneiden (#346 Schritt 7b): ein Eingabefeld, dessen Wert oder, wenn es leer ist, dessen
// Platzhalter breiter ist als das Feld (ein Platzhalter ist meist ein Beispiel und gehört zum Inhalt; Durchsicht von
// #243, R-K11), oder ein Auswahlfeld, das seinen gewählten Eintrag nicht ganz zeigt. Der Wert misst über `scrollWidth`
// (> `clientWidth` + 1), der Platzhalter über die Textbreite in der Schrift des Felds gegen die Innenbreite; für das
// Auswahlfeld misst ein Klon mit nur dem gewählten Eintrag und `width: auto` an derselben Stelle, wie breit es sein
// müsste (`scrollWidth` sagt bei `<select>` in keiner Engine etwas). Geprüft wird, was sichtbar ist, in `scope` (die
// Seite oder das offene Seitenfenster); unsichtbare Auswahlfelder (der Umschalter der Seitenleiste liegt mit Deckkraft
// 0 über seinem Text) zählen nicht.
//
// Ein Feld, das schon die ganze verfügbare Breite nimmt (am Handy jedes, im Seitenfenster die breiten), kann nicht
// breiter werden. Schneidet es trotzdem ab, ist das ein eigener Befund („voll breit, Inhalt passt nicht“): Abhilfe ist
// ein kürzerer Eintrag oder Platzhalter, die Erklärung als Hinweis am Feld. Was so bleiben soll, steht mit Grund in
// browser-check-fields.json und wird nur weniger.
/** @typedef {{ kind: 'cut' | 'full', name: string, text: string }} Clipped */
/** @returns {Promise<Clipped[]>} */
async function clippedFields(page, scope) {
  return page.evaluate((sel) => {
    const win = /** @type {any} */ (globalThis)
    const doc = win.document
    const root = doc.querySelector(sel) ?? doc.body
    /** @type {{ kind: 'cut' | 'full', name: string, text: string }[]} */
    const out = []
    const nameOf = (el) => {
      const by = el.getAttribute('aria-labelledby')
      const label = (by ? by.split(/\s+/).map((id) => doc.getElementById(id)?.textContent ?? '').join(' ') : '')
        || el.getAttribute('aria-label') || el.closest('label')?.textContent || el.name || el.tagName.toLowerCase()
      return label.replace(/\s+/g, ' ').trim().slice(0, 50)
    }
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      const style = win.getComputedStyle(el)
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && Number(style.opacity) > 0 && !el.closest('[hidden], .no-print[aria-hidden="true"]')
    }
    // Voll breit: das Feld nimmt die Breite seines Behälters (eines Felds bzw. eines Auswahlfelds außerhalb eines
    // Felds); Eingabefelder in Tabellenzellen werden immer als abgeschnitten gemeldet.
    const atFullWidth = (el) => {
      const field = el.closest('label.field, div.field')
      const box = field ? field.parentElement : el.tagName === 'SELECT' ? el.parentElement : null
      if (!box) return false
      const st = win.getComputedStyle(box)
      const avail = box.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight)
      return el.getBoundingClientRect().width >= avail - 2
    }
    const ctx = doc.createElement('canvas').getContext('2d')
    const textWidth = (el, text) => {
      const st = win.getComputedStyle(el)
      ctx.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`
      return ctx.measureText(text).width
    }
    const push = (el, what) => out.push({ kind: atFullWidth(el) ? 'full' : 'cut', name: nameOf(el), text: what })
    for (const el of root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), select')) {
      if (!visible(el)) continue
      if (el.tagName === 'SELECT') {
        const opt = el.options[el.selectedIndex]
        if (!opt || !opt.text.trim()) continue
        const clone = el.cloneNode(false)
        clone.removeAttribute('id')
        clone.setAttribute('aria-hidden', 'true')
        clone.tabIndex = -1
        clone.appendChild(opt.cloneNode(true))
        clone.style.cssText = 'position:absolute;visibility:hidden;width:auto;min-width:0;max-width:none;flex:none'
        el.parentElement.appendChild(clone)
        const need = clone.getBoundingClientRect().width
        clone.remove()
        const have = el.getBoundingClientRect().width
        if (need > have + 1) push(el, `Auswahl zeigt „${opt.text.trim().slice(0, 70)}“ nicht ganz (${Math.round(have)} px, braucht ${Math.round(need)} px)`)
      } else if (el.value) {
        if (el.scrollWidth > el.clientWidth + 1) push(el, `Wert „${String(el.value).slice(0, 70)}“ abgeschnitten (${el.clientWidth} px, braucht ${el.scrollWidth} px)`)
      } else if (el.placeholder && !/^(date|time)$/.test(el.type)) {
        const st = win.getComputedStyle(el)
        const inner = el.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight)
        const need = textWidth(el, el.placeholder)
        if (need > inner + 1) push(el, `Platzhalter „${el.placeholder.slice(0, 70)}“ abgeschnitten (${Math.round(inner)} px, braucht ${Math.round(need)} px)`)
      }
    }
    return out
  }, scope)
}

// Selbstprobe der Messung (Mutationsprobe, läuft bei jedem Aufruf): ein zu schmales Feld mit langem Wert, ein zu schmales
// Auswahlfeld und ein zu schmales Feld mit langem Platzhalter müssen als abgeschnitten erscheinen, ein voll breites Feld
// in einem schmalen Behälter als „voll breit“; sonst misst die Prüfung nichts.
async function clippedSelfTest(page) {
  await page.evaluate(() => {
    const doc = /** @type {any} */ (globalThis).document
    const box = doc.createElement('div')
    box.id = 'cut-selftest'
    box.innerHTML = '<label class="field"><span>Probe Adresse</span><input value="Lindenweg 12, 12345 Musterstadt" style="width:6ch"></label>'
      + '<label class="field"><span>Probe Auswahl</span><select style="width:6ch;min-width:0"><option>vor dem 01.12.2021 errichtet</option></select></label>'
      + '<label class="field"><span>Probe Platzhalter</span><input placeholder="z. B. Verbrauchsvergleich des Ablesedienstes" style="width:8ch"></label>'
      + '<div style="width:120px"><label class="field" style="width:100%"><span>Probe voll</span><select style="width:100%;min-width:0"><option>unbekannt – es gelten nur bundesweite Feiertage</option></select></label></div>'
    doc.querySelector('main')?.appendChild(box)
  })
  const found = await clippedFields(page, '#cut-selftest')
  await page.evaluate(() => /** @type {any} */ (globalThis).document.getElementById('cut-selftest')?.remove())
  const cut = found.filter((f) => f.kind === 'cut').length
  const full = found.filter((f) => f.kind === 'full').length
  return cut === 3 && full === 1 ? null : `Die Messung abgeschnittener Felder findet ${cut} statt 3 zu schmale und ${full} statt 1 voll breites Probefeld.`
}

// ---------- Ausnahmen „voll breit“ ----------
// Je Eintrag Seite (Kennung wie im Bericht, für Seitenfenster mit „:fenster“), der Anfang des Feldnamens und der
// Grund; optional `ansicht`. Ein Eintrag, den ein vollständiger Lauf nicht mehr sieht, ist ein Befund, bis er aus der
// Datei gestrichen ist.
const FIELDS_FILE = path.join(root, 'scripts', 'browser-check-fields.json')
/** @typedef {{ seite: string, feld: string, grund: string, ansicht?: string }} FieldException */
/** @type {FieldException[]} */
const fieldExceptions = JSON.parse(fs.readFileSync(FIELDS_FILE, 'utf8')).ausnahmen
for (const ex of fieldExceptions) {
  if (!ex.seite || !ex.feld || !ex.grund?.trim()) throw new Error(`browser-check-fields.json: Eintrag ohne Seite, Feld oder Grund: ${JSON.stringify(ex)}`)
}
const fieldSeen = new Set()
const fieldExceptionFor = (pageId, name, view) => fieldExceptions.find((ex) => ex.seite === pageId && name.startsWith(ex.feld) && (!ex.ansicht || ex.ansicht === view))
// Die Mindestzahl geöffneter Seitenfenster je Engine und Ansicht, wenn alle Seiten geprüft werden (Stammdaten 11,
// Kosten 2, Zähler 2, Mietkonto 1, Heizkosten 1); weniger heißt, ein Knopf ist umbenannt oder ein Fenster öffnet nicht.
const MIN_DRAWERS = 17

// Seitenfenster einer Seite zum Messen: jedes „+ … anlegen“ und je Art das erste ✎ („… bearbeiten“), dazu die
// Knöpfe, die ein Fenster zum Ändern öffnen. Geschlossen wird mit Esc (ohne Eingabe fragt es nicht).
const DRAWER_OPENERS = /^(\+ .+ anlegen|Abrechnungszeitraum ändern|Ändern|Mieterwechsel|Eigene Heizkostenabrechnung einrichten|Heizung erneuert \(Kessel getauscht\)|.+ bearbeiten)$/

// Sichtbare Fehlermeldungen der Oberfläche: die Sammelmeldung, Meldungen am Feld und `.error`.
async function visibleErrors(page) {
  return page.evaluate(() => {
    const win = /** @type {any} */ (globalThis)
    const els = win.document.querySelectorAll('.error, [data-error-summary], [role="alert"]')
    const out = []
    for (const el of els) {
      const r = el.getBoundingClientRect()
      const style = win.getComputedStyle(el)
      const text = (el.textContent ?? '').trim()
      if (r.width === 0 || r.height === 0 || style.visibility === 'hidden' || !text) continue
      out.push(text.slice(0, 160))
    }
    return [...new Set(out)]
  })
}

// ---------- Navigation ----------
// Die Einträge der Navigation, wie die Oberfläche sie zeigt; am Handy aus dem Menüblatt.
async function readNav(page, view) {
  const read = (scope) => scope.locator('.nav-group button').evaluateAll((buttons) => buttons.map((b) => {
    const icon = b.querySelector('span')?.textContent ?? ''
    return (b.textContent ?? '').replace(icon, '').trim()
  }))
  if (view === 'desktop') return read(page.locator('nav.sidebar'))
  await page.locator('button.menu-toggle').click()
  const sheet = page.locator('dialog.menu-sheet')
  await sheet.waitFor({ state: 'visible' })
  const labels = await read(sheet)
  await page.keyboard.press('Escape')
  await sheet.waitFor({ state: 'hidden' })
  return labels
}

async function go(page, view, label) {
  if (view === 'mobile') {
    await page.locator('button.menu-toggle').click()
    const sheet = page.locator('dialog.menu-sheet')
    await sheet.waitFor({ state: 'visible' })
    await sheet.locator('.nav-group button').filter({ hasText: label }).first().click()
    await sheet.waitFor({ state: 'hidden' })
  } else {
    await page.locator('nav.sidebar .nav-group button').filter({ hasText: label }).first().click()
  }
  await settle(page)
  await page.evaluate(() => /** @type {any} */ (globalThis).scrollTo(0, 0))
}

// ---------- Eine Kombination ----------
async function checkCombination(browser, base, combo, AxeBuilder, navLabels) {
  const { engine, view, theme } = combo
  const context = await browser.newContext({
    viewport: VIEWS[view], deviceScaleFactor: 1, colorScheme: theme === 'dark' ? 'dark' : 'light', locale: 'de-DE', timezoneId: 'Europe/Berlin',
  })
  await context.addInitScript((choice) => {
    try {
      /** @type {any} */ (globalThis).localStorage.setItem('nka-theme', choice)
    } catch {
      // ohne Speicher gilt colorScheme des Kontexts, und das ist dasselbe
    }
  }, theme)
  const page = await context.newPage()
  let current = 'start'
  const add = (pageId, kind, text) => findings.push({ engine, view, theme, page: pageId, kind, text })
  page.on('pageerror', (err) => add(current, 'Fehler in der Seite', err.message))
  page.on('console', (msg) => { if (msg.type() === 'error') add(current, 'Konsole', msg.text()) })
  // Die Rückfrage des Browsers vor dem Verlassen (offenes Formular) bestätigen, damit ein Neuladen nach
  // einer gescheiterten Probe nicht hängen bleibt
  page.on('dialog', (d) => { void d.accept() })

  await page.goto(base)
  await page.locator(view === 'mobile' ? 'button.menu-toggle' : 'nav.sidebar').first().waitFor()
  await settle(page)
  const labels = navLabels ?? await readNav(page, view)
  if (!labels?.length) throw new Error('Die Navigation hat keine Einträge.')
  const selfTest = await clippedSelfTest(page)
  if (selfTest) add('start', 'Messung', selfTest)
  /** @param {string} pageId @param {Clipped[]} list @param {string} [prefix] */
  const reportClipped = (pageId, list, prefix = '') => {
    for (const f of list) {
      if (f.kind === 'cut') { add(pageId, 'Abgeschnitten', `${prefix}„${f.name}“: ${f.text}`); continue }
      const ex = fieldExceptionFor(pageId, f.name, view)
      if (ex) { fieldSeen.add(ex); continue }
      add(pageId, 'Voll breit, Inhalt passt nicht', `${prefix}„${f.name}“: ${f.text}`)
    }
  }
  let drawersOpened = 0

  // axe auf dem jetzigen Stand der Seite; die Bedienproben rufen es auch mit offenem Fenster, Raster oder Blatt
  const runAxe = async (id) => {
    // Erst wenn kein Übergang mehr läuft: Mitten im Einblenden einer Rückfrage misst axe sonst den Kontrast
    // halb durchsichtiger Knöpfe (einmal in Chromium am Handy gesehen)
    await page.waitForFunction(() => /** @type {any} */ (globalThis).document.getAnimations().every((a) => a.playState !== 'running'), undefined, { timeout: 5000 }).catch(() => {})
    // Und zwei Frames: WebKit meldet beim ersten Öffnen eines Seitenfensters die Animation schon als beendet,
    // während der berechnete Stil noch die Deckkraft eines Zwischenstands trägt (gemessen 0,66), bis ein
    // Frame gerechnet ist; axe maß dann den Kontrast halb durchsichtiger Knöpfe (#346, Durchsicht S4).
    await page.evaluate(() => new Promise((resolve) => {
      const raf = /** @type {any} */ (globalThis).requestAnimationFrame
      raf(() => raf(() => resolve(undefined)))
    }))
    // Die Zielgröße nach WCAG 2.5.8 (24 px oder Abstand) ist in axe ausgeschaltet; eingeschaltet, weil sie zur Stufe AA
    // gehört und der Rest von N11 aus #341 („Mülleimer-Ziele von rund 20 px“) sonst ungeprüft bliebe
    const axe = await new AxeBuilder({ page }).options({ rules: { 'target-size': { enabled: true } } }).analyze()
    for (const v of axe.violations) {
      if (v.impact !== 'serious' && v.impact !== 'critical') continue
      const ex = exceptionFor(v.id, id, combo)
      if (ex) {
        axeSeen.set(ex, Math.max(axeSeen.get(ex) ?? 0, v.nodes.length))
        if (v.nodes.length <= ex.anzahl) continue
      }
      const targets = v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} (${n.html.replace(/\s+/g, ' ').slice(0, 100)})`).join('; ')
      add(id, 'axe', `${v.id} (${v.impact}, ${v.nodes.length}×${ex ? `, Ausnahme erlaubt ${ex.anzahl}` : ''}): ${v.help}. Zum Beispiel ${targets}`)
    }
  }

  const dir = path.join(OUT, engine, `${view}-${theme}`)
  fs.mkdirSync(dir, { recursive: true })
  for (const label of labels) {
    const id = slug(label)
    if (PAGES && !PAGES.includes(id)) continue
    current = id
    try {
      await go(page, view, label)
    } catch (err) {
      add(id, 'Navigation', `„${label}“ ließ sich nicht öffnen: ${err instanceof Error ? err.message.split('\n')[0] : err}`)
      continue
    }
    checkedPages++
    const wide = await overflow(page)
    if (wide) add(id, 'Breite', `Seite ${wide.scroll} px breit bei ${wide.width} px Fenster${wide.elements.length ? `: ${wide.elements.join('; ')}` : ''}`)
    // Noch einmal mit allem Aufklappbaren offen: Eine zugeklappte Anleitung misst keine Breite, die Hilfe am Handy
    // ragte aufgeklappt über den Rand (MOB1 aus #341). Danach wieder zu, damit Foto und axe die Seite wie geöffnet sehen.
    const opened = await page.evaluate(() => {
      const list = [...(/** @type {any} */ (globalThis)).document.querySelectorAll('main details:not([open])')]
      for (const d of list) { d.setAttribute('data-bc-opened', ''); d.open = true }
      return list.length
    })
    /** @type {Clipped[]} */
    let clippedOpen = []
    if (opened > 0) {
      // `toggle` kommt als eigene Aufgabe, und manches zeichnet React erst danach oder lädt es nach (Belegmappe im
      // Belegordner); deshalb erst warten, dann messen, und nach dem Zuklappen noch einmal (Durchsicht des Zweigs, Befund 3)
      await settle(page)
      const wideOpen = wide ? null : await overflow(page)
      if (wideOpen) add(id, 'Breite', `Aufgeklappt ${wideOpen.scroll} px breit bei ${wideOpen.width} px Fenster${wideOpen.elements.length ? `: ${wideOpen.elements.join('; ')}` : ''}`)
      // Auch abgeschnittene Felder in zugeklappten Bereichen, etwa „Erweitert“ in den Einstellungen (N14 aus #341). Gemessen
      // wird ganz `main`; „aufgeklappt:“ heißt also „nur mit offenen Details gefunden“, auch wenn das Feld außerhalb steht
      // und erst durch die geänderte Breite abschneidet
      clippedOpen = await clippedFields(page, 'main')
      await page.evaluate(() => { for (const d of (/** @type {any} */ (globalThis)).document.querySelectorAll('main details[data-bc-opened]')) { d.open = false; d.removeAttribute('data-bc-opened') } })
      await settle(page)
    }
    for (const text of await visibleErrors(page)) add(id, 'Fehlermeldung', text)
    const clippedClosed = await clippedFields(page, 'main')
    reportClipped(id, clippedClosed)
    reportClipped(id, clippedOpen.filter((f) => !clippedClosed.some((c) => c.name === f.name && c.text === f.text)), 'aufgeklappt: ')
    await runAxe(id)
    // Die ganze Seite; was dafür zu hoch ist (Firefox nimmt höchstens 32767 px, die Hilfe am Handy ist
    // höher), nur das Fenster
    const shot = path.join(dir, `${id}.png`)
    await page.screenshot({ path: shot, fullPage: true }).catch(() => page.screenshot({ path: shot }))
    // Die Seitenfenster der Seite öffnen und ihre Felder messen, im ersten Design des Laufs (die Breite hängt nicht
    // am Design)
    if (theme === themes[0]) drawersOpened += await checkDrawers(page, id, dir, add, reportClipped)
  }

  // Die Musterseite (`?muster`, #346 Schritt 12): alle Bausteine auf einer Seite, mit denselben Prüfungen wie jede Seite
  // der Navigation. Sie kommt ohne Server aus und ist deshalb nicht in der Navigation; `--pages muster` prüft sie allein.
  if (PAGES === null || PAGES.includes('muster')) {
    current = 'muster'
    await page.goto(`${base}/?muster${theme === 'dark' ? '=dunkel' : ''}`)
    await page.getByRole('heading', { name: 'Musterseite', level: 1 }).waitFor()
    await settle(page)
    checkedPages++
    const wide = await overflow(page)
    if (wide) add('muster', 'Breite', `Seite ${wide.scroll} px breit bei ${wide.width} px Fenster${wide.elements.length ? `: ${wide.elements.join('; ')}` : ''}`)
    reportClipped('muster', await clippedFields(page, 'main'))
    await runAxe('muster')
    await page.screenshot({ path: path.join(dir, 'muster.png'), fullPage: true }).catch(() => {})
    // Zurück in die App für die Bedienproben
    await page.goto(base)
    await page.locator(view === 'mobile' ? 'button.menu-toggle' : 'nav.sidebar').first().waitFor()
    await settle(page)
  }

  if (theme === themes[0] && PAGES === null && drawersOpened < MIN_DRAWERS) {
    add('fenster', 'Seitenfenster', `Nur ${drawersOpened} statt mindestens ${MIN_DRAWERS} Seitenfenster geöffnet und gemessen; ist ein Knopf umbenannt oder öffnet ein Fenster nicht?`)
  }

  // Die Bedienproben einmal je Engine und Ansicht, im ersten Design des Laufs (Vorgabe: hell)
  if (theme === themes[0]) {
    for (const [name, probe] of /** @type {const} */ ([
      ['seitenfenster', probeDrawer], ['monatsfeld', probeMonth], ['begriff', probeTerm], ['fehler-nach-speichern', probeError],
      ['beleg-zuordnen', probeAttach],
      ...(view === 'mobile' ? /** @type {const} */ ([['navigation-handy', probeMobileNav]]) : []),
    ])) {
      current = `probe:${name}`
      try {
        // Je Probe ein Foto vom offenen Zustand und axe darauf, unter der Kennung der Probe
        await probe(page, view, async (state) => {
          await runAxe(`${name}:${state}`)
          await page.screenshot({ path: path.join(dir, `probe-${name}-${state}.png`) })
        })
      } catch (err) {
        add(`probe:${name}`, 'Bedienprobe', err instanceof Error ? err.message.split('\n')[0] : String(err))
        await page.screenshot({ path: path.join(dir, `probe-${name}-befund.png`) }).catch(() => {})
        // Für die nächste Probe einen sauberen Stand: alles offene schließen, ohne zu speichern
        await page.reload().catch(() => {})
        await settle(page)
      }
    }
  }
  await context.close()
  return labels
}

// Öffnet nacheinander die Seitenfenster einer Seite (DRAWER_OPENERS), misst ihre Felder, fotografiert sie und schließt
// sie ohne Änderung. Ein Knopf, der kein Seitenfenster öffnet, wird übergangen.
async function checkDrawers(page, id, dir, add, reportClipped) {
  const names = await page.locator('main button:visible').evaluateAll((buttons, re) => {
    const pattern = new RegExp(re)
    const seen = new Set()
    const out = []
    for (const b of buttons) {
      if (b.disabled) continue
      const name = (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim()
      if (!pattern.test(name) || seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
    return out
  }, DRAWER_OPENERS.source)
  let n = 0
  for (const name of names) {
    const button = page.locator('main').getByRole('button', { name, exact: true }).first()
    if (!(await button.count())) continue
    await button.scrollIntoViewIfNeeded().catch(() => {})
    await button.click().catch(() => {})
    const drawer = page.locator('dialog.drawer[open]').first()
    if (!(await drawer.waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false))) {
      // Kein Seitenfenster (etwa ein Formular in der Karte): neu laden, damit nichts offen bleibt
      await page.reload().catch(() => {})
      await settle(page)
      continue
    }
    await page.waitForTimeout(250)
    n++
    reportClipped(`${id}:fenster`, await clippedFields(page, 'dialog.drawer[open]'), `„${name}“, `)
    await drawer.screenshot({ path: path.join(dir, `${id}-fenster-${n}.png`) }).catch(() => {})
    await page.keyboard.press('Escape')
    const ask = page.getByRole('alertdialog')
    if (await ask.waitFor({ state: 'visible', timeout: 600 }).then(() => true, () => false)) await ask.getByRole('button', { name: 'Verwerfen' }).click()
    const closed = await drawer.waitFor({ state: 'hidden', timeout: 3000 }).then(() => true, () => false)
    // Bleibt ein Fenster offen, ist das ein Befund; die Seite lädt neu, damit die nächste Prüfung frei ist
    if (!closed) {
      add(`${id}:fenster`, 'Seitenfenster', `„${name}“ schließt mit Esc (und „Verwerfen“) nicht.`)
      await page.reload().catch(() => {})
      await settle(page)
    }
  }
  return n
}

// ---------- Bedienproben ----------
const fail = (text) => { throw new Error(text) }
const focusedText = (page) => page.evaluate(() => {
  const el = (/** @type {any} */ (globalThis)).document.activeElement
  return { tag: el?.tagName?.toLowerCase() ?? '', text: (el?.textContent ?? '').trim(), label: el?.getAttribute?.('aria-label') ?? '', value: el?.value ?? '' }
})

// Das Seitenfenster „Neue Wohnung“: Eingabe, Esc fragt mit dem Fokus auf „Abbrechen“, Enter lässt das
// Fenster offen, Esc und „Verwerfen“ schließen es, der Fokus geht an den Auslöser zurück.
async function probeDrawer(page, view, snap) {
  await go(page, view, 'Stammdaten')
  const opener = page.getByRole('button', { name: '+ Wohnung anlegen' })
  await opener.click()
  const drawer = page.getByRole('dialog', { name: 'Neue Wohnung' })
  await drawer.waitFor({ state: 'visible' })
  await page.waitForTimeout(120)
  const inField = await drawer.evaluate((d) => d.contains((/** @type {any} */ (globalThis)).document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test((/** @type {any} */ (globalThis)).document.activeElement.tagName))
  if (!inField) fail('Seitenfenster: Der Fokus steht nach dem Öffnen nicht im ersten Feld.')
  await page.keyboard.type('Probe')
  await snap('offen')
  await page.keyboard.press('Escape')
  const ask = page.getByRole('alertdialog', { name: 'Änderungen verwerfen?' })
  await ask.waitFor({ state: 'visible', timeout: 3000 }).catch(() => fail('Seitenfenster: Esc mit Änderung fragt nicht nach.'))
  const f = await focusedText(page)
  if (f.text !== 'Abbrechen') fail(`Seitenfenster: Der Fokus der Rückfrage steht auf „${f.text || f.tag}“ statt auf „Abbrechen“.`)
  await snap('rueckfrage')
  await page.keyboard.press('Enter')
  await ask.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => fail('Seitenfenster: Enter auf „Abbrechen“ schließt die Rückfrage nicht.'))
  if (!(await drawer.isVisible())) fail('Seitenfenster: Enter auf „Abbrechen“ hat das Fenster geschlossen.')
  await page.keyboard.press('Escape')
  await ask.waitFor({ state: 'visible', timeout: 3000 }).catch(() => fail('Seitenfenster: Das zweite Esc fragt nicht nach.'))
  await ask.getByRole('button', { name: 'Verwerfen' }).click()
  await drawer.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => fail('Seitenfenster: „Verwerfen“ schließt das Fenster nicht.'))
  const back = await opener.evaluate((b) => b === (/** @type {any} */ (globalThis)).document.activeElement)
  if (!back) fail('Seitenfenster: Nach dem Schließen steht der Fokus nicht auf „+ Wohnung anlegen“.')
}

// Schließt ein Seitenfenster mit Änderungen über die Rückfrage.
async function discardDrawer(page, drawer) {
  await page.keyboard.press('Escape')
  const ask = page.getByRole('alertdialog', { name: 'Änderungen verwerfen?' })
  if (await ask.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)) await ask.getByRole('button', { name: 'Verwerfen' }).click()
  await drawer.waitFor({ state: 'hidden', timeout: 3000 })
}

// Das Monatsfeld der Staffel im Seitenfenster „Neues Mietverhältnis“: „3.2025“ getippt wird beim Verlassen
// „März 2025“; das Raster öffnet mit dem Fokus auf März, → und Enter wählen April, Esc schließt nur das Raster.
async function probeMonth(page, view, snap) {
  await go(page, view, 'Stammdaten')
  await page.getByRole('button', { name: '+ Mietverhältnis anlegen' }).click()
  const drawer = page.getByRole('dialog', { name: 'Neues Mietverhältnis' })
  await drawer.waitFor({ state: 'visible' })
  const field = drawer.locator('.month-field').first()
  const input = field.locator('input')
  await input.scrollIntoViewIfNeeded()
  await input.click()
  await input.fill('')
  await page.keyboard.type('3.2025')
  await page.keyboard.press('Tab')
  const shown = await input.inputValue()
  if (shown !== 'März 2025') fail(`Monatsfeld: „3.2025“ wird beim Verlassen zu „${shown}“ statt „März 2025“.`)
  await field.getByRole('button', { name: 'Monat im Raster wählen' }).click()
  // Das Raster hängt als Popover am Ende von body bzw. des Dialogs; jedes Monatsfeld hat eines
  const pop = page.locator('.month-pop:visible').first()
  await pop.waitFor({ state: 'visible', timeout: 3000 }).catch(() => fail('Monatsfeld: Das Raster öffnet nicht.'))
  await page.waitForTimeout(80)
  let f = await focusedText(page)
  if (f.label !== 'März 2025') fail(`Monatsfeld: Das Raster öffnet mit dem Fokus auf „${f.label || f.text || f.tag}“ statt auf „März 2025“.`)
  await snap('raster')
  await page.keyboard.press('ArrowRight')
  f = await focusedText(page)
  if (f.label !== 'April 2025') fail(`Monatsfeld: → führt auf „${f.label || f.text}“ statt auf „April 2025“.`)
  await page.keyboard.press('ArrowDown')
  f = await focusedText(page)
  if (f.label !== 'Juli 2025') fail(`Monatsfeld: ↓ führt auf „${f.label || f.text}“ statt auf „Juli 2025“.`)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await pop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => fail('Monatsfeld: Enter im Raster schließt es nicht.'))
  const picked = await input.inputValue()
  if (picked !== 'April 2025') fail(`Monatsfeld: Enter im Raster ergibt „${picked}“ statt „April 2025“.`)
  await field.getByRole('button', { name: 'Monat im Raster wählen' }).click()
  await pop.waitFor({ state: 'visible', timeout: 3000 })
  await page.keyboard.press('Escape')
  await pop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => fail('Monatsfeld: Esc schließt das Raster nicht.'))
  if (!(await drawer.isVisible())) fail('Monatsfeld: Esc im Raster hat das ganze Seitenfenster geschlossen.')
  if (await page.getByRole('alertdialog').isVisible()) fail('Monatsfeld: Esc im Raster hat die Rückfrage des Seitenfensters ausgelöst.')
  await discardDrawer(page, drawer)
}

// Belegordner, Position ohne Beleg (N7 aus #341): Wer in „Aus dem Posteingang …“ einen Beleg wählt, bekommt
// „Speichern“ und „Verwerfen“ dazu; „Beleg nachreichen“ bleibt dabei, wo er war. Danach wird verworfen.
async function probeAttach(page, view, snap) {
  await go(page, view, 'Belegordner')
  const picker = page.locator('main select[aria-label^="Vorhandenen Beleg für"]').first()
  if (!(await picker.count())) fail('Beleg zuordnen: Im Beispielbestand gibt es keine Position ohne Beleg mit Belegen im Posteingang.')
  await picker.evaluate((el) => { const d = el.closest('details'); if (d) d.open = true })
  await picker.scrollIntoViewIfNeeded()
  const group = picker.locator('xpath=ancestor::span[contains(@class, "receipt-attach")]')
  const button = group.locator('label.btn')
  const before = await button.boundingBox()
  await picker.selectOption({ index: 1 })
  const discard = group.getByRole('button', { name: /^Verwerfen/ })
  await discard.waitFor({ state: 'visible', timeout: 3000 }).catch(() => fail('Beleg zuordnen: Nach der Wahl erscheint kein „Verwerfen“.'))
  const after = await button.boundingBox()
  await snap('gewaehlt')
  if (!before || !after) fail('Beleg zuordnen: „Beleg nachreichen“ ist nicht sichtbar.')
  else if (Math.abs(before.x - after.x) > 1 || Math.abs(before.y - after.y) > 1) {
    fail(`Beleg zuordnen: „Beleg nachreichen“ springt von ${Math.round(before.x)}/${Math.round(before.y)} nach ${Math.round(after.x)}/${Math.round(after.y)}, sobald „Speichern“ und „Verwerfen“ erscheinen.`)
  }
  await discard.click()
}

// Die Begriffserklärung: der erste sichtbare Begriff auf Stammdaten, Kosten oder Abrechnung; Klick öffnet
// die Erklärung, Esc schließt sie, der Fokus steht wieder auf dem Begriff.
async function probeTerm(page, view, snap) {
  for (const label of ['Stammdaten', 'Kosten', 'Abrechnung']) {
    await go(page, view, label)
    const term = page.locator('main [role="button"].term:visible, .term[role="button"]:visible').first()
    if (!(await term.count())) continue
    await term.scrollIntoViewIfNeeded()
    await term.click()
    const pop = page.locator('.term-pop:visible')
    await pop.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => fail(`Begriff (${label}): Die Erklärung öffnet nicht.`))
    const box = await pop.first().boundingBox()
    const vp = page.viewportSize()
    if (box && vp && (box.x < -1 || box.x + box.width > vp.width + 1 || box.width < 160)) {
      fail(`Begriff (${label}): Die Erklärung steht nicht ganz im Bild oder ist schmaler als 160 px (${Math.round(box.x)} px, ${Math.round(box.width)} px breit).`)
    }
    await snap('offen')
    await page.keyboard.press('Escape')
    await page.locator('.term-pop:visible').first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => fail(`Begriff (${label}): Esc schließt die Erklärung nicht.`))
    const back = await term.evaluate((t) => t === (/** @type {any} */ (globalThis)).document.activeElement)
    if (!back) fail(`Begriff (${label}): Nach Esc steht der Fokus nicht auf dem Begriff.`)
    return
  }
  fail('Begriff: Auf Stammdaten, Kosten und Abrechnung steht kein Begriff mit Erklärung.')
}

// Eine Fehlermeldung nach dem Speichern liegt im sichtbaren Bereich, nicht unter Kopf oder unterer Leiste,
// und hat den Fokus: im Seitenfenster „Neue Ablesung“ (#346 Schritt 7) „Anlegen“ ohne Angaben; die Sammelmeldung steht
// im Fuß des Fensters über den Knöpfen.
async function probeError(page, view, snap) {
  await go(page, view, 'Zähler & Stände')
  // „+ Ablesung anlegen“ steht im aufgeklappten Zähler
  await page.getByRole('button', { name: /^Ablesungen \(/ }).first().click()
  const opener = page.getByRole('button', { name: '+ Ablesung anlegen' }).first()
  await opener.waitFor({ state: 'visible', timeout: 5000 }).catch(() => fail('Fehler nach Speichern: Auf der Seite Zähler steht kein Knopf „+ Ablesung anlegen“.'))
  await opener.scrollIntoViewIfNeeded()
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Neue Ablesung' })
  await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => fail('Fehler nach Speichern: Das Fenster „Neue Ablesung“ öffnet nicht.'))
  await dialog.getByRole('button', { name: 'Anlegen' }).click()
  const summary = dialog.locator('[data-error-summary]').first()
  await summary.waitFor({ state: 'visible', timeout: 3000 }).catch(() => fail('Fehler nach Speichern: Es erscheint keine Sammelmeldung.'))
  await page.waitForTimeout(300)
  const where = await summary.evaluate((el) => {
    const win = /** @type {any} */ (globalThis)
    const doc = win.document
    const r = el.getBoundingClientRect()
    const head = doc.querySelector('.mobile-head')?.getBoundingClientRect()
    const bar = doc.querySelector('.bottom-bar')?.getBoundingClientRect()
    return {
      top: r.top, bottom: r.bottom, height: win.innerHeight,
      headBottom: head && head.height ? head.bottom : 0,
      barTop: bar && bar.height ? bar.top : win.innerHeight,
      focused: el === doc.activeElement || el.contains(doc.activeElement),
    }
  })
  if (!where.focused) fail('Fehler nach Speichern: Die Sammelmeldung hat nicht den Fokus.')
  if (where.top < where.headBottom - 1 || where.bottom > where.barTop + 1) {
    fail(`Fehler nach Speichern: Die Sammelmeldung liegt nicht im sichtbaren Bereich (${Math.round(where.top)} bis ${Math.round(where.bottom)} px, sichtbar ${Math.round(where.headBottom)} bis ${Math.round(where.barTop)} px).`)
  }
  await snap('meldung')
  // Aufräumen: die Seite neu laden, damit die Meldung keine folgende Prüfung stört
  await page.reload()
  await settle(page)
}

// Am Handy: ☰ öffnet das Menüblatt, Esc schließt es mit dem Fokus auf ☰, ein Eintrag wechselt die Seite und
// schließt es; die untere Leiste wechselt die Seite und markiert sich.
async function probeMobileNav(page, view, snap) {
  const toggle = page.locator('button.menu-toggle')
  const sheet = page.locator('dialog.menu-sheet')
  await toggle.click()
  await sheet.waitFor({ state: 'visible', timeout: 3000 }).catch(() => fail('Handy: ☰ öffnet das Menüblatt nicht.'))
  const inside = await sheet.evaluate((d) => d.contains((/** @type {any} */ (globalThis)).document.activeElement))
  if (!inside) fail('Handy: Nach dem Öffnen steht der Fokus nicht im Menüblatt.')
  await snap('menueblatt')
  await page.keyboard.press('Escape')
  await sheet.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => fail('Handy: Esc schließt das Menüblatt nicht.'))
  if (!(await toggle.evaluate((b) => b === (/** @type {any} */ (globalThis)).document.activeElement))) fail('Handy: Nach Esc steht der Fokus nicht auf ☰.')
  await toggle.click()
  await sheet.waitFor({ state: 'visible' })
  await sheet.locator('.nav-group button').filter({ hasText: 'Kosten' }).first().click()
  await sheet.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => fail('Handy: Ein Eintrag im Menüblatt schließt es nicht.'))
  const title = (await page.locator('.mobile-head > div > div').first().innerText()).trim()
  if (title !== 'Kosten') fail(`Handy: Nach „Kosten“ im Menüblatt steht im Kopf „${title}“.`)
  const bar = page.locator('nav.bottom-bar')
  await bar.getByRole('button', { name: 'Zähler' }).click()
  await settle(page)
  const current = await bar.locator('[aria-current="page"]').innerText().catch(() => '')
  if (!current.includes('Zähler')) fail(`Handy: Nach „Zähler“ in der unteren Leiste ist dort „${current.trim() || 'nichts'}“ markiert.`)
  const head = (await page.locator('.mobile-head > div > div').first().innerText()).trim()
  if (head !== 'Zähler & Stände') fail(`Handy: Nach „Zähler“ in der unteren Leiste steht im Kopf „${head}“.`)
}

// ---------- Bericht ----------
function report() {
  const lines = []
  const ok = findings.length === 0
  lines.push(`## Browserlauf: ${ok ? 'ohne Befund' : `${findings.length} ${findings.length === 1 ? 'Befund' : 'Befunde'}`}`)
  lines.push('')
  lines.push(`Engines: ${engines.join(', ')} · Ansichten: ${views.join(', ')} · Designs: ${themes.join(', ')} · ${checkedPages} Seitenaufrufe geprüft${FULL ? '' : ' · Teillauf'}`)
  lines.push('')
  lines.push('| Engine | Laufzeit |')
  lines.push('|---|---|')
  for (const e of engines) lines.push(`| ${e} | ${runtimes[e] === undefined ? 'nicht gelaufen' : `${Math.round(runtimes[e])} s`} |`)
  lines.push('')
  if (!ok) {
    lines.push('### Befunde')
    lines.push('')
    lines.push('| Engine | Ansicht | Design | Seite | Art | Befund |')
    lines.push('|---|---|---|---|---|---|')
    const cell = (s) => String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ')
    for (const f of findings) lines.push(`| ${f.engine} | ${f.view} | ${f.theme} | ${cell(f.page)} | ${f.kind} | ${cell(f.text)} |`)
    lines.push('')
  }
  if (axeExceptions.length) {
    lines.push('### axe-Ausnahmen (scripts/browser-check-axe.json)')
    lines.push('')
    lines.push('| Regel | Seite | erlaubt | gemessen höchstens | Grund |')
    lines.push('|---|---|---|---|---|')
    for (const ex of axeExceptions) lines.push(`| ${ex.regel} | ${ex.seite}${ex.ansicht ? ` (${ex.ansicht})` : ''}${ex.design ? ` (${ex.design})` : ''}${ex.engine ? ` (${ex.engine})` : ''} | ${ex.anzahl} | ${axeSeen.get(ex)} | ${ex.grund} |`)
    lines.push('')
  }
  lines.push(`Fotos: \`${OUT}\``)
  return lines.join('\n')
}

// ---------- Ablauf ----------
async function main() {
  const playwright = await loadPlaywright()
  const { default: AxeBuilder } = await import('@axe-core/playwright')
  if (!SKIP_BUILD) {
    console.log('Oberfläche bauen …')
    execSync('npm run build', { cwd: root, stdio: 'inherit' })
  }
  if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) throw new Error('client/dist fehlt. Bitte ohne --skip-build ausführen.')
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  console.log('Beispielbestand anlegen …')
  const demo = await startDemo({ pdf: textPdf, prefix: 'mietfuchs-browserlauf-' })
  // Bericht und Zusammenfassung entstehen auch, wenn die Prüfung selbst scheitert: Der Fehler wird ein Befund.
  try {
    // Eine Heizanlage mit freien Schlüsseln, damit die Seite Heizkosten in der Navigation steht. Sie ändert
    // keine Zahl (CLAUDE.md, Heizanlage) und kommt nicht in den Bestand der Bildschirmfotos.
    await demo.api.post(`/api/heating-plants?property=${demo.ids.haus}`, { energy: 'gas', method: 'manual', assignItemIds: [] })
    // Welche Seiten die Navigation zeigen muss: alle aus nav.ts, die Heizkosten, weil der Bestand eine Anlage hat.
    // Fehlt eine, prüfte der Lauf sonst still eine Seite weniger.
    const expected = navFor(true).flatMap((g) => g.items.map((i) => i.label))
    /** @type {string[] | null} */
    let navLabels = null
    for (const engine of engines) {
      const started = Date.now()
      console.log(`${engine} …`)
      /** @type {import('playwright').Browser} */
      let browser
      try {
        browser = await playwright[engine].launch(engine === 'chromium' ? { args: ['--lang=de-DE'], env: { ...process.env, LANG: 'de_DE.UTF-8' } } : engine === 'firefox' ? { firefoxUserPrefs: { 'intl.accept_languages': 'de-DE, de' } } : {})
      } catch (err) {
        findings.push({ engine, view: '–', theme: '–', page: '–', kind: 'Start', text: `Die Engine startet nicht: ${err instanceof Error ? err.message.split('\n')[0] : err}` })
        continue
      }
      try {
        // Am Rechner zuerst: dort liest der Lauf die Navigation, das Handy nimmt dieselben Einträge
        for (const view of ['desktop', 'mobile'].filter((v) => views.includes(v))) {
          for (const theme of themes) {
            const before = findings.length
            const labels = await checkCombination(browser, demo.base, { engine, view, theme }, AxeBuilder, navLabels)
            if (!navLabels) {
              navLabels = labels
              for (const l of expected) if (!labels.includes(l)) findings.push({ engine, view, theme, page: slug(l), kind: 'Navigation', text: `„${l}“ steht in nav.ts, fehlt aber in der Navigation.` })
              for (const l of labels) if (!expected.includes(l)) findings.push({ engine, view, theme, page: slug(l), kind: 'Navigation', text: `„${l}“ steht in der Navigation, aber nicht in nav.ts.` })
            }
            console.log(`  ${view} ${theme}: ${findings.length - before ? `${findings.length - before} Befunde` : 'ohne Befund'}`)
            const down = demo.problem()
            if (down) throw new Error(down)
          }
        }
      } finally {
        await browser.close()
      }
      runtimes[engine] = (Date.now() - started) / 1000
    }

    // Ein Tippfehler in --pages prüfte sonst keine Seite und meldete grün
    if (PAGES) {
      for (const id of PAGES) {
        if (id !== 'muster' && !(navLabels ?? []).some((l) => slug(l) === id)) findings.push({ engine: 'alle', view: '–', theme: '–', page: id, kind: 'Aufruf', text: `--pages nennt „${id}“, die Navigation hat keine solche Seite (möglich: ${(navLabels ?? expected).map(slug).join(', ')}).` })
      }
    }
    if (checkedPages === 0 && (PAGES === null || PAGES.length > 0)) {
      findings.push({ engine: 'alle', view: '–', theme: '–', page: '–', kind: 'Aufruf', text: 'Keine Seite geprüft.' })
    }

    // Was dieser Lauf je Ausnahme gemessen hat; in GitHub Actions läuft jede Engine für sich, und erst `--merge`
    // über alle Läufe weiß, ob eine Ausnahme sinken kann. Eine Engine, die nicht startete, deckt nichts ab.
    const ran = engines.filter((e) => runtimes[e] !== undefined)
    const measured = { engines: ran, views, themes, allPages: PAGES === null, seen: Object.fromEntries(axeExceptions.map((ex) => [exceptionKey(ex), axeSeen.get(ex) ?? 0])) }
    fs.writeFileSync(path.join(OUT, 'axe-gemessen.json'), `${JSON.stringify(measured, null, 2)}\n`)
    if (FULL && ran.length === ENGINES.length) findings.push(...staleExceptions(measured.seen))
    if (FULL && ran.length === ENGINES.length) {
      for (const ex of fieldExceptions) {
        if (!fieldSeen.has(ex)) findings.push({ engine: 'alle', view: '–', theme: '–', page: ex.seite, kind: 'Feld-Ausnahme', text: `Ausnahme „${ex.feld}“ tritt nicht mehr auf: bitte aus browser-check-fields.json streichen.` })
      }
    }
  } catch (err) {
    findings.push({ engine: '–', view: '–', theme: '–', page: '–', kind: 'Abbruch', text: err instanceof Error ? err.message.split('\n').slice(0, 3).join(' ') : String(err) })
    console.error(err)
  } finally {
    await demo.stop()
    const text = report()
    fs.writeFileSync(path.join(OUT, 'bericht.md'), `${text}\n`)
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
    console.log(`\n${text}`)
    if (findings.length) process.exitCode = 1
  }
}

// `--merge <Ordner>`: die Messungen aller Läufe unter dem Ordner (je Engine ein Artefakt) zusammen. Decken sie
// alle Engines, Ansichten, Designs und Seiten ab, ist jede Ausnahme, die seltener auftritt als erlaubt, ein Befund.
function merge(dir) {
  const files = fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => path.basename(f) === 'axe-gemessen.json')
  if (!files.length) throw new Error(`Unter ${dir} liegt keine axe-gemessen.json.`)
  /** @type {Record<string, number>} */
  const seen = {}
  const covered = new Set()
  for (const f of files) {
    const run = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    for (const [key, n] of Object.entries(run.seen)) seen[key] = Math.max(seen[key] ?? 0, Number(n))
    if (run.allPages) for (const e of run.engines) for (const v of run.views) for (const t of run.themes) covered.add(`${e}|${v}|${t}`)
  }
  const full = ENGINES.every((e) => Object.keys(VIEWS).every((v) => THEMES.every((t) => covered.has(`${e}|${v}|${t}`))))
  const stale = full ? staleExceptions(seen) : []
  const lines = [`## Browserlauf: axe-Ausnahmen über ${files.length} Läufe`, '']
  if (!full) lines.push('Die Läufe decken nicht alle Engines, Ansichten, Designs und Seiten ab; ob eine Ausnahme sinken kann, bleibt offen.', '')
  else if (!stale.length) lines.push(axeExceptions.length ? 'Jede Ausnahme tritt noch so oft auf, wie die Datei erlaubt.' : 'Keine Ausnahmen in browser-check-axe.json.', '')
  for (const f of stale) lines.push(`- ${f.page}: ${f.text}`)
  const text = lines.join('\n')
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  console.log(text)
  if (stale.length) process.exitCode = 1
}

const mergeDir = opt('merge', null)
;(mergeDir ? Promise.resolve().then(() => merge(path.resolve(mergeDir))) : main()).catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.stack ?? err.message : err}`)
  process.exitCode = 1
})
