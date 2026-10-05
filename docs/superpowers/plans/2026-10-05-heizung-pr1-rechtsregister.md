# Heizung PR 1: Rechtsregister Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jede Rechtszahl, mit der Mietfuchs heute rechnet oder die es nennt (Kabelregel, 15 %, 50 bis 70 %, Leerstand mit einer Person, Fernablesbarkeit und 3 %, Umsatzsteuer), steht danach genau einmal im Rechtsregister `shared/law/`, mit Gültigkeit, Fundstelle und Zeitregel. Die benutzten Werte frieren mit der abgeschlossenen Abrechnung ein, und `deviation` vergleicht sie. Keine Zahl und kein Wort einer Abrechnung ändert sich.

**Architecture:** `shared/law/register.ts` hält Typen, die Abfrage `law(param, ctx, log)` mit genau einer Zeitregel je Parameter und das Protokoll `LawLog`. Die Werte stehen je Gesetz in eigenen Dateien und gesammelt in `params.ts`; das Regelverzeichnis zieht von `server/src/rules.ts` nach `shared/law/rules.ts` und liest seine Zahlen von dort. `computeSettlement` legt je Abrechnung ein Protokoll an, fragt jeden Wert erst dort ab, wo er gebraucht wird, und legt das Protokoll in `legalBasis.values`. Ein Wächter verbietet die Zahlen außerhalb des Registers.

**Tech Stack:** TypeScript 7 (Typen werden von Node abgestreift, `erasableSyntaxOnly`, `verbatimModuleSyntax`), Node 24.15 mit `node:test`, React 19 mit vitest, kein neues Paket.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` auf `feat/heizung`. Geplant nach der **dritten Fassung** (Commit `1f6c6f1`); die vierte bis achte Fassung (bis `09ec10b`) ändern PR 1 nicht, jede sagt das unter „Folgen für PR 1“, und zwischen den Fassungen hat sich nur die Spezifikation geändert, kein Code. Für diesen Plan maßgeblich: Abschnitt 0.6 („Folgen für PR 1“), Abschnitt 3.13, Abschnitt 4 vollständig, 10.2, 12.4 (Wächter und Lexikon), 13 (Zeile PR 1).

## Global Constraints

- PR 1 ändert **keine Zahl und keinen Text** einer Abrechnung: Golden F01–F11 (`settlement-golden.test.ts`), `db-golden.test.ts` und `calc-wortlaut.test.ts` bleiben unverändert grün, ihre Fixtures werden nicht angefasst. Die Vergleiche lassen `legalBasis.values` aus (sie lesen es heute schon nicht).
- **Keine Migration.** `legalBasis` steckt im eingefrorenen Stand `closed_settlements.settlement`, einer JSON-Spalte (CLAUDE.md, „Der eingefrorene Berechnungsstand bleibt JSON“). Kein `db:generate`, kein Eingriff in `server/src/legacy/` (Prüfsummen).
- **Eine Zeitregel je Parameter** (N6). Fälle mit zwei Zeitregeln sind zwei Parameter.
- In PR 1 genau diese sieben Parameter, keine weiteren: `betrkv.tv-signal`, `hkv.consumption-share`, `hkv.cut.not-by-consumption`, `hkv.cut.remote-reading`, `hkv.remote-reading.retrofit`, `practice.vacancy-persons`, `ustg.standard-rate`. **Nicht** in PR 1: `hkv.degree-days` (PR 3), `hkv.remote-reading.new-devices` (PR 4), `hkv.heat-pump.capture` (PR 10).
- Rechtsaussagen nur mit Fundstelle aus dem Entwurf. `ustg.standard-rate` bleibt `checked: 'unchecked'`, wie der Entwurf ihn markiert; die Release-Sperre greift dann beim Tag.
- Bezeichner englisch, Kommentare und Texte deutsch, Nutzertexte siezen. Im Server Importe mit `.ts`, im Client endungslos außer aus `shared/` (dort mit `.ts`). `import type` für reine Typimporte, kein `enum`, kein `namespace`, keine Parameter-Eigenschaften.
- Geld in Cent als Integer. ISO-Daten werden Zeichen für Zeichen verglichen (`compareText`-Konvention), Daten in UTC.
- Jeder Commit nur bei grünem Exit-Status von `npm --prefix server test` bzw. dem genannten Test, nie hinter einem `grep`. Vor jedem Commit `npm run typecheck`.
- Commit-Nachrichten deutsch, mit `Refs #97` und `Refs #110` (nie `Fixes`/`Closes`), Trailer laut Sitzung.
- Aufgaben stehen in GitHub-Issues, nie in Beads (`bd`).

## Review Focus

1. **Eine Abrechnung, die vor 0.11.0 abgeschlossen wurde** (eingefroren ohne `legalBasis.values`, oder ganz ohne `legalBasis`): Die Seite Abrechnung zeigt „Rechtswerte nicht gespeichert (vor 0.11.0)“ statt einer leeren Liste, und `deviation` meldet keine erfundene Rechtsänderung. Tests: Task 7 (`settlement-diff.test.ts` „Abschlüsse vor 0.11.0“, `notices.test.ts` `valuesNote`).
2. **Ein Abrechnungsjahr weit vor oder nach allen Fassungen** (1990, 2100): `law()` wirft bei fehlender Fassung; eine Abrechnung darf daran nicht scheitern, sonst antwortet die Seite mit 500. Test: Task 4 („jedes Jahr rechnet, auch weit vor und nach den Fassungen“).
3. **Zwei Abrechnungen nacheinander oder nebeneinander:** Das Protokoll ist je Berechnung und nicht global; eine Heizabrechnung darf ihre Werte nicht in die nächste Abrechnung ohne Heizung tragen. Tests: Task 2 („zwei Protokolle sind getrennt“), Task 4 („zwei Abrechnungen nacheinander teilen kein Protokoll“).
4. **Ein Beleg mit einem Rechnungsdatum, das das Modell nicht im Format JJJJ-MM-TT liefert** („15.08.2020“, eine Zahl, gar keins): Die Auswertung darf nicht abbrechen, sondern nimmt den Satz von heute. Test: Task 5 („ohne lesbares Rechnungsdatum“).
5. **Die gebaute Oberfläche lädt das Register:** Lexikon, Anleitungen und Cockpit importieren jetzt `shared/law/` zur Laufzeit; ein Importfehler fiele erst im Browser auf. Prüfung: Task 8 (`npm run build` und der vitest-Lauf, der `glossary.ts` und `Cockpit` lädt).

---

## Dateien

| Datei | Aufgabe |
|---|---|
| `shared/law/register.ts` (neu) | Typen, `law()`, `valueAt`, `versionAt`, `onlyVersion`, `createLawLog`, Datumshelfer, `LAW_AS_OF` |
| `shared/law/heizkostenv.ts` (neu) | `hkv.consumption-share`, `hkv.cut.not-by-consumption`, `hkv.cut.remote-reading`, `hkv.remote-reading.retrofit` |
| `shared/law/bgb-betrkv.ts` (neu) | `betrkv.tv-signal` |
| `shared/law/ustg.ts` (neu) | `ustg.standard-rate` (der Entwurf nennt in 4.2 keine Datei für die Umsatzsteuer; eine eigene je Gesetz wie bei den übrigen) |
| `shared/law/practice.ts` (neu) | `practice.vacancy-persons` |
| `shared/law/params.ts` (neu) | `LAW_PARAMS` |
| `shared/law/rules.ts` (verschoben aus `server/src/rules.ts`) | Regelverzeichnis, Zahlen aus den Parametern |
| `shared/types.ts` | `LawValue`, `AppliedValue`, `LegalBasis.values`, `LawValueChange`, `SettlementComparison.valueChanges` |
| `shared/heating.ts` | `heatingFindings` bekommt die Grenzen hineingereicht |
| `server/src/calc.ts` | alle Rechtszahlen aus dem Register, Protokoll, `legalBasis.values` |
| `server/src/invoiceAmounts.ts` | Regelsatz nach Rechnungsdatum aus dem Register |
| `server/src/settlementDiff.ts` | `valueChanges` |
| `server/src/store.ts` | `StoredSettlement.legalBasis` mit optionalen `values` |
| `shared/glossary.ts`, `shared/guides.ts`, `client/src/pages/Cockpit.tsx` | Zahlen aus dem Register |
| `client/src/deviation.ts`, `client/src/notices.ts`, `client/src/pages/Abrechnung.tsx` | Rechtswerte anzeigen |
| `server/testing/sourceScan.ts` (neu) | Scanner aus `anrede.test.ts`, gemeinsam mit dem neuen Wächter |
| `.github/workflows/release.yml` | Release-Sperre beim Tag |
| Tests (neu) | `law-wording`, `law`, `law-history`, `law-release`, `calc-rechtswerte`, `law-literals` |
| `CHANGELOG.md`, `CLAUDE.md` | Doku |

---

### Task 1: Wortlaut vor dem Umzug festhalten

Ein Charakterisierungstest, der auf dem **unveränderten** Code grün ist und es in jeder folgenden Aufgabe bleiben muss. Die vorhandenen Tests zu Kabel, Heizung und Fernablesbarkeit prüfen mit Mustern; erst ein wörtlicher Vergleich fängt ein „15 %“, aus dem „15%“ geworden ist.

**Files:**
- Create: `server/test/law-wording.test.ts`

**Interfaces:**
- Consumes: `computeSettlement`, `NOTICE_KINDS` (calc.ts), `snapshotOf` (snapshot.ts), `RULES` (heute `server/src/rules.ts`), `GLOSSARY`, `GUIDES`.
- Produces: den Test, den Task 3, 4 und 6 grün halten müssen. Task 3 ändert darin nur den Importpfad von `RULES`.

- [ ] **Step 1: Test schreiben**

Datei `server/test/law-wording.test.ts`, vollständig:

```ts
// Wortlaut der Rechtstexte beim Umzug ins Rechtsregister (Heizung PR 1, Entwurf 4.7): Die Zahlen
// und Daten der Rechtsregeln kommen danach aus shared/law/ und nicht mehr als Literal aus calc.ts,
// rules.ts, dem Lexikon und den Anleitungen. Am Wortlaut darf sich dabei nichts ändern, kein Zeichen.
// Dieser Test hält den Wortlaut **vor** dem Umzug fest; er entstand auf dem unveränderten Code und
// wird nicht neu erzeugt. Golden F01–F11 prüfen nur die Texte, die in ihren Beständen vorkommen,
// und die vorhandenen Tests zu Kabel, Heizung und Fernablesbarkeit prüfen mit Mustern. Erst ein
// wörtlicher Vergleich fängt ein „15 %“, aus dem „15%“ oder „15 Prozent“ geworden ist.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, NOTICE_KINDS, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type Snapshot, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { RULES } from '../src/rules.ts'
import { GLOSSARY } from '../../shared/glossary.ts'
import { GUIDES } from '../../shared/guides.ts'

const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const unit = (id: string, areaM2: number, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2, participates: true, ...over })
const item = (year: number, over: Partial<SnapshotCostItem>): SnapshotCostItem =>
  ({ id: 'k', year, category: 'Heizung und Warmwasser', description: 'Posten', amountCents: 120000, key: 'area', ...over })
const snap = (year: number, s: Partial<SnapshotSource>, property?: Snapshot['property']): Snapshot => ({
  ...snapshotOf({ units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s }, year),
  ...(property !== undefined ? { property } : {}),
})
const two = { units: [unit('w1', 60), unit('w2', 40)], tenancies: [tenancy('A', 'w1'), tenancy('B', 'w2')] }
const textOf = (s: ComputedSettlement, code: string): string => {
  const n = s.notices.find((x) => x.code === code)
  if (!n) assert.fail(`kein Hinweis ${code}, sondern: ${s.notices.map((x) => x.code).join(', ')}`)
  return n.text
}
const cable = (year: number) => item(year, { category: 'Kabel/Antenne', description: 'Kabelanschluss', key: 'units' })
const meters = ['w1', 'w2'].map((u) => ({ id: `z-${u}`, unitId: u, type: 'waerme' as const }))
const readings = ['w1', 'w2'].flatMap((u, i) => [{ meterId: `z-${u}`, date: '2024-12-31', value: 0 }, { meterId: `z-${u}`, date: '2025-12-31', value: 10 + i }])
const ruleOf = (code: string) => {
  const r = RULES.find((x) => x.code === code)
  if (!r) assert.fail(`keine Regel ${code}`)
  return `${r.validFrom ?? ''}|${r.validTo ?? ''}|${r.summary}`
}
const caveat = (guide: keyof typeof GUIDES, index: number): string => {
  const c = GUIDES[guide].caveats[index]
  if (!c) assert.fail(`kein Hinweis ${index} in der Anleitung ${guide}`)
  return c.text
}

// Was heute dasteht, je Stelle.
const actual = (): Record<string, string | undefined> => ({
  'tv-signal.partial-year': textOf(computeSettlement(snap(2024, { ...two, costItems: [cable(2024)] })), 'tv-signal.partial-year'),
  'tv-signal.ended': textOf(computeSettlement(snap(2025, { ...two, costItems: [cable(2025)] })), 'tv-signal.ended'),
  'tv-signal.new-system 2021': textOf(computeSettlement(snap(2021, { ...two, costItems: [cable(2021)] }, { kind: 'mfh', cableBuiltBeforeDec2021: false })), 'tv-signal.new-system'),
  'tv-signal.new-system 2023': textOf(computeSettlement(snap(2023, { ...two, costItems: [cable(2023)] }, { kind: 'mfh', cableBuiltBeforeDec2021: false })), 'tv-signal.new-system'),
  'heating.not-by-consumption': textOf(computeSettlement(snap(2025, { ...two, costItems: [item(2025, { description: 'Heizöl' })] })), 'heating.not-by-consumption'),
  'heating.may-agree-otherwise': textOf(computeSettlement(snap(2025, {
    units: [unit('oben', 80), unit('unten', 80, { participates: false, selfUsed: true, selfPersons: 1 })],
    tenancies: [tenancy('A', 'oben')],
    costItems: [item(2025, { description: 'Heizöl' })],
  })), 'heating.may-agree-otherwise'),
  'heating.consumption-share': textOf(computeSettlement(snap(2025, { ...two, meters, readings, costItems: [
    item(2025, { id: 'g', description: 'Grundkosten', amountCents: 84000 }),
    item(2025, { id: 'v', description: 'Verbrauchskosten', amountCents: 36000, key: 'meter', meterType: 'waerme' }),
  ] })), 'heating.consumption-share'),
  'heating.flat-rate': textOf(computeSettlement(snap(2025, {
    units: two.units,
    tenancies: [tenancy('A', 'w1', { heatingModel: 'flatRate' }), tenancy('B', 'w2')],
    costItems: [item(2025, { key: 'amounts', tenancyAmounts: { A: 60000, B: 60000 } })],
  })), 'heating.flat-rate'),
  'heating.remote-reading': textOf(computeSettlement(snap(2027, { ...two, costItems: [item(2027, { key: 'amounts', tenancyAmounts: { A: 60000, B: 60000 } })] })), 'heating.remote-reading'),
  'basis.vacancy-persons': textOf(computeSettlement(snap(2025, {
    units: two.units,
    tenancies: [tenancy('A', 'w1')],
    costItems: [item(2025, { category: 'Müllabfuhr', description: 'Müll', key: 'persons' })],
  })), 'basis.vacancy-persons'),
  'title tv-signal.partial-year': NOTICE_KINDS['tv-signal.partial-year']?.title,
  'title heating.consumption-share': NOTICE_KINDS['heating.consumption-share']?.title,
  'rule tv-signal': ruleOf('tv-signal'),
  'rule heating-flat-rate': ruleOf('heating-flat-rate'),
  'rule heating-consumption': ruleOf('heating-consumption'),
  'rule heating-remote-reading': ruleOf('heating-remote-reading'),
  'glossary heatingCostOrdinance.short': GLOSSARY.heatingCostOrdinance.short,
  'glossary heatingCostOrdinance.example': GLOSSARY.heatingCostOrdinance.example,
  'guide multiFamily.caveats[2]': caveat('multiFamily', 2),
  'guide flatRate.caveats[2]': caveat('flatRate', 2),
  'guide meteringService.caveats[0]': caveat('meteringService', 0),
})

// Abgedruckt am 05.10.2026 auf dem Stand von origin/feat/heizung (v0.10.1 samt #216), vor jeder
// Änderung dieser PR. Gültigkeit der Regeln als „ab|bis|Kurzfassung“.
const EXPECTED: Record<string, string> = {
  "tv-signal.partial-year": "„Kabelanschluss“: Die Gebühren für das Kabelfernsehen (TV-Signal) sind nur bis zum 30.06.2024 umlagefähig, danach nicht mehr (Wegfall des Nebenkostenprivilegs). Umlegen dürfen Sie für 2024 höchstens das erste Halbjahr, und das nur bei einer Anlage, die vor dem 01.12.2021 errichtet wurde; danach nur noch den Betriebsstrom (bei einer Gemeinschaftsantenne des Hauses auch Prüfung und Einstellung durch eine Fachkraft). Bitte teilen Sie die Position entsprechend auf und buchen Sie den Rest als „Nicht umlagefähig“.",
  "tv-signal.ended": "„Kabelanschluss“: Die Gebühren für das Kabelfernsehen (TV-Signal) sind seit dem 01.07.2024 nicht mehr umlagefähig (Wegfall des Nebenkostenprivilegs). Auf die Mieter umgelegt sind in dieser Abrechnung 1.200,00 €. Umlegen dürfen Sie nur noch den Betriebsstrom, und das nur bei einer Anlage, die vor dem 01.12.2021 errichtet wurde (bei einer Gemeinschaftsantenne des Hauses auch Prüfung und Einstellung durch eine Fachkraft); buchen Sie das TV-Signal bitte als „Nicht umlagefähig“.",
  "tv-signal.new-system 2021": "„Kabelanschluss“: Die Kabel- oder Antennenanlage wurde ab dem 01.12.2021 errichtet; für sie waren die Gebühren für das TV-Signal nie umlagefähig, auch Betriebsstrom und Wartung nicht (§ 2 Satz 2 BetrKV). Auf die Mieter umgelegt sind in dieser Abrechnung 1.200,00 €. Umlagefähig sind allenfalls Betriebsstrom und Bereitstellungsentgelt einer reinen Glasfaser-Verteilanlage, bei der der Mieter seinen Anbieter frei wählen kann (§ 2 Nr. 15 Buchst. c BetrKV); buchen Sie den Rest bitte als „Nicht umlagefähig“. Für 2021 gilt das für die Kosten ab der Errichtung; was davor auf eine ältere Anlage entfiel, war umlagefähig.",
  "tv-signal.new-system 2023": "„Kabelanschluss“: Die Kabel- oder Antennenanlage wurde ab dem 01.12.2021 errichtet; für sie waren die Gebühren für das TV-Signal nie umlagefähig, auch Betriebsstrom und Wartung nicht (§ 2 Satz 2 BetrKV). Auf die Mieter umgelegt sind in dieser Abrechnung 1.200,00 €. Umlagefähig sind allenfalls Betriebsstrom und Bereitstellungsentgelt einer reinen Glasfaser-Verteilanlage, bei der der Mieter seinen Anbieter frei wählen kann (§ 2 Nr. 15 Buchst. c BetrKV); buchen Sie den Rest bitte als „Nicht umlagefähig“.",
  "heating.not-by-consumption": "„Heizöl“: Heizung und Warmwasser werden hier nicht nach Verbrauch verteilt. Die Heizkostenverordnung verlangt, mindestens 50 und höchstens 70 % nach dem erfassten Verbrauch zu verteilen, den Rest nach Fläche (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). Sonst darf jeder Mieter seinen Anteil um 15 % kürzen (§ 12 Abs. 1 HeizkostenV), hier: A (w1) 108,00 € und B (w2) 72,00 €. Verteilen Sie 50 bis 70 % nach Verbrauch (eine Position nach Verbrauch mit Wärmezählern, den Rest als eigene Position nach Fläche) oder übernehmen Sie die Abrechnung des Messdienstes als Einzelbeträge.",
  "heating.may-agree-otherwise": "„Heizöl“: Heizung und Warmwasser werden hier nicht nach Verbrauch verteilt. Im Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, darf anderes vereinbart werden (§ 2 HeizkostenV). Die Heizkostenverordnung gilt hier, sofern im Mietvertrag nichts anderes vereinbart ist; dann sind 50 bis 70 % nach Verbrauch zu verteilen, und sonst darf der Mieter seinen Anteil um 15 % kürzen (§ 12 Abs. 1 HeizkostenV).",
  "heating.consumption-share": "Heizung und Warmwasser („Grundkosten“ und „Verbrauchskosten“): nach Zählern verteilt werden 30 % der Heizkosten. Die Heizkostenverordnung verlangt mindestens 50 und höchstens 70 % nach dem erfassten Verbrauch (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). Bitte die Aufteilung zwischen Verbrauchs- und Grundkosten prüfen.",
  "heating.flat-rate": "Für A (w1) ist für Heizung und Warmwasser eine Pauschale oder Warmmiete vereinbart. Die Heizkostenverordnung geht der Vereinbarung vor (§ 2 HeizkostenV); zulässig ist das nur im Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen. Sonst wird der Heizanteil als Vorauszahlung behandelt, über die Sie nach Verbrauch abrechnen müssen (BGH VIII ZR 212/05). Rechnen Sie trotzdem nicht nach Verbrauch ab, darf der Mieter seinen Anteil um 15 % kürzen (§ 12 Abs. 1 HeizkostenV).",
  "heating.remote-reading": "Spätestens seit dem 01.01.2027 müssen alle Zähler und Heizkostenverteiler für Heizung und Warmwasser fernablesbar sein (§ 5 Abs. 3 HeizkostenV); Geräte, die nach dem 01.12.2021 eingebaut wurden, müssen es in der Regel schon seit ihrem Einbau sein (§ 5 Abs. 2). Bei fernablesbaren Geräten stehen den Mietern schon seit 2022 monatliche Verbrauchsinformationen zu (§ 6a HeizkostenV). Fehlt das eine oder das andere, darf jeder Mieter seinen Anteil an den Heizkosten um 3 % kürzen (§ 12 Abs. 1 HeizkostenV). Mietfuchs weiß nicht, welche Geräte bei Ihnen eingebaut sind. Prüfen Sie das bitte mit Ihrem Messdienst. Ausgenommen sind Einzelfälle, in denen die Nachrüstung technisch nicht möglich ist, unangemessen aufwendig wäre oder sonst eine unbillige Härte bedeutete (§ 5 Abs. 3 Satz 2), sowie die Fälle des § 11 HeizkostenV. Das gilt nicht für eine Gastherme in der Wohnung mit eigenem Gasvertrag des Mieters. Im Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, gilt das nur, wenn Sie nichts anderes vereinbart haben (§ 2 HeizkostenV).",
  "basis.vacancy-persons": "Bei „Müll“ (nach Personen) stand w2 (365 Tage) leer. An den Kosten leerstehender Wohnungen ist der Vermieter zu beteiligen; sie gehen nicht still an die übrigen Mieter (Grundsatz nach BGH, Urteil vom 31.05.2006, VIII ZR 159/05, dort zum Flächenschlüssel). Wie das beim Personenschlüssel geschieht, regelt kein Gesetz, und es ist nicht abschließend geklärt: Nach BGH, Beschluss vom 08.01.2013, VIII ZR 180/12, kommt es auf den Einzelfall an, und es kann in Betracht kommen, für die Zeit des Leerstands eine fiktive Person anzusetzen. Mietfuchs setzt jeden Tag ohne Mietverhältnis mit 1 Person an; das ist eine Auslegung von Mietfuchs. Der Anteil steht in Ihrem Vermieteranteil als Leerstand. Bei Kosten, die von der Personenzahl abhängen (etwa Wasser nach Personen), kann eine andere Aufteilung angemessener sein, zum Beispiel in Grund- und Verbrauchskosten.",
  "title tv-signal.partial-year": "Kabelfernsehen nur bis 30.06.2024 umlagefähig",
  "title heating.consumption-share": "Verbrauchsanteil der Heizkosten außerhalb 50 bis 70 %",
  "rule tv-signal": "|2024-06-30|Die Gebühren für das TV-Signal eines Kabelanschlusses und die Grundgebühren eines Breitbandanschlusses durften bis zum 30.06.2024 als Betriebskosten umgelegt werden, und zwar nur bei Anlagen, die vor dem 01.12.2021 errichtet wurden. Seitdem nicht mehr. Bei Anlagen, die vor dem 01.12.2021 errichtet wurden, bleiben umlagefähig: bei einer Gemeinschaftsantenne des Hauses der Betriebsstrom sowie Prüfung und Einstellung durch eine Fachkraft, bei einer Breitband-Verteilanlage nur der Betriebsstrom. Bei später errichteten Anlagen ist davon nichts umlagefähig, ausgenommen eine reine Glasfaser-Verteilanlage (Betriebsstrom und Bereitstellungsentgelt).",
  "rule heating-flat-rate": "||Heizung und Warmwasser müssen nach Verbrauch abgerechnet werden; die Heizkostenverordnung geht einer Pauschale oder Warmmiete vor. Die Vereinbarung wird dann nicht angewendet: Der Heizanteil gilt als Vorauszahlung, über die nach Verbrauch abzurechnen ist. Nur im Gebäude mit höchstens zwei Wohnungen, von denen der Vermieter eine selbst bewohnt, und in den Fällen des § 11 darf etwas anderes vereinbart werden. Wird nicht nach Verbrauch abgerechnet, darf der Mieter seinen Anteil um 15 % kürzen.",
  "rule heating-consumption": "||Von den Kosten der zentralen Heizungs- und Warmwasseranlage sind mindestens 50 und höchstens 70 % nach dem erfassten Verbrauch zu verteilen, der Rest nach Wohn- oder Nutzfläche (bei der Heizung auch nach umbautem Raum). Wird nicht verbrauchsabhängig abgerechnet, darf der Mieter seinen Anteil um 15 % kürzen. Im Gebäude mit höchstens zwei Wohnungen, von denen der Vermieter eine selbst bewohnt, darf anderes vereinbart werden; ohne eine solche Vereinbarung gilt die Verordnung auch dort.",
  "rule heating-remote-reading": "2027-01-01||Zähler und Heizkostenverteiler für Heizung und Warmwasser müssen fernablesbar sein: die nach dem 01.12.2021 eingebauten sofort, alle übrigen ab dem 01.01.2027 (Nachrüstfrist bis 31.12.2026). Sind fernablesbare Geräte eingebaut, stehen den Mietern monatliche Verbrauchsinformationen zu. Fehlt das eine oder das andere, darf der Mieter seinen Anteil an den Heizkosten um 3 % kürzen. Ausgenommen sind Fälle, in denen die Nachrüstung technisch nicht möglich ist, einen unangemessenen Aufwand bedeutet oder in sonstiger Weise eine unbillige Härte wäre.",
  "glossary heatingCostOrdinance.short": "Heizkosten müssen zu 50 bis 70 Prozent nach Verbrauch verteilt werden, der Rest nach Fläche oder umbautem Raum; beim Warmwasser der Rest nur nach Fläche. Die Verordnung geht einer anderen Vereinbarung im Mietvertrag vor.",
  "glossary heatingCostOrdinance.example": "3.000 € Heizkosten, 70 % nach Verbrauch: 2.100 € nach den Messwerten, 900 € nach Wohnfläche. Wird nicht nach Verbrauch abgerechnet, etwa nur nach Fläche, darf der Mieter seinen Anteil um 15 % kürzen. Unabhängig davon darf er um 3 % kürzen, wenn Zähler nicht fernablesbar sind, obwohl sie es sein müssten (neue Geräte seit Dezember 2021, alle übrigen ab 2027), oder wenn die vorgeschriebenen Verbrauchsinformationen fehlen.",
  "guide multiFamily.caveats[2]": "Bei einer Zentralheizung sind mindestens 50 und höchstens 70 Prozent der Heiz- und Warmwasserkosten nach Verbrauch zu verteilen. Wird nicht nach Verbrauch abgerechnet, darf der Mieter seinen Anteil um 15 Prozent kürzen.",
  "guide flatRate.caveats[2]": "Für Heizung und Warmwasser geht die Heizkostenverordnung einer Pauschale oder Warmmiete vor, außer im Gebäude mit nicht mehr als zwei Wohnungen, von denen Sie eine selbst bewohnen. Wird entgegen der Verordnung nicht nach Verbrauch abgerechnet, darf der Mieter seinen Anteil um 15 Prozent kürzen.",
  "guide meteringService.caveats[0]": "Bei einer Zentralheizung sind mindestens 50 und höchstens 70 Prozent der Kosten nach Verbrauch zu verteilen; das erledigt der Messdienst. Wird nicht nach Verbrauch abgerechnet, darf der Mieter um 15 Prozent kürzen."
}

test('Wortlaut: jede Stelle, deren Zahl oder Datum ins Register zieht, steht Zeichen für Zeichen wie vorher', () => {
  const now = actual()
  assert.deepEqual(Object.keys(now).sort(), Object.keys(EXPECTED).sort())
  for (const [key, text] of Object.entries(EXPECTED)) assert.equal(now[key], text, key)
})
```

