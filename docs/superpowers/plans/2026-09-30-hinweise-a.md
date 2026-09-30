# Hinweise A – Umsetzungsplan

**Spec:** docs/superpowers/specs/2026-09-30-hinweise-a-design.md

## Global Constraints

- Der Wortlaut jeder bisherigen Warnung bleibt Zeichen für Zeichen; `warnings` = Texte der `notices`.
- `notices` und `legalBasis` sind optional am `Settlement` (alte eingefrorene Abrechnungen).
- Codes englisch, Titel und Texte deutsch.

## Review Focus

- Eine alte abgeschlossene Abrechnung ohne `notices`: Seite zeigt ihre `warnings` weiter.
- Eine Meldung ohne Code oder mit falscher Stufe wird still vergessen: Test über alle Codes.
- Rechtsstand wird beim Abschließen nicht eingefroren, sondern neu berechnet.
- Kabel-Regel an den Grenzen 2024/2025 nach Umbau auf `ruleCoverage`.
- Das Cockpit liest `warnings` weiter und darf nicht leer werden.

## Tasks

1. **rules.ts** mit Tests (`server/test/rules.test.ts`): `RULES`, `RULES_AS_OF`, `rulesFor`,
   `ruleCoverage`.
2. **Typen und calc.ts**: `Notice` usw. in shared/types.ts; `notice()`-Helfer in
   `computeSettlement` und `meterSegments`; alle `warnings.push` umstellen; `legalBasis`;
   Kabel über `ruleCoverage`. Tests: `server/test/calc-notices.test.ts`.
3. **API**: Test, dass eine abgeschlossene Abrechnung `legalBasis` und `notices` behält.
4. **Client**: `client/src/notices.ts` + Test; Abrechnung.tsx zeigt Hinweise, Knopf, Rechtsstand.
5. **CHANGELOG, CLAUDE.md**, Durchsicht, PR (Basis `feat/mietmodell`, `Refs #112`).

## Codes

| Code | Stufe | Subjekt | Regel |
| --- | --- | --- | --- |
| meter.replacement-without-end | warning | meter | |
| meter.negative | warning | meter | |
| meter.same-day | warning | meter | |
| basis.self-no-persons | warning | unit | |
| basis.self-no-area | warning | unit | |
| basis.unit-no-area | warning | unit | |
| basis.tenancy-no-persons | warning | tenancy | |
| tv-signal.partial-year | warning | costItem | tv-signal |
| tv-signal.ended | warning | costItem | tv-signal |
| item.no-basis | warning | costItem | |
| external.value-missing | warning | unit | |
| external.amount-mismatch | hint | costItem | |
| amounts.exceed | error | costItem | |
| amounts.forfeited | warning | costItem | |
| amounts.missing | warning | costItem | |
| amounts.self-hidden | hint | costItem | |
| custom.forfeited | warning | costItem | |
| custom.none | warning | costItem | |
| custom.over-100 | error | costItem | |
| meter.no-consumption | warning | costItem | |
| direct.unit-gone | warning | costItem | |
| labor35a.invalid | warning | costItem | |
| heating.flat-rate | warning | tenancy | heating-flat-rate |
