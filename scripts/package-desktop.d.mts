// Typen für scripts/package-desktop.mjs, damit server/test/package-desktop.test.ts sie prüfen kann.
export function userFileName(file: string): string
export function stagedPath(file: string): boolean
export function checkServerFolder(dir: string): void
export const REQUIRED_SERVER_FILES: string[]
export function prunable(file: string): boolean
