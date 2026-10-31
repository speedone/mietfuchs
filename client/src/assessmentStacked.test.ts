// Nutzerrückmeldung zu #490 („sieht sehr verbuggt aus“): Die Prüfung einer Auswertung (AssessmentReview, Eingang und
// Kosten) musste am Handy seitlich gewischt werden. Unter 640 px steht jede Zeile als Block: Felder untereinander in
// voller Breite, jede mit ihrer Beschriftung (`data-label`). Am Rechner bleibt die Tabelle.
import { expect, test } from 'vitest'

// Gelesen mit node:fs wie in uiRules.test.ts; ein Import mit `?raw` ergäbe für CSS einen leeren Text.
const fsModule = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
const css = fs.readFileSync(new URL('./fields.css', import.meta.url), 'utf8')
const review = fs.readFileSync(new URL('./components/AssessmentReview.tsx', import.meta.url), 'utf8')

test('fields.css stapelt die Tabelle der Prüfung unter 640 px, Felder in voller Breite, Beschriftung darüber', () => {
  const block = css.match(/@media screen and \(max-width: 640px\) \{([\s\S]*?)\n\}/g)?.find((b: string) => b.includes('assessment-table')) ?? ''
  expect(block).toMatch(/table\.assessment-table[^{]*\{[^}]*display: block/)
  expect(block).toMatch(/table\.assessment-table > thead[^{]*\{[^}]*clip-path/)
  expect(block).toMatch(/td\[data-label\]::before[^{]*\{[^}]*content: attr\(data-label\)/)
  expect(block).toMatch(/:is\(select, input\)[^{]*\{[^}]*width: 100%/)
})

test('jede Zelle mit Feld trägt ihre Beschriftung', () => {
  for (const label of ['Beschreibung', 'Kostenart', 'Umlageschlüssel', 'Betrag €', '§35a-Lohn €']) {
    expect(review, label).toContain(`data-label="${label}"`)
  }
})
