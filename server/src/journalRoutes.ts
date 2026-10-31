// Die Sätze, mit denen eine schreibende Anfrage im Verlauf steht (#318, Schritt 2). Je Route ein
// Satz in der Sprache der Oberfläche, dazu die Tabelle, um die es der Route geht: Aus deren Zeile
// nimmt der Verlauf die Bezeichnung („Wohnung gelöscht: EG links“).
//
// Schlüssel ist die Methode und das Muster der Route, wie Express es kennt (`req.route.path`).
// Eine Route ohne Satz wird nicht erfasst (und die Konsole sagt es); journal-routes.test.ts verlangt
// für jede schreibende Route einen Satz.

export type RouteSentence = { text: string, table: string | null }

const COLLECTION_SENTENCES: Record<string, { noun: string, table: string, female?: boolean }> = {
  units: { noun: 'Wohnung', table: 'units', female: true },
  tenancies: { noun: 'Mietverhältnis', table: 'tenancies' },
  costItems: { noun: 'Kostenposition', table: 'cost_items', female: true },
  meters: { noun: 'Zähler', table: 'meters' },
  readings: { noun: 'Ablesung', table: 'readings', female: true },
  payments: { noun: 'Zahlung', table: 'payments', female: true },
}

const s = (text: string, table: string | null = null): RouteSentence => ({ text, table })

