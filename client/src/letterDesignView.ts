// Logo und Briefpapier im Druck der Abrechnung (#415, Teil 2b), ohne DOM. Was gilt, steht in shared/letterDesign.ts
// (`effectiveLetterDesign`); hier wird daraus, was die Seite zeichnet.
//
// **Mit Briefpapier druckt die Seite ohne Seitenrand** (`PAPER_PAGE_CSS`): Chromium schneidet alles ab, was in den Rand
// von 12 mm ragt (nachgemessen), ein Briefpapier mit Kopf und Fuß bis an die Blattkante käme sonst mit weißem Rahmen
// heraus. Die Ränder des Textbereichs setzt die Seite dann selbst: das Anschreiben mit seinen Maßen ab der Blattkante,
// die Aufstellung über einen Rahmen, dessen Innenabstand oben und unten sich mit `box-decoration-break: clone` auf jeder
// Druckseite wiederholt (letter.css).
//
// **Ohne diese Funktion kein Briefpapier** (Druck in Safari, #286, nachgemessen mit WKWebView): WebKit nimmt die Ränder
// der ersten Seite für alle Seiten (auch die aus `@page :first`), wiederholt weder Tabellenkopf noch -fuß noch ein fest
// positioniertes Element je Seite und schneidet ab, was in den Seitenrand ragt. Ein Papier bis zur Blattkante und Ränder
// auf den Folgeseiten gehen dort nicht zusammen: Der Text stünde im Kopf oder Fuß des Papiers bzw. an der Blattkante. Ein
// solcher Browser druckt deshalb ohne Briefpapier, wie wenn die Datei fehlte (mit Absender und Seitenrand, die Fußzeile
// mit `printFooter`); die Seite und das Fenster „Drucken“ sagen es. Erkannt wird die Funktion selbst (`canPagePaper`).
import type { LetterDesignFile, LetterDesigns, LetterMargins } from '../../shared/types.ts'
import { effectiveLetterDesign, followPaper } from '../../shared/letterDesign.ts'

export type PrintDesign = {
  logo: LetterDesignFile | null
  paper: LetterDesignFile | null // erste Seite
  follow: LetterDesignFile | null // Folgeseiten
  margins: LetterMargins | null // nur mit Briefpapier
  paperSkipped: boolean // ein Briefpapier ist gewählt, aber dieser Browser kann es nicht drucken (Safari)
}

const NONE: PrintDesign = { logo: null, paper: null, follow: null, margins: null, paperSkipped: false }

// Ohne Seitenrand. Eine feste Breite des Dokuments (für WebKit, letter.css) braucht es nicht: Briefpapier druckt nur ein
// Browser mit Rändern je Seite (`canPagePaper`), und dort schaltete sie die Skalierung des Druckdialogs ab.
// Den Innenabstand von body aus der Betriebsart ohne Seitenrand (`print-page-edge`, Firefox, #735) braucht es dann nicht:
// Die Ränder des Briefpapiers setzt die Seite selbst. Ohne Schicht, schlägt also letter.css.
export const PAPER_PAGE_CSS = '@page { margin: 0; } @media print { html.print-page-edge body { padding: 0; } }'

type Css = { supports: (property: string, value: string) => boolean } | undefined
const browserVendor = (): string => globalThis.navigator?.vendor ?? ''
// Gecko (Firefox): `-moz-orient` kennt nur Gecko (der Build nutzt die Angabe schon). Blink (Chrome, Edge, das
// Programmfenster): Hersteller „Google Inc.“; Safari meldet „Apple Computer, Inc.“, Firefox nichts.
const isGecko = (css: Css): boolean => typeof css?.supports === 'function' && css.supports('-moz-orient', 'inline')
const isBlink = (vendor: string): boolean => vendor === 'Google Inc.'
const canClone = (css: Css): boolean => typeof css?.supports === 'function' && css.supports('box-decoration-break', 'clone')

