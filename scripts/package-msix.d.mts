// Typen für scripts/package-msix.mjs, damit server/test/package-msix.test.ts sie prüfen kann.
export function msixVersion(version: string): string
export function fillManifest(template: string, values: { version: string, arch: string }): string
export function peInfo(head: Buffer): { machine: string, subsystem: string }
export function checkWindowFolder(dir: string, arch: string): void
export const ARCHITECTURES: { arch: string, dir: string }[]
export const PACKAGE_EXE: string
export const SERVER_DIR: string