export const ROUTE_SENTENCES: Readonly<Record<string, RouteSentence>> = {
  ...Object.fromEntries(
    Object.entries(COLLECTION_SENTENCES).flatMap(([coll, { noun, table }]) => [
      [`POST /api/${coll}`, s(`${noun} angelegt`, table)],
      [`PUT /api/${coll}/:id`, s(`${noun} geändert`, table)],
      [`DELETE /api/${coll}/:id`, s(`${noun} gelöscht`, table)],
    ]),
  ),
  'PUT /api/settings': s('Einstellungen geändert'),
  'POST /api/ai/consent': s('Übermittlung an einen KI-Dienst bestätigt'),
  'DELETE /api/ai/consent/:slot': s('Bestätigung für einen KI-Dienst zurückgenommen'),
  'POST /api/costItems/split': s('Kostenposition aufgeteilt angelegt', 'cost_items'),
  'PUT /api/costItems/:id/split': s('Kostenposition aufgeteilt', 'cost_items'),
  'POST /api/tenancies/:id/change': s('Mieterwechsel', 'tenancies'),
  'POST /api/properties': s('Objekt angelegt', 'properties'),
  'PUT /api/properties/:id': s('Objekt geändert', 'properties'),
  'DELETE /api/properties/:id': s('Objekt gelöscht', 'properties'),
  'PUT /api/law-overrides/:paramId/:year': s('Rechtswert eingetragen'),
  'DELETE /api/law-overrides/:paramId/:year': s('Rechtswert entfernt'),
  'POST /api/heating-plants': s('Heizanlage angelegt', 'heating_plants'),
  'POST /api/heating-plants/:id/replace': s('Kesseltausch', 'heating_plants'),
  'POST /api/heating-plants/:id/operating-power': s('Betriebsstrom der Heizung angelegt', 'cost_items'),
  'PUT /api/heating-plants/:id': s('Heizanlage geändert', 'heating_plants'),
  'DELETE /api/heating-plants/:id': s('Heizanlage entfernt', 'heating_plants'),
  'PUT /api/heating-plants/:id/periods/:period/co2': s('CO₂-Angaben gespeichert'),
  'DELETE /api/heating-plants/:id/periods/:period/co2': s('CO₂-Angaben entfernt'),
  'PUT /api/heating-plants/:id/periods/:period/hot-water': s('Angaben zum Warmwasser gespeichert'),
  'PUT /api/heating-plants/:id/periods/:period/service-values': s('Werte des Ablesedienstes gespeichert'),
  'PUT /api/heating-plants/:id/periods/:period/estimates/:unitId/:part': s('Schätzung nach § 9a gespeichert'),
  'DELETE /api/heating-plants/:id/periods/:period/estimates/:unitId/:part': s('Schätzung nach § 9a entfernt'),
  'PUT /api/heating-plants/:id/periods/:period/stock': s('Brennstoffvorrat gespeichert'),
  'DELETE /api/heating-plants/:id/periods/:period/stock': s('Brennstoffvorrat entfernt'),
  'PUT /api/heating-plants/:id/self': s('Eigene Heizkostenabrechnung eingerichtet', 'heating_plants'),
  'PUT /api/heating-plants/:id/periods/:period/distribution': s('Anteil nach Verbrauch gespeichert'),
  'PUT /api/heating-plants/:id/periods/:period/info': s('Angaben zur Abrechnung (§ 6a) gespeichert'),
  'PUT /api/heating-plants/:id/periods/:period/rules': s('Ausnahmen und Vereinbarungen gespeichert'),
  'PUT /api/heating-plants/:id/periods/:period/dhw-temperature': s('Warmwassertemperatur gespeichert'),
  'PUT /api/heating-plants/:id/monthly-info/:month': s('Monatliche Verbrauchsinformation gespeichert'),
  'PUT /api/units/:id/interim-gaps/:date': s('Antwort zu einer fehlenden Zwischenablesung gespeichert'),
  'DELETE /api/units/:id/interim-gaps/:date': s('Antwort zu einer fehlenden Zwischenablesung entfernt'),
  'POST /api/co2-refunds': s('CO₂-Erstattung angelegt'),
  'PUT /api/co2-refunds/:id': s('CO₂-Erstattung geändert'),
  'DELETE /api/co2-refunds/:id': s('CO₂-Erstattung gelöscht'),
  'POST /api/heating-plants/:id/deliveries': s('Lieferung angelegt', 'fuel_deliveries'),
  'PUT /api/fuel-deliveries/:id': s('Lieferung geändert', 'fuel_deliveries'),
  'POST /api/fuel-deliveries/:id/reassign-credit': s('Gutschrift einer anderen Lieferung zugeordnet', 'fuel_deliveries'),
  'DELETE /api/fuel-deliveries/:id': s('Lieferung gelöscht', 'fuel_deliveries'),
  'PUT /api/properties/:id/degree-days': s('Gradtagzahlen gespeichert'),
  'PUT /api/heating-plants/:id/period': s('Heizperiode der Anlage umgestellt', 'heating_plants'),
  'PUT /api/heating-plants/:id/separate': s('Getrennte Heizkostenabrechnung umgestellt', 'heating_plants'),
  'POST /api/heating-settlement/:plant/:period/close': s('Heizkostenabrechnung abgeschlossen'),
  'PUT /api/heating-settlement/:plant/:period/close': s('Versanddatum der Heizkostenabrechnung gespeichert'),
  'DELETE /api/heating-settlement/:plant/:period/close': s('Heizkostenabrechnung wieder geöffnet'),
  'PUT /api/properties/:id/period': s('Abrechnungszeitraum geändert', 'properties'),
  'PUT /api/letter-texts': s('Texte des Anschreibens geändert'),
  'PUT /api/properties/:id/letter-texts': s('Texte des Anschreibens für das Objekt geändert'),
  // #415, Teil 2b: Logo und Briefpapier; Dateien kommen mit derselben Anfrage (hochladen, ersetzen, entfernen).
  'PUT /api/letter-design': s('Logo und Briefpapier geändert'),
  'PUT /api/properties/:id/letter-design': s('Logo und Briefpapier für das Objekt geändert', 'properties'),
  'PUT /api/settlement/:period/letters/:tenancyId': s('Anschreiben an einen Mieter angepasst'),
  'PUT /api/heating-settlement/:plant/:period/letters/:tenancyId': s('Anschreiben an einen Mieter angepasst'),
  // #317: die angekündigte Vorauszahlung als Stufe der Staffel. Der Plan (…/prepayment-steps/plan) liest nur.
  'POST /api/settlement/:period/prepayment-steps': s('Angekündigte Vorauszahlung in die Staffel übernommen', 'tenancies'),
  'POST /api/heating-settlement/:plant/:period/prepayment-steps': s('Angekündigte Heizvorauszahlung in die Staffel übernommen', 'tenancies'),
  'POST /api/settlement/:period/close': s('Abrechnung abgeschlossen', 'closed_settlements'),
  'PUT /api/settlement/:period/close': s('Versanddatum der Abrechnung gespeichert', 'closed_settlements'),
  'DELETE /api/settlement/:period/close': s('Abrechnung wieder geöffnet', 'closed_settlements'),
  'POST /api/upload': s('Beleg hochgeladen', 'uploads'),
  // Der Abbruch entfernt den eben hochgeladenen Beleg wieder (`cancel` in index.ts).
  'POST /api/ai/cancel/:id': s('Auswertung eines Belegs abgebrochen', 'uploads'),
  'POST /api/extract': s('Beleg mit KI ausgewertet', 'uploads'),
  'POST /api/intake': s('Beleg mit KI ausgewertet', 'uploads'),
  'POST /api/heating-plants/:id/service-statement': s('Messdienstabrechnung hochgeladen', 'uploads'),
  'POST /api/heating-plants/:id/fuel-invoice': s('Lieferantenrechnung hochgeladen', 'uploads'),
  'PUT /api/assessments/:id': s('Auswertung eines Belegs geändert'),
  'POST /api/assessments/:id/book': s('Beleg gebucht', 'cost_items'),
  'PUT /api/uploads/:file': s('Objekt oder Jahr eines Belegs geändert', 'uploads'),
  'DELETE /api/uploads/:file': s('Beleg gelöscht', 'uploads'),
  // #318, Schritt 4: Der Satz wird nach dem Rücksprung durch den genauen ersetzt („Rückgängig: …“, „Zurückgekehrt zum
  // Stand vor …“, db/revert.ts).
  'POST /api/journal/:id/revert': s('Rücksprung im Verlauf'),
}

