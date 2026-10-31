// Ein Knopf, der etwas in der Seite auf- und zuklappt („Mehr dazu“, „Rechenweg“, „Mehr“ der Abrechnung). Der Text
// nennt, was ein Klick jetzt tut (zu: `closedLabel`, offen: `openLabel`), `aria-expanded` den Zustand. Den Pfeil davor
// (▸ zu, ▾ offen) zeichnet in index.css dieselbe Regel wie bei jedem <summary>, über die Klasse `disclosure`; er
// steht deshalb nicht im Text. Menüs und Popover sind keine Aufklapper (popover.tsx).
export default function DisclosureButton({ open, onToggle, closedLabel, openLabel, controls, className, describedBy }: {
  open: boolean
  onToggle: () => void
  closedLabel: string
  openLabel: string
  // id des Teils, der auf- und zuklappt (`aria-controls`)
  controls?: string
  // weitere Klassen, etwa `btn ghost notice-action`
  className?: string
  // id einer Beschreibung (`aria-describedby`), etwa des Titels eines Hinweises
  describedBy?: string
}) {
  return (
    <button type="button" className={`disclosure${className ? ` ${className}` : ''}`} aria-expanded={open} aria-controls={controls} aria-describedby={describedBy} onClick={onToggle}>
      {open ? openLabel : closedLabel}
    </button>
  )
}
