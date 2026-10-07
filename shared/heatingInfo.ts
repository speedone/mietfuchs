// Kontaktinformationen nach § 6a Abs. 3 Satz 1 Nr. 2 HeizkostenV (Heizung PR 14, Entwurf 8.8): „darunter
// Internetadressen von Verbraucherorganisationen, Energieagenturen oder ähnlichen Einrichtungen, bei
// denen Informationen über angebotene Maßnahmen zur Energieeffizienzverbesserung,
// Endnutzer-Vergleichsprofile und objektive technische Spezifikationen für energiebetriebene Geräte
// eingeholt werden können“. Kein Rechtswert, deshalb nicht im Register; die jährliche Durchsicht
// (Entwurf 4.8 Nr. 4) ruft jede Adresse auf und setzt das Datum. Alle am 07.10.2026 aufgerufen.
import type { InfoContact } from './types.ts'

export const INFO_CONTACTS_CHECKED = '2026-10-07'
export const INFO_CONTACTS: readonly InfoContact[] = [
  { name: 'Verbraucherzentrale, Energieberatung', url: 'https://verbraucherzentrale-energieberatung.de', what: 'Verbraucherorganisation: Beratung zu Maßnahmen, die Energie sparen' },
  { name: 'Deutsche Energie-Agentur (dena)', url: 'https://www.dena.de', what: 'Energieagentur: Informationen zur Energieeffizienz von Gebäuden' },
  { name: 'Bundesstelle für Energieeffizienz beim BAFA', url: 'https://www.bfee-online.de', what: 'Informationen über angebotene Maßnahmen zur Energieeffizienzverbesserung und ihre Anbieter' },
  { name: 'Europäische Produktdatenbank für die Energieverbrauchskennzeichnung (EPREL)', url: 'https://eprel.ec.europa.eu', what: 'Technische Angaben und Energielabel energiebetriebener Geräte' },
]

// Kein Verbrauchervertrag (§ 310 Abs. 3 BGB) in `heating_periods.consumer_contract`.
export const CONSUMER_CONTRACT_NONE = 'none'

// Die Postleitzahl aus der Adresse des Objekts, für den Hinweis zum Klimafaktor des DWD. Fünf Ziffern als
// eigenes Wort; ohne eine solche Folge `null`.
export function postalCodeOf(address: string | null | undefined): string | null {
  const m = /(?:^|\D)(\d{5})(?!\d)/.exec(address ?? '')
  return m?.[1] ?? null
}