- [ ] **Step 2: Test ausführen, er muss sofort grün sein**

Run: `npm --prefix server test -- test/law-wording.test.ts`
Expected: `ℹ pass 1`, `ℹ fail 0`. Ist er rot, wurde der Wortlaut nicht auf `origin/feat/heizung` abgedruckt: nicht die Erwartung anpassen, sondern den Stand prüfen.

- [ ] **Step 3: Commit**

```bash
git add server/test/law-wording.test.ts
git commit -m "Test: Wortlaut der Rechtstexte vor dem Umzug ins Rechtsregister festhalten" -m "Refs #97" -m "Refs #110"
```

---

### Task 2: Kern des Registers

**Files:**
- Create: `shared/law/register.ts`
- Modify: `shared/types.ts` (Typen `LawValue`, `AppliedValue`, Feld `LegalBasis.values`)
- Test: `server/test/law.test.ts` (erster Teil)

**Interfaces:**
- Consumes: nichts aus früheren Aufgaben.
- Produces (von allen späteren Aufgaben benutzt):
  - `type LawValue = number | string | boolean | null | readonly LawValue[] | { readonly [key: string]: LawValue }` (shared/types.ts)
  - `type AppliedValue = { id; title; norm; cite; value: LawValue; text; validFrom?; validTo? }` (shared/types.ts)
  - `type LegalBasis = { asOf: string; rules: AppliedRule[]; values?: AppliedValue[] }`
  - `type LawParam<T extends LawValue, M extends Timing>` mit `id`, `title`, `norm`, `timing`, `versions`, `describe(value: T): string`, `overridable?`
  - `type Version<T>`, `Source`, `SourceRank`, `SourceCheck`, `Timing`, `Period = { from: string; to: string }`, `Coverage`
  - `law(param: LawParam<T,'periodStart'>, { period }, log): T`, `law(param: LawParam<T,'eventDate'>, { date }, log): T`, `law(param: LawParam<T,'overlap'>, { period }, log): OverlapAnswer<T>` mit `OverlapAnswer<T> = { coverage, value: T, validFrom?, validTo? }`
  - `valueAt(param, date): T`, `versionAt(param, date): Version<T>`, `onlyVersion(param): Version<T>`
  - `createLawLog(): LawLog` mit `LawLog = { readonly values: AppliedValue[] }`
  - `germanDate(iso)`, `dayAfter(iso)`, `dayBefore(iso)`, `LAW_AS_OF = '2026-10-05'`

Zwei bewusste Abweichungen vom Typ in 4.2, beide im Kommentar begründet: Die Abfrage nimmt das **Parameterobjekt** statt der Kennung (so leitet der Übersetzer Wert- und Kontexttyp ab), und ein noch nicht veröffentlichter Wert steckt als `null` im `T` des Parameters statt in jeder `Version` (so müssen nur die Aufrufer überschreibbarer Parameter `null` behandeln). `describe` ist neu: Der Text des Werts friert mit ein.

- [ ] **Step 1: Failing test schreiben**

Datei `server/test/law.test.ts`, erster Teil, vollständig:

```ts
// Das Rechtsregister (Heizung PR 1, Entwurf 4.2 und 4.7): Abfrage nach Zeitregel, Protokoll der
// benutzten Werte, Vollständigkeit der Fassungen und je Parameter die Stichtage.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLawLog, dayAfter, dayBefore, germanDate, law, onlyVersion, valueAt, versionAt, type LawParam } from '../../shared/law/register.ts'

const year = (y: number) => ({ period: { from: `${y}-01-01`, to: `${y}-12-31` } })

// Zwei erfundene Parameter für die Abfrage selbst, damit ihre Regeln nicht an einem echten Wert
// hängen, der sich bei einer Durchsicht ändern darf.
const source = { rank: 'law', cite: '§ 1 Beispielgesetz', url: 'https://example.org/1', retrieved: '2026-10-05', checked: 'checked' } as const
const rate: LawParam<number, 'periodStart'> = {
  id: 'test.rate', title: 'Satz', norm: '§ 1', timing: 'periodStart',
  versions: [
    { validTo: '2022-12-31', value: 10, source, enacted: 'a' },
    { validFrom: '2023-01-01', value: 12, source, enacted: 'b' },
  ],
  describe: (v) => `${v} %`,
}
const event: LawParam<number, 'eventDate'> = {
  id: 'test.event', title: 'Satz am Tag', norm: '§ 3', timing: 'eventDate',
  versions: [
    { validTo: '2020-06-30', value: 19, source, enacted: 'a' },
    { validFrom: '2020-07-01', validTo: '2020-12-31', value: 16, source, enacted: 'b' },
    { validFrom: '2021-01-01', value: 19, source, enacted: 'c' },
  ],
  describe: (v) => `${v} %`,
}
const window: LawParam<{ readonly note: string }, 'overlap'> = {
  id: 'test.window', title: 'Fenster', norm: '§ 2', timing: 'overlap',
  versions: [{ validFrom: '2024-03-01', validTo: '2024-06-30', value: { note: 'x' }, source, enacted: 'a' }],
  describe: (v) => v.note,
}

test('Register: periodStart nimmt die Fassung am Beginn des Zeitraums', () => {
  const log = createLawLog()
  assert.equal(law(rate, year(2022), log), 10)
  assert.equal(law(rate, year(2023), log), 12)
  // Ein Zeitraum über die Grenze: es gilt der Beginn.
  assert.equal(law(rate, { period: { from: '2022-07-01', to: '2023-06-30' } }, log), 10)
})

test('Register: eventDate nimmt die Fassung am Tag des Ereignisses', () => {
  assert.equal(law(event, { date: '2020-06-30' }, createLawLog()), 19)
  assert.equal(law(event, { date: '2020-07-01' }, createLawLog()), 16)
  assert.equal(law(event, { date: '2020-12-31' }, createLawLog()), 16)
  assert.equal(law(event, { date: '2021-01-01' }, createLawLog()), 19)
})

test('Register: overlap sagt voll, teilweise oder gar nicht, und nennt auch bei „gar nicht“ die Grenzen', () => {
  const log = createLawLog()
  assert.deepEqual(law(window, { period: { from: '2024-04-01', to: '2024-05-31' } }, log),
    { coverage: 'full', value: { note: 'x' }, validFrom: '2024-03-01', validTo: '2024-06-30' })
  assert.equal(law(window, year(2024), log).coverage, 'partial')
  const after = law(window, year(2025), log)
  assert.equal(after.coverage, 'none')
  assert.equal(after.validTo, '2024-06-30')
  assert.equal(law(window, year(2023), log).coverage, 'none')
})

test('Register: das Protokoll führt jede benutzte Fassung einmal, mit Wert in Worten und Fundstelle', () => {
  const log = createLawLog()
  law(rate, year(2023), log)
  law(rate, year(2024), log)
  assert.deepEqual(log.values, [{ id: 'test.rate', title: 'Satz', norm: '§ 1', cite: '§ 1 Beispielgesetz', value: 12, text: '12 %', validFrom: '2023-01-01' }])
  // Auch ein „gar nicht“ hat nach einer Fassung entschieden und steht deshalb im Protokoll.
  law(window, year(2025), log)
  law(window, year(2024), log)
  assert.deepEqual(log.values.map((v) => `${v.id} ${v.validFrom ?? ''}`), ['test.rate 2023-01-01', 'test.window 2024-03-01'])
})

test('Register: zwei Protokolle sind getrennt, es gibt keinen gemeinsamen Zustand', () => {
  const a = createLawLog()
  const b = createLawLog()
  law(rate, year(2023), a)
  assert.equal(a.values.length, 1)
  assert.equal(b.values.length, 0)
})

test('Register: ohne Fassung am Tag ist es ein Programmfehler, keine stille Antwort', () => {
  assert.throws(() => versionAt(window, '2025-01-01'), /Kein Rechtswert „test\.window“ am 2025-01-01/)
  assert.throws(() => valueAt(window, '2024-02-29'), /Kein Rechtswert/)
})

test('Register: Datumshelfer', () => {
  assert.equal(germanDate('2024-07-01'), '01.07.2024')
  assert.equal(dayAfter('2024-06-30'), '2024-07-01')
  assert.equal(dayAfter('2024-02-28'), '2024-02-29')
  assert.equal(dayBefore('2027-01-01'), '2026-12-31')
})

test('Register: onlyVersion verlangt genau eine Fassung', () => {
  assert.equal(onlyVersion(window).validTo, '2024-06-30')
  assert.throws(() => onlyVersion(rate), /nicht genau eine Fassung/)
})
```

- [ ] **Step 2: Test ausführen, er muss scheitern**

Run: `npm --prefix server test -- test/law.test.ts`
Expected: FAIL mit `ERR_MODULE_NOT_FOUND` für `shared/law/register.ts`.

- [ ] **Step 3: Typen in `shared/types.ts` ergänzen**

Ersetze in `shared/types.ts` den Block

```ts
// Datum des Regelverzeichnisses und die Regeln, die im Abrechnungsjahr gelten. Wird mit der
// Abrechnung eingefroren, damit eine spätere Rechtsänderung eine versandte Abrechnung nicht
// rückwirkend anders erklärt.
export type LegalBasis = { asOf: string; rules: AppliedRule[] }
```

durch

```ts
// Ein Wert aus dem Rechtsregister (shared/law/), wie ihn JSON speichern kann.
export type LawValue = number | string | boolean | null | readonly LawValue[] | { readonly [key: string]: LawValue }
// Ein Rechtswert, mit dem eine Abrechnung gerechnet hat (Heizung PR 1, Entwurf 4.4). `text` ist
// der Wert in Worten („15 %“), so wie er beim Rechnen dastand; er friert mit ein, damit eine
// spätere Fassung des Registers eine versandte Abrechnung nicht anders beschreibt.
export type AppliedValue = {
  id: string
  title: string
  norm: string
  cite: string
  value: LawValue
  text: string
  validFrom?: string
  validTo?: string
}
// Datum des Rechtsregisters, die Regeln, die im Abrechnungsjahr gelten, und die Rechtswerte, mit
// denen gerechnet wurde. Wird mit der Abrechnung eingefroren, damit eine spätere Rechtsänderung
// eine versandte Abrechnung nicht rückwirkend anders erklärt. `values` ist optional, weil eine vor
// 0.11.0 abgeschlossene Abrechnung es nicht kennt.
export type LegalBasis = { asOf: string; rules: AppliedRule[]; values?: AppliedValue[] }
```

- [ ] **Step 4: `shared/law/register.ts` anlegen**

```ts
// Das Rechtsregister (Heizung PR 1, Entwurf 2026-10-05 Abschnitt 4): jeder Rechtswert, mit dem
// Mietfuchs rechnet oder den es nennt, mit Gültigkeit, Fundstelle und Zeitregel. Es liegt in
// shared/, wie shared/heating.ts: Berechnung, Lexikon und Oberfläche lesen dieselbe Zahl, und Text
// und Rechnung können nicht auseinanderlaufen. Ein Wächter (server/test/law-literals.test.ts)
// verbietet die Zahlen außerhalb dieses Ordners.
//
// Diese Datei hält nur die Typen und die Abfrage. Die Werte stehen je Gesetz daneben
// (heizkostenv.ts, bgb-betrkv.ts, ustg.ts, practice.ts) und gesammelt in params.ts.
//
// **Eine Fassung wird nie geändert, nur eine neue angelegt** (4.4). Was ausgeliefert ist, hält
// server/test/law-history.test.ts als Zahl fest.
import type { AppliedValue, LawValue } from '../types.ts'

export type SourceRank = 'law' | 'court' | 'technical' | 'practice' | 'software' | 'interpretation'
// `checked`: am Tag `retrieved` an der Quelle gelesen; `adopted`: so übernommen aus einem Entwurf
// oder Bestand, der es mit Datum geprüft hat; `unchecked`: nicht an einer Primärquelle bestätigt.
// Ein Release bricht ab, solange ein Wert `unchecked` ist (law-release.test.ts).
export type SourceCheck = 'checked' | 'adopted' | 'unchecked'
export type Source = { rank: SourceRank; cite: string; url: string; retrieved: string; checked: SourceCheck }

// Nach welchem Zeitpunkt sich die Fassung richtet (Entwurf 3.13). Jeder Parameter hat genau eine
// Zeitregel (N6 der dritten Fassung); braucht ein Fall zwei, sind es zwei Parameter. `incurred`
// und `deliveryYear` kommen mit PR 18 und PR 17: Die Überladungen von `law()` nehmen sie bis
// dahin nicht an.
export type Timing = 'periodStart' | 'incurred' | 'overlap' | 'eventDate' | 'deliveryYear'

// Eine Fassung. Die Grenzen sind ISO-Daten und gelten einschließlich; fehlt eine, gilt die Fassung
// in diese Richtung unbegrenzt. `enacted` nennt die Fassung des Gesetzes, an der der Wert gelesen
// wurde, oder bei einer Auslegung, wo sie festgelegt ist.
export type Version<T extends LawValue> = { validFrom?: string; validTo?: string; value: T; source: Source; enacted: string }

// Ein Parameter. Abweichend vom Typ in 4.2 steckt ein noch nicht veröffentlichter Wert (`null`)
// im `T` des Parameters selbst: So zwingt der Übersetzer genau die Aufrufer überschreibbarer
// Parameter, mit `null` umzugehen, und keinen anderen. `describe` macht aus dem Wert den Text,
// der mit der Abrechnung einfriert („15 %“). Als Methode geschrieben, damit sich jeder Parameter
// in die gemeinsame Liste `LAW_PARAMS` (params.ts) einreihen lässt.
export type LawParam<T extends LawValue, M extends Timing = Timing> = {
  id: string
  title: string
  norm: string
  timing: M
  // lückenlos, nicht überlappend, aufsteigend (law.test.ts prüft das)
  versions: readonly Version<T>[]
  describe(value: T): string
  // nur Werte, die eine Behörde später veröffentlicht (4.5)
  overridable?: { reason: string }
}

export type Period = { from: string; to: string }
export type Coverage = 'full' | 'partial' | 'none'

// Der Rechtsstand: das jüngste `retrieved` im Register (law.test.ts prüft das). Wer einen Wert
// prüft oder eine Fassung anlegt, setzt ihn auf den Tag der Durchsicht (#110).
export const LAW_AS_OF = '2026-10-05'

// ---------- Datumshelfer, Zeichen für Zeichen wie compareText in calc.ts ----------

// „01.07.2024“ statt „2024-07-01“, aus der Zeichenkette und nicht über `Date`, damit keine
// Zeitzone einen Tag verschiebt.
export function germanDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10)
}
export const dayAfter = (iso: string): string => shiftDay(iso, 1)
export const dayBefore = (iso: string): string => shiftDay(iso, -1)

// ---------- Abfrage ----------

const contains = (v: { validFrom?: string; validTo?: string }, date: string): boolean =>
  (v.validFrom === undefined || v.validFrom <= date) && (v.validTo === undefined || v.validTo >= date)

// Die Fassung an einem Tag. Gibt es keine, ist das ein Programmfehler wie ein unbekannter
// Regelcode: Eine stille Antwort ließe die Regel unbemerkt nie greifen.
export function versionAt<T extends LawValue>(param: LawParam<T>, date: string): Version<T> {
  const v = param.versions.find((x) => contains(x, date))
  if (!v) throw new Error(`Kein Rechtswert „${param.id}“ am ${date}`)
  return v
}

// Die einzige Fassung eines Parameters, für Texte, die eine Grenze nennen („nur bis 30.06.2024“)
// und nicht zu einem Zeitraum gehören, etwa den Titel eines Hinweises. Hat der Parameter mehr als
// eine Fassung, muss die Stelle entscheiden, welche sie meint; dann bricht sie hier ab.
export function onlyVersion<T extends LawValue>(param: LawParam<T>): Version<T> {
  const [v, ...rest] = param.versions
  if (!v || rest.length > 0) throw new Error(`Rechtswert „${param.id}“ hat nicht genau eine Fassung`)
  return v
}

// Der Wert an einem Tag, ohne Protokoll: für Texte außerhalb einer Abrechnung (Lexikon,
// Anleitungen, Cockpit), die das geltende Recht erklären. In einer Berechnung immer `law()`.
export function valueAt<T extends LawValue>(param: LawParam<T>, date: string): T {
  return versionAt(param, date).value
}

// Das Protokoll einer Berechnung: was sie abgefragt hat. Es wird hineingereicht und ist kein
// globaler Zustand, denn zwei Abrechnungen rechnen nebeneinander.
export type LawLog = { readonly values: AppliedValue[] }
export function createLawLog(): LawLog {
  return { values: [] }
}

function record<T extends LawValue>(log: LawLog, param: LawParam<T>, version: Version<T>): void {
  // Dieselbe Fassung zweimal abgefragt ist ein Eintrag, nicht zwei.
  if (log.values.some((a) => a.id === param.id && a.validFrom === version.validFrom)) return
  log.values.push({
    id: param.id,
    title: param.title,
    norm: param.norm,
    cite: version.source.cite,
    value: version.value,
    text: param.describe(version.value),
    ...(version.validFrom !== undefined ? { validFrom: version.validFrom } : {}),
    ...(version.validTo !== undefined ? { validTo: version.validTo } : {}),
  })
}

export type OverlapAnswer<T extends LawValue> = { coverage: Coverage; value: T; validFrom?: string; validTo?: string }

// Die Frage, die eine Stelle stellen darf, hängt an der Zeitregel des Parameters; der Übersetzer
// prüft so, dass niemand einen Wert nach dem Beginn des Zeitraums fragt, der nach einem Ereignis
// gilt.
export function law<T extends LawValue>(param: LawParam<T, 'periodStart'>, ctx: { period: Period }, log: LawLog): T
export function law<T extends LawValue>(param: LawParam<T, 'eventDate'>, ctx: { date: string }, log: LawLog): T
export function law<T extends LawValue>(param: LawParam<T, 'overlap'>, ctx: { period: Period }, log: LawLog): OverlapAnswer<T>
export function law<T extends LawValue>(
  param: LawParam<T, 'periodStart' | 'eventDate' | 'overlap'>,
  ctx: { period: Period } | { date: string },
  log: LawLog,
): T | OverlapAnswer<T> {
  if (param.timing === 'overlap' && 'period' in ctx) return overlap(param, ctx.period, log)
  const date = 'period' in ctx ? ctx.period.from : ctx.date
  const version = versionAt(param, date)
  record(log, param, version)
  return version.value
}

// `overlap`: gilt, sobald der Zeitraum die Fassung berührt (Kabelregel). Berührt er keine, sagt
// die Antwort `none` und nennt trotzdem die nächstgelegene Fassung, denn der Hinweis „seit dem
// 01.07.2024 nicht mehr“ braucht ihr Ende. Protokolliert wird die Fassung, nach der entschieden
// wurde, auch bei `none`: Sie hat den Hinweis bestimmt.
function overlap<T extends LawValue>(param: LawParam<T>, period: Period, log: LawLog): OverlapAnswer<T> {
  const touching = param.versions.filter((v) => (v.validFrom === undefined || v.validFrom <= period.to) && (v.validTo === undefined || v.validTo >= period.from))
  const answer = (v: Version<T>, coverage: Coverage): OverlapAnswer<T> => ({
    coverage,
    value: v.value,
    ...(v.validFrom !== undefined ? { validFrom: v.validFrom } : {}),
    ...(v.validTo !== undefined ? { validTo: v.validTo } : {}),
  })
  const first = touching[0]
  if (first) {
    for (const v of touching) record(log, param, v)
    const full = touching.length === 1 && contains(first, period.from) && contains(first, period.to)
    return answer(touching.find((v) => contains(v, period.from)) ?? first, full ? 'full' : 'partial')
  }
  const before = param.versions.filter((v) => v.validTo !== undefined && v.validTo < period.from).at(-1)
  const after = param.versions.find((v) => v.validFrom !== undefined && v.validFrom > period.to)
  const nearest = before ?? after
  if (!nearest) throw new Error(`Rechtswert „${param.id}“ ohne Fassung`)
  record(log, param, nearest)
  return answer(nearest, 'none')
}
```

- [ ] **Step 5: Test und Typprüfung**

Run: `npm --prefix server test -- test/law.test.ts && npm run typecheck`
Expected: `ℹ pass 8`, `ℹ fail 0`; Typprüfung ohne Ausgabe von Fehlern.

- [ ] **Step 6: Commit**

```bash
git add shared/law/register.ts shared/types.ts server/test/law.test.ts
git commit -m "Rechtsregister: Typen, Abfrage nach Zeitregel und Protokoll der benutzten Werte" -m "Refs #97" -m "Refs #110"
```

---

### Task 3: Die sieben Parameter und das Regelverzeichnis im Register

**Files:**
- Create: `shared/law/heizkostenv.ts`, `shared/law/bgb-betrkv.ts`, `shared/law/ustg.ts`, `shared/law/practice.ts`, `shared/law/params.ts`
- Move + Modify: `server/src/rules.ts` → `shared/law/rules.ts`
- Modify: Importe in `server/src/calc.ts`, `server/test/rules.test.ts`, `server/test/rechtstexte.test.ts`, `server/test/rechtsdurchsicht-2026.test.ts`, `server/test/calc-notices.test.ts`, `server/test/api.test.ts`, `server/test/law-wording.test.ts`
- Modify: `.github/workflows/release.yml` (Release-Sperre)
- Test: `server/test/law.test.ts` (zweiter Teil), `server/test/law-history.test.ts`, `server/test/law-release.test.ts`

**Interfaces:**
- Consumes: alles aus Task 2.
- Produces:
  - `betrkvTvSignal: LawParam<{ readonly newSystemsFrom: string }, 'overlap'>` (eine Fassung, `validTo: '2024-06-30'`)
  - `hkvConsumptionShare: LawParam<{ readonly min: number; readonly max: number }, 'periodStart'>`
  - `hkvCutNotByConsumption: LawParam<number, 'periodStart'>` (15)
  - `hkvCutRemoteReading: LawParam<number, 'periodStart'>` (3)
  - `hkvRemoteReadingRetrofit: LawParam<{ readonly installedUpTo: string }, 'overlap'>` (eine Fassung, `validFrom: '2027-01-01'`)
  - `practiceVacancyPersons: LawParam<number, 'periodStart'>` (1)
  - `ustgStandardRate: LawParam<number, 'eventDate'>` (19 / 16 / 19)
  - `LAW_PARAMS: readonly LawParam<LawValue, Timing>[]`
  - `shared/law/rules.ts` mit unverändertem Export (`Rule`, `RULES_AS_OF`, `RULES`, `rulesFor`, `ruleCoverage`)

Zur Fernablesbarkeit (dritte Fassung, N6): `hkv.remote-reading.retrofit` **ersetzt den Zeitpunkt** der Bestandsregel `heating-remote-reading`. Die Regel bleibt als Eintrag im Verzeichnis, weil `legalBasis.rules` und der Hinweis `heating.remote-reading` (`rule: 'heating-remote-reading'`) sie nennen und `rechtsdurchsicht-2026.test.ts` das prüft; ihr `validFrom` kommt aber aus dem Parameter, und in Task 4 entscheidet die Berechnung nicht mehr über `ruleCoverage`, sondern über den Parameter. So bleiben Text und Zahl gleich.

