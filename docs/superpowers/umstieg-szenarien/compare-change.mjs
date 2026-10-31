// Derselbe Wechsel (hin und zurück) auf 0.13.1 und auf main, ausgehend vom selben Bestand. Vergleicht Zeilen und Steuer.
// Aufruf: node compare-change.mjs
import fs from 'node:fs'
import path from 'node:path'
import { startServer, client, writeJson, S } from './lib.mjs'

const ids = JSON.parse(fs.readFileSync(path.join(S, 'data/v0131-ids.json'))).ids
const B = ids.B, q = `?property=${ids.B}`
const out = {}
for (const [tree, src, port] of [['v0131', 'data/v0131', 3415], ['main', 'data/main-upgrade', 3416]]) {
  const dir = path.join(S, `data/cmp-${tree}`)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.cpSync(path.join(S, src), dir, { recursive: true })
  const s = await startServer(tree, dir, port)
  const api = client(s.base)
  const state = async () => {
    const items = await api.get(`/api/costItems${q}`)
    const tax = {}
    for (const y of [2024, 2025, 2026, 2027]) {
      const t = await api.get(`/api/taxreport/${y}${q}`)
      tax[y] = JSON.stringify(t).match(/"totalCents":-?\d+/g)?.at(-1) ?? null
      tax[`${y}-full`] = t
    }
    const settlements = {}
    for (const key of ['2025-07', '2026-01', '2026-07']) {
      const r = await api.raw('GET', `/api/settlement/${key}${q}`)
      if (r.ok) settlements[key] = { total: r.json.totalCostsCents, tenants: r.json.statements.map((t) => [t.tenantName, t.totalShareCents, t.balanceCents]) }
    }
    return {
      rows: items.map((c) => `${c.period} ${String(c.amountCents).padStart(7)} ${c.description} tax=${c.taxYear ?? '-'} paid=${c.paidOn ?? '-'}`).sort(),
      total: items.reduce((a, c) => a + c.amountCents, 0), tax, settlements,
    }
  }
  if (process.argv[2] === 'ohne-gutschrift') for (const c of await api.get(`/api/costItems${q}`)) if (c.amountCents < 0) await api.del(`/api/costItems/${c.id}${q}`)
  const steps = { start: await state() }
  for (const [label, rules] of [['W1', { startMonth: 1, changes: ['2025-07', '2026-01'] }], ['W2', { startMonth: 1, changes: ['2025-07'] }]]) {
    const pv = await api.raw('POST', `/api/properties/${B}/period/preview`, { rules })
    if (!pv.ok) { steps[label] = { previewError: pv.json }; break }
    const groups = Object.fromEntries((pv.json.groups ?? []).map((g) => [g.id, g.suggested || g.options[0].key]))
    const r = await api.raw('PUT', `/api/properties/${B}/period`, { rules, answers: { token: pv.json.token, groups, understood: true } })
    steps[label] = r.ok ? { ...(await state()), taxYearsAsked: pv.json.taxYears?.map((t) => `${t.description}|${t.period}→${t.suggested}`) } : { applyError: r.json?.error }
  }
  out[tree] = steps
  await s.stop()
}
writeJson(path.join(S, `snap/compare-change${process.argv[2] ? '-' + process.argv[2] : ''}.json`), out)
for (const step of ['start', 'W1', 'W2']) {
  console.log(`===== ${step}`)
  for (const tree of ['v0131', 'main']) {
    const st = out[tree][step]
    if (!st) { console.log(tree, '–'); continue }
    if (st.applyError || st.previewError) { console.log(tree, 'FEHLER', JSON.stringify(st.applyError ?? st.previewError).slice(0, 300)); continue }
    console.log(tree, 'Summe', st.total, 'Steuer', [2024, 2025, 2026, 2027].map((y) => `${y}:${st.tax[y]}`).join(' '), 'Abr', JSON.stringify(st.settlements))
  }
}
