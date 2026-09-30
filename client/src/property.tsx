import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
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

export function PropertyProvider({ children }: { children: ReactNode }) {
  const [properties, setProperties] = useState<Property[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(remembered)

  const reload = useCallback(async () => {
    setProperties(await api<Property[]>('/api/properties'))
  }, [])

  useEffect(() => {
    reload().catch((e) => console.error(e))
  }, [reload])

  const setPropertyId = useCallback((id: string) => {
    remember(id)
    setSelectedId(id)
  }, [])

  const property = chooseProperty(properties, selectedId)
  return <Ctx.Provider value={{ properties, property, setPropertyId, reload }}>{children}</Ctx.Provider>
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
