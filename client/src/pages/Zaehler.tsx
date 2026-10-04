import { useCallback, useEffect, useState } from 'react'
import type { Meter, MeterType, Reading, Unit } from '../types'
import { METER_TYPE_LABELS } from '../types'
import { buildReadingBody, EMPTY_READING, type ReadingForm } from '../readingForm'
import { defaultMeterUnit, emptyMeterForm, oldEndText, withMeterType, type MeterForm } from '../meterForm'
import { api, errorText, fmtDate } from '../api'
import { useYear } from '../year'
import { useOpenForm, useProperty, withProperty, useSwitchYear } from '../property'
import Drawer from '../components/Drawer'
import PageHeader from '../components/PageHeader'
import Term from '../components/Term'
import { useToast, useConfirm } from '../components/feedback'
import Table from '../components/Table'
import { useFocusTarget, useScrollToFocus, type FocusProps } from '../focus'

type Props = { units: Unit[] } & FocusProps

type Consumption = { meterId: string; consumption: number; readingCount: number; warnings: string[] }

export default function Zaehler({ units, focus, onFocusDone }: Props) {
  const { year } = useYear()
  // Fragt bei offenem Formular nach, wie der Objektwechsel (Durchsicht zu #141).
  const switchYear = useSwitchYear()
  const { property } = useProperty()
  const propertyId = property?.id
  const toast = useToast()
  const confirm = useConfirm()
  const [meters, setMeters] = useState<Meter[]>([])
  const [readings, setReadings] = useState<Reading[]>([])
  const [consumption, setConsumption] = useState<Consumption[]>([])
  const [meterForm, setMeterForm] = useState<MeterForm | null>(null)
  const [openMeterId, setOpenMeterId] = useState<string | null>(null)
  const [readingForm, setReadingForm] = useState<ReadingForm>({ ...EMPTY_READING })
  const [error, setError] = useState('')
  // „Hier beheben →“ aus der Abrechnung (#142): die Ablesungen des betroffenen Zählers aufklappen,
  // denn dort liegt, was ein Hinweis zu einem Zähler meint.
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const scrollToFocus = useScrollToFocus()
  useFocusTarget(focus, 'meter', meters, (m) => m.id, (m) => { setOpenMeterId(m.id); setFocusedId(m.id); scrollToFocus() }, onFocusDone)
  // Eine angefangene Ablesung hängt am Zähler dieses Objekts (#145).
  useOpenForm(openMeterId !== null && (readingForm.date !== '' || readingForm.value.trim() !== '' || readingForm.oldEndValue.trim() !== '' || readingForm.note.trim() !== ''))

  const load = useCallback(async () => {
    const [m, r, c] = await Promise.all([
      api<Meter[]>(withProperty('/api/meters', propertyId)),
      api<Reading[]>(withProperty('/api/readings', propertyId)),
      api<Consumption[]>(withProperty(`/api/consumption/${year}`, propertyId)),
    ])
    setMeters(m)
    setReadings(r)
    setConsumption(c)
  }, [year, propertyId])

  useEffect(() => {
    load().catch(() => setError('Server nicht erreichbar.'))
  }, [load])

  async function saveMeter() {
    if (!meterForm) return
    if (!meterForm.name.trim()) {
      setError('Bitte einen Namen für den Zähler angeben.')
      return
    }
    setError('')
    const body = JSON.stringify({
      name: meterForm.name.trim(),
      unitId: meterForm.unitId || null,
      type: meterForm.type,
      meterNumber: meterForm.meterNumber.trim() || undefined,
      // Ohne Angabe die Vorgabe der Sparte (#142), nicht für jede Sparte „m³“.
      unit: meterForm.unit.trim() || defaultMeterUnit(meterForm.type),
    })
    const editing = !!meterForm.id
    // Lehnt der Server ab (#146), bleibt der Dialog offen und zeigt seinen Satz.
    try {
      if (editing) await api(`/api/meters/${meterForm.id}`, { method: 'PUT', body })
      else await api(withProperty('/api/meters', propertyId), { method: 'POST', body })
    } catch (e) {
      setError(errorText(e))
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
      setError(errorText(e))
      return
    }
    setError('')
    await load()
    toast(`Zähler „${m.name}“ gelöscht.`)
  }

  async function saveReading(meterId: string) {
    const built = buildReadingBody(readingForm, meterId)
    if ('error' in built) {
      setError(built.error)
      return
    }
    setError('')
    try {
      await api('/api/readings', { method: 'POST', body: JSON.stringify(built.body) })
    } catch (e) {
      setError(errorText(e))
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
      setError(errorText(e))
      return
    }
    setError('')
    await load()
    toast('Ablesung gelöscht.')
  }

  const unitName = (id: string | null) => (id ? units.find((u) => u.id === id)?.name ?? '?' : 'Haus (Hauptzähler)')

  return (
    <>
      <PageHeader
        title="Zähler"
        subtitle={'Zählerstände dokumentieren — Jahresablesung, Zwischenablesung beim Mieterwechsel, Zählerwechsel. Wohnungszähler ermöglichen den Umlageschlüssel „nach Verbrauch“.'}
      />
      {error && !meterForm && <div className="error">{error}</div>}

      <div className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }} className="grow">Zähler</h2>
          <label className="field">
            Verbrauchsjahr
            <select value={year} onChange={(e) => void switchYear(Number(e.target.value))}>
              {Array.from({ length: 8 }, (_, k) => new Date().getFullYear() - k).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
        </div>
        {meters.length === 0 && (
          <div className="empty">
            Noch keine Zähler angelegt. Legen Sie z. B. den Hauptwasserzähler an, um die Jahresstände zu
            dokumentieren — oder Wohnungszähler, um nach Verbrauch abzurechnen.
          </div>
        )}
        {meters.length > 0 && (
          <Table>
            <thead>
              <tr>
                <th>Zähler</th>
                <th>Zuordnung</th>
                <th>Sparte</th>
                <th className="num">Verbrauch {year}</th>
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
                    onToggle={() => { setError(''); setOpenMeterId(openMeterId === m.id ? null : m.id); setReadingForm({ ...EMPTY_READING }) }}
                    onEdit={() => { setError(''); setMeterForm({ id: m.id, name: m.name, unitId: m.unitId ?? '', type: m.type, meterNumber: m.meterNumber ?? '', unit: m.unit }) }}
                    onDelete={() => deleteMeter(m)}
                    readingForm={readingForm}
                    setReadingForm={setReadingForm}
                    onSaveReading={() => saveReading(m.id)}
                    onDeleteReading={deleteReading}
                  />
                )
              })}
            </tbody>
          </Table>
        )}

        <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => { setError(''); setMeterForm(emptyMeterForm()) }}>
          + Zähler hinzufügen
        </button>
      </div>

      {meterForm && (
        <Drawer
          open
          title={meterForm.id ? 'Zähler bearbeiten' : 'Neuer Zähler'}
          subtitle={meterForm.id ? meterForm.name : undefined}
          onClose={() => { setError(''); setMeterForm(null) }}
          onSubmit={saveMeter}
          footer={
            <>
              <span className="drawer-hint">Strg+S speichert · Esc schließt</span>
              <span className="spacer" />
              <button className="btn ghost" onClick={() => { setError(''); setMeterForm(null) }}>Abbrechen</button>
              <button className="btn" onClick={saveMeter}>{meterForm.id ? 'Übernehmen' : 'Anlegen'}</button>
            </>
          }
        >
          {error && <div className="error">{error}</div>}
          <div className="row">
            <label className="field grow">
              Name
              <input value={meterForm.name} onChange={(e) => setMeterForm({ ...meterForm, name: e.target.value })} placeholder="z. B. Hauptwasserzähler" />
            </label>
            <label className="field grow">
              <span>Zuordnung (<Term id="mainMeter">Haupt- oder Zwischenzähler</Term>)</span>
              <select value={meterForm.unitId} onChange={(e) => setMeterForm({ ...meterForm, unitId: e.target.value })}>
                <option value="">Haus (Hauptzähler)</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <small className="muted">Bei einer <Term id="granny">Einliegerwohnung</Term> mit eigenem Zwischenzähler: den Zähler des Hauses als Hauptzähler anlegen, den Zwischenzähler an der Wohnung.</small>
            </label>
            <label className="field grow">
              Sparte
              <select value={meterForm.type} onChange={(e) => setMeterForm(withMeterType(meterForm, e.target.value as MeterType))}>
                {(Object.keys(METER_TYPE_LABELS) as MeterType[]).map((t) => (
                  <option key={t} value={t}>{METER_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </label>
            <label className="field grow">
              Zählernummer
              <input value={meterForm.meterNumber} onChange={(e) => setMeterForm({ ...meterForm, meterNumber: e.target.value })} placeholder="optional" />
            </label>
            <label className="field grow">
              Einheit
              <input value={meterForm.unit} onChange={(e) => setMeterForm({ ...meterForm, unit: e.target.value })} />
            </label>
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
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  readingForm: ReadingForm
  setReadingForm: (f: ReadingForm) => void
  onSaveReading: () => void
  onDeleteReading: (r: Reading) => void
}) {
  const { meter: m, focused, cons, open, readings, unitName, onToggle, onEdit, onDelete, readingForm, setReadingForm, onSaveReading, onDeleteReading } = props
  return (
    <>
      <tr className={focused ? 'focus-target' : undefined}>
        <td>
          {m.name}
          {m.meterNumber && <div className="muted">Nr. {m.meterNumber}</div>}
          {cons?.warnings.map((w, i) => <div key={i} className="error" style={{ marginTop: 6 }}>{w}</div>)}
        </td>
        <td>{unitName}</td>
        <td>{METER_TYPE_LABELS[m.type] ?? m.type}</td>
        <td className="num">
          {cons && cons.readingCount >= 2
            ? `${cons.consumption.toLocaleString('de-DE')}${m.unit ? ` ${m.unit}` : ''}`
            : <span className="muted">zu wenig Ablesungen</span>}
        </td>
        <td className="actions no-print" style={{ whiteSpace: 'nowrap' }}>
          <button className="btn small secondary" onClick={onToggle}>{open ? 'Schließen' : `Ablesungen (${readings.length})`}</button>
          {' '}
          <button className="icon-btn" title="Bearbeiten" aria-label="Zähler bearbeiten" onClick={onEdit}>✎</button>
          <button className="icon-btn danger" title="Löschen" aria-label="Zähler löschen" onClick={onDelete}>🗑</button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ background: 'var(--bg)', borderRadius: 8 }}>
            {readings.length > 0 && (
              <Table style={{ marginBottom: 10 }}>
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
                        {r.replacement && <div className="muted">Endstand alt: {oldEndText(r.oldEndValue)}</div>}
                      </td>
                      <td className="muted">
                        {r.replacement && <span className="badge gray">Zählerwechsel</span>} {r.note}
                      </td>
                      <td className="actions"><button className="icon-btn danger" title="Löschen" aria-label="Ablesung löschen" onClick={() => onDeleteReading(r)}>🗑</button></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <div className="row">
              <label className="field">
                Datum
                <input type="date" value={readingForm.date} onChange={(e) => setReadingForm({ ...readingForm, date: e.target.value })} />
              </label>
              <label className="field">
                {readingForm.replacement ? 'Startstand neuer Zähler' : 'Zählerstand'}
                <input value={readingForm.value} onChange={(e) => setReadingForm({ ...readingForm, value: e.target.value })} style={{ width: 110 }} />
              </label>
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 9 }}>
                <input type="checkbox" checked={readingForm.replacement} onChange={(e) => setReadingForm({ ...readingForm, replacement: e.target.checked })} />
                Zählerwechsel
              </label>
              {readingForm.replacement && (
                <label className="field">
                  Endstand alter Zähler
                  <input value={readingForm.oldEndValue} onChange={(e) => setReadingForm({ ...readingForm, oldEndValue: e.target.value })} style={{ width: 110 }} />
                </label>
              )}
              <label className="field grow">
                Hinweis
                <input value={readingForm.note} onChange={(e) => setReadingForm({ ...readingForm, note: e.target.value })} placeholder="z. B. Zwischenablesung Auszug Müller" />
              </label>
              <button className="btn" onClick={onSaveReading}>Ablesung speichern</button>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              Tipp: Beim Mieterwechsel am Auszugstag eine Zwischenablesung erfassen — dann wird der
              Verbrauch exakt statt tagesanteilig geschätzt aufgeteilt.
            </p>
          </td>
        </tr>
      )}
    </>
  )
}
