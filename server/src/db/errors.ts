// Was SQLite sagt, in Worte fassen, mit denen ein Vermieter etwas anfangen kann (#55).
//
// **Der Anlass ist gemessen und nicht vermutet.** Drizzle verpackt jeden Fehler von SQLite in
// einen eigenen, und dessen Meldung lautet:
//
//   Failed query: insert into "prepayments" ("tenancy_id", "from", "monthly_cents") values (?, ?, ?)
//   params: t1,2024-01,200
//
// Darin steckt zweierlei, das nie zum Nutzer darf: das SQL, weil es ihm nichts sagt, und **die
// Werte seiner eigenen Daten**, weil eine Fehlermeldung kein Ort für Daten ist. Der wirkliche
// Grund steht nicht dort, sondern am Ende der `cause`-Kette („UNIQUE constraint failed:
// prepayments.tenancy_id, prepayments.from"). Wer die oberste Meldung weiterreicht, zeigt also
// genau das Falsche und verschweigt das Richtige.
//
// Dieselbe Haltung wie in open.ts: Jede Meldung sagt, was los ist und was zu tun ist; die
// Meldung von SQLite steht höchstens benannt am Ende und nie allein.

import { COST_KEYS } from './schema.ts'

// Der innerste Grund. Drizzle hängt ihn als `cause` an, und dort kann noch einer hängen.
function rootCause(err: unknown): string {
  let deepest = ''
  let current: unknown = err
  while (current instanceof Error) {
    if (current.message) deepest = current.message
    current = current.cause
  }
  return deepest
}

// Deutsche Namen für die Felder, die in einer Meldung auftauchen können. Nur die, die ein
// Nutzer auch in der Oberfläche sieht; alles andere steht mit seinem technischen Namen da, denn
// eine erfundene Übersetzung wäre schlechter als der echte Name.
const FIELD_NAMES: Record<string, string> = {
  area_m2: 'Wohnfläche',
  persons: 'Personenzahl',
  self_persons: 'Personen im eigenen Haushalt',
  rooms: 'Zimmerzahl',
  monthly_cents: 'Monatsbetrag',
  amount_cents: 'Betrag',
  percent: 'Anteil in Prozent',
  value: 'Zählerstand',
  old_end_value: 'Endstand des alten Zählers',
  deposit_cents: 'Kaution',
  name: 'Name',
  tenant_name: 'Name des Mieters',
  description: 'Beschreibung',
  unit: 'Maßeinheit',
  date: 'Datum',
  start: 'Beginn',
  year: 'Jahr',
  category: 'Kostenart',
  key: 'Umlageschlüssel',
  type: 'Zählertyp',
  deposit_status: 'Stand der Kaution',
}

const fieldName = (column: string): string => FIELD_NAMES[column] ?? `„${column}"`

// Der Feldname aus dem Namen einer Prüfbedingung. Die Namen sind durchgehend
// `<tabelle>_<feld>_not_negative` beziehungsweise `<tabelle>_<feld>_known`, und ein Test hält
// fest, dass das für jede Bedingung im Schema gilt: Die Meldung wird daraus abgeleitet, statt
// einen Katalog zu pflegen, den beim nächsten Feld jemand vergisst.
function fieldOfConstraint(name: string, suffix: string): string {
  const rest = name.slice(0, -suffix.length)
  // Die Tabelle steht vorn und ist für den Nutzer uninteressant; er sieht ohnehin die Maske,
  // in der er gerade arbeitet. Der längste passende Feldname gewinnt, weil manche Felder
  // Unterstriche enthalten (`old_end_value`).
  const treffer = Object.keys(FIELD_NAMES)
    .filter((feld) => rest.endsWith(`_${feld}`))
    .sort((a, b) => b.length - a.length)[0]
  return treffer ? fieldName(treffer) : `„${rest}"`
}

// ---------- Die einzelnen Lagen ----------

const FOREIGN_KEY =
  'Der Eintrag gehört zu etwas, das es nicht mehr gibt, etwa zu einer Wohnung oder einem ' +
  'Zähler, der inzwischen gelöscht wurde. Bitte laden Sie die Seite neu und versuchen Sie es ' +
  'noch einmal.'

