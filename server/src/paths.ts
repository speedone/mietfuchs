// Wo das Programm liegt und wohin es schreiben darf (#25). Zwei Stellen brauchen dieselbe
// Antwort: der Datenordner (store.js) und die Betriebsart für den Update-Hinweis (version.ts).
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
