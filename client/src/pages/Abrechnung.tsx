import { Fragment, useCallback, useEffect, useMemo, useId, useRef, useState } from 'react'
import { startPrint } from '../printJob'
import type { CostItem, HeatingSettlementInfo, LetterTemplates, Notice, NoticeSubject, PeriodKey, Settings, Settlement, SettlementRow, Statement, Tenancy, TenancyLetter, Unit } from '../types'
import {
  heatingChoices, heatingOnlyNote, heatingOverridesWith, prepaymentLabel, prepaymentSplit, recommendedDeadlineText, settlementPaths, settlementTitle, totalLabel,
} from '../heatingSettlementView'
import { api, errorText, fmtDate, fmtEuro, parseEuro } from '../api'
import { invoiceLabel, renderInvoicePages } from '../pdfPreview'
import { usePeriod } from '../period'
import { useFocusTarget } from '../focus'
import { settledInvoiceFiles, type PlantPeriods } from '../costPeriods'
import { useOpenForm, useProperty, withProperty } from '../property'
import { keepDraft, useConfirmDiscard, useDraft } from '../useDraft'
import { useSaving } from '../useSaving'
import DraftActions from '../components/DraftActions'
import { FieldMessage } from '../components/Field'
import { effectiveLandlord, footerLine, formerRecipientLines, letterhead, addressCheck, addressFieldWarning, addressNotice, recipientLines, returnLine } from '../landlord'
import { localToday } from '../periodForm'
import { landlordReasonText } from '../landlordReasons'
import { deviationView } from '../deviation'
import { deadlineView, historyView, type HistoryEntry } from '../settlementHistory'
import { costBasisText, personsText } from '../statementView'
import { legalBasisLines, noticesOf, noticeTarget, type NoticeTab } from '../notices'
import { CalcNotice, NoticeBox, NoticeGroup } from '../components/Notice'
import PrintDrawer, { type PrintScope } from '../components/PrintDrawer'
import { checkList, hintSummary, neighbors, resultText, tenantRows } from '../settlementOverview'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { emptySettlement, startStep } from '../emptyStock'
import { closeSettlementTitle } from '../propertyView'
import Term from '../components/Term'
import CalcSteps from '../components/CalcSteps'
import { totalColumnLabel, totalNote } from '../calcSteps'
import { useToast, useConfirm } from '../components/feedback'
import Table from '../components/Table'
import Co2Block from '../components/Co2Block'
import SelfHeatingBlock from '../components/SelfHeatingBlock'
import HeatingInfoBlock from '../components/HeatingInfoBlock'
import StockBlock from '../components/StockBlock'
import { showsStock, stockBlock } from '../stockView'
import FuelBlock from '../components/FuelBlock'
import { fuelBlock } from '../fuelView'
import { closeWithQuestions } from '../fuelClose'
import { closeErrorsQuestion, closeMessage, completenessQuestion, DRAFT_MARK, exportQuestion, printQuestion, sameErrors, showsDraftMark, type ErrorsQuestion } from '../despiteErrors'
import { co2Block } from '../co2View'
import { calendarPeriod } from '../../../shared/period.ts'
import { adjustFromFor, mergeLetterTexts, printsLetter, renderLetterText, statementBlocks } from '../../../shared/letter.ts'
import Card from '../components/Card'
import ControlView from '../components/ControlView'
import Letter, { PrintPages, StatementHead } from '../components/Letter'
import LetterDesignDrawer, { designSummary, sendLetterDesign } from '../components/LetterDesignDrawer'
import { PAPER_PAGE_CSS, asLetterDesigns, canPagePaper, designKey, paperVars, printDesign, printedDesign, type LoadedDesign } from '../letterDesignView'
import { designImage } from '../letterPaper'
import type { LetterDesigns } from '../../../shared/types.ts'
import { LegacyHead, legacyHeadLine, legacyReceiptsText, LegacyResult } from '../components/LegacyStatement'
import { exceedsOnePage } from '../../../shared/letter.ts'
import { suggestionWithoutHeating } from '../heatingSettlementView'
import LetterDrawer, { type LetterSave } from '../components/LetterDrawer'
import PrepaymentStepsCard from '../components/PrepaymentStepsCard'
import { sentMonthLines } from '../prepaymentSteps'
import { asTemplates, footnoteText, infoRows, labor35aTable, letterOf, letterParagraphs, RETURN_LINE_MAX, resultRows, returnLineTooLong, statementHeadRows } from '../letterView'

type Props = {
  settings: Settings | null
  units: Unit[]
  tenancies: Tenancy[]
  reload: () => Promise<void>
  // Für „Hier beheben →“ an einem Hinweis (#112), mit dem betroffenen Eintrag (#142)
  onNavigate?: (tab: NoticeTab, focus?: NoticeSubject) => void
  // Sichtprüfung E45: aus dem Cockpit eine Heizkostenabrechnung („Anlage|Heizperiode“) vorwählen.
  focus?: NoticeSubject | null
  onFocusDone?: () => void
}

// Der Satz neben einem geänderten Druck-Häkchen (Durchsicht zu #309, KANN 9).
export const PRINT_DRAFT_NOTE = 'Gilt schon für diese Vorschau und den Druck; mit „Speichern“ für künftige Abrechnungen gemerkt.'
// Teil 2 von #415: „Anschreiben mitdrucken“ gilt hier nur für diesen Druck.
export const LETTER_CHOICE_NOTE = 'Anschreiben: gilt nur für diesen Druck. Die Vorgabe ändern Sie mit „Vorlage für dieses Objekt bearbeiten“ oder in den Einstellungen.'

// Warnungen der Seite vor dem Druck (#415), am Brief des Mieters und in „Zu prüfen“ mit demselben Wortlaut.
// Druck in Safari (#286): WebKit nimmt die Ränder der ersten Seite für alle Seiten (letterDesignView.ts, `canPagePaper`).
const PAPER_BROWSER_TEXT = 'Dieser Browser (etwa Safari) kann die Ränder nicht je Druckseite unterscheiden; mit Briefpapier stünde der Text der Folgeseiten im Kopf oder Fuß des Papiers. Gedruckt wird deshalb ohne Briefpapier, mit Absender und Fußzeile von Mietfuchs. Mit Briefpapier drucken Sie in Chrome, Edge oder Firefox.'
const LETTER_LONG_TEXT = 'Das Anschreiben ist voraussichtlich länger als eine Seite und druckt auf der nächsten weiter. Soll es auf eine Seite passen, kürzen Sie die Texte über „Anschreiben bearbeiten“.'
const returnLineText = (line: string) => `Die Rücksendeangabe über der Anschrift hat ${line.trim().length} Zeichen; im Fensterfeld passen rund ${RETURN_LINE_MAX} in zwei kleine Zeilen, der Rest würde abgeschnitten. Kürzen Sie den Namen oder die Anschrift des Vermieters (Einstellungen bzw. beim Objekt).`