- [ ] **Step 1: Failing tests schreiben**

(a) In `server/test/law.test.ts` den Importblock (die drei `import`-Zeilen) ersetzen durch:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLawLog, dayAfter, dayBefore, germanDate, law, LAW_AS_OF, onlyVersion, valueAt, versionAt, type LawParam } from '../../shared/law/register.ts'
import { LAW_PARAMS } from '../../shared/law/params.ts'
import { RULES_AS_OF } from '../../shared/law/rules.ts'
import { betrkvTvSignal } from '../../shared/law/bgb-betrkv.ts'
import { hkvConsumptionShare, hkvCutNotByConsumption, hkvCutRemoteReading, hkvRemoteReadingRetrofit } from '../../shared/law/heizkostenv.ts'
import { practiceVacancyPersons } from '../../shared/law/practice.ts'
import { ustgStandardRate } from '../../shared/law/ustg.ts'
```

und ans Ende anhängen:

```ts
// ---------- Vollständigkeit (4.7) ----------

const ISO = /^\d{4}-\d{2}-\d{2}$/

test('Register: jede Fassung hat Fundstelle, Adresse, Abrufdatum und Prüfstand', () => {
  for (const p of LAW_PARAMS) {
    assert.ok(p.id && p.title && p.norm, p.id)
    assert.ok(p.versions.length > 0, `${p.id} ohne Fassung`)
    for (const v of p.versions) {
      assert.ok(v.source.cite.trim(), `${p.id}: cite`)
      assert.match(v.source.url, /^https:\/\//, `${p.id}: url`)
      assert.match(v.source.retrieved, ISO, `${p.id}: retrieved`)
      assert.ok(v.enacted.trim(), `${p.id}: enacted`)
      assert.ok(typeof p.describe(v.value) === 'string' && p.describe(v.value).trim(), `${p.id}: describe`)
    }
  }
})

test('Register: die Fassungen eines Parameters sind aufsteigend, lückenlos und überlappen nicht', () => {
  for (const p of LAW_PARAMS) {
    for (const v of p.versions) {
      if (v.validFrom !== undefined) assert.match(v.validFrom, ISO, p.id)
      if (v.validTo !== undefined) assert.match(v.validTo, ISO, p.id)
      if (v.validFrom !== undefined && v.validTo !== undefined) assert.ok(v.validFrom <= v.validTo, `${p.id}: ${v.validFrom} nach ${v.validTo}`)
    }
    for (let i = 1; i < p.versions.length; i++) {
      const before = p.versions[i - 1]
      const next = p.versions[i]
      if (!before?.validTo || !next?.validFrom) assert.fail(`${p.id}: Fassung ${i} hat keine Grenze zur vorigen`)
      assert.equal(next.validFrom, dayAfter(before.validTo), `${p.id}: Lücke oder Überschneidung vor Fassung ${i}`)
    }
  }
})

test('Register: null nur bei einem überschreibbaren Parameter, jede Kennung einmal', () => {
  for (const p of LAW_PARAMS) {
    if (!p.overridable) for (const v of p.versions) assert.notEqual(v.value, null, `${p.id}: null ohne overridable`)
  }
  assert.equal(new Set(LAW_PARAMS.map((p) => p.id)).size, LAW_PARAMS.length)
})

test('Register: LAW_AS_OF ist das jüngste Abrufdatum und nicht älter als das Regelverzeichnis', () => {
  const newest = LAW_PARAMS.flatMap((p) => p.versions.map((v) => v.source.retrieved)).sort().at(-1)
  assert.equal(LAW_AS_OF, newest)
  assert.ok(LAW_AS_OF >= RULES_AS_OF, `${LAW_AS_OF} vor ${RULES_AS_OF}`)
})

test('Register: jede Konstante vom Typ LawParam in shared/law/ steht in LAW_PARAMS', () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../shared/law')
  const declared = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))
    .flatMap((f) => [...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/^export const (\w+): LawParam</gm)].map((m) => m[1]))
  assert.ok(declared.length >= 7, `nur ${declared.length} Parameter gefunden`)
  const listed = new Set<unknown>(LAW_PARAMS)
  const modules = { betrkvTvSignal, hkvConsumptionShare, hkvCutNotByConsumption, hkvCutRemoteReading, hkvRemoteReadingRetrofit, practiceVacancyPersons, ustgStandardRate }
  for (const name of declared) {
    assert.ok(name && Object.hasOwn(modules, name), `${name} fehlt in diesem Test`)
    assert.ok(listed.has(Reflect.get(modules, name)), `${name} fehlt in LAW_PARAMS`)
  }
})

// ---------- Stichtage je Parameter (4.7) ----------

test('Stichtag betrkv.tv-signal: 2023 voll, 2024 teilweise, ab 2025 nicht mehr; Anlagen ab 01.12.2021 nie', () => {
  const log = createLawLog()
  assert.equal(law(betrkvTvSignal, year(2023), log).coverage, 'full')
  assert.equal(law(betrkvTvSignal, year(2024), log).coverage, 'partial')
  assert.equal(law(betrkvTvSignal, { period: { from: '2024-01-01', to: '2024-06-30' } }, log).coverage, 'full')
  assert.equal(law(betrkvTvSignal, { period: { from: '2024-07-01', to: '2024-12-31' } }, log).coverage, 'none')
  const later = law(betrkvTvSignal, year(2025), log)
  assert.equal(later.coverage, 'none')
  assert.equal(later.validTo, '2024-06-30')
  assert.equal(later.value.newSystemsFrom, '2021-12-01')
})

test('Stichtag hkv.remote-reading.retrofit: Zeitraum 2026-01 nicht, 2027-01 ganz, Mitte 2026 bis Mitte 2027 teilweise', () => {
  const log = createLawLog()
  assert.equal(law(hkvRemoteReadingRetrofit, year(2026), log).coverage, 'none')
  assert.equal(law(hkvRemoteReadingRetrofit, year(2027), log).coverage, 'full')
  assert.equal(law(hkvRemoteReadingRetrofit, { period: { from: '2026-07-01', to: '2027-06-30' } }, log).coverage, 'partial')
  assert.equal(law(hkvRemoteReadingRetrofit, year(2027), log).value.installedUpTo, '2021-12-01')
})

test('Stichtag: die Werte ohne Zeitgrenze gelten 2020 wie 2030', () => {
  for (const y of [2020, 2025, 2030]) {
    const log = createLawLog()
    assert.deepEqual(law(hkvConsumptionShare, year(y), log), { min: 50, max: 70 })
    assert.equal(law(hkvCutNotByConsumption, year(y), log), 15)
    assert.equal(law(hkvCutRemoteReading, year(y), log), 3)
    assert.equal(law(practiceVacancyPersons, year(y), log), 1)
  }
})

test('Stichtag ustg.standard-rate: 16 % nur vom 01.07. bis 31.12.2020', () => {
  assert.equal(law(ustgStandardRate, { date: '2020-06-30' }, createLawLog()), 19)
  assert.equal(law(ustgStandardRate, { date: '2020-12-31' }, createLawLog()), 16)
  assert.equal(valueAt(ustgStandardRate, '2019-12-31'), 19)
  assert.equal(valueAt(ustgStandardRate, '2020-07-01'), 16)
  assert.equal(valueAt(ustgStandardRate, '2021-01-01'), 19)
  assert.equal(valueAt(ustgStandardRate, '2026-10-05'), 19)
})
```

(b) Datei `server/test/law-history.test.ts`:

```ts
// Jede ausgelieferte Fassung des Rechtsregisters als Zahl (Heizung PR 1, Entwurf 4.4 und 4.7). Das
// ist die eigentliche Sicherung des Registers: Eine Fassung wird nie geändert, nur eine neue
// angelegt. Wer einen Wert berichtigt, legt eine neue Fassung an und **ergänzt** hier eine Zeile;
// eine bestehende Zeile ändert niemand. Eine abgeschlossene Abrechnung bleibt dabei, wie sie ist,
// und `deviation` zeigt die Auswirkung (CHANGELOG-Satz nach 4.4).
//
// Format je Zeile: Kennung, Grenzen (leer = offen) und der Wert als JSON.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LAW_PARAMS } from '../../shared/law/params.ts'

const SHIPPED: readonly string[] = [
  // 0.11.0 (Heizung PR 1)
  'betrkv.tv-signal||2024-06-30|{"newSystemsFrom":"2021-12-01"}',
  'hkv.consumption-share|||{"min":50,"max":70}',
  'hkv.cut.not-by-consumption|||15',
  'hkv.cut.remote-reading|||3',
  'hkv.remote-reading.retrofit|2027-01-01||{"installedUpTo":"2021-12-01"}',
  'practice.vacancy-persons|||1',
  'ustg.standard-rate||2020-06-30|19',
  'ustg.standard-rate|2020-07-01|2020-12-31|16',
  'ustg.standard-rate|2021-01-01||19',
]

const current = (): string[] =>
  LAW_PARAMS.flatMap((p) => p.versions.map((v) => `${p.id}|${v.validFrom ?? ''}|${v.validTo ?? ''}|${JSON.stringify(v.value)}`))

test('Register: jede ausgelieferte Fassung steht unverändert im Register', () => {
  const now = new Set(current())
  for (const line of SHIPPED) assert.ok(now.has(line), `ausgelieferte Fassung geändert oder entfernt: ${line}`)
})

test('Register: jede Fassung im Register ist hier festgehalten', () => {
  const shipped = new Set(SHIPPED)
  for (const line of current()) assert.ok(shipped.has(line), `neue Fassung ohne Zeile in law-history.test.ts: ${line}`)
})
```

(c) Datei `server/test/law-release.test.ts`:

```ts
// Release-Sperre des Rechtsregisters (Heizung PR 1, Entwurf 4.7): Ein Release bricht ab, solange
// ein Wert `checked: 'unchecked'` hat. Der Test läuft nur, wenn MIETFUCHS_RELEASE=1 gesetzt ist;
// das tut release.yml beim Tag („Rechtsregister geprüft?“). Im gewöhnlichen Lauf wäre er rot,
// sobald eine PR einen ungeprüften Wert einträgt, und das soll eine PR dürfen: Geprüft sein muss
// erst das Release (G-C7).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LAW_PARAMS } from '../../shared/law/params.ts'
import type { LawParam, Timing } from '../../shared/law/register.ts'
import type { LawValue } from '../../shared/types.ts'

const uncheckedValues = (params: readonly LawParam<LawValue, Timing>[]): string[] =>
  params.flatMap((p) => p.versions.filter((v) => v.source.checked === 'unchecked').map((v) => `${p.id} (${v.source.cite}, ${v.validFrom ?? '…'} bis ${v.validTo ?? '…'})`))

test('Release: kein ungeprüfter Wert im Rechtsregister', { skip: process.env.MIETFUCHS_RELEASE !== '1' }, () => {
  const open = uncheckedValues(LAW_PARAMS)
  assert.deepEqual(open, [], `Vor dem Release an der Quelle lesen und als geprüft eintragen:\n${open.join('\n')}`)
})

test('Release-Sperre: sie findet einen ungeprüften Wert und übersieht die geprüften', () => {
  // Ohne diese Probe könnte die Sperre grün sein, weil sie gar nichts findet.
  const source = { rank: 'law', cite: '§ 1', url: 'https://example.org/1', retrieved: '2026-10-05' } as const
  const param: LawParam<number, 'periodStart'> = {
    id: 'test.offen', title: 'Offen', norm: '§ 1', timing: 'periodStart', describe: (v) => String(v),
    versions: [
      { validTo: '2022-12-31', value: 1, source: { ...source, checked: 'checked' }, enacted: 'a' },
      { validFrom: '2023-01-01', value: 2, source: { ...source, checked: 'unchecked' }, enacted: 'b' },
    ],
  }
  assert.deepEqual(uncheckedValues([param]), ['test.offen (§ 1, 2023-01-01 bis …)'])
})
```

- [ ] **Step 2: Tests ausführen, sie müssen scheitern**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/law-release.test.ts`
Expected: FAIL mit `ERR_MODULE_NOT_FOUND` für `shared/law/params.ts`.

- [ ] **Step 3: Parameter anlegen**

`shared/law/heizkostenv.ts`:

```ts
// Parameter der Heizkostenverordnung (Heizung PR 1, Entwurf 4.3). Wortlaut geprüft am 05.10.2026
// auf gesetze-im-internet.de, Fassung Art. 3 G v. 16.10.2023 (BGBl. I Nr. 280); das Gesetz vom
// 23.07.2026 ändert die Verordnung nicht (Entwurf Abschnitt 2).
import type { LawParam, Source } from './register.ts'
import { germanDate } from './register.ts'

const ENACTED = 'HeizkostenV, Fassung Art. 3 G v. 16.10.2023 (BGBl. I Nr. 280)'
const checked = (cite: string, url: string): Source => ({ rank: 'law', cite, url, retrieved: '2026-10-05', checked: 'checked' })

// Mindestens 50 und höchstens 70 % der Kosten nach erfasstem Verbrauch, für Heizung (§ 7 Abs. 1
// Satz 1) wie für Warmwasser (§ 8 Abs. 1). Gilt die Fassung am Beginn des Zeitraums.
export const hkvConsumptionShare: LawParam<{ readonly min: number; readonly max: number }, 'periodStart'> = {
  id: 'hkv.consumption-share',
  title: 'Anteil der Kosten nach Verbrauch',
  norm: '§ 7 Abs. 1 Satz 1, § 8 Abs. 1 HeizkostenV',
  timing: 'periodStart',
  versions: [{
    value: { min: 50, max: 70 },
    source: checked('§ 7 Abs. 1 Satz 1, § 8 Abs. 1 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__7.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `${v.min} bis ${v.max} %`,
}

// Kürzung um 15 %, wenn nicht verbrauchsabhängig abgerechnet wird (§ 12 Abs. 1 Satz 1).
export const hkvCutNotByConsumption: LawParam<number, 'periodStart'> = {
  id: 'hkv.cut.not-by-consumption',
  title: 'Kürzung bei nicht verbrauchsabhängiger Abrechnung',
  norm: '§ 12 Abs. 1 Satz 1 HeizkostenV',
  timing: 'periodStart',
  versions: [{
    value: 15,
    source: checked('§ 12 Abs. 1 Satz 1 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__12.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `${v} %`,
}

// Kürzung um 3 %, wenn Geräte entgegen § 5 Abs. 2 oder 3 nicht fernablesbar sind (§ 12 Abs. 1
// Satz 2). Ob ein Gerät betroffen ist, sagen die beiden Parameter zur Fernablesbarkeit; dieser
// nennt nur die Höhe (N6 der dritten Fassung: eine Zeitregel je Parameter).
export const hkvCutRemoteReading: LawParam<number, 'periodStart'> = {
  id: 'hkv.cut.remote-reading',
  title: 'Kürzung bei nicht fernablesbaren Geräten',
  norm: '§ 12 Abs. 1 Satz 2 HeizkostenV',
  timing: 'periodStart',
  versions: [{
    value: 3,
    source: checked('§ 12 Abs. 1 Satz 2 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__12.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `${v} %`,
}

// Altgeräte, also bis zum 01.12.2021 eingebaut, müssen ab dem 01.01.2027 fernablesbar sein (§ 5
// Abs. 3), ausgenommen technische Unmöglichkeit und unbillige Härte (Satz 2). `overlap`: Ein
// Zeitraum, der 2027 berührt, ist betroffen. Ersetzt den Zeitpunkt der Bestandsregel
// `heating-remote-reading` (rules.ts liest ihn von hier). Geräte, die später eingebaut wurden
// (§ 5 Abs. 2), kommen mit PR 4 als `hkv.remote-reading.new-devices`.
export const hkvRemoteReadingRetrofit: LawParam<{ readonly installedUpTo: string }, 'overlap'> = {
  id: 'hkv.remote-reading.retrofit',
  title: 'Fernablesbarkeit älterer Geräte',
  norm: '§ 5 Abs. 3 HeizkostenV',
  timing: 'overlap',
  versions: [{
    validFrom: '2027-01-01',
    value: { installedUpTo: '2021-12-01' },
    source: checked('§ 5 Abs. 3 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__5.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `Geräte mit Einbau bis ${germanDate(v.installedUpTo)} fernablesbar`,
}
```

`shared/law/bgb-betrkv.ts`:

```ts
// Parameter aus BGB und Betriebskostenverordnung (Heizung PR 1, Entwurf 4.3). Frist und Höchstdauer
// des Abrechnungszeitraums (§ 556 Abs. 3 BGB) kommen mit PR 2.
import type { LawParam } from './register.ts'
import { germanDate } from './register.ts'

// Kabelfernsehen: Die Gebühren für das TV-Signal durften bis zum 30.06.2024 umgelegt werden, und
// nur bei Anlagen, die vor dem 01.12.2021 errichtet wurden (§ 2 Satz 1 Nr. 15 Buchst. a und b,
// Satz 2 BetrKV). `overlap`: Ein Abrechnungsjahr, das die Übergangszeit nur berührt, ist das
// Übergangsjahr („teilweise“). Wortlaut geprüft am 05.10.2026; die BetrKV ist unverändert seit
// Art. 4 G v. 16.10.2023 (Durchsicht vom 02.10.2026).
export const betrkvTvSignal: LawParam<{ readonly newSystemsFrom: string }, 'overlap'> = {
  id: 'betrkv.tv-signal',
  title: 'Kabelfernsehen über die Nebenkosten',
  norm: '§ 2 Satz 1 Nr. 15 Buchst. a und b, Satz 2 BetrKV',
  timing: 'overlap',
  versions: [{
    validTo: '2024-06-30',
    value: { newSystemsFrom: '2021-12-01' },
    source: { rank: 'law', cite: '§ 2 Satz 1 Nr. 15 Buchst. a und b, Satz 2 BetrKV', url: 'https://www.gesetze-im-internet.de/betrkv/__2.html', retrieved: '2026-10-05', checked: 'checked' },
    enacted: 'BetrKV, Fassung Art. 4 G v. 16.10.2023 (BGBl. I Nr. 280)',
  }],
  describe: (v) => `umlagefähig nur bei Anlagen, die vor dem ${germanDate(v.newSystemsFrom)} errichtet wurden`,
}
```

`shared/law/ustg.ts`:

```ts
// Regelsatz der Umsatzsteuer (Heizung PR 1, Entwurf 4.3, G-C8). Gebraucht wird er nicht für eine
// Abrechnungszahl, sondern für die Plausibilität einer KI-Auswertung (`vatExplainsGap` in
// server/src/invoiceAmounts.ts): Lässt sich der Abstand zwischen Positionen und Rechnungsbetrag
// durch Umsatzsteuer erklären?
//
// **Ungeprüft** wie im Entwurf (Abschnitt 2 und 4.3: „vor PR 1 lesen“). Solange das so bleibt,
// sperrt law-release.test.ts das Release. Die erste Fassung hat keine Untergrenze; ob davor ein
// anderer Satz galt, gehört zur Prüfung, und eine gefundene Fassung kommt als eigene davor.
import type { LawParam, Source } from './register.ts'

const unchecked = (cite: string, url: string): Source => ({ rank: 'law', cite, url, retrieved: '2026-10-05', checked: 'unchecked' })

export const ustgStandardRate: LawParam<number, 'eventDate'> = {
  id: 'ustg.standard-rate',
  title: 'Regelsatz der Umsatzsteuer',
  norm: '§ 12 Abs. 1 UStG',
  timing: 'eventDate',
  versions: [
    { validTo: '2020-06-30', value: 19, source: unchecked('§ 12 Abs. 1 UStG', 'https://www.gesetze-im-internet.de/ustg_1980/__12.html'), enacted: '§ 12 Abs. 1 UStG' },
    { validFrom: '2020-07-01', validTo: '2020-12-31', value: 16, source: unchecked('§ 28 Abs. 1 UStG a. F.', 'https://www.gesetze-im-internet.de/ustg_1980/__28.html'), enacted: '§ 28 Abs. 1 UStG a. F.' },
    { validFrom: '2021-01-01', value: 19, source: unchecked('§ 12 Abs. 1 UStG', 'https://www.gesetze-im-internet.de/ustg_1980/__12.html'), enacted: '§ 12 Abs. 1 UStG' },
  ],
  describe: (v) => `${v} %`,
}
```

`shared/law/practice.ts`:

```ts
// Werte aus Praxis oder Auslegung (Heizung PR 1, Entwurf 4.3). Sie sind keine Rechtswerte;
// Ausweis und Lexikon nennen ihre Herkunft.
import type { LawParam } from './register.ts'

// **Personen je Leerstandstag beim Personenschlüssel (#177).** Den Anteil einer leerstehenden
// Wohnung trägt der Vermieter (BGH, Urteil vom 31.05.2006, VIII ZR 159/05, entschieden am
// Flächenschlüssel). Wie die leere Wohnung beim Personenschlüssel anzusetzen ist, regelt kein
// Gesetz, und höchstrichterlich ist es nicht abschließend geklärt: Nach BGH, Beschluss vom
// 08.01.2013, VIII ZR 180/12, entscheidet der Tatrichter im Einzelfall nach Billigkeit, und es
// „kann in Betracht kommen“, für den Leerstand eine fiktive Person anzusetzen, vor allem bei
// Kosten, die nicht von der Personenzahl abhängen.
// Auslegung nach BGH VIII ZR 180/12; LG Krefeld, 17.03.2010, 2 S 56/09 (eine Person statt null);
// abweichend AG Köln WuM 2002, 28 (Durchschnittsbelegung). Mietfuchs setzt jeden Tag ohne
// Mietverhältnis mit dieser Zahl an, bei allen Positionen nach Personen (`vacancyPersons` in
// computeSettlement). Bis PR 1 stand der Wert als `VACANCY_PERSONS` in calc.ts.
export const practiceVacancyPersons: LawParam<number, 'periodStart'> = {
  id: 'practice.vacancy-persons',
  title: 'Personen je Leerstandstag beim Personenschlüssel',
  norm: 'Auslegung nach BGH, Beschluss vom 08.01.2013, VIII ZR 180/12',
  timing: 'periodStart',
  versions: [{
    value: 1,
    source: {
      rank: 'interpretation',
      cite: 'BGH, Beschluss vom 08.01.2013, VIII ZR 180/12',
      url: 'https://dejure.org/dienste/vernetzung/rechtsprechung?Gericht=BGH&Datum=08.01.2013&Aktenzeichen=VIII%20ZR%20180/12',
      retrieved: '2026-10-05',
      checked: 'adopted',
    },
    enacted: 'Festlegung von Mietfuchs (#177)',
  }],
  describe: (v) => (v === 1 ? '1 Person je Leerstandstag' : `${v} Personen je Leerstandstag`),
}
```

`shared/law/params.ts`:

```ts
// Alle Parameter des Registers, für die Prüfungen in server/test/law.test.ts und den Wächter. Wer
// einen Parameter anlegt, trägt ihn hier ein; ein Test sucht in shared/law/ nach `LawParam`-
// Konstanten, die hier fehlen.
import type { LawParam, Timing } from './register.ts'
import type { LawValue } from '../types.ts'
import { betrkvTvSignal } from './bgb-betrkv.ts'
import { hkvConsumptionShare, hkvCutNotByConsumption, hkvCutRemoteReading, hkvRemoteReadingRetrofit } from './heizkostenv.ts'
import { practiceVacancyPersons } from './practice.ts'
import { ustgStandardRate } from './ustg.ts'

export const LAW_PARAMS: readonly LawParam<LawValue, Timing>[] = [
  betrkvTvSignal,
  hkvConsumptionShare,
  hkvCutNotByConsumption,
  hkvCutRemoteReading,
  hkvRemoteReadingRetrofit,
  practiceVacancyPersons,
  ustgStandardRate,
]
```

- [ ] **Step 4: Regelverzeichnis verschieben und aus den Parametern speisen**

```bash
git mv server/src/rules.ts shared/law/rules.ts
```

Danach hat `shared/law/rules.ts` diesen Inhalt (Kopf neu, die Regeln mit eingesetzten Werten, `rulesFor`, `ruleCoverage` und `ruleByCode` unverändert):

