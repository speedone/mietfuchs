// Die Karte „Verbilligte Vermietung“ auf der Seite Steuer (#257): je vermieteter Wohnung die eingetragene
// ortsübliche Warmmiete, die Quote je Mietverhältnis aus der Steuerübersicht und das Seitenfenster zum Eintragen.
// Gespeichert wird die ganze Staffel der Wohnung über `PUT /api/units/:id` (`localRents`); gerechnet wird auf dem
// Server (server/src/cheapRent.ts). Logik ohne DOM in cheapRent.ts.
import { useCallback, useEffect, useState } from 'react'
import { api, errorText, fmtEuro } from '../api'
import { withProperty } from '../property'
import { buildDirectCharges, buildLocalRents, directChargeLine, directChargeToForm, emptyDirectChargeForm, emptyLocalRentForm, localRentLine, localRentToForm, rentedUnits, verdictText, withoutDirectCharge, withoutLocalRent, type DirectChargeField, type DirectChargeForm, type LocalRentField, type LocalRentForm } from '../cheapRent'
import type { CheapRentReport, Tenancy, Unit } from '../types'
import Card, { CardHeader } from './Card'
import Drawer from './Drawer'
import Field from './Field'
import MonthField from './MonthField'
import Term from './Term'
import { ErrorSummary, useFormError } from './ErrorSummary'
import { useConfirm, useToast } from './feedback'
import { useSaving } from '../useSaving'
import { estgCheapRent } from '../../../shared/law/estg.ts'

// Das erste Jahr, für das das Register die Grenzen führt.
const FIRST_YEAR = (estgCheapRent.versions[0]?.validFrom ?? '').slice(0, 4)

