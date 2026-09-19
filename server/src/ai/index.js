// Schnittstelle zu den KI-Anbietern der Belegauswertung. extract.js kennt nur diese
// Schnittstelle: Prompts, Schemas und Ablauf bleiben dort, Transport, Fehlermeldungen und
// Eigenheiten eines Anbieters liegen in seinem eigenen Modul.
//
// Ein Anbieter ist ein Objekt mit
//
//   json({ prompt, images, schema, timeoutMs }) → Promise<object>
//
// `images` ist eine Liste von { mimeType, data } mit den Bilddaten als Base64 in `data`, leer
// bei reinem Text. Die Antwort folgt dem JSON-Schema `schema`. Versteht das Modell nachweislich
// keine Bilder, wirft json(), statt sie zu schicken, denn sonst erfände es eine Rechnung.
// Fehler kommen als Error mit einer Meldung, die die Oberfläche so anzeigen kann.
//
// Bisher gibt es Ollama. Ein weiterer Anbieter, etwa ein OpenAI-kompatibler Dienst (#18),
// kommt als eigenes Modul mit derselben Schnittstelle dazu und wird hier anhand der
// Einstellungen gewählt.
import { ollamaProvider } from './ollama.js'

export function aiProvider(settings) {
  return ollamaProvider(settings)
}
