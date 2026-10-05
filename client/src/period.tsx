import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useConfirm } from './components/feedback'
import { anchorOf, localToday, periodView, type PeriodChoice, type PeriodView } from './periodForm'
import { useHasOpenForm, useOptionalProperty } from './property'
import { rulesOf } from '../../shared/period.ts'

// Der Abrechnungszeitraum ist der rote Faden der App (#208): die ganze Oberfläche ist immer „in“
// einem Zeitraum des gewählten Objekts. Statt auf jeder Seite einen eigenen zu führen, liegt die
// Wahl hier zentral; der Umschalter in der Seitenleiste und die Auswahl auf den Seiten verstellen
// denselben Wert. Was daraus folgt (Zeitraum, Bezeichnung, Auswahl), rechnet periodForm.ts.

type Choice = PeriodChoice & {
  setAnchor: (anchor: string | null) => void
  setCalendarYear: (year: number | null) => void
}

const Ctx = createContext<Choice | null>(null)

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [anchor, setAnchor] = useState<string | null>(null)
  const [calendarYear, setCalendarYear] = useState<number | null>(null)
  return <Ctx.Provider value={{ anchor, calendarYear, setAnchor, setCalendarYear }}>{children}</Ctx.Provider>
}

function useChoice(): Choice {
  const c = useContext(Ctx)
  if (!c) throw new Error('usePeriod() muss innerhalb von <PeriodProvider> stehen')
  return c
}

// Der gewählte Zeitraum mit allem, was die Seiten daraus brauchen. Außerhalb des PropertyProvider
// (Tests einzelner Teile) gilt das Kalenderjahr.
export function usePeriod(): PeriodView {
  const { anchor, calendarYear } = useChoice()
  const property = useOptionalProperty()?.property ?? null
  const rules = rulesOf(property)
  const today = localToday()
  return useMemo(() => periodView(rules, { anchor, calendarYear }, today), [rules, anchor, calendarYear, today])
}

// Der eine Weg, den Zeitraum zu wechseln (Durchsicht zu #141), mit derselben Rückfrage wie beim
// Objekt: Ein offenes Formular legt im gewählten Zeitraum an. Nach dem Wechsel stellt App.tsx die
// Seiten neu auf. `value` ist ein Wert der Auswahl (Jahreszahl oder Schlüssel).
export function useSwitchPeriod(): (value: string) => Promise<boolean> {
  const view = usePeriod()
  const { setAnchor } = useChoice()
  const hasOpenForm = useHasOpenForm()
  const confirm = useConfirm()
  return useCallback(async (value: string) => {
    const anchor = anchorOf(view.rules, value)
    if (anchor === null || value === view.param) return value === view.param
    if (hasOpenForm()) {
      const next = view.options.find((o) => o.value === value)?.label ?? value
      const ok = await confirm({
        title: 'Offene Eingaben verwerfen?',
        message: `Sie haben für ${view.label} ein Formular offen oder Eingaben noch nicht übernommen. Beim Wechsel zu ${next} wird das geschlossen, ohne zu speichern.`,
        confirmLabel: view.calendar ? 'Jahr wechseln' : 'Zeitraum wechseln',
        cancelLabel: 'Abbrechen',
      })
      if (!ok) return false
    }
    setAnchor(anchor)
    return true
  }, [view, setAnchor, hasOpenForm, confirm])
}

// Das Kalenderjahr für Mietkonto und Steuer. Beim Kalenderobjekt ist es der Zeitraum selbst.
export function useSwitchCalendarYear(): (year: number) => Promise<boolean> {
  const view = usePeriod()
  const { setCalendarYear } = useChoice()
  const switchPeriod = useSwitchPeriod()
  return useCallback(async (year: number) => {
    if (view.calendar) return switchPeriod(String(year))
    setCalendarYear(year)
    return true
  }, [view.calendar, switchPeriod, setCalendarYear])
}
