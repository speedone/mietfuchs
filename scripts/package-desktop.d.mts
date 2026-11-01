// Typen für scripts/package-desktop.mjs, damit server/test/package-desktop.test.ts sie prüfen kann.
export function userFileName(file: string): string
export function checkServerFolder(dir: string): void
export const REQUIRED_SERVER_FILES: string[]
export const SERVER_BUNDLE: string
export const SERVER_LICENSES: string
export const CLIENT_PACK: string
export function rewriteImportMeta(code: string, id: string, where: { root: string, bundleFile: string }): string | null
export function bundleServer(stageDir: string): Promise<{ file: string, licenses: string, modules: number }>
export function packClient(clientDist: string, stageDir: string): number
