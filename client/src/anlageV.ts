// Die Zeilen der Anlage V je Jahr (#96 PR 1, Entwurf 2026-10-30-steuer-objekt-ruecklage-design.md, A5; Durchsicht X5):
// **die eine Tabelle** der Zeilennummern für das ganze Release, gelesen von der Steuerseite (#96), den Einnahmen (#312)
// und dem verteilten Erhaltungsaufwand (#262). Eingetragen ist nur, was im Vordruck oder in der Anleitung des Jahres
// selbst nachgesehen ist; ein Jahr ohne gelesenen Vordruck ergibt `null`, ein nicht nachgesehener Block fehlt. Eine
// erfundene Zeile wäre schlimmer als keine. Die jährliche Durchsicht (#110) trägt ein neues Jahr erst nach dem Lesen ein.
//
// Fundstellen:
// - 2023: Formular-Management-System der Bundesfinanzverwaltung, „080 – Anlage V (2023)“, Vordruck „2023AnlV101NET –
//   September 2023 –“, https://www.formulare-bfinv.de/ffw/action/invoke.do?id=034032_23, Seite 1 (Zeilen 15 bis 23).
// - 2024: ebenda, „080 – Anlage V (2024)“, Vordruck „2024AnlV101NET – September 2024 –“,
//   https://www.formulare-bfinv.de/ffw/action/invoke.do?id=034032_24, Seite 1 (Zeilen 15 bis 23); Anleitung zur Anlage V
//   2024 (September 2024), Kopie http://www.steuerhexe.de/wp-content/uploads/2025/05/Anlage-V-2024-Anleitung.pdf
//   (Zeile 6, Zeilen 55 bis 72, 76 bis 78).
// - 2025: Vordruck „2025AnlV101 – September 2025 –“, Finanzverwaltung NRW,
//   https://www.finanzamt.nrw.de/dokumente/anlage-v-einkuenfte-aus-vermietungverpachtung-bebauter-grundstuecke-2025, und
//   Kopie https://www.steuern.de/fileadmin/user_upload/Steuerformulare_2025/Anlage_V_2025_steuern-de.pdf (Seite 1:
//   Zeilen 4 bis 24; Seite 2: 25 bis 32; Seiten 3 und 4: 55 bis 83), gelesen am 30.10.2026.
//
// In allen drei Jahren Seite 1 gleich (bis #96 als `SETTLEMENT_LINES` in taxView.ts, #280): Zeile 21, Kennzahl 11 „auf
// die Zeilen 15 und 18 entfallende und im Jahr … erhaltene Nachzahlungen / geleistete Erstattungen (negativen Betrag mit
// vorangestelltem Minuszeichen eintragen)“, eine saldierte Zeile; Zeile 23 (Kennzahl 12) dasselbe für Zeile 19, die an
// Angehörige vermieteten Wohnungen. Die laufenden Mieten in den Summenzeilen 15 (Kennzahl 01) und 18 (Kennzahl 02), an
// Angehörige Zeile 19 (Kennzahl 03), die laufenden Umlagen in Zeile 20 (Kennzahl 04), an Angehörige Zeile 22 (Kennzahl 05).
//
// **Bewusst leer**, weil nicht selbst nachgesehen: für 2023 und 2024 die Zeilen 13/14, 24, 25 und 32 (liest #312 PR 3 nach), für 2024 die Kennzahlen der Werbungskosten und die Kopfzeilen 7 und 10 bis 12
// (der Kopf 2024 zählt anders, die Anleitung nennt „Zeile 10 bis 12“ nur zusammen), für 2023 Kopf und Werbungskosten.

// Eine Zeile, mit Kennzahl, wo der Vordruck eine nennt.
export type Line = { line: number; code?: number }

