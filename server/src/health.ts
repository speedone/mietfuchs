// Betriebszustand für Container-Orchestratoren (GET /healthz).
//
// Mehr als „der Prozess läuft": Die Anwendung muss ihren Datenbestand lesen und in den
// Datenordner schreiben können. Erkannt werden eine beschädigte db.json und ein
// schreibgeschützter oder falsch berechtigter Datenordner. Ein nicht eingehängtes Volume
// erkennt die Prüfung nicht — Docker legt dann ein anonymes, beschreibbares an.
import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseState } from '../../shared/types.ts'

type Check = { ok: boolean, detail: string }

// Ist der Datenbestand lesbar? Eine fehlende db.json ist kein Fehler: Beim ersten Start legt
// store.ts sie erst beim ersten Schreiben an. Ein Fehler ist eine vorhandene, aber unlesbare
// Datei.
function checkData(dataDir: string): Check {
  const file = path.join(dataDir, 'db.json')
  if (!fs.existsSync(file)) return { ok: true, detail: 'db.json noch nicht angelegt (erster Start)' }
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'))
    return { ok: true, detail: 'db.json lesbar' }
  } catch (err) {
    return { ok: false, detail: `db.json nicht lesbar: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// Ist der Belegordner beschreibbar? Geprüft mit einem echten Schreibversuch statt fs.access:
// Auf Netzwerk-Dateisystemen und bei fremdem Volume-Eigentümer meldet die Rechteprüfung
// regelmäßig etwas anderes als der Schreibvorgang.
function checkUploads(dataDir: string): Check {
  const uploads = path.join(dataDir, 'uploads')
  const probe = path.join(uploads, `.health-${process.pid}`)
  try {
    fs.mkdirSync(uploads, { recursive: true })
    fs.writeFileSync(probe, '')
    fs.unlinkSync(probe)
    return { ok: true, detail: 'uploads beschreibbar' }
  } catch (err) {
    return { ok: false, detail: `uploads nicht beschreibbar: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// Was beim Start mit der Datenbank geschehen ist (#55). Der Bericht nennt es aus zwei Gründen.
// Erstens sehen es die Prüfläufe von außen: Sie laufen auf jeder Programmdatei und in den
// Containern von 22 Distributionen, und nur dort zeigt sich, ob das eingebaute SQLite überall
// trägt. Zweitens liest die Oberfläche daraus, was beim Umstieg der Daten geschehen ist — beim
// Start aus einem Linux-Paket gibt es keine Konsole, auf der die Meldung sonst stünde.
//
// Der Typ steht in shared/types.ts, weil beide Seiten dasselbe brauchen.
export type { DatabaseState }

// ---------- Trägt die Datenbank den Bestand? ----------
//
// Die Frage hat zwei Leser, und beide müssen dieselbe Antwort bekommen: der Zustandsbericht und
// die Datenrouten in index.ts. Deshalb steht sie hier einmal und liefert gleich den Grund mit,
// denn der Nutzer soll im Browser lesen, was los ist, und nicht nur ein „geht gerade nicht".

export const NO_DATABASE =
  'Mietfuchs hat keine Verbindung zu seiner Datenbank, deshalb lässt sich gerade nichts lesen ' +
  'oder speichern. Woran es liegt, steht in der Meldung beim Start und im Cockpit. An Ihren ' +
  'Daten ist nichts verändert.'

// **Der gescheiterte Umstieg sperrt, statt eine leere Datenbank auszugeben.** Das ist die
// Umkehrung der Regel, die galt, solange die Routen aus der db.json lasen: Damals war
// Weitermachen besser als Blockieren. Jetzt wäre die Antwort einer leeren Datenbank keine
// Auskunft über einen leeren Bestand, sondern eine falsche über einen vorhandenen. Schlimmer
// noch: Was der Vermieter in das leere Haus hineinschriebe, stünde danach als zweiter Bestand
// da, und seine db.json wäre für immer abgehängt, denn der nächste Umstieg unterbleibt, sobald
// in der Datenbank etwas steht. Von den beiden Zusagen aus changeover.ts gewinnt hier also die
// zweite: nie Daten verlieren, notfalls auf Kosten des Weiterarbeitens.
export const CHANGEOVER_PENDING =
  'Ihre Daten sind noch nicht in die Datenbank übernommen worden, deshalb zeigt Mietfuchs sie ' +
  'gerade nicht an. Woran es lag, steht im Cockpit und in der Datei umstieg-protokoll.txt im ' +
  'Datenordner. An Ihren Daten ist nichts verändert: Sie stehen unverändert in der Datei ' +
  'db.json, und beim nächsten Start wird es erneut versucht.'

// Der Grund, oder `null`, wenn die Datenbank den Bestand trägt.
export function databaseUnavailable(database: DatabaseState): string | null {
  if (!database.open) return NO_DATABASE
  if (database.changeover.state === 'failed') return CHANGEOVER_PENDING
  return null
}

export function healthReport({ dataDir, version, database }: { dataDir: string, version: string, database?: DatabaseState }) {
  // **Die Datenbank zählt jetzt mit**, und das ist die angekündigte Umkehrung. Solange die
  // fachlichen Daten in der db.json lagen, arbeitete Mietfuchs ohne die Datenbank weiter, und
  // ein Fehler dort durfte keinen Container in eine Neustart-Schleife schicken. Seit die Routen
  // aus ihr lesen, ist ein Start ohne sie ein Start ohne Daten: Wer den Bericht abfragt, soll
  // genau das erfahren und nicht ein „ok", hinter dem nichts steht.
  //
  // Gefragt wird nach demselben Grund, den auch die Routen nennen. Ein Bericht, der „ok" sagt,
  // während jede Datenroute mit 503 antwortet, wäre die unbrauchbarste Auskunft von beiden.
  //
  // Ein Bericht **ohne** Angabe zur Datenbank bleibt in Ordnung: Den liefert nur, wer
  // `healthReport` ohne sie aufruft, und das tun die Tests von health.ts selbst.
  const checks = {
    data: checkData(dataDir),
    uploads: checkUploads(dataDir),
    ...(database ? { database: { ok: databaseUnavailable(database) === null, detail: database.detail } } : {}),
  }
  const status = Object.values(checks).every((c) => c.ok) ? 'ok' : 'error'
  // `app` ist die Erkennungsmarke: Beim Start auf einem belegten Port fragt Mietfuchs hier
  // nach, ob dort schon Mietfuchs antwortet, und öffnet dann nur die Oberfläche (#45).
  //
  // `database` steht zusätzlich weiterhin neben `checks`, denn dort hängt mehr daran als ein
  // Ja oder Nein: die Zahl der nachgeholten Migrationen und die Meldung über den Umstieg, die
  // die Oberfläche anzeigt.
  return { app: 'mietfuchs', status, version, checks, database }
}
