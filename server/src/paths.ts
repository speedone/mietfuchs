// Wo das Programm liegt und wohin es schreiben darf (#25, Microsoft Store #500). Zwei Stellen brauchen dieselbe
// Antwort: der Datenordner (store.ts) und die Betriebsart für den Update-Hinweis (version.ts).
// Deshalb steht die Regel hier, nicht zweimal.
import fs from 'node:fs'
import path from 'node:path'

// Liegt die Programmdatei an einem Ort, der dem System gehört? Dann stammt sie aus einem
// Installationspaket: Die Daten gehören in den Benutzerordner, und aktualisiert wird über die
// Paketverwaltung, nicht durch Austauschen der Datei.
export function systemLocation(execPath: string = process.execPath, platform: NodeJS.Platform = process.platform): boolean {
  // Bewusst nach der genannten Plattform trennen, nicht nach der des laufenden Rechners:
  // Sonst hinge das Ergebnis daran, wo geprüft wird.
  if (platform === 'win32') {
    const dir = path.win32.dirname(execPath)
    // Nur der erste Ordner hinter dem Laufwerk zählt. Ein Teilstring träfe auch
    // „D:\Programme kopie“ oder „…\Desktop\Windows-Tools“, und die Daten eines Nutzers lägen
    // nach einem Update plötzlich woanders.
    const top = dir.slice(path.win32.parse(dir).root.length).split(/[\\/]/)[0].toLowerCase()
    return ['program files', 'program files (x86)', 'windows'].includes(top)
  }
  const dir = `${path.posix.dirname(execPath)}/`
  return ['/usr/', '/opt/', '/bin/', '/sbin/', '/Applications/'].some((p) => dir.startsWith(p))
}

// Stammt die Programmdatei aus dem Microsoft Store (#500)? Windows legt Store-Pakete unter
// `<Laufwerk>\WindowsApps\<Paketname>_<Version>_<Architektur>__<Hash>\` ab, meist in
// `C:\Program Files`, nach einem Verschieben auf ein anderes Laufwerk aber auch dort im
// obersten Ordner. Erkannt wird deshalb der eigene Paketordner, nicht das Laufwerk: Eine
// entpackte Datei in einem Ordner, der zufällig „WindowsApps“ heißt, bleibt eine Programmdatei.
export const STORE_PACKAGE_NAME = 'speedone.Mietfuchs'

export function storeLocation(execPath: string = process.execPath, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return false
  const parts = path.win32.dirname(execPath).split(/[\\/]/).map((part) => part.toLowerCase())
  // Jeder Ordner direkt unter „WindowsApps“, nicht nur der letzte: So zählt eine Datei tiefer im Paket ebenso. Im
  // Programmfenster (#517) ist es Mietfuchs.exe oben im Paket, in dem auch der Server als utilityProcess läuft.
  return parts.some((part, i) => i > 0 && parts[i - 1] === 'windowsapps' && part.startsWith(`${STORE_PACKAGE_NAME.toLowerCase()}_`))
}

// Lässt sich in dem Ordner schreiben? Gibt es ihn noch nicht, zählt der übergeordnete.
export function writable(dir: string): boolean {
  let probe = dir
  while (!fs.existsSync(probe)) {
    const up = path.dirname(probe)
    if (up === probe) return false
    probe = up
  }
  try {
    fs.accessSync(probe, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}