// „UNIQUE constraint failed: prepayments.tenancy_id, prepayments.from" und Verwandte.
function uniqueMessage(details: string): string {
  const spalten = details.split(',').map((eintrag) => eintrag.trim().split('.').pop() ?? '')
  if (spalten.includes('from')) {
    return (
      'Zu diesem Stichtag gibt es in dieser Staffel schon einen Eintrag. Je Stichtag kann es nur ' +
      'einen geben, sonst wäre nicht entscheidbar, welcher gilt. Bitte ändern Sie den ' +
      'vorhandenen Eintrag oder wählen Sie einen anderen Stichtag.'
    )
  }
  if (spalten.includes('year')) {
    return (
      'Für dieses Jahr ist bereits eine Abrechnung abgeschlossen. Es kann je Jahr nur eine ' +
      'geben. Heben Sie den Abschluss auf, wenn Sie ihn erneuern wollen.'
    )
  }
  return 'Diesen Datensatz gibt es schon. Bitte laden Sie die Seite neu.'
}

function checkMessage(name: string): string {
  if (name.endsWith('_not_negative')) {
    return `Für ${fieldOfConstraint(name, '_not_negative')} ist ein negativer Wert angekommen. Das ergibt hier keinen Sinn; bitte tragen Sie null oder mehr ein.`
  }
  if (name.endsWith('_known')) {
    const feld = fieldOfConstraint(name, '_known')
    const beispiel = name === 'cost_items_key_known' ? ` Zulässig sind: ${COST_KEYS.join(', ')}.` : ''
    return `Für ${feld} ist ein Wert angekommen, den Mietfuchs nicht kennt.${beispiel} Bitte wählen Sie einen aus der Liste.`
  }
  if (name.endsWith('_is_json')) {
    // Anders als die beiden oben ist das **kein** Fehler in einer Eingabe. Der eingefrorene
    // Berechnungsstand entsteht in Mietfuchs selbst; ist er kein gültiges JSON, ist unterwegs
    // etwas verstümmelt worden. Genau dafür steht die Bedingung am Schema, siehe die Begründung
    // dort: Eine abgeschnittene Zeichenkette soll sofort auffallen und nicht erst Jahre später
    // beim Öffnen der alten Abrechnung.
    return (
      'Der eingefrorene Berechnungsstand dieser Abrechnung ließ sich nicht speichern, weil er ' +
      'unvollständig ist. Das ist ein Fehler in Mietfuchs und keiner in Ihren Daten; an der ' +
      'gespeicherten Abrechnung hat sich nichts geändert. Bitte melden Sie ihn.'
    )
  }
  if (name === 'settings_single_row') {
    // Die einzige Bedingung ohne Endung, und sie ist eine echte Ausnahme: Sie beschreibt kein
    // Feld, sondern die Tabelle selbst. Die Einstellungen sind genau eine Zeile; wer eine
    // zweite anlegen will, hat einen Fehler im Programm und keinen in seinen Daten.
    return (
      'Die Einstellungen ließen sich nicht speichern. Es gibt sie genau einmal, und hier wurde ' +
      'versucht, sie ein zweites Mal anzulegen. Das ist ein Fehler in Mietfuchs und keiner in ' +
      'Ihren Daten. Bitte melden Sie ihn.'
    )
  }
  // Kommt eine Bedingung mit anderer Endung hinzu, fällt das im Test auf, nicht erst hier.
  return `Ein Wert ist nicht zulässig (${name}).`
}

// ---------- Die Meldung ----------

// **Der Status gehört zur Meldung und wird deshalb hier entschieden.** Eine verletzte Zusicherung
// kommt aus der Anfrage: Der Verweis zeigt ins Leere, der Stichtag ist doppelt, der Wert ist
// negativ. Das ist eine 400 und keine 500, denn am Server ist nichts kaputt, und eine 500 lüde
// den Nutzer dazu ein, es einfach noch einmal zu versuchen. Schreibschutz und volle Platte sind
// dagegen 503: vorübergehend nicht möglich, und an der Anfrage lag es nicht.
export type DatabaseProblem = { status: number, message: string }

