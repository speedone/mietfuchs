import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { api } from './api'
import { useConfirm } from './components/feedback'
import type { Property } from './types'
import { propertyHeading } from './propertyView'
import { useYear } from './year'

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
  // Das vorher gewählte Objekt (#157), für „Zurück zu …“ nach dem Wechsel in ein leeres Objekt.
  previousId: string | null
  // Ein eben über den Dialog angelegtes Objekt (#157): Der Hinweis „noch keine Wohnungen“ nimmt
  // dann den Fokus, damit ein Screenreader den Wechsel ansagt. Nach dem Fokussieren `null`.
  focusNoticeFor: string | null
  setFocusNoticeFor: (id: string | null) => void
  reload: () => Promise<void>
  // Ob gerade ein Formular offen ist (#145), siehe useOpenForm.
  hasOpenForm: () => boolean
}

const Ctx = createContext<PropertyCtx | null>(null)

// Gemerkt je Browser, eine Annehmlichkeit: Ohne Speicher (privates Fenster) gilt das erste Objekt.
const STORAGE_KEY = 'mietfuchs.property'
const PREVIOUS_KEY = 'mietfuchs.property.previous'
const remembered = (key = STORAGE_KEY): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const remember = (id: string, key = STORAGE_KEY): void => {
  try {
    localStorage.setItem(key, id)
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
// Als Layout-Effekt, damit die Marke mit dem Gezeichneten übereinstimmt: Ein gewöhnlicher Effekt
// läuft erst nach dem Zeichnen, und ein Wechsel in dieser Lücke fragte bei einem eben
// geschlossenen Formular nach oder bei einem eben geöffneten nicht.
export function useOpenForm(open: boolean): void {
  const forms = useContext(OpenFormsCtx)
  useLayoutEffect(() => {
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
  const [selectedId, setSelectedId] = useState<string | null>(() => remembered())
  // Gemerkt wie die Wahl selbst, damit der Hinweis „Ihre Daten in … sind unverändert“ auch nach
  // einem Neuladen der Seite das richtige Objekt nennt.
  const [previousId, setPreviousId] = useState<string | null>(() => remembered(PREVIOUS_KEY))
  const [focusNoticeFor, setFocusNoticeFor] = useState<string | null>(null)
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

  const property = chooseProperty(properties, selectedId)
  // Das tatsächlich gewählte Objekt, nicht die gemerkte Kennung: Die kann auf ein gelöschtes zeigen.
  const currentId = useRef<string | null>(null)
  currentId.current = property?.id ?? null

  const setPropertyId = useCallback((id: string) => {
    const before = currentId.current
    if (before && before !== id) {
      remember(before, PREVIOUS_KEY)
      setPreviousId(before)
    }
    remember(id)
    setSelectedId(id)
  }, [])

  return (
    <OpenFormsCtx.Provider value={openForms}>
      <Ctx.Provider value={{ properties, property, setPropertyId, previousId, focusNoticeFor, setFocusNoticeFor, reload, hasOpenForm }}>{loaded ? children : null}</Ctx.Provider>
    </OpenFormsCtx.Provider>
  )
}

export function useProperty(): PropertyCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useProperty() muss innerhalb von <PropertyProvider> stehen')
  return c
}

// Der Name des gewählten Objekts für den Seitenkopf, ab zwei Objekten (#157). Außerhalb des
// Providers (Tests einzelner Seiten) ohne Namen, statt zu werfen wie useProperty.
export function usePropertyHeading(): string | null {
  const c = useContext(Ctx)
  return c ? propertyHeading(c.properties, c.property) : null
}

// Der eine Weg, das Objekt zu wechseln (#145), für den Umschalter wie für „Weiteres Objekt
// anlegen“. Ist ein Formular offen, wird erst gefragt; wer ablehnt, bleibt im bisherigen Objekt,
// mit Formular und Eingaben. Nach dem Wechsel stellt App.tsx die Seiten neu auf, offene Formulare
// sind dann zu und können nichts mehr ins vorige Objekt speichern. Ergibt, ob gewechselt wurde.
// `name` ist für ein eben angelegtes Objekt, das in der Liste noch fehlen kann.
export function useSwitchProperty(): (id: string, name?: string) => Promise<boolean> {
  const { properties, property, setPropertyId, hasOpenForm } = useProperty()
  const confirm = useConfirm()
  return useCallback(async (id: string, name?: string) => {
    if (id === property?.id) return true
    if (hasOpenForm()) {
      const targetName = name ?? properties.find((p) => p.id === id)?.name
      const ok = await confirm({
        title: 'Offene Eingaben verwerfen?',
        message: `Sie haben in „${property?.name || 'Ohne Namen'}“ ein Formular offen oder eine Belegauswertung noch nicht übernommen. Beim Wechsel zu „${targetName || 'Ohne Namen'}“ wird das geschlossen, ohne zu speichern.`,
        confirmLabel: 'Objekt wechseln',
        cancelLabel: 'Abbrechen',
      })
      if (!ok) return false
    }
    setPropertyId(id)
    return true
  }, [properties, property, setPropertyId, hasOpenForm, confirm])
}

// Der eine Weg, das Abrechnungsjahr zu wechseln (Durchsicht zu #141), mit derselben Rückfrage wie
// beim Objekt: Ein offenes Formular legt im gewählten Jahr an, und die Vorlagenliste „Aus dem
// Vorjahr übernehmen“ gehört zu ihrem Jahr. Nach dem Wechsel stellt App.tsx die Seiten neu auf.
// Außerhalb des Providers (Tests einzelner Teile) wird ohne Rückfrage gewechselt.
export function useSwitchYear(): (year: number) => Promise<boolean> {
  const { year, setYear } = useYear()
  const ctx = useContext(Ctx)
  const confirm = useConfirm()
  return useCallback(async (next: number) => {
    if (next === year) return true
    if (ctx?.hasOpenForm()) {
      const ok = await confirm({
        title: 'Offene Eingaben verwerfen?',
        message: `Sie haben für ${year} ein Formular offen oder Eingaben noch nicht übernommen. Beim Wechsel zu ${next} wird das geschlossen, ohne zu speichern.`,
        confirmLabel: 'Jahr wechseln',
        cancelLabel: 'Abbrechen',
      })
      if (!ok) return false
    }
    setYear(next)
    return true
  }, [year, setYear, ctx, confirm])
}

// Der Umschalter in der Seitenleiste. Bei höchstens einem Objekt gibt es nichts zu wählen und
// deshalb auch nichts zu sehen.
export function PropertySwitcher({ properties, value, onChange }: {
  properties: Property[]
  value: string | undefined
  onChange: (id: string) => void
}) {
  if (properties.length <= 1) return null
  const current = properties.find((p) => p.id === value)
  // Ein Auswahlfeld bricht seinen Text nicht um und schnitt lange Namen ab (#180). Der Name steht
  // deshalb ganz als Text da, der umbrechen darf, und das Auswahlfeld liegt unsichtbar darüber:
  // Klick, Tastatur und Vorleser bedienen weiter das echte Feld.
  return (
    <label className="year-switcher property-switcher no-print">
      <span>Objekt</span>
      <div className="property-select">
        <span className="property-current" aria-hidden="true">{current ? current.name || 'Ohne Namen' : ''}</span>
        <select aria-label="Objekt wählen" title={current?.name} value={value} onChange={(e) => onChange(e.target.value)}>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name || 'Ohne Namen'}</option>)}
        </select>
      </div>
    </label>
  )
}
