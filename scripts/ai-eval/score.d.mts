// Gepflegte Typangaben zu score.mjs (Heizung PR 20), damit server/test/ai-eval-score.test.ts die Bewertung
// unter den strengen Einstellungen des Servers einbindet; dasselbe Muster wie embedded-client.d.ts.
export type Score = { points: number; passed: number; total: number; failed: string[] }
export function near(actual: unknown, expected: number, tolerance?: number): boolean
export function score(expected: Record<string, unknown>, extraction: unknown): Score
export function scoreService(expected: Record<string, unknown>, extraction: unknown): Score
export function scoreFuel(expected: Record<string, unknown>, extraction: unknown): Score
