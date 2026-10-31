// Minimale Reproduktionen der Befunde. Aufruf: node repro.mjs [1|2|3]
import fs from 'node:fs'
import path from 'node:path'
import { startServer, client, textPdf, S } from './lib.mjs'

const only = process.argv[2]
const fresh = (n) => { const d = path.join(S, `data/repro-${n}`); fs.rmSync(d, { recursive: true, force: true }); return d }
const rows = async (api, P) => (await api.get(`/api/costItems?property=${P}`)).map((c) => `${c.period} ${String(c.amountCents).padStart(7)} ${c.description} src=${c.sourceId ? c.sourceId.slice(-4) : '-'} tax=${c.taxYear ?? '-'} file=${c.invoiceFile ? 'ja' : '-'}`).sort()
async function change(api, P, rules) {
  const pv = await api.post(`/api/properties/${P}/period/preview`, { rules })
  const groups = Object.fromEntries((pv.groups ?? []).map((g) => [g.id, g.suggested || g.options[0].key]))
  await api.put(`/api/properties/${P}/period`, { rules, answers: { token: pv.token, groups, understood: true } })
  return pv
}
async function setup(api) {
  const [p] = await api.get('/api/properties')
  const P = p.id
  const u1 = await api.post(`/api/units?property=${P}`, { name: 'A', areaM2: 60, participates: true })
  const u2 = await api.post(`/api/units?property=${P}`, { name: 'B', areaM2: 40, participates: true })
  for (const u of [u1, u2]) await api.post(`/api/tenancies?property=${P}`, { unitId: u.id, tenantName: `Mieter ${u.name}`, start: '2020-01-01', end: null, personHistory: [{ from: '2020-01-01', persons: 1 }], prepayments: [{ from: '2020-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [] })
  return P
}

// 1) main: Hin und zurück des Rhythmus. Zusammengeführter Teil behält die alte Spanne im Namen; Gutschrift wandert 1 Cent.
if (!only || only === '1') {
  const s = await startServer('main', fresh(1), 3421)
  const api = client(s.base)
  try {
    const P = await setup(api)
    await change(api, P, { startMonth: 1, changes: ['2025-07'] })
    await api.post(`/api/costItems/split?property=${P}`, { period: '2025-07', category: 'Sach- und Haftpflichtversicherung', description: 'Gebäudeversicherung', amountCents: 145531, key: 'area', serviceFrom: '2025-10-01', serviceTo: '2026-09-30', taxYear: 2026, paidOn: '2025-10-02', confirmPaidOn: true })
    await api.post(`/api/costItems/split?property=${P}`, { period: '2025-07', category: 'Sach- und Haftpflichtversicherung', description: 'Beitragsrückerstattung', amountCents: -12345, key: 'area', serviceFrom: '2025-10-01', serviceTo: '2026-09-30', taxYear: 2026 })
    console.log('== 1 vorher'); for (const r of await rows(api, P)) console.log('  ', r)
    await change(api, P, { startMonth: 1, changes: ['2025-07', '2026-01'] })
    console.log('== 1 nach Wechsel auf Kalenderjahr ab 2026'); for (const r of await rows(api, P)) console.log('  ', r)
    const pv = await change(api, P, { startMonth: 1, changes: ['2025-07'] })
    console.log('== 1 Vorschau zurück', JSON.stringify(pv.moves.map((m) => [m.description, m.parts.map((x) => [x.period, x.amountCents, x.mergedInto, x.mergeWithYear])])))
    console.log('== 1 nach Rückkehr zu 01.07.'); for (const r of await rows(api, P)) console.log('  ', r)
  } finally { await s.stop() }
}

// 2) 0.13.1 → main: Beleg nachträglich nur an einem Teil. Datenschritt 0077 gibt keinem Teil eine Quelle; Steuer-ZIP und
//    Belegkopien nennen für den anderen Teil keinen Beleg. Gegenprobe: dieselben Schritte frisch in main.
async function case2(tree, port, dir) {
  const s = await startServer(tree, dir, port)
  const api = client(s.base)
  try {
    const P = await setup(api)
    const parts = await api.post(`/api/costItems/split?property=${P}`, { period: '2024-01', category: 'Sach- und Haftpflichtversicherung', description: 'Gebäudeversicherung', vendor: 'Nordversicherung', amountCents: 120000, key: 'area', serviceFrom: '2024-10-01', serviceTo: '2025-09-30' })
    const fd = new FormData()
    fd.append('file', new Blob([textPdf('Beitragsrechnung')], { type: 'application/pdf' }), 'Beitragsrechnung.pdf')
    fd.append('propertyId', P); fd.append('year', '2025')
    const file = (await api.post('/api/upload', fd)).file
    const p2025 = parts.find((c) => c.period === '2025-01')
    await api.put(`/api/costItems/${p2025.id}?property=${P}`, { invoiceFile: file })
    return P
  } finally { await s.stop() }
}
async function taxZipLine(tree, port, dir, P) {
  const s = await startServer(tree, dir, port)
  const api = client(s.base)
  try {
    console.log(`  Zeilen (${tree}):`); for (const r of await rows(api, P)) console.log('    ', r)
    const z = await api.raw('GET', `/api/receipts/tax/2024?property=${P}`)
    const zipFile = `${dir}-tax2024.zip`; fs.writeFileSync(zipFile, z.buf)
    const { execFileSync } = await import('node:child_process')
    const csv = execFileSync('python3', ['-I', '-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print([n for n in z.namelist()]);print(z.read([n for n in z.namelist() if n.endswith(".csv")][0]).decode())', zipFile]).toString()
    console.log('  Steuer-ZIP 2024:', csv.split('\n').filter((l) => l.includes('Gebäudeversicherung') || l.startsWith('[')).join(' | '))
  } finally { await s.stop() }
}
if (!only || only === '2') {
  console.log('== 2 Upgrade-Weg (0.13.1 anlegen, main starten)')
  const d = fresh('2-upgrade')
  const P = await case2('v0131', 3422, d)
  await taxZipLine('main', 3423, d, P)
  console.log('== 2 Gegenprobe (frisch in main)')
  const d2 = fresh('2-main')
  const P2 = await case2('main', 3424, d2)
  await taxZipLine('main', 3424, d2, P2)
}

// 3) 0.13.1 → main: zweimal erfasste Rechnung (Doppelung), in 0.13.1 durch einen Wechsel des Rhythmus geteilt. 0077 legt alle
//    vier Teile in eine Quelle; der nächste Wechsel in main fasst die beiden Rechnungen zu einer Zeile zusammen.
if (!only || only === '3') {
  const d = fresh(3)
  let s = await startServer('v0131', d, 3425)
  let api = client(s.base)
  let P
  try {
    P = await setup(api)
    for (let i = 0; i < 2; i++) await api.post(`/api/costItems?property=${P}`, { period: '2025-01', category: 'Schornsteinfeger', description: 'Feuerstättenschau', amountCents: 8925, key: 'area' })
    const dup = (await api.get(`/api/settlement/2025-01?property=${P}`)).notices.filter((n) => n.code === 'cost.possible-duplicate').length
    console.log('== 3 0.13.1 Doppelungs-Hinweise vor dem Wechsel:', dup)
    await change(api, P, { startMonth: 1, changes: ['2025-07'] })
    console.log('== 3 0.13.1 nach Wechsel'); for (const r of await rows(api, P)) console.log('  ', r)
  } finally { await s.stop() }
  s = await startServer('main', d, 3426)
  api = client(s.base)
  try {
    console.log('== 3 main nach Upgrade'); for (const r of await rows(api, P)) console.log('  ', r)
    for (const k of ['2025-01', '2025-07']) console.log(`   Doppelungs-Hinweise ${k}:`, (await api.get(`/api/settlement/${k}?property=${P}`)).notices.filter((n) => n.code === 'cost.possible-duplicate').length)
    await change(api, P, { startMonth: 1, changes: ['2025-07', '2026-01'] })
    console.log('== 3 main nach nächstem Wechsel'); for (const r of await rows(api, P)) console.log('  ', r)
    console.log('   Doppelungs-Hinweise 2025-07:', (await api.get(`/api/settlement/2025-07?property=${P}`)).notices.filter((n) => n.code === 'cost.possible-duplicate').length)
  } finally { await s.stop() }
}
