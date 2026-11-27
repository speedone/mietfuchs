// Notbremse gegen den verkleinerten Druck (#647). Ist irgendetwas im Druck breiter als die Seite, verkleinern Chromium
// (auch das Programmfenster), Firefox und Safari das ganze Dokument, und im Anschreiben stehen Fußzeile, Falz- und
// Lochmarken zu hoch. Vorgebeugt ist dem in letter.css, softBreak.ts und mit scripts/print-width-check.mjs bei jedem PR;
// diese Notbremse fängt, was dort niemand vorhergesehen hat (eine neue Ansicht, ein Wert, den kein Prüffall kennt).
//
// **Gemessen wird bei `beforeprint`, mit nachgestelltem Drucklayout.** Danach ist es zu spät: Chromium legt den Faktor
// im ersten Drucklayout fest; eine Änderung aus einem Listener auf `matchMedia('print')` kam zwar in die PDF, die Schrift
// blieb aber verkleinert (nachgemessen, 8 statt 12 pt). Deshalb schaltet die Notbremse synchron jede Regel `@media` so,
// wie sie im Druck gälte (Druck statt Bildschirm, Breiten gegen den Satzspiegel statt gegen das Fenster), setzt das
// Dokument auf die Breite des Satzspiegels, misst und stellt alles zurück; dazwischen zeichnet der Browser nicht.
//
// **Angefasst wird nur, was hinausragt**, mit der Klasse `print-fit` (letter.css): Eine Datentabelle bekommt feste
// Spalten über die ganze Breite und bricht überall um, ein anderes Element bricht überall um. Zuerst die Tabellen, dann
// neu gemessen, denn eine zu breite Tabelle zieht ihre Nachbarn in der Hülle `.print-pages` mit. Das sieht im
// Notfall weniger schön aus, aber es fehlt nichts, und das Anschreiben bleibt in voller Größe. Im Normalfall greift sie
// nie (print-width-check.mjs prüft das in jedem Fall).
const MM = 96 / 25.4
const A4_WIDTH_MM = 210
const DEFAULT_MARGIN = '12mm' // letter.css
const REM = 16
export const PRINT_FIT = 'print-fit'

const UNIT: Record<string, number> = { mm: MM, cm: 10 * MM, q: MM / 4, in: 96, pt: 96 / 72, pc: 16, px: 1 }

export function lengthPx(value: string | null | undefined): number | null {
  const m = /^\s*(-?\d*\.?\d+)\s*([a-z]*)\s*$/i.exec(value ?? '')
  if (!m) return null
  const n = Number(m[1])
  const unit = m[2].toLowerCase()
  if (unit === '') return n === 0 ? 0 : null
  const factor = UNIT[unit]
  return factor === undefined ? null : n * factor
}

// Breite des Satzspiegels auf A4. Letter ist breiter; A4 ist die strengere Annahme.
export function pageContentWidthPx(marginLeft: string | null, marginRight: string | null): number {
  const fallback = lengthPx(DEFAULT_MARGIN) ?? 0
  return A4_WIDTH_MM * MM - (lengthPx(marginLeft) ?? fallback) - (lengthPx(marginRight) ?? fallback)
}

// Wie weit der Druck reichen darf: der Satzspiegel abzüglich des Innenabstands von body. Den gibt es nur, wo die Seite
// ohne Rand druckt und body die 12 mm freihält (Firefox, #735, `print-page-edge` in letter.css); mit Briefpapier ist er 0.
export function printLimitPx(width: number, bodyPaddingRight: string): number {
  return width - (lengthPx(bodyPaddingRight) ?? 0)
}

