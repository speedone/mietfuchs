# Mieterhöhung (#191): Umsetzungsplan in vier gestapelten PRs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Vermieter sieht je Mietverhältnis, ob, wann und um wie viel er die Kaltmiete erhöhen darf, druckt das
Schreiben und trägt die neue Miete nach Zustimmung bzw. Zugang in die Kaltmiete-Staffel ein; das Cockpit erinnert.

**Architecture:** Die Kaltmiete-Staffel bleibt die einzige Quelle des Solls. Die Rechnung ist rein
(`server/src/rentIncrease.ts`), alle Rechtszahlen aus dem Register, Geld in Cent. Verlangen und Erklärungen liegen in
`rent_increases` mit eingefrorener `basis` (JSON).

**Spec:** `docs/superpowers/specs/2026-11-20-mieterhoehung-design.md` (verbindlich, mit Abschnitt „Umsetzung PR 1“).
Rechtsrecherche und Gegenprüfung: Fundstellen im Register (shared/law/bgb-betrkv.ts, practice.ts).

## Global Constraints

- Gestapelt: `feat/mieterhoehung-daten` → `-rechnung` → `-schreiben` → `-cockpit`; Commits mit `Refs #191`, nie
  Fixes/Closes. Vor jedem PR Durchsicht mit frischem Kontext, vor dem Merge des Stapels Integrationsdurchsicht (Geld,
  Daten), Praxislauf, Label `full-check`.
- Bestandsschutz: settlement-golden, db-golden, Steuer-Golden und invariant-mietkonto unverändert grün; neue Angaben
  optional, fehlend heißt heutiges Verhalten.
- TDD; `npm run typecheck` vor jedem Commit, am Ende `npm test` mit Exit-Status.

## PR 1: Daten und Register (`feat/mieterhoehung-daten`)

- [x] Register: Wartefrist, Sperrfrist, Kappungsgrenze, Zustimmungs- und Klagefrist, Indexmiete, Staffelmiete
  (`checked`), Rundung und VPI-Reihe (`adopted`); kein Postlauf (Spec „Umsetzung PR 1“).
- [x] Typen (`RentChangeReason`, `RentEntry.reason/index`, `Tenancy.rentKind/rentIncreaseExcluded`,
  `Property.rentCapReduced`, `RentIncrease`), Schritte 0103 (Spalten, Tabelle) und 0104 (Bedingungen).
- [x] Repository, Wächter (`rentScheduleProblem`), Sätze der Bedingungen, Verlauf.
- [x] Lexikon: Vergleichsmiete, Kappungsgrenze, Indexmiete, Staffelmiete, Mieterhöhungsverlangen, Zustimmungsfrist.
- [x] Stammdaten: Art der Miete, Ausschluss, Art und Indexwert je Stufe, Hinweis zum Staffelabstand; am Objekt die
  Kappungsgrenzen-Verordnung.

## PR 2: Rechnung (`feat/mieterhoehung-rechnung`)

- [ ] `planRentIncrease(input)` rein, mit Bezugstag (Monatserster der Stufe, Mietbeginn tagesgenau), R1 bis R14 der
  Spec; `blocked` ohne Mietart, Ausschluss-Antwort, Bestätigung „alle Stufen erfasst“, bei Staffel vor der letzten
  Stufe, bei unbekannter Ausgangsmiete am Stichtag (M3), bei Indexwerten verschiedener Basis (M5).
- [ ] Tests: Fristbeispiel 20.11.2026 → 31.01.2027 / 01.02.2027 / 30.04.2027; VIII ZR 177/03 (326,77 €);
  VIII ZR 291/16 abgerundet 771,53 €; Mietbeginn am 15.; Invarianten über zufällige Staffeln (Höchstbetrag ≤
  Kappungsgrenze und ≤ Vergleichsmiete × Fläche; frühester Zugang nie vor der Sperrfrist; `modernization` verschiebt
  nie nach vorn und erhöht die Grenze genau um ihren Betrag; `agreement` statt einer anderen Art nie früher oder höher).
- [ ] Route `POST /api/tenancies/:id/rent-increase/plan` (nur lesend), Seitenfenster „Mieterhöhung“ mit Rechnung ohne
  Schreiben; Vorgabe des Zugangs „heute“ (kein Postlauf).

## PR 3: Schreiben und Übernahme (`feat/mieterhoehung-schreiben`)

- [ ] `RentIncreaseBasis` festlegen; Routen zum Speichern und für den Statuswechsel mit Marke wie #317; beim Übergang
  `agreed`/`partial` (Vergleichsmiete) bzw. `sent` (Index) die Stufe in `base_rents` mit Art und Indexwert in derselben
  Transaktion; `withdrawn` entfernt nur eine unveränderte Stufe; höchstens ein offenes Verlangen je Mietverhältnis.
- [ ] Druckansicht im Briefformat (LetterHead, PrintPages), Zusatzabsatz mit Hinweis (VIII ZR 108/20 Rn. 18 f.),
  Zustimmungserklärung; Sätze im Verlauf; Druckbreiten-Fall.

## PR 4: Cockpit (`feat/mieterhoehung-cockpit`)

- [ ] „Demnächst fällig“: `rentStep`, `rentIncrease`, `rentConsent` mit Sprungzielen ins Seitenfenster.
- [ ] Doku (docs/, README-Funktionsliste), CHANGELOG, Rest von #190.
