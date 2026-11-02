// Typen für scripts/updater-probe.mjs, damit server/test/updater-probe.test.ts sie prüfen kann.
export function nextPatch(version: string): string
export function probeStep(journal: { entries: { idx: number, when: number, tag: string }[] }): { tag: string, entry: Record<string, unknown>, sql: string }
export function requestedFile(url: string): string
export function installedMatches(installed: { file: string, product: string }, wanted: string): boolean
