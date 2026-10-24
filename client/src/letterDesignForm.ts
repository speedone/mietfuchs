// Das Seitenfenster „Logo und Briefpapier“ (#415, Teil 2b), ohne DOM: Entwurf, Prüfung und was gesendet wird.
// Eine gewählte Datei wird erst mit „Speichern“ hochgeladen (#309: nichts speichert beim Anklicken); bis dahin steht
// sie im Entwurf. Gesendet wird je Datei „behalten“, „entfernen“ oder „neu“, dazu die neuen Dateien.
import type { LetterDesign, LetterDesignFile, LetterDesignFileType, LetterMargins, LetterPaperNext } from '../../shared/types.ts'
import { DEFAULT_LETTER_DESIGN, LETTER_DESIGN_LIMITS, LIMIT_TEXT, MARGIN_KEYS, isSvgFile, marginProblems, sniffDesignFile, type DesignSlot } from '../../shared/letterDesign.ts'
import type { Problem } from './formProblems'

// Eine neu gewählte Datei: das Original zum Hochladen und, was die Prüfung darüber weiß.
export type StagedFile = { name: string; size: number; lastModified: number; type: LetterDesignFileType; blob: Blob }
export type FileState = { saved: LetterDesignFile } | { staged: StagedFile } | null

export type DesignFileField = 'logo' | 'paper' | 'paperNextFile'
export type DesignField = DesignFileField | keyof LetterMargins

export type DesignDraft = {
  own: boolean // nur am Objekt: eigene Gestaltung statt der Vorgabe
  logo: FileState
  paper: FileState
  paperNext: LetterPaperNext
  paperNextFile: FileState
  margins: Record<keyof LetterMargins, string>
}

export const PAPER_NEXT_CHOICES: { id: LetterPaperNext; label: string }[] = [
  { id: 'same', label: 'Dasselbe Briefpapier' },
  { id: 'other', label: 'Ein zweites Briefpapier' },
  { id: 'none', label: 'Kein Briefpapier' },
]

export const SLOT_OF: Record<DesignFileField, DesignSlot> = { logo: 'logo', paper: 'paper', paperNextFile: 'paper' }
export const FILE_LABEL: Record<DesignFileField, string> = { logo: 'Logo', paper: 'Briefpapier', paperNextFile: 'Briefpapier der Folgeseiten' }

const saved = (f: LetterDesignFile | null): FileState => (f ? { saved: f } : null)

// Der Entwurf aus dem, was gespeichert ist. Am Objekt ohne eigene Gestaltung beginnt sie mit der der Installation.
export function initialDesignDraft(stored: LetterDesign | null, fallback: LetterDesign = DEFAULT_LETTER_DESIGN): DesignDraft {
  const d = stored ?? fallback
  return {
    own: stored !== null,
    logo: saved(d.logo),
    paper: saved(d.paper),
    paperNext: d.paperNext,
    paperNextFile: saved(d.paperNext === 'other' ? d.paperNextFile : null),
    margins: { top: String(d.margins.top), right: String(d.margins.right), bottom: String(d.margins.bottom), left: String(d.margins.left) },
  }
}

// Der Stand für den Vergleich des Seitenfensters („Änderungen verwerfen?“): eine Datei zählt mit Name, Größe und Zeit.
export function designDraftValue(d: DesignDraft): unknown {
  const v = (f: FileState) => (f === null ? null : 'saved' in f ? f.saved.file : `${f.staged.name}:${f.staged.size}:${f.staged.lastModified}`)
  return { ...d, logo: v(d.logo), paper: v(d.paper), paperNextFile: v(d.paperNextFile) }
}

// Prüft eine gewählte Datei, bevor sie in den Entwurf kommt: Art am Inhalt, Größe. Eine PDF prüft die Seite danach
// auf ihre Seitenzahl (pdf.js), denn als Briefpapier geht nur eine Seite. Ein SVG geht nicht hinaus (Durchsicht S1): Die
// Seite wandelt es in ein PNG um (`svgToPng`), der Server nimmt nur PNG, JPG und PDF an.
export function checkChosenFile(field: DesignFileField, head: Uint8Array, size: number): { type: LetterDesignFileType } | { convert: 'svg' } | { error: string } {
  const slot = SLOT_OF[field]
  if (isSvgFile(head)) return { convert: 'svg' }
  if (size > LETTER_DESIGN_LIMITS[slot]) return { error: `Die Datei ist größer als ${LIMIT_TEXT[slot]}.` }
  const type = sniffDesignFile(head, slot)
  if (type === 'png' || type === 'jpg' || type === 'pdf') return { type }
  return { error: type }
}