// Vorschauen schreiben in der Schlange, rollen aber immer zurück (dryRun.ts); ihre Gruppe bliebe leer.
// Sie haben bewusst keinen Satz, und `journalMeta` übergeht sie still. Dieselbe Liste nimmt der Wächter
// in journal-routes.test.ts aus.
export const DRY_RUN_ROUTES: ReadonlySet<string> = new Set([
  'POST /api/heating-plants/:id/period/preview',
  'POST /api/heating-plants/:id/separate/preview',
  'POST /api/properties/:id/period/preview',
  'POST /api/journal/:id/revert/preview',
  // #318: Einspielen einer Sicherung, geprüft an einer Kopie; schreibt nichts.
  'POST /api/prior-versions/:name/restore/preview',
])

// Routen, die bei einer Anfrage mehr als einmal schreiben (#318, Schritt 4). Fachlich ist das eine Aktion; schreibt
// zwischen den Teilen eine andere Anfrage, entstehen mehrere Gruppen, die die gemeinsame Anfrage-Kennung
// (`change_groups.request_id`) zu einem Eintrag im Verlauf verbindet. Ein Rücksprung nimmt einen Eintrag immer ganz
// zurück (ab seiner ältesten Gruppe). journal-routes.test.ts verlangt für jede Route mit mehr als einem Schreibvorgang
// einen Eintrag hier, mit Grund; die Liste soll nur kürzer werden.
export const MULTI_WRITE_ROUTES: Readonly<Record<string, string>> = {
  'POST /api/extract': 'Beleg speichern, dann die KI-Auswertung (bis zu Minuten), dann Rechnungsdatum und Auswertung; ein Abbruch entfernt den Beleg wieder.',
  'POST /api/intake': 'Wie /api/extract, dazu die Kennzeichnung als Zählerfoto.',
  'POST /api/heating-plants/:id/service-statement': 'Beleg speichern, dann die KI-Auswertung; ein Abbruch entfernt den Beleg wieder.',
  'POST /api/heating-plants/:id/fuel-invoice': 'Beleg speichern, dann die KI-Auswertung, dann das Rechnungsdatum.',
}

// `null`: Die Route hat keinen Satz und wird nicht erfasst (index.ts, `journalMeta`).
export function routeSentence(method: string, route: string): RouteSentence | null {
  return ROUTE_SENTENCES[`${method} ${route}`] ?? null
}

// Sätze, die eine Umbenennung abgelöst hat (#490: Schnellerfassung und Belegordner sind die Seite „Belege“). Gespeichert
// bleibt der alte Satz; der Verlauf zeigt den neuen (`currentDescription`), damit kein Eintrag eine Seite nennt, die es
// nicht mehr gibt. Die Suche im Verlauf findet ältere Einträge weiter unter dem alten Wortlaut.
export const RENAMED_SENTENCES: Readonly<Record<string, string>> = {
  'Beleg in der Schnellerfassung ausgewertet': 'Beleg mit KI ausgewertet',
  'Beleg im Posteingang geändert': 'Objekt oder Jahr eines Belegs geändert',
}
export const currentDescription = (description: string): string => RENAMED_SENTENCES[description] ?? description
