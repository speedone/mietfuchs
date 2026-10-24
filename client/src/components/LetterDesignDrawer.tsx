// Logo und Briefpapier (#415, Teil 2b) im Seitenfenster: Vorgabe der Installation (Einstellungen) oder eigene
// Gestaltung je Objekt (Seite Abrechnung). Gewählte Dateien werden erst mit „Speichern“ hochgeladen; die Vorschau zeigt
// das Blatt mit dem Rahmen des Anschriftfelds nach DIN 5008 und dem Textbereich aus den Rändern.
import { useEffect, useState, type CSSProperties } from 'react'
import type { LetterDesign, LetterMargins } from '../../../shared/types.ts'
import { MARGIN_KEYS, MARGIN_LIMITS } from '../../../shared/letterDesign.ts'
import { api, errorText } from '../api'
import Drawer from './Drawer'
import Field from './Field'
import { useFormError } from './ErrorSummary'
import { useSaving } from '../useSaving'
import { openPdf, renderPage } from '../pdf'
import { designImage, pdfPageCount, svgToPng } from '../letterPaper'
import {
  FILE_LABEL, PAPER_NEXT_CHOICES, SLOT_OF, checkChosenFile, designDraftValue, designPayload, designProblems, initialDesignDraft, onePageProblem,
  type DesignDraft, type DesignField, type DesignFileField, type DesignPayload, type FileState,
} from '../letterDesignForm'

type Props = {
  open: boolean
  level: 'installation' | 'property'
  title: string
  stored: LetterDesign | null // was diese Ebene gespeichert hat (am Objekt `null`: keine eigene)
  installation: LetterDesign // die Vorgabe, mit der eine eigene Gestaltung beginnt
  onClose: () => void
  onSave: (payload: DesignPayload) => Promise<void>
}

// SVG darf gewählt werden; es wird vor dem Hochladen zu einem PNG (Durchsicht S1).
const ACCEPT = {
  logo: '.png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml',
  paper: '.png,.jpg,.jpeg,.svg,.pdf,image/png,image/jpeg,image/svg+xml,application/pdf',
}

const fileName = (s: FileState): string => (s === null ? '' : 'saved' in s ? `gespeichert (${s.saved.type.toUpperCase()})` : s.staged.name)

// Die Adresse für die Vorschau: gespeichert über den Server, neu gewählt aus dem Speicher des Browsers; eine PDF
// wird klein gerendert.
async function previewOf(state: FileState): Promise<string | null> {
  if (state === null) return null
  if ('saved' in state) return designImage(state.saved)
  if (state.staged.type !== 'pdf') return URL.createObjectURL(state.staged.blob)
  const { doc, close } = await openPdf({ data: await state.staged.blob.arrayBuffer() })
  try {
    return (await renderPage(doc, 1, { scale: 0.6 })).toDataURL('image/png')
  } finally {
    close()
  }
}

function usePreview(state: FileState): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let created: string | null = null
    previewOf(state).then((s) => {
      if (!alive) return
      if (s?.startsWith('blob:')) created = s
      setSrc(s)
    }).catch(() => { if (alive) setSrc(null) })
    return () => {
      alive = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [state])
  return src
}

// Ein A4-Blatt im Maßstab: Briefpapier, Logo, der Rahmen des Anschriftfelds (DIN 5008, bleibt frei) und der
// Textbereich aus den Rändern. Ränder, die (noch) keine Zahl sind, zeichnet sie mit der Vorgabe nicht.
export function PaperPreview({ paper, logo, margins }: { paper: string | null, logo: string | null, margins: Partial<LetterMargins> }) {
  const pct = (mm: number | undefined, of: number) => (typeof mm === 'number' && Number.isFinite(mm) ? `${(mm / of) * 100}%` : undefined)
  const vars = {
    '--preview-top': pct(margins.top, 297),
    '--preview-right': pct(margins.right, 210),
    '--preview-bottom': pct(margins.bottom, 297),
    '--preview-left': pct(margins.left, 210),
  } as CSSProperties
  const text = MARGIN_KEYS.every((k) => typeof margins[k] === 'number')
  return (
    <figure className="m-0">
      <div className="paper-preview" style={vars} role="img" aria-label="Vorschau der ersten Seite: Briefpapier, Anschriftfeld und Textbereich">
        {paper && <img className="paper-preview-sheet" src={paper} alt="" />}
        {logo && <img className="paper-preview-logo" src={logo} alt="" />}
        <div className="paper-preview-frame paper-preview-window" />
        {text && <div className="paper-preview-frame paper-preview-text" />}
      </div>
      <figcaption className="paper-preview-legend">
        <span><span className="paper-preview-key window" aria-hidden="true" />Anschriftfeld (bleibt frei)</span>
        {text && <span><span className="paper-preview-key" aria-hidden="true" />Textbereich</span>}
      </figcaption>
    </figure>
  )
}

