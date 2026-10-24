// Logo und Briefpapier (#415, Teil 2b): die Dateien im Ordner `briefpapier/` des Datenordners und das Speichern
// einer Gestaltung. Die Regeln (Arten, Namen, Ränder) stehen in shared/letterDesign.ts.
//
// **Ein Pfad entsteht nur aus einem Namen der eigenen Liste**: Ausgeliefert, gesichert und gelöscht wird nur, was die
// Datenbank nennt und die Gestalt `logo|paper-<16 Hex>.<Endung>` hat; der Name aus der Anfrage wird nur verglichen,
// nie in einen Pfad eingesetzt (CodeQL js/path-injection, wie `storedUpload` für Belege).
import fs from 'node:fs'
import path from 'node:path'
import type { LetterDesign, LetterDesignFile, LetterPaperNext } from '../../shared/types.ts'
import { LETTER_DESIGN_LIMITS, LIMIT_TEXT, designFileName, designFileType, isDesignFileName, parseMargins, sniffDesignFile, type DesignSlot } from '../../shared/letterDesign.ts'
import { moveToTrash } from './trash.ts'

export const DESIGN_DIR_NAME = 'briefpapier'
export const designDir = (dataDir: string): string => path.join(dataDir, DESIGN_DIR_NAME)

export class LetterDesignError extends Error {
  status = 400
}

type Change = 'keep' | 'remove' | 'new'
export type DesignFileField = 'logo' | 'paper' | 'paperNextFile'
const SLOT: Record<DesignFileField, DesignSlot> = { logo: 'logo', paper: 'paper', paperNextFile: 'paper' }
const LABEL: Record<DesignFileField, string> = { logo: 'Logo', paper: 'Briefpapier', paperNextFile: 'Briefpapier der Folgeseiten' }
const PAPER_NEXT: readonly LetterPaperNext[] = ['same', 'other', 'none']

export type DesignRequest = {
  own: boolean | undefined
  changes: Record<DesignFileField, Change>
  paperNext: LetterPaperNext
  margins: LetterDesign['margins']
}

