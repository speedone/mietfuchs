// Berechnungs-Engine für die Nebenkostenabrechnung.
// Alle Beträge werden in Cent (Integer) gerechnet, um Gleitkomma-Fehler zu vermeiden.

export const KEY_LABELS = {
  area: 'Wohnfläche',
  persons: 'Personenzahl',
  units: 'Wohneinheiten',
  direct: 'Direktzuordnung',
  meter: 'Verbrauch (Zähler)',
}

const MS_DAY = 86400000

function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function daysInYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365
}

// Überlappung zweier Zeiträume in Tagen (alle Grenzen inklusiv, ISO-Strings, end=null = offen)
function rangeOverlapDays(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(toUTC(aStart), toUTC(bStart))
  const e = Math.min(aEnd ? toUTC(aEnd) : Infinity, bEnd ? toUTC(bEnd) : Infinity)
  if (e < s) return 0
  return Math.round((e - s) / MS_DAY) + 1
}

// Belegte Tage eines Mietverhältnisses innerhalb des Abrechnungsjahres
export function overlapDays(start, end, year) {
  return rangeOverlapDays(start, end, `${year}-01-01`, `${year}-12-31`)
}

// ---------- Personen-Staffel ----------

function personHistoryOf(tenancy) {
  const h = Array.isArray(tenancy.personHistory) && tenancy.personHistory.length
    ? tenancy.personHistory
    : [{ from: tenancy.start, persons: tenancy.persons ?? 1 }]
  return h.slice().sort((a, b) => a.from.localeCompare(b.from))
}

// Personentage eines Mietverhältnisses im Zeitraum [from, to] (inklusiv)
export function personDaysInPeriod(tenancy, from, to) {
  const h = personHistoryOf(tenancy)
  let sum = 0
  for (let i = 0; i < h.length; i++) {
    const segStart = i === 0 ? tenancy.start : h[i].from // erste Stufe gilt ab Einzug
    const segEnd = i + 1 < h.length
      ? new Date(toUTC(h[i + 1].from) - MS_DAY).toISOString().slice(0, 10)
      : tenancy.end
    const effEnd = tenancy.end && (!segEnd || segEnd > tenancy.end) ? tenancy.end : segEnd
    sum += h[i].persons * rangeOverlapDays(segStart, effEnd, from, to)
  }
  return sum
}

// Aktuelle Personenzahl zu einem Stichtag
export function personsAt(tenancy, dateIso) {
  const h = personHistoryOf(tenancy)
  let p = h[0]?.persons ?? 0
  for (const e of h) if (e.from <= dateIso) p = e.persons
  return p
}

// ---------- Zähler & Verbrauch ----------

// Ablesungen eines Zählers → Verbrauchssegmente zwischen aufeinanderfolgenden Ablesungen.
// Konvention: eine Ablesung gilt zum Tagesende ihres Datums. Bei Zählerwechsel trägt die
// Ablesung replacement=true: oldEndValue = Endstand des alten Geräts, value = Startstand des neuen.
export function meterSegments(readings) {
  const sorted = readings.slice().sort((a, b) => a.date.localeCompare(b.date))
  const segments = []
  const warnings = []
  for (let i = 1; i < sorted.length; i++) {
    const r0 = sorted[i - 1]
    const r1 = sorted[i]
    const delta = r1.replacement ? (r1.oldEndValue ?? 0) - r0.value : r1.value - r0.value
    const days = Math.round((toUTC(r1.date) - toUTC(r0.date)) / MS_DAY)
    if (delta < 0) {
      warnings.push(`Negativer Verbrauch zwischen ${r0.date} und ${r1.date} (${delta}) — Ablesung prüfen oder Zählerwechsel markieren.`)
    }
    if (days > 0) segments.push({ from: r0.date, to: r1.date, delta, days })
  }
  return { segments, warnings }
}