const WIDTH_RANGE = /^\(\s*width\s*(<=|>=|<|>|=)\s*(\d*\.?\d+)(px|rem|em)\s*\)$/
const WIDTH_MIN_MAX = /^\(\s*(min|max)-width\s*:\s*(\d*\.?\d+)(px|rem|em)\s*\)$/
const DEVICE = /^\(\s*(any-)?(hover|pointer)\s*(:|\))|^\(\s*prefers-/

function widthCondition(condition: string, width: number): boolean | null {
  const px = (n: string, unit: string) => Number(n) * (unit === 'px' ? 1 : REM)
  const range = WIDTH_RANGE.exec(condition)
  if (range) {
    const v = px(range[2], range[3])
    return { '<=': width <= v, '>=': width >= v, '<': width < v, '>': width > v, '=': width === v }[range[1]] ?? null
  }
  const minMax = WIDTH_MIN_MAX.exec(condition)
  if (minMax) return minMax[1] === 'min' ? width >= px(minMax[2], minMax[3]) : width <= px(minMax[2], minMax[3])
  return null
}

function queryMatches(query: string, width: number, device: (condition: string) => boolean): boolean | null {
  let q = query.trim().toLowerCase()
  let negate = false
  if (q.startsWith('not ')) { negate = true; q = q.slice(4).trim() } else if (q.startsWith('only ')) q = q.slice(5).trim()
  let result = true
  for (const part of q.split(/\s+and\s+/)) {
    if (!part.startsWith('(')) {
      if (part === 'print' || part === 'all') continue
      result = false // screen und alles andere
      continue
    }
    const w = widthCondition(part, width)
    if (w !== null) { result &&= w; continue }
    if (DEVICE.test(part)) { result &&= device(part); continue }
    return null
  }
  return negate ? !result : result
}

// Gälte diese Liste von Media-Queries im Druck auf einer Seite dieser Breite? `null`: nicht sicher zu sagen, die Regel
// bleibt dann, wie der Browser sie sieht.
export function printMediaMatches(mediaText: string, width: number, device: (condition: string) => boolean): boolean | null {
  if (mediaText.trim() === '') return true
  let any = false
  for (const query of mediaText.split(',')) {
    const m = queryMatches(query, width, device)
    if (m === null) return null
    any ||= m
  }
  return any
}

type Sheet = { cssRules: CSSRuleList }

function walk(rules: CSSRuleList, media: CSSMediaRule[], pages: CSSPageRule[]): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSPageRule) pages.push(rule)
    if (rule instanceof CSSMediaRule) media.push(rule)
    if ('cssRules' in rule && (rule as unknown as Sheet).cssRules) walk((rule as unknown as Sheet).cssRules, media, pages)
  }
}

// `unknown`: ein Stylesheet mit eigener Media-Angabe oder ein `@import`; was dort im Druck gilt, sieht die Notbremse nicht
function readRules(doc: Document): { media: CSSMediaRule[]; pages: CSSPageRule[]; unknown: boolean } {
  const media: CSSMediaRule[] = []
  const pages: CSSPageRule[] = []
  let unknown = false
  for (const sheet of Array.from(doc.styleSheets)) {
    if (sheet.media.mediaText.trim() !== '' && sheet.media.mediaText.trim() !== 'all') unknown = true
    let rules: CSSRuleList
    try { rules = sheet.cssRules } catch { continue } // fremde Herkunft: nicht lesbar
    if (Array.from(rules).some((r) => r instanceof CSSImportRule)) unknown = true
    walk(rules, media, pages)
  }
  return { media, pages, unknown }
}

// Ränder der Seite: die letzte Regel `@page` ohne Seitenwahl, die einen Rand setzt (letter.css, mit Briefpapier
// PAPER_PAGE_CSS danach)
function pageWidth(pages: CSSPageRule[]): number {
  let left: string | null = null
  let right: string | null = null
  for (const page of pages) {
    if (page.selectorText.trim() !== '') continue
    const l = page.style.getPropertyValue('margin-left')
    const r = page.style.getPropertyValue('margin-right')
    if (l) left = l
    if (r) right = r
  }
  return pageContentWidthPx(left, right)
}

type Reach = { left: number; right: number }

function reach(win: Window, el: Element, originX: number): Reach | null {
  const style = win.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return null
  const right = style.overflowX === 'visible' ? Math.max(r.right, r.left + el.scrollWidth) : r.right
  return { left: r.left - originX, right: right - originX }
}

// Was im nachgestellten Druck hinausragt, je das innerste Element (wie overflowingElements in print-width-views.mjs).
// Mit 1,5 px Spiel: Der Satzspiegel ist nicht ganzzahlig breit (702,99 px), `scrollWidth` schon, und Firefox meldete so
// Zeilen des Ableseformulars bei 703,5 px (nachgemessen); was den Druck sichtbar verkleinert, ragt um weit mehr hinaus.
const SLACK_PX = 1.5
function overflowing(win: Window, doc: Document, limit: number): Element[] {
  const originX = doc.documentElement.getBoundingClientRect().left
  // Nur nach rechts: Was links hinausragt, macht das Dokument nicht breiter (Durchsicht)
  const outside = (x: Reach | null) => x !== null && x.right > limit + SLACK_PX
  const found: Element[] = []
  for (const el of Array.from(doc.querySelectorAll('body *'))) {
    if (!outside(reach(win, el, originX))) continue
    if (Array.from(el.children).some((c) => outside(reach(win, c, originX)))) continue
    found.push(el)
  }
  return found
}

