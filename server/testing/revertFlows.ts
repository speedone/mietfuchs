// Der Generator der Zufallsabläufe für die Invariante des Rücksprungs (#318, Schritt 4; invariant-ruecksprung.test.ts).
// Jeder Schritt geht über die echten Routen. Ein Schritt darf scheitern (eine Schreibprüfung lehnt ab, etwa in einem
// abgeschlossenen Zeitraum); dann entsteht keine Gruppe, und der Ablauf geht weiter.
//
// **Abdeckung**: Jede Route mit Satz (journalRoutes.ts) steht in `routes` eines Schritts oder mit Grund in
// `UNCOVERED_ROUTES`. Der Test prüft beides am Ende eines Laufs gegen die Routen, die wirklich eine Gruppe ergeben
// haben (sie stehen im Verlauf). Die Ausnahmeliste soll nur kürzer werden (`UNCOVERED_MAX`).
import type { Server } from './api.ts'

export type Rng = () => number

// Fester Startwert, damit ein roter Lauf sich wiederholen lässt (mulberry32).
export function rngOf(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const P = 'objekt-1'
const Q = `?property=${P}`

type Row = { id: string, [key: string]: unknown }
export type Ctx = {
  s: Server
  rng: Rng
  units: Row[]
  tenancies: Row[]
  meters: Row[]
  readings: Row[]
  payments: Row[]
  costItems: Row[]
  plants: Row[]
  deliveries: Row[]
  refunds: Row[]
  uploads: string[]
  properties: Row[]
}

const send = async (s: Server, method: string, url: string, body?: unknown): Promise<Response> =>
  fetch(`${s.base}${url}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const json = async <T>(res: Response): Promise<T | null> => (res.ok ? ((await res.json()) as T) : null)
const get = async <T>(s: Server, url: string, fallback: T): Promise<T> => (await json<T>(await send(s, 'GET', url))) ?? fallback

export async function refresh(ctx: Ctx): Promise<void> {
  const { s } = ctx
  ctx.units = await get<Row[]>(s, `/api/units${Q}`, [])
  ctx.tenancies = await get<Row[]>(s, `/api/tenancies${Q}`, [])
  ctx.meters = await get<Row[]>(s, `/api/meters${Q}`, [])
  ctx.readings = await get<Row[]>(s, `/api/readings${Q}`, [])
  ctx.payments = await get<Row[]>(s, `/api/payments${Q}`, [])
  ctx.costItems = await get<Row[]>(s, `/api/costItems${Q}`, [])
  ctx.plants = await get<Row[]>(s, `/api/heating-plants${Q}`, [])
  ctx.deliveries = []
  for (const p of ctx.plants) ctx.deliveries.push(...(await get<Row[]>(s, `/api/heating-plants/${p.id}/deliveries`, [])))
  ctx.refunds = await get<Row[]>(s, `/api/co2-refunds${Q}`, [])
  const uploads = await get<{ file: string }[]>(s, '/api/uploads', [])
  ctx.uploads = uploads.map((u) => u.file)
  ctx.properties = await get<Row[]>(s, '/api/properties', [])
}

const pick = <T>(rng: Rng, list: readonly T[]): T | undefined => (list.length === 0 ? undefined : list[Math.floor(rng() * list.length)])
const int = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1))
const day = (rng: Rng, year = 2025) => `${year}-${String(int(rng, 1, 12)).padStart(2, '0')}-${String(int(rng, 1, 28)).padStart(2, '0')}`
const word = (rng: Rng) => pick(rng, ['Nord', 'Süd', 'Ost', 'West', 'Mitte', 'Garten', 'Dach', 'Keller']) ?? 'Mitte'

export type Step = { name: string, routes: string[], run: (ctx: Ctx) => Promise<unknown> }

const heatingSelf = { period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false }
const ownPlant = (ctx: Ctx) => ctx.plants.find((p) => p.method === 'self' && p.endsOn === null)
// Der Schlüssel der Heizperiode 2025 nach dem Rhythmus der Anlage (ohne eigenen: Kalenderjahr).
const periodOf = (p: Row) => `2025-${String(typeof p.periodStartMonth === 'number' ? p.periodStartMonth : 1).padStart(2, '0')}`
const livePlant = (ctx: Ctx, energy?: string) => ctx.plants.find((p) => p.endsOn === null && (energy === undefined || p.energy === energy))

export const STEPS: readonly Step[] = [
  { name: 'Wohnung anlegen', routes: ['POST /api/units'], run: ({ s, rng }) => send(s, 'POST', '/api/units', { propertyId: P, name: `${word(rng)} ${int(rng, 1, 99)}`, areaM2: int(rng, 20, 120), participates: rng() < 0.85, selfUsed: false }) },
  { name: 'Wohnung ändern', routes: ['PUT /api/units/:id'], run: async (ctx) => { const u = pick(ctx.rng, ctx.units); if (u) await send(ctx.s, 'PUT', `/api/units/${u.id}`, { areaM2: int(ctx.rng, 20, 120), notes: word(ctx.rng) }) } },
  { name: 'Wohnung löschen', routes: ['DELETE /api/units/:id'], run: async (ctx) => { const u = pick(ctx.rng, ctx.units); if (u && ctx.units.length > 2) await send(ctx.s, 'DELETE', `/api/units/${u.id}`) } },
  {
    name: 'Wohnung anlegen und gleich wieder löschen', routes: ['POST /api/units', 'DELETE /api/units/:id'],
    run: async ({ s, rng }) => {
      const u = await json<Row>(await send(s, 'POST', '/api/units', { propertyId: P, name: `Abstellraum ${word(rng)}`, areaM2: 0, participates: false, selfUsed: false }))
      if (u) await send(s, 'DELETE', `/api/units/${u.id}`)
    },
  },
  {
    name: 'Mietverhältnis anlegen', routes: ['POST /api/tenancies'],
    run: async (ctx) => {
      const u = pick(ctx.rng, ctx.units)
      if (u) await send(ctx.s, 'POST', '/api/tenancies', { unitId: u.id, tenantName: `Mieter ${word(ctx.rng)}`, persons: int(ctx.rng, 1, 4), start: day(ctx.rng, 2024), prepayments: [{ from: '2024-01', monthlyCents: int(ctx.rng, 50, 300) * 100 }] })
    },
  },
  { name: 'Mietverhältnis ändern', routes: ['PUT /api/tenancies/:id'], run: async (ctx) => { const t = pick(ctx.rng, ctx.tenancies); if (t) await send(ctx.s, 'PUT', `/api/tenancies/${t.id}`, { phone: `0${int(ctx.rng, 1000, 9999)}`, persons: int(ctx.rng, 1, 4) }) } },
  { name: 'Mietverhältnis löschen', routes: ['DELETE /api/tenancies/:id'], run: async (ctx) => { const t = pick(ctx.rng, ctx.tenancies); if (t && ctx.rng() < 0.5) await send(ctx.s, 'DELETE', `/api/tenancies/${t.id}`) } },
  {
    name: 'Mieterwechsel', routes: ['POST /api/tenancies/:id/change'],
    run: async (ctx) => {
      const t = pick(ctx.rng, ctx.tenancies.filter((x) => x.end === null))
      if (!t) return
      const meters = ctx.meters.filter((m) => m.unitId === t.unitId)
      await send(ctx.s, 'POST', `/api/tenancies/${t.id}/change`, {
        end: '2025-06-30', readings: meters.map((m) => ({ meterId: m.id, value: int(ctx.rng, 50, 90) })), newTenancy: { tenantName: `Nachmieter ${word(ctx.rng)}`, persons: 1, start: '2025-07-01' },
      })
    },
  },
  {
    name: 'Zähler anlegen', routes: ['POST /api/meters'],
    run: async (ctx) => { const u = pick(ctx.rng, ctx.units); await send(ctx.s, 'POST', '/api/meters', { propertyId: P, name: `Wasser ${word(ctx.rng)}`, unitId: u?.id ?? null, type: 'kaltwasser', unit: 'm³' }) },
  },
  { name: 'Zähler ändern', routes: ['PUT /api/meters/:id'], run: async (ctx) => { const m = pick(ctx.rng, ctx.meters); if (m) await send(ctx.s, 'PUT', `/api/meters/${m.id}`, { name: `Zähler ${word(ctx.rng)}` }) } },
  { name: 'Zähler löschen', routes: ['DELETE /api/meters/:id'], run: async (ctx) => { const m = pick(ctx.rng, ctx.meters); if (m && ctx.rng() < 0.4) await send(ctx.s, 'DELETE', `/api/meters/${m.id}`) } },
  {
    name: 'Ablesung anlegen', routes: ['POST /api/readings'],
    // Gelegentlich zwei am selben Tag: Die Reihenfolge (rowid) entscheidet dann über den Verbrauch.
    run: async (ctx) => { const m = pick(ctx.rng, ctx.meters); if (m) await send(ctx.s, 'POST', '/api/readings', { meterId: m.id, date: ctx.rng() < 0.3 ? '2025-01-01' : day(ctx.rng), value: int(ctx.rng, 1, 100) }) },
  },
  { name: 'Ablesung ändern', routes: ['PUT /api/readings/:id'], run: async (ctx) => { const r = pick(ctx.rng, ctx.readings); if (r) await send(ctx.s, 'PUT', `/api/readings/${r.id}`, { value: int(ctx.rng, 1, 100) }) } },
  { name: 'Ablesung löschen', routes: ['DELETE /api/readings/:id'], run: async (ctx) => { const r = pick(ctx.rng, ctx.readings); if (r) await send(ctx.s, 'DELETE', `/api/readings/${r.id}`) } },
  { name: 'Zahlung anlegen', routes: ['POST /api/payments'], run: async (ctx) => { const t = pick(ctx.rng, ctx.tenancies); if (t) await send(ctx.s, 'POST', '/api/payments', { tenancyId: t.id, date: day(ctx.rng), amountCents: int(ctx.rng, 100, 900) * 100 }) } },
  { name: 'Zahlung ändern', routes: ['PUT /api/payments/:id'], run: async (ctx) => { const p = pick(ctx.rng, ctx.payments); if (p) await send(ctx.s, 'PUT', `/api/payments/${p.id}`, { amountCents: int(ctx.rng, 100, 900) * 100 }) } },
  { name: 'Zahlung löschen', routes: ['DELETE /api/payments/:id'], run: async (ctx) => { const p = pick(ctx.rng, ctx.payments); if (p) await send(ctx.s, 'DELETE', `/api/payments/${p.id}`) } },
  {
    name: 'Kostenposition anlegen', routes: ['POST /api/costItems'],
    run: ({ s, rng }) => send(s, 'POST', '/api/costItems', {
      propertyId: P, period: '2025-01', category: pick(rng, ['Grundsteuer', 'Müllabfuhr', 'Hauswart', 'Wasser/Abwasser']), description: `Rechnung ${word(rng)}`, amountCents: int(rng, 50, 2000) * 100, key: pick(rng, ['area', 'units', 'persons']),
    }),
  },
  { name: 'Kostenposition ändern', routes: ['PUT /api/costItems/:id'], run: async (ctx) => { const c = pick(ctx.rng, ctx.costItems); if (c) await send(ctx.s, 'PUT', `/api/costItems/${c.id}`, { amountCents: int(ctx.rng, 50, 2000) * 100 }) } },
  { name: 'Kostenposition löschen', routes: ['DELETE /api/costItems/:id'], run: async (ctx) => { const c = pick(ctx.rng, ctx.costItems); if (c) await send(ctx.s, 'DELETE', `/api/costItems/${c.id}`) } },
  { name: 'Einstellungen ändern', routes: ['PUT /api/settings'], run: ({ s, rng }) => send(s, 'PUT', '/api/settings', { landlordName: `Vermieter ${word(rng)}`, paymentDeadlineDays: int(rng, 14, 30) }) },
  { name: 'KI-Übermittlung bestätigen', routes: ['POST /api/ai/consent'], run: ({ s }) => send(s, 'POST', '/api/ai/consent', { slot: 'text' }) },
  { name: 'KI-Bestätigung zurücknehmen', routes: ['DELETE /api/ai/consent/:slot'], run: ({ s }) => send(s, 'DELETE', '/api/ai/consent/text') },
  {
    name: 'Objekt anlegen, ändern, löschen', routes: ['POST /api/properties', 'PUT /api/properties/:id', 'DELETE /api/properties/:id'],
    run: async ({ s, rng }) => {
      const created = await json<Row>(await send(s, 'POST', '/api/properties', { name: `Haus ${word(rng)}` }))
      if (!created) return
      await send(s, 'PUT', `/api/properties/${created.id}`, { name: `Haus ${word(rng)} neu` })
      if (rng() < 0.7) await send(s, 'DELETE', `/api/properties/${created.id}`)
    },
  },
  { name: 'Objekt ändern', routes: ['PUT /api/properties/:id'], run: ({ s, rng }) => send(s, 'PUT', `/api/properties/${P}`, { name: `Lindenweg ${int(rng, 1, 40)}` }) },
  {
    name: 'Abrechnungszeitraum ändern', routes: ['PUT /api/properties/:id/period'],
    run: async ({ s, rng }) => {
      const rules = rng() < 0.5 ? { startMonth: 1, changes: ['2025-05'] } : { startMonth: 1, changes: [] }
      const preview = await json<{ token: string }>(await send(s, 'POST', `/api/properties/${P}/period/preview`, { rules }))
      if (preview) await send(s, 'PUT', `/api/properties/${P}/period`, { rules, answers: { understood: true, token: preview.token } })
    },
  },
  { name: 'Rechtswert eintragen', routes: ['PUT /api/law-overrides/:paramId/:year'], run: ({ s, rng }) => send(s, 'PUT', '/api/law-overrides/co2.price/2027', { value: int(rng, 55, 70), source: 'UBA' }) },
  { name: 'Rechtswert entfernen', routes: ['DELETE /api/law-overrides/:paramId/:year'], run: ({ s }) => send(s, 'DELETE', '/api/law-overrides/co2.price/2027') },
  { name: 'Texte des Anschreibens', routes: ['PUT /api/letter-texts'], run: ({ s, rng }) => send(s, 'PUT', '/api/letter-texts', { texts: { greeting: `Viele Grüße aus dem ${word(rng)}` } }) },
  { name: 'Texte des Anschreibens am Objekt', routes: ['PUT /api/properties/:id/letter-texts'], run: ({ s, rng }) => send(s, 'PUT', `/api/properties/${P}/letter-texts`, { texts: { closing: rng() < 0.5 ? null : `Danke, {Name}. ${word(rng)}` } }) },
  {
    name: 'Anschreiben an einen Mieter', routes: ['PUT /api/settlement/:period/letters/:tenancyId'],
    run: async (ctx) => { const t = pick(ctx.rng, ctx.tenancies); if (t) await send(ctx.s, 'PUT', `/api/settlement/2025/letters/${t.id}${Q}`, { texts: { greeting: `Bis bald, ${word(ctx.rng)}` } }) },
  },
  {
    name: 'Fehlende Zwischenablesung beantworten und entfernen', routes: ['PUT /api/units/:id/interim-gaps/:date', 'DELETE /api/units/:id/interim-gaps/:date'],
    run: async (ctx) => {
      const u = pick(ctx.rng, ctx.units)
      if (!u) return
      await send(ctx.s, 'PUT', `/api/units/${u.id}/interim-gaps/2025-06-30`, { status: 'missed', reason: '' })
      if (ctx.rng() < 0.5) await send(ctx.s, 'DELETE', `/api/units/${u.id}/interim-gaps/2025-06-30`)
    },
  },
  // ---------- Heizung ----------
  // Eine Linie je Objekt: zuerst eine Ölheizung mit Messdienst (Vorrat, CO₂, eigene Heizperiode), nach dem Kesseltausch eine
  // Gasheizung, die selbst abrechnet (Schätzung, Warmwasser).
  { name: 'Heizanlage anlegen', routes: ['POST /api/heating-plants'], run: ({ s }) => send(s, 'POST', '/api/heating-plants', { propertyId: P, energy: 'oil', method: 'service' }) },
  { name: 'Heizanlage ändern', routes: ['PUT /api/heating-plants/:id'], run: async (ctx) => { const p = pick(ctx.rng, ctx.plants); if (p) await send(ctx.s, 'PUT', `/api/heating-plants/${p.id}`, { devicesRemote: pick(ctx.rng, ['all', 'none']) }) } },
  { name: 'Heizanlage entfernen', routes: ['DELETE /api/heating-plants/:id'], run: async (ctx) => { const p = pick(ctx.rng, ctx.plants); if (p && ctx.rng() < 0.3) await send(ctx.s, 'DELETE', `/api/heating-plants/${p.id}`) } },
  { name: 'Eigene Heizkostenabrechnung einrichten', routes: ['PUT /api/heating-plants/:id/self'], run: async (ctx) => { const p = ctx.plants.find((x) => x.method === 'manual' && x.endsOn === null); if (p) await send(ctx.s, 'PUT', `/api/heating-plants/${p.id}/self`, { ...heatingSelf, period: periodOf(p) }) } },
  {
    name: 'Schätzung nach § 9a speichern', routes: ['PUT /api/heating-plants/:id/periods/:period/estimates/:unitId/:part'],
    run: async (ctx) => {
      const p = ownPlant(ctx)
      const u = pick(ctx.rng, ctx.units)
      if (p && u) await send(ctx.s, 'PUT', `/api/heating-plants/${p.id}/periods/${periodOf(p)}/estimates/${u.id}/heat`, { value: int(ctx.rng, 1000, 9000), method: 'buildingAverage', reason: 'Zähler defekt', confirmed: true, cause: 'deviceFailure' })
    },
  },
  {
    name: 'Schätzung nach § 9a entfernen', routes: ['DELETE /api/heating-plants/:id/periods/:period/estimates/:unitId/:part'],
    run: async (ctx) => {
      const p = ownPlant(ctx)
      if (!p) return
      for (const u of ctx.units) {
        const res = await send(ctx.s, 'DELETE', `/api/heating-plants/${p.id}/periods/${periodOf(p)}/estimates/${u.id}/heat`)
        if (res.ok && (await res.json() as { removed?: boolean }).removed !== false) return
      }
    },
  },
  { name: 'Warmwasser angeben', routes: ['PUT /api/heating-plants/:id/periods/:period/hot-water'], run: async (ctx) => { const p = ownPlant(ctx); if (p) await send(ctx.s, 'PUT', `/api/heating-plants/${p.id}/periods/${periodOf(p)}/hot-water`, { dhwMethod: 'volumeFormula', dhwVolumeM3: int(ctx.rng, 50, 150), dhwTempC: 60 }) } },
  {
    name: 'CO₂-Angaben speichern', routes: ['PUT /api/heating-plants/:id/periods/:period/co2'],
    run: async (ctx) => {
      const p = ctx.plants.find((x) => x.method === 'service' && x.endsOn === null)
      if (p) await send(ctx.s, 'PUT', `/api/heating-plants/${p.id}/periods/${periodOf(p)}/co2`, { method: 'serviceDeducted', serviceUsersTotalCents: int(ctx.rng, 500, 2000) * 100, serviceLandlordCents: 500, serviceUnitsCount: 1 })
    },
  },
  { name: 'CO₂-Angaben entfernen', routes: ['DELETE /api/heating-plants/:id/periods/:period/co2'], run: async (ctx) => { const p = ctx.plants.find((x) => x.method === 'service' && x.endsOn === null); if (p) await send(ctx.s, 'DELETE', `/api/heating-plants/${p.id}/periods/${periodOf(p)}/co2`) } },
  {
    name: 'Lieferung anlegen', routes: ['POST /api/heating-plants/:id/deliveries'],
    run: async (ctx) => {
      const p = livePlant(ctx)
      if (!p) return
      const oil = p.energy === 'oil' ? { deliveredAt: '2025-03-15', quantity: int(ctx.rng, 1000, 3000), quantityUnit: 'l' } : {}
      await send(ctx.s, 'POST', `/api/heating-plants/${p.id}/deliveries`, { label: `Lieferung ${word(ctx.rng)}`, invoiceFrom: '2025-07-01', invoiceTo: '2025-12-31', emissionsKg: int(ctx.rng, 1000, 6000), ...oil })
    },
  },
  { name: 'Lieferung ändern', routes: ['PUT /api/fuel-deliveries/:id'], run: async (ctx) => { const d = pick(ctx.rng, ctx.deliveries); if (d) await send(ctx.s, 'PUT', `/api/fuel-deliveries/${d.id}`, { label: `Lieferung ${word(ctx.rng)}` }) } },
  { name: 'Lieferung löschen', routes: ['DELETE /api/fuel-deliveries/:id'], run: async (ctx) => { const d = pick(ctx.rng, ctx.deliveries); if (d) await send(ctx.s, 'DELETE', `/api/fuel-deliveries/${d.id}`) } },
  {
    name: 'Brennstoffvorrat speichern', routes: ['PUT /api/heating-plants/:id/periods/:period/stock'],
    run: async (ctx) => {
      const p = livePlant(ctx, 'oil')
      if (p) await send(ctx.s, 'PUT', `/api/heating-plants/${p.id}/periods/${periodOf(p)}/stock`, { stockUnit: 'l', openingQuantity: int(ctx.rng, 500, 2000), openingCostCents: 95000, openingEmissionsKg: 2676.3, openingCo2Cents: 0, openingInvoicedBefore2023: true, closingQuantity: int(ctx.rng, 0, 400) })
    },
  },
  { name: 'Brennstoffvorrat entfernen', routes: ['DELETE /api/heating-plants/:id/periods/:period/stock'], run: async (ctx) => { const p = livePlant(ctx, 'oil'); if (p) await send(ctx.s, 'DELETE', `/api/heating-plants/${p.id}/periods/${periodOf(p)}/stock`) } },
  {
    name: 'Heizperiode der Anlage umstellen', routes: ['PUT /api/heating-plants/:id/period'],
    run: async (ctx) => {
      const p = ctx.plants.find((x) => x.method === 'service' && x.endsOn === null)
      if (!p) return
      const rules = { startMonth: p.periodStartMonth === 5 ? 1 : 5, changes: [] }
      const preview = await json<{ token: string }>(await send(ctx.s, 'POST', `/api/heating-plants/${p.id}/period/preview`, { rules }))
      if (preview) await send(ctx.s, 'PUT', `/api/heating-plants/${p.id}/period`, { rules, answers: { understood: true, token: preview.token } })
    },
  },
  {
    name: 'Kesseltausch', routes: ['POST /api/heating-plants/:id/replace'],
    run: async (ctx) => { const p = livePlant(ctx); if (p) await send(ctx.s, 'POST', `/api/heating-plants/${p.id}/replace`, { date: '2025-07-01', energy: 'gas', method: 'manual', name: `Neu ${word(ctx.rng)}`, previousName: `Alt ${word(ctx.rng)}` }) },
  },
  {
    name: 'CO₂-Erstattung anlegen, ändern, löschen', routes: ['POST /api/co2-refunds', 'PUT /api/co2-refunds/:id', 'DELETE /api/co2-refunds/:id'],
    run: async (ctx) => {
      const t = pick(ctx.rng, ctx.tenancies)
      if (!t) return
      await send(ctx.s, 'PUT', `/api/tenancies/${t.id}`, { heatingModel: 'selfSupply' })
      const created = await json<Row>(await send(ctx.s, 'POST', '/api/co2-refunds', { tenancyId: t.id, supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: int(ctx.rng, 50, 300) * 100, settlePeriod: '2025-01' }))
      if (!created) return
      await send(ctx.s, 'PUT', `/api/co2-refunds/${created.id}`, { amountCents: int(ctx.rng, 50, 300) * 100 })
      if (ctx.rng() < 0.5) await send(ctx.s, 'DELETE', `/api/co2-refunds/${created.id}`)
    },
  },
  // ---------- Belege ----------
  {
    name: 'Beleg hochladen', routes: ['POST /api/upload'],
    run: async ({ s, rng }) => {
      const fd = new FormData()
      fd.append('file', new Blob([Buffer.from(`%PDF-1.4 ${word(rng)} ${rng()}`)], { type: 'application/pdf' }), `beleg-${word(rng)}.pdf`)
      fd.append('propertyId', P)
      fd.append('year', '2025')
      await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })
    },
  },
  { name: 'Beleg im Posteingang ändern', routes: ['PUT /api/uploads/:file'], run: async (ctx) => { const f = pick(ctx.rng, ctx.uploads); if (f) await send(ctx.s, 'PUT', `/api/uploads/${f}`, { year: ctx.rng() < 0.5 ? 2024 : 2025 }) } },
  { name: 'Beleg löschen', routes: ['DELETE /api/uploads/:file'], run: async (ctx) => { const f = pick(ctx.rng, ctx.uploads); if (f) await send(ctx.s, 'DELETE', `/api/uploads/${f}`) } },
]

// Abschluss und Wiederöffnen: Diese Schritte erzeugen Gruppen, über die kein Rücksprung führt. Der Test kennt sie an
// ihrem Namen.
export const CLOSING_STEPS: readonly Step[] = [
  { name: 'Abrechnung abschließen', routes: ['POST /api/settlement/:period/close'], run: ({ s }) => send(s, 'POST', `/api/settlement/2025/close${Q}`, {}) },
  { name: 'Versanddatum speichern', routes: ['PUT /api/settlement/:period/close'], run: ({ s, rng }) => send(s, 'PUT', `/api/settlement/2025/close${Q}`, { sentAt: day(rng, 2026) }) },
  // Die Übernahme in die Staffel braucht eine abgeschlossene Abrechnung mit angekündigter Anpassung; der Zufallsbestand hat
  // nicht immer eine. Deshalb legt der Schritt sie für 2024 selbst an (Wohnung, Mieter mit 40 € Vorauszahlung, 600 €
  // Grundsteuer), schließt ab und übernimmt. Die Übernahme ändert Mietverhältnisse, nicht den Abschluss.
  {
    name: 'Abrechnung 2024 abschließen und angekündigte Vorauszahlung übernehmen', routes: ['POST /api/settlement/:period/prepayment-steps'],
    run: async ({ s, rng }) => {
      const unit = await json<Row>(await send(s, 'POST', '/api/units', { propertyId: P, name: `Anbau ${word(rng)}`, areaM2: 60, participates: true, selfUsed: false }))
      if (!unit) return
      await send(s, 'POST', '/api/tenancies', { unitId: unit.id, tenantName: `Mieter ${word(rng)}`, persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 4000 }] })
      await send(s, 'POST', '/api/costItems', { propertyId: P, period: '2024-01', category: 'Grundsteuer', description: 'Grundsteuer 2024', amountCents: 60000, key: 'area' })
      let closed = await send(s, 'POST', `/api/settlement/2024/close${Q}`, {})
      if (closed.status === 409) {
        const question = await json<{ errorToken?: string }>(closed)
        if (question?.errorToken) closed = await send(s, 'POST', `/api/settlement/2024/close${Q}`, { despiteErrors: question.errorToken })
      }
      const plan = await json<{ token: string, items: { tenancyId: string, state: string }[] }>(await send(s, 'POST', `/api/settlement/2024/prepayment-steps/plan${Q}`, {}))
      const ids = plan?.items.filter((i) => i.state === 'pending').map((i) => i.tenancyId) ?? []
      if (plan && ids.length > 0) await send(s, 'POST', `/api/settlement/2024/prepayment-steps${Q}`, { tenancyIds: ids, token: plan.token })
    },
  },
  { name: 'Abrechnung wieder öffnen', routes: ['DELETE /api/settlement/:period/close'], run: ({ s }) => send(s, 'DELETE', `/api/settlement/2025/close${Q}`) },
]

// Routen mit Satz, die der Generator nicht nimmt, je mit Grund. Nur kürzer werden lassen.
export const UNCOVERED_ROUTES: Readonly<Record<string, string>> = {
  'POST /api/costItems/split': 'Braucht einen Zeitraum über zwei Kalenderjahre; der Generator rechnet im Kalenderjahr. Legt neben den Teilen eine Zeile in cost_sources an (#455); den Rücksprung darüber prüft api-ruecksprung.test.ts.',
  'PUT /api/costItems/:id/split': 'Wie POST /api/costItems/split.',
  'POST /api/heating-plants/:id/operating-power': 'Braucht eine Allgemeinstrom-Position mit Heizanteil; Zeilen wie jede Kostenposition.',
  'PUT /api/heating-plants/:id/periods/:period/service-values': 'Werte des Ablesedienstes, nur bei Erfassung durch den Messdienst; Zeilen wie die Schätzung.',
  'PUT /api/heating-plants/:id/periods/:period/distribution': 'Anteil nach Verbrauch, eine Zeile in heating_periods wie Warmwasser.',
  'PUT /api/heating-plants/:id/periods/:period/info': 'Angaben nach § 6a, eine Zeile in heating_periods wie Warmwasser.',
  'PUT /api/heating-plants/:id/periods/:period/rules': 'Ausnahmen und Vereinbarungen, eine Zeile in heating_periods wie Warmwasser.',
  'PUT /api/heating-plants/:id/periods/:period/dhw-temperature': 'Eine Zeile in heating_periods wie Warmwasser.',
  'PUT /api/heating-plants/:id/monthly-info/:month': 'Monatliche Information, eine Zeile in heating_monthly_info.',
  'POST /api/fuel-deliveries/:id/reassign-credit': 'Braucht eine Gutschrift neben zwei Lieferungen; Zeilen in fuel_delivery_parts.',
  'PUT /api/properties/:id/degree-days': 'Gradtagzahlen, Zeilen in degree_day_values.',
  'PUT /api/heating-plants/:id/separate': 'Braucht Antworten je Mieter aus der Vorschau; die Sperre der Heizkostenabrechnung prüft api-ruecksprung über FROZEN_TABLES.',
  'POST /api/heating-settlement/:plant/:period/close': 'Braucht die getrennte Heizkostenabrechnung (siehe /separate); dieselbe Sperre wie bei der Abrechnung (FROZEN_TABLES).',
  'PUT /api/heating-settlement/:plant/:period/close': 'Wie POST …/close der Heizkostenabrechnung.',
  'DELETE /api/heating-settlement/:plant/:period/close': 'Wie POST …/close der Heizkostenabrechnung.',
  'PUT /api/heating-settlement/:plant/:period/letters/:tenancyId': 'Braucht die getrennte Heizkostenabrechnung; Zeilen wie das Anschreiben der Abrechnung.',
  'PUT /api/letter-design': 'Formular mit Dateien; die Dateien und den Papierkorb prüft api-ruecksprung.',
  'PUT /api/properties/:id/letter-design': 'Wie PUT /api/letter-design.',
  'POST /api/heating-settlement/:plant/:period/prepayment-steps': 'Braucht eine abgeschlossene getrennte Heizkostenabrechnung (siehe /separate); Zeilen wie die Übernahme der Abrechnung, die der Generator nimmt.',
  'POST /api/ai/cancel/:id': 'Braucht eine laufende KI-Auswertung (nachgebauter Dienst); die Verknüpfung der Gruppen prüft journal.test.ts.',
  'POST /api/extract': 'Braucht einen nachgebauten KI-Dienst; Zeilen wie Beleg hochladen und Auswertung.',
  'POST /api/intake': 'Wie /api/extract.',
  'POST /api/heating-plants/:id/service-statement': 'Wie /api/extract.',
  'POST /api/heating-plants/:id/fuel-invoice': 'Wie /api/extract.',
  'PUT /api/assessments/:id': 'Braucht eine Auswertung der KI.',
  'POST /api/assessments/:id/book': 'Braucht eine Auswertung der KI; Zeilen wie Kostenpositionen.',
}
export const UNCOVERED_MAX = 26
