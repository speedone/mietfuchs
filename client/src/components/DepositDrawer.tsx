// Das Seitenfenster „Kaution“ eines Mietverhältnisses (#228): Stand in einem Satz, die Kautionsbuchungen und das
// Formular für eine neue oder, nach „Ändern“ an einer Zeile, für diese. Logik in depositForm.ts und shared/deposit.ts;
// gespeichert wird je Buchung über /api/deposit-entries, der Aufrufer lädt danach neu (`onChanged`).
import { useEffect, useRef, useState } from 'react'
import { depositState } from '../../../shared/deposit.ts'
import { api, errorText, fmtDate, fmtEuro } from '../api'
import {
  DEPOSIT_KIND_OPTIONS, DEPOSIT_PURPOSE_OPTIONS, NO_MONEY_FORM_TEXT, depositEntryBody, depositFormOf, depositKindText, depositPurposeHint, depositStateText, emptyDepositForm, formWithoutMoney,
  holdBody, holdFormOf, rentBeyondOpen, signedCents, withKind, type DepositField, type DepositHoldField, appliedDuringTenancy, APPLIED_DURING_TENANCY_TEXT } from '../depositForm'
import { DEPOSIT_SENDER_MISSING_TEXT, depositLetterView, depositSenderMissing } from '../depositLetter'
import { depositSettlement } from '../depositSettlement'
import { effectiveLandlord } from '../landlord'
import { asLetterDesigns, browserLinesNote, canPagePaper, logoPrintNote, pageEdges, printDesign, type LogoSpace } from '../letterDesignView'
import { withProperty } from '../property'
import { PAPER_BROWSER_NOTE } from '../rentIncreaseLetterForm'
import { NoticeBox } from './Notice'
import { localToday } from '../periodForm'
import type { DepositEntry, DepositStatementInfo, Property, Settings, Tenancy, Unit } from '../types'
import type { DepositFormState } from '../depositForm'
import { useSaving } from '../useSaving'
import Drawer from './Drawer'
import { ErrorSummary, useFormError } from './ErrorSummary'
import { useConfirm, useToast } from './feedback'
import Field from './Field'
import Table from './Table'
import { DepositLetterPrint, SettlementView } from './DepositLetter'

// Eine gesetzliche Frist für die Abrechnung der Kaution gibt es nicht; der BGH verlangt eine angemessene, nicht allgemein
// bestimmbare (Urteil vom 24.07.2019, VIII ZR 141/17). Entscheidung des Betreibers vom 13.11.2026: keine Zahl nennen.
const DEPOSIT_DEADLINE_TEXT = 'Rechnen Sie die Kaution in angemessener Frist ab; eine feste Frist gibt es nicht, sie hängt vom Einzelfall ab (BGH, Urteil vom 24.07.2019, VIII ZR 141/17).'

type LandlordFields = 'landlordName' | 'iban' | 'paymentDeadlineDays' | 'landlordAddress' | 'landlordContact'

