import type { RentEntry, Tenancy } from './types.ts'

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
type StampSource = Pick<Tenancy, 'start' | 'end' | 'prepayments' | 'heatingPrepayments' | 'flatRates' | 'baseRents' | 'personHistory' | 'rentKind' | 'rentIncreaseExcluded'>

const schedule = (rows: readonly { from: string; monthlyCents: number }[] | undefined): string[] =>
  (rows ?? []).map((r) => `${r.from}=${r.monthlyCents}`).sort()

// Die Kaltmiete-Staffel trägt seit #191 Art und Indexwert je Stufe; fehlen sie, entsteht kein Text, damit die Marke eines
// Mietverhältnisses ohne diese Angaben die bisherige bleibt (offene Tabs bekommen nach dem Update nicht grundlos 409).
const rentSchedule = (rows: readonly Pick<RentEntry, 'from' | 'monthlyCents' | 'reason' | 'index'>[] | undefined): string[] =>
  (rows ?? [])
    .map((r) => `${r.from}=${r.monthlyCents}${r.reason !== undefined ? `;${r.reason}` : ''}${r.index !== undefined ? `;${r.index.month}:${r.index.value}:${r.index.base}` : ''}`)
    .sort()

export function tenancyStamp(t: StampSource): string {
  return JSON.stringify([
    t.start,
    t.end ?? null,
    schedule(t.prepayments),
    schedule(t.heatingPrepayments),
    schedule(t.flatRates),
    rentSchedule(t.baseRents),
    (t.personHistory ?? []).map((p) => `${p.from}=${p.persons}`).sort(),
    // Art der Miete und Ausschluss (#191): nur angehängt, wenn gesetzt.
    ...(t.rentKind !== undefined || t.rentIncreaseExcluded !== undefined ? [t.rentKind ?? null, t.rentIncreaseExcluded ?? null] : []),
  ])
}