// Kann der Browser den Innenabstand eines Blocks auf jeder Druckseite wiederholen? Chromium ab 130 und Firefox ja,
// WebKit nur mit Präfix und nur für Zeilen, nicht für Druckseiten (nachgemessen). Verlangt werden die Funktion und
// ausdrücklich Gecko oder Blink (Durchsicht S2 zu #735): Kennte Safari künftig die Angabe ohne Präfix, ohne sie je
// Druckseite zu wiederholen, stünde der Text der Folgeseiten sonst im Papier oder an der Blattkante.
export const canPagePaper = (css: Css = globalThis.CSS, vendor: string = browserVendor()): boolean =>
  canClone(css) && (isGecko(css) || isBlink(vendor))

// Die feste Breite des Dokuments im Druck (letter.css) nur in einem Browser ohne Ränder je Seite, also WebKit: Dort legt
// der Druck die Seite sonst um ein Viertel breiter an und druckt rund 7 % größer; in Chromium und Firefox schaltete sie
// die Skalierung des Druckdialogs ab (Durchsicht K1 zu PR #443). Einmal beim Start (main.tsx), auch für Strg+P.
export function markPrintWidth(root: { classList: { toggle: (name: string, on: boolean) => unknown } }, css: Css = globalThis.CSS, vendor: string = browserVendor()): void {
  root.classList.toggle('print-fixed-width', !canPagePaper(css, vendor))
}

// **Kopf- und Fußzeilen des Browsers** (#735): Adresse, Datum und „Seite x von y“ des Browsers stehen im Seitenrand.
// Nachgemessen am echten Druck in eine PDF: Chromium druckt sie nicht, wo im oberen bzw. unteren Rand ein Randfeld von
// `@page` steht (leer genügt; letter.css setzt oben und unten je eines, „Seite x von y“ aus printJob.ts bleibt). Firefox
// kennt keine Randfelder (MDN, nachgemessen in Firefox 157), druckt die Zeilen aber nicht bei Rand 0
// (`nsPageFrame::DrawHeaderFooter` zeichnet nur, wenn die Zeile in den Rand passt, und ein Rand 0 wird nicht auf den
// unbedruckbaren Rand des Druckers angehoben). Dort druckt die Seite deshalb ohne Rand und hält die 12 mm als
// Innenabstand von body frei, den `box-decoration-break: clone` auf jeder Druckseite wiederholt, wie der Rahmen mit
// Briefpapier: Alles steht, wo es mit Rand stand. WebKit kann das nicht (Ränder der ersten Seite für alle, `canPagePaper`)
// und behält den Rand; dort sagt das Fenster „Drucken“, wo man die Zeilen abschaltet (`browserLinesNote`).
export type PageEdges = 'margin-boxes' | 'page-edge' | 'browser'

const hasMarginRules = (): boolean => typeof (globalThis as { CSSMarginRule?: unknown }).CSSMarginRule === 'function'

// Ausdrücklich je Engine (Durchsicht S2): Rand 0 nur in Gecko mit `clone`, auch wenn Firefox künftig Randfelder kennt
// (nachgemessen ist nur der Rand 0); Randfelder nur in Blink. Ein Safari mit `clone` ohne Präfix bekäme sonst Rand 0 und
// druckte die Folgeseiten an der Blattkante.
export function pageEdges(css: Css = globalThis.CSS, marginRules: boolean = hasMarginRules(), vendor: string = browserVendor()): PageEdges {
  if (isGecko(css)) return canClone(css) ? 'page-edge' : 'browser'
  if (isBlink(vendor) && marginRules) return 'margin-boxes'
  return 'browser'
}

// `!important`, damit der Rand 0 vor dem aus letter.css gilt, gleich in welcher Reihenfolge die Stylesheets geladen werden.
export const PAGE_EDGE_CSS = '@page { margin: 0 !important; }'

type EdgeDocument = {
  documentElement: { classList: { toggle: (name: string, on: boolean) => unknown } }
  createElement: (tag: 'style') => { textContent: string | null, dataset: Record<string, string | undefined> }
  head: { append: (el: never) => unknown }
}

// Einmal beim Start (main.tsx), auch für Strg+P.
export function markPageEdges(doc: EdgeDocument, css: Css = globalThis.CSS, marginRules: boolean = hasMarginRules(), vendor: string = browserVendor()): void {
  const edge = pageEdges(css, marginRules, vendor) === 'page-edge'
  doc.documentElement.classList.toggle('print-page-edge', edge)
  if (!edge) return
  const style = doc.createElement('style')
  style.dataset.pageEdge = ''
  style.textContent = PAGE_EDGE_CSS
  doc.head.append(style as never)
}

