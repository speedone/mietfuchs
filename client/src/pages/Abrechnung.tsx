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
import { useConfirmDiscard, useDraft } from '../useDraft'
import DraftActions from '../components/DraftActions'
import { FieldMessage } from '../components/Field'
import { effectiveLandlord, footerLine, letterhead, printsFormerAddress, recipientLines, returnLine } from '../landlord'
import { localToday } from '../periodForm'
import { landlordReasonText } from '../landlordReasons'
import { notSettledText } from '../tenancyModel'
import { deviationView } from '../deviation'
import { deadlineView, historyView, type HistoryEntry } from '../settlementHistory'
import { costBasisText, personsText } from '../statementView'
import { legalBasisLines, noticesOf, noticeTarget, type NoticeTab } from '../notices'
import { CalcNotice, NoticeBox } from '../components/Notice'
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
import { closeErrorsQuestion, closeMessage, completenessQuestion, DRAFT_MARK, printQuestion, sameErrors, showsDraftMark, type ErrorsQuestion } from '../despiteErrors'
import { co2Block } from '../co2View'
import { calendarPeriod } from '../../../shared/period.ts'
import { mergeLetterTexts, printsLetter, renderLetterText, statementBlocks } from '../../../shared/letter.ts'
import Card from '../components/Card'
import ControlView from '../components/ControlView'
import Letter, { PrintPages, StatementHead } from '../components/Letter'
import { LegacyHead, legacyHeadLine, legacyReceiptsText, LegacyResult } from '../components/LegacyStatement'
import { exceedsOnePage } from '../../../shared/letter.ts'
import { suggestionWithoutHeating } from '../heatingSettlementView'
import LetterDrawer, { type LetterSave } from '../components/LetterDrawer'
import { asTemplates, letterOf, letterParagraphs, RETURN_LINE_MAX, resultRows, returnLineTooLong } from '../letterView'

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
  useEffect(() => { setTarget(null) }, [param, propertyId])
  // Das Ziel aus dem Cockpit, sobald die Liste da ist und es darin steht (E45).
  useFocusTarget(focus, 'heatingSettlement', heatingList, (h) => `${h.plantId}|${h.period.key}`, (h) => setTarget({ plantId: h.plantId, period: h.period.key }), onFocusDone)

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
    return q ? askDespiteErrors(q) : true
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
    await api(withProperty(paths.close, propertyId), { method: 'PUT', body: JSON.stringify({ sentAt: value || null }) })
    await load()
  }
  const isClosed = !!data?.closed
  // Der Reiter zwischen Betriebs- und Heizkostenabrechnung wechselt den scope des Versanddatums; ein
  // ungespeichertes Datum fragt deshalb vorher nach (Durchsicht zu #333).
  const confirmDiscard = useConfirmDiscard()
  async function switchTarget(next: typeof target) {
    if (next?.plantId === target?.plantId && next?.period === target?.period) return
    if (await confirmDiscard([sentAt])) setTarget(next)
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
  useEffect(() => {
    if (!printId) return
    document.body.classList.add('print-one')
    // Der Seitentitel wird zum Dateinamen beim „Als PDF speichern“. Aufgeräumt wird erst bei der
    // nächsten Bedienung, nicht schon bei `afterprint` (Safari, siehe printJob.ts).
    const { data, label } = printSource.current
    const st = data?.statements.find((s) => s.tenancyId === printId)
    const job = startPrint({
      title: st ? `${data ? settlementTitle(data) : `Nebenkostenabrechnung ${label}`} ${st.unitName} ${st.tenantName}` : document.title,
      // „Seite x von y“ nur beim Druck dieser einen Abrechnung (#415, Teil 2).
      pageNumbers: true,
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

  const distributed = data ? data.totalCostsCents - data.landlord.totalCents : 0
  // Ein Zeitraum ohne Abrechnung, Pauschale und Kosten: kein Entwurf, keine Kennzahlen, nur der erste Schritt (N12).
  // Abgeschlossen bleibt die Karte zum Wiederöffnen (Durchsicht K1).
  const empty = data ? emptySettlement(data) && !data.closed : false
  const start = startStep(units, tenancies, label, calendar)

  // §556 Abs. 3 BGB: Die Abrechnung muss dem Mieter binnen 12 Monaten nach Ende des
  // Abrechnungszeitraums zugehen, sonst sind Nachforderungen ausgeschlossen. Nach dem
  // Wiederöffnen zählt der frühere Versand weiter (#142, siehe deadlineView). Bezeichnung und Frist
  // vom Server (#208).
  const deadlineInfo = data ? deadlineView(data.period.label, data.deadline, data.closed?.sentAt ?? null, history, new Date()) : null

  return (
    <>
      <div className="no-print">
        <PageHeader title="Abrechnung" subtitle={'Die fertige Nebenkostenabrechnung pro Mieter — als PDF speichern über „Drucken“.'} />
      </div>
      {error && <NoticeBox level="error" action={error} />}

      {/* Im leeren Zeitraum gibt es nichts zu drucken (N12) */}
      {!(empty && choices.length === 0) && (
      <div className="card no-print">
        <div className="row">
          {/* Teil 2: nur für diesen Druck; die Vorgabe steht in der Vorlage des Objekts bzw. in den Einstellungen. */}
          <label className="field checkline" title="Ein Brief an den Mieter als erste Seite; ohne ihn beginnt die Aufstellung mit Anschrift, Datum und Betreff">
            <span>
              <input type="checkbox" checked={withLetter} onChange={(e) => setLetterChoice(e.target.checked)} />{' '}
              Anschreiben mitdrucken
            </span>
          </label>
          <label className="field checkline" title="Marken am linken Rand des Anschreibens zum Falten für einen Fensterumschlag (DIN 5008) und zum Lochen">
            <span>
              <input
                type="checkbox"
                checked={printFoldMarks}
                onChange={(e) => printDraft.set({ ...printDraft.value, printFoldMarks: e.target.checked })}
              />{' '}
              Falz- und Lochmarken drucken
            </span>
          </label>
          <label className="field checkline" title="Kopien der hochgeladenen Beleg-PDFs als Anlage hinter jeder Abrechnung mit ausdrucken">
            <span>
              <input
                type="checkbox"
                checked={printAttachments}
                onChange={(e) => printDraft.set({ ...printDraft.value, printAttachments: e.target.checked })}
              />{' '}
              Belegkopien als Anlage mitdrucken
              {printAttachments && attachmentsLoading && <span className="muted"> (werden vorbereitet …)</span>}
            </span>
          </label>
          <label className="field checkline" title="Vermieter, Anschrift, Kontakt und IBAN unten auf jeder Seite (Anschrift und Kontakt unter „Einstellungen“ bzw. beim Objekt)">
            <span>
              <input
                type="checkbox"
                checked={printFooter}
                onChange={(e) => printDraft.set({ ...printDraft.value, printFooter: e.target.checked })}
              />{' '}
              Fußzeile mit Kontakt und Bank
            </span>
          </label>
          <DraftActions draft={printDraft} onSave={savePrint} what="Druckeinstellungen" />
          {printDraft.dirty && <span className="muted">{PRINT_DRAFT_NOTE}</span>}
          {letterChoice !== null && letterChoice !== letterDefault && <span className="muted">{LETTER_CHOICE_NOTE}</span>}
        </div>
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
        {data?.separateHeating && data.separateHeating.length > 0 && target === null && (
          <div className="info no-print">{`Die Heizkosten ${data.separateHeating.map((h) => h.period.label).join(', ')} rechnen Sie getrennt ab; sie stehen nicht in dieser Abrechnung.`}</div>
        )}
      </div>
      )}

      {data && !empty && data.statements.length > 0 && (
        <Card title="Anschreiben" className="no-print" aside={propertyId && templates ? <button className="btn secondary" onClick={() => setLetterEdit({ kind: 'property' })}>Vorlage für dieses Objekt bearbeiten</button> : undefined}>
          <p className="muted m-0">
            {withLetter ? 'Jede Abrechnung beginnt mit einem Brief an den Mieter.' : 'Ohne Anschreiben beginnt die Aufstellung mit Anschrift, Datum und Betreff; Ergebnis, Anpassung und Belegeinsicht stehen unter der Tabelle.'} Die Vorlage für alle Objekte steht unter
            „Einstellungen“; hier weichen Sie für dieses Objekt ab, bei einem Mieter mit „Anschreiben bearbeiten“.
            {isClosed ? ' Diese Abrechnung ist abgeschlossen; ihr Anschreiben ist eingefroren.' : ''}
          </p>
        </Card>
      )}

      {data && !empty && (
        <div className="card no-print">
          <div className="row center">
            {isClosed ? (
              <>
                <div className="grow">
                  <span className="badge green">abgeschlossen</span>{' '}
                  <span className="muted">
                    am {fmtDate(data.closed!.closedAt.slice(0, 10))} eingefroren — Änderungen an Kosten/Stammdaten wirken sich nicht mehr aus.
                  </span>
                </div>
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
                {/* Mit Abstand zu „Speichern“ des Versanddatums, rot beim Überfahren und „…“, weil eine Rückfrage folgt (#346 Schritt 7, M19). */}
                <button className="btn ghost danger-ghost ml-auto" onClick={() => void reopenSettlement()}>Wieder öffnen …</button>
              </>
            ) : (
              <>
                <div className="grow">
                  <span className="badge gray">Entwurf</span>{' '}
                  <span className="muted">Die Abrechnung wird laufend neu berechnet. Nach dem Versand abschließen, damit sich der Stand nicht mehr ändert.</span>
                </div>
                <button className="btn" disabled={!data || data.totalCostsCents === 0} onClick={() => void closeSettlement()}>
                  🔒 {docLabel} abschließen
                </button>
                {data.totalCostsCents === 0 && <span className="muted">Noch keine Kosten erfasst, nichts abzuschließen.</span>}
              </>
            )}
          </div>
        </div>
      )}

      {data && deadlineInfo && data.totalCostsCents > 0 && (
        <div className={`${deadlineInfo.level} no-print`}>{deadlineInfo.text}</div>
      )}
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
      {data?.closed && (() => {
        // Abgeschlossenes Jahr gegen die heutige Berechnung (#56): erklären, nicht drängen.
        const view = deviationView(data.deviation)
        if (!view) return null
        return (
          <NoticeBox level="warning" title={view.title} className="no-print">
            <div>{view.intro}</div>
            {view.lines.length > 0 && <ul className="deviation-list">{view.lines.map((l) => <li key={l.id}>{l.text}</li>)}</ul>}
          </NoticeBox>
        )
      })()}
      {/* Hinweise der Berechnung (#346, Schritt 10, M8): Stufe und Titel, ein Satz „was tun“, „Hier beheben →“
          und der Rest unter „Mehr dazu“ (CalcNotice). Der Wortlaut bleibt unverändert; ein Hinweis ohne Titel
          (abgeschlossen vor #112) trägt nur die Stufe als Kopf. */}
      {data && noticesOf(data).length > 0 && (
        <div className="notice-list no-print">
          {noticesOf(data).map((n, i) => {
            const target = noticeTarget(n.subject)
            return <CalcNotice key={i} notice={n} fix={target && onNavigate ? { label: target.label, onClick: () => onNavigate(target.tab, target.focus) } : null} />
          })}
        </div>
      )}
      {data && !empty && (() => {
        const basis = legalBasisLines(data.legalBasis)
        return (
          <details className="legal-basis no-print">
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

      {data && (
        <>
          {!empty && (
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
          {data.statements.length === 0 && (data.notSettled ?? []).length === 0 && (
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

          {/* Mietverhältnisse mit Pauschale oder Inklusivmiete bekommen keine Abrechnung (#93);
              sie werden genannt statt still zu fehlen. */}
          {(data.notSettled ?? []).length > 0 && (
            <Card title="Ohne Abrechnung" className="no-print">
              <p className="muted">
                Für diese Mietverhältnisse ist eine Pauschale oder Inklusivmiete vereinbart. Ihr Anteil an den Kosten
                bleibt beim Vermieter und zählt als Werbungskosten.
              </p>
              <ul>
                {(data.notSettled ?? []).map((n) => <li key={n.tenancyId}>{notSettledText(n)}</li>)}
              </ul>
            </Card>
          )}

          {data.statements.map((st) => {
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
            const footerText = printFooter && letter ? (letter.sender ? (letter.sender.footer ?? '') : (landlord ? footerLine(landlord) : '')) || null : null
            const head = letter ? {
              sender: letter.sender?.name ?? landlord?.landlordName ?? '',
              senderAddress: letter.sender ? (letter.sender.address ?? '') : (landlord?.landlordAddress ?? ''),
              returnLine: letter.sender?.returnLine ?? (landlord ? returnLine(landlord, property) : letterhead('', property)),
              recipient: letter.recipient ?? recipientLines(st.tenantName, st.unitName, tenancy, property),
              date: fmtDate(letterDate),
              foldMarks: printFoldMarks,
              draftMark: draftMark ? DRAFT_MARK : null,
            } : null
            const subject = letter && !showLetter ? renderLetterText(letter.texts.subject, print) : ''
            const underTable = letter && !showLetter ? statementBlocks(letter, st.balanceCents, attachmentCount).map((b) => ({ block: b, text: renderLetterText(letter.texts[b], print) })) : []
            const footnote = letter ? (
              <>
                <div>{[letter.values.Name, letter.values.Wohnung, letter.values.Abrechnung, letter.values.Zeitraum].filter((x) => x).join(' · ')}</div>
                {footerText && <div>{footerText}</div>}
              </>
            ) : null
            return (
            <div key={st.tenancyId} className={`card statement ${printId === st.tenancyId ? 'print-target' : ''}`}>
              {printsFormerAddress(tenancies.find((t) => t.id === st.tenancyId), localToday()) && (
                <NoticeBox
                  level="warning"
                  className="no-print"
                  title="Anschrift nach dem Auszug fehlt"
                  action={`${st.tenantName} ist ausgezogen; gedruckt würde die Anschrift der Wohnung ${st.unitName}. Tragen Sie beim Mietverhältnis eine Anschrift für den Schriftverkehr ein: Die Frist nach § 556 Abs. 3 BGB läuft auch gegenüber dem Vormieter.`}
                  fix={onNavigate ? { label: 'Hier beheben → Stammdaten', onClick: () => onNavigate('stammdaten', { kind: 'tenancy', id: st.tenancyId }) } : null}
                />
              )}
              {/* Seite 1: das Anschreiben (#415). Datum ist der Versand, sonst der Tag des Drucks. Absender und Anschrift
                  aus dem Anschreiben, abgeschlossen also eingefroren (Durchsicht S2). */}
              {showLetter && head ? (
                <>
                  <Letter {...head} paragraphs={paragraphs} footer={footerText} />
                  {exceedsOnePage(paragraphs.map((p) => p.text)) && (
                    <NoticeBox level="warning" className="no-print" title="Anschreiben länger als eine Seite" action="Das Anschreiben ist voraussichtlich länger als eine Seite und druckt auf der nächsten weiter. Soll es auf eine Seite passen, kürzen Sie die Texte über „Anschreiben bearbeiten“." />
                  )}
                </>
              ) : head ? (
                <StatementHead {...head} />
              ) : (
                <LegacyHead sender={letterhead(landlord?.landlordName, property)} date={letterDate} recipient={recipientLines(st.tenantName, st.unitName, tenancy, property)} />
              )}
              {head && returnLineTooLong(head.returnLine) && (
                <NoticeBox level="warning" className="no-print" title="Rücksendeangabe zu lang" action={`Die Rücksendeangabe über der Anschrift hat ${head.returnLine.trim().length} Zeichen; im Fensterfeld passen rund ${RETURN_LINE_MAX} in zwei kleine Zeilen, der Rest würde abgeschnitten. Kürzen Sie den Namen oder die Anschrift des Vermieters (Einstellungen bzw. beim Objekt).`} />
              )}
              <PrintPages footnote={footnote}>
              {/* Nur im Druck, solange Fehler offen sind; deckt auch Strg+P ab (Durchsicht S2 zu #341). Ohne Anschreiben
                  steht der Vermerk schon im Kopf. */}
              {draftMark && (showLetter || !letter) && <div className="print-only draft-mark">{DRAFT_MARK}</div>}
              <div className="statement-head">
                <div className="stack tight">
                  {/* Ohne Anschreiben ist der Betreff die Überschrift der Aufstellung (Teil 2). */}
                  <h2>{subject || (data ? settlementTitle(data) : `Nebenkostenabrechnung ${label}`)}</h2>
                  {/* Name und Wohnung stehen im Druck schon in der Anschrift, Zeitraum und Tage im Ergebniskasten (#415). */}
                  {legacy ? (
                    <div className="muted">{legacyHeadLine(st, personsText(st, tenancy))}</div>
                  ) : (
                    <div className="muted">
                      <span className="no-print">{st.tenantName} · {st.unitName} · </span>
                      {personsText(st, tenancy)}
                    </div>
                  )}
                  {heatingOnlyNote(st) && <p>{heatingOnlyNote(st)}</p>}
                  {recommendedDeadlineText(st) && <p className="muted no-print">{recommendedDeadlineText(st)}</p>}
                  {st.prepaymentNote && <p className="muted">{st.prepaymentNote}</p>}
                </div>
                <div className="row no-print">
                <button
                  className="btn secondary"
                  disabled={isClosed || !templates}
                  aria-describedby={isClosed ? lockedId : undefined}
                  onClick={() => setLetterEdit({ kind: 'tenancy', tenancyId: st.tenancyId })}
                >
                  Anschreiben bearbeiten
                </button>
                {/* Der Grund steht sichtbar daneben, wie bei anderen gesperrten Knöpfen (Durchsicht K10). */}
                {isClosed && <span id={lockedId} className="muted">{legacy ? 'Vor dem Anschreiben abgeschlossen; gedruckt wird wie bisher.' : 'Abgeschlossen; das Anschreiben ist eingefroren.'}</span>}
                <button
                  className="btn secondary"
                  disabled={printAttachments && !attachmentsReady}
                  title={printAttachments && !attachmentsReady ? 'Belegkopien werden noch vorbereitet …' : undefined}
                  onClick={() => { void goOnPrinting().then((ok) => { if (ok) setPrintId(st.tenancyId) }) }}
                >
                  🖨 Drucken / PDF
                </button>
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
                          <CalcSteps key={r.costItemId} row={r} colSpan={4}>
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
                  {st.total35aCents > 0 && (
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
                  )}
                </>
              )}
              {/* Belegeinsicht und beigefügte Belege stehen seit #415 im Anschreiben. */}
              <p className="muted">{costBasisText(label, calendar)}{legacy ? legacyReceiptsText(attachmentCount) : ''}</p>
              {/* Auch die Belegkopien tragen den Fußvermerk (Durchsicht zu PR #427, K2). */}
              {printAttachments && stFiles.length > 0 && (
                <>
                  <div className="muted no-print">
                    Anlage beim Druck: {stFiles.map(fileLabel).join(' · ')}
                  </div>
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
                </>
              )}
              </PrintPages>
            </div>
            )
          })}

          <ControlView data={data} />

          {data.landlord.rows.length > 0 && (
            <Card title="Vermieteranteil (nicht umgelegt)" className="no-print">
              <Table className="sticky-first">
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
            </Card>
          )}
        </>
      )}
      {(() => {
        if (!letterEdit || !templates || !data) return null
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
            adjust={{ mode: own?.adjustment?.mode ?? letter.adjustment.mode, cents: own?.adjustment?.cents ?? null, suggestedCents: st.suggestedMonthlyCents, own: !!own?.adjustment, defaultMode: templates.adjustDefault }}
            shown={letterParagraphs(letter, st.balanceCents, { date: localToday(), attachments: 0 }).map((p) => p.block)}
            onClose={() => setLetterEdit(null)}
            onSave={saveLetter}
          />
        )
      })()}
    </>
  )
}
