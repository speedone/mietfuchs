// Läuft der Server als Bündel des Programmfensters (#517)? scripts/package-desktop.mjs setzt diesen Wert beim Bündeln
// auf true (und bricht ab, wenn er die Zeile nicht findet). Dann kommen die Migrationen aus dem Bündel, wie in der
// Programmdatei (Bun) aus dem eingebetteten Modul, und das Frontend aus client/dist.pack (server/src/clientPack.ts).
// So liegen unter resources/mietfuchs drei Dateien statt Tausender; der Echtzeitschutz unter Windows prüft beim
// Installieren jede einzeln. Unter Node, in Docker und in der Programmdatei bleibt er false.
export const IN_BUNDLE: boolean = false