// Der Rumpf: `design` als JSON (im Formular eine Zeichenkette), die Dateien daneben.
export function parseDesignRequest(raw: unknown, ownAllowed: boolean): DesignRequest {
  let body: unknown = raw
  if (typeof raw === 'string') {
    try {
      body = JSON.parse(raw)
    } catch {
      throw new LetterDesignError('Die Angaben zur Gestaltung sind unlesbar. Bitte laden Sie die Seite neu.')
    }
  }
  const b = (body !== null && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const change = (field: DesignFileField): Change => {
    const v = b[field] ?? 'keep'
    if (v === 'keep' || v === 'remove' || v === 'new') return v
    throw new LetterDesignError(`${LABEL[field]}: unbekannte Angabe.`)
  }
  if (!PAPER_NEXT.includes(b.paperNext as LetterPaperNext)) throw new LetterDesignError('Briefpapier der Folgeseiten: „dasselbe“, „ein zweites“ oder „keines“.')
  const margins = parseMargins(b.margins)
  if ('problems' in margins) throw new LetterDesignError(margins.problems.map((p) => p.message).join(' '))
  let own: boolean | undefined
  if (ownAllowed) {
    if (typeof b.own !== 'boolean') throw new LetterDesignError('Gestaltung: „wie in den Einstellungen“ oder „eigene für dieses Objekt“.')
    own = b.own
  }
  return { own, changes: { logo: change('logo'), paper: change('paper'), paperNextFile: change('paperNextFile') }, paperNext: b.paperNext as LetterPaperNext, margins: margins.margins }
}

export type IncomingFile = { buffer: Buffer, size: number }
export type PreparedFile = { field: DesignFileField, file: LetterDesignFile, data: Buffer }

// Prüft die hochgeladenen Dateien und gibt ihnen Namen; geschrieben wird noch nichts.
export function prepareDesignFiles(req: DesignRequest, files: Partial<Record<DesignFileField, IncomingFile>>, newId: () => string): PreparedFile[] {
  const out: PreparedFile[] = []
  for (const field of ['logo', 'paper', 'paperNextFile'] as const) {
    const incoming = files[field]
    const wanted = req.changes[field] === 'new' && (field !== 'paperNextFile' || req.paperNext === 'other')
    if (!wanted) continue
    if (!incoming) throw new LetterDesignError(`${LABEL[field]}: Bitte wählen Sie eine Datei.`)
    const slot = SLOT[field]
    if (incoming.size > LETTER_DESIGN_LIMITS[slot]) throw new LetterDesignError(`${LABEL[field]}: Die Datei ist größer als ${LIMIT_TEXT[slot]}.`)
    const type = sniffDesignFile(new Uint8Array(incoming.buffer), slot)
    if (type !== 'png' && type !== 'jpg' && type !== 'pdf') throw new LetterDesignError(`${LABEL[field]}: ${type}`)
    out.push({ field, file: { file: designFileName(slot, newId(), type), type }, data: incoming.buffer })
  }
  return out
}

// Die neue Gestaltung aus der bisherigen (`base`), den Angaben und den neuen Dateien.
export function nextDesign(base: LetterDesign, req: DesignRequest, prepared: PreparedFile[]): LetterDesign {
  const pick = (field: DesignFileField, current: LetterDesignFile | null): LetterDesignFile | null => {
    const fresh = prepared.find((p) => p.field === field)
    if (fresh) return fresh.file
    return req.changes[field] === 'remove' ? null : current
  }
  const paperNextFile = req.paperNext === 'other' ? pick('paperNextFile', base.paperNextFile) : null
  if (req.paperNext === 'other' && !paperNextFile) throw new LetterDesignError('Briefpapier der Folgeseiten: Für „ein zweites“ wählen Sie bitte eine Datei.')
  return { logo: pick('logo', base.logo), paper: pick('paper', base.paper), paperNext: req.paperNext, paperNextFile, margins: req.margins }
}

export function writeDesignFiles(dataDir: string, prepared: PreparedFile[]): void {
  if (prepared.length === 0) return
  fs.mkdirSync(designDir(dataDir), { recursive: true })
  for (const p of prepared) {
    if (!isDesignFileName(p.file.file)) throw new Error('unerwarteter Name')
    fs.writeFileSync(path.join(designDir(dataDir), p.file.file), p.data)
  }
}

// Entfernt die genannten Dateien, soweit keine Gestaltung sie mehr nennt. Ein Fehler beim Löschen ist kein
// Fehlschlag: Dann bleibt eine Datei liegen, die niemand mehr liest.
// Was keine Gestaltung mehr nennt, wandert in den Papierkorb (#318, Schritt 5): Ein Rücksprung im Verlauf, der die
// Gestaltung von vorher wiederherstellt, holt die Datei von dort zurück. `toTrash: false` nur für Dateien, die eben
// geschrieben wurden und nie eine Gestaltung genannt hat (gescheitertes Speichern).
export async function removeUnreferenced(dataDir: string, candidates: Iterable<string>, referenced: ReadonlySet<string>, toTrash = true): Promise<void> {
  for (const name of candidates) {
    if (referenced.has(name) || !isDesignFileName(name)) continue
    try {
      if (toTrash) await moveToTrash(dataDir, 'briefpapier', name)
      else fs.rmSync(path.join(designDir(dataDir), name), { force: true })
    } catch { /* bleibt liegen */ }
  }
}

// Der Pfad einer Datei für die Auslieferung: nur, wenn ihr Name in `referenced` steht; eingesetzt wird der Eintrag der
// Liste, nicht der Name aus der Anfrage.
export function designFilePath(dataDir: string, requested: string, referenced: ReadonlySet<string>): string | null {
  for (const name of referenced) {
    if (name === requested && isDesignFileName(name)) return path.join(designDir(dataDir), name)
  }
  return null
}

// Was eine Gestaltung nennt, im Ordner aber fehlt (Durchsicht M2: nach einer Vorversion, aus einem Archiv ohne die Datei
// oder von Hand gelöscht), steht als `null` darin; `missing` nennt es. Gedruckt wird dann ohne, statt mit einem kaputten
// Bild und ohne Absender.
export function presentDesign(dataDir: string, design: LetterDesign, missing: Set<string>): LetterDesign {
  const there = (f: LetterDesignFile | null, label: string): LetterDesignFile | null => {
    if (f === null) return null
    if (isDesignFileName(f.file) && fs.existsSync(path.join(designDir(dataDir), f.file))) return f
    missing.add(label)
    return null
  }
  const paperNextFile = there(design.paperNextFile, LABEL.paperNextFile)
  return { ...design, logo: there(design.logo, LABEL.logo), paper: there(design.paper, LABEL.paper), paperNextFile, paperNext: design.paperNext === 'other' && !paperNextFile ? 'none' : design.paperNext }
}

// Der Inhalt einer Datei aus einem Archiv, geprüft wie beim Hochladen (Durchsicht K1): Art nach dem Inhalt, und sie muss
// zur Endung des Namens passen. `null` heißt in Ordnung, sonst der Satz.
export function archivedDesignProblem(name: string, head: Uint8Array): string | null {
  const type = sniffDesignFile(head, name.startsWith('logo-') ? 'logo' : 'paper')
  return type === designFileType(name) ? null : `Die Datei „${name}“ im Archiv ist kein gültiges Logo oder Briefpapier und wird nicht übernommen.`
}

// Die Dateien im Ordner, für das Backup: nur Namen der eigenen Gestalt, nur Dateien.
export function designFilesOnDisk(dataDir: string): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(designDir(dataDir), { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter((e) => e.isFile() && isDesignFileName(e.name)).map((e) => e.name)
}
