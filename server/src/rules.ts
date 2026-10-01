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

export const RULES_AS_OF = '2026-10-02'

export const RULES: readonly Rule[] = [
  {
    code: 'tv-signal',
    title: 'Kabelfernsehen über die Nebenkosten',
    norm: '§ 2 Satz 1 Nr. 15 und Satz 2 BetrKV',
    summary:
      'Die Gebühren für das TV-Signal eines Kabelanschlusses und die Grundgebühren eines Breitbandanschlusses durften bis zum 30.06.2024 ' +
      'als Betriebskosten umgelegt werden, und zwar nur bei Anlagen, die vor dem 01.12.2021 errichtet wurden. Seitdem nicht mehr. ' +
      'Bei Anlagen, die vor dem 01.12.2021 errichtet wurden, bleiben umlagefähig: bei einer Gemeinschaftsantenne des Hauses der ' +
      'Betriebsstrom sowie Prüfung und Einstellung durch eine Fachkraft, bei einer Breitband-Verteilanlage nur der Betriebsstrom. ' +
      'Bei später errichteten Anlagen ist davon nichts umlagefähig, ausgenommen eine reine Glasfaser-Verteilanlage (Betriebsstrom und Bereitstellungsentgelt).',
    validTo: '2024-06-30',
  },
  {
    code: 'heating-flat-rate',
    title: 'Pauschale oder Warmmiete bei Heizung und Warmwasser',
    norm: '§§ 2, 12 Abs. 1 HeizkostenV; BGH, Urteil vom 19.07.2006, VIII ZR 212/05',
    summary:
      'Heizung und Warmwasser müssen nach Verbrauch abgerechnet werden; die Heizkostenverordnung geht einer Pauschale oder Warmmiete vor. ' +
      'Die Vereinbarung wird dann nicht angewendet: Der Heizanteil gilt als Vorauszahlung, über die nach Verbrauch abzurechnen ist. ' +
      'Nur im Gebäude mit höchstens zwei Wohnungen, von denen der Vermieter eine selbst bewohnt, und in den Fällen des § 11 darf etwas anderes vereinbart werden. ' +
      'Wird nicht nach Verbrauch abgerechnet, darf der Mieter seinen Anteil um 15 % kürzen.',
  },
  {
    code: 'heating-consumption',
    title: 'Heizung und Warmwasser nach Verbrauch',
    norm: '§§ 2, 7 Abs. 1, 8 Abs. 1, 12 Abs. 1 HeizkostenV',
    summary:
      'Von den Kosten der zentralen Heizungs- und Warmwasseranlage sind mindestens 50 und höchstens 70 % nach dem erfassten Verbrauch zu verteilen, der Rest nach Wohn- oder Nutzfläche (bei der Heizung auch nach umbautem Raum). ' +
      'Wird nicht verbrauchsabhängig abgerechnet, darf der Mieter seinen Anteil um 15 % kürzen. ' +
      'Im Gebäude mit höchstens zwei Wohnungen, von denen der Vermieter eine selbst bewohnt, darf anderes vereinbart werden; ohne eine solche Vereinbarung gilt die Verordnung auch dort.',
  },
  {
    // Durchsicht vom 02.10.2026 (#110): Die Nachrüstfrist des § 5 Abs. 3 endet am 31.12.2026. Für
    // Geräte, die nach dem 01.12.2021 eingebaut wurden, gilt die Pflicht schon seit dem Einbau;
    // ab 2027 gilt sie für alle, deshalb beginnt die Regel hier. Wortlaut geprüft auf
    // https://www.gesetze-im-internet.de/heizkostenv/ (Stand Art. 3 G v. 16.10.2023 I Nr. 280).
    code: 'heating-remote-reading',
    title: 'Fernablesbare Zähler und monatliche Verbrauchsinformation',
    norm: '§ 5 Abs. 2, 3 und 5, § 6a, § 12 Abs. 1 Satz 2 und 3 HeizkostenV',
    summary:
      'Zähler und Heizkostenverteiler für Heizung und Warmwasser müssen fernablesbar sein: die nach dem 01.12.2021 eingebauten sofort, alle übrigen ab dem 01.01.2027 (Nachrüstfrist bis 31.12.2026). ' +
      'Sind fernablesbare Geräte eingebaut, stehen den Mietern monatliche Verbrauchsinformationen zu. ' +
      'Fehlt das eine oder das andere, darf der Mieter seinen Anteil an den Heizkosten um 3 % kürzen. ' +
      'Ausgenommen sind Fälle, in denen die Nachrüstung technisch nicht möglich ist, einen unangemessenen Aufwand bedeutet oder in sonstiger Weise eine unbillige Härte wäre.',
    validFrom: '2027-01-01',
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
