import { useCallback, useEffect, useState } from 'react'
import { useFormError } from '../components/ErrorSummary'
import Field from '../components/Field'
import YearField from '../components/YearField'
import type { HeatingPlant, HeatingRole, Meter, MeterType, Notice, Reading, Unit } from '../types'
import { METER_TYPE_LABELS } from '../types'
import { asksReplacementCalibration, buildReadingBody, EMPTY_READING, replacementCalibrationHint, type ReadingField, type ReadingForm } from '../readingForm'
import { asksCalibration, asksRemote, CALIBRATION_MARK_HELP, calibrationSuggestion, emptyMeterForm, hasKnownUnits, HEATING_ROLE_HELP, heatingRoleLabel, heatingRoleOptions, meterBody, meterPlantId, meterToForm, meterUnitHint, meterUnitOptions, oldEndText, readingDigits, readingText, REMOTE_RULE_TEXT, withMeterType, type MeterField, type MeterForm, type RemoteAnswer } from '../meterForm'
import { plantOptions } from '../heatingForm'
import { api, errorText, fmtDate } from '../api'
import { usePeriod } from '../period'
import { useProperty, withProperty } from '../property'
import Drawer from '../components/Drawer'
import ReadingSheetDrawer from '../components/ReadingSheetDrawer'
import { SheetPrinter } from '../components/ReadingSheet'
import { todayIso, type ReadingSheet } from '../readingSheet'
import { CalcNotice, NoticeBox } from '../components/Notice'
import { useSaving } from '../useSaving'
import Card, { CardHeader } from '../components/Card'
import PageHeader from '../components/PageHeader'
import Term from '../components/Term'
import { useToast, useConfirm } from '../components/feedback'
import Table from '../components/Table'
import HcaFields from '../components/HcaFields'
import CutoffReadingForm from '../components/CutoffReadingForm'
import { hcaSummary, isCutoffReading, ratedText } from '../hcaForm'
import { useFocusTarget, useScrollToFocus, type FocusProps } from '../focus'

type Props = { units: Unit[] } & FocusProps

type Consumption = { meterId: string; consumption: number; readingCount: number; warnings: string[]; notices?: Notice[] }

