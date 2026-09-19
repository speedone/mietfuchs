// Stabile Projektion der Berechnungsergebnisse für den Golden-Master-Vergleich.
//
// Zweck: Zwei Ergebnisse sind fachlich gleich, auch wenn Objektreihenfolgen abweichen —
// aber sie sind fachlich verschieden, sobald sich ein Cent, ein Tag oder eine Warnung ändert.
// Deshalb wird hier explizit sortiert (Reihenfolgen in der Datei haben keine Bedeutung) und
// alles verworfen, was reine Anzeige ist.
//
// Verglichen werden: Mieteranteile, Vermieteranteil und Eigenanteil, Vorauszahlungen, Salden,
// §35a, Verbrauch, Rundung und Warnungen.
//
// Bewusst NICHT im Vergleich:
//   basisText, keyLabel   — aus fmtNum()/toLocaleString erzeugte Anzeigestrings; ihr Inhalt
//                           steckt strukturiert in days/personDays/key
//   tenantName, unitName, category, description — unveränderte Durchreichung aus der Eingabe
//
// Bewusst IM Vergleich: warnings im Wortlaut. Eine geänderte Warnung ist eine sichtbare
// fachliche Änderung und soll auffallen.

const byId = (key) => (a, b) => String(a[key]).localeCompare(String(b[key]))

export function normalizeSettlement(result) {
  return {
    year: result.year,
    daysInYear: result.daysInYear,
    totalCostsCents: result.totalCostsCents,
    statements: result.statements
      .slice()
      .sort(byId('tenancyId'))
      .map((st) => ({
        tenancyId: st.tenancyId,
        unitId: st.unitId,
        periodStart: st.periodStart,
        periodEnd: st.periodEnd,
        days: st.days,
        persons: st.persons,
        personDays: st.personDays,
        totalShareCents: st.totalShareCents,
        total35aCents: st.total35aCents,
        prepaymentCents: st.prepaymentCents,
        prepaymentOverridden: st.prepaymentOverridden,
        balanceCents: st.balanceCents,
        suggestedMonthlyCents: st.suggestedMonthlyCents,
        rows: st.rows
          .slice()
          .sort(byId('costItemId'))
          .map((r) => ({
            costItemId: r.costItemId,
            key: r.key,
            totalCents: r.totalCents,
            shareCents: r.shareCents,
            labor35aCents: r.labor35aCents,
          })),
      })),
    landlord: {
      totalCents: result.landlord.totalCents,
      rows: result.landlord.rows
        .slice()
        .sort(byId('costItemId'))
        .map((r) => ({
          costItemId: r.costItemId,
          totalCents: r.totalCents,
          shareCents: r.shareCents,
        })),
    },
    // Teil des Vermieteranteils, der auf selbstgenutzte Wohnungen entfällt (seit v0.3.0)
    selfUsedShareCents: result.selfUsedShareCents,
    // Warnungen sind mengenwertig, nicht reihenfolgebehaftet: die Erzeugungsreihenfolge
    // folgt der Reihenfolge der Kostenpositionen und hat keine fachliche Bedeutung.
    warnings: result.warnings.slice().sort((a, b) => a.localeCompare(b)),
  }
}

export function normalizeConsumption(overview) {
  return overview
    .slice()
    .sort(byId('meterId'))
    .map((c) => ({
      meterId: c.meterId,
      consumption: c.consumption,
      readingCount: c.readingCount,
      warnings: c.warnings.slice().sort((a, b) => a.localeCompare(b)),
    }))
}
