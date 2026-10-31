// node restore-run.mjs <tree> <freshDir> <zip> <outDir>
import { startServer } from './lib.mjs'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
const [tree, dir, zip, outDir] = process.argv.slice(2)
fs.rmSync(dir, { recursive: true, force: true })
let s = await startServer(tree, dir, 3413)
try { execFileSync(process.execPath, ['restore.mjs', s.base, zip], { stdio: 'inherit', cwd: import.meta.dirname }) } finally { await s.stop() }
s = await startServer(tree, dir, 3413)
try { execFileSync(process.execPath, ['snapshot.mjs', s.base, outDir], { stdio: 'inherit', cwd: import.meta.dirname }) }
finally { fs.writeFileSync(`${outDir}.serverlog.txt`, s.log()); await s.stop() }
