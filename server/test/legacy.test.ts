// Das Geraderücken für die Datenbank (legacy.ts, #55).
//
// `migrateLegacy` macht aus dem Inhalt einer db.json einen Datenbestand, wie ihn Mietfuchs
// heute im Speicher hält. `straightenForDatabase` geht einen Schritt weiter: Es stellt das her,
// was die Datenbank verlangt und die Datei nicht verlangt hat. Beides steht in derselben Datei,
// weil eine zweite Fassung derselben Regel beim Umstieg still eine Abrechnung änderte.
//
// Hier stehen die Mechanik und die Randfälle. Dass keine Zahl dabei wandert, steht in
// validate.test.ts: Dort wird jeder hingenommene Fall vor und nach dem Geraderücken
// durchgerechnet, über alle vier Rechnungen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CostItem, Meter, Settings, Tenancy, Unit } from '../../shared/types.ts'
import type { Db } from '../src/store.ts'
import { legacyPrepaymentCase, migrateLegacy, straightenForDatabase } from '../src/legacy.ts'

// ---------- Bausteine ----------

const settings = (): Settings => ({
  houseName: 'Haus', address: 'Weg 1', landlordName: 'Vermieter', iban: '', paymentDeadlineDays: 30,
  ollamaUrl: 'http://localhost:11434', ollamaModel: 'modell',
})
const unit = (u: Partial<Unit> & Pick<Unit, 'id'>): Unit => ({ name: 'EG', areaM2: 80, participates: true, ...u })
const tenancy = (t: Partial<Tenancy> & Pick<Tenancy, 'id' | 'unitId'>): Tenancy => ({
  tenantName: 'Müller', persons: 2, personHistory: [{ from: '2024-03-15', persons: 2 }],
  start: '2024-03-15', end: null, prepayments: [{ from: '2024-03', monthlyCents: 15000 }],
  prepaymentOverrides: {}, baseRents: [], ...t,
})
const costItem = (c: Partial<CostItem> & Pick<CostItem, 'id'>): CostItem => ({
  year: 2024, category: 'Müllabfuhr', description: 'Abfallgebühren', amountCents: 12000, key: 'area', ...c,
})
const meter = (m: Partial<Meter> & Pick<Meter, 'id'>): Meter =>
  ({ name: 'Küche', unitId: 'u1', type: 'kaltwasser', unit: 'm³', ...m })

const db = (extra: Partial<Db> = {}): Db => ({
  settings: settings(),
  units: [unit({ id: 'u1' })],
  tenancies: [],
  costItems: [],
  meters: [],
  readings: [],
  payments: [],
  closedSettlements: [],
  ...extra,
})

// Das Altformat gibt es im heutigen `Tenancy` nicht mehr. Der Test baut es trotzdem, denn genau
// so steht es in den Beständen, um die es hier geht.
type WithLegacyAmount = Tenancy & { prepaymentMonthlyCents?: number }
const withLegacyAmount = (t: Tenancy, monthlyCents: number): WithLegacyAmount =>
  Object.assign({}, t, { prepaymentMonthlyCents: monthlyCents })

// Ein Feld wirklich entfernen und nicht auf undefined setzen: Genau so fehlt es in der Datei.
function drop<K extends string, T extends Partial<Record<K, unknown>>>(record: T, field: K): void {
  delete record[field]
}

// ---------- Der feste Monatsbetrag ----------

