// d) Neues Verhalten auf dem migrierten Bestand in main. Aufruf: node phase-d.mjs <dataDir(Kopie von main-upgrade)> <out.json>
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { startServer, client, writeJson, TREES } from './lib.mjs'
import path from 'node:path'

const [dir, outFile] = process.argv.slice(2)
const ids = JSON.parse(fs.readFileSync(path.join(path.dirname(outFile), '..', 'data', 'v0131-ids.json'))).ids
const { settledInvoiceFiles } = await import(path.join(TREES.main, 'client/src/costPeriods.ts'))
const s = await startServer('main', dir, 3414)
const api = client(s.base)
const report = { findings: [], steps: [] }
const note = (k, v) => { report.steps.push({ k, v }); console.log('·', k, typeof v === 'string' ? v : JSON.stringify(v).slice(0, 300)) }
const finding = (sev, title, detail) => { report.findings.push({ sev, title, detail }); console.log(`!! [${sev}] ${title}`, JSON.stringify(detail).slice(0, 400)) }
const B = ids.B, q = (p) => `?property=${p}`
const sql = (query) => JSON.parse(execFileSync('python3', ['-I', '-c', `import sqlite3,json,sys;c=sqlite3.connect(sys.argv[1]);print(json.dumps(c.execute(sys.argv[2]).fetchall()))`, path.join(dir, 'mietfuchs.sqlite'), query]).toString())

const items = async (P) => api.get(`/api/costItems${q(P)}`)
const property = async (P) => (await api.get('/api/properties')).find((p) => p.id === P)
const periodsOf = async (P) => {
  const out = []
  for (let y = 2022; y <= 2027; y++) for (let m = 1; m <= 12; m++) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    const r = await api.raw('GET', `/api/settlement/${key}${q(P)}`)
    if (r.ok) out.push({ key, s: r.json })
  }
  return out
}
// Invarianten je Abrechnung: je Position Mieteranteile + Vermieteranteil = Betrag; keine Anteile gegen das Vorzeichen; Summe
function invariants(label, st) {
  const bad = []
  const rows = new Map()
  for (const t of st.statements) for (const r of t.rows) { const e = rows.get(r.costItemId) ?? { total: r.totalCents, tenants: 0, landlord: 0 }; e.tenants += r.shareCents; rows.set(r.costItemId, e); if (Math.sign(r.shareCents) * Math.sign(r.totalCents) < 0) bad.push({ label, neg: r }) }
  for (const r of st.landlord.rows) { const e = rows.get(r.costItemId) ?? { total: r.totalCents, tenants: 0, landlord: 0 }; e.landlord += r.shareCents; rows.set(r.costItemId, e); if (Math.sign(r.shareCents) * Math.sign(r.totalCents) < 0) bad.push({ label, negLandlord: r }) }
  // CO₂-Umbuchung (kind co2Relief): Mieter −x, Vermieter +x, Summe 0
  for (const [id, e] of rows) if (id.startsWith('co2:') ? e.tenants + e.landlord !== 0 : e.tenants + e.landlord !== e.total) bad.push({ label, id, ...e })
  const sumT = st.statements.reduce((a, t) => a + t.totalShareCents, 0)
  if (sumT + st.landlord.totalCents !== st.totalCostsCents) bad.push({ label, sumT, landlord: st.landlord.totalCents, total: st.totalCostsCents })
  return bad
}
async function checkAll(tag) {
  const bad = []
  for (const P of [ids.A, ids.B, ids.C, ids.D]) for (const { key, s: st } of await periodsOf(P)) if (!st.closed) bad.push(...invariants(`${tag} ${P} ${key}`, st))
  note(`Invarianten ${tag}`, bad.length === 0 ? 'ok' : bad)
  if (bad.length) finding('Geld', `Invariante verletzt (${tag})`, bad.slice(0, 5))
}
// Summen je Quelle, je Kostenart, je Zeitraum×Kostenart, und der ganzen Bestand von B
async function ledger(P) {
  const all = await items(P)
  const by = (f) => all.reduce((m, c) => { const k = f(c); m[k] = (m[k] ?? 0) + c.amountCents; return m }, {})
  return {
    count: all.length,
    total: all.reduce((a, c) => a + c.amountCents, 0),
    labor: all.reduce((a, c) => a + (c.labor35aCents ?? 0), 0),
    byCategory: by((c) => c.category),
    byPeriodCategory: by((c) => `${c.period}|${c.category}`),
    bySource: by((c) => c.sourceId ?? `-${c.id}`),
    rows: all.map((c) => `${c.period} ${c.amountCents} ${c.description} src=${c.sourceId ?? '-'} tax=${c.taxYear ?? '-'} file=${c.invoiceFile ? 'ja' : '-'}`).sort(),
  }
}
async function changePeriod(P, rules, label) {
  const preview = await api.raw('POST', `/api/properties/${P}/period/preview`, { rules })
  if (!preview.ok) { note(`${label} Vorschau`, { status: preview.status, err: preview.json }); return { ok: false, preview: preview.json } }
  fs.writeFileSync(`${outFile}.${label.replace(/\W+/g, '_')}.preview.json`, JSON.stringify(preview.json, null, 1))
  const groups = Object.fromEntries((preview.json.groups ?? []).map((g) => [g.id, g.suggested || g.options[0].key]))
  const r = await api.raw('PUT', `/api/properties/${P}/period`, { rules, answers: { token: preview.json.token, groups, understood: true } })
  note(`${label} anwenden`, r.ok ? 'ok' : { status: r.status, err: r.json?.error })
  return { ok: r.ok, preview: preview.json, err: r.json?.error }
}
const diffLedger = (a, b) => {
  const out = {}
  for (const k of ['count', 'total', 'labor']) if (a[k] !== b[k]) out[k] = [a[k], b[k]]
  for (const k of ['byCategory', 'byPeriodCategory', 'bySource']) {
    const d = {}
    for (const x of new Set([...Object.keys(a[k]), ...Object.keys(b[k])])) if ((a[k][x] ?? 0) !== (b[k][x] ?? 0)) d[x] = [a[k][x] ?? 0, b[k][x] ?? 0]
    if (Object.keys(d).length) out[k] = d
  }
  return out
}

