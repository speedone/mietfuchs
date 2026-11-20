// Der Inhalt eines Datensatzes als Text, für die Erkennung „zwei Fenster, ein Datensatz“ (server/src/db/repository.ts,
// `requireUnchanged`; client/src/staleRecord.ts). Hier und nicht auf einer Seite, weil beide dasselbe vergleichen müssen:
// Der Server entscheidet damit, ob der gesehene Stand noch gilt, die Oberfläche, ob der frisch geholte vom gezeigten
// abweicht. Schlüssel sortiert, Fehlendes und `null` gleich, Listen in ihrer Reihenfolge.

// Was die Listen der Routen dazusetzen, ohne dass es gespeichert ist (server/src/index.ts: `year` der Kostenposition im
// Kalenderobjekt, `fromDeposit` und `fromBank` der Zahlung). Wer einer Liste ein solches Feld dazusetzt, trägt es hier
// ein, sonst lehnte jedes Speichern aus dem Formular ab (Wächter in server/test/api-gleichzeitig.test.ts).
export const LIST_ONLY_FIELDS: ReadonlySet<string> = new Set(['year', 'fromDeposit', 'fromBank'])

export function recordMark(value: unknown, top = true): string {
  if (Array.isArray(value)) return `[${value.map((x) => recordMark(x, false)).join(',')}]`
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  const entries = Object.entries(value)
    .filter(([key, x]) => x !== undefined && x !== null && !(top && LIST_ONLY_FIELDS.has(key)))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, x]) => `${JSON.stringify(key)}:${recordMark(x, false)}`).join(',')}}`
}
