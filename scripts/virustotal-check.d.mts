// Typen für scripts/virustotal-check.mjs, damit server/test/virustotal-check.test.ts sie prüfen kann.
export type Finding = { engine: string, category: 'malicious' | 'suspicious', result: string }
export function findings(results: Record<string, { category?: string, result?: string | null }>): Finding[]
export function report(checked: { file: string, sha256: string, stats: Record<string, number> | null, found: Finding[], error?: string }[]): string
