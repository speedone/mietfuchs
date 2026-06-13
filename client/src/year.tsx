import { createContext, useContext, useState, type ReactNode } from 'react'

// Das Abrechnungsjahr ist der rote Faden der App: die ganze Oberfläche ist immer „in" einem Jahr.
// Statt auf jeder Seite ein eigenes Jahr zu führen, liegt es hier zentral — der Umschalter in der
// Sidebar (und die Selects auf den Einzelseiten) verstellen denselben Wert.
type YearCtx = { year: number; setYear: (y: number) => void }

const Ctx = createContext<YearCtx | null>(null)

// Standard: das Vorjahr — das typische Abrechnungsjahr, das ein Vermieter gerade bearbeitet.
const DEFAULT_YEAR = new Date().getFullYear() - 1

export function YearProvider({ children }: { children: ReactNode }) {
  const [year, setYear] = useState(DEFAULT_YEAR)
  return <Ctx.Provider value={{ year, setYear }}>{children}</Ctx.Provider>
}

export function useYear(): YearCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useYear() muss innerhalb von <YearProvider> stehen')
  return c
}

// Auswahlliste der letzten 8 Jahre — überall identisch verwendet.
export const YEAR_OPTIONS = Array.from({ length: 8 }, (_, k) => new Date().getFullYear() - k)
