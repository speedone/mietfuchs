// Die Regel für eine Staffel mit zwei Einträgen zum selben Stichtag.
//
// **Sie wird an zwei Stellen gebraucht**, und das ist der Grund für diese Datei. Beim Umstieg
// eines alten Bestandes (`straightenForDatabase` in legacy/migrate.ts) und beim Speichern über die
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

// ---------- Die Personen-Staffel ist anders, und das ist gemessen ----------
//
// **Für sie trägt „es gilt der letzte" nicht.** `personDaysInPeriod` in calc.ts baut seine
// Stufen aus allen Einträgen, und die erste gilt **ab Einzug** und nicht erst ab ihrem eigenen
// Stichtag; im Quelltext steht es als Kommentar an der Zeile („erste Stufe gilt ab Einzug"), und
// `personsAt` nimmt vor dem ersten Stichtag ebenfalls den ersten Eintrag. Wirft man also den
// ersten von zwei Einträgen zum selben Stichtag weg, übernimmt der zweite rückwirkend die ganze
// Zeit davor.
//
// Nachgemessen an einem Mietverhältnis ab 01.01.2024 mit [1 Person, 4 Personen], beide ab
// 01.07.2024: 918 Personentage gegen 1464. Beim Personenschlüssel ist das unmittelbar Geld.
//
// **Die Lösung schreibt keine neue Regel, sondern eine vorhandene aus.** Weil die erste Stufe
// ohnehin ab Einzug gilt, darf ihr Stichtag auf den Einzugstag vorgezogen werden: An der
// Rechnung ändert das nichts, denn calc.ts liest ihn dort gar nicht. Danach unterscheidet sich
// der erste Eintrag von seinem Nachfolger, und für alle übrigen gilt wieder „es gilt der
// letzte" — eine Stufe, die am selben Tag endet, an dem sie beginnt, zählt null Tage, ihr
// Wegfall bewegt also nichts.
//
// Wiederholt wird das, solange es nötig ist: Bei drei Einträgen zum selben Stichtag rückt der
// erste heraus, und die beiden übrigen sind dann untereinander die gewöhnliche Doppelung.
// **Sortiert wird zuerst, und das ist keine neue Regel, sondern dieselbe:** `personHistoryOf` in
// calc.ts sortiert vor dem Rechnen ebenso nach Stichtag. Ohne diesen Schritt zöge das Vorziehen
// den falschen Eintrag vor, nämlich den ersten der Datei statt den frühesten, und `lastPerFrom`
// würfe danach den richtigen weg. Gemessen an einem Mietverhältnis ab 01.01.2024 mit der Staffel
// [4 Personen ab Juli, 1 Person ab Januar]: 918 Personentage gegen 366. Die Regression fängt es
// ab, der Vermieter verlöre also kein Geld, säße aber dauerhaft in einem gescheiterten Umstieg
// fest. Über die Stammdaten ist eine unsortierte Staffel nicht erzeugbar, über die Schnittstelle
// und über eine von Hand bearbeitete Datei schon.
export function straightenPersonHistory<T extends { from: string }>(entries: T[], start: string): T[] {
  const sortiert = entries.slice().sort((a, b) => a.from.localeCompare(b.from))
  const erster = sortiert[0]
  if (erster === undefined) return []
  const vorgezogen = erster.from > start ? [{ ...erster, from: start }, ...sortiert.slice(1)] : sortiert
  return lastPerFrom(vorgezogen)
}
