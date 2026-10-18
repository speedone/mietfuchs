// Meldungen und Hinweise im Client, die eine Beschriftung zitieren (#346 Schritt 7, Durchsicht S3): Nach dem Umbenennen
// von „Übernehmen“ in „Speichern“ nannte ein Hinweis im Zeitraum der Heizung weiter „Übernehmen“. Wie ui-labels.test.ts
// für den Server sucht dieser Wächter jedes Zitat in „…“, das als Bedienung eingeleitet ist („klicken Sie auf „…““,
// „mit „…““, „Knopf „…““), im Quelltext von client/src (ohne Kommentare und Tests) und verlangt es als **ganze**
// Beschriftung: als Text eines Elements (`>…<`) oder als Zeichenkette (`'…'`), nicht nur als Teil eines längeren Texts.
// Aus shared/ zählen die Zeichenketten mit (Beschriftungen von Auswahlfeldern stehen dort).
//
// Grenze wie bei ui-labels.test.ts: Er sieht den Quelltext, nicht die Seite; dass eine gleichlautende Beschriftung auf
// einer anderen Seite steht, genügt ihm. Zitate mit eingesetzten Werten prüft er nicht.
import { expect, test } from 'vitest'

const own = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./testing/**'], { query: '?raw', import: 'default', eager: true })
const shared = import.meta.glob<string>(['../../shared/**/*.ts'], { query: '?raw', import: 'default', eager: true })
const withoutComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$|\{\/\*[\s\S]*?\*\/\}/gm, '')

const LEAD = /(?:klicken Sie(?: auf)?|Knopf|Schaltfläche|mit|auf) „([^“${}]+)“/g
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Ob `label` irgendwo als ganze Beschriftung steht: Text eines Elements oder eine Zeichenkette für sich. */
const asWholeLabel = (all: string, label: string) => new RegExp(`(?:>\\s*|['"\`])${escape(label)}(?:\\s*<|['"\`])`).test(all)

// Zitate, die keine Beschriftung von Mietfuchs sind, mit Grund.
const NOT_UI: Record<string, string> = {
  'auf „Mieter heizt selbst“': 'Anfang der Option „Mieter heizt selbst (eigener Vertrag …)“ (tenancyModel.ts), gekürzt zitiert',
  'mit „kein Anschluss: Warmwasser“': 'Angabe an der Wohnung, aus Häkchen und Zählerart zusammengesetzt (unitForm.ts)',
  'mit „auf Anfrage“': 'Text im Deckblatt der Belegmappe, keine Beschriftung',
}
// Beschriftungen, die es seit #346 Schritt 7 nicht mehr gibt (oder nur noch anderswo, etwa „Übernehmen“ bei den
// KI-Modellen): Sie darf kein Text mehr als Bedienung zitieren, auch nicht, wenn das Wort noch irgendwo steht.
const RETIRED = ['Übernehmen', 'Hinzufügen', 'Umstellen', 'Tausch speichern', 'OK', 'Ablesung speichern', 'Lieferung speichern', 'Lieferung eintragen', 'Mieterwechsel durchführen', 'Zeitraum wechseln', 'Weiter']

test('zitierte Beschriftungen im Client stehen als ganze Beschriftung in der Oberfläche', () => {
  const all = [...Object.values(own), ...Object.values(shared)].map(withoutComments).join('\n')
  // Probe des Prüfers
  expect(asWholeLabel("<button>Speichern</button> label: 'Ja'", 'Speichern')).toBe(true)
  expect(asWholeLabel("<button>Speichern</button> label: 'Ja'", 'Ja')).toBe(true)
  expect(asWholeLabel('<button>CO₂-Angaben speichern</button>', 'Angaben speichern')).toBe(false)
  const missing: string[] = []
  for (const [file, src] of Object.entries(own)) {
    for (const m of withoutComments(src).matchAll(LEAD)) {
      const key = m[0]
      const label = m[1] ?? ''
      if (Object.hasOwn(NOT_UI, key)) continue
      if (RETIRED.includes(label) || !asWholeLabel(all, label)) missing.push(`${file}: ${key}`)
    }
  }
  expect(missing).toEqual([])
})

test('Die Ausnahmen sind noch nötig', () => {
  const all = Object.values(own).map(withoutComments).join('\n')
  for (const key of Object.keys(NOT_UI)) expect(all.includes(key), `Ausnahme ohne Zitat: ${key}`).toBe(true)
})
