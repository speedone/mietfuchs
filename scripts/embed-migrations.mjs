// Generiert server/src/db/embedded-migrations.js aus server/drizzle.
//
// Warum es das gibt: In der gepackten Bun-Programmdatei liegt der Code in einem virtuellen,
// schreibgeschützten Dateisystem, und Projektdateien wie `server/drizzle/0000_*.sql` sind dort
// nicht zu finden. Die Migrationen müssen also mit ins Binary. Von Hand in Konstanten
// abzuschreiben lädt dazu ein, dass Erzeugtes und Verwendetes auseinanderlaufen; deshalb dieser
// Schritt, der immer aus genau den Dateien liest, die drizzle-kit geschrieben hat.
//
// Dasselbe Muster wie scripts/embed-client.mjs: Erzeugt wird eine `.js`-Datei, die gitignoriert
// ist, und daneben liegt eine von Hand gepflegte `.d.ts` mit der Beschreibung. Anders ginge es
// nicht, denn `npm run typecheck` läuft auch im frisch geklonten Repo, in dem die erzeugte
// Datei noch gar nicht existiert.
//
// Der Inhalt wird als gewöhnliche Zeichenkette eingebettet und nicht per Importattribut wie
// beim Frontend: Es sind wenige Kilobyte SQL, und so ist das Modul unter Node wie unter Bun
// dasselbe und lässt sich in Tests ohne Bun lesen.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'server', 'drizzle')
const journalFile = path.join(migrationsDir, 'meta', '_journal.json')
const outFile = path.join(root, 'server', 'src', 'db', 'embedded-migrations.js')

if (!fs.existsSync(journalFile)) {
  console.error(`Journal fehlt (${journalFile}). Bitte erst "npm --prefix server run db:generate" ausführen.`)
  process.exit(1)
}

// Die Reihenfolge steht im Journal, nicht in der Sortierung der Dateinamen. Sie ist die einzige
// verlässliche Quelle dafür, in welcher Folge die Schritte angewendet werden müssen.
const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'))
const entries = journal.entries ?? []
if (entries.length === 0) {
  console.error('Das Journal führt keinen einzigen Schritt. Das kann nicht stimmen.')
  process.exit(1)
}

const migrations = entries.map((entry) => {
  const file = path.join(migrationsDir, `${entry.tag}.sql`)
  if (!fs.existsSync(file)) {
    console.error(`Das Journal nennt ${entry.tag}, die Datei fehlt aber (${file}).`)
    process.exit(1)
  }
  // Zeilenenden vereinheitlichen: Git stellt Textdateien beim Auschecken unter Windows auf
  // CRLF um, und dann hätte dieselbe Migration je nach Rechner einen anderen Inhalt, eine
  // andere Marke und ein anderes eingebettetes Modul. Dieselbe Normalisierung steht in
  // server/src/db/client.ts, damit beide Wege dasselbe ergeben.
  const sql = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  // Dieselbe Marke, die Drizzle für seine eigene Buchführung bildet: der SHA-256 über den
  // Inhalt der Datei. So lässt sich später erkennen, ob ein bereits angewendeter Schritt
  // nachträglich verändert wurde, was laut server/drizzle/README.md nie passieren darf.
  const hash = crypto.createHash('sha256').update(sql).digest('hex')
  // `--> statement-breakpoint` trennt die einzelnen Anweisungen. SQLite führt pro Aufruf nur
  // eine aus, deshalb wird hier schon zerlegt statt erst zur Laufzeit.
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
  return { tag: entry.tag, hash, folderMillis: entry.when, statements }
})

const lines = [
  '// AUTO-GENERIERT von scripts/embed-migrations.mjs, nicht von Hand bearbeiten.',
  '// Quelle: server/drizzle (siehe das README dort: nie ändern, nie löschen).',
  '',
  `export const migrations = ${JSON.stringify(migrations, null, 2)}`,
  '',
]

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, lines.join('\n'), 'utf8')
const statementCount = migrations.reduce((a, m) => a + m.statements.length, 0)
console.log(
  `✓ ${migrations.length} Migration(en) mit ${statementCount} Anweisungen eingebettet → ${path.relative(root, outFile)}`,
)
