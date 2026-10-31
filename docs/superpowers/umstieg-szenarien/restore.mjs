// node restore.mjs <base> <backup.zip>
import fs from 'node:fs'
const [base, zip] = process.argv.slice(2)
const fd = new FormData()
fd.append('file', new Blob([fs.readFileSync(zip)], { type: 'application/zip' }), 'backup.zip')
const r = await fetch(`${base}/api/restore`, { method: 'POST', body: fd })
console.log('restore', r.status, (await r.text()).slice(0, 500))
if (!r.ok) process.exit(1)
