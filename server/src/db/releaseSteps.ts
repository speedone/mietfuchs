// Wie viele Migrationsschritte jede veröffentlichte Nebenversion mitbrachte (#318, Sicherungspunkte im Verlauf).
//
// Daraus liest der Verlauf, auf welche Version ein Update ging, vor dem eine Sicherung `mietfuchs.sqlite.vor-<Schritt>`
// entstand: Ihr Name nennt den ersten Schritt, den dieses Update nachholte, und mit ihm kam die erste Version, die ihn
// enthält. **Grenze**: Ging ein Update über mehrere Versionen (0.10 auf 0.12), nennt das die erste davon; genau ist nur
// die Angabe der Merkdatei (`sicherung-vor-update.json`, `version`), die der Server beim Update selbst schreibt.
//
// **Beim Release einer neuen Nebenversion hier eintragen**, mit der Zahl der Dateien in server/drizzle/*.sql. Ein
// Wächter in snapshots.test.ts verlangt den Eintrag für die Nebenversion aus server/package.json. Patchversionen ohne
// neuen Schritt brauchen keinen. Gezählt aus den Tags (git ls-tree v0.x.0 -- server/drizzle).
export const RELEASE_STEPS: readonly { version: string, steps: number }[] = [
  { version: '0.8.0', steps: 1 },
  { version: '0.9.0', steps: 12 },
  { version: '0.10.0', steps: 14 },
  { version: '0.11.0', steps: 56 },
  { version: '0.12.0', steps: 63 },
]

const parts = (version: string): number[] => version.split(/[.-]/).slice(0, 3).map((p) => Number.parseInt(p, 10) || 0)
const compare = (a: string, b: string): number => {
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

// Die Version, die den Schritt an Stelle `index` (ab 0) als erste enthielt; null, wenn ihn noch keine veröffentlichte
// Version enthält (ein Stand von main zwischen zwei Releases).
export function versionBringing(index: number): string | null {
  return RELEASE_STEPS.find((r) => r.steps > index)?.version ?? null
}

// Wie viele Schritte eine Version enthält (die jüngste Nebenversion bis zu ihr).
export function releaseStepsOf(version: string): number {
  let steps = 0
  for (const r of RELEASE_STEPS) if (compare(r.version, version) <= 0) steps = r.steps
  return steps
}