```ts
// Das Regelverzeichnis (#112), seit Heizung PR 1 Teil des Rechtsregisters (vorher
// server/src/rules.ts): Rechtsregeln, die die Berechnung anwendet, jeweils mit dem Zeitraum, in dem
// sie gelten. Eine Abrechnung rechnet nach dem Recht ihres Jahres und nicht nach dem von heute; wo
// eine Regel nur für einen Teil des Jahres gilt, sagt das `ruleCoverage`.
//
// Aufgenommen wird nur, was die Berechnung wirklich anwendet. Das Verzeichnis ist keine
// Rechtsbibliothek, sondern die Liste, gegen die eine Abrechnung geprüft wurde; deshalb steht
// sie als Rechtsstand in jeder Abrechnung und wird beim Abschließen mit eingefroren.
//
// Zahlen und Daten in Kurzfassung und Gültigkeit kommen aus den Parametern des Registers und
// stehen hier nicht noch einmal: So kann die Erklärung keine andere Zahl nennen als die Rechnung.
// Der Wortlaut ist derselbe wie vorher (server/test/law-wording.test.ts).
//
// ISO-Daten werden Zeichen für Zeichen verglichen, wie `compareText` in calc.ts.
//
// Wer eine Regel ändert oder ergänzt, setzt `RULES_AS_OF` auf den Tag der Durchsicht (#110).
import { betrkvTvSignal } from './bgb-betrkv.ts'
import { hkvConsumptionShare, hkvCutNotByConsumption, hkvCutRemoteReading, hkvRemoteReadingRetrofit } from './heizkostenv.ts'
import { dayBefore, germanDate, LAW_AS_OF, onlyVersion, valueAt } from './register.ts'

// Die Fassungen, aus denen die Regeln ihre Grenzen nehmen. Bekommt einer der beiden Parameter eine
// zweite Fassung, muss die Regel entscheiden, welche sie erklärt; bis dahin bricht `onlyVersion`
// beim Laden ab.
const tv = onlyVersion(betrkvTvSignal)
const retrofit = onlyVersion(hkvRemoteReadingRetrofit)
if (!tv.validTo || !retrofit.validFrom) throw new Error('Rechtsregister: Kabelregel oder Fernablesbarkeit ohne Grenze')
const TV_UNTIL = tv.validTo
const TV_NEW_FROM = germanDate(tv.value.newSystemsFrom)
const RETROFIT_FROM = retrofit.validFrom
const share = valueAt(hkvConsumptionShare, LAW_AS_OF)
const cut = valueAt(hkvCutNotByConsumption, LAW_AS_OF)
const remoteCut = valueAt(hkvCutRemoteReading, LAW_AS_OF)

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
      `Die Gebühren für das TV-Signal eines Kabelanschlusses und die Grundgebühren eines Breitbandanschlusses durften bis zum ${germanDate(TV_UNTIL)} ` +
      `als Betriebskosten umgelegt werden, und zwar nur bei Anlagen, die vor dem ${TV_NEW_FROM} errichtet wurden. Seitdem nicht mehr. ` +
      `Bei Anlagen, die vor dem ${TV_NEW_FROM} errichtet wurden, bleiben umlagefähig: bei einer Gemeinschaftsantenne des Hauses der ` +
      'Betriebsstrom sowie Prüfung und Einstellung durch eine Fachkraft, bei einer Breitband-Verteilanlage nur der Betriebsstrom. ' +
      'Bei später errichteten Anlagen ist davon nichts umlagefähig, ausgenommen eine reine Glasfaser-Verteilanlage (Betriebsstrom und Bereitstellungsentgelt).',
    validTo: TV_UNTIL,
  },
  {
    code: 'heating-flat-rate',
    title: 'Pauschale oder Warmmiete bei Heizung und Warmwasser',
    norm: '§§ 2, 12 Abs. 1 HeizkostenV; BGH, Urteil vom 19.07.2006, VIII ZR 212/05',
    summary:
      'Heizung und Warmwasser müssen nach Verbrauch abgerechnet werden; die Heizkostenverordnung geht einer Pauschale oder Warmmiete vor. ' +
      'Die Vereinbarung wird dann nicht angewendet: Der Heizanteil gilt als Vorauszahlung, über die nach Verbrauch abzurechnen ist. ' +
      'Nur im Gebäude mit höchstens zwei Wohnungen, von denen der Vermieter eine selbst bewohnt, und in den Fällen des § 11 darf etwas anderes vereinbart werden. ' +
      `Wird nicht nach Verbrauch abgerechnet, darf der Mieter seinen Anteil um ${cut} % kürzen.`,
  },
  {
    code: 'heating-consumption',
    title: 'Heizung und Warmwasser nach Verbrauch',
    norm: '§§ 2, 7 Abs. 1, 8 Abs. 1, 12 Abs. 1 HeizkostenV',
    summary:
      `Von den Kosten der zentralen Heizungs- und Warmwasseranlage sind mindestens ${share.min} und höchstens ${share.max} % nach dem erfassten Verbrauch zu verteilen, der Rest nach Wohn- oder Nutzfläche (bei der Heizung auch nach umbautem Raum). ` +
      `Wird nicht verbrauchsabhängig abgerechnet, darf der Mieter seinen Anteil um ${cut} % kürzen. ` +
      'Im Gebäude mit höchstens zwei Wohnungen, von denen der Vermieter eine selbst bewohnt, darf anderes vereinbart werden; ohne eine solche Vereinbarung gilt die Verordnung auch dort.',
  },
  {
    // Durchsicht vom 02.10.2026 (#110): Die Nachrüstfrist des § 5 Abs. 3 endet am 31.12.2026. Für
    // Geräte, die nach dem 01.12.2021 eingebaut wurden, gilt die Pflicht in der Regel schon seit dem
    // Einbau (§ 5 Abs. 2), und die monatliche Information nach § 6a schulden Vermieter seit 2022;
    // beides trägt schon die Kürzung um 3 %. Die Regel beginnt trotzdem erst 2027, weil sie an der
    // Nachrüstfrist hängt, die alle Geräte erfasst. Die früheren Pflichten betreffen nur neu
    // eingebaute Geräte und den Versand der Information, und beides erfasst Mietfuchs nicht: Ein
    // Hinweis ab 2022 wäre in jedem Haus erschienen, ohne dass sich sagen ließe, ob er zutrifft.
    // Wortlaut geprüft auf
    // https://www.gesetze-im-internet.de/heizkostenv/ (Stand Art. 3 G v. 16.10.2023 I Nr. 280).
    code: 'heating-remote-reading',
    title: 'Fernablesbare Zähler und monatliche Verbrauchsinformation',
    norm: '§ 5 Abs. 2 und 3, § 6a, § 12 Abs. 1 Satz 2 und 3 HeizkostenV',
    summary:
      `Zähler und Heizkostenverteiler für Heizung und Warmwasser müssen fernablesbar sein: die nach dem ${germanDate(retrofit.value.installedUpTo)} eingebauten sofort, alle übrigen ab dem ${germanDate(RETROFIT_FROM)} (Nachrüstfrist bis ${germanDate(dayBefore(RETROFIT_FROM))}). ` +
      'Sind fernablesbare Geräte eingebaut, stehen den Mietern monatliche Verbrauchsinformationen zu. ' +
      `Fehlt das eine oder das andere, darf der Mieter seinen Anteil an den Heizkosten um ${remoteCut} % kürzen. ` +
      'Ausgenommen sind Fälle, in denen die Nachrüstung technisch nicht möglich ist, einen unangemessenen Aufwand bedeutet oder in sonstiger Weise eine unbillige Härte wäre.',
    // Der Zeitpunkt kommt aus `hkv.remote-reading.retrofit` (N6 der dritten Fassung).
    validFrom: RETROFIT_FROM,
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
```

Importe nachziehen, mechanisch:

```bash
sed -i "s#'../src/rules.ts'#'../../shared/law/rules.ts'#" server/test/rules.test.ts server/test/rechtstexte.test.ts server/test/rechtsdurchsicht-2026.test.ts server/test/calc-notices.test.ts server/test/api.test.ts server/test/law-wording.test.ts
sed -i "s#from './rules.ts'#from '../../shared/law/rules.ts'#" server/src/calc.ts
grep -rn "src/rules.ts\|'./rules.ts'" server client scripts --include=*.ts --include=*.tsx --include=*.mjs | grep -v node_modules
```

Expected: Die letzte Zeile gibt nichts aus.

- [ ] **Step 5: Release-Sperre in `release.yml`**

Im Job `build` direkt nach dem Schritt „Version aus dem Tag übernehmen“ einfügen:

```yaml
      # Rechtsregister (Heizung PR 1, Entwurf 4.7): Beim Tag bricht der Lauf ab, solange ein Wert
      # im Register nicht an der Quelle geprüft ist (`checked: 'unchecked'`). Im gewöhnlichen
      # Testlauf ist die Prüfung übersprungen, damit eine PR einen ungeprüften Wert eintragen darf.
      - name: Rechtsregister geprüft?
        if: github.ref_type == 'tag'
        working-directory: server
        env:
          MIETFUCHS_RELEASE: '1'
        run: node --test test/law-release.test.ts
```

- [ ] **Step 6: Tests ausführen**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/law-release.test.ts test/law-wording.test.ts test/rules.test.ts test/rechtstexte.test.ts test/rechtsdurchsicht-2026.test.ts test/calc-notices.test.ts`
Expected: `ℹ fail 0`; `law.test.ts` mit 17 bestandenen Tests, `law-release.test.ts` mit `ℹ skipped 1`.

Dann die Sperre selbst probieren:

Run: `cd server && MIETFUCHS_RELEASE=1 node --test test/law-release.test.ts; cd ..`
Expected: FAIL mit „Vor dem Release an der Quelle lesen“ und drei Zeilen `ustg.standard-rate (…)`. Das ist gewollt: Der Entwurf markiert den Wert als ungeprüft.

- [ ] **Step 7: Volle Prüfung und Commit**

Run: `npm --prefix server test && npm run typecheck`
Expected: `ℹ fail 0`.

```bash
git add shared/law server/src/calc.ts server/test .github/workflows/release.yml
git commit -m "Rechtsregister: sieben Parameter, Regelverzeichnis nach shared/law/, Fassungen festgehalten, Release-Sperre" -m "Refs #97" -m "Refs #110"
```

---

### Task 4: Die Berechnung fragt das Register und protokolliert

**Files:**
- Modify: `server/src/calc.ts`, `shared/heating.ts`
- Modify: `server/test/calc-leerstand-personen.test.ts`, `server/test/calc-notices.test.ts`, `server/test/api.test.ts`
- Test: `server/test/calc-rechtswerte.test.ts` (neu)

**Interfaces:**
- Consumes: `law`, `createLawLog`, `valueAt`, `onlyVersion`, `dayAfter`, `LAW_AS_OF`, `Period` (Task 2); die sieben Parameter außer `ustgStandardRate` (Task 3).
- Produces:
  - `ComputedSettlement['legalBasis']` ist `LegalBasis & { values: AppliedValue[] }`, `asOf` ist `LAW_AS_OF`.
  - `heatingFindings(items, units, covered, consumptionShare: () => { readonly min: number; readonly max: number }): HeatingFindings` (vierter Parameter neu, wird nur aufgerufen, wenn es eine Gruppe zu prüfen gibt).
  - `VACANCY_PERSONS` ist aus calc.ts **entfernt**; der Wert heißt `practice.vacancy-persons`.

Abgefragt wird jeder Wert erst dort, wo er wirklich gebraucht wird, damit nur Benutztes einfriert: Kabel nur bei einer Position „Kabel/Antenne“, Leerstand nur bei einer Wohnung mit Leerstandstagen, die Grenzen 50/70 nur bei einer Gruppe mit Verbrauchs- und Grundkosten oder in einem Heizhinweis, 15 % nur in einem Heizhinweis, die Fernablesbarkeit nur bei einer abgerechneten Heizposition. Eine Abfrage mit `overlap` protokolliert auch bei `none` die Fassung, nach der entschieden wurde.

- [ ] **Step 1: Failing test schreiben**

Datei `server/test/calc-rechtswerte.test.ts`:

```ts
// Rechtswerte einer Abrechnung (Heizung PR 1, Entwurf 4.2 und 4.4): Jeder Wert aus dem Register,
// mit dem die Berechnung gerechnet oder einen Hinweis geschrieben hat, steht in
// `legalBasis.values`, und nur diese. So friert beim Abschluss ein, mit welcher Zahl gerechnet
// wurde, und `deviation` kann sie später vergleichen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type Snapshot, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { LAW_AS_OF } from '../../shared/law/register.ts'

const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const unit = (id: string, areaM2: number): SnapshotUnit => ({ id, name: id, areaM2, participates: true })
const item = (year: number, over: Partial<SnapshotCostItem>): SnapshotCostItem =>
  ({ id: 'k', year, category: 'Grundsteuer', description: 'Posten', amountCents: 120000, key: 'area', ...over })
const snap = (year: number, s: Partial<SnapshotSource>, property?: Snapshot['property']): Snapshot => ({
  ...snapshotOf({ units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s }, year),
  ...(property !== undefined ? { property } : {}),
})
const two = { units: [unit('w1', 60), unit('w2', 40)], tenancies: [tenancy('A', 'w1'), tenancy('B', 'w2')] }
const ids = (s: ComputedSettlement) => s.legalBasis.values.map((v) => v.id).sort()

test('Rechtswerte: ohne Heizung, Kabel und Leerstand keine, und der Rechtsstand ist das Datum des Registers', () => {
  const s = computeSettlement(snap(2025, { ...two, costItems: [item(2025, {})] }))
  assert.deepEqual(s.legalBasis.values, [])
  assert.equal(s.legalBasis.asOf, LAW_AS_OF)
})

test('Rechtswerte: Heizung nach Fläche friert 50 bis 70 % und 15 % ein, mit Fundstelle und Text', () => {
  const s = computeSettlement(snap(2025, { ...two, costItems: [item(2025, { category: 'Heizung und Warmwasser', description: 'Heizöl' })] }))
  // Dazu die Fernablesbarkeit: Nach ihr ist entschieden worden, dass 2025 noch kein Hinweis kommt.
  assert.deepEqual(ids(s), ['hkv.consumption-share', 'hkv.cut.not-by-consumption', 'hkv.remote-reading.retrofit'])
  const cut = s.legalBasis.values.find((v) => v.id === 'hkv.cut.not-by-consumption')
  assert.deepEqual(cut, {
    id: 'hkv.cut.not-by-consumption',
    title: 'Kürzung bei nicht verbrauchsabhängiger Abrechnung',
    norm: '§ 12 Abs. 1 Satz 1 HeizkostenV',
    cite: '§ 12 Abs. 1 Satz 1 HeizkostenV',
    value: 15,
    text: '15 %',
  })
})

test('Rechtswerte: Kabel 2024 und 2025 frieren die Kabelregel ein, auch wenn sie nicht mehr gilt', () => {
  for (const year of [2024, 2025]) {
    const s = computeSettlement(snap(year, { ...two, costItems: [item(year, { category: 'Kabel/Antenne', key: 'units' })] }))
    assert.deepEqual(ids(s), ['betrkv.tv-signal'], String(year))
    assert.equal(s.legalBasis.values[0]?.validTo, '2024-06-30')
  }
})

test('Rechtswerte: Messdienst 2026 ohne Fernablesungshinweis friert nur den Zeitpunkt ein, 2027 auch die 3 %', () => {
  const heat = (year: number) => item(year, { category: 'Heizung und Warmwasser', key: 'amounts', tenancyAmounts: { A: 60000, B: 60000 } })
  assert.deepEqual(ids(computeSettlement(snap(2026, { ...two, costItems: [heat(2026)] }))), ['hkv.remote-reading.retrofit'])
  assert.deepEqual(ids(computeSettlement(snap(2027, { ...two, costItems: [heat(2027)] }))), ['hkv.cut.remote-reading', 'hkv.remote-reading.retrofit'])
})

test('Rechtswerte: Leerstand beim Personenschlüssel friert die eine Person ein, ohne Leerstand nicht', () => {
  const muell = item(2025, { category: 'Müllabfuhr', key: 'persons' })
  const leer = computeSettlement(snap(2025, { units: two.units, tenancies: [tenancy('A', 'w1')], costItems: [muell] }))
  assert.deepEqual(ids(leer), ['practice.vacancy-persons'])
  assert.equal(leer.legalBasis.values[0]?.text, '1 Person je Leerstandstag')
  assert.deepEqual(ids(computeSettlement(snap(2025, { ...two, costItems: [muell] }))), [])
})

test('Rechtswerte: jedes Jahr rechnet, auch weit vor und nach den Fassungen des Registers', () => {
  // Fehlt eine Fassung, wirft das Register; eine Abrechnung darf daran nicht scheitern.
  for (const year of [1990, 2021, 2024, 2027, 2100]) {
    const s = computeSettlement(snap(year, {
      units: two.units,
      tenancies: [tenancy('A', 'w1', { start: '1980-01-01', personHistory: [{ from: '1980-01-01', persons: 1 }] })],
      costItems: [
        item(year, { id: 'h', category: 'Heizung und Warmwasser' }),
        item(year, { id: 'k', category: 'Kabel/Antenne', key: 'units' }),
        item(year, { id: 'm', category: 'Müllabfuhr', key: 'persons' }),
      ],
    }, { kind: 'mfh', cableBuiltBeforeDec2021: false }))
    assert.ok(s.legalBasis.values.length >= 4, `${year}: ${ids(s).join(', ')}`)
  }
})

test('Rechtswerte: zwei Abrechnungen nacheinander teilen kein Protokoll', () => {
  const heat = computeSettlement(snap(2025, { ...two, costItems: [item(2025, { category: 'Heizung und Warmwasser' })] }))
  const plain = computeSettlement(snap(2025, { ...two, costItems: [item(2025, {})] }))
  assert.ok(heat.legalBasis.values.length > 0)
  assert.deepEqual(plain.legalBasis.values, [])
})
```

- [ ] **Step 2: Test ausführen, er muss scheitern**

Run: `npm --prefix server test -- test/calc-rechtswerte.test.ts`
Expected: FAIL, `TypeError: Cannot read properties of undefined (reading 'map')` bzw. `'length'`, weil `legalBasis.values` fehlt; im ersten Test zusätzlich `'2026-10-02' !== '2026-10-05'`.

- [ ] **Step 3: `shared/heating.ts` anpassen**

```diff
diff --git a/shared/heating.ts b/shared/heating.ts
index 261409c..60b5ac3 100644
--- a/shared/heating.ts
+++ b/shared/heating.ts
@@ -53,7 +53,15 @@ export type HeatingFindings = {
   shareOutside: { unitIds: string[]; itemIds: string[]; consumptionCents: number; totalCents: number }[]
 }
 
