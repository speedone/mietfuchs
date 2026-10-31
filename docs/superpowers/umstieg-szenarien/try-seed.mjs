import { startServer } from './lib.mjs'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
const dir = process.argv[2]
fs.rmSync(dir, { recursive: true, force: true })
const s = await startServer('v0131', dir, 3411, { NKA_TEST_IDS: 'seq' })
try { execFileSync(process.execPath, ['seed.mjs', s.base, `${dir}-ids.json`], { stdio: 'inherit', cwd: import.meta.dirname }) }
finally { if (process.argv[3] !== 'keep') await s.stop(); else { console.log('läuft', s.base, s.pid); } }
