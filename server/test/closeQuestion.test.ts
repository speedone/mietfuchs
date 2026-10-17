// Die Rückfrage beim Abschließen (#319), ohne Server: Lücke und Fehler, Prüfmarke über die bestätigten
// Fehler, und ein Fehler, der erst mit der Schätzung entsteht.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { closeWithQuestions, errorToken, type CloseSteps } from '../src/closeQuestion.ts'
import { periodKey } from '../../shared/period.ts'
import type { FuelGapQuestion, Notice } from '../../shared/types.ts'

type Stand = { gaps: FuelGapQuestion[]; notices: Notice[] }
const luecke: FuelGapQuestion = { plantId: 'hp', plantName: 'Gas', period: periodKey('2025-01'), from: '2025-07-01', to: '2025-12-31', amountCents: 1000, deadline: '2026-12-31' }
const overlap: Notice = { code: 'tenancy.overlap', level: 'error', title: 'Mietverhältnisse überschneiden sich', text: 'x', subject: { kind: 'tenancy', id: 't1' } }
const stale: Notice = { code: 'heating.estimate-stale', level: 'error', title: 'Schätzung passt nicht', text: 'y', subject: { kind: 'heatingPlant', id: 'hp' } }
const warnung: Notice = { code: 'basis.unit-no-area', level: 'warning', title: 'Wohnfläche fehlt', text: 'z' }

// Ein Bestand im Speicher; „Transaktion“ ohne Rückrollen, die Reihenfolge der Schritte zählt.
function bestand(vorher: Stand, nachSchaetzung: Stand) {
  const log: string[] = []
  let geschaetzt = false
  const steps: CloseSteps<null, Stand> = {
    compute: async () => (geschaetzt ? nachSchaetzung : vorher),
    gapsOf: (s) => s.gaps,
    noticesOf: (s) => s.notices,
    estimate: async () => { geschaetzt = true; log.push('schätzen') },
    close: async () => { log.push('abschließen') },
  }
  const transaction = async <T>(fn: (tx: null) => Promise<T>): Promise<T> => {
    try {
      return await fn(null)
    } catch (e) {
      geschaetzt = false
      log.push('zurück')
      throw e
    }
  }
  return { log, run: (answer: 'estimate' | 'none' | null, confirmed: string | null) => closeWithQuestions(transaction, answer, confirmed, steps) }
}

test('Prüfmarke: Code und Eintrag, Reihenfolge egal, Warnungen zählen nicht mit', () => {
  assert.equal(errorToken([overlap, stale]), errorToken([stale, overlap]))
  assert.notEqual(errorToken([overlap]), errorToken([overlap, stale]))
  assert.notEqual(errorToken([overlap]), errorToken([{ ...overlap, subject: { kind: 'tenancy', id: 't2' } }]))
  assert.equal(errorToken([{ ...overlap, text: 'anderer Text' }]), errorToken([overlap]))
})

test('ohne Fehler und Lücke: abschließen; nur Warnungen fragen nicht', async () => {
  const b = bestand({ gaps: [], notices: [warnung] }, { gaps: [], notices: [] })
  assert.equal(await b.run(null, null), null)
  assert.deepEqual(b.log, ['abschließen'])
})

test('Fehler: Rückfrage mit Marke; die passende Marke schließt ab, eine veraltete fragt neu', async () => {
  const b = bestand({ gaps: [], notices: [overlap, warnung] }, { gaps: [], notices: [] })
  const q = await b.run(null, null)
  assert.deepEqual(q, { errorNotices: [overlap], errorToken: errorToken([overlap]) })
  assert.deepEqual(b.log, ['zurück'])
  const veraltet = await b.run(null, errorToken([stale]))
  assert.deepEqual(veraltet?.errorNotices, [overlap])
  assert.equal(await b.run(null, errorToken([overlap])), null)
  assert.deepEqual(b.log.at(-1), 'abschließen')
})

test('Lücke und Fehler in einer Rückfrage; mit „ohne Schätzung“ und Marke abgeschlossen', async () => {
  const b = bestand({ gaps: [luecke], notices: [overlap] }, { gaps: [], notices: [overlap] })
  assert.deepEqual(await b.run(null, null), { fuelGaps: [luecke], errorNotices: [overlap], errorToken: errorToken([overlap]) })
  assert.equal(await b.run('none', errorToken([overlap])), null)
  assert.ok(!b.log.includes('schätzen'))
})

test('S2: Ein Fehler, der erst mit der Schätzung entsteht, wird vorgelegt, die Schätzung fällt zurück, und mit seiner Marke gelingt der Abschluss', async () => {
  const b = bestand({ gaps: [luecke], notices: [] }, { gaps: [], notices: [stale] })
  assert.deepEqual(await b.run(null, null), { fuelGaps: [luecke] })
  const q = await b.run('estimate', null)
  assert.deepEqual(q, { errorNotices: [stale], errorToken: errorToken([stale]) })
  assert.deepEqual(b.log, ['zurück', 'schätzen', 'zurück'])
  assert.equal(await b.run('estimate', errorToken([stale])), null)
  assert.deepEqual(b.log.slice(-2), ['schätzen', 'abschließen'])
})

test('Marke vor der Schätzung: Gilt nach der Schätzung ein anderer Satz Fehler, fragt der Server neu', async () => {
  const b = bestand({ gaps: [luecke], notices: [overlap] }, { gaps: [], notices: [overlap, stale] })
  const erste = await b.run(null, null)
  const zweite = await b.run('estimate', erste?.errorToken ?? assert.fail('keine Marke'))
  assert.deepEqual(zweite, { errorNotices: [overlap, stale], errorToken: errorToken([overlap, stale]) })
  assert.equal(await b.run('estimate', errorToken([stale, overlap])), null)
})