export default function LetterDesignDrawer({ open, level, title, stored, installation, onClose, onSave }: Props) {
  const initial = () => initialDesignDraft(level === 'installation' ? stored ?? installation : stored, installation)
  const [draft, setDraft] = useState<DesignDraft>(initial)
  useEffect(() => { if (open) setDraft(initial()) }, [open])
  const errors = useFormError<DesignField>()
  const { busy, run } = useSaving()
  const own = level === 'installation' || draft.own
  const paperSrc = usePreview(own ? draft.paper : null)
  const logoSrc = usePreview(own ? draft.logo : null)

  async function choose(field: DesignFileField, file: File | undefined) {
    errors.clearField(field)
    if (!file) return
    const head = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer())
    let checked = checkChosenFile(field, head, file.size)
    let blob: Blob = file
    let name = file.name
    // Ein SVG wird hier zu einem PNG (Durchsicht S1); hinaus geht nur das Bild.
    if ('convert' in checked) {
      try {
        blob = await svgToPng(file, SLOT_OF[field])
        name = `${file.name.replace(/\.svgz?$/i, '')}.png`
        checked = checkChosenFile(field, new Uint8Array(await blob.slice(0, 64).arrayBuffer()), blob.size)
      } catch {
        checked = { error: 'Das SVG ließ sich nicht in ein Bild umwandeln. Speichern Sie es bitte als PNG.' }
      }
      if ('convert' in checked) checked = { error: 'Das SVG ließ sich nicht in ein Bild umwandeln. Speichern Sie es bitte als PNG.' }
    }
    if ('error' in checked) {
      errors.report([{ field, text: `${FILE_LABEL[field]}: ${checked.error}`, short: checked.error }])
      return
    }
    if (checked.type === 'pdf') {
      let problem: string | null
      try {
        problem = onePageProblem(await pdfPageCount(await file.arrayBuffer()))
      } catch {
        problem = 'Die PDF ließ sich nicht lesen.'
      }
      if (problem) {
        errors.report([{ field, text: `${FILE_LABEL[field]}: ${problem}`, short: problem }])
        return
      }
    }
    const type = checked.type
    setDraft((d) => ({ ...d, [field]: { staged: { name, size: blob.size, lastModified: file.lastModified, type, blob } } }))
  }

  function save() {
    void run(async () => {
      const problems = designProblems(draft)
      if (problems.length > 0) {
        errors.report(problems)
        return
      }
      try {
        await onSave(designPayload(draft, level))
      } catch (e) {
        errors.set(`Nicht gespeichert: ${errorText(e)}`)
      }
    })
  }

  const fileField = (field: DesignFileField, label: string, hint: string) => (
    <div className="stack tight">
      <Field label={label} hint={hint} {...errors.field(field)}>
        <input type="file" aria-label={label} accept={field === 'logo' ? ACCEPT.logo : ACCEPT.paper} onChange={(e) => { void choose(field, e.target.files?.[0]); e.target.value = '' }} />
      </Field>
      {draft[field] && (
        <div className="row">
          <span className="muted text-s">{fileName(draft[field])}</span>
          <button type="button" className="btn small ghost" onClick={() => setDraft((d) => ({ ...d, [field]: null }))}>{`${FILE_LABEL[field]} entfernen`}</button>
        </div>
      )}
    </div>
  )

  const margins = Object.fromEntries(MARGIN_KEYS.map((k) => [k, /^\d+$/.test(draft.margins[k]) ? Number(draft.margins[k]) : undefined])) as Partial<LetterMargins>
  return (
    <Drawer
      open={open}
      title={title}
      width={640}
      onClose={onClose}
      onSubmit={save}
      value={designDraftValue(draft)}
      busy={busy}
      errors={errors}
      actions={<button className="btn" onClick={save} disabled={busy}>Speichern</button>}
    >
      <p className="muted">
        Logo und Briefpapier gelten für den Druck jeder Abrechnung{level === 'installation' ? ' aller Objekte, solange ein Objekt keine eigene Gestaltung hat' : ' dieses Objekts'}.
        Sie ändern nur das Aussehen: Was mit dem Abschluss einfriert, sind Zahlen und Texte, nicht die Gestaltung.
      </p>
      {level === 'property' && (
        <Field label="Gestaltung" width="m">
          <select value={draft.own ? 'own' : 'inherit'} onChange={(e) => setDraft((d) => ({ ...d, own: e.target.value === 'own' }))}>
            <option value="inherit">Wie in den Einstellungen</option>
            <option value="own">Eigene für dieses Objekt</option>
          </select>
        </Field>
      )}
      {own && (
        <>
          {fileField('logo', 'Logo', 'PNG, JPG oder SVG (wird in ein Bild umgewandelt), höchstens 2 MB; steht oben rechts im Briefkopf.')}
          {fileField('paper', 'Briefpapier der ersten Seite', 'Bild (PNG, JPG, SVG wird umgewandelt) oder eine PDF mit einer Seite, höchstens 10 MB; liegt unter der ganzen Seite.')}
          {draft.paper && (
            <>
              <Field label="Briefpapier der Folgeseiten" width="m">
                <select value={draft.paperNext} onChange={(e) => setDraft((d) => ({ ...d, paperNext: PAPER_NEXT_CHOICES.find((c) => c.id === e.target.value)?.id ?? 'same' }))}>
                  {PAPER_NEXT_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </Field>
              {draft.paperNext === 'other' && fileField('paperNextFile', 'Zweites Briefpapier', 'Für alle Seiten nach der ersten.')}
              <fieldset className="no-connection">
                <legend className="field-legend">Ränder des Textbereichs (mm ab der Blattkante)</legend>
                <p className="muted text-s m-0">So bleiben Kopf und Fuß des Briefpapiers frei. Anschriftfeld und Datum stehen immer an ihrem Platz nach DIN 5008.</p>
                <div className="field-grid">
                  {MARGIN_KEYS.map((k) => (
                    <Field key={k} label={MARGIN_LIMITS[k].label} hint={`${MARGIN_LIMITS[k].min} bis ${MARGIN_LIMITS[k].max} mm`} width="s" {...errors.field(k)}>
                      <input inputMode="numeric" value={draft.margins[k]} onChange={(e) => setDraft((d) => ({ ...d, margins: { ...d.margins, [k]: e.target.value } }))} />
                    </Field>
                  ))}
                </div>
              </fieldset>
              <p className="muted text-s">
                Mit Briefpapier entfallen der Absender oben und die Fußzeile von Mietfuchs; die Rücksendeangabe im Anschriftfeld
                bleibt. Gedruckt wird ohne Seitenrand, damit das Briefpapier bis an die Blattkante reicht: Wählen Sie im
                Druckdialog die Skalierung 100 %. Was sehr nah am Blattrand liegt, druckt nicht jeder Drucker; „Als PDF
                speichern“ enthält alles. Ohne Seitenrand entfällt die Seitenzahl unten rechts; jede Seite der Aufstellung
                nennt weiter Abrechnung, Objekt und Wohnung. Ein Browser, der die Ränder nicht je Druckseite unterscheiden
                kann (etwa Safari), druckt ohne Briefpapier.
              </p>
            </>
          )}
          <PaperPreview paper={paperSrc} logo={logoSrc} margins={draft.paper ? margins : {}} />
        </>
      )}
    </Drawer>
  )
}

// Für die Karte in den Einstellungen und die Seite Abrechnung: eine kurze Beschreibung der Gestaltung.
export function designSummary(d: LetterDesign | null): string {
  if (!d) return 'Es gilt die Gestaltung aus den Einstellungen.'
  const parts: string[] = []
  parts.push(d.logo ? 'mit Logo' : 'ohne Logo')
  if (!d.paper) parts.push('ohne Briefpapier')
  else parts.push(d.paperNext === 'same' ? 'Briefpapier auf allen Seiten' : d.paperNext === 'other' ? 'Briefpapier, auf Folgeseiten ein zweites' : 'Briefpapier nur auf der ersten Seite')
  return `${parts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase())
}

// Gesendet als Formular: die Angaben als JSON im Feld `design`, die neuen Dateien daneben.
export async function sendLetterDesign(url: string, payload: DesignPayload): Promise<void> {
  const fd = new FormData()
  fd.append('design', JSON.stringify(payload.design))
  for (const [field, file] of Object.entries(payload.files)) fd.append(field, file.blob, file.name)
  await api(url, { method: 'PUT', body: fd })
}