export default function Zaehler({ units, focus, onFocusDone }: Props) {
  const { param, label } = usePeriod()
  const { property } = useProperty()
  const propertyId = property?.id
  const toast = useToast()
  // Kein doppeltes Speichern (Durchsicht S1): `busy` an Fenster und Knopf, ein zweiter Aufruf fällt weg.
  const saving = useSaving()
  const confirm = useConfirm()
  const [meters, setMeters] = useState<Meter[]>([])
  const [plants, setPlants] = useState<HeatingPlant[]>([])
  const [readings, setReadings] = useState<Reading[]>([])
  const [consumption, setConsumption] = useState<Consumption[]>([])
  const [meterForm, setMeterForm] = useState<MeterForm | null>(null)
  // Heizung PR 21: die Jahreszahl auf dem Zähler, nur für den Vorschlag; gespeichert wird „geeicht bis“.
  const [markedYear, setMarkedYear] = useState('')
  const [openMeterId, setOpenMeterId] = useState<string | null>(null)
  // Die Ablesung im Seitenfenster (#346 Schritt 7, N16a): der Zähler, für den das Fenster offen ist.
  const [readingFor, setReadingFor] = useState<string | null>(null)
  const [readingForm, setReadingForm] = useState<ReadingForm>({ ...EMPTY_READING })
  const [error, setError] = useState('')
  // Ableseformular (#320): Auswahl im Seitenfenster, danach das Blatt zum Drucken.
  const [sheetChoice, setSheetChoice] = useState(false)
  const [sheet, setSheet] = useState<ReadingSheet | null>(null)
  const closeSheet = useCallback(() => setSheet(null), [])
  const readingError = useFormError<ReadingField>()
  const meterErrors = useFormError<MeterField>()
  // „Hier beheben →“ aus der Abrechnung (#142): die Ablesungen des betroffenen Zählers aufklappen,
  // denn dort liegt, was ein Hinweis zu einem Zähler meint.
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const scrollToFocus = useScrollToFocus()
  useFocusTarget(focus, 'meter', meters, (m) => m.id, (m) => { setOpenMeterId(m.id); setFocusedId(m.id); scrollToFocus() }, onFocusDone)
  // Eine angefangene Ablesung meldet das Seitenfenster selbst bei useOpenForm an, sobald etwas eingetragen ist
  // (#145, #346 Schritt 7a); ein Wechsel von Seite, Objekt oder Zeitraum fragt dann nach.

  const load = useCallback(async () => {
    const [m, r, c, h] = await Promise.all([
      api<Meter[]>(withProperty('/api/meters', propertyId)),
      api<Reading[]>(withProperty('/api/readings', propertyId)),
      api<Consumption[]>(withProperty(`/api/consumption/${param}`, propertyId)),
      api<HeatingPlant[]>(withProperty('/api/heating-plants', propertyId)),
    ])
    setMeters(m)
    setPlants(h)
    setReadings(r)
    setConsumption(c)
  }, [param, propertyId])

  useEffect(() => {
    load().catch(() => setError('Server nicht erreichbar.'))
  }, [load])

  async function saveMeter() {
    if (!meterForm) return
    // Die Heizanlage des Zählers (Heizung PR 9): bei einer die des Objekts, ab zwei die gewählte.
    // Alle Angaben auf einmal (#346, Schritt 3): die Anlage und der übrige Rumpf.
    const plant = meterPlantId(meterForm, plants)
    const result = meterBody(meterForm, 'error' in plant ? null : plant.plantId)
    if ('error' in plant || 'error' in result) {
      meterErrors.report([...('error' in plant ? plant.problems : []), ...('error' in result ? result.problems : [])])
      return
    }
    meterErrors.clear()
    const body = JSON.stringify(result.body)
    const editing = !!meterForm.id
    // Lehnt der Server ab (#146), bleibt der Dialog offen und zeigt seinen Satz.
    try {
      if (editing) await api(`/api/meters/${meterForm.id}`, { method: 'PUT', body })
      else await api(withProperty('/api/meters', propertyId), { method: 'POST', body })
    } catch (e) {
      meterErrors.show(errorText(e))
      return
    }
    const name = meterForm.name.trim()
    setMeterForm(null)
    await load()
    toast(editing ? `Zähler „${name}“ gespeichert.` : `Zähler „${name}“ angelegt.`)
  }

  async function deleteMeter(m: Meter) {
    const ok = await confirm({
      title: `Zähler „${m.name}“ löschen?`,
      message: 'Der Zähler und alle zugehörigen Ablesungen werden gelöscht.',
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/meters/${m.id}`, { method: 'DELETE' })
    } catch (e) {
      // Eine Aktion ohne Formular meldet ihren Fehler als Mitteilung, nicht oben auf der Seite (H3).
      toast(errorText(e), 'error')
      return
    }
    await load()
    toast(`Zähler „${m.name}“ gelöscht.`)
  }

  // Die Meldung zur Ablesung steht im Fuß des Seitenfensters über „Anlegen“ (UI-Durchsicht H3, #346 Schritt 7).
  function openReading(meterId: string) {
    readingError.clear()
    setReadingForm({ ...EMPTY_READING })
    setReadingFor(meterId)
  }

  async function saveReading(meterId: string) {
    const meter = meters.find((m) => m.id === meterId)
    const built = buildReadingBody(readingForm, meterId, meter !== undefined && asksReplacementCalibration(meter))
    if ('problems' in built) {
      readingError.report(built.problems)
      return
    }
    readingError.clear()
    try {
      await api('/api/readings', { method: 'POST', body: JSON.stringify(built.body) })
    } catch (e) {
      readingError.show(errorText(e))
      return
    }
    setReadingFor(null)
    setReadingForm({ ...EMPTY_READING })
    await load()
    toast('Ablesung angelegt.')
  }

  async function deleteReading(r: Reading) {
    const ok = await confirm({
      title: 'Ablesung löschen?',
      message: `Ablesung vom ${fmtDate(r.date)} wird gelöscht.`,
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/readings/${r.id}`, { method: 'DELETE' })
    } catch (e) {
      toast(errorText(e), 'error')
      return
    }
    await load()
    toast('Ablesung gelöscht.')
  }

  const readingMeter = readingFor === null ? null : meters.find((m) => m.id === readingFor) ?? null
  const unitName = (id: string | null) => (id ? units.find((u) => u.id === id)?.name ?? '?' : 'Haus (Hauptzähler)')

  return (
    <>
      <PageHeader
        title="Zähler & Stände"
        subtitle={'Zählerstände dokumentieren — Jahresablesung, Zwischenablesung beim Mieterwechsel, Zählerwechsel. Wohnungszähler ermöglichen den Umlageschlüssel „nach Verbrauch“.'}
        // Die Seitenaktion steht im Seitenkopf wie „+ Kostenposition anlegen“ (#346 Schritt 7b); vorher unten in der Karte.
        actions={<>
          <button className="btn secondary" onClick={() => setSheetChoice(true)}>Ableseformular drucken</button>
          <button className="btn" onClick={() => { meterErrors.clear(); setMarkedYear(''); setMeterForm(emptyMeterForm()) }}>+ Zähler anlegen</button>
        </>}
      />
      {error && <NoticeBox level="error" action={error} />}

      <Card title="Zähler">
        {meters.length === 0 && (
          <div className="empty">
            Noch keine Zähler angelegt. Legen Sie z. B. den Hauptwasserzähler an, um die Jahresstände zu
            dokumentieren — oder Wohnungszähler, um nach Verbrauch abzurechnen.
          </div>
        )}
        {meters.length > 0 && (
          <Table className="stacked">
            <thead>
              <tr>
                <th>Zähler</th>
                <th>Zuordnung</th>
                <th>Sparte</th>
                <th className="num">Verbrauch {label}</th>
                <th className="no-print"></th>
              </tr>
            </thead>
            <tbody>
              {meters.map((m) => {
                const c = consumption.find((x) => x.meterId === m.id)
                const mReadings = readings
                  .filter((r) => r.meterId === m.id)
                  .sort((a, b) => b.date.localeCompare(a.date))
                return (
                  <FragmentRow
                    key={m.id}
                    meter={m}
                    cons={c}
                    open={openMeterId === m.id}
                    focused={focusedId === m.id}
                    readings={mReadings}
                    unitName={unitName(m.unitId)}
                    consumptionLabel={label}
                    onToggle={() => setOpenMeterId(openMeterId === m.id ? null : m.id)}
                    onEdit={() => { meterErrors.clear(); setMarkedYear(''); setMeterForm(meterToForm(m)) }}
                    onDelete={() => deleteMeter(m)}
                    onNewReading={() => openReading(m.id)}
                    onDeleteReading={deleteReading}
                    onSaved={() => { void load(); toast('Stichtagswert gespeichert.') }}
                  />
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {sheetChoice && (
        <ReadingSheetDrawer
          meters={meters}
          readings={readings}
          units={units}
          plants={plants}
          today={todayIso()}
          onClose={() => setSheetChoice(false)}
          onPrint={(next) => { setSheetChoice(false); setSheet(next) }}
        />
      )}
      {sheet && <SheetPrinter sheet={sheet} propertyName={property?.name ?? ''} onDone={closeSheet} />}

      {readingMeter && (
        <Drawer
          // Ein anderer Zähler im offenen Fenster ist ein neues Formular (Durchsicht S3)
          key={readingMeter.id}
          open
          title="Neue Ablesung"
          subtitle={`${readingMeter.name}${readingMeter.meterNumber ? `, Nr. ${readingMeter.meterNumber}` : ''}`}
          onClose={() => { readingError.clear(); setReadingFor(null) }}
          onSubmit={() => void saving.run(() => saveReading(readingMeter.id))}
          busy={saving.busy}
          value={readingForm}
          errors={readingError}
          actions={<button className="btn" disabled={saving.busy} onClick={() => void saving.run(() => saveReading(readingMeter.id))}>Anlegen</button>}
        >
          <div className="field-grid">
            <Field label="Datum" required {...readingError.field('date')}>
              <input type="date" value={readingForm.date} onChange={(e) => setReadingForm({ ...readingForm, date: e.target.value })} />
            </Field>
            <Field label={`${readingForm.replacement ? 'Startstand neuer Zähler' : 'Zählerstand'}${readingMeter.unit ? ` (${readingMeter.unit})` : ''}`} required hint={lastReadingText(readingMeter, readings)} {...readingError.field('value')}>
              <input value={readingForm.value} inputMode="decimal" onChange={(e) => setReadingForm({ ...readingForm, value: e.target.value })} className="input-num" />
            </Field>
          </div>
          <label className="checkline">
            <input type="checkbox" checked={readingForm.replacement} onChange={(e) => setReadingForm({ ...readingForm, replacement: e.target.checked })} />
            <span>Zählerwechsel (der alte Zähler wurde an diesem Tag ausgebaut)</span>
          </label>
          {readingForm.replacement && (
            <Field label={`Endstand alter Zähler${readingMeter.unit ? ` (${readingMeter.unit})` : ''}`} hint="Leer lassen, wenn er fehlt." {...readingError.field('oldEndValue')}>
              <input value={readingForm.oldEndValue} inputMode="decimal" onChange={(e) => setReadingForm({ ...readingForm, oldEndValue: e.target.value })} className="input-num" />
            </Field>
          )}
          {/* Praxistest: Das Eichjahr gilt für das heutige Gerät; ohne neues Jahr bliebe die Warnung des ausgebauten stehen. */}
          {readingForm.replacement && asksReplacementCalibration(readingMeter) && (
            <YearField
              label="Neuer Zähler geeicht bis Ende (Jahr)"
              hint={<>{replacementCalibrationHint(readingMeter)} Die <Term id="meterCalibration">Eichfrist</Term> endet mit dem Ende dieses Jahres; es steht in der Mitteilung des Messdienstes oder auf dem Eichschein.</>}
              value={readingForm.newCalibratedUntil}
              onChange={(newCalibratedUntil) => setReadingForm({ ...readingForm, newCalibratedUntil })}
              {...readingError.field('newCalibratedUntil')}
            />
          )}
          <Field label="Hinweis">
            <input value={readingForm.note} onChange={(e) => setReadingForm({ ...readingForm, note: e.target.value })} placeholder="z. B. Zwischenablesung Auszug Müller" />
          </Field>
          <p className="muted">
            Tipp: Beim Mieterwechsel am Auszugstag eine Zwischenablesung erfassen — dann wird der
            Verbrauch exakt statt tagesanteilig geschätzt aufgeteilt.
          </p>
        </Drawer>
      )}

      {meterForm && (
        <Drawer
          // Ein anderer Datensatz im offenen Fenster ist ein neues Formular (Durchsicht S3)
          key={meterForm.id ?? 'neu'}
          open
          title={meterForm.id ? 'Zähler bearbeiten' : 'Neuer Zähler'}
          subtitle={meterForm.id ? meterForm.name : undefined}
          onClose={() => { meterErrors.clear(); setMeterForm(null) }}
          onSubmit={() => void saving.run(saveMeter)}
          busy={saving.busy}
          value={meterForm}
          errors={meterErrors}
          actions={<button className="btn" disabled={saving.busy} onClick={() => void saving.run(saveMeter)}>{meterForm.id ? 'Speichern' : 'Anlegen'}</button>}
        >
          <div className="row">
            <Field label="Name" required {...meterErrors.field('name')}>
              <input value={meterForm.name} onChange={(e) => setMeterForm({ ...meterForm, name: e.target.value })} placeholder={meterForm.type === 'hkv' ? 'z. B. Wohnzimmer' : 'z. B. Hauptwasserzähler'} />
            </Field>
            <Field
              label={<>Zuordnung (<Term id="mainMeter">Haupt- oder Zwischenzähler</Term>)</>}
              required={meterForm.type === 'hkv'}
              hint={meterForm.type !== 'hkv' ? <>Bei einer <Term id="granny">Einliegerwohnung</Term> mit eigenem Zwischenzähler: den Zähler des Hauses als Hauptzähler anlegen, den Zwischenzähler an der Wohnung.</> : undefined}
              {...meterErrors.field('unitId')}
            >
              <select value={meterForm.unitId} onChange={(e) => setMeterForm({ ...meterForm, unitId: e.target.value })}>
                {/* Ein Heizkostenverteiler sitzt an einem Heizkörper einer Wohnung (Durchsicht von #241, Minor 11). */}
                <option value="">{meterForm.type === 'hkv' ? '— bitte Wohnung wählen —' : 'Haus (Hauptzähler)'}</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <label className="field">
              Sparte
              <select value={meterForm.type} onChange={(e) => setMeterForm(withMeterType(meterForm, e.target.value as MeterType))}>
                {(Object.keys(METER_TYPE_LABELS) as MeterType[]).map((t) => (
                  <option key={t} value={t}>{METER_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </label>
            <Field label="Zählernummer" width="m">
              <input value={meterForm.meterNumber} onChange={(e) => setMeterForm({ ...meterForm, meterNumber: e.target.value })} />
            </Field>
            {/* #342: bei Wasser, Wärme und Strom eine Auswahl, denn Mietfuchs rechnet diese Einheiten ineinander um. */}
            <Field label={<Term id="meterUnit">Einheit</Term>} required={hasKnownUnits(meterForm.type)} hint={meterUnitHint(meterForm) || undefined} {...meterErrors.field('unit')}>
              {hasKnownUnits(meterForm.type)
                ? (
                  <select value={meterForm.unit} onChange={(e) => setMeterForm({ ...meterForm, unit: e.target.value, unitDropped: '' })}>
                    {/* Durchsicht von #342, S2 und S6: ohne Einheit „Bitte wählen“ statt einer still eingesetzten Vorgabe. */}
                    {meterForm.unit === '' && <option value="">Bitte wählen</option>}
                    {meterUnitOptions(meterForm.type, meterForm.unit).map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                )
                : <input value={meterForm.unit} onChange={(e) => setMeterForm({ ...meterForm, unit: e.target.value })} />}
            </Field>
            {/* Heizung PR 12: Skala und Bewertungsfaktor des Heizkostenverteilers. */}
            {meterForm.type === 'hkv' && <HcaFields form={meterForm.hca} onChange={(hca) => setMeterForm({ ...meterForm, hca })} />}
            {heatingRoleOptions(meterForm, plants.length > 0).length > 0 && (
              <label className="field">
                Gehört zur Heizanlage?
                <select value={heatingRoleOptions(meterForm, true).includes(meterForm.heatingRole as HeatingRole) ? meterForm.heatingRole : ''} onChange={(e) => setMeterForm({ ...meterForm, heatingRole: e.target.value as HeatingRole | '' })}>
                  <option value="">Nein</option>
                  {heatingRoleOptions(meterForm, true).map((r) => <option key={r} value={r}>{heatingRoleLabel(meterForm, r)}</option>)}
                </select>
                <small className="muted">{HEATING_ROLE_HELP}</small>
              </label>
            )}
            {!meterForm.unitId && meterForm.heatingRole !== '' && plantOptions(plants).length > 0 && (
              <Field label="Heizanlage" required {...meterErrors.field('heatingPlantId')}>
                <select value={meterForm.heatingPlantId} onChange={(e) => setMeterForm({ ...meterForm, heatingPlantId: e.target.value })}>
                  <option value="">— bitte wählen —</option>
                  {plantOptions(plants).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            )}
            {asksRemote(meterForm, plants.length > 0) && (
              <>
                <label className="field">
                  Aus der Ferne ablesbar?
                  <select value={meterForm.remote} onChange={(e) => setMeterForm({ ...meterForm, remote: e.target.value as RemoteAnswer })}>
                    <option value="">Weiß ich nicht</option>
                    <option value="yes">Ja</option>
                    <option value="no">Nein</option>
                  </select>
                </label>
                <label className="field">
                  Eingebaut am
                  <input type="date" value={meterForm.installedOn} onChange={(e) => setMeterForm({ ...meterForm, installedOn: e.target.value })} />
                  <small className="muted">{REMOTE_RULE_TEXT}</small>
                </label>
              </>
            )}
            {asksCalibration(meterForm) && (
              <>
                <YearField
                  label="Geeicht bis Ende (Jahr)"
                  hint={<>Die <Term id="meterCalibration">Eichfrist</Term> endet mit dem Ende dieses Jahres. Hat der Messdienst sie im Stichprobenverfahren verlängern lassen (§ 35 MessEV), tragen Sie das verlängerte Jahr ein.</>}
                  value={meterForm.calibratedUntil}
                  onChange={(calibratedUntil) => setMeterForm({ ...meterForm, calibratedUntil })}
                  {...meterErrors.field('calibratedUntil')}
                />
                <label className="field">
                  Jahreszahl auf dem Zähler (etwa „M22“ oder die Jahresangabe der Eichmarke)
                  <input inputMode="numeric" value={markedYear} onChange={(e) => setMarkedYear(e.target.value)} placeholder="z. B. M22" />
                  {markedYear.trim() !== '' && (() => {
                    const s = calibrationSuggestion(meterForm.type, markedYear)
                    return 'reason' in s
                      ? <small className="muted">{s.reason}</small>
                      : (
                        <small>
                          {s.text}{' '}
                          <button type="button" className="btn secondary" onClick={() => setMeterForm({ ...meterForm, calibratedUntil: String(s.year) })}>Übernehmen</button>
                          <br />
                          <span className="muted">{CALIBRATION_MARK_HELP}</span>
                        </small>
                      )
                  })()}
                </label>
              </>
            )}
          </div>
        </Drawer>
      )}
    </>
  )
}

// Der letzte Stand des Zählers als Anhalt im Fenster „Neue Ablesung“ (Durchsicht K1): Die Liste dahinter ist verdeckt.
export function lastReadingText(meter: Pick<Meter, 'id' | 'unit'>, readings: readonly Reading[]): string | undefined {
  const last = readings.filter((r) => r.meterId === meter.id).reduce<Reading | null>((a, r) => (a === null || r.date >= a.date ? r : a), null)
  if (!last) return undefined
  return `Letzter Stand: ${last.value.toLocaleString('de-DE')}${meter.unit ? ` ${meter.unit}` : ''} am ${fmtDate(last.date)}`
}

function FragmentRow(props: {
  meter: Meter
  focused?: boolean
  cons?: Consumption
  open: boolean
  readings: Reading[]
  unitName: string
  // Der Zeitraum im Spaltenkopf „Verbrauch …“, am Handy an der Zelle (data-label)
  consumptionLabel: string
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onNewReading: () => void
  onDeleteReading: (r: Reading) => void
  onSaved: () => void
}) {
  const { meter: m, focused, cons, open, readings, unitName, consumptionLabel, onToggle, onEdit, onDelete, onNewReading, onDeleteReading, onSaved } = props
  const digits = readingDigits(readings)
  return (
    <>
      <tr className={focused ? 'focus-target' : undefined}>
        <td data-label="Zähler">
          {m.name}
          {m.meterNumber && <div className="muted">Nr. {m.meterNumber}</div>}
          {hcaSummary(m) && <div className="muted">{hcaSummary(m)}</div>}
          {m.calibratedUntil != null && <div className="muted">geeicht bis Ende {m.calibratedUntil}</div>}
          {/* Die abgelaufene Eichfrist ist eine Warnung und kein Fehler der Stände (Heizung PR 21). */}
          {/* Über den Baustein Notice (Durchsicht K3, S26): Stufe als Zeichen und Wort; ein Fehler steht ganz offen. */}
          {cons?.warnings.map((w, i) => {
            const n = cons.notices?.[i]
            return <CalcNotice key={i} notice={{ code: n?.code ?? 'legacy', level: n?.code === 'meter.calibration-overdue' ? 'warning' : 'error', title: n?.title ?? '', text: w }} />
          })}
        </td>
        <td data-label="Zuordnung">{unitName}</td>
        <td data-label="Sparte">{METER_TYPE_LABELS[m.type] ?? m.type}</td>
        <td className="num" data-label={`Verbrauch ${consumptionLabel}`}>
          {cons && cons.readingCount >= 2
            ? `${cons.consumption.toLocaleString('de-DE')}${m.unit ? ` ${m.unit}` : ''}`
            : <span className="muted">zu wenig Ablesungen</span>}
          {cons && cons.readingCount >= 2 && ratedText(m, cons.consumption) && <div className="muted">{ratedText(m, cons.consumption)}</div>}
        </td>
        <td className="actions no-print">
          <button className="btn small secondary" onClick={onToggle}>{open ? 'Schließen' : `Ablesungen (${readings.length})`}</button>
          {' '}
          <button className="icon-btn" title="Bearbeiten" aria-label="Zähler bearbeiten" onClick={onEdit}>✎</button>
          <button className="icon-btn danger" title="Löschen" aria-label="Zähler löschen" onClick={onDelete}>🗑</button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="stack reading-panel">
            {/* Die Listenaktion steht oben rechts im Kopf der Liste (#346 Schritt 7b), vorher unter ihr. */}
            <CardHeader level={3} title={`Ablesungen ${m.name}`} aside={<button className="btn secondary" onClick={onNewReading}>+ Ablesung anlegen</button>} />
            {readings.length > 0 && (
              <Table>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th className="num">Stand{m.unit ? ` (${m.unit})` : ''}</th>
                    <th>Hinweis</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {readings.map((r) => (
                    <tr key={r.id}>
                      <td>{fmtDate(r.date)}</td>
                      <td className="num">
                        {readingText(r.value, digits)}
                        {r.replacement && <div className="muted">{isCutoffReading(m.type, r) ? 'Stichtagswert' : 'Endstand alt'}: {oldEndText(r.oldEndValue, digits)}</div>}
                      </td>
                      <td className="muted">
                        {r.replacement && <span className="badge gray">{isCutoffReading(m.type, r) ? 'Stichtag' : 'Zählerwechsel'}</span>} {r.note}
                      </td>
                      <td className="actions"><button className="icon-btn danger" title="Löschen" aria-label="Ablesung löschen" onClick={() => onDeleteReading(r)}>🗑</button></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {readings.length === 0 && <p className="muted">Noch keine Ablesung für diesen Zähler.</p>}
            {m.type === 'hkv' && <CutoffReadingForm meterId={m.id} onSaved={onSaved} />}
          </td>
        </tr>
      )}
    </>
  )
}