test('Der feste Monatsbetrag: die drei Fälle werden auseinandergehalten', () => {
  // Ohne alten Betrag gibt es nichts zu tun, auch nicht neben einer leeren Staffel.
  assert.equal(legacyPrepaymentCase([], undefined), 'none')
  assert.equal(legacyPrepaymentCase([], null), 'none')
  assert.equal(legacyPrepaymentCase([{ from: '2024-01', monthlyCents: 100 }], 15000), 'none')
  // Keine Staffel: Daraus macht schon `migrateLegacy` einen Staffeleintrag, bei jedem Einlesen.
  assert.equal(legacyPrepaymentCase(undefined, 15000), 'missing-schedule')
  // Eine leere Staffel ist eine Staffel. `migrateLegacy` fasst den alten Betrag deshalb nicht
  // an, die Abrechnung liest ihn trotzdem, und in der Datenbank gibt es keine Spalte dafür.
  assert.equal(legacyPrepaymentCase([], 15000), 'empty-schedule')
  // Auch eine 0 ist ein Betrag und kein fehlendes Feld.
  assert.equal(legacyPrepaymentCase([], 0), 'empty-schedule')
})

test('Geraderücken: der feste Monatsbetrag neben einer leeren Staffel wird zum Staffeleintrag', () => {
  const krumm = db({ tenancies: [withLegacyAmount(tenancy({ id: 't1', unitId: 'u1', prepayments: [] }), 15000)] })
  const gerade = straightenForDatabase(krumm)
  assert.deepEqual(gerade.tenancies[0].prepayments, [{ from: '2024-03', monthlyCents: 15000 }])
  // Das alte Feld verschwindet dabei: Zwei Wahrheiten nebeneinander wären der Anfang des
  // nächsten Fehlers, und in der Datenbank gibt es dafür ohnehin keine Spalte.
  assert.equal('prepaymentMonthlyCents' in gerade.tenancies[0], false)
})

test('Geraderücken: eine vorhandene Staffel schlägt den festen Monatsbetrag', () => {
  const krumm = db({
    tenancies: [withLegacyAmount(tenancy({ id: 't1', unitId: 'u1', prepayments: [{ from: '2024-06', monthlyCents: 20000 }] }), 15000)],
  })
  assert.deepEqual(straightenForDatabase(krumm).tenancies[0].prepayments, [{ from: '2024-06', monthlyCents: 20000 }])
})

// ---------- Die Staffeln ----------

test('Geraderücken: zum selben Stichtag bleibt der letzte Eintrag, genau wie ihn die Abrechnung nimmt', () => {
  const krumm = db({
    tenancies: [tenancy({
      id: 't1', unitId: 'u1',
      prepayments: [{ from: '2024-03', monthlyCents: 10000 }, { from: '2024-03', monthlyCents: 25000 }],
      personHistory: [{ from: '2024-03-15', persons: 2 }, { from: '2024-03-15', persons: 5 }],
      baseRents: [{ from: '2024-03', monthlyCents: 50000 }, { from: '2024-03', monthlyCents: 60000 }],
    })],
  })
  const t = straightenForDatabase(krumm).tenancies[0]
  // 100 Euro gegen 250 Euro im Monat: Wer hier den ersten nähme, änderte die Jahresvorauszahlung
  // um 1800 Euro. Die Abrechnung sortiert nach Stichtag und nimmt den letzten, der gilt.
  assert.deepEqual(t.prepayments, [{ from: '2024-03', monthlyCents: 25000 }])
  assert.deepEqual(t.personHistory, [{ from: '2024-03-15', persons: 5 }])
  assert.deepEqual(t.baseRents, [{ from: '2024-03', monthlyCents: 60000 }])
})

test('Geraderücken: die Reihenfolge der übrigen Staffeleinträge bleibt, wie sie in der Datei stand', () => {
  const krumm = db({
    tenancies: [tenancy({
      id: 't1', unitId: 'u1',
      prepayments: [
        { from: '2024-03', monthlyCents: 10000 },
        { from: '2025-01', monthlyCents: 12000 },
        { from: '2024-03', monthlyCents: 11000 },
      ],
    })],
  })
  assert.deepEqual(straightenForDatabase(krumm).tenancies[0].prepayments, [
    { from: '2025-01', monthlyCents: 12000 },
    { from: '2024-03', monthlyCents: 11000 },
  ])
})

