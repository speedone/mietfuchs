// Die Regel für eine Staffel mit zwei Einträgen zum selben Stichtag.
//
// **Sie wird an zwei Stellen gebraucht**, und das ist der Grund für diese Datei. Beim Umstieg
// eines alten Bestandes (`straightenForDatabase` in legacy.ts) und beim Speichern über die
// Routen (`readSchedule` in db/repository.ts). Zwei Fassungen liefen auseinander, und gemerkt
// hätte man es erst daran, dass dieselbe Staffel nach dem Umstieg anders dasteht als nach dem
// Speichern.
//
// **Warum es den Fall überhaupt gibt:** Stammdaten.tsx setzt für eine Staffelzeile ohne Monat
// den Einzugsmonat ein und prüft nie auf Doppelung. Zwei so ausgefüllte Zeilen ergeben zwei
// Einträge zum selben Stichtag, das ist also keine Spitzfindigkeit, sondern eine gewöhnliche
// Eingabe. In der Datenbank ist der Stichtag Teil des Primärschlüssels; ungeprüft
// hineingeschrieben gäbe es dafür einen Fehler statt eines gespeicherten Mietverhältnisses.

// **Es gilt der letzte.** Genau so liest ihn die Abrechnung: Sie sortiert nach Stichtag
// (`Array.prototype.sort` ist stabil, gleiche Stichtage behalten ihre Reihenfolge) und übernimmt
// den letzten Eintrag, dessen Stichtag erreicht ist. Gemessen ergibt [100 €, 250 €] eine
// Jahresvorauszahlung von 3000 € und [250 €, 100 €] eine von 1200 €; wer hier den falschen
// nähme, änderte eine Abrechnung um 1800 €. Die Reihenfolge der übrigen Einträge bleibt, wie sie
// war.
export function lastPerFrom<T extends { from: string }>(entries: T[]): T[] {
  const lastIndex = new Map<string, number>()
  entries.forEach((entry, index) => lastIndex.set(entry.from, index))
  return entries.filter((entry, index) => lastIndex.get(entry.from) === index)
}