export default function Abrechnung({ settings, units, tenancies, reload, onNavigate, focus, onFocusDone }: Props) {
  const { key, label, param, calendar, period, rules } = usePeriod()
  const { properties, property } = useProperty()
  const propertyId = property?.id
  // Vermieter, IBAN und Frist: am Objekt abweichend, sonst aus den Einstellungen (#92).
  const landlord = settings ? effectiveLandlord(property, settings) : null
  const toast = useToast()
  const confirm = useConfirm()
  const [data, setData] = useState<Settlement | null>(null)
  const [error, setError] = useState('')
  const [printId, setPrintId] = useState<string | null>(null)
  // Druck aller Mieter (Fenster „Drucken“, „Alle Mieter“), ohne Seitenzahl im Rand (#415, Teil 2).
  const [printingAll, setPrintingAll] = useState(false)
  // Die Vorschau eines Mieters über die ganze Breite (Kennung des Mietverhältnisses), sonst die Übersicht.
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [showSteps, setShowSteps] = useState(false)
  const previewHeading = useRef<HTMLHeadingElement>(null)
  const previewIds = useId()
  // Wohin der Fokus nach „Zurück zur Übersicht“ geht: der „Ansehen“-Knopf des zuletzt gezeigten Mieters.
  const returnTo = useRef<string | null>(null)
  // „Mehr“ in der Kopfzeile: Anschreiben und Briefpapier des Objekts, Export.
  const [moreOpen, setMoreOpen] = useState(false)
  const moreId = useId()
  const checksId = useId()
  // Das Fenster „Drucken“ und der Stand der Häkchen beim Öffnen, den „Abbrechen“ wiederherstellt.
  const [printDrawer, setPrintDrawer] = useState<{ scope: PrintScope } | null>(null)
  const printBefore = useRef<{ letterChoice: boolean | null, settings: { printFoldMarks: boolean, printAttachments: boolean, printFooter: boolean }, dirty: boolean } | null>(null)
  // `error` ist die Meldung am Feld (UI-Durchsicht H4): Eine ungültige Eingabe wurde vorher stumm verworfen.
  const [ppEdit, setPpEdit] = useState<{ tenancyId: string; value: string; error?: string } | null>(null)
  const ppErrorId = useId()
  // Die Korrektur der gezahlten Vorauszahlung hängt an einem Mietverhältnis dieses Objekts (#145).
  useOpenForm(ppEdit !== null)
  const [costItems, setCostItems] = useState<CostItem[]>([])
  // Für die Belegkopien einer Position über 0 €: zu welcher Abrechnung sie gehört (Durchsicht N3).
  const [plants, setPlants] = useState<PlantPeriods[]>([])
  useEffect(() => {
    api<PlantPeriods[]>(withProperty('/api/heating-plants', property?.id)).then(setPlants).catch(() => setPlants([]))
  }, [property?.id])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [attachmentPages, setAttachmentPages] = useState<Record<string, string[]>>({})
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  // Heizung PR 5: die Heizkostenabrechnungen nach Weg d, deren Heizperiode in diesem Zeitraum endet.
  // Gewählt ist entweder die Betriebskostenabrechnung (`null`) oder eine von ihnen.
  const [heatingList, setHeatingList] = useState<HeatingSettlementInfo[]>([])
  const [target, setTarget] = useState<{ plantId: string; period: PeriodKey } | null>(null)
  const paths = settlementPaths(param, target)
  const choices = heatingChoices(heatingList, period)
  // Ein anderer Zeitraum oder ein anderes Objekt: wieder die Betriebskostenabrechnung.
  useEffect(() => { setTarget(null); setPreviewId(null) }, [param, propertyId])
  // Das Ziel aus dem Cockpit, sobald die Liste da ist und es darin steht (E45).
  useFocusTarget(focus, 'heatingSettlement', heatingList, (h) => `${h.plantId}|${h.period.key}`, (h) => setTarget({ plantId: h.plantId, period: h.period.key }), onFocusDone)

  // Export der Abrechnung als Daten (#415, Teil 3): Der Server baut die Datei, hier wird sie nur gespeichert.
  async function exportData(format: 'json' | 'csv') {
    const q = data ? exportQuestion(noticesOf(data), !!data.closed) : null
    if (q && !(await askDespiteErrors(q))) return
    try {
      const res = await fetch(withProperty(`${paths.load}/export?format=${format}`, propertyId))
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Der Export ist fehlgeschlagen (${res.status}).`)
      const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1]
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = name ? decodeURIComponent(name) : `abrechnung.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  // Die beiden Häkchen zum Druck sind Einstellungen und deshalb ein Entwurf mit einem „Speichern“ für
  // beide (#309). Die Seite zeigt den Entwurf schon an, Vorschau und Druck folgen dem Häkchen; gemerkt
  // für das nächste Öffnen wird er erst mit „Speichern“. Den Vorschlag zur Vorauszahlung wählt seit #415
  // das Anschreiben je Mieter (Vorgabe in den Einstellungen); hier stehen Belegkopien und Falzmarken.
  const printDraft = useDraft({
    printFoldMarks: settings?.printFoldMarks === true, // Standard: aus
    printAttachments: settings?.printAttachments === true, // Standard: aus
    printFooter: settings?.printFooter === true, // Teil 2: Fußzeile mit Kontakt und Bank, Standard: aus
  })
  const printFoldMarks = printDraft.value.printFoldMarks
  const printAttachments = printDraft.value.printAttachments
  const printFooter = printDraft.value.printFooter
  // Das Anschreiben (#415): die Vorlagen der Ebenen und die Anpassungen je Mieter, zum Bearbeiten. Was
  // gedruckt wird, liefert der Server mit der Abrechnung (`letters`).
  const [templates, setTemplates] = useState<LetterTemplates | null>(null)
  const [tenancyLetters, setTenancyLetters] = useState<Record<string, TenancyLetter>>({})
  const [letterEdit, setLetterEdit] = useState<{ kind: 'property' } | { kind: 'tenancy', tenancyId: string } | null>(null)
  // Teil 2b: Logo und Briefpapier (Vorgabe der Einstellungen, je Objekt eine eigene). Nur Druck, friert nicht ein.
  const [designs, setDesigns] = useState<LetterDesigns | null>(null)
  const [designEdit, setDesignEdit] = useState(false)
  const [loadedDesign, setLoadedDesign] = useState<LoadedDesign | null>(null)
  // Teil 2: Anschreiben mitdrucken. Die Vorgabe steht am Objekt bzw. in den Einstellungen (geladen mit den Vorlagen);
  // hier lässt sie sich für diesen Druck umschalten, gespeichert wird dabei nichts. `null` heißt „die Vorgabe gilt“.
  const letterDefault = printsLetter(templates ? { printLetter: templates.propertyPrintLetter ?? null } : null, { printLetter: templates?.printLetter })
  const [letterChoice, setLetterChoice] = useState<boolean | null>(null)
  useEffect(() => { setLetterChoice(null) }, [param, propertyId])
  const withLetter = letterChoice ?? letterDefault
  async function savePrint(value: typeof printDraft.value) {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(value) })
    await reload()
  }
  async function saveLetter(save: LetterSave) {
    if (!letterEdit) return
    if (letterEdit.kind === 'property') {
      if (!propertyId) return
      await api(`/api/properties/${propertyId}/letter-texts`, { method: 'PUT', body: JSON.stringify({ texts: save.texts, ...(save.printLetter !== undefined ? { printLetter: save.printLetter } : {}) }) })
    } else {
      await api(withProperty(`${paths.load}/letters/${letterEdit.tenancyId}`, propertyId), {
        method: 'PUT',
        body: JSON.stringify({ texts: save.texts, ...(save.adjust !== undefined ? { adjustment: save.adjust } : {}) }),
      })
    }
    setLetterEdit(null)
    await load()
    toast('Anschreiben gespeichert.')
  }

  const load = useCallback(() => {
    return Promise.all([
      api<Settlement>(withProperty(paths.load, propertyId)),
      api<CostItem[]>(withProperty('/api/costItems', propertyId)),
      // Frühere Abschlüsse (#56). Fehlt die Route (älterer Server), bleibt die Liste leer.
      // Nur ein älterer Server ohne die Route (404) heißt „keine“; jeder andere Fehler wird gezeigt.
      api<HistoryEntry[]>(withProperty(paths.history, propertyId)).catch((e: unknown) => {
        if (/\b404\b/.test(String((e as Error).message))) return []
        throw e
      }),
    ])
      .then(([d, c, h]) => { setData(d); setCostItems(c); setHistory(h); setError('') })
      .catch((e) => setError(String((e as Error).message)))
      .then(() => Promise.all([
        api<unknown>(withProperty('/api/letter-texts', propertyId)).then((t) => setTemplates(asTemplates(t))).catch(() => setTemplates(null)),
        api<Record<string, TenancyLetter>>(withProperty(`${paths.load}/letters`, propertyId)).then(setTenancyLetters).catch(() => setTenancyLetters({})),
        // Ein älterer Server ohne die Route: ohne Logo und Briefpapier.
        api<unknown>(withProperty('/api/letter-design', propertyId)).then((d) => setDesigns(asLetterDesigns(d))).catch(() => setDesigns(null)),
      ]))
      .then(() => api<HeatingSettlementInfo[]>(withProperty('/api/heating-settlements', propertyId)).then(setHeatingList).catch(() => setHeatingList([])))
  }, [paths.load, paths.history, propertyId])

  useEffect(() => { void load() }, [load])

  // Ein Speichern, das der Server ablehnt (#146), meldet sich oben auf der Seite, statt nur in
  // der Konsole zu stehen. Ergibt true, wenn es geklappt hat.
  async function attempt(request: () => Promise<unknown>): Promise<boolean> {
    try {
      await request()
      setError('')
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    }
  }

  // Beleg-Dateien der gezeigten Abrechnung (in Erfassungsreihenfolge, ohne Duplikate), auch die der
  // Heizperiode, die darin abgerechnet wird
  const invoiceFiles = useMemo(() => (data ? settledInvoiceFiles(data, costItems, rules, plants) : []), [data, costItems, rules, plants])

  // Sprechende Anlagen-Beschriftung aus den verknüpften Kostenpositionen
  // (Rechnungssteller + Kostenarten) statt des technischen Dateinamens.
  function fileLabel(f: string): string {
    const linked = costItems.filter((c) => c.invoiceFile === f && invoiceFiles.includes(f))
    const vendor = linked.find((c) => c.vendor)?.vendor
    const cats = [...new Set(linked.map((c) => c.category))].join(', ')
    if (vendor && cats) return `${vendor} — ${cats}`
    return vendor || cats || invoiceLabel(f)
  }

  // Belegseiten vorab rendern, sobald der Andruck aktiviert ist — der Druckdialog
  // wartet nicht auf asynchrones Rendering.
  useEffect(() => {
    if (!printAttachments) return
    const missing = invoiceFiles.filter((f) => !attachmentPages[f])
    if (missing.length === 0) return
    let alive = true
    setAttachmentsLoading(true)
    void (async () => {
      for (const f of missing) {
        const pages = await renderInvoicePages(f).catch(() => [])
        if (!alive) return
        setAttachmentPages((prev) => ({ ...prev, [f]: pages }))
      }
    })().finally(() => { if (alive) setAttachmentsLoading(false) })
    return () => { alive = false }
  }, [printAttachments, invoiceFiles, attachmentPages])

  // Was abgeschlossen oder wieder geöffnet wird: bei gewählter Heizkostenabrechnung sie selbst, nicht
  // „Abrechnung <Jahr>“ (Sichtprüfung E45).
  const docLabel = target !== null && data?.scope?.kind === 'heating' ? `Heizkostenabrechnung ${data.period.label}` : `Abrechnung ${label}`

  // Die Fehler einer Rückfrage mit „Hier beheben →“ (#319); `onFix` bekommt das Ziel und schließt die Rückfrage.
  const errorList = (errors: readonly Notice[], onFix: (target: { tab: NoticeTab, focus: NoticeSubject }) => void) => (
    <ul className="close-errors">
      {errors.map((n, i) => {
        const target = noticeTarget(n.subject)
        return (
          <li key={i}>
            {/* Mehrere Fehler können zum selben Ziel führen; der Titel unterscheidet die Knöpfe (#319, K1). */}
            <strong id={`close-error-${i}`}>{n.title || n.text}</strong>
            {n.title && <div>{n.text}</div>}
            {target && onNavigate && (
              <div><button type="button" className="btn secondary notice-action" aria-describedby={`close-error-${i}`} onClick={() => onFix(target)}>{target.label}</button></div>
            )}
          </li>
        )
      })}
    </ul>
  )

  // Eine Rückfrage mit der Liste der Fehler und „Hier beheben →“ (UI-Durchsicht H6, #341). `true` heißt
  // weitermachen; Vorgabe ist, es zu lassen.
  async function askDespiteErrors(q: ErrorsQuestion): Promise<boolean> {
    // Ein Behälter statt `let`: Der Übersetzer sähe die Zuweisung im Knopf nicht und hielte das Ziel für null.
    const picked: { target: { tab: NoticeTab, focus: NoticeSubject } | null } = { target: null }
    const ok = await confirm({
      title: q.title,
      message: (dismiss) => (
        <>
          <p>{q.message}</p>
          {errorList(q.errors, (target) => { picked.target = target; dismiss() })}
        </>
      ),
      cancelLabel: q.cancelLabel,
      confirmLabel: q.confirmLabel,
      defaultChoice: 'cancel',
    })
    if (picked.target && onNavigate) onNavigate(picked.target.tab, picked.target.focus)
    return ok
  }
  // Vor dem Drucken einer offenen Abrechnung mit Fehlern; eine abgeschlossene fragt nicht (Durchsicht S6).
  async function goOnPrinting(): Promise<boolean> {
    const q = data ? printQuestion(noticesOf(data), !!data.closed) : null
    if (q && !(await askDespiteErrors(q))) return false
    // #317, Durchsicht S1: Der Monat der Anpassung im eingefrorenen Anschreiben gegen den Tag des Versands.
    return data?.closed && data.letters ? askSentMonth(data.closed.sentAt ?? localToday(), 'Trotzdem drucken') : true
  }
  async function askSentMonth(sentOn: string, confirmLabel: string): Promise<boolean> {
    const lines = data?.letters ? sentMonthLines(data.letters, data.statements, sentOn) : []
    if (lines.length === 0) return true
    return confirm({
      title: 'Monat der Anpassung prüfen',
      message: <ul className="m-0">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>,
      confirmLabel,
      defaultChoice: 'cancel',
    })
  }

  // Abrechnung abschließen / wieder öffnen / Versanddatum festhalten
  async function closeSettlement() {
    // Bei mehreren Objekten mit Objekt (#157): Eingefroren wird nur die Abrechnung dieses Objekts.
    const title = closeSettlementTitle(label, properties, property, docLabel)
    // Der Zeitraum der Rückfrage (#409): bei der getrennten Heizkostenabrechnung ihre Heizperiode, wie in `docLabel`.
    const heating = target !== null && data?.scope?.kind === 'heating'
    const closeLabel = heating && data ? data.period.label : label
    // Zeigt die Seite schon Fehler, nennt die erste Rückfrage sie (Durchsicht S2 zu #341); die Rückfrage des
    // Servers zu denselben Fehlern ist dann schon beantwortet.
    const withErrors = data ? closeErrorsQuestion(title, noticesOf(data), completenessQuestion(closeLabel, property?.kind, heating)) : null
    const ok = withErrors ? await askDespiteErrors(withErrors) : await confirm({
      title,
      message: closeMessage(closeLabel, property?.kind, heating),
      confirmLabel: 'Abschließen',
    })
    if (!ok) return
    const confirmed = withErrors?.errors ?? []
    // Bei einer Lücke ohne Rechnung fragt der Server nach (Heizung PR 7, Entwurf 8.2), ebenso bei Fehlern
    // der Abrechnung (#319); beides steht dann in einem Dialog. Vorgabe ist, nicht abzuschließen.
    let closed = false
    if (!(await attempt(async () => {
      closed = await closeWithQuestions(
        (body) => api(withProperty(paths.close, propertyId), { method: 'POST', body: JSON.stringify(body) }),
        // Bis zu drei Wege; Abwarten bzw. Nicht abschließen ist die Vorgabe (Enter, Fokus).
        (q) => new Promise((resolve) => {
          if (!q.fuel && sameErrors(confirmed, q.errors)) { resolve('despite'); return }
          let without = false
          let fix: { tab: NoticeTab, focus: NoticeSubject } | null = null
          const message = q.errors.length === 0 ? q.message : (dismiss: () => void) => (
            <>
              <p>{q.message}</p>
              {errorList(q.errors, (target) => { fix = target; dismiss() })}
            </>
          )
          void confirm({
            title: q.title, message, confirmLabel: q.confirmLabel, cancelLabel: q.cancelLabel, defaultChoice: 'cancel',
            ...(q.alternativeLabel ? { alternativeLabel: q.alternativeLabel, onAlternative: () => { without = true } } : {}),
          }).then((ok) => {
            if (fix && onNavigate) onNavigate(fix.tab, fix.focus)
            resolve(ok ? (q.fuel ? 'estimate' : 'despite') : without ? 'none' : 'wait')
          })
        }),
      )
    }))) return
    if (!closed) return
    await load()
    toast(`${docLabel} abgeschlossen.`)
  }
  async function reopenSettlement() {
    const ok = await confirm({
      title: `${docLabel} wieder öffnen?`,
      message: 'Es gilt wieder die laufende Berechnung. Der bisherige Stand bleibt unter „Frühere Abschlüsse“ erhalten. Eine bereits verschickte Abrechnung sollte nur bei Fehlern neu erstellt werden.',
      confirmLabel: 'Wieder öffnen',
    })
    if (!ok) return
    if (!(await attempt(() => api(withProperty(paths.close, propertyId), { method: 'DELETE' })))) return
    await load()
    toast(`${docLabel} wieder geöffnet.`)
  }
  // Das Versanddatum ist ein Entwurf, bis „Speichern“ es schickt (#309): Es setzt die Frist des § 556
  // Abs. 3 BGB, und ein verklicktes Datum im Kalender stand vorher sofort fest. Ein Fehler bleibt am
  // Feld stehen, der Entwurf mit ihm. Er gehört zu diesem Abschluss der gewählten Abrechnung: Eine
  // andere Abrechnung oder „Wieder öffnen“ verwirft ihn, sonst zählte er unsichtbar als offenes
  // Formular weiter und tauchte beim nächsten Abschluss wieder auf.
  const sentAt = useDraft(data?.closed?.sentAt ?? '', { scope: `${propertyId ?? ''}|${paths.close}|${data?.closed?.closedAt ?? ''}` })
  async function saveSentAt(value: string) {
    if (value && !(await askSentMonth(value, 'Versanddatum speichern'))) return keepDraft
    await api(withProperty(paths.close, propertyId), { method: 'PUT', body: JSON.stringify({ sentAt: value || null }) })
    await load()
  }
  const isClosed = !!data?.closed
  // Der Reiter zwischen Betriebs- und Heizkostenabrechnung wechselt den scope des Versanddatums; ein
  // ungespeichertes Datum fragt deshalb vorher nach (Durchsicht zu #333).
  const confirmDiscard = useConfirmDiscard()
  async function switchTarget(next: typeof target) {
    if (next?.plantId === target?.plantId && next?.period === target?.period) return
    if (await confirmDiscard([sentAt])) { setTarget(next); setPreviewId(null) }
  }

  // Die Eingabe aus „✎ anpassen“: gültig gespeichert, ungültig mit Meldung am Feld und ohne Speichern.
  function submitPpEdit(tenancyId: string) {
    if (!ppEdit) return
    const cents = parseEuro(ppEdit.value)
    if (cents === null || cents < 0) {
      setPpEdit({ ...ppEdit, error: 'Bitte einen Betrag in Euro eintragen, etwa 1.200,00 (nicht negativ).' })
      return
    }
    void savePpOverride(tenancyId, cents)
  }

  // Tatsächlich gezahlte Vorauszahlungen für ein Jahr festhalten (Korrektur) bzw. zurücksetzen
  async function savePpOverride(tenancyId: string, cents: number | null) {
    const ten = tenancies.find((t) => t.id === tenancyId)
    // Die Korrektur steht unter dem Zeitraum (#208). Bei einem Kalenderobjekt nennt der Server sie
    // nach Jahreszahl, für Tabs von vor dem Update; geschickt werden hier nur Zeiträume, sonst gälten
    // die Jahreszahlen als vollständiger Stand und die neue Korrektur fiele weg.
    const overrides: Record<string, number> = Object.fromEntries(Object.entries(ten?.prepaymentOverrides ?? {})
      .map(([schluessel, betrag]) => [/^\d{4}$/.test(schluessel) ? calendarPeriod(Number(schluessel)) : schluessel, betrag]))
    if (cents === null) delete overrides[key]
    else overrides[key] = cents
    // In der Heizkostenabrechnung ist „✎ anpassen“ die endgültige Heizkorrektur der Heizperiode (D2, Heizung PR 5).
    const body = target
      ? { heatingPrepaymentOverrides: heatingOverridesWith(ten ?? {}, target.plantId, target.period, cents) }
      : { prepaymentOverrides: overrides }
    // Lehnt der Server ab, steht sein Satz am Feld und nicht oben auf der Seite (#346, Schritt 3).
    try {
      await api(`/api/tenancies/${tenancyId}`, { method: 'PUT', body: JSON.stringify(body) })
    } catch (e) {
      if (cents === null) toast(errorText(e), 'error')
      else setPpEdit((p) => (p ? { ...p, error: errorText(e) } : p))
      return
    }
    // Wie vorher über `attempt`: Ein Erfolg nimmt einen alten Fehler oben auf der Seite weg.
    setError('')
    setPpEdit(null)
    await Promise.all([load(), reload()])
    toast(cents === null ? 'Vorauszahlung zurückgesetzt.' : 'Gezahlte Vorauszahlung übernommen.')
  }

  // Daten und Jahr über eine Referenz: Der Druck hängt nur an printId, sonst öffnete ein Neuladen
  // der Daten, während auf die nächste Bedienung gewartet wird, den Druckdialog ein zweites Mal
  const printSource = useRef({ data, label })
  printSource.current = { data, label }
  // Druck (#415): ob die Seitenzahl in den Rand kommt, gesetzt, sobald die Gestaltung feststeht (unten).
  const pageNumbers = useRef(true)
  useEffect(() => {
    if (!printId) return
    document.body.classList.add('print-one')
    // Der Seitentitel wird zum Dateinamen beim „Als PDF speichern“. Aufgeräumt wird erst bei der
    // nächsten Bedienung, nicht schon bei `afterprint` (Safari, siehe printJob.ts).
    const { data, label } = printSource.current
    const st = data?.statements.find((s) => s.tenancyId === printId)
    const job = startPrint({
      title: st ? `${data ? settlementTitle(data) : `Nebenkostenabrechnung ${label}`} ${st.unitName} ${st.tenantName}` : document.title,
      // „Seite x von y“ nur beim Druck dieser einen Abrechnung (#415, Teil 2); der Fußvermerk steht im Fluss (Letter.tsx).
      pageNumbers: pageNumbers.current,
      onDone: () => {
        document.body.classList.remove('print-one')
        setPrintId(null)
      },
    })
    return () => {
      job.cancel()
      document.body.classList.remove('print-one')
    }
  }, [printId])

  // Alle Mieter drucken: wie Strg+P, mit dem Titel der Abrechnung als Dateiname.
  useEffect(() => {
    if (!printingAll) return
    const { data, label } = printSource.current
    const job = startPrint({
      title: data ? settlementTitle(data) : `Nebenkostenabrechnung ${label}`,
      onDone: () => setPrintingAll(false),
    })
    return () => job.cancel()
  }, [printingAll])

  // Vorschau öffnen und schließen: der Fokus auf die Überschrift der Vorschau, beim Zurück auf „Ansehen“ des Mieters.
  function openPreview(id: string) {
    returnTo.current = id
    setPreviewId(id)
  }
  function closePreview() {
    setPreviewId(null)
  }
  // Aus der Vorschau zu „Zu prüfen“ (Durchsicht K4): der Fokus auf die Karte statt auf „Ansehen“.
  const CHECKS = '\u0000checks'
  function backToChecks() {
    returnTo.current = CHECKS
    setPreviewId(null)
  }
  useEffect(() => {
    if (previewId) {
      previewHeading.current?.focus()
      return
    }
    const back = returnTo.current
    returnTo.current = null
    if (back === CHECKS) document.getElementById(checksId)?.focus()
    else if (back) document.getElementById(`${previewIds}-${back}`)?.focus()
  }, [previewId, previewIds, checksId])

  // Das Fenster „Drucken“: merkt sich die Häkchen, damit „Abbrechen“ sie wiederherstellt.
  function openPrint(scope: PrintScope) {
    printBefore.current = { letterChoice, settings: printDraft.value, dirty: printDraft.dirty }
    setPrintDrawer({ scope })
  }
  // Gespeichert im Fenster (Durchsicht K2): Der gespeicherte Stand ist der neue Stand von vorher, und das Fenster
  // vergleicht ab jetzt mit ihm (neu eingehängt über `key`); „Abbrechen“ fragt dann nicht und stellt nichts Altes her.
  const [printSaves, setPrintSaves] = useState(0)
  async function savePrintInDrawer(value: typeof printDraft.value) {
    await savePrint(value)
    printBefore.current = { letterChoice, settings: value, dirty: false }
    setPrintSaves((n) => n + 1)
  }
  function cancelPrint() {
    const before = printBefore.current
    if (before) {
      setLetterChoice(before.letterChoice)
      if (before.dirty) printDraft.set(before.settings)
      else printDraft.discard()
    }
    printBefore.current = null
    setPrintDrawer(null)
  }
  const { busy: printBusy, run: runPrint } = useSaving()
  function printNow() {
    const scope = printDrawer?.scope
    if (!scope) return
    void runPrint(async () => {
      if (!(await goOnPrinting())) return
      printBefore.current = null
      setPrintDrawer(null)
      if (scope === 'all') setPrintingAll(true)
      else setPrintId(scope)
    })
  }

  const distributed = data ? data.totalCostsCents - data.landlord.totalCents : 0
  // Ein Zeitraum ohne Abrechnung, Pauschale und Kosten: kein Entwurf, keine Kennzahlen, nur der erste Schritt (N12).
  // Abgeschlossen bleibt die Karte zum Wiederöffnen (Durchsicht K1).
  const empty = data ? emptySettlement(data) && !data.closed : false
  const start = startStep(units, tenancies, label, calendar)

  // §556 Abs. 3 BGB: Die Abrechnung muss dem Mieter binnen 12 Monaten nach Ende des
  // Abrechnungszeitraums zugehen, sonst sind Nachforderungen ausgeschlossen. Nach dem
  // Wiederöffnen zählt der frühere Versand weiter (#142, siehe deadlineView). Bezeichnung und Frist
  // vom Server (#208).
  // Teil 2b: Vor #415 abgeschlossen druckt die ganze Abrechnung wie damals, ohne Logo und Briefpapier.
  // Druck in Safari (#286): Briefpapier nur, wo der Browser die Ränder je Druckseite wiederholen kann (`canPagePaper`).
  const planned = printDesign(designs, { legacy: !!data?.closed && !data?.letters, pagedPaper: canPagePaper() })
  // Erst geladen, dann gedruckt: Eine PDF als Briefpapier rendert pdf.js vorab zu einem Bild, wie die Belegkopien; bis
  // dahin wartet „Drucken“. Fehlt eine Datei, druckt die Seite ohne sie (Durchsicht M2, `printedDesign`).
  const design = printedDesign(planned, loadedDesign)
  const plannedKey = designKey(planned)
  useEffect(() => {
    let alive = true
    const load = (f: typeof planned.logo, label: string, failed: string[]) => (f ? designImage(f).catch(() => { failed.push(label); return null }) : Promise.resolve(null))
    const failed: string[] = []
    void Promise.all([load(planned.logo, 'Logo', failed), load(planned.paper, 'Briefpapier', failed), load(planned.follow, planned.follow?.file === planned.paper?.file ? 'Briefpapier' : 'Briefpapier der Folgeseiten', failed)])
      .then(([logo, paper, follow]) => { if (alive) setLoadedDesign({ key: plannedKey, logo, paper, follow, failed: [...new Set(failed)] }) })
    return () => { alive = false }
  }, [plannedKey])
  const missingDesign = [...new Set([...(designs?.missing ?? []), ...design.failed])]
  const deadlineInfo = data ? deadlineView(data.period.label, data.deadline, data.closed?.sentAt ?? null, history, new Date()) : null

  // Alles, was eine Mieterabrechnung zum Drucken braucht, einmal je Mieter: für die Abrechnung selbst, für das Fenster
  // „Drucken“ (was vor dem Druck zu prüfen ist) und für „Zu prüfen“.
  function viewOf(data: Settlement, st: Statement) {
              const letterDate = data.closed?.sentAt ?? localToday()
              const draftMark = showsDraftMark(noticesOf(data), !!data.closed)
              // Vor #415 abgeschlossen: kein eingefrorenes Anschreiben, gedruckt wird der bisherige Aufbau (Durchsicht S1).
              const legacy = !!data.closed && !data.letters
              const tenancy = tenancies.find((t) => t.id === st.tenancyId)
              // Belege, die in dieser Abrechnung tatsächlich vorkommen (für die Anlage)
              const stFiles = printAttachments
                ? [...new Set(st.rows
                    .map((r) => costItems.find((c) => c.id === r.costItemId)?.invoiceFile)
                    .filter((f): f is string => !!f))]
                : []
              const attachmentsReady = stFiles.every((f) => attachmentPages[f])
              // Positionen nach Kostenart gruppieren — mit Zwischensumme, sobald eine
              // Kostenart mehrere Positionen hat (erleichtert den Abgleich mit dem Bescheid).
              const groups: { category: string; rows: SettlementRow[] }[] = []
              for (const r of st.rows) {
                const g = groups.find((x) => x.category === r.category)
                if (g) g.rows.push(r)
                else groups.push({ category: r.category, rows: [r] })
              }
              const letter = legacy ? null : letterOf(data, st, { settings, property, tenancies })
              const attachmentCount = printAttachments ? stFiles.length : 0
              const paragraphs = letter ? letterParagraphs(letter, st.balanceCents, { date: letterDate, attachments: attachmentCount }) : []
              // Abgeschlossen gilt die eingefrorene Frist, nicht die heutige Einstellung (Durchsicht S2).
              const frozenDays = Number(letter?.values.Zahlungsfrist)
              const paymentDays = data.closed && Number.isFinite(frozenDays) && frozenDays > 0 ? frozenDays : landlord?.paymentDeadlineDays
              const lockedId = `letter-locked-${st.tenancyId}`
              // Teil 2: mit oder ohne Anschreiben; Kopf, Fußzeile und Fußvermerk aus dem Anschreiben, abgeschlossen also
              // eingefroren. Ein Abschluss aus Teil 1 kennt Anschrift und Fußzeile des Vermieters nicht: keine Anschrift
              // im Kopf (die Rücksendeangabe ist eingefroren) und keine Fußzeile.
              const showLetter = letter !== null && withLetter
              const print = { date: letterDate, attachments: attachmentCount }
              // Ein Abschluss ohne eingefrorene Fußzeile (zwischen #421 und Teil 2) druckt keine, statt Kontakt und Bank von heute
              // (Durchsicht zu PR #427, K3).
              const footerText = printFooter && letter && !design.paper ? (letter.sender ? (letter.sender.footer ?? '') : (landlord ? footerLine(landlord) : '')) || null : null
              const head = letter ? {
                sender: letter.sender?.name ?? landlord?.landlordName ?? '',
                senderAddress: letter.sender ? (letter.sender.address ?? '') : (landlord?.landlordAddress ?? ''),
                returnLine: letter.sender?.returnLine ?? (landlord ? returnLine(landlord, property) : letterhead('', property)),
                // Ohne eingefrorene Anschrift (Abschluss aus der ersten Fassung von #415) wie damals mit der Wohnung als Zeile.
                recipient: letter.recipient ?? (data.closed ? formerRecipientLines(st.tenantName, st.unitName, tenancy, property) : recipientLines(st.tenantName, tenancy, property)),
                // Informationsblock nach DIN 5008 (Druck, #415): Ansprechpartner, Kontakt, Ort und Datum.
                info: infoRows(letter.sender ?? { name: landlord?.landlordName ?? '', returnLine: '' }, fmtDate(letterDate)),
                foldMarks: printFoldMarks,
                draftMark: draftMark ? DRAFT_MARK : null,
                // Teil 2b: Logo oben rechts; mit Briefpapier entfällt der Absender von Mietfuchs (Letter.tsx).
                logo: design.logo,
                paper: design.paper,
              } : null
              const subject = letter && !showLetter ? renderLetterText(letter.texts.subject, print) : ''
              const underTable = letter && !showLetter ? statementBlocks(letter, st.balanceCents, attachmentCount).map((b) => ({ block: b, text: renderLetterText(letter.texts[b], print) })) : []
              // Druck (#415): je Seite Abrechnung, Objekt und Wohnung; Kontakt und Bank stehen auf der Briefseite, nicht auf jeder.
              const footnote = letter ? footnoteText(letter) : null
              // #229: fehlt nach dem Auszug die neue Anschrift, oder hat sie sich nach dem Abschluss geändert? Verglichen wird
              // mit dem, was gedruckt würde (abgeschlossen also eingefroren).
              const addressState = addressCheck(st, tenancy, head?.recipient, property, localToday(), data.closed?.sentAt)
    return { st, letterDate, draftMark, legacy, tenancy, stFiles, attachmentsReady, groups, letter, attachmentCount, paragraphs, paymentDays, lockedId, showLetter, print, footerText, head, subject, underTable, footnote, addressState }
  }
  const views = data ? data.statements.map((st) => viewOf(data, st)) : []
  // Mit Briefpapier hat die Seite keinen Rand und damit keine Randfelder.
  pageNumbers.current = !design.paper
  const preview = views.find((v) => v.st.tenancyId === previewId) ?? null
  const around = neighbors(views.map((v) => v.st.tenancyId), previewId ?? '')
  const nameOf = (id: string | null) => views.find((v) => v.st.tenancyId === id)?.st.tenantName ?? ''
  const prevName = nameOf(around.prev)
  const nextName = nameOf(around.next)
  const rows = data ? tenantRows(data) : []

  // Was die Seite selbst vor dem Versand prüft (Anschrift, Länge von Anschreiben und Anschrift, #229, #415), als Hinweise
  // derselben Gestalt wie die der Berechnung; in „Zu prüfen“, im Fenster „Drucken“ und weiter in der Vorschau.
  function pageChecks(v: ReturnType<typeof viewOf>): Notice[] {
    const out: Notice[] = []
    const who = `${v.st.tenantName}, ${v.st.unitName}`
    if (v.addressState) {
      const a = addressNotice(v.addressState, v.st.tenantName, v.st.unitName)
      out.push({ code: 'page.address', level: 'warning', title: a.title, text: a.text, ...(v.addressState === 'former' ? { subject: { kind: 'tenancy', id: v.st.tenancyId } } : {}) })
    }
    if (v.showLetter && exceedsOnePage(v.paragraphs.map((p) => p.text))) {
      out.push({ code: 'page.letter-long', level: 'warning', title: `Anschreiben länger als eine Seite (${who})`, text: LETTER_LONG_TEXT })
    }
    if (v.head && returnLineTooLong(v.head.returnLine)) out.push({ code: 'page.return-line', level: 'warning', title: 'Rücksendeangabe zu lang', text: returnLineText(v.head.returnLine) })
    const field = v.head ? addressFieldWarning(v.head.recipient) : null
    if (field) out.push({ code: 'page.address-field', level: 'warning', title: `Anschrift zu lang für das Fensterfeld (${who})`, text: field })
    return out
  }
  // Je Hinweis einmal (die Rücksendeangabe ist bei allen Mietern dieselbe).
  const uniqueChecks = (list: Notice[]) => list.filter((n, i) => list.findIndex((m) => m.title === n.title && m.text === n.text) === i)
  const ownChecks = uniqueChecks(views.flatMap(pageChecks))
  const checks = checkList(data ? [...noticesOf(data), ...ownChecks] : [])
  // Je Mieter die Titel der eigenen Prüfungen, als Merker in der Tabelle der Übersicht.
  const checksByTenancy = new Map(views.map((v) => [v.st.tenancyId, pageChecks(v).map((n) => (n.code === 'page.address' ? 'Anschrift prüfen' : n.title.replace(/ \(.*\)$/, '')))]))
  const fixOf = (n: Notice) => {
    const t = noticeTarget(n.subject)
    return t && onNavigate ? { label: t.label, onClick: () => onNavigate(t.tab, t.focus) } : null
  }
  const deviation = data?.closed ? deviationView(data.deviation) : null

  // Die Aktionen unter „Mehr“: Anschreiben und Briefpapier des Objekts, Export.
  const letterMore = !!data && !empty && data.statements.length > 0 && ((!!propertyId && !!templates) || (!!designs && !!propertyId))
  const exportMore = !!data && !empty && !target
  const moreItems = letterMore || exportMore

  // Was gedruckt würde und ob es schon geht.
  const printViews = printDrawer ? (printDrawer.scope === 'all' ? views : views.filter((v) => v.st.tenancyId === printDrawer.scope)) : []
  const printBlocked = printAttachments && !printViews.every((v) => v.attachmentsReady)
    ? 'Belegkopien werden noch vorbereitet …'
    : !design.ready ? 'Logo und Briefpapier werden noch vorbereitet …' : null
  const printWarnings = uniqueChecks(printViews.flatMap(pageChecks))
  if (planned.paperSkipped) printWarnings.push({ code: 'page.paper-browser', level: 'info', title: 'Briefpapier druckt dieser Browser nicht', text: PAPER_BROWSER_TEXT })

  return (
    <>
      <div className="no-print">
        <PageHeader title="Abrechnung" subtitle={'Die fertige Nebenkostenabrechnung pro Mieter — als PDF speichern über „Drucken“.'} />
      </div>
      {error && <NoticeBox level="error" action={error} />}
      {/* Teil 2b: Mit Briefpapier ohne Seitenrand, das Papier der Folgeseiten einmal für alle Druckseiten. */}
      {design.paper && <style>{PAPER_PAGE_CSS}</style>}
      {missingDesign.length > 0 && (
        <NoticeBox
          level="warning"
          className="no-print"
          title="Logo oder Briefpapier fehlt"
          action={`${missingDesign.join(', ')}: Die Datei fehlt im Datenordner (etwa nach dem Einspielen einer Vorversion). Gedruckt wird ohne; wählen Sie die Datei unter „Logo und Briefpapier“ neu.`}
        />
      )}

      {/* Zone 1, die Kopfzeile: welche Abrechnung, ihr Stand und die Frist, rechts der eine Primärknopf des Zustands,
          „Drucken“ und „Mehr“. Im leeren Zeitraum gibt es nichts zu drucken (N12); den Umschalter zur
          Heizkostenabrechnung gibt es trotzdem. In der Vorschau eines Mieters steht statt ihrer die Leiste der Vorschau. */}
      {!preview && data && (!empty || choices.length > 0) && (
      <div className="card no-print">
        {choices.length > 0 && (
          // Sichtprüfung S7/E44: ein Umschalter, dessen gewählter Teil hervorgehoben ist
          <div className="segmented no-print" role="group" aria-label="Welche Abrechnung?">
            <button type="button" aria-pressed={target === null} onClick={() => void switchTarget(null)}>{`Betriebskosten ${label}`}</button>
            {choices.map((h) => (
              <button type="button" key={`${h.plantId}|${h.period.key}`} aria-pressed={target?.period === h.period.key} onClick={() => void switchTarget({ plantId: h.plantId, period: h.period.key })}>
                {`Heizkosten ${h.period.label} (eigene Abrechnung, Frist ${fmtDate(h.deadline)})`}
              </button>
            ))}
          </div>
        )}
        {data.separateHeating && data.separateHeating.length > 0 && target === null && (
          <div className="info no-print">{`Die Heizkosten ${data.separateHeating.map((h) => h.period.label).join(', ')} rechnen Sie getrennt ab; sie stehen nicht in dieser Abrechnung.`}</div>
        )}
        {!empty && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="grow">
              {isClosed ? (
                <>
                  <span className="badge green">abgeschlossen</span>{' '}
                  <span className="muted">
                    am {fmtDate(data.closed!.closedAt.slice(0, 10))} eingefroren — Änderungen an Kosten/Stammdaten wirken sich nicht mehr aus.
                  </span>
                </>
              ) : (
                <>
                  <span className="badge gray">Entwurf</span>{' '}
                  <span className="muted">Die Abrechnung wird laufend neu berechnet. Nach dem Versand abschließen, damit sich der Stand nicht mehr ändert.</span>
                </>
              )}
              {/* Die Frist (§ 556 Abs. 3 BGB) in derselben Zeile; läuft sie bald ab oder ist sie abgelaufen, steht sie darunter als Hinweis. */}
              {deadlineInfo && data.totalCostsCents > 0 && deadlineInfo.level === 'ok' && <div className="muted">{deadlineInfo.text}</div>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isClosed ? (
                <>
                  <label className="field" title="Datum, an dem die Abrechnung an die Mieter ging — maßgeblich für die §556-Frist">
                    versendet am
                    <input
                      type="date"
                      value={sentAt.value}
                      disabled={sentAt.saving}
                      onChange={(e) => sentAt.set(e.target.value)}
                    />
                  </label>
                  <DraftActions draft={sentAt} onSave={saveSentAt} what="Versanddatum" />
                </>
              ) : (
                <>
                  <button className="btn" disabled={!data || data.totalCostsCents === 0} aria-describedby={data.totalCostsCents === 0 ? 'close-none' : undefined} onClick={() => void closeSettlement()}>
                    🔒 {docLabel} abschließen
                  </button>
                  {data.totalCostsCents === 0 && <span id="close-none" className="muted">Noch keine Kosten erfasst, nichts abzuschließen.</span>}
                </>
              )}
              {data.statements.length > 0 && (
                <button className="btn secondary" onClick={() => openPrint('all')}>🖨 Drucken / PDF</button>
              )}
              {moreItems && (
                <button className="btn secondary" aria-expanded={moreOpen} aria-controls={moreId} onClick={() => setMoreOpen((o) => !o)}>Mehr {moreOpen ? '▴' : '▾'}</button>
              )}
              {/* Mit Abstand zu „Speichern“ des Versanddatums, rot beim Überfahren und „…“, weil eine Rückfrage folgt (#346 Schritt 7, M19). */}
              {isClosed && <button className="btn ghost danger-ghost ml-auto" onClick={() => void reopenSettlement()}>Wieder öffnen …</button>}
            </div>
          </div>
        )}
        {data && deadlineInfo && data.totalCostsCents > 0 && deadlineInfo.level !== 'ok' && (
          <NoticeBox level={deadlineInfo.level === 'error' ? 'error' : 'warning'} action={deadlineInfo.text} />
        )}
        {/* Geänderte Druckeinstellungen nach dem Schließen des Fensters „Drucken“: hier speichern oder verwerfen (#309). */}
        {!printDrawer && printDraft.dirty && (
          <div className="flex flex-wrap items-center gap-2">
            <span>Druckeinstellungen geändert.</span>
            <DraftActions draft={printDraft} onSave={savePrint} what="Druckeinstellungen" />
            <span className="muted">{PRINT_DRAFT_NOTE}</span>
          </div>
        )}
        {!printDrawer && letterChoice !== null && letterChoice !== letterDefault && <p className="muted m-0">{LETTER_CHOICE_NOTE}</p>}
        {moreItems && moreOpen && (
          <div id={moreId} className="grid gap-3 pt-3 border-t border-line">
            {letterMore && (
              <div className="grid gap-2">
                <p className="muted m-0">
                  {withLetter ? 'Jede Abrechnung beginnt mit einem Brief an den Mieter.' : 'Ohne Anschreiben beginnt die Aufstellung mit Anschrift, Datum und Betreff; Ergebnis, Anpassung und Belegeinsicht stehen unter der Tabelle.'} Die Vorlage für alle Objekte steht unter
                  „Einstellungen“; hier weichen Sie für dieses Objekt ab, bei einem Mieter mit „Anschreiben bearbeiten“ in seiner Vorschau.
                  {isClosed ? ' Diese Abrechnung ist abgeschlossen; ihr Anschreiben ist eingefroren.' : ''}
                </p>
                {propertyId && templates && (
                  <div><button className="btn secondary" onClick={() => setLetterEdit({ kind: 'property' })}>Vorlage für dieses Objekt bearbeiten</button></div>
                )}
                {/* Teil 2b: Logo und Briefpapier, die Vorgabe aus den Einstellungen oder eine eigene für dieses Objekt. */}
                {designs && propertyId && (
                  <div className="row">
                    <span className="muted">Logo und Briefpapier: {designSummary(designs.property ?? designs.installation)}{designs.property ? ' (eigene für dieses Objekt)' : ' (wie in den Einstellungen)'}</span>
                    <button className="btn secondary" onClick={() => setDesignEdit(true)}>Logo und Briefpapier für dieses Objekt</button>
                  </div>
                )}
              </div>
            )}
            {exportMore && (
              <div className="row center">
                <span className="muted grow">Die Zahlen dieser Abrechnung als Daten, etwa für ein eigenes Layout (Beträge in JSON in Cent).</span>
                <button className="btn secondary" onClick={() => void exportData('json')}>Als JSON exportieren</button>
                <button className="btn secondary" onClick={() => void exportData('csv')}>Als CSV exportieren</button>
              </div>
            )}
          </div>
        )}
      </div>
      )}
      {/* Frühere Abschlüsse (#56), auch ohne Kopfzeile, etwa im leeren Zeitraum (Durchsicht K5). */}
      {!preview && (
        <>
          {history.length > 0 && (
          <details className="settlement-history no-print">
            <summary>Frühere Abschlüsse dieses Jahres ({history.length})</summary>
            <div className="muted">Beim Wiederöffnen bleibt der bisherige Stand erhalten; hier stehen die früheren, der zuletzt wiedergeöffnete zuerst.</div>
            {historyView(history).map((h) => (
              <div key={h.id} className="settlement-history-entry">
                <strong>{h.head}</strong>
                <ul>{h.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </div>
            ))}
          </details>
          )}
        </>
      )}

      {/* Zone 2, „Zu prüfen“: Fehler, Warnungen und Hinweise mit Betrag, Kürzung oder Aufforderung stehen offen wie im
          Baustein Notice (eingeklappt nur „Mehr dazu“), „Hier beheben →“ ohne Aufklappen; nur stille Hinweise sind in einer
          Zeile zusammengefasst (Durchsicht M1, K3). Der Wortlaut der Hinweise bleibt unverändert. */}
      {!preview && data && (checks.errors.length + checks.warnings.length + checks.hints.length + checks.quiet.length > 0 || deviation) && (
        <Card id={checksId} tabIndex={-1} title="Zu prüfen" className="no-print">
          {deviation && (
            // Abgeschlossenes Jahr gegen die heutige Berechnung (#56): erklären, nicht drängen.
            <NoticeBox level="warning" title={deviation.title}>
              <div>{deviation.intro}</div>
              {deviation.lines.length > 0 && <ul className="deviation-list">{deviation.lines.map((l) => <li key={l.id}>{l.text}</li>)}</ul>}
            </NoticeBox>
          )}
          <div className="notice-list">
            {checks.errors.map((n, i) => <CalcNotice key={`e${i}`} notice={n} fix={fixOf(n)} />)}
            {checks.warnings.map((n, i) => <CalcNotice key={`w${i}`} notice={n} fix={fixOf(n)} />)}
            {checks.hints.map((n, i) => <CalcNotice key={`h${i}`} notice={n} fix={fixOf(n)} />)}
            {checks.quiet.length > 0 && (
              <NoticeGroup level="hint" summary={hintSummary(checks.quiet)}>
                {checks.quiet.map((n, i) => <CalcNotice key={`q${i}`} notice={n} fix={fixOf(n)} />)}
              </NoticeGroup>
            )}
          </div>
        </Card>
      )}

      {data && (
        <>
          {/* Zone 3, „Übersicht“: die Kennzahlen und eine Zeile je Mieter, mit „Ansehen“ zur Vorschau. */}
          {!preview && !empty && (
            <div className="kpis no-print">
              <div className="kpi">
                <div className="v">{fmtEuro(data.totalCostsCents)}</div>
                <div className="l">Gesamtkosten {data.period.label}</div>
              </div>
              <div className="kpi">
                <div className="v">{fmtEuro(distributed)}</div>
                <div className="l">auf Mieter umgelegt</div>
              </div>
              <div className="kpi">
                <div className="v">{fmtEuro(data.landlord.totalCents)}</div>
                <div className="l">Vermieteranteil</div>
              </div>
            </div>
          )}

          {/* Leerzustand (#346, Schritt 10, N12): die fehlende Voraussetzung mit dem Knopf dorthin. */}
          {!preview && data.statements.length === 0 && (data.notSettled ?? []).length === 0 && (
            <div className="card no-print">
              {empty ? (
                <EmptyState action={onNavigate ? { label: start.label, onClick: () => onNavigate(start.tab) } : null}>{start.text}</EmptyState>
              ) : (
                <EmptyState action={onNavigate ? { label: 'Mietverhältnis anlegen', onClick: () => onNavigate('stammdaten') } : null}>
                  {`Für ${calendar ? 'das Jahr' : 'den Zeitraum'} ${label} sind Kosten erfasst, aber es gibt kein Mietverhältnis, auf das sie verteilt werden. Legen Sie eines an, oder prüfen Sie Beginn und Ende der Mietverhältnisse.`}
                </EmptyState>
              )}
            </div>
          )}

          {/* Mietverhältnisse mit Pauschale oder Inklusivmiete bekommen keine Abrechnung (#93); sie stehen als Zeile
              „Ohne Abrechnung“ mit ihrem Grund in derselben Tabelle, statt still zu fehlen. */}
          {!preview && rows.length > 0 && (
            <Card title="Abrechnungen je Mieter" className="no-print">
              <Table className="stacked" aria-label="Abrechnungen je Mieter">
                <thead>
                  <tr>
                    <th scope="col">Mieter</th>
                    <th scope="col">Wohnung</th>
                    <th scope="col">Zeitraum</th>
                    <th scope="col" className="num">Kosten</th>
                    <th scope="col" className="num">Vorauszahlungen</th>
                    <th scope="col">Ergebnis</th>
                    <th scope="col"><span className="sr-only">Aktion</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.tenancyId}>
                      <td data-label="Mieter">
                        {r.tenantName}
                        {(checksByTenancy.get(r.tenancyId) ?? []).map((t) => <div key={t} className="muted">{`⚠︎ ${t}`}</div>)}
                      </td>
                      <td data-label="Wohnung">{r.unitName}</td>
                      {r.settled ? (
                        <>
                          <td data-label="Zeitraum">{r.period}<div className="muted">{`${r.days} Tage`}</div></td>
                          <td data-label="Kosten" className="num">{fmtEuro(r.costsCents)}</td>
                          <td data-label="Vorauszahlungen" className="num">{fmtEuro(r.prepaymentCents)}</td>
                          <td data-label="Ergebnis"><strong>{resultText(r.balanceCents)}</strong></td>
                          <td className="actions">
                            <button id={`${previewIds}-${r.tenancyId}`} className="btn small secondary" onClick={() => openPreview(r.tenancyId)}>
                              Ansehen{' '}<span className="sr-only">{`(${r.tenantName}, ${r.unitName})`}</span>
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td data-label="Ergebnis" colSpan={4}>{`Ohne Abrechnung: ${r.reason}`}</td>
                          <td className="actions" />
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
              {(data.notSettled ?? []).some((n) => !n.usageConflict) && (
                <p className="muted">
                  Bei Pauschale oder Inklusivmiete bleibt der Anteil des Mietverhältnisses an den Kosten beim Vermieter und zählt
                  als Werbungskosten.
                </p>
              )}
              {(data.notSettled ?? []).some((n) => n.usageConflict) && (
                <p className="muted">
                  Ein Mietverhältnis, das ganz in einer Zeit liegt, in der die Einheit laut ihrer Nutzung nicht vermietet
                  ist, bekommt keine Abrechnung. Bitte prüfen Sie Ein- und Auszug oder den Nutzungswechsel in den Stammdaten.
                </p>
              )}
            </Card>
          )}

          {/* #317: was das abgeschlossene Anschreiben an neuer Vorauszahlung ankündigt, in die Staffel übernehmen. Eine
              eigene Karte unter der Tabelle, denn Stand, Warnung und Monat je Mieter wären als Spalte zu eng. */}
          {!preview && data.closed && data.letters && (
            <PrepaymentStepsCard key={`${paths.load}|${data.closed.closedAt}|${data.closed.sentAt ?? ''}`} path={paths.load} propertyId={propertyId ?? null} onSaved={reload} />
          )}

          {/* Die Vorschau eines Mieters über die ganze Breite: Brief und Aufstellung, wie sie gedruckt werden. */}
          {preview && (
            <div className="card no-print grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn secondary" onClick={closePreview}>‹ Zurück zur Übersicht</button>
                <span className="grow" />
                <button className="btn secondary" disabled={!around.prev} onClick={() => around.prev && openPreview(around.prev)}>
                  ‹ Vorheriger Mieter{prevName && <>{' '}<span className="sr-only">{`(${prevName})`}</span></>}
                </button>
                <span className="muted">{`${around.index + 1} von ${around.count}`}</span>
                <button className="btn secondary" disabled={!around.next} onClick={() => around.next && openPreview(around.next)}>
                  Nächster Mieter ›{nextName && <>{' '}<span className="sr-only">{`(${nextName})`}</span></>}
                </button>
              </div>
              <h2 ref={previewHeading} tabIndex={-1} className="m-0">{`Vorschau: ${preview.st.tenantName} · ${preview.st.unitName}`}</h2>
              {/* Durchsicht K4: Fehler der Abrechnung stehen in „Zu prüfen“; die Vorschau sagt, dass es sie gibt. */}
              {checks.errors.length > 0 && (
                <NoticeBox
                  level="error"
                  action={`Diese Abrechnung hat ${checks.errors.length} Fehler; sie stehen unter „Zu prüfen“.`}
                  fix={{ label: 'Zurück zu „Zu prüfen“', onClick: backToChecks }}
                />
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="btn secondary"
                  disabled={isClosed || !templates}
                  aria-describedby={isClosed ? preview.lockedId : undefined}
                  onClick={() => setLetterEdit({ kind: 'tenancy', tenancyId: preview.st.tenancyId })}
                >
                  Anschreiben bearbeiten
                </button>
                {/* Der Grund steht sichtbar daneben, wie bei anderen gesperrten Knöpfen (Durchsicht K10). */}
                {isClosed && <span id={preview.lockedId} className="muted">{preview.legacy ? 'Vor dem Anschreiben abgeschlossen; gedruckt wird wie bisher.' : 'Abgeschlossen; das Anschreiben ist eingefroren.'}</span>}
                <button className="btn secondary" onClick={() => openPrint(preview.st.tenancyId)}>
                  🖨 Drucken{' '}<span className="sr-only">{`(${preview.st.tenantName})`}</span>
                </button>
                <label className="checkline">
                  <input type="checkbox" checked={showSteps} onChange={(e) => setShowSteps(e.target.checked)} />
                  <span>Rechenweg zeigen</span>
                </label>
              </div>
            </div>
          )}

          {views.map((v) => {
            const { st, letterDate, draftMark, legacy, tenancy, stFiles, groups, letter, attachmentCount, paragraphs, paymentDays, showLetter, footerText, head, subject, underTable, footnote, addressState } = v
            // Auf dem Bildschirm steht nur die Abrechnung der Vorschau; gedruckt werden sie alle bzw. die gewählte.
            const hidden = preview?.st.tenancyId !== st.tenancyId
            return (
            <div key={st.tenancyId} className={`card statement ${printId === st.tenancyId ? 'print-target' : ''}${design.paper ? ' paper-print' : ''}${hidden ? ' statement-hidden' : ''}`} style={design.margins ? paperVars(design.margins) : undefined}>
              {addressState && (
                <NoticeBox
                  level="warning"
                  className="no-print"
                  title={addressNotice(addressState, st.tenantName, st.unitName).title}
                  action={addressNotice(addressState, st.tenantName, st.unitName).text}
                  fix={onNavigate && addressState === 'former' ? { label: 'Hier beheben → Stammdaten', onClick: () => onNavigate('stammdaten', { kind: 'tenancy', id: st.tenancyId }) } : null}
                />
              )}
              {/* Seite 1: das Anschreiben (#415). Datum ist der Versand, sonst der Tag des Drucks. Absender und Anschrift
                  aus dem Anschreiben, abgeschlossen also eingefroren (Durchsicht S2). */}
              {showLetter && head ? (
                <>
                  <Letter {...head} paragraphs={paragraphs} footer={footerText} />
                  {exceedsOnePage(paragraphs.map((p) => p.text)) && (
                    <NoticeBox level="warning" className="no-print" title="Anschreiben länger als eine Seite" action={LETTER_LONG_TEXT} />
                  )}
                </>
              ) : head ? (
                <StatementHead {...head} />
              ) : (
                <LegacyHead sender={letterhead(landlord?.landlordName, property)} date={letterDate} recipient={formerRecipientLines(st.tenantName, st.unitName, tenancy, property)} />
              )}
              {head && returnLineTooLong(head.returnLine) && (
                <NoticeBox level="warning" className="no-print" title="Rücksendeangabe zu lang" action={returnLineText(head.returnLine)} />
              )}
              {head && addressFieldWarning(head.recipient) && (
                <NoticeBox level="warning" className="no-print" title="Anschrift zu lang für das Fensterfeld" action={addressFieldWarning(head.recipient) ?? ''} />
              )}
              <PrintPages footnote={footnote} paper={!!design.paper} follow={design.follow}>
              {/* Nur im Druck, solange Fehler offen sind; deckt auch Strg+P ab (Durchsicht S2 zu #341). Ohne Anschreiben
                  steht der Vermerk schon im Kopf. */}
              {draftMark && (showLetter || !letter) && <div className="print-only draft-mark">{DRAFT_MARK}</div>}
              <div className="statement-head">
                <div className="stack tight">
                  {/* Ohne Anschreiben ist der Betreff die Überschrift der Aufstellung (Teil 2). */}
                  <h2>{subject || (data ? settlementTitle(data) : `Nebenkostenabrechnung ${label}`)}</h2>
                  {/* Druck (#415): Mieter, Mietobjekt, Wohnung, Wohnfläche, Zeitraum und Personen als Kopf der Aufstellung; den
                      Zeitraum nennt nur noch er. */}
                  {legacy ? (
                    <div className="muted">{legacyHeadLine(st, personsText(st, tenancy))}</div>
                  ) : (
                    <dl className="statement-facts">
                      {statementHeadRows(st, letter, { period: data?.period ?? { from: st.periodStart, to: st.periodEnd }, persons: personsText(st, tenancy) }).map((r) => (
                        <Fragment key={r.label}>
                          <dt>{r.label}</dt>
                          <dd>{r.value}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  )}
                  {heatingOnlyNote(st) && <p>{heatingOnlyNote(st)}</p>}
                  {recommendedDeadlineText(st) && <p className="muted no-print">{recommendedDeadlineText(st)}</p>}
                  {st.prepaymentNote && <p className="muted">{st.prepaymentNote}</p>}
                </div>
              </div>
              {!legacy && (
                <dl className="result-box">
                  {resultRows(st, paymentDays).map((r) => (
                    <Fragment key={r.label}>
                      <dt className={r.strong ? 'result-strong' : undefined}>{r.label}</dt>
                      <dd className={r.strong ? 'result-strong' : undefined}>{r.value}</dd>
                    </Fragment>
                  ))}
                </dl>
              )}

              {st.rows.length === 0 ? (
                <div className="empty">Keine Kostenpositionen für {label} erfasst.</div>
              ) : (
                <Table className="sticky-first">
                  <thead>
                    <tr>
                      <th>Kostenart</th>
                      <th className="num">{totalColumnLabel(st.rows)}</th>
                      <th>Verteilung</th>
                      <th className="num">Ihr Anteil</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <Fragment key={g.category}>
                        {g.rows.map((r) => (
                          <CalcSteps key={r.costItemId} row={r} colSpan={4} open={showSteps}>
                            {(toggle) => (
                              <tr>
                                <td>
                                  {r.category}
                                  {r.description !== r.category && <div className="muted">{r.description}</div>}
                                </td>
                                <td className="num">
                                  {fmtEuro(r.totalCents)}
                                  {totalNote(r) && <div className="muted">{totalNote(r)}</div>}
                                </td>
                                <td>
                                  {r.keyLabel}
                                  {r.basisText && <div className="muted">{r.basisText}</div>}
                                  {toggle}
                                </td>
                                <td className="num">{fmtEuro(r.shareCents)}</td>
                              </tr>
                            )}
                          </CalcSteps>
                        ))}
                        {g.rows.length > 1 && (
                          <tr className="subtotal">
                            <td>Summe {g.category}</td>
                            <td className="num">{fmtEuro(g.rows.reduce((a, r) => a + r.totalCents, 0))}</td>
                            <td />
                            <td className="num">{fmtEuro(g.rows.reduce((a, r) => a + r.shareCents, 0))}</td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>{totalLabel(st)}</td>
                      <td className="num">{fmtEuro(st.totalShareCents)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3} style={{ fontWeight: 400 }}>
                        {prepaymentLabel(st)}
                        {/* Ein Vermerk für den Vermieter, nicht für den Mieter (#142): nur am Bildschirm. */}
                        {st.prepaymentOverridden && <span className="muted no-print"> (manuell angepasst)</span>}
                        {!isClosed && <span className="no-print">
                          {' '}
                          {ppEdit?.tenancyId === st.tenancyId ? (
                            <>
                              {/* Esc verwirft, Enter speichert (#142); „Speichern“ und „Verwerfen“ wie jeder Entwurf am Feld (#346 Schritt 7, N3). */}
                              <input
                                aria-label="Gezahlte Vorauszahlung €"
                                value={ppEdit.value}
                                onChange={(e) => setPpEdit({ tenancyId: st.tenancyId, value: e.target.value })}
                                aria-invalid={ppEdit.error ? true : undefined}
                                aria-describedby={ppEdit.error ? ppErrorId : undefined}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') { e.preventDefault(); setPpEdit(null) }
                                  else if (e.key === 'Enter') { e.preventDefault(); submitPpEdit(st.tenancyId) }
                                }}
                                className="input-num"
                                autoFocus
                              />{' '}
                              <button className="btn small" onClick={() => submitPpEdit(st.tenancyId)}>Speichern</button>{' '}
                              <button className="btn small secondary" onClick={() => setPpEdit(null)}>Verwerfen</button>
                              {ppEdit.error && <FieldMessage id={ppErrorId} error={ppEdit.error} announce className="inline-message" />}
                            </>
                          ) : (
                            <>
                              <button
                                className="btn small ghost"
                                title="Tatsächlich gezahlten Betrag erfassen (z. B. bei ausgefallenen Zahlungen)"
                                onClick={() => setPpEdit({ tenancyId: st.tenancyId, value: (st.prepaymentCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) })}
                              >
                                ✎ anpassen
                              </button>
                              {st.prepaymentOverridden && (
                                <button className="btn small ghost" onClick={() => void savePpOverride(st.tenancyId, null)}>zurücksetzen</button>
                              )}
                            </>
                          )}
                        </span>}
                      </td>
                      <td className="num" style={{ fontWeight: 400 }}>− {fmtEuro(st.prepaymentCents)}</td>
                    </tr>
                    {prepaymentSplit(st).map((line) => (
                      <tr key={line.label}>
                        <td colSpan={3} className="muted">{line.label}</td>
                        <td className="num muted">{fmtEuro(line.cents)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={3}>
                        {st.balanceCents < 0 ? 'Nachzahlung zu Ihren Lasten' : st.balanceCents > 0 || legacy ? 'Guthaben zu Ihren Gunsten' : 'Ausgeglichen, weder Nachzahlung noch Guthaben'}
                      </td>
                      <td className="num">
                        {/* Neutral fett, auch die Nachzahlung: In Rot las sie sich wie eine Mahnung (#415). Vor #415
                            abgeschlossen bleibt es, wie es gedruckt wurde (Durchsicht S1). */}
                        {legacy ? (
                          <span className="saldo" style={{ color: st.balanceCents >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtEuro(Math.abs(st.balanceCents))}</span>
                        ) : (
                          <span className="saldo">{fmtEuro(Math.abs(st.balanceCents))}</span>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </Table>
              )}
              {/* Der Ausweis nach § 7 Abs. 3 CO2KostAufG (Heizung PR 6) wird mitgedruckt. */}
              {/* Heizung PR 10: der Ausweis der eigenen Heizkostenabrechnung, vor dem CO₂-Block. */}
              {(data?.heating ?? []).map((h) => (h.self ? <SelfHeatingBlock key={`self:${h.plantId}:${h.period}`} self={h.self} tenancyId={st.tenancyId} plantName={h.plantName} /> : null))}
              {/* Heizung PR 14: die Informationen nach § 6a, nur mit dem Vergleich dieses Mieters. */}
              {(data?.heating ?? []).map((h) => (h.info && (h.info.tenancyIds ?? []).includes(st.tenancyId) ? <HeatingInfoBlock key={`info:${h.plantId}:${h.period}`} info={h.info} tenancyId={st.tenancyId} plantName={h.plantName} /> : null))}
              {(data?.heating ?? []).map((h) => <Co2Block key={`${h.plantId}:${h.period}`} view={co2Block(h, st.tenancyId)} />)}
              {(data?.heating ?? []).filter((h) => showsStock(h, st)).map((h) => <StockBlock key={`stock:${h.plantId}:${h.period}`} view={stockBlock(h)} />)}
              {(data?.heating ?? []).map((h) => <FuelBlock key={`fuel:${h.plantId}:${h.period}`} view={fuelBlock(h)} />)}
              {/* Ohne Anschreiben: Ergebnis, Anpassung und Belegeinsicht mit den Texten des Anschreibens (Teil 2). */}
              {underTable.map((p) => <p key={p.block} className="statement-letter-text">{p.text}</p>)}
              {st.rows.length > 0 && (
                <>
                  {legacy && (
                    <LegacyResult st={st} landlord={landlord} adjust={settings?.printAdjustSuggestion !== false} separate={suggestionWithoutHeating(data, target, choices.length)} daysInYear={data.daysInYear} />
                  )}
                  {st.total35aCents > 0 && (legacy ? (
                    <div className="stack tight">
                      <strong>Bescheinigung nach § 35a EStG</strong>
                      <p className="muted">
                        In Ihrem Kostenanteil sind folgende Arbeitskosten für haushaltsnahe
                        Dienstleistungen/Handwerkerleistungen enthalten, die Sie ggf. steuerlich
                        geltend machen können:
                      </p>
                      <Table>
                        <tbody>
                          {st.rows.filter((r) => (r.labor35aCents ?? 0) > 0).map((r, i) => (
                            <tr key={i}>
                              <td>{r.category} — {r.description}</td>
                              <td className="num">{fmtEuro(r.labor35aCents!)}</td>
                            </tr>
                          ))}
                          <tr>
                            <td style={{ fontWeight: 700 }}>Summe §35a-Arbeitskosten (Ihr Anteil)</td>
                            <td className="num" style={{ fontWeight: 700 }}>{fmtEuro(st.total35aCents)}</td>
                          </tr>
                        </tbody>
                      </Table>
                    </div>
                  ) : (
                    // Druck (#415): eine Tabelle je Position mit Rechnungsbetrag, Lohnanteil der Rechnung und dem Anteil des
                    // Mieters daran, beide eingefroren im Anschreiben. Ein vorher eingefrorenes Anschreiben kennt sie nicht; dann
                    // nur Leistung und Ihr Anteil (Durchsicht K2). Vor #415 abgeschlossen bleibt die Liste von damals (oben).
                    (() => {
                      const labor = labor35aTable(st, letter)
                      return (
                        <div className="stack tight labor-35a">
                          <h3 id={`labor35a-${st.tenancyId}`}>Bescheinigung nach § 35a EStG</h3>
                          <p className="muted">
                            In Ihrem Kostenanteil sind folgende Arbeitskosten für haushaltsnahe Dienstleistungen und
                            Handwerkerleistungen enthalten, die Sie gegebenenfalls steuerlich geltend machen können.
                          </p>
                          <Table aria-labelledby={`labor35a-${st.tenancyId}`}>
                            <thead>
                              <tr>
                                <th>Leistung</th>
                                {labor.full && <th className="num">Gesamtbetrag</th>}
                                {labor.full && <th className="num">Lohnanteil</th>}
                                <th className="num">Ihr Anteil</th>
                              </tr>
                            </thead>
                            <tbody>
                              {labor.rows.map((r, i) => (
                                <tr key={i}>
                                  <td>{r.service}</td>
                                  {labor.full && <td className="num">{r.total}</td>}
                                  {labor.full && <td className="num">{r.labor}</td>}
                                  <td className="num">{r.share}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr>
                                <td colSpan={labor.full ? 3 : 1}>Summe Ihres Anteils an den Arbeitskosten</td>
                                <td className="num">{fmtEuro(st.total35aCents)}</td>
                              </tr>
                            </tfoot>
                          </Table>
                        </div>
                      )
                    })()
                  ))}
                </>
              )}
              {/* Belegeinsicht und beigefügte Belege stehen seit #415 im Anschreiben. */}
              {/* Vor #415 abgeschlossen wie damals; sonst nennt der Kopf der Aufstellung den Abrechnungszeitraum (Druck, #415). */}
              {legacy && <p className="muted">{costBasisText(label, calendar)}{legacyReceiptsText(attachmentCount)}</p>}
              {printAttachments && stFiles.length > 0 && (
                <div className="muted no-print">
                  Anlage beim Druck: {stFiles.map(fileLabel).join(' · ')}
                </div>
              )}
              </PrintPages>
              {/* Auch die Belegkopien tragen den Fußvermerk (Durchsicht zu PR #427, K2), in einer eigenen Hülle: Unter fremden
                  Rechnungen liegt kein Briefpapier (Durchsicht S2 zu PR #432), die Ränder bleiben. */}
              {printAttachments && stFiles.length > 0 && (
                <PrintPages footnote={footnote} paper={!!design.paper} newPage>
                  <div className="print-only attachments">
                    {stFiles.map((f, idx) => (
                      <div key={f} className="attachment">
                        <div className="attachment-caption">
                          Anlage {idx + 1} zur Nebenkostenabrechnung {data?.period.label ?? label}: {fileLabel(f)}
                        </div>
                        {(attachmentPages[f] ?? []).map((src, i) => (
                          <img key={i} src={src} alt={`${fileLabel(f)} — Seite ${i + 1}`} />
                        ))}
                      </div>
                    ))}
                  </div>
                </PrintPages>
              )}
            </div>
            )
          })}

          {/* Zone „Kontrolle“: Kontrollansicht (#321), Vermieteranteil und Rechtsstand, je ein Abschnitt zum Aufklappen. */}
          {!preview && (!empty || data.landlord.rows.length > 0) && (
            <Card title="Kontrolle" className="no-print">
              <ControlView data={data} embedded />
              {data.landlord.rows.length > 0 && (
                <details>
                  <summary>{`Vermieteranteil (nicht umgelegt) · ${fmtEuro(data.landlord.totalCents)}`}</summary>
                  <Table className="sticky-first" aria-label="Vermieteranteil (nicht umgelegt)">
                    <thead>
                      <tr>
                        <th>Kostenart</th>
                        <th className="num">Gesamtkosten</th>
                        <th>Grund</th>
                        <th className="num">Ihr Anteil</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.landlord.rows.map((r, i) => (
                        <tr key={i}>
                          <td>{r.category}<div className="muted">{r.description}</div></td>
                          <td className="num">{fmtEuro(r.totalCents)}</td>
                          <td className="muted">{landlordReasonText(r)}</td>
                          <td className="num">{fmtEuro(r.shareCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3}>Summe Vermieteranteil</td>
                        <td className="num">{fmtEuro(data.landlord.totalCents)}</td>
                      </tr>
                      {data.selfUsedShareCents !== 0 && (
                        <tr>
                          <td colSpan={3} className="muted">davon <Term id="ownShare">Eigenanteil</Term> selbstgenutzter Wohnungen (steuerlich privat)</td>
                          <td className="num muted">{fmtEuro(data.selfUsedShareCents)}</td>
                        </tr>
                      )}
                    </tfoot>
                  </Table>
                </details>
              )}
              {!empty && (() => {
                const basis = legalBasisLines(data.legalBasis)
                return (
                  <details className="legal-basis">
                    <summary>Angewandte Regeln und Rechtswerte · {basis.head}</summary>
                    {basis.rules.length > 0 ? (
                      <ul>{basis.rules.map((r) => <li key={r}>{r}</li>)}</ul>
                    ) : (
                      data.legalBasis && <p>Für dieses Jahr wendet Mietfuchs keine besondere Rechtsregel an.</p>
                    )}
                    {basis.values.length > 0 && (
                      <>
                        <p>Angewandte Rechtswerte:</p>
                        <ul>{basis.values.map((v) => <li key={v}>{v}</li>)}</ul>
                      </>
                    )}
                    {basis.valuesNote && <p>{basis.valuesNote}</p>}
                  </details>
                )
              })()}
            </Card>
          )}
        </>
      )}
      {printDrawer && data && (
        <PrintDrawer
          key={printSaves}
          scope={printDrawer.scope}
          onScope={(scope) => setPrintDrawer({ scope })}
          tenants={data.statements.map((st) => ({ id: st.tenancyId, label: `${st.tenantName} (${st.unitName})` }))}
          withLetter={withLetter}
          onLetter={setLetterChoice}
          letterNote={letterChoice !== null && letterChoice !== letterDefault ? LETTER_CHOICE_NOTE : null}
          draft={printDraft}
          onSaveDraft={savePrintInDrawer}
          draftNote={PRINT_DRAFT_NOTE}
          attachmentsLoading={attachmentsLoading}
          paper={!!design.paper}
          blocked={printBlocked}
          warnings={printWarnings.length > 0 ? (
            <div className="notice-list">
              {printWarnings.map((n, i) => <CalcNotice key={i} notice={n} />)}
            </div>
          ) : null}
          busy={printBusy}
          onPrint={printNow}
          onClose={cancelPrint}
        />
      )}
      {designs && propertyId && (
        <LetterDesignDrawer
          open={designEdit}
          level="property"
          title={`Logo und Briefpapier für „${property?.name || 'dieses Objekt'}“`}
          stored={designs.property}
          installation={designs.installation}
          onClose={() => setDesignEdit(false)}
          onSave={async (payload) => {
            await sendLetterDesign(`/api/properties/${propertyId}/letter-design`, payload)
            setDesignEdit(false)
            await load()
            toast('Logo und Briefpapier gespeichert.')
          }}
        />
      )}
      {(() => {
        if (!letterEdit || !templates || !data) return null
        // Druck (#415): Ist beim Mietverhältnis eine Anrede eingetragen? Sonst sagt das Fenster, wo sie hingehört.
        const ownSalutation = (id: string) => (tenancies.find((t) => t.id === id)?.letterSalutation ?? '').trim() !== ''
        if (letterEdit.kind === 'property') {
          const first = data.statements[0]
          return (
            <LetterDrawer
              open
              level="property"
              title={`Anschreiben für „${property?.name || 'dieses Objekt'}“`}
              intro="Gilt für alle Mieter dieses Objekts, solange Sie für einen Mieter nichts anderes festlegen. Ohne eigenen Text gilt die Vorlage aus den Einstellungen."
              base={mergeLetterTexts(templates.installation)}
              own={templates.property ?? {}}
              printLetter={{ value: templates.propertyPrintLetter ?? null, base: templates.printLetter ?? true }}
              values={first ? letterOf(data, first, { settings, property, tenancies }).values : {}}
              salutations={{ names: data.statements.filter((x) => !ownSalutation(x.tenancyId)).map((x) => x.tenantName), total: data.statements.length }}
              onClose={() => setLetterEdit(null)}
              onSave={saveLetter}
            />
          )
        }
        const st: Statement | undefined = data.statements.find((x) => x.tenancyId === letterEdit.tenancyId)
        if (!st) return null
        const letter = letterOf(data, st, { settings, property, tenancies })
        const own = tenancyLetters[st.tenancyId]
        return (
          <LetterDrawer
            open
            key={st.tenancyId}
            level="tenancy"
            title={`Anschreiben an ${st.tenantName}`}
            intro={`Gilt nur für diese Abrechnung von ${st.tenantName}. Mit dem Abschluss friert der Text ein; eine spätere Änderung der Vorlage ändert dann nicht mehr, was zugestellt wurde.`}
            base={mergeLetterTexts(templates.installation, templates.property)}
            own={own?.texts ?? {}}
            values={{ ...letter.values, Datum: fmtDate(data.closed?.sentAt ?? localToday()) }}
            adjust={{ mode: own?.adjustment?.mode ?? letter.adjustment.mode, cents: own?.adjustment?.cents ?? null, suggestedCents: st.suggestedMonthlyCents, own: !!own?.adjustment, defaultMode: templates.adjustDefault, from: own?.adjustment?.from ?? null, defaultFrom: adjustFromFor(localToday(), data.period.to) }}
            shown={letterParagraphs(letter, st.balanceCents, { date: localToday(), attachments: 0 }).map((p) => p.block)}
            salutations={{
              names: ownSalutation(st.tenancyId) ? [] : [st.tenantName],
              total: 1,
              fix: onNavigate ? { label: 'Hier beheben → Stammdaten', onClick: () => { setLetterEdit(null); onNavigate('stammdaten', { kind: 'tenancy', id: st.tenancyId }) } } : null,
            }}
            onClose={() => setLetterEdit(null)}
            onSave={saveLetter}
          />
        )
      })()}
    </>
  )
}