try {
  await checkAll('nach Upgrade')

  // ---- Hinweis auf doppelte Positionen ----
  const dupes = async (P, key) => (await api.get(`/api/settlement/${key}${q(P)}`)).notices.filter((n) => n.code === 'cost.possible-duplicate').map((n) => n.text.slice(0, 140))
  note('Doppelte B 2025-07 (Feuerstättenschau zweimal erfasst)', await dupes(B, '2025-07'))

  // ---- Belegkopien (Client-Logik aus costPeriods.ts) ----
  const rulesB = (p) => p.periodRules
  const pB = await property(B)
  note('B Regeln', pB?.periodRules)
  const allB = await items(B)
  for (const key of ['2024-01', '2025-01', '2025-07']) {
    const st = await api.get(`/api/settlement/${key}${q(B)}`)
    const files = settledInvoiceFiles(st, allB, rulesB(pB))
    note(`Belegkopien B ${key}`, files)
  }
  const st2024 = await api.get(`/api/settlement/2024-01${q(B)}`)
  if (settledInvoiceFiles(st2024, allB, rulesB(pB)).length === 0) {
    finding('Anzeige', 'Belegkopien 2024 ohne die Versicherungsrechnung: Teil 2024 ohne Quelle nach 0077 (Beleg nachträglich an einem Teil)', { part: '…27b', note: 'Familie im Datenschritt nach invoiceFile getrennt' })
  }
  // Steuer-ZIP 2024: Teil 2024 der Versicherung mit Beleg?
  const zip = await api.raw('GET', `/api/receipts/tax/2024${q(B)}`)
  fs.writeFileSync(`${outFile}.taxzip-B-2024.zip`, zip.buf)
  const csv = execFileSync('python3', ['-I', '-c', `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.read([n for n in z.namelist() if n.endswith('.csv')][0]).decode())`, `${outFile}.taxzip-B-2024.zip`]).toString()
  const line = csv.split('\n').find((l) => l.includes('Gebäudeversicherung (anteilig 01.10.–31.12.2024)'))
  note('Steuer-ZIP 2024 Zeile Teil 2024', line)
  if (line?.includes('kein Beleg')) finding('Anzeige', 'Steuer-ZIP 2024: Teil der Versicherung „kein Beleg“, obwohl die Teile 2025 den Beleg tragen (#469 greift nicht für migrierte Teile ohne Quelle)', { line })

  // ---- Wechsel des Rhythmus auf dem migrierten Bestand ----
  const before = await ledger(B)
  writeJson(`${outFile}.ledger-0.json`, before)
  let gutschriftWeg = null
  let r1 = await changePeriod(B, { startMonth: 1, changes: ['2025-07', '2026-01'] }, 'B Wechsel zurück aufs Kalenderjahr ab 2026')
  if (!r1.ok && /mehr abgezogen/.test(r1.err ?? '')) {
    finding('Funktion', 'Wechsel des Abrechnungszeitraums blockiert durch eine Gutschrift (negativer Betrag), obwohl kein Betriebsstrom-Abzug existiert', { err: r1.err })
    // Umgehung: Gutschrift-Teile löschen, nach dem Hin und Zurück wieder aufteilen
    gutschriftWeg = (await items(B)).filter((c) => c.amountCents < 0)
    for (const c of gutschriftWeg) await api.del(`/api/costItems/${c.id}${q(B)}`)
    note('Gutschrift-Teile gelöscht', gutschriftWeg.map((c) => [c.id, c.amountCents]))
    note('Quelle der Gutschrift nach Löschen aller Teile', sql(`select * from cost_sources where id='${gutschriftWeg[0]?.sourceId}'`))
    r1 = await changePeriod(B, { startMonth: 1, changes: ['2025-07', '2026-01'] }, 'B Wechsel zurück aufs Kalenderjahr ab 2026 (2)')
  }
  const mid = await ledger(B)
  writeJson(`${outFile}.ledger-1.json`, mid)
  const base0 = gutschriftWeg ? { ...before, count: before.count - gutschriftWeg.length, total: before.total - gutschriftWeg.reduce((a, c) => a + c.amountCents, 0) } : before
  note('Nach Wechsel 1: Summe/Arten', { total: [base0.total, mid.total], labor: [before.labor, mid.labor], count: [base0.count, mid.count] })
  if (mid.total !== base0.total) finding('Geld', 'Wechsel 1 ändert die Summe aller Positionen', { before: base0.total, after: mid.total })
  for (const [cat, v] of Object.entries(before.byCategory)) {
    const expect = v - (gutschriftWeg ?? []).filter((c) => c.category === cat).reduce((a, c) => a + c.amountCents, 0)
    if ((mid.byCategory[cat] ?? 0) !== expect) finding('Geld', `Wechsel 1: Kostenart ${cat} ändert sich`, [expect, mid.byCategory[cat]])
  }
  if (mid.labor !== before.labor) finding('Geld', 'Wechsel 1: §35a-Summe ändert sich', [before.labor, mid.labor])
  note('Zeilen nach Wechsel 1', mid.rows)
  await checkAll('nach Wechsel 1')

  const r2 = await changePeriod(B, { startMonth: 1, changes: ['2025-07'] }, 'B Wechsel wieder zurück auf 01.07.')
  const after = await ledger(B)
  writeJson(`${outFile}.ledger-2.json`, after)
  note('Nach Hin und Zurück: Unterschiede zum Stand davor (ohne Gutschrift)', diffLedger(base0, after))
  if (after.total !== base0.total) finding('Geld', 'Hin und Zurück ändert die Summe aller Positionen', [base0.total, after.total])
  const shifted = Object.entries(diffLedger(base0, after).byPeriodCategory ?? {})
  if (shifted.length) note('Hin und Zurück: Verschiebung je Zeitraum×Kostenart', shifted)
  note('Zeilen nach Hin und Zurück', after.rows)
  if (after.count !== base0.count) note('Zeilenzahl nach Hin und Zurück', [base0.count, after.count])
  await checkAll('nach Hin und Zurück')
  // Gutschrift wieder anlegen
  if (gutschriftWeg) {
    const g = await api.post(`/api/costItems/split${q(B)}`, { period: '2025-07', category: 'Sach- und Haftpflichtversicherung', description: 'Beitragsrückerstattung Gebäudeversicherung', vendor: 'Nordversicherung', amountCents: -12345, key: 'area', serviceFrom: '2025-10-01', serviceTo: '2026-09-30', taxYear: 2026 })
    note('Gutschrift neu aufgeteilt', g.map((c) => [c.period, c.amountCents, c.sourceId]))
  }
  note('cost_sources nach d)', sql("select s.id, count(ci.id), sum(ci.amount_cents) from cost_sources s left join cost_items ci on ci.source_id=s.id group by s.id order by s.id"))
  note('verwaiste Quellen', sql("select id from cost_sources where id not in (select source_id from cost_items where source_id is not null)"))
  note('foreign_key_check', sql('PRAGMA foreign_key_check'))

  // ---- Einen Teil berichtigen, ändern, löschen ----
  const cur = await items(B)
  const part = cur.find((c) => c.sourceId && c.category === 'Gartenpflege')
  if (part) {
    const fam = cur.filter((c) => c.sourceId === part.sourceId)
    note('Gartenpflege Familie', fam.map((c) => [c.id, c.period, c.amountCents, c.description]))
    const fix = await api.raw('PUT', `/api/costItems/${part.id}${q(B)}`, { amountCents: part.amountCents + 50 })
    note('Teil berichtigen (Betrag +50)', fix.ok ? 'ok' : fix.json)
    const cat = await api.raw('PUT', `/api/costItems/${part.id}${q(B)}`, { category: 'Hauswart' })
    note('Teil: Kostenart ändern (erwartet abgelehnt)', { status: cat.status, err: cat.json?.error?.slice(0, 200) })
    if (cat.ok) finding('Daten', 'Kostenart eines Teils mit Quelle ließ sich ändern', {})
    const svc = await api.raw('PUT', `/api/costItems/${part.id}${q(B)}`, { serviceFrom: '2025-04-01' })
    note('Teil: Leistungszeitraum ändern (erwartet abgelehnt)', { status: svc.status, err: svc.json?.error?.slice(0, 200) })
    if (svc.ok) finding('Daten', 'Leistungszeitraum eines Teils mit Quelle ließ sich ändern', {})
    const resplit = await api.raw('POST', `/api/costItems/${part.id}/split/preview${q(B)}`, {})
    note('Teil erneut aufteilen (Vorschau, erwartet abgelehnt)', { status: resplit.status, err: resplit.json?.error?.slice(0, 200) })
    for (const [i, c] of fam.entries()) {
      const d = await api.raw('DELETE', `/api/costItems/${c.id}${q(B)}`)
      note(`Teil ${i + 1}/${fam.length} löschen`, { status: d.status, source: sql(`select count(*) from cost_sources where id='${part.sourceId}'`) })
    }
  }
  // Lone part ohne Quelle (Versicherung 2024 ohne Beleg): berichtigen
  const lone = (await items(B)).find((c) => c.category === 'Sach- und Haftpflichtversicherung' && c.period === '2024-01' && !c.sourceId && c.serviceFrom)
  if (lone) {
    const r = await api.raw('PUT', `/api/costItems/${lone.id}${q(B)}`, { invoiceFile: ids.versBeleg })
    note('Teil ohne Quelle: Beleg nachtragen', r.ok ? { ok: true, sourceId: r.json?.sourceId ?? null } : r.json)
  }

  // ---- Steuer-ZIP aller Jahre nach d) ----
  for (const y of [2024, 2025, 2026]) {
    const z = await api.raw('GET', `/api/receipts/tax/${y}${q(B)}`)
    note(`Steuer-ZIP B ${y}`, { status: z.status, bytes: z.buf.length })
    const t = await api.raw('GET', `/api/taxreport/${y}${q(B)}`)
    note(`Steuer B ${y} Werbungskosten`, t.ok ? JSON.stringify(t.json).match(/"(totalCents|deductibleCents|expensesCents)":-?\d+/g)?.slice(0, 6) : t.status)
  }
  await checkAll('Ende d)')
} catch (e) {
  finding('Skript', 'Abbruch', String(e.stack))
} finally {
  writeJson(outFile, report)
  fs.writeFileSync(`${outFile}.serverlog.txt`, s.log())
  await s.stop()
}
