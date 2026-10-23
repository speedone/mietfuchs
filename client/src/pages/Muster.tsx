import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import Field, { RequiredLegend } from '../components/Field'
import MonthField from '../components/MonthField'
import YearField from '../components/YearField'
import Term from '../components/Term'
import Table from '../components/Table'
import Drawer from '../components/Drawer'
import DraftActions from '../components/DraftActions'
import EmptyState from '../components/EmptyState'
import Switcher from '../components/Switcher'
import { OtherPropertiesView } from '../components/OtherPropertiesCard'
import { PropertySwitcher } from '../property'
import { ErrorSummary, useFormError } from '../components/ErrorSummary'
import { NoticeBox, TextNotice } from '../components/Notice'
import { useConfirm, useToast } from '../components/feedback'
import { useDraft } from '../useDraft'
import ContractAgreementFields, { WhyQuestion } from '../components/ContractAgreementFields'
import { EMPTY_ITEM_FORM, type ItemForm } from '../costForm'
import type { Property, Tenancy, Unit } from '../types'

// Musterseite (#346 Schritt 12, Spezifikation Abschnitt 9): alle Bausteine der Oberfläche auf einer Seite, mit festen
// Werten und ohne Anfrage an den Server. Aufgerufen mit `?muster`, nicht in der Navigation. `npm run screenshots`
// fotografiert sie hell und dunkel, der Browserlauf prüft sie mit axe und der Messung abgeschnittener Felder wie jede
// Seite. Wer einen Baustein ändert, sieht ihn hier.
const UNITS = [{ value: 'eg', label: 'EG links' }, { value: 'og', label: 'OG rechts' }]
// Feste Wohnungen und Mietverhältnisse für die Fragen zu „nicht im Mietvertrag vereinbart“ (#258)
const CONTRACT_UNITS: Unit[] = [
  { id: 'eg', propertyId: 'muster', name: 'EG links', areaM2: 60, participates: true },
  { id: 'og', propertyId: 'muster', name: 'OG rechts', areaM2: 70, participates: true },
]
const contractTenancy = (id: string, unitId: string, tenantName: string): Tenancy => ({ id, unitId, tenantName, persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] })
// Feste Objekte für die Karte „Weitere Objekte“ und den Umschalter mit „+“
const muster = (id: string, name: string, kind: Property['kind'], address: string): Property => ({ id, name, kind, address, landlordName: null, iban: null, paymentDeadlineDays: null })
const PROPERTIES = [muster('lw', 'Lindenweg 12', 'mfh', 'Lindenweg 12, 12345 Musterstadt'), muster('ka', 'Kastanienallee 5, WE 7', 'etw', 'Kastanienallee 5, 12345 Musterstadt')]
const CONTRACT_TENANCIES = [contractTenancy('t1', 'eg', 'Anna Becker'), contractTenancy('t2', 'og', 'Jonas Hartmann')]
const CONTRACT_PERIOD = { from: '2025-01-01', to: '2025-12-31' }
// Mieterwechsel in OG rechts: „Steht nicht im Mietvertrag von:“ mit je einem Häkchen
const CHANGE_TENANCIES = [contractTenancy('t1', 'eg', 'Anna Becker'), { ...contractTenancy('t2', 'og', 'Jonas Hartmann'), end: '2025-06-30' }, { ...contractTenancy('t3', 'og', 'Lea Schneider'), start: '2025-07-01' }]

