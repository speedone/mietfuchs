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
  mea: 'Miteigentumsanteile',
  external_total: 'Summe in der Anlage',
  external_measure: 'Maßstab der Gemeinschaft',
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
  // Abrechnungszeitraum (#208)
  period: 'Abrechnungszeitraum',
  requested_period: 'gewählten Abrechnungszeitraum',
  period_start_month: 'Beginnmonat der Abrechnungszeiträume',
  from_month: 'Monat des Wechsels',
  category: 'Kostenart',
  // Lieferungen (Heizung PR 7)
  fixed: 'festen Preisbestandteil',
  emissions: 'CO₂-Ausstoß',
  co2: 'CO₂-Kosten',
  energy: 'Energie',
  quantity: 'Menge',
  heating_value: 'Heizwert',
  key: 'Umlageschlüssel',
  type: 'Zählertyp',
  deposit_status: 'Stand der Kaution',
}

const fieldName = (column: string): string => FIELD_NAMES[column] ?? `„${column}“`

// Der Feldname aus dem Namen einer Prüfbedingung. Die Namen sind durchgehend
// `<tabelle>_<feld>_not_negative`, `_known`, `_positive` oder `_complete`, und ein Test hält
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
  return treffer ? fieldName(treffer) : `„${rest}“`
}

// ---------- Die einzelnen Lagen ----------

const FOREIGN_KEY =
  'Der Eintrag gehört zu etwas, das es nicht mehr gibt, etwa zu einer Wohnung oder einem ' +
  'Zähler, der inzwischen gelöscht wurde. Bitte laden Sie die Seite neu und versuchen Sie es ' +
  'noch einmal.'

// „UNIQUE constraint failed: prepayments.tenancy_id, prepayments.from“ und Verwandte.
function uniqueMessage(details: string): string {
  const spalten = details.split(',').map((eintrag) => eintrag.trim().split('.').pop() ?? '')
  if (spalten.includes('from')) {
    return (
      'Zu diesem Stichtag gibt es in dieser Staffel schon einen Eintrag. Je Stichtag kann es nur ' +
      'einen geben, sonst wäre nicht entscheidbar, welcher gilt. Bitte ändern Sie den ' +
      'vorhandenen Eintrag oder wählen Sie einen anderen Stichtag.'
    )
  }
  // Seit #208 sind abgeschlossene Abrechnungen und Jahreskorrekturen nach Zeitraum geschlüsselt;
  // solange die Oberfläche nur Kalenderjahre kennt, ist der Zeitraum dort ein Jahr.
  if (spalten.includes('year') || spalten.includes('period')) {
    return (
      'Für dieses Jahr ist bereits eine Abrechnung abgeschlossen. Es kann je Jahr nur eine ' +
      'geben. Heben Sie den Abschluss auf, wenn Sie ihn erneuern wollen.'
    )
  }
  return 'Diesen Datensatz gibt es schon. Bitte laden Sie die Seite neu.'
}

