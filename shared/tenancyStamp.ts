import type { Tenancy } from './types.ts'

// Die Marke des Stands, den das Formular eines Mietverhältnisses geladen hat (Laienprobe B1).
//
// Das Formular in den Stammdaten schickt beim Speichern **alle** Staffeln mit, und die Route
// ersetzt jede, deren Schlüssel im Rumpf steht (repository.ts: zusammengeführt wird nach
// Anwesenheit, sonst ließe sich ein Feld nie leeren). Das ist richtig, solange das Formular den
// Stand kennt, den es ersetzt. Ändert ein anderer Weg die Staffeln, während es offen ist oder die
// Seite nicht neu geladen wurde (das Aufteilen der Vorauszahlung beim Einschalten der getrennten
// Heizkostenabrechnung, ein Wechsel des Zeitraums), schrieb ein „Übernehmen“ den alten Stand
// zurück und löschte die Heizvorauszahlung ohne Meldung.
//
// Deshalb schickt das Formular diese Marke mit (`ifUnchanged`), und der Server lehnt mit 409 ab,
// wenn der gespeicherte Stand eine andere ergibt. Sie steht hier und nicht im Server, weil Browser
// und Server sie aus demselben Mietverhältnis gleich bilden müssen; eine Spalte für eine Fassung
// bräuchte eine Migration, die Marke nicht. Erfasst sind genau die Felder, die das Formular ganz
// ersetzt und die ein anderer Weg ändern kann.
type StampSource = Pick<Tenancy, 'start' | 'end' | 'prepayments' | 'heatingPrepayments' | 'flatRates' | 'baseRents' | 'personHistory'>

const schedule = (rows: readonly { from: string; monthlyCents: number }[] | undefined): string[] =>
  (rows ?? []).map((r) => `${r.from}=${r.monthlyCents}`).sort()

export function tenancyStamp(t: StampSource): string {
  return JSON.stringify([
    t.start,
    t.end ?? null,
    schedule(t.prepayments),
    schedule(t.heatingPrepayments),
    schedule(t.flatRates),
    schedule(t.baseRents),
    (t.personHistory ?? []).map((p) => `${p.from}=${p.persons}`).sort(),
  ])
}