// Verbrauch im Zeitraum [from, to] (inklusive Tage). Segmente werden tagesanteilig
// interpoliert — liegt eine Ablesung genau auf der Zeitraumgrenze (z. B. Zwischenablesung
// beim Mieterwechsel), ist die Aufteilung exakt.
export function consumptionInPeriod(readings, from, to) {
  const { segments } = meterSegments(readings)
  let sum = 0
  const pStart = toUTC(from) - MS_DAY // Zeitraum beginnt nach Tagesende des Vortags
  const pEnd = toUTC(to)
  for (const s of segments) {
    const s0 = toUTC(s.from)
    const s1 = toUTC(s.to)
    const overlap = Math.min(pEnd, s1) - Math.max(pStart, s0)
    if (overlap <= 0) continue
    sum += s.delta * (overlap / MS_DAY / s.days)
  }
  return sum
}

// Jahresübersicht für die Zähler-Seite: Verbrauch pro Zähler + Warnungen
export function consumptionOverview(db, year) {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  return (db.meters ?? []).map((m) => {
    const readings = (db.readings ?? []).filter((r) => r.meterId === m.id)
    const { warnings } = meterSegments(readings)
    return {
      meterId: m.id,
      consumption: Math.round(consumptionInPeriod(readings, from, to) * 100) / 100,
      readingCount: readings.length,
      warnings,
    }
  })
}

// ---------- Vorauszahlungen ----------

// Vorauszahlungen eines Jahres: pro Kalendermonat zählt der Staffelbetrag, der am
// Monatsersten gilt — sofern das Mietverhältnis am Monatsersten besteht. Eine manuelle
// Korrektur pro Jahr (tatsächlich gezahlter Betrag) hat immer Vorrang, denn rechtlich
// sind die tatsächlich geleisteten Vorauszahlungen anzusetzen.
export function computePrepaymentCents(tenancy, year) {
  const override = tenancy.prepaymentOverrides?.[String(year)]
  if (override != null) return { cents: override, overridden: true }
  const schedule = (
    tenancy.prepayments?.length
      ? tenancy.prepayments
      : tenancy.prepaymentMonthlyCents != null // Altformat: ein fester Monatsbetrag
        ? [{ from: tenancy.start.slice(0, 7), monthlyCents: tenancy.prepaymentMonthlyCents }]
        : []
  )
    .slice()
    .sort((a, b) => a.from.localeCompare(b.from))
  let cents = 0
  for (let m = 1; m <= 12; m++) {
    const firstDay = `${year}-${String(m).padStart(2, '0')}-01`
    if (tenancy.start > firstDay) continue
    if (tenancy.end && tenancy.end < firstDay) continue
    let rate = 0
    for (const e of schedule) if (e.from <= firstDay.slice(0, 7)) rate = e.monthlyCents
    cents += rate
  }
  return { cents, overridden: false }
}

// ---------- Hilfen ----------

// Verteilt totalCents exakt auf die gegebenen (float) Rohanteile (Hare/largest remainder)
function largestRemainder(totalCents, raws) {
  if (raws.length === 0) return []
  const floors = raws.map((r) => Math.floor(r))
  let rest = totalCents - floors.reduce((a, b) => a + b, 0)
  const order = raws
    .map((r, i) => [r - Math.floor(r), i])
    .sort((a, b) => b[0] - a[0])
  for (let k = 0; rest > 0; k++, rest--) floors[order[k % order.length][1]]++
  for (let k = 0; rest < 0; k++, rest++) floors[order[order.length - 1 - (k % order.length)][1]]--
  return floors
}

function fmtNum(n) {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
}

// ---------- Abrechnung ----------

