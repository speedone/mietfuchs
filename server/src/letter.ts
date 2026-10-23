// Das Anschreiben je Mietverhältnis (#415): aus den Texten der Ebenen und den Zahlen der Abrechnung,
// mit den Bausteinen und Platzhaltern aus shared/letter.ts. Der Server setzt die Werte ein, damit das,
// was beim Abschluss einfriert, genau das ist, was die Seite gezeigt hat; die Oberfläche wählt nur
// noch, welche Bausteine erscheinen, und setzt Datum und Zahl der Belege ein.
//
// Die Berechnung kennt das Anschreiben nicht: Es hängt an der Route (`letters` neben `statements`),
// und `deviation` vergleicht weiter nur Zahlen.
import type { Property, StatementLetter } from '../../shared/types.ts'
import { lettersOf, type LetterSource } from '../../shared/letter.ts'
import type { Executor } from './db/client.ts'
import { readInstallationLetterTexts, readPropertyLetterTexts, readTenancyLetters } from './db/letters.ts'

// Die Kennung einer Abrechnung für die Anpassungen je Mieter: der Zeitraum der
// Betriebskostenabrechnung oder die Heizperiode einer getrennten Heizkostenabrechnung.
export const letterDoc = (period: string, plantId?: string): string => (plantId ? `heating:${plantId}:${period}` : period)

// Liest alles, was `lettersOf` braucht: die Texte aller Ebenen und die Anpassungen je Mieter.
export async function lettersFor(
  db: Executor,
  s: Parameters<typeof lettersOf>[0],
  ctx: { settings: LetterSource['settings'], property: Property | null, tenancies: LetterSource['tenancies'], doc: string },
): Promise<Record<string, StatementLetter>> {
  return lettersOf(s, {
    settings: ctx.settings,
    property: ctx.property,
    tenancies: ctx.tenancies,
    installation: await readInstallationLetterTexts(db),
    propertyTexts: ctx.property ? await readPropertyLetterTexts(db, ctx.property.id) : {},
    own: await readTenancyLetters(db, ctx.doc, s.statements.map((st) => st.tenancyId)),
  })
}
