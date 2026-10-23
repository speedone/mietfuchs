// Auswahl fürs Ableseformular (#320): welche Zähler aufs Blatt kommen. Gedruckt wird erst nach dem Schließen des Fensters.
import { useState } from 'react'
import Drawer from './Drawer'
import type { Unit } from '../types'
import { DEFAULT_SHEET_OPTIONS, type SheetOptions } from '../readingSheet'

export default function ReadingSheetDrawer({ units, onPrint, onClose }: { units: Unit[]; onPrint: (options: SheetOptions) => void; onClose: () => void }) {
  const [options, setOptions] = useState<SheetOptions>(DEFAULT_SHEET_OPTIONS)
  return (
    <Drawer
      open
      title="Ableseformular drucken"
      subtitle="Ein Blatt mit allen Zählern des Objekts, zum Eintragen von Hand."
      onClose={onClose}
      onSubmit={() => onPrint(options)}
      value={options}
      actions={<button className="btn" onClick={() => onPrint(options)}>Drucken</button>}
    >
      <label className="field">
        Zähler
        <select value={options.unitId ?? ''} onChange={(e) => setOptions({ ...options, unitId: e.target.value === '' ? null : e.target.value })}>
          <option value="">Alle Zähler des Objekts</option>
          {units.map((u) => <option key={u.id} value={u.id}>Nur {u.name}</option>)}
        </select>
      </label>
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