-export function heatingFindings(items: readonly HeatingItem[], units: readonly HeatingUnit[], covered: ReadonlySet<string>): HeatingFindings {
+// `consumptionShare` liefert die Grenzen aus dem Rechtsregister (`hkv.consumption-share`) und wird
+// nur aufgerufen, wenn es eine Gruppe zu prüfen gibt; so trägt die Abrechnung den Wert nur ein,
+// wenn sie ihn benutzt hat.
+export function heatingFindings(
+  items: readonly HeatingItem[],
+  units: readonly HeatingUnit[],
+  covered: ReadonlySet<string>,
+  consumptionShare: () => { readonly min: number; readonly max: number },
+): HeatingFindings {
   const heating = items.filter((c) => c.category === HEATING_CATEGORY && c.key !== 'direct')
   const takesPart = (c: HeatingItem, unitId: string) => !c.participantUnitIds || c.participantUnitIds.includes(unitId)
   const withoutConsumption = new Map<string, Set<string>>()
@@ -78,7 +86,9 @@ export function heatingFindings(items: readonly HeatingItem[], units: readonly H
     g.unitIds.push(u.id)
     groups.set(key, g)
   }
-  const shareOutside = [...groups.values()].filter((g) =>
-    g.totalCents > 0 && g.consumptionCents > 0 && (g.consumptionCents * 100 < g.totalCents * 50 || g.consumptionCents * 100 > g.totalCents * 70))
+  const candidates = [...groups.values()].filter((g) => g.totalCents > 0 && g.consumptionCents > 0)
+  if (candidates.length === 0) return { withoutConsumption, shareOutside: [] }
+  const { min, max } = consumptionShare()
+  const shareOutside = candidates.filter((g) => g.consumptionCents * 100 < g.totalCents * min || g.consumptionCents * 100 > g.totalCents * max)
   return { withoutConsumption, shareOutside }
 }
```

- [ ] **Step 4: `server/src/calc.ts` umstellen**

Der Patch gegen den Stand nach Task 3 (mit `git apply` oder von Hand). Er ersetzt `ruleCoverage` und `RULES_AS_OF`, entfernt `VACANCY_PERSONS` (Begründung steht jetzt in `shared/law/practice.ts`), baut Titel, Texte und den Kürzungsbetrag aus dem Register und legt das Protokoll in `legalBasis.values`:

```diff
diff --git a/server/src/calc.ts b/server/src/calc.ts
index 528d83f..09e0830 100644
--- a/server/src/calc.ts
+++ b/server/src/calc.ts
@@ -1,6 +1,7 @@
 // Berechnungs-Engine für die Nebenkostenabrechnung.
 // Alle Beträge werden in Cent (Integer) gerechnet, um Gleitkomma-Fehler zu vermeiden.
 import type {
+  AppliedValue,
   CalcStep,
   CostKey,
   CostModel,
@@ -29,7 +30,13 @@ import type {
 // Die Berechnung kennt den Speicher nicht mehr, sondern nur noch den Schnappschuss eines
 // Abrechnungsjahres (siehe snapshot.ts). Welche Sammlung darin nach Jahr eingegrenzt sein darf,
 // entscheidet dort die Ablage und nicht hier.
-import { RULES_AS_OF, ruleCoverage, rulesFor } from '../../shared/law/rules.ts'
+import { rulesFor } from '../../shared/law/rules.ts'
+// Zahlen und Daten der Rechtsregeln kommen aus dem Rechtsregister (Heizung PR 1) und stehen hier
+// nicht als Literal; server/test/law-literals.test.ts wacht darüber.
+import { createLawLog, dayAfter, law, LAW_AS_OF, onlyVersion, valueAt, type Period } from '../../shared/law/register.ts'
+import { betrkvTvSignal } from '../../shared/law/bgb-betrkv.ts'
+import { hkvConsumptionShare, hkvCutNotByConsumption, hkvCutRemoteReading, hkvRemoteReadingRetrofit } from '../../shared/law/heizkostenv.ts'
+import { practiceVacancyPersons } from '../../shared/law/practice.ts'
 import { HEATING_CATEGORY, heatingByConsumption, heatingFindings, mayAgreeOtherwise } from '../../shared/heating.ts'
 import { andList, meterTypeLabel, plural } from '../../shared/wording.ts'
 import type { TermId } from '../../shared/glossary.ts'
@@ -147,19 +154,9 @@ export function personDaysInPeriod(tenancy: SnapshotTenancy, from: string, to: s
   return sum
 }
 
-// **Personen je Leerstandstag beim Personenschlüssel (#177).** Den Anteil einer leerstehenden
-// Wohnung trägt der Vermieter (BGH, Urteil vom 31.05.2006, VIII ZR 159/05, entschieden am
-// Flächenschlüssel). Wie die leere Wohnung beim Personenschlüssel anzusetzen ist, regelt kein
-// Gesetz, und höchstrichterlich ist es nicht abschließend geklärt: Nach BGH, Beschluss vom
-// 08.01.2013, VIII ZR 180/12, entscheidet der Tatrichter im Einzelfall nach Billigkeit, und es
-// „kann in Betracht kommen“, für den Leerstand eine fiktive Person anzusetzen, vor allem bei
-// Kosten, die nicht von der Personenzahl abhängen.
-// Auslegung nach BGH VIII ZR 180/12; LG Krefeld, 17.03.2010, 2 S 56/09 (eine Person statt null);
-// abweichend AG Köln WuM 2002, 28 (Durchschnittsbelegung). Mietfuchs setzt jeden Tag ohne
-// Mietverhältnis mit dieser Zahl an, bei allen Positionen nach Personen. Wer das ändert (etwa auf
-// die durchschnittliche Belegung des Hauses), ändert es hier und in `vacancyPersons` in
-// computeSettlement, sonst nirgends.
-export const VACANCY_PERSONS = 1
+// Personen je Leerstandstag beim Personenschlüssel (#177): Wert und Begründung stehen seit
+// Heizung PR 1 im Rechtsregister (`practice.vacancy-persons`, shared/law/practice.ts), verwendet
+// über `vacancyPersons` in computeSettlement.
 
 // Aktuelle Personenzahl zu einem Stichtag
 export function personsAt(tenancy: SnapshotTenancy, dateIso: string): number {
@@ -199,7 +196,7 @@ const noticeKinds = {
   // Eine leere Einheit ohne Fläche ist beim Personenschlüssel kein Leerstand (#177); wie bei
   // `basis.unit-zero` ist die 0 meist eine Angabe (Garage, Stellplatz).
   'basis.vacancy-no-area': { level: 'hint', title: 'Leere Einheit ohne Fläche', terms: ['vacancy', 'personDays'] },
-  'tv-signal.partial-year': { level: 'warning', title: 'Kabelfernsehen nur bis 30.06.2024 umlagefähig', rule: 'tv-signal', terms: ['cableTv', 'notAllocable'] },
+  'tv-signal.partial-year': { level: 'warning', title: `Kabelfernsehen nur bis ${fmtDay(onlyVersion(betrkvTvSignal).validTo ?? '')} umlagefähig`, rule: 'tv-signal', terms: ['cableTv', 'notAllocable'] },
   'tv-signal.ended': { level: 'warning', title: 'Kabelfernsehen nicht mehr umlagefähig', rule: 'tv-signal', terms: ['cableTv', 'notAllocable'] },
   'tv-signal.new-system': { level: 'warning', title: 'Kabelfernsehen bei neuer Anlage nie umlagefähig', rule: 'tv-signal', terms: ['cableTv', 'notAllocable'] },
   'item.no-basis': { level: 'warning', title: 'Position geht ganz an den Vermieter', terms: ['distributionBasis'] },
@@ -222,7 +219,7 @@ const noticeKinds = {
   'direct.unit-gone': { level: 'warning', title: 'Zugeordnete Wohnung gibt es nicht mehr', terms: ['directAssignment'] },
   'labor35a.invalid': { level: 'warning', title: 'Lohnanteil nach § 35a ungültig', terms: ['labor35a'] },
   'heating.not-by-consumption': { level: 'warning', title: 'Heizkosten nicht nach Verbrauch verteilt', rule: 'heating-consumption', terms: ['heatingCostOrdinance', 'consumptionKey'] },
-  'heating.consumption-share': { level: 'hint', title: 'Verbrauchsanteil der Heizkosten außerhalb 50 bis 70 %', rule: 'heating-consumption', terms: ['heatingCostOrdinance', 'consumptionKey'] },
+  'heating.consumption-share': { level: 'hint', title: `Verbrauchsanteil der Heizkosten außerhalb ${hkvConsumptionShare.describe(valueAt(hkvConsumptionShare, LAW_AS_OF))}`, rule: 'heating-consumption', terms: ['heatingCostOrdinance', 'consumptionKey'] },
   'heating.may-agree-otherwise': { level: 'hint', title: 'Heizkosten nicht nach Verbrauch verteilt (Zweifamilienhaus)', rule: 'heating-consumption', terms: ['heatingCostOrdinance', 'consumptionKey'] },
   'heating.flat-rate': { level: 'warning', title: 'Heizkosten pauschal vereinbart', rule: 'heating-flat-rate', terms: ['heatingCostOrdinance', 'inclusiveRent'] },
   'heating.remote-reading': { level: 'hint', title: 'Zähler der Heizung fernablesbar?', rule: 'heating-remote-reading', terms: ['heatingCostOrdinance'] },
@@ -1350,7 +1347,8 @@ export type ComputedSettlement = Omit<Settlement, 'closed' | 'notSettled' | 'not
   notSettled: NotSettled[]
   garageLikeUnitIds: string[]
   notices: Notice[]
-  legalBasis: LegalBasis
+  // Frisch gerechnet immer mit den benutzten Rechtswerten (Heizung PR 1)
+  legalBasis: LegalBasis & { values: AppliedValue[] }
 }
 
 // Die Kostenart, an der Mietfuchs Heizung und Warmwasser erkennt (#93), steht mit der Ausnahme
@@ -1493,6 +1491,11 @@ export function computeSettlement(snapshot: Snapshot, options: SettlementOptions
   const diy = daysInYear(year)
   const yFrom = `${year}-01-01`
   const yTo = `${year}-12-31`
+  // Das Protokoll der Rechtswerte dieser Abrechnung (Heizung PR 1, Entwurf 4.2): Jede Abfrage
+  // trägt ein, was sie bekommen hat, und am Ende steht es in `legalBasis.values`. Abgefragt wird
+  // erst dort, wo ein Wert wirklich gebraucht wird, damit nur Benutztes einfriert.
+  const lawLog = createLawLog()
+  const lawPeriod: Period = { from: yFrom, to: yTo }
   const unitById = new Map(snapshot.units.map((u) => [u.id, u]))
   // Selbstgenutzte Wohnungen (`selfUsed`) haben kein Mietverhältnis, bilden aber die
   // Verteilbasis mit: Kosten einer Rechnung über das ganze Haus dürfen nur anteilig auf die
@@ -1547,8 +1550,8 @@ export function computeSettlement(snapshot: Snapshot, options: SettlementOptions
   // deshalb aus der Verteilbasis: Ihr Anteil ging still an die übrigen Mieter, während Fläche und
   // Einheiten ihn beim Vermieter ließen. Den Leerstand trägt der Vermieter (BGH, Urteil vom
   // 31.05.2006, VIII ZR 159/05, dort am Flächenschlüssel entschieden; zum Personenschlüssel die
-  // fiktive Person nach BGH VIII ZR 180/12, siehe `VACANCY_PERSONS`). Deshalb zählt jede
-  // vermietete Wohnung der Verteilbasis für jeden Tag ohne Mietverhältnis mit
+  // fiktive Person nach BGH VIII ZR 180/12, siehe `practice.vacancy-persons` im Rechtsregister).
+  // Deshalb zählt jede vermietete Wohnung der Verteilbasis für jeden Tag ohne Mietverhältnis mit
   // `vacancyPersons(u)` Personen; kein Mietverhältnis bekommt diese Tage, ihr Anteil bleibt also
   // als `vacancy` beim Vermieter. Auch der Leerstand zwischen zwei Mietern zählt.
   // Ausgenommen sind die selbstgenutzten Wohnungen (die zählen mit ihren eigenen Personen) und
@@ -1560,14 +1563,16 @@ export function computeSettlement(snapshot: Snapshot, options: SettlementOptions
   // leere Garage **mit** eingetragener Fläche ist nach dieser Regel eine Wohnung und zählt weiter als
   // Leerstand; wer das nicht will, nimmt sie aus der Abrechnungseinheit oder aus den Teilnehmern.
   // Die Zahl je Wohnung kommt aus dieser einen Funktion: Wer später etwa die durchschnittliche
-  // Belegung des Hauses ansetzen will, rechnet sie hier aus (ohne die Leerstände selbst).
-  const vacancyPersons = (_u: SnapshotUnit): number => VACANCY_PERSONS
+  // Belegung des Hauses ansetzen will, rechnet sie hier aus (ohne die Leerstände selbst). Der Wert
+  // steht im Rechtsregister (`practice.vacancy-persons`) und wird nur bei Leerstand abgefragt.
+  const vacancyPersons = (_u: SnapshotUnit): number => law(practiceVacancyPersons, { period: lawPeriod }, lawLog)
   type Vacancy = { unit: SnapshotUnit, days: number, persons: number, personDays: number }
   const vacancies: Vacancy[] = basisUnits.flatMap((u) => {
     if (!u.participates || !isDwelling(u)) return []
     const days = diy - occupiedDays(tenancies.filter((t) => t.unitId === u.id), yFrom, yTo)
+    if (days <= 0) return []
     const persons = vacancyPersons(u)
-    return days > 0 && persons > 0 ? [{ unit: u, days, persons, personDays: days * persons }] : []
+    return persons > 0 ? [{ unit: u, days, persons, personDays: days * persons }] : []
   })
   const vacancyPersonDays = vacancies.reduce((a, v) => a + v.personDays, 0)
   const personsLabel = (n: number) => `${fmtNum(n)} ${n === 1 ? 'Person' : 'Personen'}`
@@ -1933,13 +1938,18 @@ export function computeSettlement(snapshot: Snapshot, options: SettlementOptions
   // Übergangsfrist bis 30.06.2024, nur für Anlagen vor dem 01.12.2021, § 2 Satz 2 BetrKV). Danach bleibt
   // bei solchen Anlagen nur der Betriebsstrom, bei einer Gemeinschaftsantenne auch Prüfung und Einstellung.
   // Welcher Teil einer Position was ist, weiß Mietfuchs nicht; es kürzt deshalb nicht selbst,
-  // sondern sagt es. Ab wann das gilt, steht im Regelverzeichnis (`tv-signal`, #112): Gilt die
-  // Regel nur im Teil des Jahres, ist es das Übergangsjahr; gilt sie gar nicht mehr, die Zeit
-  // danach. Einen Beginn hat die Regel nicht, „gar nicht“ heißt deshalb immer „vorbei“.
-  const tvSignal = ruleCoverage('tv-signal', yFrom, yTo)
-  // Eine Anlage ab dem 01.12.2021 fiel nie unter die Regel (#121, § 2 Satz 2 BetrKV): dann in jedem
-  // Jahr ab 2021 dieselbe Warnung, ohne Übergangszeit.
-  const newSystem = snapshot.property?.cableBuiltBeforeDec2021 === false && year >= 2021
+  // sondern sagt es. Ab wann das gilt, steht im Rechtsregister (`betrkv.tv-signal`, Zeitregel
+  // `overlap`): Gilt die Regel nur im Teil des Jahres, ist es das Übergangsjahr; gilt sie gar nicht
+  // mehr, die Zeit danach. Einen Beginn hat die Regel nicht, „gar nicht“ heißt deshalb immer
+  // „vorbei“. Abgefragt nur, wenn es eine Position Kabel/Antenne gibt.
+  const tv = items.some((c) => c.category === 'Kabel/Antenne') ? law(betrkvTvSignal, { period: lawPeriod }, lawLog) : null
+  const tvSignal = tv?.coverage ?? 'none'
+  const tvUntil = tv?.validTo ?? ''
+  const tvNewFrom = tv?.value.newSystemsFrom ?? ''
+  const tvNewYear = Number(tvNewFrom.slice(0, 4))
+  // Eine Anlage ab dem Stichtag der Regel fiel nie unter sie (#121, § 2 Satz 2 BetrKV): dann in
+  // jedem Jahr ab dem Jahr des Stichtags dieselbe Warnung, ohne Übergangszeit.
+  const newSystem = tv !== null && snapshot.property?.cableBuiltBeforeDec2021 === false && year >= tvNewYear
   // Die Warnungen nennen den Betrag, der trotzdem bei den Mietern gelandet ist (#142, Zielbild
   // aus #91). Den kennt erst die Verteilung; geschrieben werden sie deshalb danach, aber an dieser
   // Stelle der Hinweise, damit ihre Reihenfolge bleibt.
@@ -1950,11 +1960,11 @@ export function computeSettlement(snapshot: Snapshot, options: SettlementOptions
     // Nur ein wirklich umgelegter Betrag; eine Gutschrift hat den Mietern nichts aufgebürdet.
     const charged = cents > 0 ? ` Auf die Mieter umgelegt sind in dieser Abrechnung ${fmtCents(cents)}.` : ''
     if (newSystem) {
-      return [makeNotice('tv-signal.new-system', `„${item.description}“: Die Kabel- oder Antennenanlage wurde ab dem 01.12.2021 errichtet; für sie waren die Gebühren für das TV-Signal nie umlagefähig, auch Betriebsstrom und Wartung nicht (§ 2 Satz 2 BetrKV).${charged} Umlagefähig sind allenfalls Betriebsstrom und Bereitstellungsentgelt einer reinen Glasfaser-Verteilanlage, bei der der Mieter seinen Anbieter frei wählen kann (§ 2 Nr. 15 Buchst. c BetrKV); buchen Sie den Rest bitte als „Nicht umlagefähig“.${year === 2021 ? ' Für 2021 gilt das für die Kosten ab der Errichtung; was davor auf eine ältere Anlage entfiel, war umlagefähig.' : ''}`, itemSubject(item))]
+      return [makeNotice('tv-signal.new-system', `„${item.description}“: Die Kabel- oder Antennenanlage wurde ab dem ${fmtDay(tvNewFrom)} errichtet; für sie waren die Gebühren für das TV-Signal nie umlagefähig, auch Betriebsstrom und Wartung nicht (§ 2 Satz 2 BetrKV).${charged} Umlagefähig sind allenfalls Betriebsstrom und Bereitstellungsentgelt einer reinen Glasfaser-Verteilanlage, bei der der Mieter seinen Anbieter frei wählen kann (§ 2 Nr. 15 Buchst. c BetrKV); buchen Sie den Rest bitte als „Nicht umlagefähig“.${year === tvNewYear ? ` Für ${year} gilt das für die Kosten ab der Errichtung; was davor auf eine ältere Anlage entfiel, war umlagefähig.` : ''}`, itemSubject(item))]
     } else if (tvSignal === 'partial') {
-      return [makeNotice('tv-signal.partial-year', `„${item.description}“: Die Gebühren für das Kabelfernsehen (TV-Signal) sind nur bis zum 30.06.2024 umlagefähig, danach nicht mehr (Wegfall des Nebenkostenprivilegs). Umlegen dürfen Sie für 2024 höchstens das erste Halbjahr, und das nur bei einer Anlage, die vor dem 01.12.2021 errichtet wurde; danach nur noch den Betriebsstrom (bei einer Gemeinschaftsantenne des Hauses auch Prüfung und Einstellung durch eine Fachkraft). Bitte teilen Sie die Position entsprechend auf und buchen Sie den Rest als „Nicht umlagefähig“.`, itemSubject(item))]
+      return [makeNotice('tv-signal.partial-year', `„${item.description}“: Die Gebühren für das Kabelfernsehen (TV-Signal) sind nur bis zum ${fmtDay(tvUntil)} umlagefähig, danach nicht mehr (Wegfall des Nebenkostenprivilegs). Umlegen dürfen Sie für ${year} höchstens das erste Halbjahr, und das nur bei einer Anlage, die vor dem ${fmtDay(tvNewFrom)} errichtet wurde; danach nur noch den Betriebsstrom (bei einer Gemeinschaftsantenne des Hauses auch Prüfung und Einstellung durch eine Fachkraft). Bitte teilen Sie die Position entsprechend auf und buchen Sie den Rest als „Nicht umlagefähig“.`, itemSubject(item))]
     } else if (tvSignal === 'none') {
-      return [makeNotice('tv-signal.ended', `„${item.description}“: Die Gebühren für das Kabelfernsehen (TV-Signal) sind seit dem 01.07.2024 nicht mehr umlagefähig (Wegfall des Nebenkostenprivilegs).${charged} Umlegen dürfen Sie nur noch den Betriebsstrom, und das nur bei einer Anlage, die vor dem 01.12.2021 errichtet wurde (bei einer Gemeinschaftsantenne des Hauses auch Prüfung und Einstellung durch eine Fachkraft); buchen Sie das TV-Signal bitte als „Nicht umlagefähig“.`, itemSubject(item))]
+      return [makeNotice('tv-signal.ended', `„${item.description}“: Die Gebühren für das Kabelfernsehen (TV-Signal) sind seit dem ${fmtDay(dayAfter(tvUntil))} nicht mehr umlagefähig (Wegfall des Nebenkostenprivilegs).${charged} Umlegen dürfen Sie nur noch den Betriebsstrom, und das nur bei einer Anlage, die vor dem ${fmtDay(tvNewFrom)} errichtet wurde (bei einer Gemeinschaftsantenne des Hauses auch Prüfung und Einstellung durch eine Fachkraft); buchen Sie das TV-Signal bitte als „Nicht umlagefähig“.`, itemSubject(item))]
     }
     return []
   })
@@ -1971,7 +1981,9 @@ export function computeSettlement(snapshot: Snapshot, options: SettlementOptions
   // Heizpositionen ohne Verbrauchsanteil (#140): Die Kürzungsbeträge entstehen in der Verteilung,
   // gemeldet wird erst danach, denn ob eine Wohnung nach Verbrauch gedeckt ist, steht erst fest,
   // wenn alle Positionen verteilt sind (siehe shared/heating.ts).
-  const heatingCuts: { item: SnapshotCostItem, rows: { unitId: string, text: string }[] }[] = []
+  // Je Zeile der Anteil des Mieters; den Kürzungsbetrag rechnet erst der Hinweis, mit dem Satz aus
+  // dem Rechtsregister (`hkv.cut.not-by-consumption`).
+  const heatingCuts: { item: SnapshotCostItem, rows: { unitId: string, label: string, share: number }[] }[] = []
   const heatingCovered = new Set<string>()
   // Die erste Heizposition, über die ein Mieter abgerechnet wird; an ihr hängt der Hinweis zur
   // Fernablesbarkeit (heating-remote-reading), einmal je Abrechnung.
@@ -2464,7 +2476,7 @@ export function computeSettlement(snapshot: Snapshot, options: SettlementOptions
       } else {
         heatingCuts.push({
           item,
-          rows: received.map(({ x, share }) => ({ unitId: x.t.unitId, text: `${x.t.tenantName} (${x.t.unit.name}) ${fmtCents(Math.round((share * 15) / 100))}` })),
+          rows: received.map(({ x, share }) => ({ unitId: x.t.unitId, label: `${x.t.tenantName} (${x.t.unit.name})`, share })),
         })
       }
     }
@@ -2533,11 +2545,15 @@ export function computeSettlement(snapshot: Snapshot, options: SettlementOptions
   // einer bezifferten Kürzung. Ein Feld dafür am Zähler gehört zur Heizkostenabrechnung (#97, #99).
   // Ohne `subject`: An der Kostenposition gibt es nichts zu beheben, ein „Hier beheben →“ führte
   // ins Leere.
-  if (heatingBilledItem && ruleCoverage('heating-remote-reading', yFrom, yTo) !== 'none') {
+  // Der Zeitpunkt kommt aus `hkv.remote-reading.retrofit` (Zeitregel `overlap`), die Höhe aus
+  // `hkv.cut.remote-reading` (dritte Fassung des Entwurfs, N6).
+  const retrofit = heatingBilledItem ? law(hkvRemoteReadingRetrofit, { period: lawPeriod }, lawLog) : null
+  if (retrofit && retrofit.coverage !== 'none') {
+    const remoteCut = law(hkvCutRemoteReading, { period: lawPeriod }, lawLog)
     warn('heating.remote-reading',
-      'Spätestens seit dem 01.01.2027 müssen alle Zähler und Heizkostenverteiler für Heizung und Warmwasser fernablesbar sein (§ 5 Abs. 3 HeizkostenV); ' +
-        'Geräte, die nach dem 01.12.2021 eingebaut wurden, müssen es in der Regel schon seit ihrem Einbau sein (§ 5 Abs. 2). Bei fernablesbaren Geräten stehen den Mietern schon seit 2022 monatliche Verbrauchsinformationen zu (§ 6a HeizkostenV). ' +
-        'Fehlt das eine oder das andere, darf jeder Mieter seinen Anteil an den Heizkosten um 3 % kürzen (§ 12 Abs. 1 HeizkostenV). ' +
+      `Spätestens seit dem ${fmtDay(retrofit.validFrom ?? '')} müssen alle Zähler und Heizkostenverteiler für Heizung und Warmwasser fernablesbar sein (§ 5 Abs. 3 HeizkostenV); ` +
+        `Geräte, die nach dem ${fmtDay(retrofit.value.installedUpTo)} eingebaut wurden, müssen es in der Regel schon seit ihrem Einbau sein (§ 5 Abs. 2). Bei fernablesbaren Geräten stehen den Mietern schon seit 2022 monatliche Verbrauchsinformationen zu (§ 6a HeizkostenV). ` +
+        `Fehlt das eine oder das andere, darf jeder Mieter seinen Anteil an den Heizkosten um ${remoteCut} % kürzen (§ 12 Abs. 1 HeizkostenV). ` +
         'Mietfuchs weiß nicht, welche Geräte bei Ihnen eingebaut sind. Prüfen Sie das bitte mit Ihrem Messdienst. Ausgenommen sind Einzelfälle, in denen die Nachrüstung technisch nicht möglich ist, unangemessen aufwendig wäre oder sonst eine unbillige Härte bedeutete (§ 5 Abs. 3 Satz 2), sowie die Fälle des § 11 HeizkostenV. ' +
         'Das gilt nicht für eine Gastherme in der Wohnung mit eigenem Gasvertrag des Mieters. ' +
         'Im Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, gilt das nur, wenn Sie nichts anderes vereinbart haben (§ 2 HeizkostenV).')
@@ -2545,23 +2561,30 @@ export function computeSettlement(snapshot: Snapshot, options: SettlementOptions
 
   // Nur Wohnungen, die im Jahr nicht nach Verbrauch gedeckt sind, dürfen kürzen: Eine
   // Grundkostenposition nach Fläche neben der Verbrauchsposition ist der Regelfall der Verordnung.
-  const heating = heatingFindings(items, snapshot.units.filter((u) => !outsideHeating(u)), heatingCovered)
+  // Die Grenzen 50 und 70 % (`hkv.consumption-share`) fragt heatingFindings nur ab, wenn es eine
+  // Wohnung mit Verbrauchs- und Grundkostenposition gibt.
+  const consumptionShare = () => law(hkvConsumptionShare, { period: lawPeriod }, lawLog)
+  const heating = heatingFindings(items, snapshot.units.filter((u) => !outsideHeating(u)), heatingCovered, consumptionShare)
   for (const { item, rows } of heatingCuts) {
     const affected = heating.withoutConsumption.get(item.id)
-    const cuts = rows.filter((r) => affected?.has(r.unitId)).map((r) => r.text)
-    if (cuts.length === 0) continue
+    const hit = rows.filter((r) => affected?.has(r.unitId))
+    if (hit.length === 0) continue
+    const share = consumptionShare()
+    const cut = law(hkvCutNotByConsumption, { period: lawPeriod }, lawLog)
     if (!heatingAgreeable) {
+      // Auf den Cent gerundet, kaufmännisch wie überall bei einer Einzelzahl.
+      const cuts = hit.map((r) => `${r.label} ${fmtCents(Math.round((r.share * cut) / 100))}`)
       warn('heating.not-by-consumption',
-        `„${item.description}“: Heizung und Warmwasser werden hier nicht nach Verbrauch verteilt. Die Heizkostenverordnung verlangt, mindestens 50 und höchstens 70 % nach dem erfassten Verbrauch zu verteilen, den Rest nach Fläche (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). ` +
-          `Sonst darf jeder Mieter seinen Anteil um 15 % kürzen (§ 12 Abs. 1 HeizkostenV), hier: ${andList(cuts)}. ` +
-          'Verteilen Sie 50 bis 70 % nach Verbrauch (eine Position nach Verbrauch mit Wärmezählern, den Rest als eigene Position nach Fläche) oder übernehmen Sie die Abrechnung des Messdienstes als Einzelbeträge.',
+        `„${item.description}“: Heizung und Warmwasser werden hier nicht nach Verbrauch verteilt. Die Heizkostenverordnung verlangt, mindestens ${share.min} und höchstens ${share.max} % nach dem erfassten Verbrauch zu verteilen, den Rest nach Fläche (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). ` +
+          `Sonst darf jeder Mieter seinen Anteil um ${cut} % kürzen (§ 12 Abs. 1 HeizkostenV), hier: ${andList(cuts)}. ` +
+          `Verteilen Sie ${hkvConsumptionShare.describe(share)} nach Verbrauch (eine Position nach Verbrauch mit Wärmezählern, den Rest als eigene Position nach Fläche) oder übernehmen Sie die Abrechnung des Messdienstes als Einzelbeträge.`,
         itemSubject(item))
     } else {
       // § 2: Hier darf anderes vereinbart werden, und ob es vereinbart ist, weiß Mietfuchs nicht.
       // Deshalb ein Hinweis ohne Betrag statt Schweigen.
       warn('heating.may-agree-otherwise',
         `„${item.description}“: Heizung und Warmwasser werden hier nicht nach Verbrauch verteilt. Im Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, darf anderes vereinbart werden (§ 2 HeizkostenV). ` +
-          'Die Heizkostenverordnung gilt hier, sofern im Mietvertrag nichts anderes vereinbart ist; dann sind 50 bis 70 % nach Verbrauch zu verteilen, und sonst darf der Mieter seinen Anteil um 15 % kürzen (§ 12 Abs. 1 HeizkostenV).',
+          `Die Heizkostenverordnung gilt hier, sofern im Mietvertrag nichts anderes vereinbart ist; dann sind ${hkvConsumptionShare.describe(share)} nach Verbrauch zu verteilen, und sonst darf der Mieter seinen Anteil um ${cut} % kürzen (§ 12 Abs. 1 HeizkostenV).`,
         itemSubject(item))
     }
   }
@@ -2571,8 +2594,9 @@ export function computeSettlement(snapshot: Snapshot, options: SettlementOptions
   for (const g of heating.shareOutside) {
     const names = andList(g.itemIds.map((id) => `„${items.find((c) => c.id === id)?.description ?? id}“`))
     const pct = Math.round((g.consumptionCents * 1000) / g.totalCents) / 10
+    const share = consumptionShare()
     warn('heating.consumption-share',
-      `Heizung und Warmwasser (${names}): nach Zählern verteilt werden ${fmtNum(pct)} % der Heizkosten. Die Heizkostenverordnung verlangt mindestens 50 und höchstens 70 % nach dem erfassten Verbrauch (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). Bitte die Aufteilung zwischen Verbrauchs- und Grundkosten prüfen.`,
+      `Heizung und Warmwasser (${names}): nach Zählern verteilt werden ${fmtNum(pct)} % der Heizkosten. Die Heizkostenverordnung verlangt mindestens ${share.min} und höchstens ${share.max} % nach dem erfassten Verbrauch (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). Bitte die Aufteilung zwischen Verbrauchs- und Grundkosten prüfen.`,
       itemSubject({ id: g.itemIds[0] ?? '' }))
   }
 
@@ -2658,11 +2682,12 @@ export function computeSettlement(snapshot: Snapshot, options: SettlementOptions
   const heatingFlat = partTenancies.filter((t) => (t.heatingModel ?? 'settlement') !== 'settlement' && !outsideHeating(t.unit))
   // Die Ausnahme steht in shared/heating.ts, für diese Warnung wie für die Verteilung (#140).
   if (heatingFlat.length > 0 && !heatingAgreeable && items.some((c) => c.category === HEATING_CATEGORY)) {
+    const cut = law(hkvCutNotByConsumption, { period: lawPeriod }, lawLog)
     warn('heating.flat-rate',
       `Für ${andList(heatingFlat.map((t) => `${t.tenantName} (${t.unit.name})`))} ist für Heizung und Warmwasser eine Pauschale oder Warmmiete vereinbart. ` +
         'Die Heizkostenverordnung geht der Vereinbarung vor (§ 2 HeizkostenV); zulässig ist das nur im Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen. ' +
         'Sonst wird der Heizanteil als Vorauszahlung behandelt, über die Sie nach Verbrauch abrechnen müssen (BGH VIII ZR 212/05). ' +
-        'Rechnen Sie trotzdem nicht nach Verbrauch ab, darf der Mieter seinen Anteil um 15 % kürzen (§ 12 Abs. 1 HeizkostenV).' +
+        `Rechnen Sie trotzdem nicht nach Verbrauch ab, darf der Mieter seinen Anteil um ${cut} % kürzen (§ 12 Abs. 1 HeizkostenV).` +
         // Die Einliegerwohnung (#116): Wer nur die vermietete Wohnung anlegt, hat womöglich
         // genau das Zweifamilienhaus der Ausnahme. Mietfuchs erkennt es an der eigenen Wohnung,
         // und die fehlt dann. Bei zwei oder mehr angelegten Wohnungen hülfe sie nicht mehr.
@@ -2693,13 +2718,15 @@ export function computeSettlement(snapshot: Snapshot, options: SettlementOptions
     totalCostsCents,
     notices,
     warnings: notices.map((n) => n.text),
-    // Der Rechtsstand (#112): Datum des Regelverzeichnisses und die Regeln des Jahres. Die
-    // abgeschlossene Abrechnung friert das Ergebnis wortgleich ein und damit auch ihn.
+    // Der Rechtsstand (#112): Datum des Rechtsregisters, die Regeln des Jahres und die Rechtswerte,
+    // mit denen gerechnet wurde (Heizung PR 1). Die abgeschlossene Abrechnung friert das Ergebnis
+    // wortgleich ein und damit auch ihn.
     legalBasis: {
-      asOf: RULES_AS_OF,
+      asOf: LAW_AS_OF,
       rules: rulesFor(yFrom, yTo).map(({ code, title, norm, validFrom, validTo }) => ({
         code, title, norm, ...(validFrom ? { validFrom } : {}), ...(validTo ? { validTo } : {}),
       })),
+      values: lawLog.values,
     },
   }
   const tenancyEnd = new Map(partTenancies.map((t) => [t.id, t.end]))
```

- [ ] **Step 5: Tests nachziehen, die den alten Stand benannt haben**

(a) `server/test/calc-leerstand-personen.test.ts`:

```diff
diff --git a/server/test/calc-leerstand-personen.test.ts b/server/test/calc-leerstand-personen.test.ts
index 8f3966d..5e89cd8 100644
--- a/server/test/calc-leerstand-personen.test.ts
+++ b/server/test/calc-leerstand-personen.test.ts
@@ -2,13 +2,16 @@
 // Vermieter (BGH, Urteil vom 31.05.2006, VIII ZR 159/05, entschieden am Flächenschlüssel). Beim
 // Personenschlüssel hatte die leere Wohnung 0 Personentage und fiel aus der Verteilbasis, ihr
 // Anteil ging also an die übrigen Mieter. Jetzt zählt sie für jeden Tag ohne Mietverhältnis mit
-// `VACANCY_PERSONS` Personen, und dieser Anteil bleibt beim Vermieter. Wie viele Personen das
-// sind, ist eine Auslegung von Mietfuchs und keine belegte Regel; die Rechnungen unten nehmen
-// deshalb die Konstante und nicht ihren heutigen Wert, und genau ein Test hält den Wert fest.
+// `practice.vacancy-persons` Personen (Rechtsregister, shared/law/practice.ts), und dieser Anteil
+// bleibt beim Vermieter. Wie viele Personen das sind, ist eine Auslegung von Mietfuchs und keine
+// belegte Regel; die Rechnungen unten nehmen deshalb den Wert aus dem Register und nicht seine
+// heutige Zahl, und genau ein Test hält die Zahl fest.
 
 import { test } from 'node:test'
 import assert from 'node:assert/strict'
-import { computeSettlement, occupiedDays, VACANCY_PERSONS, type ComputedSettlement } from '../src/calc.ts'
+import { computeSettlement, occupiedDays, type ComputedSettlement } from '../src/calc.ts'
+import { valueAt } from '../../shared/law/register.ts'
+import { practiceVacancyPersons } from '../../shared/law/practice.ts'
 import { compareWithFrozen } from '../src/settlementDiff.ts'
 import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
 import { assertLandlordParts } from '../testing/landlordParts.ts'
@@ -31,7 +34,7 @@ const shareOf = (s: ComputedSettlement, tenancyId: string): number => {
   return st.totalShareCents
 }
 
-const V = VACANCY_PERSONS
+const V = valueAt(practiceVacancyPersons, '2025-01-01')
 // Rohanteil kaufmännisch gerundet: Bei Leerstand schöpfen die Mieter die Summe nicht aus, dann
 // rundet die Berechnung je Anteil statt nach dem Restverfahren.
 const part = (amount: number, personDays: number, basis: number) => Math.round((amount * personDays) / basis)
@@ -44,7 +47,7 @@ function assertSound(s: ComputedSettlement, tenancyCount: number): void {
 }
 
 test('Leerstand: heute zählt ein Leerstandstag mit einer Person (Auslegung, #177)', () => {
-  assert.equal(VACANCY_PERSONS, 1)
+  assert.equal(V, 1)
 })
 
 test('Leerstand beim Personenschlüssel: eine ganzjährig leere Wohnung zählt mit, ihren Anteil trägt der Vermieter', () => {
```

(b) `server/test/calc-notices.test.ts`: Importzeile `import { RULES_AS_OF } from '../../shared/law/rules.ts'` ersetzen durch `import { LAW_AS_OF } from '../../shared/law/register.ts'`, und im Test „Rechtsstand“:

```diff
-test('Rechtsstand: Datum des Verzeichnisses und die Regeln, die im Jahr gelten', () => {
+test('Rechtsstand: Datum des Registers und die Regeln, die im Jahr gelten', () => {
   const lb = (year: number) => settle({ units: [unit('a')] }, year).legalBasis
-  assert.equal(lb(2025).asOf, RULES_AS_OF)
+  // Seit Heizung PR 1 das Datum des Rechtsregisters, das die Regeln einschließt
+  assert.equal(lb(2025).asOf, LAW_AS_OF)
```

(c) `server/test/api.test.ts`: Importzeile `import { RULES_AS_OF } from '../../shared/law/rules.ts'` ersetzen durch `import { LAW_AS_OF } from '../../shared/law/register.ts'`, und im Test „Abschließen friert Hinweise und Rechtsstand mit ein (#112)“ beide `RULES_AS_OF` durch `LAW_AS_OF` ersetzen.

- [ ] **Step 6: Tests ausführen**

Run: `npm --prefix server test -- test/calc-rechtswerte.test.ts test/law-wording.test.ts test/settlement-golden.test.ts test/calc-wortlaut.test.ts test/calc-heizkosten.test.ts test/calc-kabel.test.ts test/calc-leerstand-personen.test.ts test/rechtsdurchsicht-2026.test.ts test/calc-notices.test.ts`
Expected: `ℹ fail 0`. `law-wording` und die Golden-Tests sind der Beweis, dass kein Wort und keine Zahl wandert.

- [ ] **Step 7: Volle Prüfung und Commit**

Run: `npm --prefix server test && npm run typecheck`
Expected: `ℹ fail 0` (beim Durchspielen dieses Plans: 1.246 bestanden).

```bash
git add server/src/calc.ts shared/heating.ts server/test/calc-rechtswerte.test.ts server/test/calc-leerstand-personen.test.ts server/test/calc-notices.test.ts server/test/api.test.ts
git commit -m "Berechnung: Rechtszahlen aus dem Register, benutzte Werte in legalBasis.values" -m "Refs #97" -m "Refs #110"
```

---

### Task 5: Umsatzsteuer nach Rechnungsdatum aus dem Register

`vatExplainsGap` prüft, ob sich der Abstand zwischen Positionen und Rechnungsbetrag durch Umsatzsteuer erklären lässt (CLAUDE.md, „Rohe Antwort und Zusage“). Der Regelsatz kommt jetzt aus `ustg.standard-rate` mit der Zeitregel `eventDate`, und das Ereignis ist das Rechnungsdatum. Für eine Rechnung aus dem zweiten Halbjahr 2020 heißt das 16 % statt 19 %; das ist die einzige Verhaltensänderung dieser PR, sie betrifft einen KI-Vorschlag und keine Abrechnungszahl, und sie ist strenger: Wird nicht hochgerechnet, bleiben die Positionen, wie sie auf dem Beleg stehen.

**Files:**
- Modify: `server/src/invoiceAmounts.ts`
- Test: `server/test/invoiceAmounts.test.ts`

**Interfaces:**
- Consumes: `valueAt` (Task 2), `ustgStandardRate` (Task 3).
- Produces: `normalizeAmounts(extraction, today?: string)`; der zweite Parameter ist optional (Vorgabe: heute in UTC), `extract.ts` ruft weiter mit einem Argument auf.

- [ ] **Step 1: Failing tests anhängen**

Ans Ende von `server/test/invoiceAmounts.test.ts`:

```ts
// Der Regelsatz kommt aus dem Rechtsregister (`ustg.standard-rate`, Heizung PR 1) und richtet sich
// nach dem Rechnungsdatum: vom 01.07. bis 31.12.2020 waren es 16 %. Ein Abstand von 19 % ist dann
// nicht durch Umsatzsteuer erklärbar, es fehlt eher eine Position, und hochgerechnet wird nicht.
const net = (invoiceDate?: unknown) => ({
  totalGrossEur: 119,
  positionsAreNet: true,
  ...(invoiceDate !== undefined ? { invoiceDate } : {}),
  positions: [{ description: 'Wartung', category: 'Heizung und Warmwasser', amountEur: 100 }],
})

test('Umsatzsteuer nach Rechnungsdatum: 2025 erklären 19 % den Abstand, im zweiten Halbjahr 2020 nicht', () => {
  assert.equal(normalizeAmounts(net('2025-03-01'), '2026-10-05').amountsAdjusted, 'netto')
  assert.equal(normalizeAmounts(net('2020-08-15'), '2026-10-05').amountsAdjusted, undefined)
  assert.deepEqual(positionsOf(normalizeAmounts(net('2020-08-15'), '2026-10-05')).map((p) => p.amountEur), [100])
  // 16 % auf 100 € ergeben 116 €: erklärbar, auch 2020.
  assert.equal(normalizeAmounts({ ...net('2020-08-15'), totalGrossEur: 116 }, '2026-10-05').amountsAdjusted, 'netto')
})

test('Umsatzsteuer ohne lesbares Rechnungsdatum: es gilt der Satz von heute', () => {
  assert.equal(normalizeAmounts(net(), '2020-08-15').amountsAdjusted, undefined)
  assert.equal(normalizeAmounts(net(), '2026-10-05').amountsAdjusted, 'netto')
  assert.equal(normalizeAmounts(net('15.08.2020'), '2026-10-05').amountsAdjusted, 'netto')
  assert.equal(normalizeAmounts(net(20200815), '2026-10-05').amountsAdjusted, 'netto')
})
```

- [ ] **Step 2: Tests ausführen, sie müssen scheitern**

Run: `npm --prefix server test -- test/invoiceAmounts.test.ts`
Expected: FAIL in beiden neuen Tests: `'netto' !== undefined` bei `2020-08-15`.

- [ ] **Step 3: `server/src/invoiceAmounts.ts` ändern**

```diff
diff --git a/server/src/invoiceAmounts.ts b/server/src/invoiceAmounts.ts
index 432c9cf..138b640 100644
--- a/server/src/invoiceAmounts.ts
+++ b/server/src/invoiceAmounts.ts
@@ -14,6 +14,8 @@
 // erst nach Prüfung. `amountsAdjusted` und `laborFromTotal` sagen ihr, was gerechnet wurde.
 import type { Extraction } from '../../shared/types.ts'
 import { largestRemainder } from './calc.ts'
+import { valueAt } from '../../shared/law/register.ts'
+import { ustgStandardRate } from '../../shared/law/ustg.ts'
 
 // Eine Rechnungsposition, wie das Modell sie geliefert hat. Weitere Felder (Beschreibung,
 // Kategorie, …) fasst diese Funktion nicht an, deshalb bleiben sie über den Index-Zugriff nur
@@ -64,12 +66,17 @@ const toEur = (cents: number): number => Math.round(cents) / 100
 // Wie in der Schnellerfassung: kleine Abweichungen sind Rundung, keine fehlende Umsatzsteuer
 const tolerance = (totalCents: number): number => Math.max(50, Math.round(totalCents * 0.02))
 
-// Der Regelsatz der Umsatzsteuer, dazu eine halbe Prozentstelle für Rundung. Mehr als den
-// Regelsatz gibt es in Deutschland nicht; nach unten ist alles bis 0 möglich, weil eine Rechnung
-// ermäßigte (7 Prozent) und steuerfreie Anteile mischen kann.
-const VAT_PERCENT = 19
+// Der Regelsatz der Umsatzsteuer kommt aus dem Rechtsregister (`ustg.standard-rate`, Heizung
+// PR 1), dazu eine halbe Prozentstelle für Rundung. Mehr als den Regelsatz gibt es in Deutschland
+// nicht; nach unten ist alles bis 0 möglich, weil eine Rechnung ermäßigte und steuerfreie Anteile
+// mischen kann. Die halbe Stelle ist keine Rechtszahl, sondern Rechentoleranz.
 const VAT_ROUNDING_PERCENT = 0.5
 
+// Der Tag, nach dem sich der Regelsatz richtet: das Rechnungsdatum, wenn das Modell eines im
+// Format JJJJ-MM-TT geliefert hat, sonst heute. Zeitregel `eventDate` wie im Register.
+const rateDate = (invoiceDate: unknown, today: string): string =>
+  typeof invoiceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) ? invoiceDate : today
+
 // Lässt sich der Abstand zwischen Positionssumme und Rechnungsbetrag durch Umsatzsteuer
 // erklären? An dieser Frage hängt in diesem Modul alles, denn ein größerer Abstand heißt: Die
 // Positionen beschreiben nicht die ganze Rechnung, es fehlt eine.
@@ -83,10 +90,11 @@ const VAT_ROUNDING_PERCENT = 0.5
 // Ein Rechnungsbetrag unter der Positionssumme ist dagegen kein Zeichen für eine fehlende
 // Position, sondern für eine Abschlagszahlung, und ein gar nicht bekannter Rechnungsbetrag ist
 // überhaupt kein Zeichen. Beides blockt deshalb nicht.
-const vatExplainsGap = (positionCents: number, totalCents: number): boolean =>
-  positionCents > 0 && totalCents <= positionCents * (1 + (VAT_PERCENT + VAT_ROUNDING_PERCENT) / 100)
+const vatExplainsGap = (positionCents: number, totalCents: number, vatPercent: number): boolean =>
+  positionCents > 0 && totalCents <= positionCents * (1 + (vatPercent + VAT_ROUNDING_PERCENT) / 100)
 
-export function normalizeAmounts(extraction: RawExtraction | null | undefined) {
+// `today` als JJJJ-MM-TT, hineingereicht, damit der Test nicht vom Kalender abhängt.
+export function normalizeAmounts(extraction: RawExtraction | null | undefined, today: string = new Date().toISOString().slice(0, 10)) {
   // Die drei Hilfsfelder des Modells verlassen die Auswertung nicht. Mit `vatRatePercent`
   // gerechnet wird nicht mehr (siehe unten), abgetrennt wird es trotzdem: In der Oberfläche hat
   // es nichts verloren.
@@ -95,6 +103,7 @@ export function normalizeAmounts(extraction: RawExtraction | null | undefined) {
   result.positions = positions
   const keys = positions.map((_, i) => String(i))
   const totalCents = toCents(result.totalGrossEur) ?? 0
+  const vatPercent = valueAt(ustgStandardRate, rateDate(result.invoiceDate, today))
   // `null` heißt „nicht gelesen“ und ist etwas anderes als 0: Eine Position kann laut Rechnung
   // nichts kosten (mitversicherte Leistung, Gutschriftszeile), und dann stimmt alles.
   const netCents = positions.map((p) => toCents(p.amountEur))
@@ -120,7 +129,7 @@ export function normalizeAmounts(extraction: RawExtraction | null | undefined) {
   // Kostenseite gibt es ihn nicht, dort bleibt es beim Blick auf den Beleg.
   if (
     positionsAreNet === true && allNetRead
-    && netSum < totalCents - tolerance(totalCents) && vatExplainsGap(netSum, totalCents)
+    && netSum < totalCents - tolerance(totalCents) && vatExplainsGap(netSum, totalCents, vatPercent)
   ) {
     // Immer anteilig, nie mit einem genannten Steuersatz. Das Restverfahren normiert ohnehin auf
     // den Rechnungsbetrag, bei richtigem Satz kommt deshalb in jeder Position dasselbe heraus.
@@ -149,7 +158,7 @@ export function normalizeAmounts(extraction: RawExtraction | null | undefined) {
   const grossSum = readGross.reduce((a, b) => a + b, 0)
   if (
     laborTotal > 0 && !hasOwnLabor && allGrossRead
-    && vatExplainsGap(grossSum, totalCents) && laborTotal <= grossSum
+    && vatExplainsGap(grossSum, totalCents, vatPercent) && laborTotal <= grossSum
   ) {
     const parts = largestRemainder(laborTotal, readGross.map((c) => (c * laborTotal) / grossSum), keys)
     positions.forEach((p, i) => { p.labor35aEur = toEur(parts[i]) })
```

- [ ] **Step 4: Tests ausführen**

Run: `npm --prefix server test -- test/invoiceAmounts.test.ts test/extract.test.ts && npm run typecheck`
Expected: `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add server/src/invoiceAmounts.ts server/test/invoiceAmounts.test.ts
git commit -m "KI-Auswertung: Regelsatz der Umsatzsteuer aus dem Rechtsregister, nach Rechnungsdatum" -m "Refs #97" -m "Refs #110"
```

---

### Task 6: Wächter über Rechtszahlen, Lexikon, Anleitungen und Cockpit aus dem Register

**Files:**
- Create: `server/testing/sourceScan.ts` (Scanner aus `anrede.test.ts` herausgelöst)
- Modify: `server/test/anrede.test.ts`
- Create: `server/test/law-literals.test.ts`
- Modify: `shared/glossary.ts`, `shared/guides.ts`, `client/src/pages/Cockpit.tsx`

**Interfaces:**
- Consumes: `valueAt`, `LAW_AS_OF` (Task 2); `hkvConsumptionShare`, `hkvCutNotByConsumption`, `hkvCutRemoteReading` (Task 3).
- Produces: `scan(source: string, jsx?: boolean): { code: string; strings: Fragment[] }` und `interface Fragment { text: string; line: number; before: string }` in `server/testing/sourceScan.ts`.

Umfang des Wächters, abgeleitet aus 4.7: Prozentmuster in Zeichenketten und JSX-Text von `server/src`, `shared` (ohne `shared/law/`) und `client/src`; Datumsliterale (ISO und deutsch) in den Dateien der Berechnung, heute `calc.ts`, `snapshot.ts`, `shared/heating.ts`; `co2.ts`, `fuel.ts` und `period.ts` ergänzen die PRs, die sie anlegen. Zusätzlich zu den Mustern aus 4.7 steht `\d+ und höchstens \d+ ?%` darin, denn so formuliert calc.ts die 50/70. Erlaubte Stellen mit Grund: zwei Lexikonsätze ohne Rechtsfolge des Registers (100 Prozent als Summe der Quoten, 20 Prozent nach § 35a EStG), die CO₂-Kürzung in den Anleitungen (kommt mit PR 6 als `co2.cut.missing`), zwei Entscheidungsdaten im Zitat. Eine `/* Beispiel */`-Marke braucht heute keine Stelle: „70 % nach Verbrauch“ im Lexikon trifft kein Muster.

- [ ] **Step 1: Scanner herauslösen (reine Verschiebung, kein neues Verhalten)**

```bash
python3 - <<'PY'
p = 'server/test/anrede.test.ts'
s = open(p).read()
a = s.index('// Ein Textstück: eine Zeichenkette oder ein Stück JSX-Text.')
b = s.index('interface Finding {')
block = s[a:b].replace('interface Fragment', 'export interface Fragment').replace('function scan(', 'export function scan(')
head = (
    "// Ein kleiner Scanner für TypeScript und JSX, für Wächter, die Quelltext lesen: die Anrede\n"
    "// (anrede.test.ts) und die Rechtszahlen (law-literals.test.ts). Er liefert die Zeichenketten\n"
    "// samt JSX-Text, ohne Kommentare. Bis Heizung PR 1 stand er in anrede.test.ts.\n"
    "//\n"
    "// Liegt in testing/ und nicht in test/, weil `node --test` jede Datei unter test/ ausführt.\n\n"
)
open('server/testing/sourceScan.ts', 'w').write(head + block.rstrip() + '\n')
s = s[:a] + s[b:]
s = s.replace("import { fileURLToPath } from 'node:url'\n", "import { fileURLToPath } from 'node:url'\nimport { scan } from '../testing/sourceScan.ts'\n", 1)
open(p, 'w').write(s)
PY
npm --prefix server test -- test/anrede.test.ts && npm run typecheck
```

Expected: `ℹ pass 16`, `ℹ fail 0`, keine Typfehler.

- [ ] **Step 2: Failing test schreiben**

Datei `server/test/law-literals.test.ts`:

```ts
// Wächter über Rechtszahlen außerhalb des Rechtsregisters (Heizung PR 1, Entwurf 4.7). Eine
// Rechtszahl steht nur in shared/law/; überall sonst kommt sie von dort. Sonst kann ein Text
// „15 %“ sagen, während die Rechnung schon mit einem anderen Satz rechnet, oder ein Datum in einer
// Bedingung überleben, wenn das Register eine neue Fassung bekommt.
//
// Geprüft wird der Quelltext mit demselben Scanner wie die Anrede (testing/sourceScan.ts): nur
// Zeichenketten und JSX-Text, keine Kommentare, keine Prompts an das Modell. Zwei Prüfungen:
//
// - **Prozentangaben im Muster einer Rechtsfolge** („um 15 %“, „15 % kürzen“, „50 bis 70 %“,
//   „mindestens 50 und höchstens 70 %“, „15 Prozent“) in Server, Oberfläche und shared/, außer
//   shared/law/. Ein Prozentsatz, der über `${…}` eingesetzt wird, ist kein Literal und fällt
//   nicht auf; so bleiben Nutzerdaten wie die vereinbarten Anteile (`custom`) außen vor.
// - **Datumsliterale** (ISO und deutsch) in den Dateien der Berechnung. Spätere PRs ergänzen ihre
//   Dateien (co2.ts, fuel.ts, period.ts) in ENGINE_FILES.
//
// Erlaubte Stellen stehen unten benannt, jede mit Grund. Eine erlaubte Stelle, die es nicht mehr
// gibt, ist ein Fehler: Sonst bliebe die Ausnahme stehen und deckte später etwas anderes.
// Beispielrechnungen im Lexikon dürfen „70 % nach Verbrauch“ sagen; das trifft kein Muster.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scan } from '../testing/sourceScan.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const PERCENT_PATTERNS = [/um \d+ ?%/g, /\d+ ?% kürzen/g, /\d+ bis \d+ ?%/g, /\d+ und höchstens \d+ ?%/g, /\d+ Prozent/g]
const DATE_PATTERNS = [/\d{4}-\d{2}-\d{2}/g, /\d{2}\.\d{2}\.\d{4}/g]
const ENGINE_FILES = ['server/src/calc.ts', 'server/src/snapshot.ts', 'shared/heating.ts']

type Allowed = { file: string; match: string; reason: string }
const ALLOWED: readonly Allowed[] = [
  { file: 'shared/glossary.ts', match: '100 Prozent', reason: 'Summe vereinbarter Quoten, keine Rechtsfolge' },
  { file: 'shared/glossary.ts', match: '20 Prozent', reason: '§ 35a Abs. 2 EStG, Steuer des Mieters; kein Parameter des Entwurfs (4.3)' },
  { file: 'shared/guides.ts', match: '3 Prozent', reason: 'CO₂-Kürzung nach § 7 Abs. 4 CO2KostAufG; `co2.cut.missing` kommt mit PR 6 ins Register (4.3, G-C7)' },
  { file: 'server/src/calc.ts', match: '31.05.2006', reason: 'Datum einer Entscheidung im Zitat (BGH VIII ZR 159/05), kein Rechtswert' },
  { file: 'server/src/calc.ts', match: '08.01.2013', reason: 'Datum einer Entscheidung im Zitat (BGH VIII ZR 180/12), kein Rechtswert' },
]

type Finding = { file: string; line: number; match: string }

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { recursive: true })
    .map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('.d.ts'))
    .map((f) => path.join(dir, f).split(path.sep).join('/'))
}

// Die Textstücke eines Quelltexts ohne die Prompts an das Modell (wie in anrede.test.ts).
const textsOf = (source: string, jsx: boolean): { text: string; line: number }[] =>
  scan(source, jsx).strings.filter((s) => !/prompt\w*\s*[=:]\s*$/i.test(s.before))
const texts = (file: string) => textsOf(fs.readFileSync(path.join(ROOT, file), 'utf8'), file.endsWith('.tsx'))

const matchesIn = (file: string, fragments: { text: string; line: number }[], patterns: readonly RegExp[]): Finding[] =>
  fragments.flatMap((s) => patterns.flatMap((p) => [...s.text.matchAll(p)].map((m) => ({ file, line: s.line, match: m[0] }))))

function findings(files: readonly string[], patterns: readonly RegExp[]): Finding[] {
  return files.flatMap((file) => matchesIn(file, texts(file), patterns))
}

const percentFiles = (): string[] =>
  [...sourceFiles('server/src'), ...sourceFiles('shared'), ...sourceFiles('client/src')].filter((f) => !f.startsWith('shared/law/'))

const isAllowed = (f: Finding): boolean => ALLOWED.some((a) => a.file === f.file && f.match.includes(a.match))
const report = (list: Finding[]): string => list.map((f) => `${f.file}:${f.line}: „${f.match}“`).join('\n')

test('Rechtszahlen: keine Prozentangabe einer Rechtsfolge außerhalb des Registers', () => {
  const open = findings(percentFiles(), PERCENT_PATTERNS).filter((f) => !isAllowed(f))
  assert.equal(open.length, 0, `Rechtszahl als Literal, bitte aus shared/law/ nehmen:\n${report(open)}`)
})

test('Rechtszahlen: kein Datumsliteral in den Dateien der Berechnung', () => {
  for (const file of ENGINE_FILES) assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} gibt es nicht; die Liste ist veraltet`)
  const open = findings(ENGINE_FILES, DATE_PATTERNS).filter((f) => !isAllowed(f))
  assert.equal(open.length, 0, `Datum als Literal, bitte aus shared/law/ nehmen:\n${report(open)}`)
})

test('Rechtszahlen: jede erlaubte Stelle gibt es noch, und jede hat einen Grund', () => {
  const all = [...findings(percentFiles(), PERCENT_PATTERNS), ...findings(ENGINE_FILES, DATE_PATTERNS)]
  for (const a of ALLOWED) {
    assert.ok(a.reason.trim(), `${a.file}: „${a.match}“ ohne Grund`)
    assert.ok(all.some((f) => f.file === a.file && f.match.includes(a.match)), `erlaubte Stelle nicht mehr da: ${a.file} „${a.match}“`)
  }
})

// Der Wächter selbst: Fängt er, was er fangen soll, und lässt er durch, was er durchlassen muss?
test('Rechtszahlen-Wächter: erkennt die Muster und übersieht Kommentare, eingesetzte Werte und Prompts', () => {
  const sample = [
    "// Kommentar: um 15 % kürzen",
    "const a = 'darf der Mieter seinen Anteil um 15 % kürzen'",
    'const b = `mindestens 50 und höchstens 70 % nach Verbrauch`',
    'const c = `um ${cut} % kürzen`',
    "const d = '50 bis 70 Prozent'",
    'const PROMPT = `Kürze um 15 % kürzen`',
    "const e = 'gilt bis 30.06.2024 und ab 2027-01-01'",
  ].join('\n')
  const found = (patterns: readonly RegExp[]) => matchesIn('probe.ts', textsOf(sample, false), patterns).map((f) => `${f.line}:${f.match}`)
  assert.deepEqual(found(PERCENT_PATTERNS), ['2:um 15 %', '2:15 % kürzen', '3:50 und höchstens 70 %', '5:70 Prozent'])
  assert.deepEqual(found(DATE_PATTERNS), ['7:2027-01-01', '7:30.06.2024'])
})

// Ohne diese Probe könnte der Wächter grün sein, weil er gar keine Datei liest.
test('Rechtszahlen-Wächter: er liest Server, Oberfläche, shared/ und die Dateien der Berechnung', () => {
  const files = percentFiles()
  for (const f of ['server/src/calc.ts', 'client/src/pages/Cockpit.tsx', 'shared/glossary.ts', 'shared/guides.ts']) assert.ok(files.includes(f), `${f} fehlt`)
  assert.ok(!files.some((f) => f.startsWith('shared/law/')), 'das Register selbst ist ausgenommen')
  assert.ok(texts('server/src/calc.ts').length > 200, 'der Scanner findet in calc.ts kaum Texte')
})
```

- [ ] **Step 3: Test ausführen, er muss scheitern**

Run: `npm --prefix server test -- test/law-literals.test.ts`
Expected: FAIL im ersten Test mit genau diesen Fundstellen (calc.ts ist seit Task 4 sauber):

```
shared/glossary.ts:132: „70 Prozent“
shared/glossary.ts:133: „um 15 %“
shared/glossary.ts:133: „um 3 %“
shared/glossary.ts:133: „15 % kürzen“
shared/glossary.ts:133: „3 % kürzen“
shared/guides.ts:112: „70 Prozent“
shared/guides.ts:112: „15 Prozent“
shared/guides.ts:232: „15 Prozent“
shared/guides.ts:258: „70 Prozent“
shared/guides.ts:258: „15 Prozent“
client/src/pages/Cockpit.tsx:151: „um 15 %“
client/src/pages/Cockpit.tsx:151: „15 % kürzen“
```

Die übrigen vier Tests sind grün.

- [ ] **Step 4: Lexikon, Anleitungen und Cockpit umstellen**

```diff
diff --git a/client/src/pages/Cockpit.tsx b/client/src/pages/Cockpit.tsx
index 3a71de9..081ee67 100644
--- a/client/src/pages/Cockpit.tsx
+++ b/client/src/pages/Cockpit.tsx
@@ -5,6 +5,8 @@ import { cockpitSubtitle, itemsDetail, meterTypesInUse, tenanciesDetail, usesUni
 import { coverageCheck, filesByItem } from '../receipts'
 import { api, fmtEuro, fmtDate } from '../api'
 import { andList } from '../../../shared/wording.ts'
+import { hkvCutNotByConsumption } from '../../../shared/law/heizkostenv.ts'
+import { LAW_AS_OF, valueAt } from '../../../shared/law/register.ts'
 import { useYear } from '../year'
 import { useProperty, withProperty } from '../property'
 import { consentPending } from '../update'
@@ -148,7 +150,7 @@ export default function Cockpit({ units, tenancies, settings, reload, onNavigate
     if (meterTypes.size === 0 && heatingWithout.length > 0) {
       // #140: Heizung ohne Verbrauchsschlüssel. Ablesungen wären nötig, nicht entbehrlich.
       list.push({ title: 'Zählerstände', level: 'gelb', tab: 'kosten', cta: 'Heizkosten prüfen',
-        detail: `${andList(heatingWithout.map((c) => `„${c.description}“`))} ${heatingWithout.length === 1 ? 'wird' : 'werden'} nicht nach Verbrauch verteilt. Die Heizkostenverordnung verlangt das (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV); sonst darf der Mieter seinen Anteil um 15 % kürzen. Nötig sind Ablesungen der Wärmezähler oder die Abrechnung des Messdienstes.` })
+        detail: `${andList(heatingWithout.map((c) => `„${c.description}“`))} ${heatingWithout.length === 1 ? 'wird' : 'werden'} nicht nach Verbrauch verteilt. Die Heizkostenverordnung verlangt das (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV); sonst darf der Mieter seinen Anteil um ${valueAt(hkvCutNotByConsumption, LAW_AS_OF)} % kürzen. Nötig sind Ablesungen der Wärmezähler oder die Abrechnung des Messdienstes.` })
     } else if (meterTypes.size === 0) {
       list.push({ title: 'Zählerstände', level: 'leer',
         detail: 'Keine verbrauchsabhängige Umlage — Ablesungen nicht erforderlich.' })
diff --git a/shared/glossary.ts b/shared/glossary.ts
index 901e697..aae50b6 100644
--- a/shared/glossary.ts
+++ b/shared/glossary.ts
@@ -9,6 +9,16 @@
 // Maßstab für die Texte: einfache Worte, eine Rechtsaussage nur, wo sie im Gesetz steht, und
 // Rechtsprechung ohne Aktenzeichen, wenn das Aktenzeichen nicht sicher belegt ist. Wer einen
 // Eintrag ändert, prüft ihn bei der jährlichen Durchsicht mit (#110).
+//
+// Rechtszahlen kommen aus dem Rechtsregister (shared/law/, Heizung PR 1), und zwar in der Fassung
+// von `LAW_AS_OF`: Das Lexikon erklärt das geltende Recht. Die Zahlen einer Beispielrechnung („70 %
+// nach Verbrauch“) sind gewählt und bleiben stehen.
+import { hkvConsumptionShare, hkvCutNotByConsumption, hkvCutRemoteReading } from './law/heizkostenv.ts'
+import { LAW_AS_OF, valueAt } from './law/register.ts'
+
+const SHARE = valueAt(hkvConsumptionShare, LAW_AS_OF)
+const CUT = valueAt(hkvCutNotByConsumption, LAW_AS_OF)
+const REMOTE_CUT = valueAt(hkvCutRemoteReading, LAW_AS_OF)
 
 export type Term = {
   title: string
@@ -129,8 +139,8 @@ export const GLOSSARY = {
   },
   heatingCostOrdinance: {
     title: 'Heizkostenverordnung',
-    short: 'Heizkosten müssen zu 50 bis 70 Prozent nach Verbrauch verteilt werden, der Rest nach Fläche oder umbautem Raum; beim Warmwasser der Rest nur nach Fläche. Die Verordnung geht einer anderen Vereinbarung im Mietvertrag vor.',
-    example: '3.000 € Heizkosten, 70 % nach Verbrauch: 2.100 € nach den Messwerten, 900 € nach Wohnfläche. Wird nicht nach Verbrauch abgerechnet, etwa nur nach Fläche, darf der Mieter seinen Anteil um 15 % kürzen. Unabhängig davon darf er um 3 % kürzen, wenn Zähler nicht fernablesbar sind, obwohl sie es sein müssten (neue Geräte seit Dezember 2021, alle übrigen ab 2027), oder wenn die vorgeschriebenen Verbrauchsinformationen fehlen.',
+    short: `Heizkosten müssen zu ${SHARE.min} bis ${SHARE.max} Prozent nach Verbrauch verteilt werden, der Rest nach Fläche oder umbautem Raum; beim Warmwasser der Rest nur nach Fläche. Die Verordnung geht einer anderen Vereinbarung im Mietvertrag vor.`,
+    example: `3.000 € Heizkosten, 70 % nach Verbrauch: 2.100 € nach den Messwerten, 900 € nach Wohnfläche. Wird nicht nach Verbrauch abgerechnet, etwa nur nach Fläche, darf der Mieter seinen Anteil um ${CUT} % kürzen. Unabhängig davon darf er um ${REMOTE_CUT} % kürzen, wenn Zähler nicht fernablesbar sind, obwohl sie es sein müssten (neue Geräte seit Dezember 2021, alle übrigen ab 2027), oder wenn die vorgeschriebenen Verbrauchsinformationen fehlen.`,
     norm: '§§ 1, 2, 5, 6a, 7, 8, 11, 12 HeizkostenV',
     needed: 'Bei einer Zentralheizung, bei Fernwärme und bei zentraler Warmwasserbereitung, nicht bei einer Gastherme in der Wohnung mit eigenem Vertrag des Mieters. Im Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, dürfen Sie mit dem Mieter etwas anderes vereinbaren, etwa eine Warmmiete; ohne solche Vereinbarung gilt die Verordnung auch dort. Wenige weitere Ausnahmen nennt § 11, etwa wenn die Messung unverhältnismäßig teuer wäre. Wärmepumpen sind seit Oktober 2024 nicht mehr ausgenommen. Nicht fernablesbare Zähler und Heizkostenverteiler müssen bis zum 31.12.2026 nachgerüstet oder getauscht sein; klären Sie das bitte mit Ihrem Messdienst. Ab dem Abrechnungsjahr 2027 erinnert Mietfuchs in der Abrechnung daran.',
   },
diff --git a/shared/guides.ts b/shared/guides.ts
index 6800525..3edeee2 100644
--- a/shared/guides.ts
+++ b/shared/guides.ts
@@ -11,6 +11,14 @@
 // Oberfläche und muss dort wörtlich so stehen; der Test prüft das.
 
 import type { TermId } from './glossary.ts'
+// Rechtszahlen aus dem Rechtsregister (Heizung PR 1), in der Fassung von `LAW_AS_OF` wie im Lexikon.
+// Die CO₂-Kürzung von 3 Prozent folgt mit PR 6 (`co2.cut.missing`); bis dahin ist sie im Wächter
+// law-literals.test.ts als erlaubte Stelle benannt.
+import { hkvConsumptionShare, hkvCutNotByConsumption } from './law/heizkostenv.ts'
+import { LAW_AS_OF, valueAt } from './law/register.ts'
+
+const SHARE = valueAt(hkvConsumptionShare, LAW_AS_OF)
+const CUT = valueAt(hkvCutNotByConsumption, LAW_AS_OF)
 
 // Die Seiten, auf die eine Anleitung springen kann. Dieselben Kennungen wie die Navigation;
 // client/src/nav.ts prüft beim Übersetzen, dass jede davon dort vorkommt.
@@ -109,7 +117,7 @@ const GUIDE_DATA = {
     caveats: [
       { text: 'Ist im Mietvertrag kein Umlageschlüssel vereinbart, wird nach Wohnfläche umgelegt. Kosten, die von einem erfassten Verbrauch der Mieter abhängen, sind nach einem Maßstab umzulegen, der dem unterschiedlichen Verbrauch Rechnung trägt, also nach den Zählern.', norm: '§ 556a Abs. 1 Satz 1 und 2 BGB' },
       { text: 'Die Abrechnung muss dem Mieter spätestens bis zum Ablauf des zwölften Monats nach Ende des Abrechnungszeitraums zugehen; danach können Sie eine Nachzahlung in der Regel nicht mehr verlangen.', norm: '§ 556 Abs. 3 Satz 2 und 3 BGB' },
-      { text: 'Bei einer Zentralheizung sind mindestens 50 und höchstens 70 Prozent der Heiz- und Warmwasserkosten nach Verbrauch zu verteilen. Wird nicht nach Verbrauch abgerechnet, darf der Mieter seinen Anteil um 15 Prozent kürzen.', norm: '§ 7 Abs. 1, § 8 Abs. 1, § 12 Abs. 1 HeizkostenV' },
+      { text: `Bei einer Zentralheizung sind mindestens ${SHARE.min} und höchstens ${SHARE.max} Prozent der Heiz- und Warmwasserkosten nach Verbrauch zu verteilen. Wird nicht nach Verbrauch abgerechnet, darf der Mieter seinen Anteil um ${CUT} Prozent kürzen.`, norm: '§ 7 Abs. 1, § 8 Abs. 1, § 12 Abs. 1 HeizkostenV' },
       { text: 'Verwaltungskosten sowie Instandhaltung und Instandsetzung sind keine Betriebskosten; erfassen Sie sie als „Nicht umlagefähig“.', norm: '§ 1 Abs. 2 BetrKV' },
       { text: 'Fallen für die Heizung CO₂-Kosten an, sind sie zwischen Ihnen und dem Mieter nach dem CO₂-Ausstoß des Gebäudes aufzuteilen. Die Heizkostenabrechnung muss den Anteil des Mieters, die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen; fehlt das, darf der Mieter seinen Anteil an den Heizkosten um 3 Prozent kürzen. Mietfuchs rechnet das noch nicht (#97); nehmen Sie den Vermieteranteil aus der Abrechnung des Messdienstes.', norm: '§ 5 Abs. 2, § 7 Abs. 3 und 4 CO2KostAufG' },
     ],
@@ -229,7 +237,7 @@ const GUIDE_DATA = {
     caveats: [
       { text: 'Betriebskosten dürfen als Pauschale oder als Vorauszahlung vereinbart werden.', norm: '§ 556 Abs. 2 BGB' },
       { text: 'Eine Pauschale dürfen Sie nur erhöhen, wenn der Mietvertrag das vorsieht, durch Erklärung in Textform; sinken die Betriebskosten, ist sie ab dann herabzusetzen.', norm: '§ 560 Abs. 1 und 3 BGB' },
-      { text: 'Für Heizung und Warmwasser geht die Heizkostenverordnung einer Pauschale oder Warmmiete vor, außer im Gebäude mit nicht mehr als zwei Wohnungen, von denen Sie eine selbst bewohnen. Wird entgegen der Verordnung nicht nach Verbrauch abgerechnet, darf der Mieter seinen Anteil um 15 Prozent kürzen.', norm: '§ 2, § 12 Abs. 1 HeizkostenV' },
+      { text: `Für Heizung und Warmwasser geht die Heizkostenverordnung einer Pauschale oder Warmmiete vor, außer im Gebäude mit nicht mehr als zwei Wohnungen, von denen Sie eine selbst bewohnen. Wird entgegen der Verordnung nicht nach Verbrauch abgerechnet, darf der Mieter seinen Anteil um ${CUT} Prozent kürzen.`, norm: '§ 2, § 12 Abs. 1 HeizkostenV' },
     ],
     gaps: [
       { text: 'Mietfuchs vergleicht eine Pauschale nicht mit den tatsächlichen Kosten und rechnet keine Erhöhung oder Senkung vor; das tun Sie anhand des Vermieteranteils selbst.' },
@@ -255,7 +263,7 @@ const GUIDE_DATA = {
     ],
     example: 'Die Heizkostenabrechnung nennt 1.200 € für Wohnung A, 1.100 € für Wohnung B und 600 € für Ihre eigene Wohnung, zusammen 2.900 €. Vorher abgezogen hat der Messdienst unter „abzüglich CO₂-Kosten Vermieter“ 100 €, die Sie als Vermieter tragen. Bezahlt haben Sie also 3.000 €, und das ist der Betrag der Position. Die Mieter tragen 1.200 € und 1.100 €. Von den 100 € nennt die Einzelabrechnung Ihrer Wohnung 20,69 € als vom Vermieter übernommen (die Näherung 100 × 600 ÷ 2.900 ergäbe dasselbe); in ihr Feld kommen 620,69 €, Ihr Eigenanteil. Die übrigen 79,31 € bleiben als Rest beim Vermieter und stehen in der Steuerübersicht als Werbungskosten. Mit 2.900 € als Betrag fehlten sie dort.',
     caveats: [
-      { text: 'Bei einer Zentralheizung sind mindestens 50 und höchstens 70 Prozent der Kosten nach Verbrauch zu verteilen; das erledigt der Messdienst. Wird nicht nach Verbrauch abgerechnet, darf der Mieter um 15 Prozent kürzen.', norm: '§ 7 Abs. 1, § 8 Abs. 1, § 12 Abs. 1 HeizkostenV' },
+      { text: `Bei einer Zentralheizung sind mindestens ${SHARE.min} und höchstens ${SHARE.max} Prozent der Kosten nach Verbrauch zu verteilen; das erledigt der Messdienst. Wird nicht nach Verbrauch abgerechnet, darf der Mieter um ${CUT} Prozent kürzen.`, norm: '§ 7 Abs. 1, § 8 Abs. 1, § 12 Abs. 1 HeizkostenV' },
       { text: 'Beim Mieterwechsel muss eine Zwischenablesung stattfinden; melden Sie dem Messdienst den Auszug rechtzeitig.', norm: '§ 9b HeizkostenV' },
       { text: 'Fallen für die Heizung CO₂-Kosten an, sind sie zwischen Ihnen und dem Mieter nach dem CO₂-Ausstoß des Gebäudes aufzuteilen. Die Heizkostenabrechnung muss den Anteil des Mieters, die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen; fehlt das, darf der Mieter seinen Anteil an den Heizkosten um 3 Prozent kürzen. Die großen Messdienste teilen auf, wenn Sie ihnen die CO₂-Angaben Ihrer Brennstoffrechnung melden, und weisen die Angaben in ihrer Abrechnung aus; legen Sie sie dem Mieter mit Ihrer Abrechnung bei.', norm: '§ 5 Abs. 2, § 7 Abs. 3 und 4 CO2KostAufG' },
       { text: 'Weist die Abrechnung keinen CO₂-Anteil des Vermieters aus, fragen Sie beim Messdienst nach, bevor Sie abrechnen; selbst rechnet Mietfuchs die Aufteilung noch nicht (#97).' },
```

- [ ] **Step 5: Tests ausführen**

Run: `npm --prefix server test -- test/law-literals.test.ts test/law-wording.test.ts test/glossary.test.ts test/guides.test.ts test/anrede.test.ts test/rechtstexte.test.ts && npm run typecheck && npm --prefix client test -- Cockpit`
Expected: `ℹ fail 0` im Server; vitest ohne Fehlschlag. `law-wording` beweist, dass Lexikon und Anleitungen wortgleich sind.

- [ ] **Step 6: Commit**

```bash
git add server/testing/sourceScan.ts server/test/anrede.test.ts server/test/law-literals.test.ts shared/glossary.ts shared/guides.ts client/src/pages/Cockpit.tsx
git commit -m "Wächter: keine Rechtszahl außerhalb des Registers; Lexikon, Anleitungen und Cockpit lesen es" -m "Refs #97" -m "Refs #110"
```

---

### Task 7: Rechtswerte einfrieren, vergleichen und anzeigen

**Files:**
- Modify: `shared/types.ts` (`LawValueChange`, `SettlementComparison.valueChanges`)
- Modify: `server/src/settlementDiff.ts`, `server/src/store.ts`
- Modify: `client/src/deviation.ts`, `client/src/notices.ts`, `client/src/pages/Abrechnung.tsx`
- Test: `server/test/settlement-diff.test.ts`, `server/test/api.test.ts`, `client/src/deviation.test.ts`, `client/src/notices.test.ts`

**Interfaces:**
- Consumes: `AppliedValue`, `LegalBasis` (Task 2); `legalBasis.values` der Berechnung (Task 4).
- Produces:
  - `type LawValueChange = { id: string; title: string; frozenText: string; currentText: string }`
  - `SettlementComparison.valueChanges: LawValueChange[]` (Pflichtfeld, leer bei „nicht vergleichbar“, ohne eingefrorene Werte oder ohne Änderung)
  - `compareWithFrozen(frozen, current: { statements; legalBasis?: { values?: readonly AppliedValue[] } } | (() => …), year, today)`
  - `legalBasisLines(lb): { head: string, rules: string[], values: string[], valuesNote: string | null }`

Verglichen werden nur Werte, die auf beiden Seiten stehen und deren `value` (als JSON) verschieden ist. Ein Wert nur auf einer Seite ist eine Folge geänderter Daten, keine Rechtsänderung. Die Abrechnung zeigt die Werte im aufklappbaren Rechtsstand; eine Abrechnung von vor 0.11.0 sagt „Rechtswerte nicht gespeichert (vor 0.11.0)“ (4.4). Der Rechenweg je Zeile (#114) bleibt in PR 1 unverändert; dass er einen Wert nennt (4.8 Nr. 5), kommt mit den PRs, die neue Werte rechnen, denn hier würde es den Wortlaut ändern.

- [ ] **Step 1: Failing tests schreiben**

(a) `server/test/settlement-diff.test.ts`: im Test „Gleiche Salden: keine Abweichung“ die Erwartung um `valueChanges: []` ergänzen und ans Ende anhängen:

```diff
diff --git a/server/test/settlement-diff.test.ts b/server/test/settlement-diff.test.ts
index 3cd3de4..6345398 100644
--- a/server/test/settlement-diff.test.ts
+++ b/server/test/settlement-diff.test.ts
@@ -10,7 +10,7 @@ const statement = (tenancyId: string, balanceCents: number) => ({ tenancyId, ten
 
 test('Gleiche Salden: keine Abweichung', () => {
   const r = compareWithFrozen({ statements: [statement('t', 6667)] }, { statements: [statement('t', 6667)] }, 2025, '2026-10-01')
-  assert.deepEqual(r, { comparable: true, deviations: [], deadline: '2026-12-31', deadlinePassed: false })
+  assert.deepEqual(r, { comparable: true, deviations: [], valueChanges: [], deadline: '2026-12-31', deadlinePassed: false })
 })
 
 test('Mehr Guthaben heute: zugunsten des Mieters; weniger: zugunsten des Vermieters', () => {
@@ -49,3 +49,37 @@ test('Ein eingefrorener Stand, der sich nicht lesen lässt, ist nicht vergleichb
     assert.deepEqual(r.deviations, [])
   }
 })
+
+// ---------- Rechtswerte (Heizung PR 1, Entwurf 4.4) ----------
+
+const applied = (id: string, value: number, text: string) => ({ id, title: 'Kürzung bei nicht verbrauchsabhängiger Abrechnung', norm: '§ 12 Abs. 1 Satz 1 HeizkostenV', cite: '§ 12 Abs. 1 Satz 1 HeizkostenV', value, text })
+
+test('Rechtswerte: ein heute anderer Wert steht mit beiden Texten da, die Salden bleiben davon getrennt', () => {
+  const r = compareWithFrozen(
+    { statements: [statement('t', 0)], legalBasis: { asOf: '2026-10-05', rules: [], values: [applied('hkv.cut.not-by-consumption', 15, '15 %')] } },
+    { statements: [statement('t', 0)], legalBasis: { values: [applied('hkv.cut.not-by-consumption', 12, '12 %')] } },
+    2025, '2026-10-01',
+  )
+  assert.deepEqual(r.deviations, [])
+  assert.deepEqual(r.valueChanges, [{ id: 'hkv.cut.not-by-consumption', title: 'Kürzung bei nicht verbrauchsabhängiger Abrechnung', frozenText: '15 %', currentText: '12 %' }])
+})
+
+test('Rechtswerte: gleiche Werte, Werte auf nur einer Seite und Abschlüsse vor 0.11.0 ergeben keine Änderung', () => {
+  const now = { statements: [statement('t', 0)], legalBasis: { values: [applied('hkv.cut.not-by-consumption', 15, '15 %')] } }
+  const same = compareWithFrozen({ statements: [statement('t', 0)], legalBasis: { values: [applied('hkv.cut.not-by-consumption', 15, '15 %')] } }, now, 2025, '2026-10-01')
+  assert.deepEqual(same.valueChanges, [])
+  const onlyThen = compareWithFrozen({ statements: [statement('t', 0)], legalBasis: { values: [applied('practice.vacancy-persons', 1, '1 Person je Leerstandstag')] } }, now, 2025, '2026-10-01')
+  assert.deepEqual(onlyThen.valueChanges, [])
+  const old = compareWithFrozen({ statements: [statement('t', 0)], legalBasis: { asOf: '2026-10-02', rules: [] } }, now, 2025, '2026-10-01')
+  assert.deepEqual(old.valueChanges, [])
+  assert.equal(old.comparable, true)
+})
+
+test('Rechtswerte: ein unlesbarer eingefrorener Eintrag fällt weg, statt eine Änderung zu behaupten', () => {
+  const r = compareWithFrozen(
+    { statements: [statement('t', 0)], legalBasis: { values: [null, { id: 'hkv.cut.not-by-consumption', value: 15 }, 'kaputt'] } },
+    { statements: [statement('t', 0)], legalBasis: { values: [applied('hkv.cut.not-by-consumption', 12, '12 %')] } },
+    2025, '2026-10-01',
+  )
+  assert.deepEqual(r.valueChanges, [])
+})
```

(b) `server/test/api.test.ts`: im Test „Abschließen friert Hinweise und Rechtsstand mit ein (#112)“ nach `assert.ok(Array.isArray(Reflect.get(stand, 'rules')))` einfügen:

```ts
    assert.ok(Array.isArray(Reflect.get(stand, 'values')), 'seit Heizung PR 1 frieren die Rechtswerte mit ein')
```

und direkt vor dem Test „Abgeschlossenes Jahr: weicht die heutige Berechnung ab, sagt die Antwort es je Mieter (#56)“ einfügen:

```ts
test('Abschließen friert die Rechtswerte ein, und direkt danach weicht keiner ab (Heizung PR 1)', async () => {
  const u = await srv.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'Recht', areaM2: 50, participates: true }) })
  await srv.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({
    unitId: u.id, tenantName: 'Rechtswert', persons: 1, personHistory: [], start: '2049-01-01', end: '2049-12-31',
    prepayments: [], prepaymentOverrides: {}, baseRents: [],
  }) })
  await srv.api('/api/costItems', { method: 'POST', body: JSON.stringify({ year: 2049, category: 'Heizung und Warmwasser', description: 'Heizöl', amountCents: 50000, key: 'area' }) })
  await srv.api('/api/settlement/2049/close', { method: 'POST', body: JSON.stringify({}) })
  try {
    const gespeichert = (await closedOf(srv, 2049))?.settlement
    if (!gespeichert || typeof gespeichert !== 'object') return assert.fail('keine eingefrorene Abrechnung')
    const values = Reflect.get(Reflect.get(gespeichert, 'legalBasis'), 'values')
    if (!Array.isArray(values)) return assert.fail('keine Rechtswerte eingefroren')
    const cut = values.find((v) => Reflect.get(v, 'id') === 'hkv.cut.not-by-consumption')
    assert.equal(Reflect.get(cut, 'text'), '15 %')
    const geliefert = await srv.api<Settlement>('/api/settlement/2049')
    assert.ok(geliefert.legalBasis?.values?.some((v) => v.id === 'hkv.cut.not-by-consumption'))
    assert.deepEqual(geliefert.deviation?.valueChanges, [])
  } finally {
    await srv.api('/api/settlement/2049/close', { method: 'DELETE' })
  }
})
```

(c) Client-Tests:

```diff
diff --git a/client/src/deviation.test.ts b/client/src/deviation.test.ts
index bc484b4..a5247d6 100644
--- a/client/src/deviation.test.ts
+++ b/client/src/deviation.test.ts
@@ -2,7 +2,7 @@ import { describe, expect, test } from 'vitest'
 import { deviationView } from './deviation'
 import type { SettlementComparison } from './types'
 
-const cmp = (over: Partial<SettlementComparison>): SettlementComparison => ({ comparable: true, deviations: [], deadline: '2026-12-31', deadlinePassed: false, ...over })
+const cmp = (over: Partial<SettlementComparison>): SettlementComparison => ({ comparable: true, deviations: [], valueChanges: [], deadline: '2026-12-31', deadlinePassed: false, ...over })
 
 describe('Abweichung eines abgeschlossenen Jahres (#56)', () => {
   test('ohne Abweichung: nichts zu sagen', () => {
@@ -31,4 +31,15 @@ describe('Abweichung eines abgeschlossenen Jahres (#56)', () => {
     expect(deviationView(cmp({ comparable: false }))?.title).toBe('Vergleich mit der heutigen Berechnung nicht möglich')
     expect(deviationView(cmp({ deviations: [{ tenancyId: 'n', tenantName: 'Neu', unitName: 'OG', frozenBalanceCents: null, currentBalanceCents: -500, differenceCents: -500, direction: 'added' }] }))?.title).toBe('Die heutige Berechnung weicht vom abgeschlossenen Stand ab')
   })
+
+  // Heizung PR 1: ein geänderter Rechtswert, allein oder neben einer Abweichung der Salden
+  test('Rechtswert geändert: eigene Zeile, allein mit eigenem Titel', () => {
+    const change = { id: 'hkv.cut.not-by-consumption', title: 'Kürzung bei nicht verbrauchsabhängiger Abrechnung', frozenText: '15 %', currentText: '12 %' }
+    const allein = deviationView(cmp({ valueChanges: [change] }))
+    expect(allein?.title).toBe('Rechtswerte seit dem Abschluss geändert')
+    expect(allein?.lines).toEqual([{ id: 'law:hkv.cut.not-by-consumption', text: 'Rechtswert geändert: Kürzung bei nicht verbrauchsabhängiger Abrechnung von 15 % auf 12 %.' }])
+    const mit = deviationView(cmp({ valueChanges: [change], deviations: [{ tenancyId: 't', tenantName: 'Meier', unitName: 'EG', frozenBalanceCents: 0, currentBalanceCents: 100, differenceCents: 100, direction: 'tenant' }] }))
+    expect(mit?.title).toBe('Die heutige Berechnung weicht vom abgeschlossenen Stand ab')
+    expect(mit?.lines.map((l) => l.id)).toEqual(['t', 'law:hkv.cut.not-by-consumption'])
+  })
 })
diff --git a/client/src/notices.test.ts b/client/src/notices.test.ts
index b44435e..704c538 100644
--- a/client/src/notices.test.ts
+++ b/client/src/notices.test.ts
@@ -51,10 +51,21 @@ describe('Hinweise (#112)', () => {
     ] })).toEqual({
       head: 'Rechtsstand 30.09.2026',
       rules: ['Kabelfernsehen (§ 2 BetrKV), gilt bis 30.06.2024', 'Heizung (§ 2 HeizkostenV)'],
+      values: [],
+      valuesNote: 'Rechtswerte nicht gespeichert (vor 0.11.0)',
     })
     expect(legalBasisLines(undefined).head).toMatch(/nicht erfasst/)
     expect(legalBasisLines(undefined).rules).toEqual([])
   })
+
+  test('Rechtsstand: die Rechtswerte, mit denen gerechnet wurde, je eine Zeile mit Fundstelle (Heizung PR 1)', () => {
+    const lines = legalBasisLines({ asOf: '2026-10-05', rules: [], values: [
+      { id: 'hkv.cut.not-by-consumption', title: 'Kürzung bei nicht verbrauchsabhängiger Abrechnung', norm: '§ 12 Abs. 1 Satz 1 HeizkostenV', cite: '§ 12 Abs. 1 Satz 1 HeizkostenV', value: 15, text: '15 %' },
+    ] })
+    expect(lines.values).toEqual(['Kürzung bei nicht verbrauchsabhängiger Abrechnung: 15 % (§ 12 Abs. 1 Satz 1 HeizkostenV)'])
+    expect(lines.valuesNote).toBeNull()
+    expect(legalBasisLines({ asOf: '2026-10-05', rules: [], values: [] }).valuesNote).toBeNull()
+  })
 })
 
 // #135: 0 m² und 0 Personen sind Angaben (Garage, Stellplatz); ihr Hinweis soll die Cockpit-Ampel
```

- [ ] **Step 2: Tests ausführen, sie müssen scheitern**

Run: `npm --prefix server test -- test/settlement-diff.test.ts && npm --prefix client test -- deviation notices`
Expected: Server FAIL (`valueChanges` fehlt in der Antwort); Client FAIL (`valueChanges` fehlt im Typ: Typfehler in `deviation.test.ts`, und `values`/`valuesNote` fehlen in `legalBasisLines`).

- [ ] **Step 3: Typen in `shared/types.ts`**

Direkt vor `export type SettlementComparison = {` einfügen:

```ts
// Ein Rechtswert, der heute anders lautet als beim Abschluss (Heizung PR 1, Entwurf 4.4): Das
// Register hat eine neue Fassung bekommen, etwa nach einer Berichtigung. Die Texte stammen aus der
// eingefrorenen und aus der heutigen Abrechnung.
export type LawValueChange = { id: string; title: string; frozenText: string; currentText: string }
```

und in `SettlementComparison` nach `deviations: SettlementDeviation[]`:

```ts
  // Leer, wenn nichts abweicht oder der eingefrorene Stand keine Rechtswerte kennt (vor 0.11.0).
  valueChanges: LawValueChange[]
```

- [ ] **Step 4: Server**

`server/src/settlementDiff.ts`:

```diff
diff --git a/server/src/settlementDiff.ts b/server/src/settlementDiff.ts
index b0fbd21..f8cd230 100644
--- a/server/src/settlementDiff.ts
+++ b/server/src/settlementDiff.ts
@@ -8,9 +8,39 @@
 // sich nicht lesen, ist das Ergebnis „nicht vergleichbar“ und nicht „keine Abweichung“, denn das
 // zweite wäre eine Auskunft, die niemand geprüft hat.
 
-import type { SettlementComparison, SettlementDeviation } from '../../shared/types.ts'
+import type { AppliedValue, LawValueChange, SettlementComparison, SettlementDeviation } from '../../shared/types.ts'
 
 type Saldo = { tenancyId: string, tenantName: string, unitName: string, balanceCents: number }
+type Current = { statements: Saldo[], legalBasis?: { values?: readonly AppliedValue[] } }
+type FrozenValue = { id: string, title: string, text: string, value: unknown }
+
+// Die eingefrorenen Rechtswerte (Heizung PR 1). Fehlt das Feld, wurde vor 0.11.0 abgeschlossen;
+// dann gibt es nichts zu vergleichen. Ein Eintrag, der sich nicht lesen lässt, fällt weg, statt
+// eine Änderung zu behaupten.
+function readValues(value: unknown): FrozenValue[] {
+  if (value === null || typeof value !== 'object') return []
+  const basis = Reflect.get(value, 'legalBasis')
+  if (basis === null || typeof basis !== 'object') return []
+  const values = Reflect.get(basis, 'values')
+  if (!Array.isArray(values)) return []
+  return values.flatMap((v): FrozenValue[] => {
+    if (v === null || typeof v !== 'object') return []
+    const id = Reflect.get(v, 'id')
+    const title = Reflect.get(v, 'title')
+    const text = Reflect.get(v, 'text')
+    return typeof id === 'string' && typeof title === 'string' && typeof text === 'string' ? [{ id, title, text, value: Reflect.get(v, 'value') }] : []
+  })
+}
+
+// Nur Werte, die auf beiden Seiten stehen und verschieden sind. Ein Wert, den nur eine Seite
+// benutzt, ist eine Folge geänderter Daten und keine Änderung des Rechts.
+function valueChanges(frozen: FrozenValue[], current: readonly AppliedValue[]): LawValueChange[] {
+  return frozen.flatMap((f) => {
+    const now = current.find((c) => c.id === f.id)
+    if (!now || JSON.stringify(now.value) === JSON.stringify(f.value)) return []
+    return [{ id: f.id, title: f.title, frozenText: f.text, currentText: now.text }]
+  })
+}
 
 function readStatements(value: unknown): Saldo[] | null {
   if (value === null || typeof value !== 'object') return null
@@ -32,17 +62,17 @@ function readStatements(value: unknown): Saldo[] | null {
 // `today` als JJJJ-MM-TT, hineingereicht, damit der Test nicht vom Kalender abhängt.
 // `current` darf auch eine Funktion sein, die rechnet: Scheitert die heutige Berechnung, bleibt der
 // eingefrorene Stand trotzdem lesbar, und das Ergebnis heißt „nicht vergleichbar“.
-export function compareWithFrozen(frozen: unknown, currentOrCompute: { statements: Saldo[] } | (() => { statements: Saldo[] }), year: number, today: string): SettlementComparison {
+export function compareWithFrozen(frozen: unknown, currentOrCompute: Current | (() => Current), year: number, today: string): SettlementComparison {
   // § 556 Abs. 3 BGB: zwölf Monate nach Ende des Abrechnungszeitraums, hier des Kalenderjahres.
   const deadline = `${year + 1}-12-31`
   const deadlinePassed = today > deadline
   const before = readStatements(frozen)
-  if (!before) return { comparable: false, deviations: [], deadline, deadlinePassed }
-  let current: { statements: Saldo[] }
+  if (!before) return { comparable: false, deviations: [], valueChanges: [], deadline, deadlinePassed }
+  let current: Current
   try {
     current = typeof currentOrCompute === 'function' ? currentOrCompute() : currentOrCompute
   } catch {
-    return { comparable: false, deviations: [], deadline, deadlinePassed }
+    return { comparable: false, deviations: [], valueChanges: [], deadline, deadlinePassed }
   }
   const now = new Map(current.statements.map((s) => [s.tenancyId, s]))
   const then = new Map(before.map((s) => [s.tenancyId, s]))
@@ -66,5 +96,5 @@ export function compareWithFrozen(frozen: unknown, currentOrCompute: { statement
       direction: !a ? 'added' : !b ? 'removed' : difference > 0 ? 'tenant' : 'landlord',
     })
   }
-  return { comparable: true, deviations, deadline, deadlinePassed }
+  return { comparable: true, deviations, valueChanges: valueChanges(readValues(frozen), current.legalBasis?.values ?? []), deadline, deadlinePassed }
 }
```

`server/src/store.ts`:

```diff
diff --git a/server/src/store.ts b/server/src/store.ts
index 4028288..4ff2e8d 100644
--- a/server/src/store.ts
+++ b/server/src/store.ts
@@ -3,7 +3,7 @@ import os from 'node:os'
 import path from 'node:path'
 import crypto from 'node:crypto'
 import { fileURLToPath } from 'node:url'
-import type { CostItem, CostKey, Meter, Payment, Reading, Settings, Tenancy, Unit } from '../../shared/types.ts'
+import type { CostItem, CostKey, LegalBasis, Meter, Payment, Reading, Settings, Tenancy, Unit } from '../../shared/types.ts'
 import type { ComputedSettlement } from './calc.ts'
 import { migrateLegacy } from './legacy/migrate.ts'
 import { systemLocation, writable } from './paths.ts'
@@ -93,14 +93,15 @@ const DB_FILE = path.join(DATA_DIR, 'db.json')
 // `?? 0`, bevor die Steuerübersicht den Wert bekommt. `closed` gehört ohnehin nicht dazu, das
 // ergänzt erst das Lesen in index.ts.
 // `notSettled` (#93), `notices` und `legalBasis` (#112) ebenso optional: Eine vorher
-// abgeschlossene Abrechnung kennt sie nicht.
+// abgeschlossene Abrechnung kennt sie nicht. Aus demselben Grund ist `legalBasis` hier die Form aus
+// shared/types.ts mit optionalen `values` und nicht die frisch gerechnete (Heizung PR 1).
 export type StoredSettlement = Omit<ComputedSettlement, 'selfUsedShareCents' | 'notSettled' | 'notices' | 'legalBasis' | 'garageLikeUnitIds'> & {
   selfUsedShareCents?: number
   // vor #135 abgeschlossene Abrechnungen kennen die Einstufung nicht
   garageLikeUnitIds?: ComputedSettlement['garageLikeUnitIds']
   notSettled?: ComputedSettlement['notSettled']
   notices?: ComputedSettlement['notices']
-  legalBasis?: ComputedSettlement['legalBasis']
+  legalBasis?: LegalBasis
 }
 
 // Die Gestalt der db.json: Fachdaten je Collection plus abgeschlossene Abrechnungen.
```

- [ ] **Step 5: Client**

```diff
diff --git a/client/src/deviation.ts b/client/src/deviation.ts
index e82c31d..4c89955 100644
--- a/client/src/deviation.ts
+++ b/client/src/deviation.ts
@@ -21,13 +21,26 @@ export function deviationView(cmp: SettlementComparison | undefined): DeviationV
       lines: [],
     }
   }
-  if (cmp.deviations.length === 0) return null
+  // Ein geänderter Rechtswert (Heizung PR 1): ein neuer Stand des Rechtsregisters, etwa nach einer
+  // Berichtigung. Er steht unter den Salden, und allein bekommt er einen eigenen Titel, denn dann
+  // ergibt die heutige Berechnung dieselben Zahlen.
+  const valueLines = cmp.valueChanges.map((v) => ({ id: `law:${v.id}`, text: `Rechtswert geändert: ${v.title} von ${v.frozenText} auf ${v.currentText}.` }))
+  if (cmp.deviations.length === 0 && valueLines.length === 0) return null
+  if (cmp.deviations.length === 0) {
+    return {
+      title: 'Rechtswerte seit dem Abschluss geändert',
+      intro:
+        'Seit dem Abschluss hat sich ein Rechtswert geändert, mit dem diese Abrechnung gerechnet wurde. Die heutige Berechnung ergibt für die Mieter dieselben Salden. ' +
+        'Die verschickte Abrechnung bleibt, wie sie ist.',
+      lines: valueLines,
+    }
+  }
   return {
     title: 'Die heutige Berechnung weicht vom abgeschlossenen Stand ab',
     intro:
       'Die heutige Berechnung ergibt für dieses abgeschlossene Jahr andere Zahlen, weil sich seit dem Abschluss Daten oder die Berechnung von Mietfuchs geändert haben. ' +
       'Die verschickte Abrechnung bleibt, wie sie ist; ob Sie eine korrigierte verschicken, entscheiden Sie.',
-    lines: cmp.deviations.map((d) => {
+    lines: [...cmp.deviations.map((d) => {
       const who = `${d.tenantName} (${d.unitName})`
       // Nur auf einer Seite: nichts nachgerechnet, also auch kein Urteil über die Richtung.
       if (d.direction === 'added') return { id: d.tenancyId, text: `${who}: kam nach dem Abschluss hinzu, heute ${saldo(d.currentBalanceCents)}.` }
@@ -43,6 +56,6 @@ export function deviationView(cmp: SettlementComparison | undefined): DeviationV
           ? `${head} — ${amount} zugunsten des Vermieters. Die Frist ist abgelaufen (${fmtDate(cmp.deadline)}); eine Korrektur zulasten des Mieters (Nachforderung oder geringeres Guthaben) ist in der Regel ausgeschlossen (§ 556 Abs. 3 BGB).`
           : `${head} — ${amount} zugunsten des Vermieters. Eine korrigierte Abrechnung zulasten des Mieters (Nachforderung oder geringeres Guthaben) ist bis zum ${fmtDate(cmp.deadline)} noch möglich, wenn sie ihm bis dahin zugeht.`,
       }
-    }),
+    }), ...valueLines],
   }
 }
diff --git a/client/src/notices.ts b/client/src/notices.ts
index 1a81e3a..cefedba 100644
--- a/client/src/notices.ts
+++ b/client/src/notices.ts
@@ -85,16 +85,19 @@ export function noticeTarget(subject: NoticeSubject | undefined): { tab: NoticeT
   return { tab: target.tab, label: `Hier beheben → ${target.page}`, focus: { kind: subject.kind, id: subject.id } }
 }
 
-// Der Rechtsstand als Kopfzeile und eine Zeile je Regel. Fehlt er, wurde die Abrechnung
-// abgeschlossen, bevor Mietfuchs ihn festhielt; das steht dann ausdrücklich da, statt dass
+// Der Rechtsstand als Kopfzeile, eine Zeile je Regel und eine je Rechtswert, mit dem gerechnet
+// wurde (Heizung PR 1). Fehlt der Rechtsstand, wurde die Abrechnung abgeschlossen, bevor Mietfuchs
+// ihn festhielt; fehlen nur die Werte, vor 0.11.0. Beides steht dann ausdrücklich da, statt dass
 // die Zeile verschwindet.
-export function legalBasisLines(legalBasis: LegalBasis | undefined): { head: string, rules: string[] } {
-  if (!legalBasis) return { head: 'Rechtsstand nicht erfasst: Diese Abrechnung wurde abgeschlossen, bevor Mietfuchs ihn festhielt.', rules: [] }
+export function legalBasisLines(legalBasis: LegalBasis | undefined): { head: string, rules: string[], values: string[], valuesNote: string | null } {
+  if (!legalBasis) return { head: 'Rechtsstand nicht erfasst: Diese Abrechnung wurde abgeschlossen, bevor Mietfuchs ihn festhielt.', rules: [], values: [], valuesNote: null }
   return {
     head: `Rechtsstand ${fmtDate(legalBasis.asOf)}`,
     rules: legalBasis.rules.map((r) => {
       const range = [r.validFrom && `ab ${fmtDate(r.validFrom)}`, r.validTo && `bis ${fmtDate(r.validTo)}`].filter(Boolean).join(' ')
       return `${r.title} (${r.norm})${range ? `, gilt ${range}` : ''}`
     }),
+    values: (legalBasis.values ?? []).map((v) => `${v.title}: ${v.text} (${v.cite})`),
+    valuesNote: legalBasis.values ? null : 'Rechtswerte nicht gespeichert (vor 0.11.0)',
   }
 }
diff --git a/client/src/pages/Abrechnung.tsx b/client/src/pages/Abrechnung.tsx
index fbcf50e..272eb49 100644
--- a/client/src/pages/Abrechnung.tsx
+++ b/client/src/pages/Abrechnung.tsx
@@ -327,6 +327,13 @@ export default function Abrechnung({ settings, tenancies, reload, onNavigate }:
             ) : (
               data.legalBasis && <p>Für dieses Jahr wendet Mietfuchs keine besondere Rechtsregel an.</p>
             )}
+            {basis.values.length > 0 && (
+              <>
+                <p>Angewandte Rechtswerte:</p>
+                <ul>{basis.values.map((v) => <li key={v}>{v}</li>)}</ul>
+              </>
+            )}
+            {basis.valuesNote && <p>{basis.valuesNote}</p>}
           </details>
         )
       })()}
```

- [ ] **Step 6: Tests ausführen**

Run: `npm --prefix server test -- test/settlement-diff.test.ts test/api.test.ts && npm --prefix client test -- deviation notices && npm run typecheck`
Expected: `ℹ fail 0`; vitest ohne Fehlschlag.

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts server/src/settlementDiff.ts server/src/store.ts server/test/settlement-diff.test.ts server/test/api.test.ts client/src/deviation.ts client/src/deviation.test.ts client/src/notices.ts client/src/notices.test.ts client/src/pages/Abrechnung.tsx
git commit -m "Abrechnung: Rechtswerte einfrieren, mit dem heutigen Stand vergleichen und anzeigen" -m "Refs #97" -m "Refs #110"
```

---

### Task 8: Doku und Abschlussprüfung

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: alles Vorige.
- Produces: nichts Neues im Code.

- [ ] **Step 1: CHANGELOG**

In `CHANGELOG.md` unter `## [Unveröffentlicht]` einen Abschnitt `### Geändert` anlegen (oder ergänzen) mit:

```markdown
- **Rechtsregister.** Jede Rechtszahl, mit der Mietfuchs rechnet oder die es nennt (Kabel-TV bis
  30.06.2024, 50 bis 70 % nach Verbrauch, die Kürzungen um 15 % und 3 %, die Fernablesbarkeit ab
  2027, ein Leerstandstag mit einer Person, der Regelsatz der Umsatzsteuer), steht jetzt an einer
  Stelle, mit Gültigkeit und Fundstelle. Eine abgeschlossene Abrechnung friert die Werte ein, mit
  denen sie gerechnet wurde; die Abrechnung zeigt sie unter „Rechtsstand“, und weicht ein Wert
  später ab, sagt es der Vergleich mit der heutigen Berechnung. Abgeschlossene Abrechnungen
  bleiben unverändert; bei einer Abrechnung von vor dieser Version steht „Rechtswerte nicht
  gespeichert“. Keine Zahl und kein Text einer Abrechnung ändert sich.
  ([#97](https://github.com/speedone/mietfuchs/issues/97), [#110](https://github.com/speedone/mietfuchs/issues/110))
- **KI-Belegauswertung:** Ob der Abstand zwischen Positionen und Rechnungsbetrag Umsatzsteuer
  ist, misst Mietfuchs jetzt am Satz des Rechnungsdatums, für das zweite Halbjahr 2020 also an
  16 %. Passt der Abstand nicht, bleiben die Positionen wie auf dem Beleg stehen.
```

- [ ] **Step 2: CLAUDE.md**

Den Absatz, der mit „Rechtsregeln mit Gültigkeit stehen in [server/src/rules.ts]“ beginnt und mit „setzt `RULES_AS_OF` auf den Tag der Durchsicht (#110).“ endet, ersetzen durch:

```markdown
**Rechtsregister** (Heizung PR 1, Entwurf `2026-10-05-heizung-gesamt-design.md` Abschnitt 4):
Jede Rechtszahl steht nur in [shared/law/](shared/law/), mit Gültigkeit, Fundstelle, Prüfstand und
**genau einer Zeitregel** (`periodStart`, `overlap`, `eventDate`; braucht ein Fall zwei, sind es
zwei Parameter). Abgefragt wird mit `law(param, ctx, log)` aus
[shared/law/register.ts](shared/law/register.ts); die Berechnung legt je Abrechnung ein Protokoll
an (`createLawLog`, kein globaler Zustand), fragt erst dort, wo ein Wert gebraucht wird, und legt
die benutzten Werte in `legalBasis.values`. Sie frieren mit dem Abschluss ein, `deviation` meldet
einen später geänderten Wert in `valueChanges`. Texte außerhalb einer Abrechnung (Lexikon,
Anleitungen, Cockpit) lesen `valueAt(param, LAW_AS_OF)`. Das Regelverzeichnis liegt in
[shared/law/rules.ts](shared/law/rules.ts) und nimmt seine Daten und Zahlen aus den Parametern.
**Eine Fassung wird nie geändert, nur eine neue angelegt**; `law-history.test.ts` hält jede
ausgelieferte Fassung als Zahl fest. `law-literals.test.ts` verbietet Prozentangaben einer
Rechtsfolge außerhalb des Registers und Datumsliterale in den Dateien der Berechnung; erlaubte
Stellen stehen dort mit Grund. Beim Tag bricht release.yml ab, solange ein Wert
`checked: 'unchecked'` hat (`law-release.test.ts`). Wer eine Regel oder einen Wert prüft, setzt
`retrieved` und `LAW_AS_OF` (bei Regeln `RULES_AS_OF`) auf den Tag der Durchsicht (#110);
`LAW_AS_OF` ist das jüngste `retrieved` und steht als Rechtsstand in jeder Abrechnung. Die
jährliche Durchsicht (Entwurf 4.8) geht jeden Parameter an seiner Fundstelle durch, legt bei
einer Änderung eine neue Fassung an statt die alte zu ändern, trägt veröffentlichte Werte ein,
sieht Bundesgesetzblatt (HeizkostenV, CO2KostAufG, GModG, BetrKV, MessEV) und neue Urteile des
VIII. Senats zu Heiz- und Betriebskosten durch und setzt zuletzt `LAW_AS_OF`.
```

Außerdem im Abschnitt „Begriffslexikon“ den Satz „Seit #140 lädt auch der Server einen Laufzeitanteil, [shared/heating.ts](shared/heating.ts):“ unverändert lassen und am Ende des Absatzes anfügen: „Lexikon und Anleitungen nehmen ihre Rechtszahlen aus dem Rechtsregister.“

- [ ] **Step 3: Abschlussprüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: Server und Client ohne Fehlschlag (Server: `ℹ fail 0`; Client: `Test Files … passed`), Typprüfung ohne Fehler, Build fertig. Golden F01–F11 und `db-golden` sind darin enthalten; ihre Fixtures sind unverändert:

Run: `git diff --stat origin/feat/heizung -- server/test/fixtures server/drizzle server/src/legacy`
Expected: keine Ausgabe.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "Doku: Rechtsregister in CHANGELOG und CLAUDE.md" -m "Refs #97" -m "Refs #110"
```

- [ ] **Step 5: Übergabe**

Beim Schreiben dieses Plans wurde jeder Schritt in einem Wegwerf-Worktree auf `origin/feat/heizung` (Commit `1f6c6f1`, im Code gleich mit `09ec10b`) in dieser Reihenfolge durchgespielt: jeder RED-Schritt scheiterte wie angegeben, am Ende `npm test` mit 1.257 bestandenen Server- und 726 Client-Tests, `npm run typecheck` und `npm run build` ohne Fehler.

Vor dem PR die Durchsicht mit frischem Kontext (CLAUDE.md). Offen bleibt bewusst: `ustg.standard-rate` ist ungeprüft; vor dem Release § 12 Abs. 1 UStG und § 28 Abs. 1 UStG a. F. lesen, bei Bestätigung `checked: 'checked'` und `retrieved` setzen (neue Zeile in `law-history.test.ts` nur, wenn sich ein Wert ändert; der Prüfstand steht dort nicht).