export default function DepositDrawer({ tenancy, entries, info, unit, property = null, settings = null, onChanged, onClose }: {
  tenancy: Tenancy
  entries: DepositEntry[]
  // Für den Brief der Aufstellung: Wohnung und Objekt im Betreff, der Absender aus Objekt und Einstellungen.
  unit?: Pick<Unit, 'name'>
  property?: Pick<Property, 'id' | 'name' | 'address' | LandlordFields> | null
  settings?: Pick<Settings, LandlordFields> | null
  // Die letzte Abrechnung und was aussteht, für die Aufstellung zum Auszug (GET /api/deposit-entries/statements).
  info?: DepositStatementInfo
  // Nach jeder gespeicherten Änderung, auch am Einbehalt (der am Mietverhältnis steht): Der Aufrufer lädt neu.
  onChanged: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState(() => emptyDepositForm(localToday()))
  // Der Stand, mit dem das Formular zuletzt geladen wurde (leer, nach dem Anlegen mit stehendem Datum, oder die Buchung
  // nach „Ändern“). Weicht `form` davon ab, ist etwas eingegeben (Durchsicht W3).
  const [formBase, setFormBase] = useState(form)
  // Die Buchung, die das Formular gerade ändert; `null` heißt eine neue.
  const [editing, setEditing] = useState<DepositEntry | null>(null)
  // Nach dem Anlegen baut sich das Fenster neu auf (Durchsicht G1): Das stehen gebliebene Datum ist dann der neue
  // Ausgangsstand, und „Schließen“ fragt nicht nach Änderungen, die keine sind.
  const [round, setRound] = useState(0)
  const errors = useFormError<DepositField>()
  const saving = useSaving()
  const toast = useToast()
  const confirm = useConfirm()
  const state = depositState(tenancy, entries)
  const [hold, setHold] = useState(() => holdFormOf(tenancy))
  const holdErrors = useFormError<DepositHoldField>()
  // Strg+S speichert, woran man gerade schreibt: im Einbehalt ihn, sonst die neue Buchung (Durchsicht G1).
  const holdSection = useRef<HTMLElement>(null)
  const settlement = depositSettlement(tenancy, entries, info, localToday())
  const holdShown = settlement !== null && (settlement.balanceCents > 0 || tenancy.depositHoldCents !== undefined || tenancy.depositHoldNote !== undefined)
  const [printing, setPrinting] = useState(false)
  // Gedruckt wird ein Brief (DepositLetter.tsx, Text in depositLetter.ts). Ohne Namen des Vermieters warnt die Aufstellung
  // nur, und nicht, wenn ein Briefpapier den Absender trägt. Das fragt das Fenster beim Öffnen (wie das der Mieterhöhung);
  // bis zur Antwort gilt das Briefpapier als vorhanden, damit die Warnung nicht kurz aufblinkt. Es zählt, was dieser
  // Browser druckt: Ohne Ränder je Druckseite (`canPagePaper`, etwa Safari) druckt der Brief wie ohne Briefpapier, und
  // das Fenster sagt es (`paperSkipped`).
  const [paper, setPaper] = useState<boolean | null>(null)
  const [paperSkipped, setPaperSkipped] = useState(false)
  const linesNote = browserLinesNote(pageEdges())
  // #691: Logo auf Briefpapier ohne oder mit wenig Platz, gesagt beim Drucken (`logoPrintNote`)
  const [logoSpace, setLogoSpace] = useState<LogoSpace>(null)
  const logoNote = logoPrintNote(logoSpace)
  const propertyId = property?.id
  useEffect(() => {
    let alive = true
    api<unknown>(withProperty('/api/letter-design', propertyId))
      .then((d) => {
        if (!alive) return
        const planned = printDesign(asLetterDesigns(d), { legacy: false, pagedPaper: canPagePaper() })
        setPaper(planned.paper !== null)
        setPaperSkipped(planned.paperSkipped)
        setLogoSpace(planned.logoSpace)
      })
      .catch(() => { if (alive) setPaper(false) })
    return () => { alive = false }
  }, [propertyId])
  const letter = settlement && tenancy.end !== null && depositLetterView({
    tenancy, end: tenancy.end, unitName: unit?.name ?? '', property, settlement, today: localToday(),
    landlord: effectiveLandlord(property, settings ?? { landlordName: '', iban: '', paymentDeadlineDays: 30, landlordAddress: '', landlordContact: '' }),
  })

  async function saveHold() {
    const result = holdBody(hold)
    if ('problems' in result) {
      holdErrors.report(result.problems)
      return
    }
    try {
      await api(withProperty(`/api/tenancies/${tenancy.id}`, propertyId), { method: 'PUT', body: JSON.stringify(result.body) })
      holdErrors.set('')
      toast('Einbehalt gespeichert.')
      // Wie nach dem Anlegen: Der gespeicherte Stand ist der neue Ausgangsstand, „Schließen“ fragt nicht nach. Nicht, wenn
      // im Formular einer Buchung schon etwas steht (Abschlussdurchsicht G5).
      if (editing === null && form.amount.trim() === '' && form.note.trim() === '' && form.kind === 'received') setRound((r) => r + 1)
      onChanged()
    } catch (e) {
      holdErrors.show(errorText(e))
    }
  }
  // Angezeigt nach Datum, am selben Tag in Einfügereihenfolge: Eine nachgetragene alte Rate steht an ihrem Platz.
  const shown = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  // Anlegen oder, nach „Ändern“, Speichern der Buchung im Formular. Vorher zwei Rückfragen: ein Datum nach heute
  // (meist ein Tippfehler im Jahr) und eine Verrechnung mit Miete über das hinaus, was laut Mietkonto offen ist.
  async function submit() {
    const result = depositEntryBody(form, tenancy.id)
    if ('problems' in result) {
      errors.report(result.problems)
      return
    }
    const verb = editing ? 'Speichern' : 'Anlegen'
    if (result.body.date > localToday()) {
      const ok = await confirm({
        title: 'Datum in der Zukunft?',
        message: `Die Buchung trägt den ${fmtDate(result.body.date)}, einen Tag nach heute oder später. Der Stand der Kaution zählt sie trotzdem gleich mit.`,
        confirmLabel: verb,
      })
      if (!ok) return
    }
    if (appliedDuringTenancy(result.body, tenancy.end, editing)) {
      const ok = await confirm({ title: 'Verrechnen, solange das Mietverhältnis läuft?', message: APPLIED_DURING_TENANCY_TEXT, confirmLabel: 'Trotzdem verrechnen' })
      if (!ok) return
    }
    const beyond = rentBeyondOpen(result.body, info?.openRentCents, editing)
    if (beyond) {
      const ok = await confirm({
        title: 'Mehr als der Mietrückstand?',
        message: `Laut Mietkonto sind heute ${fmtEuro(beyond.openCents)} offen. Die übrigen ${fmtEuro(beyond.beyondCents)} stehen im Mietkonto dann als Überzahlung und zählen in der Steuer als Mieteinnahme.`,
        confirmLabel: 'Trotzdem verrechnen',
      })
      if (!ok) return
    }
    try {
      if (editing) await api(withProperty(`/api/deposit-entries/${editing.id}`, propertyId), { method: 'PUT', body: JSON.stringify(result.body) })
      else await api(withProperty('/api/deposit-entries', propertyId), { method: 'POST', body: JSON.stringify(result.body) })
      // Das Fenster bleibt offen: Raten und Zinsen kommen oft in einem Zug. Das Datum bleibt nach dem Anlegen stehen.
      // Neu aufbauen nur, wenn der Einbehalt nichts Ungespeichertes trägt; sonst ginge er beim Schließen ohne Rückfrage
      // verloren (Abschlussdurchsicht G5, in `load`).
      load({ ...emptyDepositForm(localToday()), date: editing ? localToday() : form.date }, null)
      toast(editing ? 'Kautionsbuchung gespeichert.' : 'Kautionsbuchung angelegt.')
      onChanged()
    } catch (e) {
      errors.show(errorText(e))
    }
  }

  // Das Formular neu laden. Trägt der Einbehalt nichts Ungespeichertes, baut sich das Fenster neu auf: Das Laden allein
  // ist keine Änderung, „Schließen“ fragt dann nicht (Durchsicht W2).
  function load(next: DepositFormState, entry: DepositEntry | null) {
    setEditing(entry)
    setForm(next)
    setFormBase(next)
    errors.set('')
    const savedHold = holdFormOf(tenancy)
    if (hold.amount === savedHold.amount && hold.note === savedHold.note) setRound((r) => r + 1)
  }
  async function startEdit(entry: DepositEntry) {
    if (!sameForm(form, formBase)) {
      const ok = await confirm({
        title: 'Eingabe verwerfen?',
        message: 'Im Formular steht eine Eingabe, die noch nicht gespeichert ist. Sie geht verloren, wenn Sie jetzt eine andere Buchung ändern.',
        confirmLabel: 'Verwerfen',
        danger: true,
      })
      if (!ok) return
    }
    load(depositFormOf(entry), entry)
  }
  function stopEdit() {
    load(emptyDepositForm(localToday()), null)
  }

  async function remove(entry: DepositEntry) {
    const ok = await confirm({
      title: 'Kautionsbuchung löschen?',
      message: `${depositKindText(entry)} vom ${fmtDate(entry.date)} über ${fmtEuro(entry.amountCents)} wird gelöscht. Der Stand der Kaution rechnet sich neu.${entry.paymentId ? ' Die Zahlung im Mietkonto fällt mit weg.' : ''}`,
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(withProperty(`/api/deposit-entries/${entry.id}`, propertyId), { method: 'DELETE' })
      if (editing?.id === entry.id) stopEdit()
      errors.set('')
      onChanged()
    } catch (e) {
      errors.show(errorText(e))
    }
  }

  return (
    <Drawer key={`${tenancy.id}-${round}`} open title={`Kaution von ${tenancy.tenantName}`} width={620} cancelLabel="Schließen"
      onClose={onClose} value={{ form, hold }} busy={saving.busy} errors={errors}
      onSubmit={() => void saving.run(holdSection.current?.contains(document.activeElement) ? saveHold : submit)}
      actions={<button className="btn" disabled={saving.busy} onClick={() => void saving.run(submit)}>{editing ? 'Speichern' : 'Anlegen'}</button>}>
      <p className="m-0">{depositStateText(state, tenancy)}</p>
      {settlement && (
        <section aria-label="Aufstellung zum Auszug" className="field-group" ref={holdSection}>
          <h3>Aufstellung zum Auszug</h3>
          <SettlementView settlement={settlement} />
          <p className="muted">{DEPOSIT_DEADLINE_TEXT}</p>
          {/* Bei Stand 0 gibt es nichts zurückzuhalten; ein gespeicherter Einbehalt bleibt sichtbar, damit er sich leeren lässt. */}
          {holdShown && (
            <>
              <ErrorSummary errors={holdErrors} />
              <Field label="Einbehalt €" {...holdErrors.field('holdAmount')} hint="Was Sie vorerst zurückhalten, wenn aus einer noch ausstehenden Nebenkostenabrechnung eine Nachzahlung zu erwarten ist: ein angemessener Teil, längstens bis zum Ablauf der Abrechnungsfrist (BGH, Urteil vom 18.01.2006, VIII ZR 71/05). Leer heißt keiner. Mehr als der Stand der Kaution zählt nicht.">
                <input value={hold.amount} inputMode="decimal" placeholder="z. B. 300,00" onChange={(e) => setHold({ ...hold, amount: e.target.value })} />
              </Field>
              <Field label="Grund" {...holdErrors.field('holdNote')}>
                <input value={hold.note} placeholder="z. B. Nebenkosten 2025" onChange={(e) => setHold({ ...hold, note: e.target.value })} />
              </Field>
            </>
          )}
          <div className="flex gap-2">
            {holdShown && <button className="btn secondary" disabled={saving.busy} onClick={() => void saving.run(saveHold)}>Einbehalt speichern</button>}
            <button className="btn secondary" onClick={() => setPrinting(true)}>Aufstellung drucken</button>
          </div>
          <p className="muted m-0">Der Brief zeigt den Stand von heute und wird nicht gespeichert; ein späterer Druck kann anders ausfallen.</p>
          {/* #735: wo der Browser seine Kopf- und Fußzeilen trotzdem druckt (Safari), der Weg, sie abzuschalten */}
          {letter && linesNote && <p className="muted m-0">{linesNote}</p>}
          {letter && paperSkipped && <NoticeBox level="info" title="Briefpapier druckt dieser Browser nicht">{PAPER_BROWSER_NOTE}</NoticeBox>}
          {letter && logoNote && <NoticeBox level="info" title={logoNote.title} action={logoNote.text} />}
          {letter && depositSenderMissing(letter, paper ?? true) && <p className="muted">{DEPOSIT_SENDER_MISSING_TEXT}</p>}
        </section>
      )}
      {printing && settlement && letter && <DepositLetterPrint title={`Kaution ${tenancy.tenantName}`} view={letter} settlement={settlement} propertyId={property?.id} onDone={() => setPrinting(false)} />}
      {formWithoutMoney(tenancy) && <p className="muted">{NO_MONEY_FORM_TEXT}</p>}
      {entries.length > 0 && (
        <Table aria-label="Kautionsbuchungen">
          <thead>
            <tr><th>Datum</th><th>Art</th><th className="num">Betrag</th><th>Notiz</th><th><span className="sr-only">Aktionen</span></th></tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id}>
                <td>{fmtDate(e.date)}</td>
                <td>{depositKindText(e)}</td>
                <td className="num">{fmtEuro(signedCents(e))}</td>
                <td>{e.note ?? ''}</td>
                <td>
                  <div className="flex gap-2">
                    <button className="btn small ghost" disabled={saving.busy || editing?.id === e.id} onClick={() => void startEdit(e)}>Ändern</button>
                    <button className="btn small ghost danger-ghost ml-auto" disabled={saving.busy} onClick={() => void saving.run(() => remove(e))}>Löschen …</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="flex gap-2">
        <h3>{editing ? 'Kautionsbuchung ändern' : 'Neue Kautionsbuchung'}</h3>
        {editing && <button className="btn small ghost ml-auto" onClick={stopEdit}>Nicht ändern</button>}
      </div>
      {editing?.paymentId && <p className="muted m-0">Die Zahlung im Mietkonto folgt dieser Buchung: Datum, Betrag und Art ziehen mit.</p>}
      <div className="field-group">
        <Field label="Datum" required {...errors.field('date')}>
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Art">
          <select value={form.kind} onChange={(e) => {
            const kind = DEPOSIT_KIND_OPTIONS.find((o) => o.value === e.target.value)?.value
            if (kind) setForm(withKind(form, kind))
          }}>
            {DEPOSIT_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        {form.kind === 'applied' && (
          <Field label="Verrechnet mit" required {...errors.field('purpose')} hint={depositPurposeHint(form.purpose) ?? undefined}>
            <select value={form.purpose} onChange={(e) => {
              const purpose = DEPOSIT_PURPOSE_OPTIONS.find((o) => o.value === e.target.value)?.value
              if (purpose) setForm({ ...form, purpose })
            }}>
              {DEPOSIT_PURPOSE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        )}
        <Field label="Betrag €" required {...errors.field('amount')}>
          <input value={form.amount} inputMode="decimal" placeholder="z. B. 2.400,00" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field label="Notiz">
          <input value={form.note} placeholder="z. B. erste Rate, Zinsen 2025" onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  )
}

const sameForm = (a: DepositFormState, b: DepositFormState): boolean =>
  a.date === b.date && a.kind === b.kind && a.purpose === b.purpose && a.amount === b.amount && a.note === b.note