// Was die Notbremse bei diesem Druck markiert hat (leer im Normalfall). `null`: Sie setzt aus, weil sie eine Media-Query
// nicht auswerten kann; halb nachgestellt ergäbe die Messung Unsinn, etwa Teile der Oberfläche, die im Druck fehlen
// (Durchsicht). Der Druck geht dann wie ohne Notbremse.
export function fitForPrint(win: Window = window): Element[] | null {
  const doc = win.document
  for (const el of Array.from(doc.querySelectorAll(`.${PRINT_FIT}`))) el.classList.remove(PRINT_FIT)
  const { media, pages, unknown } = readRules(doc)
  const width = pageWidth(pages)
  const device = (condition: string) => win.matchMedia(condition).matches
  const verdicts = media.map((rule) => printMediaMatches(rule.media.mediaText, width, device))
  if (unknown || verdicts.some((m) => m === null)) return null
  const restore: [CSSMediaRule, string][] = []
  const root = doc.documentElement
  const rootWidth = root.style.getPropertyValue('width')
  const rootPriority = root.style.getPropertyPriority('width')
  const marked: Element[] = []
  try {
    media.forEach((rule, i) => {
      restore.push([rule, rule.media.mediaText])
      rule.media.mediaText = verdicts[i] ? 'all' : 'not all'
    })
    root.style.setProperty('width', `${width}px`, 'important')
    // Höchstens vier Runden: zuerst die Tabellen, dann, was danach noch hinausragt
    const limit = printLimitPx(width, win.getComputedStyle(doc.body).paddingRight)
    for (let round = 0; round < 4; round++) {
      const found = overflowing(win, doc, limit)
      if (found.length === 0) break
      const tables = new Set<Element>()
      for (const el of found) {
        // Ragt eine Zelle der Hülle `.print-pages` hinaus, ohne dass ein Kind es tut, zieht eine Tabelle darin sie auf
        // (ihre Mindestbreite plus Innenabstand der Hülle): dann die breiteste, nicht die ganze Aufstellung (CI unter Linux)
        const inner = [...el.querySelectorAll('table:not(.print-pages)')].filter((t) => !t.classList.contains(PRINT_FIT))
        const widest = inner.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
        const table = el.closest('table:not(.print-pages)') ?? widest ?? null
        if (table && !table.classList.contains(PRINT_FIT)) tables.add(table)
      }
      const targets = tables.size > 0 ? [...tables] : found.filter((el) => !el.classList.contains(PRINT_FIT))
      if (targets.length === 0) break
      for (const el of targets) { el.classList.add(PRINT_FIT); marked.push(el) }
    }
  } finally {
    for (const [rule, text] of restore) rule.media.mediaText = text
    if (rootWidth) root.style.setProperty('width', rootWidth, rootPriority)
    else root.style.removeProperty('width')
  }
  return marked
}

// Einmal beim Start (main.tsx), auch für Strg+P. Nach printJob.ts, das bei `beforeprint` in der Einfangphase aufräumt.
export function installPrintFit(win: Window = window): void {
  win.addEventListener('beforeprint', () => {
    // Spur am Dokument (Zahl der markierten Elemente oder `skipped`) für print-width-check.mjs und die Fehlersuche
    const root = win.document.documentElement
    try {
      const marked = fitForPrint(win)
      root.dataset.printFit = marked === null ? 'skipped' : String(marked.length)
      if (marked === null) console.warn('Druck: Notbremse ausgesetzt, eine Media-Query ist ihr unbekannt (#647)')
      else if (marked.length > 0) console.warn(`Druck: zu breit für die Seite, im Druck umgebrochen (#647); betroffen: ${marked.length}`, marked)
    } catch (error) {
      // Die Notbremse darf den Druck nie verhindern
      root.dataset.printFit = 'error'
      console.error('Druck: Notbremse gegen Verkleinern gescheitert (#647)', error)
    }
  })
}
