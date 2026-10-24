// Wächter zu #346, Schritt 7a: Eine Seite oder Karte mit eigenen Eingaben, die selbst speichert, meldet sich
// als offenes Formular an. Sonst ginge eine angefangene Eingabe beim Wechsel von Seite, Objekt oder Zeitraum
// still verloren. Angemeldet ist, wer `useOpenForm`, `useOpenWhenDiffers` oder `useDraft` benutzt oder in
// einem Seitenfenster (`<Drawer`, meldet sich selbst an) arbeitet.
//
// Geprüft wird der Quelltext, grob: Eine Datei unter components/ oder pages/ mit `<input`, `<select` oder
// `<textarea` und einem Aufruf von `api(` ohne eine der Anmeldungen. Was so auffällt und keine offene Eingabe
// verlieren kann, steht unten mit Grund. Bausteine ohne eigenes `api(` (Feldteile in einem angemeldeten
// Formular) sieht der Wächter nicht; das prüfen die Tests der Karten (testing/openForm.tsx).
import { describe, expect, test } from 'vitest'

const sources: Record<string, string> = import.meta.glob<string>(['./components/*.tsx', './pages/*.tsx', '!./**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const EXCEPTIONS: Record<string, string> = {
  './components/ServiceImportReview.tsx': 'Teil von ServiceImportCard, die sich anmeldet, solange der Vorschlag offen ist.',
  './pages/Steuer.tsx': 'Nur Auswahl des Jahres und der Ansicht, kein ungespeicherter Stand.',
  './pages/Verlauf.tsx': 'Nur die Filter des Verlaufs, kein ungespeicherter Stand; der Rücksprung fragt vorher.',
}

const hasFields = (src: string) => /<input|<select|<textarea/.test(src)
const saves = (src: string) => /\bapi(<[^>]*>)?\(/.test(src)
const registers = (src: string) => /useOpenForm|useOpenWhenDiffers|useDraft|<Drawer/.test(src)

describe('Eingaben melden sich als offenes Formular an (#346, 7a)', () => {
  test('der Wächter sieht die Karten', () => {
    expect(Object.keys(sources)).toContain('./components/HeatingRulesCard.tsx')
    expect(Object.keys(sources).length).toBeGreaterThan(50)
  })

  test('nur die Ausnahmen haben Eingaben, speichern und melden sich nicht an', () => {
    const found = Object.entries(sources)
      .filter(([, src]) => hasFields(src) && saves(src) && !registers(src))
      .map(([file]) => file)
      .sort()
    expect(found).toEqual(Object.keys(EXCEPTIONS).sort())
  })

  test('jede Ausnahme nennt ihren Grund', () => {
    for (const [file, reason] of Object.entries(EXCEPTIONS)) expect(reason, file).toMatch(/\S{10}/)
  })
})
