// Parameter des Gebäudemodernisierungsgesetzes (Heizung PR 18, #215): § 43 in der Fassung von Art. 1
// G v. 23.07.2026 (BGBl. 2026 I Nr. 226, S. 9 f.), in Kraft seit 29.07.2026. Art. 2 ändert ab 01.01.2027 nur
// Abs. 2 (Verweise), Art. 3 und 4 ändern § 43 nicht (am Regelungstext geprüft). Wortlaut am 11.10.2026 auf
// gesetze-im-internet.de (`/geg/__43.html`, dort als „Gebäudemodernisierungsgesetz – GModG“) und am
// Regelungstext BGBl. 2026 I Nr. 226, S. 9 gelesen (Prüfung des Plans, S7).
import { germanDate, type LawParam } from './register.ts'
import { co2HalfSplit } from './co2kostaufg.ts'

// § 43 Abs. 1: Eine Heizung, „die mit Gas, Heizöl oder Flüssiggas beschickt wird“ und „nach dem 29. Juli
// 2026 in ein bestehendes Gebäude neu eingebaut“ wird; ihr Eigentümer muss ab 2029 mindestens 10, ab 2030
// 15, ab 2035 30 und ab 2040 60 Prozent der Wärme aus den dort genannten Brennstoffen erzeugen.
// `eventDate`: der Einbau. Nur eine Heizung dieser Art löst § 5a CO2KostAufG aus.
export type Heating43 = { readonly installedAfter: string; readonly energies: readonly string[]; readonly mandatory: readonly { readonly from: string; readonly permille: number }[] }
export const gmodgHeating43: LawParam<Heating43, 'eventDate'> = {
  id: 'gmodg.heating-43',
  title: 'Gas-, Öl- oder Flüssiggasheizung nach § 43 Abs. 1 GModG',
  norm: '§ 43 Abs. 1 GModG',
  timing: 'eventDate',
  versions: [{
    value: {
      installedAfter: '2026-07-29',
      energies: ['gas', 'oil', 'lpg'],
      mandatory: [{ from: '2029-01-01', permille: 100 }, { from: '2030-01-01', permille: 150 }, { from: '2035-01-01', permille: 300 }, { from: '2040-01-01', permille: 600 }],
    },
    source: {
      rank: 'law',
      cite: '§ 43 Abs. 1 GModG (Art. 1 G v. 23.07.2026, BGBl. 2026 I Nr. 226, https://www.recht.bund.de/eli/bund/bgbl-1/2026/226)',
      url: 'https://www.gesetze-im-internet.de/geg/__43.html',
      retrieved: '2026-10-11',
      checked: 'checked',
    },
    enacted: 'GModG, Überschrift und § 43 durch Art. 1 G v. 23.07.2026 (BGBl. 2026 I Nr. 226)',
  }],
  describe: (v) => `Gas-, Öl- oder Flüssiggasheizung, eingebaut nach dem ${germanDate(v.installedAfter)} in ein bestehendes Gebäude; Pflichtanteil ${v.mandatory.map((m) => `ab ${m.from.slice(0, 4)} ${m.permille / 10} %`).join(', ')}`,
}

// Ab wann der Pflichtanteil die Grenze des § 5a Abs. 3 Nr. 3 übersteigt (Abweichung 10): bis dahin ist der
// Preisbestandteil nach § 3 Abs. 1 Nr. 6 der des ganzen Pflichtanteils und liegt in der Regel nicht über der
// Grenze (§ 43 Abs. 1 GModG misst Prozent der Wärme, § 5a Abs. 3 Nr. 3 Prozent des Brennstoffs).
export function bioCapFrom(): string | null {
  const cap = co2HalfSplit.versions.map((v) => v.value.bioCapPermille).find((c) => c !== null) ?? null
  if (cap === null) return null
  const [only] = gmodgHeating43.versions
  return only?.value.mandatory.find((m) => m.permille > cap)?.from ?? null
}