export type AnlageVLines = {
  // Vordruck und Anleitung, aus denen die Zeilen stammen.
  source: string
  // Kopf: Z. 6 Aktenzeichen, Z. 7 Kauf und Bau, Z. 10 Nutzung, Z. 11 Gesamtwohnfläche, Z. 12 eigengenutzt (#96 PR 2).
  header?: { groundTaxFile: 6; acquisition?: 7; use?: 10; totalArea?: 11; selfUsedArea?: 12 }
  // Einnahmen, Zeilen 13 bis 32 (#312).
  income: {
    perUnit?: readonly [13, 14]
    homes?: Line
    otherRooms?: Line
    relatives?: Line
    allocations?: Line
    settlement?: Line
    relativesAllocations?: Line
    relativesSettlement?: Line
    notAgreed?: Line
    formerYears?: Line
    total?: number
  }
  // Erhaltungsaufwand „einschließlich Entnahmen aus der Erhaltungsrücklage“: 55 direkt, 56 verhältnismäßig; verteilt
  // nach § 82b EStDV 57 bis 60 im ersten Jahr, 61 bis 72 die Anteile aus den Vorjahren (#262).
  maintenance?: {
    direct: Line
    proportional: Line
    spread?: { total: number; direct: number; proportional: number; sum: Line }
    spreadFromPriorYears?: readonly { fromYear: number; direct: number; proportional: number; sum: Line }[]
  }
  // „Nicht umgelegte Kosten … – ohne Erhaltungsrücklage –“.
  notAllocated?: readonly [76, 78]
}

const ANLAGE_V: Readonly<Record<number, AnlageVLines>> = {
  2023: {
    source: 'Vordruck 2023AnlV101NET (September 2023), Seite 1',
    income: {
      homes: { line: 15, code: 1 }, otherRooms: { line: 18, code: 2 }, relatives: { line: 19, code: 3 }, allocations: { line: 20, code: 4 },
      settlement: { line: 21, code: 11 }, relativesAllocations: { line: 22, code: 5 }, relativesSettlement: { line: 23, code: 12 },
    },
  },
  2024: {
    source: 'Vordruck 2024AnlV101NET (September 2024), Seite 1 (Einnahmen); Anleitung zur Anlage V 2024 (September 2024), Zeile 6 und Zeilen 55 bis 78',
    header: { groundTaxFile: 6 },
    income: {
      homes: { line: 15, code: 1 }, otherRooms: { line: 18, code: 2 }, relatives: { line: 19, code: 3 }, allocations: { line: 20, code: 4 },
      settlement: { line: 21, code: 11 }, relativesAllocations: { line: 22, code: 5 }, relativesSettlement: { line: 23, code: 12 },
    },
    maintenance: {
      direct: { line: 55 }, proportional: { line: 56 },
      spread: { total: 57, direct: 58, proportional: 59, sum: { line: 60 } },
      spreadFromPriorYears: [
        { fromYear: 2020, direct: 61, proportional: 62, sum: { line: 63 } },
        { fromYear: 2021, direct: 64, proportional: 65, sum: { line: 66 } },
        { fromYear: 2022, direct: 67, proportional: 68, sum: { line: 69 } },
        { fromYear: 2023, direct: 70, proportional: 71, sum: { line: 72 } },
      ],
    },
    notAllocated: [76, 78],
  },
  2025: {
    source: 'Vordruck 2025AnlV101 (September 2025), Seiten 1 bis 4',
    header: { groundTaxFile: 6, acquisition: 7, use: 10, totalArea: 11, selfUsedArea: 12 },
    income: {
      perUnit: [13, 14],
      homes: { line: 15, code: 1 }, otherRooms: { line: 18, code: 2 }, relatives: { line: 19, code: 3 }, allocations: { line: 20, code: 4 },
      settlement: { line: 21, code: 11 }, relativesAllocations: { line: 22, code: 5 }, relativesSettlement: { line: 23, code: 12 },
      notAgreed: { line: 24, code: 13 }, formerYears: { line: 25, code: 6 }, total: 32,
    },
    maintenance: {
      direct: { line: 55, code: 36 }, proportional: { line: 56, code: 37 },
      spread: { total: 57, direct: 58, proportional: 59, sum: { line: 60, code: 38 } },
      spreadFromPriorYears: [
        { fromYear: 2021, direct: 61, proportional: 62, sum: { line: 63, code: 39 } },
        { fromYear: 2022, direct: 64, proportional: 65, sum: { line: 66, code: 40 } },
        { fromYear: 2023, direct: 67, proportional: 68, sum: { line: 69, code: 41 } },
        { fromYear: 2024, direct: 70, proportional: 71, sum: { line: 72, code: 42 } },
      ],
    },
    notAllocated: [76, 78],
  },
}

// Die Jahre mit nachgesehenem Vordruck, aufsteigend.
export const ANLAGE_V_YEARS: readonly number[] = Object.keys(ANLAGE_V).map(Number).sort((a, b) => a - b)

export function anlageVLines(year: number): AnlageVLines | null {
  return ANLAGE_V[year] ?? null
}
