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
export const PAPER_PAGE_CSS = '@page { margin: 0; }'

// Kann der Browser den Innenabstand eines Blocks auf jeder Druckseite wiederholen? Chromium ab 130 und Firefox ja,
// WebKit nur mit Präfix und nur für Zeilen, nicht für Druckseiten (nachgemessen).
export const canPagePaper = (css: { supports: (property: string, value: string) => boolean } | undefined = globalThis.CSS): boolean =>
  typeof css?.supports === 'function' && css.supports('box-decoration-break', 'clone')

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
