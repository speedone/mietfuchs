// node snap-run.mjs <tree> <dataDir> <outDir> [port]
import { startServer } from './lib.mjs'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
const [tree, dir, outDir, port = '3412'] = process.argv.slice(2)
const s = await startServer(tree, dir, Number(port))
try { execFileSync(process.execPath, ['snapshot.mjs', s.base, outDir], { stdio: 'inherit', cwd: import.meta.dirname }) }
finally { fs.writeFileSync(`${outDir}.serverlog.txt`, s.log()); await s.stop() }