export default function CheapRentCard({ propertyId, year, report, onSaved }: {
  propertyId: string | undefined
  year: number
  report: CheapRentReport | undefined
  onSaved: () => void
}) {
  const [units, setUnits] = useState<Unit[]>([])
  const [form, setForm] = useState<LocalRentForm | null>(null)
  // Direkt an Dritte gezahlte Kosten (#257, PR #422): am Mietverhältnis, eingetragen hier neben der Quote, auf die sie wirken.
  const [tenancies, setTenancies] = useState<Tenancy[]>([])
  const [direct, setDirect] = useState<DirectChargeForm | null>(null)
  const errors = useFormError<LocalRentField>()
  const directErrors = useFormError<DirectChargeField>()
  const loadErrors = useFormError()
  const setLoadError = loadErrors.set
  const saving = useSaving()
  const toast = useToast()
  const confirm = useConfirm()

  const load = useCallback(async () => {
    try {
      setUnits(rentedUnits(await api<Unit[]>(withProperty('/api/units', propertyId))))
      setTenancies(await api<Tenancy[]>(withProperty('/api/tenancies', propertyId)))
    } catch (e) {
      setLoadError(errorText(e), { focus: false })
    }
  }, [propertyId, setLoadError])
  useEffect(() => { void load() }, [load])

  async function store(unitId: string, localRents: unknown) {
    await api(`/api/units/${unitId}`, { method: 'PUT', body: JSON.stringify({ localRents }) })
    await load()
    onSaved()
  }

  async function save() {
    if (!form) return
    const r = buildLocalRents(form, units)
    if ('problems' in r) {
      errors.report(r.problems)
      return
    }
    try {
      await store(r.unitId, r.localRents.length > 0 ? r.localRents : null)
      setForm(null)
      errors.clear()
      toast('Ortsübliche Miete gespeichert.')
    } catch (e) {
      errors.show(errorText(e))
    }
  }

  async function storeDirect(tenancyId: string, directCharges: unknown) {
    await api(`/api/tenancies/${tenancyId}`, { method: 'PUT', body: JSON.stringify({ directCharges }) })
    await load()
    onSaved()
  }

  async function saveDirect() {
    if (!direct) return
    const r = buildDirectCharges(direct, tenancies)
    if ('problems' in r) {
      directErrors.report(r.problems)
      return
    }
    try {
      await storeDirect(r.tenancyId, r.directCharges)
      setDirect(null)
      directErrors.clear()
      toast('Direkt gezahlte Kosten gespeichert.')
    } catch (e) {
      directErrors.show(errorText(e))
    }
  }

  async function removeDirect(t: Tenancy, from: string) {
    if (!(await confirm({ title: 'Eintrag entfernen?', message: 'Der Betrag, den der Mieter direkt an Dritte zahlt, wird entfernt; die Quote rechnet dann ohne ihn.', confirmLabel: 'Entfernen', danger: true }))) return
    try {
      const rest = withoutDirectCharge(t, from)
      await storeDirect(t.id, rest.length > 0 ? rest : null)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  async function remove(unit: Unit, from: string) {
    if (!(await confirm({ title: 'Eintrag entfernen?', message: 'Der Wert der ortsüblichen Miete wird entfernt. Fehlt danach ein Wert für Monate eines Mietverhältnisses, rechnet die Steuerübersicht für dieses Jahr keine Quote.', confirmLabel: 'Entfernen', danger: true }))) return
    try {
      const rest = withoutLocalRent(unit, from)
      await store(unit.id, rest.length > 0 ? rest : null)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  if (units.length === 0 && loadErrors.state.problems.length === 0) return null
  const law = report?.law ?? null
  const set = (patch: Partial<LocalRentForm>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const resultOf = (unitId: string) => report?.units.find((u) => u.unitId === unitId)

  return (
    <Card title={<Term id="cheapRent">Verbilligte Vermietung</Term>} className="no-print"
      aside={units.length > 0 && (
        <button className="btn secondary" onClick={() => { errors.clear(); setForm(emptyLocalRentForm(units[0]?.id ?? '', year)) }}>+ Ortsübliche Miete anlegen</button>
      )}>
      <ErrorSummary errors={loadErrors} />
      <p className="muted">
        Vermieten Sie eine Wohnung günstiger als üblich, etwa an Angehörige, tragen Sie hier die ortsübliche Warmmiete ein. Die
        Steuerübersicht vergleicht damit die vereinbarte Kaltmiete und die gezahlten Umlagen (§ 21 Abs. 2 EStG). Ohne Eintrag prüft
        Mietfuchs nichts. Das gilt auch für eine vermietete Wohnung außerhalb der Abrechnungseinheit; maßgeblich ist, ob sie im Jahr
        vermietet ist.
      </p>
      {report && law === null && (
        <p className="muted">{`Für ${year} führt Mietfuchs die Grenzen von § 21 Abs. 2 EStG nicht; die Quote wird erst ab ${FIRST_YEAR} gerechnet.`}</p>
      )}
      {units.filter((u) => (u.localRents ?? []).length > 0).map((u) => {
        const result = resultOf(u.id)
        return (
          <div key={u.id} className="mb-4">
            <CardHeader level={3} title={u.name}
              aside={result && result.tenancies.length > 0 && (
                <button className="btn small secondary" onClick={() => { directErrors.clear(); setDirect(emptyDirectChargeForm(result.tenancies[0]?.tenancyId ?? '', year)) }}>+ Direkt gezahlte Kosten anlegen</button>
              )} />
            <ul>
              {(u.localRents ?? []).map((e) => (
                <li key={e.from}>
                  {localRentLine(e)}
                  {' '}<button className="btn small secondary" onClick={() => { errors.clear(); setForm(localRentToForm(u.id, e)) }}>Ändern</button>
                  {' '}<button className="btn small ghost danger-ghost" onClick={() => void remove(u, e.from)}>Entfernen …</button>
                </li>
              ))}
            </ul>
            {result && law && result.tenancies.map((t) => {
              const tenancy = tenancies.find((x) => x.id === t.tenancyId)
              return (
                <div key={t.tenancyId}>
                  <p>{verdictText(t, law)}</p>
                  {tenancy && (tenancy.directCharges ?? []).length > 0 && (
                    <ul>
                      {(tenancy.directCharges ?? []).map((e) => (
                        <li key={e.from}>
                          {directChargeLine(e)}
                          {' '}<button className="btn small secondary" onClick={() => { directErrors.clear(); setDirect(directChargeToForm(tenancy.id, e)) }}>Ändern</button>
                          {' '}<button className="btn small ghost danger-ghost" onClick={() => void removeDirect(tenancy, e.from)}>Entfernen …</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
            {result && result.gratuitousCents !== 0 && (
              <p>
                Nicht abziehbar als unentgeltlicher Teil: <strong>{fmtEuro(result.gratuitousCents)}</strong> der erfassten Werbungskosten dieser
                Wohnung; Abschreibung und Schuldzinsen, die Mietfuchs nicht führt, kürzen Sie nach derselben Quote.
              </p>
            )}
            {result && result.unallocated.length > 0 && (
              <p className="muted">Ohne Wohnfläche lässt sich {result.unallocated.length === 1 ? 'eine Position' : `${result.unallocated.length} Positionen`} nach Fläche nicht zuordnen; sie {result.unallocated.length === 1 ? 'bleibt' : 'bleiben'} ungekürzt.</p>
            )}
          </div>
        )
      })}
      {direct && (
        <Drawer key={`${direct.tenancyId}:${direct.originalFrom || 'neu'}`} open title={direct.originalFrom ? 'Direkt gezahlte Kosten bearbeiten' : 'Direkt gezahlte Kosten anlegen'} width={520}
          subtitle={tenancies.find((t) => t.id === direct.tenancyId)?.tenantName}
          onClose={() => { setDirect(null); directErrors.clear() }} value={direct} busy={saving.busy} errors={directErrors}
          onSubmit={() => void saving.run(saveDirect)}
          actions={<button className="btn" disabled={saving.busy} onClick={() => void saving.run(saveDirect)}>{direct.originalFrom ? 'Speichern' : 'Anlegen'}</button>}>
          <p className="muted">
            Umlagefähige Kosten, die der Mieter selbst an Dritte zahlt, etwa Gas oder Wärme über einen eigenen Vertrag oder die Müllabfuhr
            direkt an die Gemeinde. Sie gehören zum Entgelt der Quote (BFH, IX R 7/20, Rz. 21), stehen aber nicht in Ihren Werbungskosten,
            im Mietkonto oder in der Abrechnung. Dieselben Kosten gehören auch in die ortsübliche Warmmiete.
          </p>
          <div className="field-grid">
            {direct.originalFrom === '' && (
              <Field label="Mietverhältnis" required>
                <select value={direct.tenancyId} onChange={(e) => { const tenancyId = e.target.value; setDirect((d) => (d ? { ...d, tenancyId } : d)) }}>
                  {(report?.units.flatMap((u) => u.tenancies) ?? []).map((t) => <option key={t.tenancyId} value={t.tenancyId}>{t.tenantName}</option>)}
                </select>
              </Field>
            )}
            <MonthField label="Ab Monat" required value={direct.from} {...directErrors.field('from')} onChange={(from) => setDirect((d) => (d ? { ...d, from } : d))} />
            <Field label="Direkt gezahlt im Monat (€)" required {...directErrors.field('amount')} hint="Ein Abschlag im Monat genügt; bei einer Jahresrechnung ein Zwölftel.">
              <input value={direct.amount} inputMode="decimal" onChange={(e) => { const amount = e.target.value; setDirect((d) => (d ? { ...d, amount } : d)) }} />
            </Field>
          </div>
        </Drawer>
      )}
      {form && (
        <Drawer key={form.originalFrom || 'neu'} open title={form.originalFrom ? 'Ortsübliche Miete bearbeiten' : 'Ortsübliche Miete anlegen'} width={520}
          onClose={() => { setForm(null); errors.clear() }} value={form} busy={saving.busy} errors={errors}
          onSubmit={() => void saving.run(save)}
          actions={<button className="btn" disabled={saving.busy} onClick={() => void saving.run(save)}>{form.originalFrom ? 'Speichern' : 'Anlegen'}</button>}>
          <div className="field-grid">
            <Field label="Wohnung" required {...errors.field('unitId')}>
              <select value={form.unitId} disabled={form.originalFrom !== ''} onChange={(e) => set({ unitId: e.target.value })}>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <MonthField label="Ab Monat" required value={form.from} {...errors.field('from')} onChange={(from) => set({ from })} />
            <Field label="Ortsübliche Warmmiete im Monat (€)" required {...errors.field('amount')}
              hint="Kaltmiete laut Mietspiegel, jeder Wert innerhalb der Spanne gilt als ortsüblich, zuzüglich der umlagefähigen Betriebskosten, auch der, die der Mieter unmittelbar an Versorger zahlt (BFH, IX R 7/20).">
              <input value={form.amount} inputMode="decimal" onChange={(e) => set({ amount: e.target.value })} />
            </Field>
            <Field label="Quelle" required width="l" {...errors.field('source')} hint="Etwa der Mietspiegel mit Jahr und Spanne; das Finanzamt fragt danach.">
              <input value={form.source} onChange={(e) => set({ source: e.target.value })} />
            </Field>
            <Field label="Stand der Quelle" required {...errors.field('sourceDate')}>
              <input type="date" value={form.sourceDate} onChange={(e) => set({ sourceDate: e.target.value })} />
            </Field>
          </div>
        </Drawer>
      )}
    </Card>
  )
}
