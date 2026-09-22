// Womit eine **neue** Einrichtung anfängt.
//
// Die Werte standen bisher in legacy/migrate.ts, weil `migrateLegacy` sie als Grundlage zum Ergänzen
// fehlender Felder braucht. Gebraucht werden sie inzwischen aber an einer zweiten Stelle, und
// die hat mit alten Beständen nichts zu tun: Eine frische Datenbank hat noch keine Zeile in
// `settings`, und dann gilt hier dasselbe wie früher bei einer noch nicht angelegten db.json
// (db/read.ts).
//
// **Die beiden Verwendungen laufen auseinander, sobald der Eingang eingefroren wird**
// (Aufgabe 6b). `migrateLegacy` ergänzt dann nach den Vorgaben von damals, diese Datei nennt
// die von heute. Solange sie dieselben sind, stehen sie an einer Stelle.

import type { Settings } from '../../shared/types.ts'

// Standardmodell für die KI-Belegauswertung, gewählt mit dem KI-Prüflauf (#17): Auf Rechnern
// ohne Grafikkarte liest es PDFs mit Textebene fast fehlerfrei, einseitige Scans meist richtig,
// und es braucht rund 3,6 GB Arbeitsspeicher. Das Compose-Profil „ki“ lädt dasselbe Modell,
// ein Test gleicht beides ab.
export const DEFAULT_OLLAMA_MODEL = 'qwen3.5:4b'

export const DEFAULT_SETTINGS: Settings = {
  houseName: '',
  address: '',
  landlordName: '',
  iban: '',
  paymentDeadlineDays: 30,
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: DEFAULT_OLLAMA_MODEL,
}
