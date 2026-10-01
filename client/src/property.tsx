import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from './api'
import type { Property } from './types'

// Das gewählte Objekt (#92), nach dem Muster des Abrechnungsjahres (year.tsx): Die ganze
// Oberfläche ist immer „in“ einem Objekt, und der Umschalter in der Seitenleiste verstellt
// denselben Wert für alle Seiten.
//
// Wer ein Haus vermietet, hat genau ein Objekt und sieht davon nichts: Der Umschalter erscheint
// erst ab dem zweiten, und die Routen nehmen ohne Angabe das einzige.

type PropertyCtx = {
  properties: Property[]
  property: Property | null
  setPropertyId: (id: string) => void
  reload: () => Promise<void>
  // Ob gerade ein Formular offen ist (#145), siehe useOpenForm.
  hasOpenForm: () => boolean
}

const Ctx = createContext<PropertyCtx | null>(null)

// Gemerkt je Browser, eine Annehmlichkeit: Ohne Speicher (privates Fenster) gilt das erste Objekt.
const STORAGE_KEY = 'mietfuchs.property'
const remembered = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}
const remember = (id: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Ohne Speicher gilt beim nächsten Öffnen wieder das erste Objekt.
  }
}

// Die gemerkte Wahl, sonst das erste Objekt. Ist das gemerkte inzwischen gelöscht, ebenfalls
// das erste, statt ins Leere zu zeigen.
export function chooseProperty(properties: Property[], rememberedId: string | null): Property | null {
  return properties.find((p) => p.id === rememberedId) ?? properties[0] ?? null
}

// Hängt das Objekt an die Adresse eines Abrufs. Ohne Objekt bleibt sie, wie sie ist; dann gilt
// auf dem Server das einzige.
export function withProperty(path: string, propertyId: string | null | undefined): string {
  if (!propertyId) return path
  return `${path}${path.includes('?') ? '&' : '?'}property=${encodeURIComponent(propertyId)}`
}

// Offene Formulare (#145). Ein Formular hält Verweise in das Objekt, in dem es geöffnet wurde (das
// Mietverhältnis einer Zahlung, die Wohnung eines Mietverhältnisses), oder legt im gerade
// gewählten Objekt an. Wechselte das Objekt darunter, landete der Eintrag still im falschen Haus.
// Deshalb melden sich offene Formulare hier an, und der Umschalter fragt vor dem Wechsel nach;
// nach dem Wechsel stellt die Oberfläche die Seiten neu auf (App.tsx), offene Formulare sind
// dann zu. Eine Anmeldung ist eine Marke in einer Menge und kein Zustand: Sie soll nichts neu
// zeichnen, gefragt wird erst im Augenblick des Wechsels.
const OpenFormsCtx = createContext<Set<symbol> | null>(null)

// Meldet ein Formular an, solange `open` gilt. Der Drawer tut das von selbst; Formulare ohne
// Drawer rufen es selbst auf. Außerhalb des Providers (Tests einzelner Teile) geschieht nichts.
export function useOpenForm(open: boolean): void {
  const forms = useContext(OpenFormsCtx)
  useEffect(() => {
    if (!open || !forms) return
    const mark = Symbol('Formular')
    forms.add(mark)
    return () => { forms.delete(mark) }
  }, [open, forms])
}

export function PropertyProvider({ children }: { children: ReactNode }) {
  const openForms = useRef(new Set<symbol>()).current
  const hasOpenForm = useCallback(() => openForms.size > 0, [openForms])
  const [properties, setProperties] = useState<Property[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(remembered)
  // Ob die Liste einmal geantwortet hat. Bis dahin zeigt der Provider nichts: Eine Seite, die
  // vorher lädt, fragte ohne Objekt, und bei mehreren Objekten antwortet der Server darauf mit
  // 400. Auch eine gescheiterte Antwort zählt, sonst bliebe die Oberfläche leer, wo sie gerade
  // erklären soll, dass die Datenbank nicht verfügbar ist.
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    try {
      setProperties(await api<Property[]>('/api/properties'))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    reload().catch((e) => console.error(e))
  }, [reload])

  const setPropertyId = useCallback((id: string) => {
    remember(id)
    setSelectedId(id)
  }, [])

  const property = chooseProperty(properties, selectedId)
  return (
    <OpenFormsCtx.Provider value={openForms}>
      <Ctx.Provider value={{ properties, property, setPropertyId, reload, hasOpenForm }}>{loaded ? children : null}</Ctx.Provider>
    </OpenFormsCtx.Provider>
  )
}

export function useProperty(): PropertyCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useProperty() muss innerhalb von <PropertyProvider> stehen')
  return c
}

// Der Umschalter in der Seitenleiste. Bei höchstens einem Objekt gibt es nichts zu wählen und
// deshalb auch nichts zu sehen.
export function PropertySwitcher({ properties, value, onChange }: {
  properties: Property[]
  value: string | undefined
  onChange: (id: string) => void
}) {
  if (properties.length <= 1) return null
  return (
    <label className="year-switcher no-print">
      <span>Objekt</span>
      <select aria-label="Objekt wählen" value={value} onChange={(e) => onChange(e.target.value)}>
        {properties.map((p) => <option key={p.id} value={p.id}>{p.name || 'Ohne Namen'}</option>)}
      </select>
    </label>
  )
}