// Der Satz im Fenster „Drucken“, wo die Zeilen bleiben. Der Weg in Safari nach Apples Anleitung „Webseiten in Safari auf
// dem Mac drucken“: Einblendmenü „Safari“ (den Knopf „Details einblenden“ belegt sie nur für ältere Fassungen von macOS,
// Durchsicht K1). Sonst (Chromium vor 131, ohne Randfelder) ohne Beschriftung.
export function browserLinesNote(edges: PageEdges, vendor: string = browserVendor()): string | null {
  if (edges !== 'browser') return null
  if (vendor.startsWith('Apple')) return 'Adresse und Datum oben und unten auf dem Blatt setzt Safari selbst dazu. Abschalten können Sie das im Fenster „Drucken“ unter „Safari“.'
  return 'Adresse, Datum und Seitenzahl oben und unten auf dem Blatt setzt der Browser selbst dazu. Abschalten können Sie das in seinem Druckfenster bei den Kopf- und Fußzeilen.'
}

export function printDesign(designs: LetterDesigns | null, { legacy, pagedPaper }: { legacy: boolean, pagedPaper: boolean }): PrintDesign {
  // Vor #415 abgeschlossen: gedruckt wird der bisherige Aufbau, ohne Gestaltung.
  if (!designs || legacy) return NONE
  const d = effectiveLetterDesign(designs)
  const paper = pagedPaper ? d.paper : null
  return {
    logo: d.logo,
    paper,
    follow: paper ? followPaper(d) : null,
    margins: paper ? d.margins : null,
    paperSkipped: !!d.paper && !paper,
  }
}

// Die Antwort des Servers, falls sie die erwartete Gestalt hat; sonst (älterer Server, Testattrappe) keine Gestaltung.
export function asLetterDesigns(raw: unknown): LetterDesigns | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Partial<LetterDesigns>
  const ok = (d: unknown) => d !== null && typeof d === 'object' && 'margins' in d
  if (!ok(r.installation) || (r.property !== null && !ok(r.property))) return null
  return r as LetterDesigns
}

export const paperVars = (m: LetterMargins): Record<string, string> => ({
  '--paper-top': `${m.top}mm`,
  '--paper-right': `${m.right}mm`,
  '--paper-bottom': `${m.bottom}mm`,
  '--paper-left': `${m.left}mm`,
})

// Was geladen ist (Adressen bzw. gerenderte Bilder), für einen Stand der Dateien (`key`); `failed` nennt, was fehlt.
export type LoadedDesign = { key: string; logo: string | null; paper: string | null; follow: string | null; failed: string[] }
export const designKey = (p: PrintDesign): string => [p.logo?.file, p.paper?.file, p.follow?.file].map((f) => f ?? '').join('|')

// Was gedruckt wird (Durchsicht M2): nur, was geladen ist. Fehlt das Briefpapier, druckt die Seite wie ohne, mit
// Seitenrand, Absender und Fußzeile von Mietfuchs, statt ein kaputtes Bild ohne Absender zu drucken; ein fehlendes
// Logo entfällt. `ready`: Ist alles versucht, darf gedruckt werden.
export type PrintedDesign = { logo: string | null; paper: string | null; follow: string | null; margins: LetterMargins | null; ready: boolean; failed: string[] }
export function printedDesign(planned: PrintDesign, loaded: LoadedDesign | null): PrintedDesign {
  if (!loaded || loaded.key !== designKey(planned)) {
    const nothing = !planned.logo && !planned.paper
    return { logo: null, paper: null, follow: null, margins: null, ready: nothing, failed: [] }
  }
  const paper = planned.paper ? loaded.paper : null
  return {
    logo: planned.logo ? loaded.logo : null,
    paper,
    follow: paper && planned.follow ? loaded.follow : null,
    margins: paper ? planned.margins : null,
    ready: true,
    failed: loaded.failed,
  }
}
