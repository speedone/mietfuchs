# Verteilbasis erweitern (Teil 3a, #94) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Teilnehmer je Kostenposition, Schlüssel „laut Gemeinschaftsabrechnung“ (`external`) und
„Einzelbeträge je Mietverhältnis“ (`amounts`). Ohne neue Angaben rechnet alles wie bisher.

**Spec:** `docs/superpowers/specs/2026-09-30-verteilbasis-design.md`. Dieser Plan ist bewusst knapp,
weil die Spezifikation Rechenweg, Warnungen und Datenmodell vollständig nennt. Gleiche Global
Constraints wie `2026-09-30-objekte.md`.

## Review Focus

1. **Position ohne neue Angaben:** Sie muss bitgleich wie vorher rechnen. Maßstab sind die
   Golden-Tests und die Invarianten.
2. **Wohnung gelöscht, die Teilnehmer war:** Die Teilnehmerliste schrumpft. Ist sie danach leer,
   erscheint eine Warnung, und nichts wird still verteilt.
3. **Mietverhältnis gelöscht, das einen Einzelbetrag hatte:** Der Betrag fällt an den Vermieter.
4. **Einzelbeträge über dem Gesamtbetrag:** Es wird nichts verteilt, und der Vermieteranteil wird
   nie negativ.
5. **Gemeinschaftsabrechnung mit Tippfehler in der Gesamtsumme:** Es erscheint eine Warnung, und
   die Zahlen bleiben die des eingetragenen Betrags.

## Tasks

- [ ] **Task 1: Datenmodell.**
  - `shared/types.ts`:
    - `CostKey` um `external` und `amounts`
    - neuer Typ `ExternalBasis`
    - an `CostItem`: `participantUnitIds`, `externalBasis`, `tenancyAmounts`
    - an `Unit`: `mea`
  - `schema.ts`:
    - Spalten `units.mea`, `external_measure`, `external_total`, `external_total_cents`
    - Tabellen `cost_item_participants` und `cost_item_amounts`
    - `COST_KEYS`
  - Migration 0003 mit `db:generate`.
  - Lesen und Schreiben in `read.ts` und `repository.ts`, nach dem Muster von `customShares`:
    Untertabellen ganz ersetzen, Verschmelzung nach Anwesenheit.
  - `guardCostItem` und `crossPropertyViolations` erweitern.
  - Tests zuerst:
    - Rundreise in db-repository
    - Kaskaden
    - Grenze der Objekte
    - schema.test
    - „Probe belegt jede Spalte“ in db-stock, db-repository und api.test
- [ ] **Task 2: Teilnehmer in calc.ts.**
  - Verteilbasis je Position über `basisOf(item)`.
  - Ohne Teilnehmer wird die vorberechnete Basis wiederverwendet.
  - Tests zuerst:
    - Aufzug nur Haus A
    - selbstgenutzte Wohnung nicht beteiligt
    - Verbrauch nur mit den Zählern der Teilnehmer
    - leere Liste
- [ ] **Task 3: `external` in calc.ts.**
  - Tests zuerst:
    - einzelne ETW ganzjährig
    - Mieterwechsel tagesanteilig
    - Leerstand
    - zwei ETW im selben Objekt nach MEA
    - Plausibilitätswarnung
    - fehlende MEA
    - `basisText`
- [ ] **Task 4: `amounts` in calc.ts.**
  - Tests zuerst:
    - Messdienst mit Nutzerwechsel
    - Leerstand trägt der Vermieter
    - Summe über Gesamtbetrag
    - Mietverhältnis ohne Betrag
    - Betrag für fremdes oder vergangenes Mietverhältnis
    - §35a proportional
- [ ] **Task 5: Invarianten.**
  - Den Generator in calc.test.ts um die drei Möglichkeiten erweitern.
  - Die vier bestehenden Invarianten laufen darüber.
- [ ] **Task 6: Oberfläche.**
  - `costForm.ts`: Formularfelder, Rumpf, Prüfungen, `costKeyOptions`.
  - `unitForm.ts`: `mea`.
  - Seiten Kosten und Stammdaten.
  - `KEY_LABELS` in calc.ts und client/types.ts.
  - Tests zuerst: costForm.test, unitForm.test, Kosten.test.tsx (Auswahlfeld zeigt den
    gespeicherten Schlüssel).
- [ ] **Task 7: Außen und Doku.**
  - Marke 0003 in migrations.test.
  - CHANGELOG und CLAUDE.md (Umlageschlüssel).
  - Smoke-Test, Praxislauf, `npm test`, `npm run build`.
  - Abschluss-Review.