// Bedingungen, deren Endung allein den falschen Satz ergäbe (#208): `_complete` spräche von der
// Gemeinschaftsabrechnung, `_valid` von einem Monat in der Form JJJJ-MM.
const OWN_CHECK_MESSAGES: Readonly<Record<string, string>> = {
  cost_items_service_complete: 'Zum Leistungszeitraum gehören Beginn und Ende. Bitte tragen Sie beide ein oder lassen Sie beide leer.',
  cost_items_service_from_valid: 'Der Beginn des Leistungszeitraums ist kein Datum in der Form JJJJ-MM-TT. Bitte laden Sie die Seite neu und versuchen Sie es noch einmal.',
  cost_items_service_to_valid: 'Das Ende des Leistungszeitraums ist kein Datum in der Form JJJJ-MM-TT. Bitte laden Sie die Seite neu und versuchen Sie es noch einmal.',
  cost_items_service_order_valid: 'Der Leistungszeitraum endet vor seinem Beginn. Bitte prüfen Sie die beiden Daten.',
  cost_items_tax_year_valid: 'Das Jahr der Zahlung liegt außerhalb dessen, was es geben kann. Bitte tragen Sie ein Jahr wie 2025 ein.',
  cost_items_heating_part_category_valid: '„Brennstoff/Energie“ gibt es nur bei der Kostenart „Heizung und Warmwasser“.',
  // Heizanlage (Heizung PR 4)
  heating_plants_source_method_valid:
    'Liefert die Gemeinschaft der Eigentümer die Heizkostenabrechnung, wird sie wie die eines Messdienstes übernommen. Bitte wählen Sie in der Einrichtung „Heizung“ dafür „Die Gemeinschaft (Hausverwaltung) rechnet ab“.',
  meters_heating_role_plant_valid:
    'Ein Zähler der Heizanlage braucht seine Rolle (Versorgung, Warmwasserspeicher oder Gesamtwärme), und nur ein Zähler der Anlage hat eine. Bitte wählen Sie beides oder keines.',
  meters_heating_plant_unit_valid: 'Ein Zähler der Heizanlage hängt an keiner Wohnung. Bitte wählen Sie entweder die Anlage oder eine Wohnung.',
  // Eigene Heizperiode und getrennte Heizkostenabrechnung (Heizung PR 5)
  heating_separate_spans_order_valid:
    'Die getrennte Heizkostenabrechnung endet vor ihrem Beginn. Bitte laden Sie die Seite neu; gespeichert wurde nichts.',
  heating_prepayment_overrides_provisional_complete:
    'Eine vorläufige Korrektur der Heizvorauszahlung nennt den ersten und den letzten Monat, eine endgültige keinen. Bitte laden Sie die Seite neu; gespeichert wurde nichts.',
  heating_prepayment_overrides_months_order_valid:
    'Die Monate der Korrektur der Heizvorauszahlung enden vor ihrem Beginn. Bitte laden Sie die Seite neu; gespeichert wurde nichts.',
  heating_periods_heat_pct_valid: 'Der Verbrauchsanteil der Heizkosten ist ein Anteil am Ganzen, also nicht negativ und nicht größer als das Ganze.',
  heating_periods_closing_measured_on_valid: 'Der Tag der Peilung ist kein Datum in der Form JJJJ-MM-TT. Bitte wählen Sie ihn im Kalender.',
  heating_periods_water_pct_valid: 'Der Verbrauchsanteil der Warmwasserkosten ist ein Anteil am Ganzen, also nicht negativ und nicht größer als das Ganze.',
  // CO₂ beim Messdienst (Heizung PR 6)
  co2_statements_service_complete:
    'Zu den CO₂-Angaben des Messdienstes gehören die Summe der Kosten aller Nutzer, der CO₂-Anteil des Vermieters und die Zahl der Nutzeinheiten. Bitte tragen Sie alle drei ein.',
  co2_statements_permille_valid: 'Der Anteil des Vermieters an den CO₂-Kosten ist ein Anteil am Ganzen, also nicht negativ und nicht größer als das Ganze.',
  // Lieferungen (Heizung PR 7)
  heating_plants_ets_district_valid: 'Die Angabe zur Wärme aus dem Emissionshandel gibt es nur bei Fernwärme.',
  cost_items_fuel_delivery_category_valid: 'Eine Lieferung gehört nur zu einer Position der Kostenart „Heizung und Warmwasser“.',
  // Eigene Heizkostenabrechnung (Heizung PR 10)
  heating_plants_self_capture_complete: 'Für die eigene Heizkostenabrechnung braucht die Heizanlage die Angabe, womit der Verbrauch erfasst wird.',
  heating_self_spans_from_valid: 'Der Beginn eines Zeitraums der eigenen Heizkostenabrechnung ist keine Heizperiode.',
  heating_self_spans_until_valid: 'Das Ende eines Zeitraums der eigenen Heizkostenabrechnung ist keine Heizperiode.',
  heating_self_spans_order_valid: 'Ein Zeitraum der eigenen Heizkostenabrechnung muss nach seinem Beginn enden.',
  cost_items_heating_target_category_valid: 'Ein Ziel (Heizung, Warmwasser) gibt es nur bei der Kostenart „Heizung und Warmwasser“.',
  cost_items_heating_system_complete: 'Nach der Heizkostenverordnung verteilt nur eine Position mit Heizanlage, Teil und Ziel. Bitte wählen Sie alle drei.',
  interim_reading_gaps_date_valid: 'Das Datum der Grenze ist kein Datum in der Form JJJJ-MM-TT. Bitte laden Sie die Seite neu.',
  // Pflichtangaben und Ausnahmen (Heizung PR 14)
  heating_periods_info_reference_positive: 'Der Vergleichswert ist eine Zahl größer als 0 (kWh je m² Wohnfläche in der Heizperiode).',
  heating_periods_info_reference_source_complete: 'Bitte nennen Sie die Quelle des Vergleichswerts, etwa die Vergleichsdaten Ihres Ablesedienstes. Ein Durchschnitt aus Ihrem eigenen Haus ist kein zulässiger Vergleich.',
  heating_periods_climate_factor_positive: 'Der Klimafaktor ist eine Zahl größer als 0.',
  heating_periods_climate_factor_source_complete: 'Bitte nennen Sie die Quelle der Klimafaktoren, etwa „Deutscher Wetterdienst, Klimafaktoren“ mit Postleitzahl und Zeitraum.',
  heating_periods_exemption_scope_valid: 'Ob die Ausnahme auch das Warmwasser betrifft, fragt Mietfuchs nur bei einer Ausnahme nach § 11 HeizkostenV. Bitte laden Sie die Seite neu.',
  heating_periods_exemption_billing_agreed_valid: 'Die vereinbarte Abrechnung nach § 2 Abs. 7 CO2KostAufG gibt es nur bei einer Ausnahme nach § 11 HeizkostenV. Bitte laden Sie die Seite neu.',
  // Schätzung nach § 9a (Heizung PR 13)
  heating_estimates_reason_complete: 'Zu einer Schätzung nach § 9a HeizkostenV gehört eine Begründung. Bitte nennen Sie, warum der Verbrauch nicht erfasst werden konnte.',
  fuel_deliveries_invoice_complete: 'Zum Rechnungszeitraum einer Lieferung gehören Beginn und Ende. Bitte tragen Sie beide ein.',
  fuel_deliveries_invoice_from_valid: 'Der Beginn des Rechnungszeitraums ist kein Datum in der Form JJJJ-MM-TT. Bitte wählen Sie es im Kalender.',
  fuel_deliveries_invoice_to_valid: 'Das Ende des Rechnungszeitraums ist kein Datum in der Form JJJJ-MM-TT. Bitte wählen Sie es im Kalender.',
  fuel_deliveries_invoice_date_valid: 'Das Rechnungsdatum ist kein Datum in der Form JJJJ-MM-TT. Bitte wählen Sie es im Kalender.',
  fuel_deliveries_delivered_at_valid: 'Das Lieferdatum ist kein Datum in der Form JJJJ-MM-TT. Bitte wählen Sie es im Kalender.',
  fuel_deliveries_invoice_order_valid: 'Der Rechnungszeitraum der Lieferung endet vor seinem Beginn. Bitte prüfen Sie die beiden Daten.',
  fuel_deliveries_share_valid: 'Der eingetragene Anteil einer Lieferung liegt zwischen 0 und 1000 ‰.',
  fuel_delivery_parts_from_valid: 'Der Beginn einer Teilmenge ist kein Datum in der Form JJJJ-MM-TT. Bitte wählen Sie es im Kalender.',
  fuel_delivery_parts_to_valid: 'Das Ende einer Teilmenge ist kein Datum in der Form JJJJ-MM-TT. Bitte wählen Sie es im Kalender.',
  fuel_delivery_parts_order_valid: 'Eine Teilmenge endet vor ihrem Beginn. Bitte prüfen Sie die beiden Daten.',
  // Rechtswerte des Vermieters (Heizung PR 17); die Route prüft vorher, die Bedingungen sind das Netz darunter.
  law_overrides_valid_from_valid: 'Ein eingetragener Rechtswert gilt immer ab dem 1. Januar eines Jahres. Bitte laden Sie die Seite neu.',
  law_overrides_source_complete: 'Zu einem eingetragenen Rechtswert gehört die Quelle, etwa „UBA, Bekanntmachung vom …“.',
  law_overrides_value_is_json: 'Der eingetragene Rechtswert ließ sich nicht speichern. Das ist ein Fehler in Mietfuchs und keiner in Ihren Daten. Bitte melden Sie ihn.',
}

