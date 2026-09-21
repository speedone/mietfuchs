import { describe, expect, test } from 'vitest'
import { databaseHint } from './database'
import type { DatabaseState } from './types'

const state = (changeover: DatabaseState['changeover']): DatabaseState => ({
  open: true, file: 'C:\\daten\\mietfuchs.sqlite', migrations: 0, detail: 'geöffnet', changeover,
})

describe('Hinweis zum Umstieg in die Datenbank', () => {
  test('ohne Zustandsbericht kein Hinweis', () => {
    expect(databaseHint(null, null)).toBeNull()
    expect(databaseHint(undefined, null)).toBeNull()
  })

  test('gab es nichts zu übernehmen, gibt es nichts zu erzählen', () => {
    // Der Normalfall bei jedem Start nach dem ersten.
    expect(databaseHint(state({ state: 'none', message: 'Es ist nichts zu übernehmen.', notes: [] }), null)).toBeNull()
  })

  test('der gelungene Umstieg wird einmal gesagt, mit dem, was sich ändert', () => {
    const hint = databaseHint(
      state({ state: 'done', message: 'Ihre Daten liegen jetzt in einer Datenbank.', notes: ['Das Mietkonto rechnet jetzt anders.'] }),
      null,
    )
    expect(hint).toEqual({
      kind: 'done',
      message: 'Ihre Daten liegen jetzt in einer Datenbank.',
      notes: ['Das Mietkonto rechnet jetzt anders.'],
    })
  })

  test('der gescheiterte Umstieg erklärt, woran es lag', () => {
    const hint = databaseHint(state({ state: 'failed', message: 'Der Umstieg ist nicht gelungen: …', notes: [] }), null)
    expect(hint?.kind).toBe('failed')
  })

  test('weggeklickt bleibt weggeklickt, ein anderer Satz aber nicht', () => {
    // Gemerkt wird die Meldung selbst. Scheitert der Umstieg beim nächsten Start aus einem
    // anderen Grund, soll der neue Satz wieder erscheinen.
    const gescheitert = state({ state: 'failed', message: 'Die Datei db.json ließ sich nicht lesen.', notes: [] })
    expect(databaseHint(gescheitert, 'Die Datei db.json ließ sich nicht lesen.')).toBeNull()
    expect(databaseHint(gescheitert, 'Ein ganz anderer Grund.')).not.toBeNull()
  })
})
