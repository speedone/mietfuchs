// Auswahl fürs Ableseformular (#320): welche Zähler aufs Blatt kommen. Gedruckt wird erst nach dem Schließen des Fensters.
// `value` ist die Auswahl: Wer ein Häkchen ändert und dann schließt, wird gefragt (bewusst, wie bei jedem Fenster).
import { useMemo, useState } from 'react'
import Drawer from './Drawer'
import Field from './Field'
import type { HeatingPlant, Meter, Reading, Unit } from '../types'
import { buildReadingSheet, DEFAULT_SHEET_OPTIONS, unitsWithMeters, type ReadingSheet, type SheetOptions } from '../readingSheet'

export default function ReadingSheetDrawer({ meters, readings, units, plants, today, onPrint, onClose }: {
  meters: Meter[]
  readings: Reading[]
  units: Unit[]
  plants: HeatingPlant[]
  today: string
  onPrint: (sheet: ReadingSheet) => void
  onClose: () => void
}) {
  const [options, setOptions] = useState<SheetOptions>(DEFAULT_SHEET_OPTIONS)
  const sheet = useMemo(() => buildReadingSheet({ meters, readings, units, plants, today, options }), [meters, readings, units, plants, today, options])
  const empty = sheet.count === 0
  const print = () => { if (!empty) onPrint(sheet) }
  return (
    <Drawer
      open
      title="Ableseformular drucken"
      subtitle="Ein Blatt mit den Zählern des Objekts, zum Eintragen von Hand."
      hint="Strg+S druckt · Esc schließt"
      onClose={onClose}
      onSubmit={print}
      value={options}
      actions={<>
        <button className="btn" disabled={empty} aria-describedby={empty ? 'reading-sheet-empty' : undefined} onClick={print}>Drucken</button>
        {empty && <span id="reading-sheet-empty" className="muted">Mit dieser Auswahl gibt es keinen Zähler zum Drucken.</span>}
      </>}
    >
      <Field label="Zähler">
        <select value={options.unitId ?? ''} onChange={(e) => setOptions({ ...options, unitId: e.target.value === '' ? null : e.target.value })}>
          <option value="">Alle Zähler des Objekts</option>
          {unitsWithMeters(units, meters).map((u) => <option key={u.id} value={u.id}>Nur {u.name}</option>)}
        </select>
      </Field>
      <label className="checkline">
        <input type="checkbox" checked={options.remote} onChange={(e) => setOptions({ ...options, remote: e.target.checked })} />
        <span>Fernablesbare Zähler aufführen</span>
      </label>
      <label className="checkline">
        <input type="checkbox" checked={options.hca} onChange={(e) => setOptions({ ...options, hca: e.target.checked })} />
        <span>Heizkostenverteiler aufführen</span>
      </label>
      <p className="muted">Zähler mit einer Eichfrist, die in diesem oder im nächsten Jahr endet oder schon abgelaufen ist, sind auf dem Blatt gekennzeichnet.</p>
    </Drawer>
  )
}
