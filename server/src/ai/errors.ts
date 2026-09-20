// Fehler der KI-Anbieter tragen Zusatzfelder, die die Oberfläche und die Wiederholungslogik
// auswerten. Bewusst als Typ plus Fabrik statt als Klasse: Klassenfelder mit Typangabe sind
// nicht löschbare Syntax, und die Laufzeitgestalt bleibt exakt dieselbe wie bisher.
export type ProviderError = Error & {
  status?: number
  // Manche Dienste (etwa IONOS) schicken einen numerischen Fehlercode statt einer Zeichenkette.
  code?: string | number
  detail?: string
  param?: string
  inStream?: boolean
  unreachable?: boolean
  tooLarge?: boolean
  // Wartezeit aus dem retry-after-Header eines überlasteten Dienstes, in Millisekunden
  retryAfter?: number
}

// Nicht aufzählbar (Symbol statt Feld), damit ein Fehler ohne weitere Angaben weiterhin keine
// zusätzlichen eigenen Eigenschaften trägt, genau wie zuvor mit `new SpezialError(meldung)`.
// isProviderError ersetzt die früheren `instanceof OllamaError`/`instanceof ProviderError`-
// Prüfungen: Sie unterschieden nur zwischen einem schon fertig übersetzten Fehler (mit einer für
// die Oberfläche geeigneten Meldung) und einem rohen Fehler, der noch übersetzt werden muss.
// `Symbol.for` statt `Symbol`: Läuft dieses Modul aus irgendeinem Grund doppelt (etwa weil ein
// Bündler es zweimal einzieht), teilen sich beide Kopien denselben globalen Symbol-Registry-
// Eintrag. Mit einem lokalen `Symbol()` hätte jede Kopie ihre eigene Marke, und Fehler aus der
// einen Kopie wären für isProviderError aus der anderen unsichtbar.
const MARKER = Symbol.for('mietfuchs.providerError')

export const providerError = (message: string, extra: Omit<ProviderError, keyof Error> = {}): ProviderError => {
  const err = Object.assign(new Error(message), extra) as ProviderError
  Object.defineProperty(err, MARKER, { value: true })
  return err
}

export const isProviderError = (err: unknown): err is ProviderError =>
  err instanceof Error && (err as unknown as Record<PropertyKey, unknown>)[MARKER] === true
