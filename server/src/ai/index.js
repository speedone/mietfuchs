// Schnittstelle zu den KI-Anbietern der Belegauswertung. extract.js kennt nur diese
// Schnittstelle: Prompts, Schemas und Ablauf bleiben dort, Transport, Fehlermeldungen und
// Eigenheiten eines Anbieters liegen in seinem eigenen Modul.
//
// Ein Anbieter ist ein Objekt mit
//
//   json({ prompt, images, schema, timeoutMs, signal, onProgress }) → Promise<{ data, stats }>
//
// `images` ist eine Liste von { mimeType, data } mit den Bilddaten als Base64 in `data`, leer
// bei reinem Text. `data` ist die Antwort nach dem JSON-Schema `schema`. `stats` enthält
// { promptTokens, outputTokens, seconds, loadSeconds }, jeweils null, wenn der Anbieter es
// nicht meldet. Versteht das Modell nachweislich keine Bilder, wirft json(), statt sie zu
// schicken, denn sonst erfände es eine Rechnung.
//
// `onProgress` (optional) erfährt { phase: 'waiting' } zu Beginn und { phase: 'writing', chars }
// während die Antwort eintrifft. Die Oberfläche zeigt daran, dass das Modell arbeitet.
//
// `timeoutMs` gilt für die ganze Anfrage, auch wenn sie länger als fünf Minuten läuft (siehe
// ai/http.js). Bricht `signal` ab, etwa weil der Browser die Seite verlassen hat, endet die
// Anfrage beim Anbieter und json() wirft einen Fehler mit dem Namen 'AbortError'. Alle anderen
// Fehler tragen eine Meldung, die die Oberfläche so anzeigen kann.
//
// Bisher gibt es Ollama. Ein weiterer Anbieter, etwa ein OpenAI-kompatibler Dienst (#18),
// kommt als eigenes Modul mit derselben Schnittstelle dazu und wird hier anhand der
// Einstellungen gewählt.
import { ollamaProvider } from './ollama.js'

export function aiProvider(settings) {
  return ollamaProvider(settings)
}
