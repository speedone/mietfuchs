// Vergleicht zwei Schnappschuss-Ordner. Aufruf: node diff.mjs <a> <b> <out.json>
// Jede Abweichung als Pfad mit Art: added (nur in b), removed (nur in a), changed. Geld-Felder werden markiert.
import fs from 'node:fs'
import path from 'node:path'

const [A, B, outFile] = process.argv.slice(2)
const walk = (d, pre = '') => fs.readdirSync(path.join(d, pre), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(d, path.join(pre, e.name)) : e.name.endsWith('.json') ? [path.join(pre, e.name)] : [])
const fa = new Set(walk(A)), fb = new Set(walk(B))
const MONEY = /cents|Cents|amount|Amount|total|Total|balance|Balance|sum|Sum|share|Share|due|Due|credit|Credit|refund|price|euro|Euro/
const diffs = []
// Kennungen, die sich zwischen Läufen ändern dürfen (Zeitstempel, Prüfsummen von Dateien, Marken)
const VOLATILE = /^(closedAt|createdAt|updatedAt|uploadedAt|at|token|errorToken|asOf|generatedAt|version|checkedAt|mtime|modified|crc|size)$/
function cmp(file, p, a, b) {
  if (JSON.stringify(a) === JSON.stringify(b)) return
  const last = p[p.length - 1] ?? ''
  if (a === undefined) return diffs.push({ file, path: p.join('.'), kind: 'added', b: short(b), money: MONEY.test(p.join('.')) })
  if (b === undefined) return diffs.push({ file, path: p.join('.'), kind: 'removed', a: short(a), money: MONEY.test(p.join('.')) })
  if (Array.isArray(a) && Array.isArray(b)) {
    // Listen von Objekten mit id/costItemId/tenancyId nach Kennung paaren
    const keyOf = (x) => x && typeof x === 'object' ? (x.id ?? x.costItemId ?? x.tenancyId ?? x.key ?? x.name ?? x.code ?? null) : null
    const ka = a.map(keyOf), kb = b.map(keyOf)
    const unique = (k) => k.every((x) => x !== null) && new Set(k.map(String)).size === k.length
    if (unique(ka) && unique(kb) && ka.length + kb.length > 0) {
      const mb = new Map(b.map((x, i) => [String(kb[i]), x]))
      const ma = new Map(a.map((x, i) => [String(ka[i]), x]))
      for (const [k, x] of ma) cmp(file, [...p, `[${k}]`], x, mb.get(k))
      for (const [k, x] of mb) if (!ma.has(k)) cmp(file, [...p, `[${k}]`], undefined, x)
      return
    }
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i++) cmp(file, [...p, String(i)], a[i], b[i])
    return
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) cmp(file, [...p, k], a[k], b[k])
    return
  }
  diffs.push({ file, path: p.join('.'), kind: 'changed', a: short(a), b: short(b), money: MONEY.test(last) && (typeof a === 'number' || typeof b === 'number'), volatile: VOLATILE.test(last) })
}
const short = (v) => { const s = JSON.stringify(v); return s && s.length > 400 ? `${s.slice(0, 400)}…` : v }
for (const f of [...new Set([...fa, ...fb])].sort()) {
  if (!fa.has(f)) { diffs.push({ file: f, kind: 'file-added' }); continue }
  if (!fb.has(f)) { diffs.push({ file: f, kind: 'file-removed' }); continue }
  cmp(f, [], JSON.parse(fs.readFileSync(path.join(A, f))), JSON.parse(fs.readFileSync(path.join(B, f))))
}
fs.writeFileSync(outFile, JSON.stringify(diffs, null, 1))
const by = (pred) => diffs.filter(pred).length
console.log(`Abweichungen: ${diffs.length} (added ${by((d) => d.kind === 'added')}, removed ${by((d) => d.kind === 'removed')}, changed ${by((d) => d.kind === 'changed')}, davon Geld-changed ${by((d) => d.kind === 'changed' && d.money)}, flüchtig ${by((d) => d.volatile)}, Dateien +${by((d) => d.kind === 'file-added')}/-${by((d) => d.kind === 'file-removed')})`)
