import { useCallback, useEffect, useState } from 'react'
import { ErrorSummary, useFormError, type FormErrors } from '../components/ErrorSummary'
import Field, { RequiredLegend } from '../components/Field'
import type { HeatingPlant, HeatingRole, Meter, MeterType, Notice, Reading, Unit } from '../types'
import { METER_TYPE_LABELS } from '../types'
import { buildReadingBody, EMPTY_READING, type ReadingField, type ReadingForm } from '../readingForm'
import { asksCalibration, asksRemote, CALIBRATION_MARK_HELP, calibrationSuggestion, emptyMeterForm, hasKnownUnits, HEATING_ROLE_HELP, heatingRoleLabel, heatingRoleOptions, meterBody, meterPlantId, meterToForm, meterUnitHint, meterUnitOptions, oldEndText, REMOTE_RULE_TEXT, withMeterType, type MeterField, type MeterForm, type RemoteAnswer } from '../meterForm'
import { plantOptions } from '../heatingForm'
import { api, errorText, fmtDate } from '../api'
import { usePeriod } from '../period'
import { useOpenForm, useProperty, withProperty } from '../property'
import Drawer from '../components/Drawer'
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
  const confirm = useConfirm()
  const [meters, setMeters] = useState<Meter[]>([])
  const [plants, setPlants] = useState<HeatingPlant[]>([])
  const [readings, setReadings] = useState<Reading[]>([])
  const [consumption, setConsumption] = useState<Consumption[]>([])
  const [meterForm, setMeterForm] = useState<MeterForm | null>(null)
  // Heizung PR 21: die Jahreszahl auf dem Zähler, nur für den Vorschlag; gespeichert wird „geeicht bis“.
  const [markedYear, setMarkedYear] = useState('')
  const [openMeterId, setOpenMeterId] = useState<string | null>(null)
  const [readingForm, setReadingForm] = useState<ReadingForm>({ ...EMPTY_READING })
  const [error, setError] = useState('')
  const readingError = useFormError<ReadingField>()
  const meterErrors = useFormError<MeterField>()
  // „Hier beheben →“ aus der Abrechnung (#142): die Ablesungen des betroffenen Zählers aufklappen,
  // denn dort liegt, was ein Hinweis zu einem Zähler meint.
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const scrollToFocus = useScrollToFocus()
  useFocusTarget(focus, 'meter', meters, (m) => m.id, (m) => { setOpenMeterId(m.id); setFocusedId(m.id); scrollToFocus() }, onFocusDone)
  // Eine angefangene Ablesung hängt am Zähler dieses Objekts (#145).
  useOpenForm(openMeterId !== null && (readingForm.date !== '' || readingForm.value.trim() !== '' || readingForm.oldEndValue.trim() !== '' || readingForm.note.trim() !== ''))

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
    toast(editing ? `„${name}“ übernommen.` : `Zähler „${name}“ angelegt.`)
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

  // Die Meldung zur Ablesung steht beim Knopf „Ablesung speichern“ (UI-Durchsicht H3), nicht oben.
  async function saveReading(meterId: string) {
    const built = buildReadingBody(readingForm, meterId)
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
    setReadingForm({ ...EMPTY_READING })
    await load()
    toast('Ablesung gespeichert.')
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

  const unitName = (id: string | null) => (id ? units.find((u) => u.id === id)?.name ?? '?' : 'Haus (Hauptzähler)')

  return (
    <>
      <PageHeader
        title="Zähler & Stände"
        subtitle={'Zählerstände dokumentieren — Jahresablesung, Zwischenablesung beim Mieterwechsel, Zählerwechsel. Wohnungszähler ermöglichen den Umlageschlüssel „nach Verbrauch“.'}
      />
      {error && <div className="error">{error}</div>}

      <div className="card">
        <h2>Zähler</h2>
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
                    onToggle={() => { readingError.clear(); setOpenMeterId(openMeterId === m.id ? null : m.id); setReadingForm({ ...EMPTY_READING }) }}
                    onEdit={() => { meterErrors.clear(); setMarkedYear(''); setMeterForm(meterToForm(m)) }}
                    onDelete={() => deleteMeter(m)}
                    readingForm={readingForm}
                    setReadingForm={setReadingForm}
                    onSaveReading={() => saveReading(m.id)}
                    readingErrors={readingError}
                    onDeleteReading={deleteReading}
                    onSaved={() => { void load(); toast('Stichtagswert gespeichert.') }}
                  />
                )
              })}
            </tbody>
          </Table>
        )}

        <div className="row">
          <button className="btn secondary" onClick={() => { meterErrors.clear(); setMarkedYear(''); setMeterForm(emptyMeterForm()) }}>
            + Zähler hinzufügen
          </button>
        </div>
      </div>

      {meterForm && (
        <Drawer
          // Ein anderer Datensatz im offenen Fenster ist ein neues Formular (Durchsicht S3)
          key={meterForm.id ?? 'neu'}
          open
          title={meterForm.id ? 'Zähler bearbeiten' : 'Neuer Zähler'}
          subtitle={meterForm.id ? meterForm.name : undefined}
          onClose={() => { meterErrors.clear(); setMeterForm(null) }}
          onSubmit={saveMeter}
          value={meterForm}
          errors={meterErrors}
          actions={<button className="btn" onClick={saveMeter}>{meterForm.id ? 'Übernehmen' : 'Anlegen'}</button>}
        >
          <div className="row">
            <Field label="Name" required className="grow" {...meterErrors.field('name')}>
              <input value={meterForm.name} onChange={(e) => setMeterForm({ ...meterForm, name: e.target.value })} placeholder={meterForm.type === 'hkv' ? 'z. B. Wohnzimmer' : 'z. B. Hauptwasserzähler'} />
            </Field>
            <Field
              label={<>Zuordnung (<Term id="mainMeter">Haupt- oder Zwischenzähler</Term>)</>}
              className="grow"
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
            <label className="field grow">
              Sparte
              <select value={meterForm.type} onChange={(e) => setMeterForm(withMeterType(meterForm, e.target.value as MeterType))}>
                {(Object.keys(METER_TYPE_LABELS) as MeterType[]).map((t) => (
                  <option key={t} value={t}>{METER_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </label>
            <Field label="Zählernummer" className="grow">
              <input value={meterForm.meterNumber} onChange={(e) => setMeterForm({ ...meterForm, meterNumber: e.target.value })} />
            </Field>
            {/* #342: bei Wasser, Wärme und Strom eine Auswahl, denn Mietfuchs rechnet diese Einheiten ineinander um. */}
            <Field label={<Term id="meterUnit">Einheit</Term>} required={hasKnownUnits(meterForm.type)} className="grow" hint={meterUnitHint(meterForm) || undefined} {...meterErrors.field('unit')}>
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
              <label className="field grow">
                Gehört zur Heizanlage?
                <select value={heatingRoleOptions(meterForm, true).includes(meterForm.heatingRole as HeatingRole) ? meterForm.heatingRole : ''} onChange={(e) => setMeterForm({ ...meterForm, heatingRole: e.target.value as HeatingRole | '' })}>
                  <option value="">Nein</option>
                  {heatingRoleOptions(meterForm, true).map((r) => <option key={r} value={r}>{heatingRoleLabel(meterForm, r)}</option>)}
                </select>
                <small className="muted">{HEATING_ROLE_HELP}</small>
              </label>
            )}
            {!meterForm.unitId && meterForm.heatingRole !== '' && plantOptions(plants).length > 0 && (
              <Field label="Heizanlage" required className="grow" {...meterErrors.field('heatingPlantId')}>
                <select value={meterForm.heatingPlantId} onChange={(e) => setMeterForm({ ...meterForm, heatingPlantId: e.target.value })}>
                  <option value="">— bitte wählen —</option>
                  {plantOptions(plants).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            )}
            {asksRemote(meterForm, plants.length > 0) && (
              <>
                <label className="field grow">
                  Aus der Ferne ablesbar?
                  <select value={meterForm.remote} onChange={(e) => setMeterForm({ ...meterForm, remote: e.target.value as RemoteAnswer })}>
                    <option value="">Weiß ich nicht</option>
                    <option value="yes">Ja</option>
                    <option value="no">Nein</option>
                  </select>
                </label>
                <label className="field grow">
                  Eingebaut am
                  <input type="date" value={meterForm.installedOn} onChange={(e) => setMeterForm({ ...meterForm, installedOn: e.target.value })} />
                  <small className="muted">{REMOTE_RULE_TEXT}</small>
                </label>
              </>
            )}
            {asksCalibration(meterForm) && (
              <>
                <Field
                  label="Geeicht bis Ende (Jahr)"
                 
                  className="grow"
                  hint={<>Die <Term id="meterCalibration">Eichfrist</Term> endet mit dem Ende dieses Jahres. Hat der Messdienst sie im Stichprobenverfahren verlängern lassen (§ 35 MessEV), tragen Sie das verlängerte Jahr ein.</>}
                  {...meterErrors.field('calibratedUntil')}
                >
                  <input inputMode="numeric" value={meterForm.calibratedUntil} onChange={(e) => setMeterForm({ ...meterForm, calibratedUntil: e.target.value })} />
                </Field>
                <label className="field grow">
                  Jahreszahl auf dem Zähler (etwa „M22“ oder die Jahresangabe der Eichmarke)
                  <input inputMode="numeric" value={markedYear} onChange={(e) => setMarkedYear(e.target.value)} placeholder="für einen Vorschlag" />
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
  readingForm: ReadingForm
  setReadingForm: (f: ReadingForm) => void
  onSaveReading: () => void
  readingErrors: FormErrors<ReadingField>
  onDeleteReading: (r: Reading) => void
  onSaved: () => void
}) {
  const { meter: m, focused, cons, open, readings, unitName, consumptionLabel, onToggle, onEdit, onDelete, readingForm, setReadingForm, onSaveReading, readingErrors, onDeleteReading, onSaved } = props
  return (
    <>
      <tr className={focused ? 'focus-target' : undefined}>
        <td data-label="Zähler">
          {m.name}
          {m.meterNumber && <div className="muted">Nr. {m.meterNumber}</div>}
          {hcaSummary(m) && <div className="muted">{hcaSummary(m)}</div>}
          {m.calibratedUntil != null && <div className="muted">geeicht bis Ende {m.calibratedUntil}</div>}
          {/* Die abgelaufene Eichfrist ist eine Warnung und kein Fehler der Stände (Heizung PR 21). */}
          {cons?.warnings.map((w, i) => <div key={i} className={cons.notices?.[i]?.code === 'meter.calibration-overdue' ? 'warn' : 'error'}>{w}</div>)}
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
                        {r.value.toLocaleString('de-DE')}
                        {r.replacement && <div className="muted">{isCutoffReading(m.type, r) ? 'Stichtagswert' : 'Endstand alt'}: {oldEndText(r.oldEndValue)}</div>}
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
            <RequiredLegend />
            <div className="row">
              <Field label="Datum" required {...readingErrors.field('date')}>
                <input type="date" value={readingForm.date} onChange={(e) => setReadingForm({ ...readingForm, date: e.target.value })} />
              </Field>
              <Field label={readingForm.replacement ? 'Startstand neuer Zähler' : 'Zählerstand'} required {...readingErrors.field('value')}>
                <input value={readingForm.value} onChange={(e) => setReadingForm({ ...readingForm, value: e.target.value })} className="input-num" />
              </Field>
              <label className="field checkline">
                <span>
                  <input type="checkbox" checked={readingForm.replacement} onChange={(e) => setReadingForm({ ...readingForm, replacement: e.target.checked })} />
                  Zählerwechsel
                </span>
              </label>
              {readingForm.replacement && (
                <Field label="Endstand alter Zähler" hint="Leer lassen, wenn er fehlt." {...readingErrors.field('oldEndValue')}>
                  <input value={readingForm.oldEndValue} onChange={(e) => setReadingForm({ ...readingForm, oldEndValue: e.target.value })} className="input-num" />
                </Field>
              )}
              <Field label="Hinweis" className="grow">
                <input value={readingForm.note} onChange={(e) => setReadingForm({ ...readingForm, note: e.target.value })} placeholder="z. B. Zwischenablesung Auszug Müller" />
              </Field>
              <button className="btn" onClick={onSaveReading}>Ablesung speichern</button>
            </div>
            <ErrorSummary errors={readingErrors} />
            <p className="muted">
              Tipp: Beim Mieterwechsel am Auszugstag eine Zwischenablesung erfassen — dann wird der
              Verbrauch exakt statt tagesanteilig geschätzt aufgeteilt.
            </p>
            {m.type === 'hkv' && <CutoffReadingForm meterId={m.id} onSaved={onSaved} />}
          </td>
        </tr>
      )}
    </>
  )
}