function checkMessage(name: string): string {
  const own = OWN_CHECK_MESSAGES[name]
  if (own !== undefined) return own
  if (name.endsWith('_not_negative')) {
    return `Für ${fieldOfConstraint(name, '_not_negative')} ist ein negativer Wert angekommen. Das ergibt hier keinen Sinn; bitte tragen Sie null oder mehr ein.`
  }
  if (name.endsWith('_known')) {
    const feld = fieldOfConstraint(name, '_known')
    const beispiel = name === 'cost_items_key_known' ? ` Zulässig sind: ${COST_KEYS.join(', ')}.` : ''
    return `Für ${feld} ist ein Wert angekommen, den Mietfuchs nicht kennt.${beispiel} Bitte wählen Sie einen aus der Liste.`
  }
  // Zwei Endungen aus #94. `_positive`: eine Zahl, durch die geteilt wird. `_complete`: mehrere
  // Spalten, die nur zusammen einen Wert ergeben.
  if (name.endsWith('_positive')) {
    return `Für ${fieldOfConstraint(name, '_positive')} muss eine Zahl größer als null stehen, sonst lässt sich der Anteil nicht berechnen.`
  }
  if (name.endsWith('_complete')) {
    return 'Die Angaben aus der Abrechnung der Gemeinschaft sind unvollständig: Maßstab, Summe in der Anlage und Gesamtkosten gehören zusammen. Bitte tragen Sie alle drei ein oder keine.'
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
  // Zwei Endungen aus #208. `_valid`: ein Wert mit fester Form, hier der Zeitraumschlüssel
  // 'JJJJ-MM' oder ein Monat von 1 bis 12. `_with_property`: ein Wert, der nur an einem Objekt
  // bestimmt ist.
  if (name.endsWith('_valid')) {
    const feld = fieldOfConstraint(name, '_valid')
    return name.endsWith('_period_start_month_valid')
      ? `Für den ${feld} ist nur ein Monat von 1 bis 12 zulässig.`
      : `Für ${feld} ist ein Wert angekommen, der kein Monat in der Form JJJJ-MM ist (etwa 2025-05). Bitte laden Sie die Seite neu und versuchen Sie es noch einmal.`
  }
  if (name.endsWith('_with_property')) {
    return `Einen ${fieldOfConstraint(name, '_with_property')} gibt es nur zusammen mit einem Objekt, denn jedes Objekt hat seine eigenen Zeiträume. Bitte ordnen Sie den Beleg zuerst einem Objekt zu.`
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
//
// **Die Frage steht vor dem Einordnen und nicht dahinter**, und das war einmal andersherum.
// Zwei der Muster in `classify` sind nicht datenbankeigen: Ein schreibgeschützter Datenträger
// meldet `EROFS` auch beim Ablegen eines Belegs, eine volle Platte `ENOSPC`. Eingeordnet wurde
// das als „In die Datenbank lässt sich nicht schreiben“, und der Vermieter las eine Auskunft
// über die Datenbank, während in Wahrheit sein Beleg nicht abgelegt werden konnte.
export function databaseProblem(err: unknown): DatabaseProblem | null {
  if (!wrappedByDrizzle(err)) return null
  const grund = rootCause(err)
  // Erkennbar von der Datenbank, aber keine der bekannten Lagen: Die oberste Meldung darf
  // trotzdem nicht hinaus, denn gerade sie trägt das SQL und die Werte.
  return classify(grund) ?? { status: 500, message: unknownMessage(grund, err) }
}

const unknownMessage = (grund: string, err: unknown): string =>
  'Beim Speichern ist etwas schiefgegangen, das Mietfuchs nicht einordnen kann. Ihre Eingabe ' +
  'ist möglicherweise nicht gespeichert. Bitte melden Sie diesen Fehler.' +
  `\n\nTechnischer Befund: ${grund || String(err)}`