// ---------- Verweise ins Leere ----------

test('Geraderücken: eine Direktzuordnung ins Leere wird „keine Zuordnung“', () => {
  const krumm = db({
    costItems: [
      costItem({ id: 'c1', key: 'direct', directUnitId: 'gibt-es-nicht' }),
      costItem({ id: 'c2', key: 'direct', directUnitId: '' }),
      costItem({ id: 'c3', key: 'direct', directUnitId: 'u1' }),
    ],
  })
  const items = straightenForDatabase(krumm).costItems
  // Verworfen wird die Zeile nicht: Das entfernte eine bezahlte Rechnung aus einem
  // abgerechneten Jahr. Der Betrag geht wie bisher an den Vermieter.
  assert.equal(items.length, 3)
  assert.equal(items[0].directUnitId, null)
  assert.equal(items[1].directUnitId, null, 'eine leere Kennung ist ebenfalls keine Zuordnung')
  assert.equal(items[2].directUnitId, 'u1', 'eine gültige Zuordnung bleibt')
})

test('Geraderücken: ein vereinbarter Anteil auf eine gelöschte Wohnung entfällt', () => {
  const krumm = db({ costItems: [costItem({ id: 'c1', key: 'custom', customShares: { u1: 60, weg: 40 } })] })
  assert.deepEqual(straightenForDatabase(krumm).costItems[0].customShares, { u1: 60 })
})

test('Geraderücken: ein Zähler ohne ausgefüllte Wohnung wird zum Hauptzähler', () => {
  const krumm = db({ meters: [meter({ id: 'm1', unitId: '' }), meter({ id: 'm2', unitId: 'u1' })] })
  const meters = straightenForDatabase(krumm).meters
  assert.equal(meters[0].unitId, null)
  assert.equal(meters[1].unitId, 'u1')
})

// ---------- Felder, die die Datenbank verlangt und die Datei nicht hatte ----------

test('Geraderücken: fehlende Pflichtfelder bekommen den Wert, mit dem die Abrechnung ohnehin rechnet', () => {
  // So sieht ein Bestand aus, den der Validator ausdrücklich durchlässt: Wohnfläche,
  // Beteiligung, Personenzahl und die Anzeigefelder fehlen. Er entsteht über die Oberfläche
  // und in alten Beständen, und die Abrechnung rechnet heute damit. Die Felder werden aus dem
  // fertigen Bestand entfernt und nicht beim Bauen weggelassen: Nur so prüft der Übersetzer
  // alles Übrige mit, und genau so fehlen sie auch in der Datei.
  const krumm = db({
    units: [unit({ id: 'u1' })],
    tenancies: [tenancy({ id: 't1', unitId: 'u1' })],
    meters: [meter({ id: 'm1' })],
    costItems: [costItem({ id: 'c1' })],
  })
  drop(krumm.units[0], 'name')
  drop(krumm.units[0], 'areaM2')
  drop(krumm.units[0], 'participates')
  drop(krumm.tenancies[0], 'tenantName')
  drop(krumm.tenancies[0], 'persons')
  drop(krumm.tenancies[0], 'prepaymentOverrides')
  drop(krumm.meters[0], 'name')
  drop(krumm.meters[0], 'unit')
  drop(krumm.costItems[0], 'description')

  const gerade = straightenForDatabase(krumm)
  assert.equal(gerade.units[0].name, '')
  assert.equal(gerade.units[0].areaM2, 0, 'so liest die Abrechnung sie schon heute (u.areaM2 || 0)')
  assert.equal(gerade.units[0].participates, false)
  assert.equal(gerade.tenancies[0].tenantName, '')
  // Die Personenzahl ist der Rückfall für eine leere Staffel. Steht eine da, gilt ihr letzter
  // Eintrag, und genau den bekommt auch das Feld.
  assert.equal(gerade.tenancies[0].persons, 2)
  assert.deepEqual(gerade.tenancies[0].prepaymentOverrides, {})
  assert.equal(gerade.meters[0].name, '')
  assert.equal(gerade.meters[0].unit, '')
  assert.equal(gerade.costItems[0].description, '')
})

