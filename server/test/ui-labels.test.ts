// Meldungen des Servers, die eine Beschriftung der Oberfläche zitieren (Befund M6 aus #341, Durchsicht).
//
// Der Knopf „Selbst abrechnen“ hieß nach M6 „Eigene Heizkostenabrechnung einrichten“, drei Meldungen des
// Servers verwiesen aber weiter auf den alten Namen. Wie guides.test.ts es für die Anleitungen tut, sucht
// dieser Wächter jedes Zitat in „…“, das wie eine Bedienangabe eingeleitet ist („mit „…““, „unter „…““,
// „Knopf „…““ usw.), in server/src und shared/ (ohne Kommentare und Tests) und verlangt es wörtlich im
// Quelltext von client/src.
//
// **Seine Grenze** ist die von guides.test.ts: Er findet den Wortlaut im Quelltext, nicht in der gerenderten
// Seite; Zitate mit eingesetzten Werten (`${…}`) und über mehrere Zeilen prüft er nicht. Zitate, die keine
// Beschriftung von Mietfuchs sind, stehen unten mit Grund.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const sources = (dir: string): [string, string][] => fs.readdirSync(path.join(ROOT, dir), { recursive: true }).map(String)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => [`${dir}/${f.split(path.sep).join('/')}`, fs.readFileSync(path.join(ROOT, dir, f), 'utf8')])

// Kein Zitat einer Beschriftung von Mietfuchs.
const NOT_UI: Record<string, string> = {
  'server/src/ai/presets.ts: „Privacy“': 'Abschnitt auf der Seite des Anbieters',
  'shared/guides.ts: „abzüglich CO₂-Kosten Vermieter“': 'Zeile einer Messdienstabrechnung',
  'shared/guides.ts: „§ 5 Absatz 2“': 'Wortlaut des Gesetzes',
}

const LEAD = /(Knopf|Schaltfläche|mit|unter|über|auf|Sie|Heizung|Karte|Seite|wählen|Feld) „([^“]+)“/g

function unquotedLabels(): string[] {
  const ui = sources('client/src').map(([, s]) => s).join('\n').replaceAll('&amp;', '&')
  const missing: string[] = []
  for (const [file, text] of [...sources('server/src'), ...sources('shared')]) {
    const code = text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    for (const m of code.matchAll(LEAD)) {
      const quoted = m[2] ?? ''
      if (/\$\{|'|\n|&/.test(quoted)) continue
      const key = `${file}: „${quoted}“`
      if (!ui.includes(quoted) && !Object.hasOwn(NOT_UI, key)) missing.push(key)
    }
  }
  return missing
}

test('Meldungen des Servers: jede zitierte Beschriftung steht so in der Oberfläche (#341, M6)', () => {
  assert.deepEqual(unquotedLabels(), [])
})

test('Die Ausnahmen sind noch nötig', () => {
  // Eine Ausnahme, deren Zitat es nicht mehr gibt, ginge sonst unbemerkt mit.
  const all = [...sources('server/src'), ...sources('shared')]
  for (const key of Object.keys(NOT_UI)) {
    const [file, quote] = key.split(': ')
    assert.ok(all.some(([f, s]) => f === file && s.includes(quote ?? '')), `Ausnahme ohne Zitat: ${key}`)
  }
})

// Die Prüfung oben verlangt das Zitat nur als Teil des Quelltexts; ein umbenannter Knopf, dessen altes Wort noch anderswo
// steht („Übernehmen“ bei den KI-Modellen), fiele ihr durch. Deshalb dürfen die Beschriftungen, die #346 Schritt 7
// abgelöst hat, in keiner Meldung und keiner Anleitung mehr zitiert werden (Durchsicht K4). Eine ganze Beschriftung statt
// eines Teilstrings zu verlangen ist nicht robust: Viele Zitate nennen den Anfang einer Option („Mieter heizt selbst“).
const RETIRED = [
  'Übernehmen', 'Hinzufügen', 'Umstellen', 'Tausch speichern', '+ Wohnung hinzufügen', '+ Mietverhältnis hinzufügen', '+ Zähler hinzufügen',
  '+ Kostenposition manuell erfassen', '+ Zahlung erfassen', '+ weitere Heizanlage',
  'Ablesung speichern', 'Lieferung speichern', 'Lieferung eintragen', 'Mieterwechsel durchführen', 'Zeitraum wechseln',
]
test('Meldungen und Anleitungen zitieren keine abgelöste Beschriftung (#346 Schritt 7)', () => {
  const found: string[] = []
  for (const [file, text] of [...sources('server/src'), ...sources('shared')]) {
    const code = text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    for (const label of RETIRED) if (code.includes(`„${label}“`)) found.push(`${file}: „${label}“`)
  }
  assert.deepEqual(found, [])
})