const withFinding = (status: number, text: string, grund: string): DatabaseProblem => ({
  status,
  message: `${text}\n\nTechnischer Befund: ${grund}`,
})

// Was SQLite gemeldet hat, eingeordnet. `null` heißt: keine der bekannten Lagen.
function classify(grund: string): DatabaseProblem | null {
  if (/FOREIGN KEY constraint failed/i.test(grund)) return withFinding(400, FOREIGN_KEY, grund)

  const unique = /UNIQUE constraint failed:\s*(.+)/i.exec(grund)
  if (unique) return withFinding(400, uniqueMessage(unique[1]), grund)

  const check = /CHECK constraint failed:\s*([a-z0-9_]+)/i.exec(grund)
  if (check) return withFinding(400, checkMessage(check[1]), grund)

  const notNull = /NOT NULL constraint failed:\s*\S+\.(\w+)/i.exec(grund)
  if (notNull) return withFinding(400, `Das Feld ${fieldName(notNull[1])} muss ausgefüllt sein.`, grund)

  // Kein Fehler in den Daten, sondern am Rechner. Beide kommen vor, wenn jemand seinen
  // Datenordner auf einen vollen oder schreibgeschützten Datenträger legt.
  if (/readonly|read-only/i.test(grund)) {
    return withFinding(
      503,
      'In die Datenbank lässt sich nicht schreiben; sie ist schreibgeschützt. Ihre Eingabe ist ' +
        'nicht gespeichert. Bitte geben Sie die Datei im Datenordner zum Schreiben frei.',
      grund,
    )
  }
  if (/disk (is )?full|no space|SQLITE_FULL/i.test(grund)) {
    return withFinding(
      503,
      'Auf dem Datenträger ist kein Platz mehr, deshalb ist Ihre Eingabe nicht gespeichert. ' +
        'Bitte schaffen Sie Platz und versuchen Sie es noch einmal.',
      grund,
    )
  }
  return null
}

// Drizzles Verpackung, an der sich ein Fehler der Datenbank auch dann erkennen lässt, wenn der
// Grund darunter keiner der bekannten ist. Die Kette wird ganz abgegangen, weil die Verpackung
// je nach Weg außen oder weiter innen sitzt.
function wrappedByDrizzle(err: unknown): boolean {
  let current: unknown = err
  while (current instanceof Error) {
    if (/^Failed query:/i.test(current.message)) return true
    current = current.cause
  }
  return false
}

// **Ist das überhaupt ein Fehler der Datenbank?** `null` heißt nein, und dann fasst diese Datei
// ihn nicht an. Ein abgebrochener Upload ist kein Fehler beim Speichern, und ihn als einen zu
// bezeichnen wäre eine Falschauskunft. Die Fehlerbehandlung in index.ts fragt hier zuerst und
// bleibt sonst bei ihrer eigenen Meldung.
export function databaseProblem(err: unknown): DatabaseProblem | null {
  const grund = rootCause(err)
  const eingeordnet = classify(grund)
  if (eingeordnet) return eingeordnet
  if (!wrappedByDrizzle(err)) return null
  // Erkennbar von der Datenbank, aber keine der bekannten Lagen. Die oberste Meldung darf
  // trotzdem nicht hinaus, denn gerade sie trägt das SQL und die Werte.
  return { status: 500, message: unknownMessage(grund, err) }
}

const unknownMessage = (grund: string, err: unknown): string =>
  'Beim Speichern ist etwas schiefgegangen, das Mietfuchs nicht einordnen kann. Ihre Eingabe ' +
  'ist möglicherweise nicht gespeichert. Bitte melden Sie diesen Fehler.' +
  `\n\nTechnischer Befund: ${grund || String(err)}`

// Nimmt einen beliebigen Fehler und liefert einen Satz für die Oberfläche. Was nicht erkannt
// wird, verschwindet nicht: Es steht benannt am Ende, damit eine Rückfrage etwas hat, woran sie
// sich halten kann.
export function databaseMessage(err: unknown): string {
  const grund = rootCause(err)
  return classify(grund)?.message ?? unknownMessage(grund, err)
}
