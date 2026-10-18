// Für Tests einzelner Karten (#346, Schritt 7a): ob eine Karte sich als offenes Formular anmeldet, ohne
// PropertyProvider und ohne dessen Abruf der Objekte. `OpenFormScope` stellt die Menge der Anmeldungen
// bereit, `openForms()` zählt sie im Augenblick der Frage, wie es der Umschalter tut.
import { useRef, type ReactNode } from 'react'
import { OpenFormsCtx } from '../property'

let current: Set<symbol> | null = null

export function OpenFormScope({ children }: { children: ReactNode }) {
  const forms = useRef(new Set<symbol>()).current
  current = forms
  return <OpenFormsCtx.Provider value={forms}>{children}</OpenFormsCtx.Provider>
}

// Ob gerade etwas angemeldet ist.
export function hasOpenForm(): boolean {
  if (!current) throw new Error('OpenFormScope fehlt')
  return current.size > 0
}
