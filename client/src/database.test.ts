import { describe, expect, test } from 'vitest'
import { databaseHint, MIGRATION_GUIDE_URL, updateHint } from './database'
import type { DatabaseState } from './types'

const state = (changeover: DatabaseState['changeover']): DatabaseState => ({
  open: true, file: 'C:\\daten\\mietfuchs.sqlite', migrations: 0, detail: 'geöffnet', changeover, migrated: null,
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

describe('Unterbliebener Umstieg (#89)', () => {
  test('eine hereingelegte db.json neben einer gefüllten Datenbank wird gesagt, als Hinweis und nicht als Fehler', () => {
    const hint = databaseHint(state({ state: 'stale', message: 'Die Datenbank enthält bereits Daten …', notes: [] }), null)
    expect(hint).toEqual({ kind: 'stale', message: 'Die Datenbank enthält bereits Daten …', notes: [] })
    expect(databaseHint(state({ state: 'stale', message: 'Die Datenbank enthält bereits Daten …', notes: [] }), 'Die Datenbank enthält bereits Daten …')).toBeNull()
  })
})

describe('Sicherung vor dem Update (#154)', () => {
  const none = { state: 'none' as const, message: 'Es gibt noch keine db.json; es ist nichts zu übernehmen.', notes: [] }
  const migrated = (backup: string): DatabaseState => ({ ...state(none), migrations: 3, migrated: { steps: 3, backup } })

  test('ohne nachgeholte Schritte gibt es nichts zu sagen', () => {
    expect(updateHint(null, '0.9.0', null)).toBeNull()
    expect(updateHint(state(none), '0.9.0', null)).toBeNull()
  })

  test('nach dem Update steht die Version, die Sicherung mit Namen und der Weg zurück da', () => {
    const hint = updateHint(migrated('mietfuchs.sqlite.vor-0003_heizung'), '0.9.0', null)
    expect(hint).toEqual({
      backup: 'mietfuchs.sqlite.vor-0003_heizung',
      message: 'Mietfuchs wurde auf Version 0.9.0 aktualisiert. Vorher wurde eine Sicherung Ihrer Daten ' +
        'angelegt (mietfuchs.sqlite.vor-0003_heizung im Datenordner). Wie Sie zur vorigen Version ' +
        'zurückkommen, steht in der Anleitung.',
      guideUrl: MIGRATION_GUIDE_URL,
    })
  })

  test('ohne bekannte Version bleibt der Satz trotzdem richtig', () => {
    expect(updateHint(migrated('mietfuchs.sqlite.vor-0001_objekte'), undefined, null)?.message)
      .toMatch(/^Mietfuchs wurde aktualisiert\. Vorher wurde eine Sicherung/)
  })

  test('die Anleitung ist der Abschnitt zum Rückweg in MIGRATION.md, so verankert wie GitHub ihn bildet', () => {
    expect(MIGRATION_GUIDE_URL).toBe('https://github.com/speedone/mietfuchs/blob/main/MIGRATION.md#zurück-zu-einer-älteren-version')
  })

  test('weggeklickt bleibt weggeklickt, die Sicherung eines späteren Updates aber nicht', () => {
    // Gemerkt wird der Name der Sicherung; er enthält den ersten nachgeholten Schritt und ist
    // damit je Update ein anderer.
    expect(updateHint(migrated('mietfuchs.sqlite.vor-0001_objekte'), '0.9.0', 'mietfuchs.sqlite.vor-0001_objekte')).toBeNull()
    expect(updateHint(migrated('mietfuchs.sqlite.vor-0003_heizung'), '0.9.0', 'mietfuchs.sqlite.vor-0001_objekte')).not.toBeNull()
  })
})