// Die Größe des Bildes, in das ein SVG gezeichnet wird: Briefpapier als ganzes A4-Blatt mit 300 dpi, ein Logo in der
// größten Fläche, die es im Briefkopf einnimmt (65 × 25 mm), ebenfalls mit 300 dpi; das Seitenverhältnis des Logos bleibt.
export const SVG_PIXELS: Record<DesignSlot, { width: number; height: number }> = {
  paper: { width: 2480, height: 3508 },
  logo: { width: 768, height: 295 },
}
export function svgCanvasSize(slot: DesignSlot, naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  const box = SVG_PIXELS[slot]
  if (slot === 'paper' || !(naturalWidth > 0 && naturalHeight > 0)) return { ...box }
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight)
  return { width: Math.max(1, Math.round(naturalWidth * scale)), height: Math.max(1, Math.round(naturalHeight * scale)) }
}

export const onePageProblem = (pages: number): string | null => (pages === 1 ? null : `Die PDF hat ${pages} Seiten; als Briefpapier geht nur eine. Speichern Sie die eine Seite einzeln als PDF.`)

const toNumber = (s: string): number => (/^\s*\d+\s*$/.test(s) ? Number(s) : Number.NaN)

export function designProblems(d: DesignDraft): Problem<DesignField>[] {
  if (!d.own) return []
  const out: Problem<DesignField>[] = []
  if (d.paper && d.paperNext === 'other' && !d.paperNextFile) {
    out.push({ field: 'paperNextFile', text: 'Briefpapier der Folgeseiten: Wählen Sie eine Datei oder „Dasselbe Briefpapier“.', short: 'Datei fehlt' })
  }
  // Die Ränder gelten nur mit Briefpapier; ohne werden sie nicht geprüft (Durchsicht K3), gesendet wird dann ein gültiger
  // Stand (`designPayload`).
  if (!d.paper) return out
  const margins = Object.fromEntries(MARGIN_KEYS.map((k) => [k, toNumber(d.margins[k])])) as Record<keyof LetterMargins, number>
  for (const p of marginProblems(margins)) out.push({ field: p.field, text: p.message, short: p.short })
  return out
}

// Die Ränder, wie sie gesendet werden: mit Briefpapier die eingegebenen (geprüft in `designProblems`), ohne die
// eingegebenen, wenn sie gelten, sonst die Vorgabe; sie wirken ohne Briefpapier ohnehin nicht.
function sentMargins(d: DesignDraft): LetterMargins {
  const m = Object.fromEntries(MARGIN_KEYS.map((k) => [k, toNumber(d.margins[k])])) as LetterMargins
  return d.paper || marginProblems(m).length === 0 ? m : DEFAULT_LETTER_DESIGN.margins
}

export type DesignPayload = { design: Record<string, unknown>; files: Partial<Record<DesignFileField, StagedFile>> }

// Was gesendet wird. `stored` ist das, was diese Ebene heute gespeichert hat (am Objekt ohne eigene: die Vorgabe, mit
// der die eigene beginnt); eine Datei, die dort steht und im Entwurf fehlt, wird entfernt.
export function designPayload(d: DesignDraft, level: 'installation' | 'property'): DesignPayload {
  const files: Partial<Record<DesignFileField, StagedFile>> = {}
  const change = (field: DesignFileField, state: FileState): 'keep' | 'remove' | 'new' => {
    if (state === null) return 'remove'
    if ('staged' in state) {
      files[field] = state.staged
      return 'new'
    }
    return 'keep'
  }
  const paperNext: LetterPaperNext = d.paper ? d.paperNext : 'same'
  const design: Record<string, unknown> = {
    logo: change('logo', d.logo),
    paper: change('paper', d.paper),
    paperNextFile: paperNext === 'other' ? change('paperNextFile', d.paperNextFile) : 'remove',
    paperNext,
    margins: sentMargins(d),
  }
  if (level === 'property') design.own = d.own
  // Zurück zur Vorgabe: Was im Entwurf sonst steht, zählt nicht.
  if (level === 'property' && !d.own) return { design: { own: false, logo: 'keep', paper: 'keep', paperNextFile: 'keep', paperNext: 'same', margins: DEFAULT_LETTER_DESIGN.margins }, files: {} }
  return { design, files }
}
