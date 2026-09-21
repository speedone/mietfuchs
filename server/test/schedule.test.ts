// Die Regeln für eine Staffel mit zwei Einträgen zum selben Stichtag (server/src/schedule.ts).
//
// **Geprüft wird rechnend und nicht am Ergebnis der Funktion.** Die Zusage lautet nicht „es
// bleibt der letzte übrig", sondern „die Abrechnung rechnet danach dieselbe Zahl". Nur die
// zweite ist etwas wert, denn nur sie ist das, was beim Vermieter ankommt. Dieselbe Bauart wie
// in validate.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { personDaysInPeriod, personsAt } from '../src/calc.ts'
import { lastPerFrom, straightenPersonHistory } from '../src/schedule.ts'
import type { PersonEntry, Tenancy } from '../../shared/types.ts'

const tenancy = (personHistory: PersonEntry[]): Tenancy => ({
  id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 1,
  personHistory, start: '2024-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})

// Personentage und Personenzahl an einem Stichtag mitten im Jahr: die beiden Größen, an denen
// der Personenschlüssel hängt.
const gerechnet = (personHistory: PersonEntry[]) => ({
  personentage: personDaysInPeriod(tenancy(personHistory), '2024-01-01', '2024-12-31'),
  imMaerz: personsAt(tenancy(personHistory), '2024-03-31'),
})

test('Vorauszahlung und Kaltmiete: beim doppelten Stichtag gilt der letzte', () => {
  assert.deepEqual(
    lastPerFrom([{ from: '2024-01', monthlyCents: 10000 }, { from: '2024-01', monthlyCents: 25000 }]),
    [{ from: '2024-01', monthlyCents: 25000 }],
  )
  // Und die übrigen Einträge behalten ihre Reihenfolge.
  assert.deepEqual(
    lastPerFrom([{ from: '2024-01', monthlyCents: 1 }, { from: '2024-06', monthlyCents: 2 }, { from: '2024-01', monthlyCents: 3 }]),
    [{ from: '2024-06', monthlyCents: 2 }, { from: '2024-01', monthlyCents: 3 }],
  )
})

test('Personen-Staffel: der doppelte Stichtag bewegt keine Personentage', () => {
  // **Hier trägt „es gilt der letzte" nicht, und das ist gemessen.** `personDaysInPeriod` baut
  // seine Stufen aus allen Einträgen, und die erste gilt **ab Einzug** und nicht erst ab ihrem
  // eigenen Stichtag (calc.ts: „erste Stufe gilt ab Einzug"). Wirft man den ersten von zwei
  // Einträgen zum selben Stichtag weg, übernimmt der zweite rückwirkend die ganze Zeit davor.
  //
  // Nachgemessen an einem Mietverhältnis ab 01.01.2024 mit der Staffel [1 Person, 4 Personen],
  // beide ab 01.07.2024: 918 Personentage gegen 1464. Beim Personenschlüssel ist das unmittelbar
  // Geld, und zwar rund 60 Prozent.
  const roh: PersonEntry[] = [{ from: '2024-07-01', persons: 1 }, { from: '2024-07-01', persons: 4 }]
  const vorher = gerechnet(roh)
  assert.equal(vorher.personentage, 918, 'die Ausgangsrechnung stimmt nicht mehr')
  assert.equal(vorher.imMaerz, 1)

  const gerade = straightenPersonHistory(roh, '2024-01-01')
  assert.deepEqual(gerechnet(gerade), vorher, 'das Geraderücken bewegt Personentage')

  // Und was herauskommt, lässt sich auch speichern: kein Stichtag zweimal.
  assert.equal(new Set(gerade.map((e) => e.from)).size, gerade.length, 'ein Stichtag kommt doppelt vor')
})

test('Personen-Staffel: ohne Doppelung bleibt alles, wie es war', () => {
  for (const roh of [
    [{ from: '2024-01-01', persons: 2 }],
    [{ from: '2024-07-01', persons: 3 }],
    [{ from: '2024-01-01', persons: 2 }, { from: '2024-07-01', persons: 3 }],
    [{ from: '2024-04-01', persons: 2 }, { from: '2024-09-01', persons: 5 }],
  ] satisfies PersonEntry[][]) {
    const gerade = straightenPersonHistory(roh, '2024-01-01')
    assert.deepEqual(gerechnet(gerade), gerechnet(roh), JSON.stringify(roh))
  }
})

test('Personen-Staffel: auch mehrfache und spätere Doppelungen bewegen nichts', () => {
  for (const roh of [
    // Dreimal derselbe Stichtag, und zwar der erste.
    [{ from: '2024-07-01', persons: 1 }, { from: '2024-07-01', persons: 2 }, { from: '2024-07-01', persons: 4 }],
    // Die Doppelung liegt hinten: Dort trägt „es gilt der letzte", denn eine Stufe ohne Dauer
    // zählt in `personDaysInPeriod` null Tage.
    [{ from: '2024-01-01', persons: 2 }, { from: '2024-07-01', persons: 3 }, { from: '2024-07-01', persons: 5 }],
    // Doppelung genau am Einzugstag.
    [{ from: '2024-01-01', persons: 1 }, { from: '2024-01-01', persons: 4 }],
    // Vorne und hinten zugleich.
    [{ from: '2024-03-01', persons: 1 }, { from: '2024-03-01', persons: 2 }, { from: '2024-09-01', persons: 3 }, { from: '2024-09-01', persons: 6 }],
  ] satisfies PersonEntry[][]) {
    const gerade = straightenPersonHistory(roh, '2024-01-01')
    assert.deepEqual(gerechnet(gerade), gerechnet(roh), JSON.stringify(roh))
    assert.equal(new Set(gerade.map((e) => e.from)).size, gerade.length, JSON.stringify(gerade))
  }
})
