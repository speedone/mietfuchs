// Bun setzt dieses Objekt in der gepackten Programmdatei. Nur die Prüfung auf Vorhandensein
// wird gebraucht, deshalb reicht `unknown`.
declare global {
  var Bun: unknown | undefined
}
export {}
