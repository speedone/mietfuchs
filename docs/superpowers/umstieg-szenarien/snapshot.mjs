// Schnappschuss aller lesbaren Stände über die API. Aufruf: node snapshot.mjs <base> <outDir>
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { client, writeJson, S } from './lib.mjs'

const [base, out] = process.argv.slice(2)
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
const api = client(base)
const save = (name, v) => writeJson(path.join(out, `${name}.json`), v)
const tryGet = async (p) => { const r = await api.raw('GET', p); return r.ok ? (r.json ?? { _binary: r.buf.length, _type: r.type }) : { _status: r.status, _error: r.json?.error ?? r.buf.toString().slice(0, 200) } }

// ZIP-Inhalt mit Python lesen (Name, Größe, CRC; CSV/JSON-Text)
function zipListing(buf, tag) {
  const file = path.join(out, `${tag}.zip`)
  fs.writeFileSync(file, buf)
  const py = `
import zipfile,json,sys
z=zipfile.ZipFile(sys.argv[1]);o=[]
for i in z.infolist():
  e={'name':i.filename,'size':i.file_size,'crc':i.CRC}
  if i.filename.endswith(('.csv','.txt')): e['text']=z.read(i).decode('utf-8','replace')
  o.append(e)
print(json.dumps(o))`
  return JSON.parse(execFileSync('python3', ['-I', '-c', py, file]).toString())
}

save('settings', await api.get('/api/settings'))
const properties = await api.get('/api/properties')
save('properties', properties)
save('uploads', await tryGet('/api/uploads'))
save('co2-refunds', await tryGet('/api/co2-refunds'))
save('law-overrides', await tryGet('/api/law-overrides'))
save('heating-settlements', await tryGet('/api/heating-settlements'))

for (const p of properties) {
  const q = `?property=${p.id}`
  const dir = `prop-${p.name.replace(/\W+/g, '_')}`
  for (const coll of ['units', 'tenancies', 'costItems', 'meters', 'readings', 'payments']) save(`${dir}/${coll}`, await api.get(`/api/${coll}${q}`))
  const plants = await api.get(`/api/heating-plants${q}`)
  save(`${dir}/heating-plants`, plants)
  save(`${dir}/heating-settlements`, await tryGet(`/api/heating-settlements${q}`))
  for (let y = 2022; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, '0')}`
      const r = await api.raw('GET', `/api/settlement/${key}${q}`)
      if (r.status === 404) continue
      save(`${dir}/settlement-${key}`, r.ok ? r.json : { _status: r.status, _error: r.json })
      save(`${dir}/history-${key}`, await tryGet(`/api/settlement/${key}/history${q}`))
      save(`${dir}/consumption-${key}`, await tryGet(`/api/consumption/${key}${q}`))
      save(`${dir}/export-${key}`, await tryGet(`/api/settlement/${key}/export${q}&format=json`))
      save(`${dir}/letters-${key}`, await tryGet(`/api/settlement/${key}/letters${q}`))
      for (const pl of plants) save(`${dir}/plant-${pl.id}-periods-${key}`, await tryGet(`/api/heating-plants/${pl.id}/periods${q}&period=${key}`))
    }
  }
  for (let y = 2022; y <= 2026; y++) {
    save(`${dir}/rentledger-${y}`, await tryGet(`/api/rentledger/${y}${q}`))
    save(`${dir}/taxreport-${y}`, await tryGet(`/api/taxreport/${y}${q}`))
    const r = await api.raw('GET', `/api/receipts/tax/${y}${q}`)
    save(`${dir}/taxzip-${y}`, r.ok ? zipListing(r.buf, `${dir}/taxzip-${y}`) : { _status: r.status, _error: r.json?.error })
  }
}
const backup = await api.raw('GET', '/api/backup')
if (backup.ok) { fs.writeFileSync(path.join(out, 'backup.zip'), backup.buf); save('backup-listing', zipListing(backup.buf, 'backup-copy')) }
else save('backup-listing', { _status: backup.status })
console.log('Schnappschuss in', out)