export function computeSettlement(db, year) {
  const diy = daysInYear(year)
  const yFrom = `${year}-01-01`
  const yTo = `${year}-12-31`
  const unitById = new Map(db.units.map((u) => [u.id, u]))
  const partUnits = db.units.filter((u) => u.participates)
  const basisArea = partUnits.reduce((a, u) => a + (u.areaM2 || 0), 0)

  // Mietverhältnisse mit Überlappung im Jahr
  const tenancies = db.tenancies
    .map((t) => ({ ...t, days: overlapDays(t.start, t.end, year), unit: unitById.get(t.unitId) }))
    .filter((t) => t.days > 0 && t.unit)
  const partTenancies = tenancies.filter((t) => t.unit.participates)
  const basisPersonDays = partTenancies.reduce((a, t) => a + personDaysInPeriod(t, yFrom, yTo), 0)

  // Verbrauch je Zählertyp vorbereiten (nur Wohnungszähler bilden die Verteilbasis)
  const allMeters = db.meters ?? []
  const allReadings = db.readings ?? []
  const meterTypes = [...new Set(allMeters.filter((m) => m.unitId).map((m) => m.type))]
  const consumptionByType = {}
  for (const type of meterTypes) {
    const meters = allMeters.filter((m) => m.unitId && m.type === type)
    const perUnit = new Map()
    let basis = 0
    for (const m of meters) {
      const readings = allReadings.filter((r) => r.meterId === m.id)
      const c = consumptionInPeriod(readings, yFrom, yTo)
      basis += c
      perUnit.set(m.unitId, (perUnit.get(m.unitId) || 0) + c)
    }
    consumptionByType[type] = { meters, basis, perUnit }
  }

  const statements = new Map()
  for (const t of partTenancies) {
    const from = new Date(Math.max(toUTC(t.start), toUTC(yFrom)))
    const to = t.end ? new Date(Math.min(toUTC(t.end), toUTC(yTo))) : new Date(toUTC(yTo))
    const pp = computePrepaymentCents(t, year)
    statements.set(t.id, {
      tenancyId: t.id,
      tenantName: t.tenantName,
      unitId: t.unitId,
      unitName: t.unit.name,
      persons: personsAt(t, to.toISOString().slice(0, 10)),
      personDays: personDaysInPeriod(t, yFrom, yTo),
      days: t.days,
      periodStart: from.toISOString().slice(0, 10),
      periodEnd: to.toISOString().slice(0, 10),
      rows: [],
      totalShareCents: 0,
      total35aCents: 0,
      prepaymentCents: pp.cents,
      prepaymentOverridden: pp.overridden,
      suggestedMonthlyCents: 0,
      balanceCents: 0,
    })
  }

  const landlordRows = []
  const warnings = []
  const items = db.costItems.filter((c) => c.year === year)
  let totalCostsCents = 0

  for (const item of items) {
    totalCostsCents += item.amountCents
    // Rohanteile (float, in Cent) pro Mietverhältnis bestimmen.
    // Nicht umlagefähige Kosten gehen immer vollständig an den Vermieter.
    const targets = [] // { t, raw, basisText }
    if (item.category === 'Nicht umlagefähig') {
      // keine Verteilung
    } else if (item.key === 'area' && basisArea > 0) {
      for (const t of partTenancies) {
        const raw = item.amountCents * ((t.unit.areaM2 || 0) / basisArea) * (t.days / diy)
        targets.push({ t, raw, basisText: `${fmtNum(t.unit.areaM2)} von ${fmtNum(basisArea)} m²${t.days < diy ? ` · ${t.days}/${diy} Tage` : ''}` })
      }
    } else if (item.key === 'units' && partUnits.length > 0) {
      for (const t of partTenancies) {
        const raw = (item.amountCents / partUnits.length) * (t.days / diy)
        targets.push({ t, raw, basisText: `1 von ${partUnits.length} Einheiten${t.days < diy ? ` · ${t.days}/${diy} Tage` : ''}` })
      }
    } else if (item.key === 'persons' && basisPersonDays > 0) {
      for (const t of partTenancies) {
        const pd = personDaysInPeriod(t, yFrom, yTo)
        const raw = item.amountCents * (pd / basisPersonDays)
        targets.push({ t, raw, basisText: `${fmtNum(pd)} von ${fmtNum(basisPersonDays)} Personentagen` })
      }
    } else if (item.key === 'meter') {
      const data = consumptionByType[item.meterType]
      if (!data || data.basis <= 0) {
        warnings.push(`„${item.description}": kein Verbrauch für Zählertyp „${item.meterType ?? '—'}" erfasst — Betrag geht an den Vermieter.`)
      } else {
        for (const t of partTenancies) {
          const meters = data.meters.filter((m) => m.unitId === t.unitId)
          let c = 0
          for (const m of meters) {
            const readings = allReadings.filter((r) => r.meterId === m.id)
            const pFrom = t.start > yFrom ? t.start : yFrom
            const pTo = t.end && t.end < yTo ? t.end : yTo
            c += consumptionInPeriod(readings, pFrom, pTo)
          }
          const raw = item.amountCents * (c / data.basis)
          targets.push({ t, raw, basisText: `${fmtNum(Math.round(c * 100) / 100)} von ${fmtNum(Math.round(data.basis * 100) / 100)} (gemessen)` })
        }
      }
    } else if (item.key === 'direct') {
      for (const t of tenancies.filter((t) => t.unitId === item.directUnitId)) {
        const raw = item.amountCents * (t.days / diy)
        targets.push({ t, raw, basisText: `Direktzuordnung ${t.unit.name}${t.days < diy ? ` · ${t.days}/${diy} Tage` : ''}` })
      }
    }

    // Exakte Cent-Verteilung: wenn die Rohanteile die Gesamtsumme (nahezu) voll ausschöpfen,
    // wird centgenau auf die Mieter verteilt; ansonsten trägt der Vermieter die Differenz
    // (Leerstand, Eigenanteil, Rundungsrest).
    const rawSum = targets.reduce((a, x) => a + x.raw, 0)
    let shares
    if (targets.length > 0 && Math.abs(item.amountCents - rawSum) < 0.5) {
      shares = largestRemainder(item.amountCents, targets.map((x) => x.raw))
    } else {
      shares = targets.map((x) => Math.round(x.raw))
    }
    let distributed = 0
    targets.forEach((x, i) => {
      distributed += shares[i]
      const st = statements.get(x.t.id)
      if (!st) return // Mietverhältnis in nicht beteiligter Wohnung (nur bei Direktzuordnung möglich)
      const labor35a = item.labor35aCents && item.amountCents > 0
        ? Math.round(item.labor35aCents * (shares[i] / item.amountCents))
        : 0
      st.rows.push({
        costItemId: item.id,
        category: item.category,
        description: item.description,
        totalCents: item.amountCents,
        key: item.key,
        keyLabel: KEY_LABELS[item.key] || item.key,
        basisText: x.basisText,
        shareCents: shares[i],
        labor35aCents: labor35a,
      })
      st.totalShareCents += shares[i]
      st.total35aCents += labor35a
    })
    const landlordCents = item.amountCents - distributed
    if (landlordCents !== 0) {
      landlordRows.push({
        costItemId: item.id,
        category: item.category,
        description: item.description,
        totalCents: item.amountCents,
        keyLabel: KEY_LABELS[item.key] || item.key,
        shareCents: landlordCents,
      })
    }
  }

  const result = {
    year,
    daysInYear: diy,
    statements: [...statements.values()],
    landlord: {
      rows: landlordRows,
      totalCents: landlordRows.reduce((a, r) => a + r.shareCents, 0),
    },
    totalCostsCents,
    warnings,
  }
  for (const st of result.statements) {
    st.balanceCents = st.prepaymentCents - st.totalShareCents // >0 Guthaben, <0 Nachzahlung
    // Vorschlag nach §560 Abs. 4 BGB: ein Zwölftel der Jahreskosten, auf volle Euro gerundet
    st.suggestedMonthlyCents = Math.round(st.totalShareCents / 12 / 100) * 100
  }
  return result
}
