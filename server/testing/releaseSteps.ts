// Die Meldung des Wächters in law-release.test.ts, wenn RELEASE_STEPS (server/src/db/releaseSteps.ts) die Schritte der
// getaggten Version nicht nennt. Vorgeschlagen wird die Fassung aus package.json (beim Tag von set-version.mjs gesetzt),
// ohne Zusatz wie `-rc.1`, auch eine Patchversion: Ein kleines Release mit neuen Schritten erscheint als Patch, und für
// x.y.0 steht dann schon ein Eintrag mit weniger Schritten.
export function missingStepsMessage(version: string, steps: number): string {
  return `In server/src/db/releaseSteps.ts fehlt ein Eintrag { version: '${version.replace(/-.*$/, '')}', steps: ${steps} }.`
}
