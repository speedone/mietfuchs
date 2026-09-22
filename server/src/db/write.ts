// Die Zeilen der Einstellungen für das **heutige** Schema (#55).
//
// Den ganzen Bestand schreibt diese Datei nicht mehr; das tut `legacy/write.ts` und zwar in den
// eingefrorenen Ausgangsstand (Aufgabe 6b). Hier bleibt, was `PUT /api/settings` braucht, also
// db/repository.ts.
//
// **Es gibt diese Funktionen deshalb zweimal, und das ist Absicht.** Der Kommentar stand hier
// einmal umgekehrt und warnte vor der Doppelung: „Zwei Fassungen liefen auseinander, sobald
// jemand ein Feld ergänzt." Das war richtig, solange beide auf dasselbe Schema zielten. Jetzt
// zielt diese auf das heutige und die andere auf den Ausgangsstand, und dass sie auseinanderlaufen,
// ist nicht die Gefahr, sondern der Zweck: Eine neue Spalte kommt hier hinzu und dort nicht, und
// den alten Bestand bringt die Migrationskette nach.

import type { AiSettings, AiSlot, AiSlotName } from '../../../shared/types.ts'
import type { MigratedSettings } from '../ai/settings.ts'
import { aiSlots, settings } from './schema.ts'

// `null` statt `undefined` an jeder Stelle, an der ein Feld fehlen darf. In SQL heißt NULL
// „kein Wert", in JavaScript heißt `undefined` meist „hier fehlt etwas, das dastehen sollte";
// client.ts wirft deshalb ausdrücklich, wenn ein `undefined` bis zur Datenbank durchkommt.
const orNull = <T>(value: T | undefined | null): T | null => value ?? null

// ---------- Die Zeilen der Einstellungen ----------

export function settingsRow(s: MigratedSettings) {
  const ai = s.ai
  return {
    id: 1,
    houseName: s.houseName,
    address: s.address,
    landlordName: s.landlordName,
    iban: s.iban,
    paymentDeadlineDays: s.paymentDeadlineDays,
    ollamaUrl: s.ollamaUrl,
    ollamaModel: s.ollamaModel,
    printAdjustSuggestion: orNull(s.printAdjustSuggestion),
    printAttachments: orNull(s.printAttachments),
    updateCheck: orNull(s.updateCheck),
    updateDismissed: orNull(s.updateDismissed),
    aiTimeoutSeconds: orNull(ai.timeoutSeconds),
    aiNumCtx: orNull(ai.numCtx),
    aiMaxOutputTokens: orNull(ai.maxOutputTokens),
    aiPageImageEdge: orNull(ai.pageImageEdge),
    aiJsonMode: ai.jsonMode,
    aiReasoningEffort: orNull(ai.reasoningEffort),
    aiExtraInstructions: ai.extraInstructions,
  }
}

// Die beiden Plätze der KI sind Zeilen und keine Spalten mit Präfix. Die Bestätigung eines
// externen Dienstes steht in derselben Zeile wie die Adresse, für die sie gilt.
export function aiSlotRows(ai: AiSettings) {
  const slotRow = (name: AiSlotName, slot: AiSlot) => ({
    slot: name,
    provider: slot.provider,
    preset: slot.preset,
    url: slot.url,
    model: slot.model,
    vision: orNull(slot.vision),
    consentUrl: orNull(ai.consent[name]?.url),
    consentModel: orNull(ai.consent[name]?.model),
    consentDate: orNull(ai.consent[name]?.date),
  })
  return [slotRow('text', ai.text), ...(ai.images ? [slotRow('images', ai.images)] : [])]
}