export default function Muster() {
  const toast = useToast()
  const confirm = useConfirm()
  const errors = useFormError<'betrag'>()
  const [open, setOpen] = useState(false)
  const [drawerForm, setDrawerForm] = useState({ name: '' })
  const [month, setMonth] = useState('2025-03')
  const [year, setYear] = useState('2031')
  const [unit, setUnit] = useState('eg')
  const [propertyId, setPropertyId] = useState('lw')
  const draft = useDraft('og')
  const [why, setWhy] = useState<ItemForm>({ ...EMPTY_ITEM_FORM, category: 'Aufzug', participants: ['og'], pendingWhy: ['eg'], notAgreed: ['t2'] })
  const [change, setChange] = useState<ItemForm>({ ...EMPTY_ITEM_FORM, category: 'Aufzug', notAgreed: ['t3'] })
  const [changeChosen, setChangeChosen] = useState(true)
  const [other, setOther] = useState<ItemForm>({ ...EMPTY_ITEM_FORM, category: 'Sonstige Betriebskosten', named: ['t1'] })
  // Die Sammelmeldung mit einer Meldung am Feld, ohne den Fokus beim Laden zu nehmen
  useEffect(() => {
    errors.report([{ field: 'betrag', short: 'Betrag fehlt', text: 'Betrag: Bitte tragen Sie den Betrag laut Rechnung ein.' }], { focus: false })
  }, [])

  return (
    <>
      <PageHeader
        context="none"
        title="Musterseite"
        subtitle="Alle Bausteine der Oberfläche mit festen Werten. Nur zum Prüfen, nicht in der Navigation."
        actions={<button className="btn secondary" onClick={() => toast('Eine Mitteilung.')}>Mitteilung zeigen</button>}
      />

      <Card title="Knöpfe">
        <div className="row">
          <button className="btn">Primär</button>
          <button className="btn secondary">Sekundär</button>
          <button className="btn ghost">Ruhig</button>
          <button className="btn small">Klein</button>
          <button className="btn" disabled>Gesperrt</button>
          <button className="btn ghost danger-ghost ml-auto" onClick={() => void confirm({ title: 'Muster löschen?', message: 'Eine Rückfrage mit Gefahr; der Startfokus steht auf „Abbrechen“.', confirmLabel: 'Löschen', danger: true })}>
            Muster löschen …
          </button>
        </div>
      </Card>

      <Card title="Felder in Stufen">
        <RequiredLegend />
        <div className="field-grid">
          <Field label="Betrag €" required width="s" {...errors.field('betrag')}>
            <input inputMode="decimal" defaultValue="" />
          </Field>
          <Field label="Kurzer Text" width="m"><input defaultValue="Hausmeister" /></Field>
          <Field label="Bezeichnung" width="l" hint="Ein Hinweis unter dem Feld."><input defaultValue="Lindenweg 12" /></Field>
          <Field label={<><Term id="allocationKey">Umlageschlüssel</Term> der Wohnung</>} width="m">
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </Field>
          <MonthField label="Ab Monat" value={month} onChange={setMonth} today="2026-10-21" width="s" />
          <YearField label="Geeicht bis Ende (Jahr)" value={year} onChange={setYear} today="2026-10-21" />
          <Field label="Notiz" width="full"><textarea defaultValue="Ein Textfeld über die ganze Breite." /></Field>
        </div>
        <ErrorSummary errors={errors} />
      </Card>

      <Card title="Seitenfenster" aside={<button className="btn secondary" onClick={() => { setDrawerForm({ name: '' }); setOpen(true) }}>+ Muster anlegen</button>}>
        <p className="muted">„+ … anlegen“ öffnet ein Seitenfenster; Esc mit Eingabe fragt nach.</p>
        {open && (
          <Drawer open title="Muster anlegen" onClose={() => setOpen(false)} value={drawerForm}
            actions={<button className="btn" onClick={() => { setOpen(false); toast('Angelegt.') }}>Anlegen</button>}>
            <Field label="Name" required width="l"><input value={drawerForm.name} onChange={(e) => setDrawerForm({ name: e.target.value })} /></Field>
          </Drawer>
        )}
      </Card>

      <Card title="Entwurf am Feld">
        <div className="row">
          <Field label="Wohnung" width="m">
            <select value={draft.value} onChange={(e) => draft.set(e.target.value)}>
              {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </Field>
          <DraftActions draft={draft} what="Wohnung" onSave={async () => { toast('Gespeichert.') }} />
        </div>
      </Card>

      <Card title="Nicht im Mietvertrag vereinbart">
        <div className="checks">
          {why.pendingWhy.includes('eg') && (
            <WhyQuestion form={why} unit={CONTRACT_UNITS[0]} units={CONTRACT_UNITS} tenancies={CONTRACT_TENANCIES} period={CONTRACT_PERIOD} onChange={setWhy} />
          )}
          {changeChosen && (
            <WhyQuestion form={change} unit={CONTRACT_UNITS[1]} units={CONTRACT_UNITS} tenancies={CHANGE_TENANCIES} period={CONTRACT_PERIOD} onChange={setChange}
              chosen={changeChosen} onChoose={setChangeChosen} />
          )}
        </div>
        <ContractAgreementFields form={why} units={CONTRACT_UNITS} tenancies={CONTRACT_TENANCIES} period={CONTRACT_PERIOD} onChange={setWhy} />
        <ContractAgreementFields form={other} units={CONTRACT_UNITS} tenancies={CONTRACT_TENANCIES} period={CONTRACT_PERIOD} onChange={setOther} />
      </Card>

      <Card title="Hinweise">
        <NoticeBox level="error" title="Fehler" action="Eine Position wird nicht verteilt, weil Angaben fehlen." fix={{ label: 'Hier beheben →', onClick: () => toast('Sprung zur Stelle.') }} />
        <NoticeBox level="warning" title="Warnung" action="Geld landet anders als vermutlich gewollt." more="Begründung aus einer Fundstelle (BGH VIII ZR 156/11)." />
        <NoticeBox level="hint" title="Hinweis" action="Bitte prüfen, ohne sicheren Fehler." />
        <TextNotice level="info" text="Eine Auskunft als fertiger Text. Sie wird in Sätze zerlegt." />
        <div className="ok">✓ Ein Erfolg.</div>
      </Card>

      <Card title="Tabelle">
        <Table className="stacked">
          <thead><tr><th>Wohnung</th><th>Mieter</th><th className="num">Betrag</th></tr></thead>
          <tbody>
            <tr><td data-label="Wohnung">EG links</td><td data-label="Mieter">Anna Becker</td><td className="num" data-label="Betrag">930,00 €</td></tr>
            <tr><td data-label="Wohnung">OG rechts</td><td data-label="Mieter">Jonas Hartmann</td><td className="num" data-label="Betrag">740,00 €</td></tr>
          </tbody>
        </Table>
      </Card>

      {/* Bei einem Objekt mit Erklärung, ab zwei mit der Liste der übrigen */}
      <OtherPropertiesView current="Lindenweg 12" others={[]} onCreate={() => toast('Neues Objekt.')} onSwitch={() => {}} />
      <OtherPropertiesView current="Lindenweg 12" others={PROPERTIES.slice(1)} onCreate={() => toast('Neues Objekt.')} onSwitch={(p) => toast(`Gewechselt zu „${p.name}“.`)} />

      <Card title="Umschalter und Leerzustand">
        <Switcher label="Wohnung" className="switcher-field width-s" value={unit} options={UNITS} onChange={setUnit} />
        {/* Der Umschalter des Objekts mit „+“, so breit wie in der Seitenleiste */}
        <div className="width-m">
          <PropertySwitcher properties={PROPERTIES} value={propertyId} onChange={setPropertyId} onCreate={() => toast('Neues Objekt.')} />
        </div>
        <EmptyState action={{ label: 'Wohnung anlegen', onClick: () => toast('Anlegen.') }}>Noch keine Wohnung erfasst.</EmptyState>
      </Card>
    </>
  )
}
