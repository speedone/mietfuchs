// Betriebszustand für Container-Orchestratoren (GET /healthz).
//
// Mehr als „der Prozess läuft": Die Anwendung muss ihren Datenbestand lesen und in den
// Datenordner schreiben können. Erkannt werden eine beschädigte db.json und ein
// schreibgeschützter oder falsch berechtigter Datenordner. Ein nicht eingehängtes Volume
// erkennt die Prüfung nicht — Docker legt dann ein anonymes, beschreibbares an.
import fs from 'node:fs'
import path from 'node:path'

// Ist der Datenbestand lesbar? Eine fehlende db.json ist kein Fehler: Beim ersten Start legt
// store.js sie erst beim ersten Schreiben an. Ein Fehler ist eine vorhandene, aber unlesbare
// Datei.
function checkData(dataDir) {
  const file = path.join(dataDir, 'db.json')
  if (!fs.existsSync(file)) return { ok: true, detail: 'db.json noch nicht angelegt (erster Start)' }
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'))
    return { ok: true, detail: 'db.json lesbar' }
  } catch (err) {
    return { ok: false, detail: `db.json nicht lesbar: ${err.message}` }
  }
}

// Ist der Belegordner beschreibbar? Geprüft mit einem echten Schreibversuch statt fs.access:
// Auf Netzwerk-Dateisystemen und bei fremdem Volume-Eigentümer meldet die Rechteprüfung
// regelmäßig etwas anderes als der Schreibvorgang.
function checkUploads(dataDir) {
  const uploads = path.join(dataDir, 'uploads')
  const probe = path.join(uploads, `.health-${process.pid}`)
  try {
    fs.mkdirSync(uploads, { recursive: true })
    fs.writeFileSync(probe, '')
    fs.unlinkSync(probe)
    return { ok: true, detail: 'uploads beschreibbar' }
  } catch (err) {
    return { ok: false, detail: `uploads nicht beschreibbar: ${err.message}` }
  }
}

export function healthReport({ dataDir, version }) {
  const checks = { data: checkData(dataDir), uploads: checkUploads(dataDir) }
  const status = Object.values(checks).every((c) => c.ok) ? 'ok' : 'error'
  // `app` ist die Erkennungsmarke: Beim Start auf einem belegten Port fragt Mietfuchs hier
  // nach, ob dort schon Mietfuchs antwortet, und öffnet dann nur die Oberfläche (#45).
  return { app: 'mietfuchs', status, version, checks }
}
