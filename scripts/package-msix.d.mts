// Typen für scripts/package-msix.mjs, damit server/test/package-msix.test.ts sie prüfen kann.
export function msixVersion(version: string): string
export function fillManifest(template: string, values: { version: string, arch: string }): string
export const ARCHITECTURES: { arch: string, exe: string }[]
export const PACKAGE_EXE: string
