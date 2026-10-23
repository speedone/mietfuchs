import { useState } from 'react'
import { PROPERTY_KIND_LABELS } from '../types'
import { useProperty, useSwitchProperty } from '../property'
import { propertyName } from '../propertyView'
import Card from './Card'
import Table from './Table'
import NewPropertyDrawer, { useOpenNewProperty } from './NewPropertyDrawer'

// Die Karte „Weitere Objekte“ in den Stammdaten, unter der Karte „Objekt“. Wer ein zweites Haus anlegen will, sucht
// dort, wo das erste steht; im Seitenkopf wirkte der Knopf wie die Hauptaktion der Seite, in der Seitenleiste wurde
// er übersehen. „+ Objekt anlegen“ steht deshalb oben rechts wie „+ Wohnung anlegen“. Bearbeitet wird nur das
// gewählte Objekt (Karte „Objekt“); die übrigen stehen hier nur zum Wechseln, damit die Seite nicht die Angaben
// des einen und die Wohnungen eines anderen zeigt.
export default function OtherPropertiesCard() {
  const { properties, property } = useProperty()
  const switchProperty = useSwitchProperty()
  const openShared = useOpenNewProperty()
  // Ohne NewPropertyProvider (die Seite allein im Test) ein eigenes Fenster.
  const [ownOpen, setOwnOpen] = useState(false)
  const others = properties.filter((p) => p.id !== property?.id)

  return (
    <Card title="Weitere Objekte" aside={<button className="btn secondary" onClick={() => (openShared ?? (() => setOwnOpen(true)))()}>+ Objekt anlegen</button>}>
      {others.length === 0 && (
        <p className="muted m-0">
          Vermieten Sie noch ein Haus oder eine Eigentumswohnung? Legen Sie es als eigenes Objekt an, mit eigenen
          Wohnungen, Zählern, Kosten und Abrechnungen. „{property ? propertyName(property) : 'Ihr Objekt'}“ bleibt
          dabei unverändert.
        </p>
      )}
      {others.length > 0 && (
        <Table className="stacked">
          <thead>
            <tr>
              <th>Bezeichnung</th>
              <th>Art</th>
              <th>Adresse</th>
              <th className="no-print"></th>
            </tr>
          </thead>
          <tbody>
            {others.map((p) => (
              <tr key={p.id}>
                <td data-label="Bezeichnung">{propertyName(p)}</td>
                <td data-label="Art">{PROPERTY_KIND_LABELS[p.kind]}</td>
                <td data-label="Adresse">{p.address.trim() || '—'}</td>
                <td className="actions no-print">
                  {/* Der Name beginnt mit dem sichtbaren Wort (WCAG 2.5.3). */}
                  <button className="btn secondary small" onClick={() => void switchProperty(p.id, propertyName(p))}>
                    Wechseln{' '}<span className="sr-only">zu „{propertyName(p)}“</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {!openShared && <NewPropertyDrawer open={ownOpen} onClose={() => setOwnOpen(false)} />}
    </Card>
  )
}
