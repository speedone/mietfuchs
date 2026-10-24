// Logo und eigenes Briefpapier für die Abrechnung (#415, Teil 2b). Eine Stelle für Server und Oberfläche: welche
// Dateien angenommen werden (am Inhalt erkannt), wie sie heißen, welche Ränder gehen und welche Gestaltung gilt.
//
// Die Gestaltung ist Druck, kein Inhalt: Sie friert mit dem Abschluss nicht ein, anders als die Texte des Anschreibens.
// Was beim Mieter liegt, unterscheidet sich dann nur im Aussehen, nie in einer Angabe.
import type { LetterDesign, LetterDesignFileType, LetterDesigns, LetterMargins } from './types.ts'

export type DesignSlot = 'logo' | 'paper'

// Höchstgrößen in Bytes. Ein Logo ist klein; ein Briefpapier als PDF oder Scan darf größer sein.
export const LETTER_DESIGN_LIMITS: Record<DesignSlot, number> = { logo: 2 * 1024 * 1024, paper: 10 * 1024 * 1024 }
export const LIMIT_TEXT: Record<DesignSlot, string> = { logo: '2 MB', paper: '10 MB' }

// Ränder des Textbereichs ab der Blattkante. Die Vorgaben folgen DIN 5008 (links 25 mm, rechts 20 mm); oben und unten
// lässt das Briefpapier Kopf und Fuß frei. Oben höchstens 70 mm (Durchsicht M1): Damals hielt ein Tabellenkopf den oberen
// Rand der Folgeseiten frei, den Chromium nur bis rund einem Viertel der Seitenhöhe wiederholt; heute tut das der
// Innenabstand eines Rahmens (`box-decoration-break: clone`, client/src/letter.css), die Grenze bleibt.
export const MARGIN_LIMITS: Record<keyof LetterMargins, { min: number; max: number; label: string }> = {
  top: { min: 10, max: 70, label: 'Rand oben' },
  right: { min: 10, max: 40, label: 'Rand rechts' },
  bottom: { min: 10, max: 60, label: 'Rand unten' },
  left: { min: 15, max: 40, label: 'Rand links' },
}
export const MARGIN_KEYS = ['top', 'right', 'bottom', 'left'] as const

export const DEFAULT_LETTER_DESIGN: LetterDesign = {
  logo: null,
  paper: null,
  paperNext: 'same',
  paperNextFile: null,
  margins: { top: 20, right: 20, bottom: 20, left: 25 },
}

const EXTENSIONS: Record<LetterDesignFileType, string> = { png: 'png', jpg: 'jpg', pdf: 'pdf' }
export const MIME_TYPES: Record<LetterDesignFileType, string> = { png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf' }

// Der Name, den der Server vergibt: Art, 16 Hexziffern (`newId`), Endung nach dem erkannten Inhalt. Nur Namen dieser
// Gestalt werden gelesen, geschrieben, ausgeliefert und aus einem Backup übernommen.
const NAME = /^(logo|paper)-[0-9a-f]{16}\.(png|jpg|pdf)$/
export const designFileName = (slot: DesignSlot, id: string, type: LetterDesignFileType): string => `${slot}-${id}.${EXTENSIONS[type]}`
export const isDesignFileName = (name: string): boolean => NAME.test(name)
export const designFileType = (name: string): LetterDesignFileType | null => {
  const m = NAME.exec(name)
  return m ? (m[2] as LetterDesignFileType) : null
}
export const designFileUrl = (name: string): string => `/api/letter-design/files/${encodeURIComponent(name)}`

const startsWith = (data: Uint8Array, sig: readonly number[]): boolean => sig.every((b, i) => data[i] === b)

// Die Art einer Datei aus ihren ersten Bytes, oder ein Satz, warum sie nicht geht. **SVG nimmt der Server nicht an**
// (Durchsicht S1): Ein SVG ist ein Dokument, das Skripte, Verweise und Animationen tragen kann, und eine Prüfung nach
// Mustern ließ sich umgehen. Die Oberfläche wandelt ein gewähltes SVG vor dem Hochladen in ein PNG um (`isSvgFile`),
// gespeichert und ausgeliefert werden nur PNG, JPG und PDF.
export function sniffDesignFile(data: Uint8Array, slot: DesignSlot): LetterDesignFileType | string {
  const wrong = slot === 'logo'
    ? 'Als Logo geht eine Bilddatei (PNG oder JPG; ein SVG wandelt Mietfuchs beim Auswählen um).'
    : 'Als Briefpapier geht eine Bilddatei (PNG, JPG oder eine PDF mit einer Seite; ein SVG wandelt Mietfuchs beim Auswählen um).'
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(data, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) return slot === 'paper' ? 'pdf' : wrong
  return wrong
}

// Ob eine gewählte Datei ein SVG ist: Text, der nach Bytereihenfolge, XML-Kopf, Kommentaren und Doctype mit <svg
// beginnt. Nur für die Oberfläche, die es dann umwandelt; ein Urteil über seinen Inhalt ist das nicht.
export function isSvgFile(data: Uint8Array): boolean {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(data.subarray(0, Math.min(data.length, 64 * 1024)))
  const head = text.replace(/^\ufeff/, '').replace(/^\s*(<\?xml[\s\S]*?\?>\s*)?((<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*/i, '')
  return /^<svg[\s>/]/i.test(head)
}

export type MarginProblem = { field: keyof LetterMargins; message: string; short: string }

export function marginProblems(margins: Record<keyof LetterMargins, unknown>): MarginProblem[] {
  const out: MarginProblem[] = []
  for (const key of MARGIN_KEYS) {
    const { min, max, label } = MARGIN_LIMITS[key]
    const v = margins[key]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      out.push({ field: key, message: `${label}: Geben Sie ganze Millimeter zwischen ${min} und ${max} mm ein.`, short: `zwischen ${min} und ${max} mm` })
    }
  }
  return out
}

export function parseMargins(input: unknown): { margins: LetterMargins } | { problems: MarginProblem[] } {
  const raw = (input !== null && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const candidate = { top: raw.top, right: raw.right, bottom: raw.bottom, left: raw.left }
  const problems = marginProblems(candidate)
  if (problems.length > 0) return { problems }
  return { margins: candidate as LetterMargins }
}

// Was gilt: die eigene Gestaltung des Objekts, sonst die der Installation.
export const effectiveLetterDesign = (designs: LetterDesigns): LetterDesign => designs.property ?? designs.installation

// Die Dateien, auf die eine Gestaltung verweist (ein zweites Briefpapier nur, wenn es für Folgeseiten gilt).
export function letterDesignFiles(design: LetterDesign): string[] {
  return [design.logo, design.paper, design.paperNext === 'other' ? design.paperNextFile : null]
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .map((f) => f.file)
}

// Das Briefpapier der Folgeseiten, wie es gedruckt wird.
export function followPaper(design: LetterDesign) {
  if (!design.paper) return null
  if (design.paperNext === 'same') return design.paper
  if (design.paperNext === 'other') return design.paperNextFile
  return null
}