test('Geraderücken: ohne Personen-Staffel gilt die eine Person, wie beim Einlesen', () => {
  const krumm = db({ tenancies: [tenancy({ id: 't1', unitId: 'u1', personHistory: [] })] })
  drop(krumm.tenancies[0], 'persons')
  assert.equal(straightenForDatabase(krumm).tenancies[0].persons, 1)
})

test('Geraderücken: ein null in den Einstellungen zählt wie ein fehlendes Feld', () => {
  // Der Validator liest ein `null` wie ein fehlendes Feld, die Vorgabewerte greifen aber nicht:
  // `{ ...DEFAULT, ...{ houseName: null } }` übernimmt das null, und die Spalte verlangt einen
  // Wert. Gemessen an einem Bestand, der über die Oberfläche gar nicht entstehen kann, aber
  // durch den Validator kommt.
  const krumm = db()
  const roh: Partial<Record<keyof Settings, unknown>> = krumm.settings
  roh.houseName = null
  roh.address = null
  roh.paymentDeadlineDays = null
  const gerade = straightenForDatabase(krumm)
  assert.equal(gerade.settings.houseName, '')
  assert.equal(gerade.settings.address, '')
  assert.equal(gerade.settings.paymentDeadlineDays, 30, 'der Vorgabewert, wie bei einem fehlenden Feld')
  // Und die KI-Einstellungen sind danach vollständig: Die Datenbank hat für jeden ihrer Werte
  // eine Spalte, und die Zeile für den Standard-Platz muss einen Anbieter nennen.
  assert.equal(gerade.settings.ai.text.provider, 'ollama')
})

// ---------- Was das Geraderücken nicht tun darf ----------

test('Geraderücken: der übergebene Bestand bleibt unberührt', () => {
  // Der Umstieg rechnet beide Stände durch, den krummen und den geradegerückten. Änderte die
  // Funktion ihre Eingabe, verglichen beide Seiten dasselbe, und die Regression wäre blind.
  const krumm = db({
    tenancies: [withLegacyAmount(tenancy({ id: 't1', unitId: 'u1', prepayments: [] }), 15000)],
    costItems: [costItem({ id: 'c1', key: 'direct', directUnitId: 'gibt-es-nicht', customShares: { weg: 40 } })],
  })
  const vorher = structuredClone(krumm)
  straightenForDatabase(krumm)
  assert.deepEqual(krumm, vorher)
})

test('Geraderücken nach dem Einlesen ändert nichts mehr an einem gepflegten Bestand', () => {
  // Der Normalfall: Wer seinen Bestand in der Oberfläche pflegt, hat nichts geradezurücken.
  // Die Einstellungen ausgenommen, denn dort ergänzt migrateAi die KI-Felder.
  const gepflegt = migrateLegacy(db({
    tenancies: [tenancy({ id: 't1', unitId: 'u1' })],
    costItems: [costItem({ id: 'c1' })],
    meters: [meter({ id: 'm1' })],
  }))
  const gerade = straightenForDatabase(gepflegt)
  assert.deepEqual(gerade.units, gepflegt.units)
  assert.deepEqual(gerade.tenancies, gepflegt.tenancies)
  assert.deepEqual(gerade.meters, gepflegt.meters)
  // Die eine Ergänzung: Ohne Direktzuordnung steht danach ausdrücklich „keine" da, statt dass
  // das Feld fehlt. Die Abrechnung schlägt beides gleich vergeblich nach, und die Spalte hält
  // genau diese Aussage fest.
  assert.deepEqual(gerade.costItems, gepflegt.costItems.map((c) => ({ ...c, directUnitId: null })))
})
