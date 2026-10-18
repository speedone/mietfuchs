// Eine Angabe, die so nicht gespeichert werden kann (#346, Schritt 3). Ohne React, damit die Prüfungen der
// Formulare (paymentForm.ts, readingForm.ts …) sie liefern und ohne DOM getestet werden können; angezeigt
// werden sie über `useFormError` mit `<Field>` und `<ErrorSummary>` (components/ErrorSummary.tsx).
//
// Wortlaut nach GOV.UK: Am Feld steht die kurze Fassung (`short`, „Datum fehlt“), in der Sammelmeldung die
// Fassung mit Ort (`text`, „Zahlung: Geben Sie das Datum ein, an dem das Geld eingegangen ist.“). Fehlt
// `short`, steht am Feld derselbe Satz. Ohne `field` betrifft die Meldung das Ganze, etwa die Ablehnung
// durch den Server; sie steht dann nur in der Sammelmeldung, ohne Link.
export type Problem<F extends string = string> = { field?: F; text: string; short?: string }

// Das Ergebnis einer Prüfung: entweder der Rumpf oder die Liste der Angaben, die fehlen oder nicht passen.
export type Checked<T, F extends string = string> = { body: T } | { problems: Problem<F>[] }

// Alle Sätze einer Liste in einem, für Stellen, die nur einen Text zeigen können (Mitteilung, Tests).
export const problemsText = (problems: readonly Problem[]): string => problems.map((p) => p.text).join(' ')
