// Das Regelverzeichnis (#112): Rechtsregeln, die die Berechnung anwendet, jeweils mit dem
// Zeitraum, in dem sie gelten. Eine Abrechnung rechnet nach dem Recht ihres Jahres und nicht
// nach dem von heute; wo eine Regel nur für einen Teil des Jahres gilt, sagt das
// `ruleCoverage`, und calc.ts entscheidet daraus, statt ein Jahr fest hinzuschreiben.
//
// Aufgenommen wird nur, was die Berechnung wirklich anwendet. Das Verzeichnis ist keine
// Rechtsbibliothek, sondern die Liste, gegen die eine Abrechnung geprüft wurde; deshalb steht
// sie als Rechtsstand in jeder Abrechnung und wird beim Abschließen mit eingefroren.
//
// ISO-Daten werden Zeichen für Zeichen verglichen, wie `compareText` in calc.ts; die Datei
// importiert calc.ts nicht, weil calc.ts sie importiert.
//
// Wer eine Regel ändert oder ergänzt, setzt `RULES_AS_OF` auf den Tag der Durchsicht (#110).

export type Rule = {
  code: string
  title: string
  // Rechtsgrundlage, wie sie ein Mensch nachschlägt
  norm: string
  // in einfachen Worten, ein bis zwei Sätze
  summary: string
  // ISO-Daten, inklusive; fehlt eine Grenze, gilt die Regel in diese Richtung unbegrenzt
  validFrom?: string
  validTo?: string
}

export const RULES_AS_OF = '2026-09-30'

export const RULES: readonly Rule[] = [
  {
    code: 'tv-signal',
    title: 'Kabelfernsehen über die Nebenkosten',
    norm: '§ 2 Nr. 15 BetrKV a. F., § 230 Abs. 4 TKG',
    summary:
      'Die Gebühren für das TV-Signal eines Kabelanschlusses durften bis zum 30.06.2024 als Betriebskosten umgelegt werden. ' +
      'Seitdem nicht mehr (Wegfall des Nebenkostenprivilegs); Betriebsstrom und Wartung einer Antennenanlage bleiben umlagefähig.',
    validTo: '2024-06-30',
  },
  {
    code: 'heating-flat-rate',
    title: 'Pauschale oder Warmmiete bei Heizung und Warmwasser',
    norm: '§ 2, § 12 HeizkostenV',
    summary:
      'Heizung und Warmwasser müssen nach Verbrauch abgerechnet werden; die Heizkostenverordnung geht einer anderen Vereinbarung vor. ' +
      'Ausgenommen ist nur das Zweifamilienhaus, in dem der Vermieter selbst wohnt. Sonst darf der Mieter um 15 % kürzen.',
  },
]

function ruleByCode(code: string): Rule {
  const rule = RULES.find((r) => r.code === code)
  // Ein unbekannter Code ist ein Tippfehler im Programm; eine stille Antwort ließe die Regel
  // unbemerkt nie greifen.
  if (!rule) throw new Error(`Unbekannte Regel „${code}“`)
  return rule
}

// Regeln, deren Gültigkeit den Zeitraum [from, to] berührt, in der Reihenfolge des Verzeichnisses.
export function rulesFor(from: string, to: string): Rule[] {
  return RULES.filter((r) => (!r.validFrom || r.validFrom <= to) && (!r.validTo || r.validTo >= from))
}

// Gilt die Regel im ganzen Zeitraum, in einem Teil davon oder gar nicht?
export function ruleCoverage(code: string, from: string, to: string): 'full' | 'partial' | 'none' {
  const rule = ruleByCode(code)
  if (!rulesFor(from, to).includes(rule)) return 'none'
  const startsInside = rule.validFrom !== undefined && rule.validFrom > from
  const endsInside = rule.validTo !== undefined && rule.validTo < to
  return startsInside || endsInside ? 'partial' : 'full'
}
