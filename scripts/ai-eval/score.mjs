// Bewertung des KI-Prüflaufs (#17). Jede Prüfung zählt gleich. Aus ai-eval.mjs ausgelagert (Heizung PR 20,
// #103), damit server/test/ai-eval-score.test.ts sie ohne Modell prüfen kann: ai-eval.mjs startet beim Laden
// den Lauf. Die Typangaben stehen gepflegt in score.d.mts daneben.

export const near = (actual, expected, tolerance = 0.011) => typeof actual === 'number' && Math.abs(actual - expected) <= tolerance

function tally(checks) {
  const passed = checks.filter((c) => c.ok).length
  return { points: checks.length ? passed / checks.length : 0, passed, total: checks.length, failed: checks.filter((c) => !c.ok).map((c) => c.name) }
}

// Rechnungen: Zusätzliche Positionen (etwa Abschläge oder Nettobeträge als eigene Zeile) zählen als Fehler,
// Positionen über 0,00 € (gebührenfreie Tonne) nicht.
export function score(expected, extraction) {
  const checks = []
  const add = (name, ok) => checks.push({ name, ok: Boolean(ok) })
  add('Summe', near(extraction?.totalGrossEur, expected.total))
  add('Aussteller', String(extraction?.vendor ?? '').toLowerCase().includes(expected.vendor.toLowerCase()))
  const positions = (Array.isArray(extraction?.positions) ? extraction.positions : []).filter((p) => Math.abs(Number(p?.amountEur) || 0) > 0.001)
  if (expected.positions) {
    const unused = [...positions]
    for (const e of expected.positions) {
      const i = unused.findIndex((p) => near(p.amountEur, e.amount))
      const found = i >= 0 ? unused.splice(i, 1)[0] : null
      add(`Betrag ${e.amount}`, found)
      add(`Kostenart ${e.category}`, found?.category === e.category)
    }
    for (const p of unused) add(`zusätzliche Position ${p.amountEur}`, false)
  }
  if (expected.allCategory) add(`Kostenart ${expected.allCategory}`, positions.length > 0 && positions.every((p) => p.category === expected.allCategory))
  if (expected.labor35a != null) {
    const labor = positions.reduce((sum, p) => sum + (Number(p.labor35aEur) || 0), 0)
    add('Lohnanteil § 35a', near(labor, expected.labor35a, 0.021))
  }
  return tally(checks)
}

// Messdienstabrechnung (Heizung PR 20): Kopf, Abzugszeile, G und V, CO₂-Block, Warmwasser und je Block Summe,
// Beträge und Leerstand. Eine Nutzerzeile zu viel zählt als Fehler.
export function scoreService(expected, x) {
  const checks = []
  const add = (name, ok) => checks.push({ name, ok: Boolean(ok) })
  add('Aussteller', String(x?.vendor ?? '').toLowerCase().includes(expected.vendor.toLowerCase()))
  add('Beginn', x?.periodStart === expected.periodStart)
  add('Ende', x?.periodEnd === expected.periodEnd)
  add('Nutzeinheiten', x?.unitsCount === expected.unitsCount)
  add('Summe S', near(x?.usersTotalEur, expected.usersTotal))
  add('Abzugszeile', near(x?.deductionEur, expected.deduction))
  if ('fuelGross' in expected) add('Brennstoffkosten vor Abzug', near(x?.fuelGrossEur, expected.fuelGross))
  if ('fuelNet' in expected) add('Brennstoffkosten nach Abzug', near(x?.fuelNetEur, expected.fuelNet))
  for (const [k, v] of Object.entries(expected.co2)) add(`CO₂ ${k}`, near(x?.co2?.[k], v, k === 'emissionsKg' || k === 'areaM2' ? 0.051 : 0.011))
  add('Warmwasser', x?.dhwMethod === expected.dhwMethod)
  const blocks = Array.isArray(x?.blocks) ? x.blocks : []
  for (const e of expected.blocks) {
    const b = blocks.find((y) => y?.category === e.category)
    const lines = Array.isArray(b?.lines) ? b.lines : []
    add(`Block ${e.category}`, b)
    add(`Summe ${e.category}`, near(b?.totalEur, e.total))
    const unused = [...lines]
    for (const amount of e.lines) {
      const i = unused.findIndex((l) => near(l?.amountEur, amount))
      if (i >= 0) unused.splice(i, 1)
      add(`${e.category} ${amount}`, i >= 0)
    }
    for (const l of unused) add(`${e.category} zusätzliche Zeile ${l?.amountEur}`, false)
    add(`${e.category} Leerstand`, lines.filter((l) => l?.vacancy === true).length === (e.vacancyLines ?? 0))
  }
  return tally(checks)
}

// Lieferantenrechnung (Heizung PR 20): Rechnungsbetrag (nicht die Nachzahlung), Zeitraum oder Liefertag, die
// Angaben nach § 3 Abs. 1 CO2KostAufG, Heizwert (nicht der Brennwert) und je Teilmenge Zeitraum und Beträge.
export function scoreFuel(expected, x) {
  const checks = []
  const add = (name, ok) => checks.push({ name, ok: Boolean(ok) })
  const optionalNear = (actual, want, tolerance) => (want === null ? actual === null || actual === undefined : near(actual, want, tolerance))
  add('Aussteller', String(x?.vendor ?? '').toLowerCase().includes(expected.vendor.toLowerCase()))
  add('Rechnungsbetrag', near(x?.totalGrossEur, expected.total))
  if (expected.periodStart) add('Beginn', x?.periodStart === expected.periodStart)
  if (expected.periodEnd) add('Ende', x?.periodEnd === expected.periodEnd)
  if (expected.deliveredAt) add('Liefertag', x?.deliveredAt === expected.deliveredAt)
  if ('fixed' in expected) add('Grundpreis', optionalNear(x?.fixedEur, expected.fixed))
  add('Menge', near(x?.quantity, expected.quantity, 0.5))
  add('Einheit', x?.quantityUnit === expected.quantityUnit)
  add('Energie', near(x?.energyKwh, expected.energyKwh, 1))
  if ('gasBasis' in expected) add('Brennwert/Heizwert', x?.gasBasis === expected.gasBasis)
  add('Heizwert', optionalNear(x?.heatingValue, expected.heatingValue, 0.011))
  add('Emissionen', near(x?.emissionsKg, expected.emissionsKg, 0.11))
  add('CO₂-Kosten', near(x?.co2CostEur, expected.co2Cost))
  add('Emissionsfaktor', near(x?.emissionFactor, expected.emissionFactor, 0.00001))
  add('Biobrennstoff', optionalNear(x?.bioCostEur, expected.bioCost))
  const parts = Array.isArray(x?.parts) ? x.parts : []
  add('Zahl der Teilmengen', parts.length === expected.parts.length)
  for (const e of expected.parts) {
    const p = parts.find((y) => y?.from === e.from && y?.to === e.to)
    add(`Teilmenge ${e.from}`, p)
    add(`Teilmenge ${e.from} kWh`, near(p?.energyKwh, e.energyKwh, 1))
    add(`Teilmenge ${e.from} Betrag`, near(p?.amountEur, e.amount))
    add(`Teilmenge ${e.from} fest`, near(p?.fixedEur, e.fixed))
    add(`Teilmenge ${e.from} kg`, near(p?.emissionsKg, e.emissionsKg, 0.11))
    add(`Teilmenge ${e.from} CO₂-Kosten`, near(p?.co2CostEur, e.co2Cost))
  }
  return tally(checks)
}
