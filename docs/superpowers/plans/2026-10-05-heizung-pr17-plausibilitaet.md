# Heizung PR 17: Plausibilität der CO₂-Angaben und Ausdruck für den Messdienst (#97, #210) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Rechtsregister kennt CO₂-Preise (§ 4 CO2KostAufG), die Durchschnittspreise des
EU-Emissionshandels (§ 3 Abs. 4 Nr. 4 b), die Standardwerte der EBeV 2030 und den ermäßigten
Umsatzsteuersatz für Gas und Wärme 2022–2024; noch nicht veröffentlichte Werte darf der Vermieter mit
Quelle eintragen (`law_overrides`, `law.value-overridden`). Damit prüft die Abrechnung jede Lieferung auf
plausible kg und CO₂-Kosten (`co2.cost-implausible`, hint), und die Seite Heizkosten druckt das Blatt
„CO₂-Angaben für den Messdienst“ (#210).

**Architecture:** `law()` bekommt die Zeitregel `deliveryYear`; überschreibbare Parameter fragt nur
`lawOverridable()`, das die Einträge aus dem Protokoll (`LawLog.overrides`) liest und als
`overridden` protokolliert. Die Einträge stehen in der Tabelle `law_overrides` (eine erzeugte Migration),
kommen über `Stock` und Schnappschuss in die Berechnung und über drei Routen in die Einstellungen. Die
Prüfung je Lieferung ist eine reine Funktion (`server/src/co2Plausibility.ts`) und wird im CO₂-Block von
`computeSettlement` gemeldet. Das Blatt baut `server/src/co2Sheet.ts` aus dem Bestand; der Client druckt
es über eine eigene Ansicht der Seite Heizkosten.

**Tech Stack:** Node 24 (TypeScript ohne Build), Express 5, Drizzle ORM 0.45 über `sqlite-proxy`,
drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich 0.6
(D-H4: 2026 = Mittelwert des Korridors), 3.13 (`deliveryYear`, `eventDate` mit Rechnungsdatum − 1 Jahr),
4.2 (Typ, Protokoll mit `overridden?`, fehlender Wert), 4.3 (`co2.price`, `co2.price-ets`,
`co2.ebev-factors`, PR 17), 4.4 (`deviation` für Werte), 4.5 (Werte, die später veröffentlicht werden;
`law_overrides`; `law.value-overridden`; der amtliche Wert gilt; nur Plausibilität), 4.6 (nur, was im
BGBl. steht), 5.1, 5.9 (`law_overrides`), 7.6 (Ausdruck für den Messdienst), 10.1 (`co2.cost-implausible`
hint, `law.value-overridden` hint, PR 17), 13 PR 17, 14.1 („Messdienst ohne Aufteilung … Ausdruck für den
Messdienst“), 14.2 (#97, #210), 15.2 F6 (Plausibilitätsgrenzen ohne Quelle), 16 („Rückfall, der kg oder €
aus kWh vorrechnet“ ist Nicht-Ziel; „Rechtswerte über das Netz“ Nicht-Ziel).

**Baut auf:** PR 1 bis PR 16. Gearbeitet wird auf `feat/heizung-pr17-plausibilitaet`, abgezweigt von der
Spitze von PR 16, gestapelt gestellt und nach dem Merge von PR 16 auf `main` umgestellt.

## Global Constraints

- **Nur Plausibilität** (4.5, 16): Keine Abrechnungszahl hängt an Preisen, ETS-Preisen, EBeV-Werten oder
  Umsatzsteuersätzen dieses Plans. Mietfuchs rechnet nie kg oder € aus kWh vor; es vergleicht nur, was
  auf der Rechnung steht, mit dem, was nach Gesetz dastehen müsste.
- **Wer nichts einstellt, merkt nichts** (1.2 Nr. 1): Ohne Lieferungen und ohne Einträge in
  `law_overrides` ändern sich weder Zahlen noch Hinweise. **`legalBasis.values` bekommt neue Einträge nur
  bei Abrechnungen mit Lieferungen** (die Werte, die die Prüfung benutzt hat); Golden F01–F12, F14–F16,
  F18 bleiben wortgleich. F13 und F17 haben Lieferungen (Task 5 Step 6).
- **Rechtswerte kommen nur mit einem Release, nie über das Netz** (4.5): Der Vermieter darf nur
  überschreibbare Parameter eintragen, und nur dort, wo das Register `null` hat; mit Pflichtfeld „Quelle“.
  Bringt ein Release den amtlichen Wert, gilt er; der Eintrag heißt dann „überholt“.
- **Eine Fassung wird nie geändert** (4.4), mit zwei benannten Ausnahmen in `law-history.test.ts`: ein
  offenes Ende schließen (PR 1) und einen veröffentlichten Wert an die Stelle von `null` setzen
  (Abweichung 3).
- **Nur, was im BGBl. steht** (4.6): Für 2027 steht kein Preis im Register; BT-Drs. 21/7869 (Korridor
  2027) bleibt draußen.
- **Stufen:** `co2.cost-implausible` und `law.value-overridden` sind `hint` (10.1).
- **Migration:** ein erzeugter Schritt `rechtswerte` (eine neue Tabelle samt ihren Bedingungen, keine
  geänderte Bedingung an einer bestehenden Tabelle), hinter PR 16; drizzle-kit vergibt die Nummer (nach den
  Plänen von PR 13 bis 16: `0039`).
- **Rechtsquellen, am 05.10.2026 gelesen:** § 3 Abs. 1–4 und § 4 Abs. 1–3 CO2KostAufG, § 10 Abs. 2 BEHG,
  § 12 Abs. 2 und § 28 Abs. 5 und 6 UStG, EBeV 2030 § 1 und Anlage 2 Teil 4 (Fundstelle BGBl. I 2022,
  2881; Vollzitat „Emissionsberichterstattungsverordnung 2030 vom 21. Dezember 2022 (BGBl. I S. 2868)“,
  ohne spätere Änderung) auf gesetze-im-internet.de; die Preisseite der DEHSt zum CO2KostAufG (Stand
  16.12.2025). BMF-Schreiben vom 25.10.2022 zur Senkung der Umsatzsteuer auf Gas und Wärme (Rz. 4, 5, 9,
  10) als Verwaltungsauffassung, gelesen am 05.10.2026.
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen deutsch; Nutzertexte siezen
  (`anrede.test.ts`). Server-Importe mit `.ts`, reine Typimporte mit `import type`, kein `enum`.
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port).
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0. Commit-Nachrichten
  deutsch, mit `Refs #97` bzw. `Refs #210` und den Attribution-Zeilen der ausführenden Sitzung.

## Review Focus

1. **Eine Gasrechnung aus 2023 mit 7 % Umsatzsteuer.** Für Gas über das Erdgasnetz galt vom 01.10.2022 bis
   31.03.2024 der ermäßigte Satz (§ 28 Abs. 5 UStG); gegen 19 % gerechnet wäre jede solche Rechnung
   „unplausibel“. Erwartet: kein Hinweis bei 7 %, ein Hinweis bei 19 %. Test in Task 4.
2. **Eine Gasrechnung vom 15.03.2025 bis 14.03.2026** (über zwei Preisjahre). Ob der Lieferant nach Jahren
   teilt oder alles zum Ende der Ablesung rechnet, sagt das Gesetz nicht eindeutig („zum Zeitpunkt der
   Lieferung“, § 3 Abs. 3). Erwartet: Beides gilt als plausibel (Spanne 55 bis 60 €/t), ein Betrag
   außerhalb nicht. Test in Task 4.
3. **Fernwärme mit Anteil aus dem Emissionshandel** (§ 3 Abs. 4 Nr. 4). Der Anteil ist unbekannt. Erwartet:
   plausibel ist jeder Preis zwischen dem nationalen Preis und dem Durchschnittspreis des Vorjahres der
   Rechnung; ohne Rechnungsdatum keine Preisprüfung. Test in Task 4.
4. **Eine Lieferung im Januar 2027, bevor das Programm den Preis 2027 kennt.** Erwartet: keine
   Preisprüfung und kein Programmfehler; trägt der Vermieter den Preis mit Quelle ein, rechnet die Prüfung
   damit, die Abrechnung nennt den Eintrag (`law.value-overridden`), und ein späteres Release mit dem
   amtlichen Wert ersetzt ihn, wobei `deviation` einer abgeschlossenen Abrechnung den Unterschied zeigt.
   Tests in Task 1 und Task 3.
5. **Heizöl aus dem Vorjahr 2022** (Altbestand, § 11 Abs. 2 Satz 2 CO2KostAufG: CO₂-Kosten bleiben
   unberücksichtigt). Erwartet: keine Preis- und keine EBeV-Prüfung (die EBeV 2030 gilt ab 2023, ein Preis
   vor 2023 steht nicht im Register), kein Fehler. Test in Task 4.

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/law/register.ts`, `shared/types.ts` | `deliveryYear`, `lawOverridable`, `coversDate`, `LawLog.overrides`, `AppliedValue.overridden`, `LawOverride`, `LawOverrideSlot` | 1 |
| `server/test/law-history.test.ts` | Ausnahme „veröffentlichter Wert ersetzt null“ | 1 |
| `shared/law/co2kostaufg.ts`, `shared/law/ustg.ts`, `shared/law/params.ts` | `co2.price`, `co2.price-ets`, `co2.ebev-factors`, `ustg.gas-heat-network-rate` | 2 |
| `server/src/db/schema.ts`, `server/drizzle/00xx_rechtswerte.sql` (erzeugt), `server/src/db/lawOverrides.ts` (neu), `server/src/db/read.ts`, `server/src/index.ts`, `server/src/snapshot.ts`, `server/src/calc.ts` | Tabelle, Lesen/Schreiben, Routen, Einträge in der Berechnung, `law.value-overridden` | 3 |
| `server/src/co2Plausibility.ts` (neu) | Prüfung je Lieferung | 4 |
| `server/src/calc.ts`, `server/src/snapshot.ts`, Golden F13/F17 | `co2.cost-implausible` | 5 |
| `server/src/co2Sheet.ts` (neu), `server/src/index.ts` | Blatt für den Messdienst, Route | 6 |
| `client/src/lawOverrideForm.ts` (neu), `client/src/components/LawOverridesCard.tsx` (neu), `client/src/pages/Einstellungen.tsx`, `client/src/notices.ts`, `client/src/co2Sheet.ts` (neu), `client/src/components/Co2SheetView.tsx` (neu), `client/src/pages/Heizkosten.tsx` | Einträge in den Einstellungen, Anzeige im Rechtsstand, Ausdruck | 7 |
| `shared/glossary.ts`, `CHANGELOG.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-02-rechtsdurchsicht-2026.md` | Lexikon, Doku, Checkliste der Durchsicht | 8 |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

- PR 1 (`shared/law/register.ts`, Code auf `feat/heizung`): `law` (Überladungen `periodStart`,
  `eventDate`, `overlap`), `versionAt`, `valueAt`, `onlyVersion`, `record` (Datei-intern), `contains`
  (Datei-intern), `createLawLog()`, `LawLog = { readonly values: AppliedValue[] }`, `LawParam<T, M>` mit
  `overridable?: { reason: string }`, `LAW_AS_OF`; `AppliedValue`, `LawValue` in `shared/types.ts`;
  `server/test/law-history.test.ts` mit `historyProblems(shipped, now)`; `law.test.ts` mit dem Objekt
  `modules`.
- PR 6 (`shared/law/co2kostaufg.ts`): `ENACTED`, `checked(cite, page)`, `co2ApplicableFrom`, … ; Lexikon
  `co2Split`.
- PR 7: `FuelDelivery` (Felder `invoiceDate`, `deliveredAt`, `invoiceFrom`, `invoiceTo`, `quantity`,
  `quantityUnit`, `energyKwh`, `gasBasis`, `emissionsKg`, `co2CostCents`, `emissionFactor`, `estimated`,
  `amountCents`, `label`, `plantId`); `FuelQuantityUnit`, `GasBasis`, `Co2Restriction`;
  `SnapshotFuelDelivery` (Pick), `Snapshot.fuel`; in `computeSettlement` im Block `for (const pot of
  co2Pots)` die Größen `pot`, `plantOf`, `etsExempt`, `fuelOf`, `plantSubject`, `report`; `fuel.ts`
  `rangeOf(d)`; Routen `/api/heating-plants/:id/deliveries`.
- PR 8: `HeatingPeriodData` mit `stockUnit`, `openingQuantity`, `openingEmissionsKg`, `openingCo2Cents`,
  `openingInvoicedBefore2023`, `closingQuantity`, `closingMeasuredOn`; `Stock.heatingPeriodRows` (die
  Zeilen der Heizperioden, die `readStock` seit PR 6 liefert und PR 8 um den Vorrat erweitert).
- PR 5: `plantRules`, `servesUnit`; PR 8 `plantContext`, `heatingPeriodOf`.
- PR 6: `Stock.co2Statements` (`Co2Statement.areaM2`), `HeatingPeriodView`; Seite Heizkosten mit der Karte
  „CO₂-Kosten“ (`Co2Card`).
- PR 16: `asBilledPlant`, `billingEnergy` (Energie der Abrechnung; Contracting rechnet wie Fernwärme).
- Client: `legalBasisLines(legalBasis)` in `client/src/notices.ts`; `Einstellungen.tsx`; `api`,
  `errorText`, `fmtEuro`, `fmtDate`; `parseDecimal` (co2Form.ts, PR 6); `useToast`.

## Abweichungen vom Entwurf und Festlegungen dieses Plans

1. **`lawOverridable` statt Überschreiben in `law()` (Festlegung).** Der Entwurf sagt, `law()` liefere bei
   `null` den Wert `null` (4.2) und ein Eintrag gelte (4.5). Damit der Übersetzer erzwingt, dass nur
   überschreibbare Parameter Einträge lesen und ihr Wert eine Zahl ist, fragt sie eine eigene Funktion
   (`LawParam<number | null, 'deliveryYear' | 'eventDate'>`); `law()` wirft bei einem überschreibbaren
   Parameter. Protokolliert wird ein Eintrag mit `overridden: { source, enteredAt }`, ein Wert, der weder
   veröffentlicht noch eingetragen ist, gar nicht (wie `none` bei `overlap`, Durchsicht von #221, I1).
2. **Einträge je Kalenderjahr (Festlegung).** `law_overrides.valid_from` ist immer der 1. Januar eines
   Jahres. Beide überschreibbaren Werte sind Jahreswerte (Preis des Lieferjahres; Durchschnittspreis je
   Rechnungsjahr), und ein offenes `null` ab 2027 deckt sonst mit einem einzigen Eintrag alle folgenden
   Jahre.
3. **Veröffentlichter Wert an die Stelle von `null` (Festlegung zu 4.4/4.5).** 4.4 verbietet, eine
   Fassung zu ändern; 4.5 verlangt, dass ein Release den amtlichen Wert bringt. `law-history.test.ts` lässt
   deshalb genau eine weitere Änderung zu: Eine ausgelieferte Fassung mit Wert `null` darf einen Wert
   bekommen und dabei ihr offenes Ende schließen (die Folgejahre bekommen eine neue Fassung mit `null`).
4. **`co2.price-ets` nach Rechnungsjahr (gleichwertige Form).** Der Entwurf nennt die Zeitregel
   „Rechnungsdatum − 1 Jahr“. Die Fassungen tragen das Rechnungsjahr, wie die DEHSt sie veröffentlicht
   (Rechnungsjahr 2023 → Berichtsjahr 2022 → 80,40 €), Zeitregel `eventDate` mit dem Rechnungsdatum. Das
   Ergebnis ist dasselbe, und ein Abgleich mit der Quelle ist Zeile für Zeile möglich.
5. **Neuer Parameter `ustg.gas-heat-network-rate` (Festlegung).** Nicht in 4.3, aber nötig: Ohne ihn
   meldete die Prüfung jede Gas- und Wärmerechnung vom 01.10.2022 bis 31.03.2024 (Review Focus 1). Wert 7 %
   (§ 12 Abs. 2 UStG: „sieben Prozent“; § 28 Abs. 5 und 6 UStG). Maßgeblich ist das Ende des
   Ablesezeitraums (BMF, Rz. 4), bei Lieferungen der Tag der Lieferung. Flüssiggas im Tankwagen nennt nur
   das BMF-Schreiben (Rz. 5), nicht das Gesetz („über das Erdgasnetz“); die Prüfung lässt bei Flüssiggas
   in diesem Zeitraum deshalb beide Sätze gelten.
6. **EBeV-Werte nur 2023 bis 2030 und nur Erdgas, Heizöl EL, Flüssiggas (Festlegung).** Die EBeV 2030 gilt
   „für die Periode von 2023 bis 2030“ (§ 1); vorher galt eine andere Verordnung, deren Werte nicht im
   Register stehen. Kohle hat in Anlage 2 Teil 4 Nr. 9 viele Sorten mit eigenen Werten; ohne die Sorte zu
   kennen, wäre jede Prüfung geraten. Fernwärme und Contracting prüft die EBeV nicht: Die kWh der Rechnung
   sind Wärme, nicht der Energiegehalt des eingesetzten Brennstoffs.
7. **Grenzen der Plausibilität (Festlegung nach 15.2 F6).** CO₂-Kosten: außerhalb der Spanne aus Preisen
   und Steuersätzen um mehr als 1 € und mehr als 3 % (fängt Netto statt Brutto, 19 % statt 7 %, ein falsches
   Preisjahr). kg: Abweichung um mehr als 1 kg und mehr als 1 % (Lieferanten rechnen mit gerundeten Faktoren;
   ein Brennwert-/Heizwert-Fehler macht 10 % aus). Nur Hinweise, keine Rechtsfolge.
8. **Ein Code für kg und € (Festlegung).** 10.1 nennt nur `co2.cost-implausible`; die EBeV-Prüfung meldet
   sich unter demselben Code mit eigenem Text (Titel „CO₂-Angaben der Rechnung prüfen“).
9. **Inhalt des Blatts für den Messdienst (Festlegung).** Je Rechnung, die die Heizperiode berührt, die
   Angaben des § 3 Abs. 1 Nr. 1–4 CO2KostAufG (kg, CO₂-Kosten, Emissionsfaktor, Energiegehalt) samt Menge,
   Zeitraum, Rechnungsdatum und Betrag, dazu Vorrat (PR 8), Fläche der Einstufung mit Herkunft, § 8, § 9,
   § 2 Abs. 4 und die Hinweise der Prüfung. **Keine Abgrenzung auf die Heizperiode**: Der Messdienst
   rechnet über seinen Zeitraum selbst (Entwurf 3.1 Weg c ist unzumutbar, VIII ZR 240/07). Das Blatt gibt es
   für jede Anlage mit Lieferungen, nicht nur beim Messdienst; auch die Gemeinschaft oder ein Steuerberater
   braucht es.
10. **Tolerierte Bestände:** Ein Eintrag in `law_overrides` zu einem Parameter, den das Programm nicht (mehr)
    kennt, wird gelesen und nicht benutzt; die Einstellungen zeigen ihn nicht. Das Wiederherstellen prüft
    die Tabelle nicht, denn kein Eintrag verändert eine Abrechnungszahl.

---

### Task 1: Register: Zeitregel `deliveryYear`, überschreibbare Werte, Protokoll

**Files:**
- Modify: `shared/law/register.ts`, `shared/types.ts`, `server/test/law-history.test.ts`
- Test: `server/test/law.test.ts`, `server/test/law-history.test.ts`

**Interfaces:**
- Consumes: `LawParam`, `Version`, `versionAt`, `record`, `contains`.
- Produces:
  - `shared/types.ts`: `type LawOverride = { paramId: string; validFrom: string; value: number; source: string; enteredAt: string }`; `AppliedValue.overridden?: { source: string; enteredAt: string }`; `type LawOverrideStatus = 'open' | 'entered' | 'superseded'`; `type LawOverrideSlot = { paramId: string; title: string; norm: string; reason: string; year: number; validFrom: string; official: number | null; override: LawOverride | null; status: LawOverrideStatus }`
  - register.ts: `LawLog = { readonly values: AppliedValue[]; readonly overrides: readonly LawOverride[] }`, `createLawLog(overrides?: readonly LawOverride[]): LawLog`, Überladung `law(param: LawParam<T, 'deliveryYear'>, ctx: { year: number }, log): T`, `lawOverridable(param: LawParam<number | null, 'deliveryYear'>, ctx: { year: number }, log): number | null`, `lawOverridable(param: LawParam<number | null, 'eventDate'>, ctx: { date: string }, log): number | null`, `coversDate(param: LawParam<LawValue, Timing>, date: string): boolean`, `yearStart(year: number): string`

- [ ] **Step 1: Write the failing tests**

In `server/test/law.test.ts` den Import aus `'../../shared/law/register.ts'` um `coversDate,
lawOverridable, yearStart` ergänzen und anhängen:

```ts
// ---------- Werte, die später veröffentlicht werden (Heizung PR 17, Entwurf 4.5) ----------

const preis: LawParam<number | null, 'deliveryYear'> = {
  id: 'test.preis', title: 'Preis', norm: '§ 4', timing: 'deliveryYear',
  versions: [
    { validFrom: '2025-01-01', validTo: '2025-12-31', value: 55, source, enacted: 'a' },
    { validFrom: '2026-01-01', value: null, source, enacted: 'b' },
  ],
  describe: (v) => (v === null ? 'noch nicht veröffentlicht' : `${v} €/t`),
  overridable: { reason: 'wird später veröffentlicht' },
}
const fest: LawParam<number, 'deliveryYear'> = {
  id: 'test.fest', title: 'Fest', norm: '§ 5', timing: 'deliveryYear',
  versions: [{ validFrom: '2023-01-01', validTo: '2030-12-31', value: 3, source, enacted: 'a' }],
  describe: (v) => String(v),
}

test('Register: deliveryYear fragt die Fassung am 1. Januar des Jahres', () => {
  const log = createLawLog()
  assert.equal(law(fest, { year: 2023 }, log), 3)
  assert.equal(law(fest, { year: 2030 }, log), 3)
  assert.throws(() => law(fest, { year: 2031 }, log), /Kein Rechtswert/)
  assert.equal(yearStart(2027), '2027-01-01')
})

test('Register: ein überschreibbarer Wert geht nur über lawOverridable (Abweichung 1)', () => {
  assert.throws(() => law(preis as unknown as LawParam<number, 'deliveryYear'>, { year: 2025 }, createLawLog()), /lawOverridable/)
  assert.throws(() => lawOverridable(fest as unknown as LawParam<number | null, 'deliveryYear'>, { year: 2025 }, createLawLog()), /nicht überschreibbar/)
})

test('Register: veröffentlicht gilt; null ohne Eintrag wird nicht protokolliert; ein Eintrag gilt je Jahr und wird gekennzeichnet', () => {
  const ohne = createLawLog()
  assert.equal(lawOverridable(preis, { year: 2025 }, ohne), 55)
  assert.equal(lawOverridable(preis, { year: 2027 }, ohne), null)
  assert.deepEqual(ohne.values.map((v) => v.validFrom), ['2025-01-01'])
  const eintrag = { paramId: 'test.preis', validFrom: '2027-01-01', value: 64.2, source: 'UBA, Bekanntmachung vom 15.12.2026', enteredAt: '2026-12-20' }
  const mit = createLawLog([eintrag])
  assert.equal(lawOverridable(preis, { year: 2027 }, mit), 64.2)
  assert.equal(lawOverridable(preis, { year: 2027 }, mit), 64.2)
  assert.equal(lawOverridable(preis, { year: 2028 }, mit), null, 'ein Eintrag gilt nur für sein Jahr')
  assert.deepEqual(mit.values, [{
    id: 'test.preis', title: 'Preis', norm: '§ 4', cite: 'UBA, Bekanntmachung vom 15.12.2026', value: 64.2, text: '64.2 €/t',
    validFrom: '2027-01-01', validTo: '2027-12-31', overridden: { source: 'UBA, Bekanntmachung vom 15.12.2026', enteredAt: '2026-12-20' },
  }])
  // Ein Eintrag für ein Jahr mit veröffentlichtem Wert ist überholt und gilt nicht (4.5).
  assert.equal(lawOverridable(preis, { year: 2025 }, createLawLog([{ ...eintrag, validFrom: '2025-01-01', value: 99 }])), 55)
})

test('Register: eventDate mit Eintrag nach dem Jahr des Datums', () => {
  const ets: LawParam<number | null, 'eventDate'> = {
    id: 'test.ets', title: 'ETS', norm: '§ 3', timing: 'eventDate', overridable: { reason: 'r' },
    versions: [{ validFrom: '2026-01-01', validTo: '2026-12-31', value: 73.86, source, enacted: 'a' }, { validFrom: '2027-01-01', value: null, source, enacted: 'b' }],
    describe: (v) => String(v),
  }
  const log = createLawLog([{ paramId: 'test.ets', validFrom: '2027-01-01', value: 70, source: 'UBA', enteredAt: '2027-04-01' }])
  assert.equal(lawOverridable(ets, { date: '2026-02-10' }, log), 73.86)
  assert.equal(lawOverridable(ets, { date: '2027-02-10' }, log), 70)
})

test('Register: coversDate sagt, ob es am Tag eine Fassung gibt', () => {
  assert.equal(coversDate(fest, '2022-12-31'), false)
  assert.equal(coversDate(fest, '2023-01-01'), true)
  assert.equal(coversDate(preis, '2031-06-01'), true)
})
```

In `server/test/law-history.test.ts` im Test „Register-Geschichte …“ anhängen:

```ts
  // Heizung PR 17 (Abweichung 3): Ein veröffentlichter Wert ersetzt null und darf das offene Ende schließen.
  const offen = ['p|2027-01-01||null']
  assert.deepEqual(historyProblems([...offen, 'p|2028-01-01||null'], ['p|2027-01-01|2027-12-31|64.2', 'p|2028-01-01||null']), [])
  assert.deepEqual(historyProblems(offen, ['p|2027-01-01||64.2']), [])
  // Ein Wert, der schon dastand, wird nicht still ersetzt, auch nicht durch null.
  assert.equal(historyProblems(['p|2026-01-01|2026-12-31|60'], ['p|2026-01-01|2026-12-31|null']).length, 2)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts`
Expected: FAIL, fehlende Exporte bzw. zwei Abweichungen in der Geschichte.

- [ ] **Step 3: Typen (`shared/types.ts`)**

`AppliedValue` bekommt als letztes Feld:

```ts
  // Vom Vermieter eingetragen, weil der amtliche Wert noch nicht im Programm stand (Heizung PR 17,
  // Entwurf 4.5); `source` ist seine Angabe, `enteredAt` der Tag des Eintrags.
  overridden?: { source: string; enteredAt: string }
```

Hinter `AppliedValue`:

```ts
// Ein vom Vermieter eingetragener Rechtswert (Heizung PR 17, Entwurf 4.5, 5.9): nur für überschreibbare
// Parameter und nur für ein Jahr, in dem das Register `null` hat. `validFrom` ist der 1. Januar.
export type LawOverride = { paramId: string; validFrom: string; value: number; source: string; enteredAt: string }
export type LawOverrideStatus = 'open' | 'entered' | 'superseded'
// Eine Zeile der Einstellungen: ein überschreibbarer Wert eines Jahres, amtlich oder eingetragen.
export type LawOverrideSlot = {
  paramId: string
  title: string
  norm: string
  reason: string
  year: number
  validFrom: string
  official: number | null
  override: LawOverride | null
  status: LawOverrideStatus
}
```

- [ ] **Step 4: Register (`shared/law/register.ts`)**

Den Typimport um `LawOverride` ergänzen. `LawLog` und `createLawLog` ersetzen:

```ts
// Das Protokoll einer Berechnung: was sie abgefragt hat, und die Einträge des Vermieters für Werte, die
// noch nicht veröffentlicht sind (Heizung PR 17). Es wird hineingereicht und ist kein globaler Zustand.
export type LawLog = { readonly values: AppliedValue[]; readonly overrides: readonly LawOverride[] }
export function createLawLog(overrides: readonly LawOverride[] = []): LawLog {
  return { values: [], overrides }
}
```

Hinter `valueAt`:

```ts
// Ob das Register an einem Tag eine Fassung hat. Für Stellen, die einen Wert nur dort brauchen, wo es ihn
// gibt (Plausibilität vor 2023, Umsatzsteuer im Übergangszeitraum), statt auf den Fehler von versionAt zu
// warten.
export function coversDate<T extends LawValue>(param: LawParam<T>, date: string): boolean {
  return param.versions.some((v) => contains(v, date))
}

// Der 1. Januar eines Jahres, wie `deliveryYear` und die Einträge ihn tragen.
export const yearStart = (year: number): string => `${String(year).padStart(4, '0')}-01-01`
```

Die Überladungen von `law()` ersetzen:

```ts
export function law<T extends LawValue>(param: LawParam<T, 'periodStart'>, ctx: { period: Period }, log: LawLog): T
export function law<T extends LawValue>(param: LawParam<T, 'eventDate'>, ctx: { date: string }, log: LawLog): T
export function law<T extends LawValue>(param: LawParam<T, 'deliveryYear'>, ctx: { year: number }, log: LawLog): T
export function law<T extends LawValue>(param: LawParam<T, 'overlap'>, ctx: { period: Period }, log: LawLog): OverlapAnswer<T>
export function law<T extends LawValue>(
  param: LawParam<T, 'periodStart' | 'eventDate' | 'deliveryYear' | 'overlap'>,
  ctx: { period: Period } | { date: string } | { year: number },
  log: LawLog,
): T | OverlapAnswer<T> {
  // Ein Wert, den der Vermieter eintragen darf, geht über lawOverridable (Abweichung 1): Hier würde ein
  // `null` sonst still durchgereicht und der Eintrag übersehen.
  if (param.overridable) throw new Error(`Rechtswert „${param.id}“ ist überschreibbar; bitte lawOverridable nehmen`)
  if (param.timing === 'overlap' && 'period' in ctx) return overlap(param, ctx.period, log)
  const date = 'period' in ctx ? ctx.period.from : 'year' in ctx ? yearStart(ctx.year) : ctx.date
  const version = versionAt(param, date)
  record(log, param, version)
  return version.value
}

// Ein überschreibbarer Wert (Entwurf 4.5): veröffentlicht, dann gilt er (auch wenn ein Eintrag dasteht,
// der ist dann überholt); sonst der Eintrag des Vermieters für das Jahr, gekennzeichnet; sonst null, und
// protokolliert wird nichts.
export function lawOverridable(param: LawParam<number | null, 'deliveryYear'>, ctx: { year: number }, log: LawLog): number | null
export function lawOverridable(param: LawParam<number | null, 'eventDate'>, ctx: { date: string }, log: LawLog): number | null
export function lawOverridable(param: LawParam<number | null, 'deliveryYear' | 'eventDate'>, ctx: { year: number } | { date: string }, log: LawLog): number | null {
  if (!param.overridable) throw new Error(`Rechtswert „${param.id}“ ist nicht überschreibbar; bitte law nehmen`)
  const date = 'year' in ctx ? yearStart(ctx.year) : ctx.date
  const version = versionAt(param, date)
  if (version.value !== null) {
    record(log, param, version)
    return version.value
  }
  const from = yearStart(Number(date.slice(0, 4)))
  const entry = log.overrides.find((o) => o.paramId === param.id && o.validFrom === from)
  if (!entry) return null
  if (!log.values.some((a) => a.id === param.id && a.validFrom === from)) {
    log.values.push({
      id: param.id, title: param.title, norm: param.norm, cite: entry.source, value: entry.value, text: param.describe(entry.value),
      validFrom: from, validTo: `${from.slice(0, 4)}-12-31`, overridden: { source: entry.source, enteredAt: entry.enteredAt },
    })
  }
  return entry.value
}
```

Den Kommentar über `Timing` anpassen: „`incurred` kommt mit PR 18; die Überladungen von `law()` nehmen sie
bis dahin nicht an.“

- [ ] **Step 5: Geschichte (`server/test/law-history.test.ts`)**

In `historyProblems` hinter `closes`:

```ts
  // Heizung PR 17 (Abweichung 3): Ein ausgelieferter Wert `null` (noch nicht veröffentlicht) darf einen
  // Wert bekommen und dabei sein offenes Ende schließen.
  const fills = (open: string, filled: string): boolean => {
    const [id, from, to, ...value] = parts(open)
    const [fid, ffrom, fto, ...fvalue] = parts(filled)
    return fid === id && ffrom === from && value.join('|') === 'null' && fvalue.join('|') !== 'null' && (to === '' || fto === to)
  }
```

und beide Filter erweitern:

```ts
    ...shipped.filter((line) => !now.some((n) => n === line || closes(line, n) || fills(line, n))).map((line) => `ausgelieferte Fassung geändert oder entfernt: ${line}`),
    ...now.filter((line) => !shipped.some((x) => x === line || closes(x, line) || fills(x, line))).map((line) => `neue Fassung ohne Zeile in law-history.test.ts: ${line}`),
```

Den Kopfkommentar der Datei um den Satz ergänzen: „Zweite Ausnahme (Heizung PR 17): Ein Wert `null`, den
eine Behörde später veröffentlicht, darf durch den veröffentlichten ersetzt werden (Entwurf 4.5).“

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts && npm test && npm run typecheck`
Expected: PASS. Stellen, die `createLawLog()` ohne Argument aufrufen, bleiben gültig; Stellen, die ein
`LawLog` als Objektliteral bauen (`{ values: [] }`), meldet der Übersetzer: dort `createLawLog()` nehmen.

- [ ] **Step 7: Commit**

```bash
git add shared/law/register.ts shared/types.ts server/test/law.test.ts server/test/law-history.test.ts server/src server/test
git commit -m "Rechtsregister: Lieferjahr als Zeitregel, überschreibbare Werte mit Eintrag des Vermieters

lawOverridable liest Einträge je Jahr aus dem Protokoll und kennzeichnet sie;
law() lehnt überschreibbare Parameter ab. Ein veröffentlichter Wert darf in
der Geschichte an die Stelle von null treten.

Refs #97"
```

---

### Task 2: Register: Preise, Durchschnittspreise, EBeV-Werte, ermäßigte Umsatzsteuer

**Files:**
- Modify: `shared/law/co2kostaufg.ts`, `shared/law/ustg.ts`, `shared/law/params.ts`
- Test: `server/test/law.test.ts`, `server/test/law-history.test.ts`

**Interfaces:**
- Consumes: Task 1; `ENACTED`, `checked` (co2kostaufg.ts, PR 6).
- Produces:
  - `co2Price: LawParam<number | null, 'deliveryYear'>` (`'co2.price'`)
  - `co2PriceEts: LawParam<number | null, 'eventDate'>` (`'co2.price-ets'`)
  - `type EbevFactors = { readonly gas: { readonly tPerGj: number; readonly hsGjPerMwh: number }; readonly oil: { readonly tPerGj: number; readonly tPerM3: number; readonly gjPerT: number }; readonly lpg: { readonly tPerGj: number; readonly gjPerT: number } }`, `co2EbevFactors: LawParam<EbevFactors, 'deliveryYear'>` (`'co2.ebev-factors'`)
  - `ustgGasHeatNetworkRate: LawParam<number, 'eventDate'>` (`'ustg.gas-heat-network-rate'`)

- [ ] **Step 1: Write the failing tests**

`server/test/law.test.ts`: Importe `co2EbevFactors, co2Price, co2PriceEts` aus
`'../../shared/law/co2kostaufg.ts'`, `ustgGasHeatNetworkRate` aus `'../../shared/law/ustg.ts'`; im Test „jede
Konstante vom Typ LawParam …“ das Objekt `modules` um diese vier erweitern. Anhängen:

```ts
test('Stichtag co2.price: 2023 30, 2024 45, 2025 55, 2026 60 (Mittelwert des Korridors), 2027 offen (§ 4 Abs. 1 CO2KostAufG, § 10 Abs. 2 BEHG)', () => {
  const log = createLawLog()
  assert.deepEqual([2023, 2024, 2025, 2026, 2027, 2030].map((y) => lawOverridable(co2Price, { year: y }, log)), [30, 45, 55, 60, null, null])
  assert.equal(coversDate(co2Price, '2022-12-31'), false, 'vor 2023 bleiben CO₂-Kosten unberücksichtigt (§ 11 Abs. 2 Satz 2)')
  assert.equal(co2Price.describe(55), '55,00 €/t')
  assert.equal(co2Price.describe(null), 'noch nicht veröffentlicht')
  assert.match(versionAt(co2Price, '2026-06-01').source.cite, /§ 4 Abs\. 1 Nr\. 2 CO2KostAufG/)
})

test('Stichtag co2.price-ets: nach Rechnungsjahr der Durchschnitt des Vorjahres (§ 3 Abs. 4 Nr. 4 b, § 4 Abs. 3; DEHSt)', () => {
  const log = createLawLog()
  assert.deepEqual(['2023-03-01', '2024-03-01', '2025-03-01', '2026-03-01', '2027-03-01'].map((d) => lawOverridable(co2PriceEts, { date: d }, log)), [80.4, 83.68, 65.01, 73.86, null])
  assert.equal(coversDate(co2PriceEts, '2022-06-30'), false)
})

test('Stichtag co2.ebev-factors: EBeV 2030 Anlage 2 Teil 4 nur 2023 bis 2030; daraus die bekannten Faktoren', () => {
  const f = law(co2EbevFactors, { year: 2025 }, createLawLog())
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-4, `${a} statt ${b}`)
  near(f.gas.tPerGj * 3.6, 0.20088)
  near(f.gas.tPerGj * f.gas.hsGjPerMwh, 0.18139)
  near(f.oil.tPerGj * 3.6, 0.2664)
  near(f.oil.tPerM3 * f.oil.gjPerT * f.oil.tPerGj, 2.6763)
  near(f.lpg.tPerGj * 3.6, 0.2358)
  near(f.lpg.gjPerT * f.lpg.tPerGj, 3.013)
  assert.equal(coversDate(co2EbevFactors, '2022-12-31'), false)
  assert.equal(coversDate(co2EbevFactors, '2031-01-01'), false)
})

test('Stichtag ustg.gas-heat-network-rate: 7 % vom 01.10.2022 bis 31.03.2024 (§ 28 Abs. 5, 6 UStG)', () => {
  assert.equal(law(ustgGasHeatNetworkRate, { date: '2022-10-01' }, createLawLog()), 7)
  assert.equal(law(ustgGasHeatNetworkRate, { date: '2024-03-31' }, createLawLog()), 7)
  assert.equal(coversDate(ustgGasHeatNetworkRate, '2022-09-30'), false)
  assert.equal(coversDate(ustgGasHeatNetworkRate, '2024-04-01'), false)
})
```

`server/test/law-history.test.ts`, in `SHIPPED` hinter den Zeilen von PR 16:

```ts
  // 0.11.0 (Heizung PR 17, #97)
  'co2.ebev-factors|2023-01-01|2030-12-31|{"gas":{"tPerGj":0.0558,"hsGjPerMwh":3.2508},"oil":{"tPerGj":0.074,"tPerM3":0.845,"gjPerT":42.8},"lpg":{"tPerGj":0.0655,"gjPerT":46}}',
  'co2.price|2023-01-01|2023-12-31|30',
  'co2.price|2024-01-01|2024-12-31|45',
  'co2.price|2025-01-01|2025-12-31|55',
  'co2.price|2026-01-01|2026-12-31|60',
  'co2.price|2027-01-01||null',
  'co2.price-ets|2023-01-01|2023-12-31|80.4',
  'co2.price-ets|2024-01-01|2024-12-31|83.68',
  'co2.price-ets|2025-01-01|2025-12-31|65.01',
  'co2.price-ets|2026-01-01|2026-12-31|73.86',
  'co2.price-ets|2027-01-01||null',
  'ustg.gas-heat-network-rate|2022-10-01|2024-03-31|7',
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts`
Expected: FAIL, fehlende Exporte.

- [ ] **Step 3: Parameter (`shared/law/co2kostaufg.ts`)**

Den Typimport um `Version` ergänzen. Ans Dateiende:

```ts
// ---------- Preise und Standardwerte (Heizung PR 17, #97) ----------
// Gebraucht nur für die Plausibilität (Entwurf 4.5): Keine Abrechnungszahl hängt an ihnen.

const euro2 = (v: number): string => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const yearVersion = <T extends number | null>(year: number, value: T, source: Source, enacted: string): Version<T> =>
  ({ validFrom: `${year}-01-01`, validTo: `${year}-12-31`, value, source, enacted })
const BEHG = 'BEHG vom 12.12.2019 (BGBl. I S. 2728), § 10 Abs. 2 in der am 05.10.2026 geltenden Fassung'
const behg = (cite: string): Source => ({ rank: 'law', cite, url: 'https://www.gesetze-im-internet.de/behg/__10.html', retrieved: '2026-10-05', checked: 'checked' })

// Preis je Tonne CO₂ zum Zeitpunkt der Lieferung (§ 3 Abs. 3, § 4 Abs. 1): bis 2025 der Festpreis nach
// § 10 Abs. 2 Satz 2 BEHG (2023: 30 €, 2024: 45 €, 2025: 55 €), 2026 der Mittelwert des Preiskorridors
// nach § 10 Abs. 2 Satz 4 BEHG (55 bis 65 €, also 60 €; kein Festpreis, D-H4; die DEHSt nennt 60 €), ab
// 2027 der Durchschnittspreis der Versteigerungen vom 01.07. bis 30.11. des Vorjahres, den das UBA
// spätestens zehn Werktage vor Jahresbeginn veröffentlicht (§ 4 Abs. 1 Nr. 3, Abs. 2). Bis dahin `null`
// und überschreibbar (4.5). Vor 2023 steht kein Wert im Register: CO₂-Kosten aus Rechnungen vor dem
// 01.01.2023 bleiben unberücksichtigt (§ 11 Abs. 2 Satz 2).
export const co2Price: LawParam<number | null, 'deliveryYear'> = {
  id: 'co2.price',
  title: 'CO₂-Preis je Tonne (Plausibilität)',
  norm: '§ 3 Abs. 3, § 4 Abs. 1 CO2KostAufG',
  timing: 'deliveryYear',
  versions: [
    yearVersion(2023, 30, behg('§ 4 Abs. 1 Nr. 1 CO2KostAufG; § 10 Abs. 2 Satz 2 Nr. 3 BEHG'), BEHG),
    yearVersion(2024, 45, behg('§ 4 Abs. 1 Nr. 1 CO2KostAufG; § 10 Abs. 2 Satz 2 Nr. 4 BEHG'), BEHG),
    yearVersion(2025, 55, behg('§ 4 Abs. 1 Nr. 1 CO2KostAufG; § 10 Abs. 2 Satz 2 Nr. 5 BEHG'), BEHG),
    yearVersion(2026, 60, checked('§ 4 Abs. 1 Nr. 2 CO2KostAufG; § 10 Abs. 2 Satz 4 BEHG (Mittelwert des Korridors 55 bis 65 €)', '__4.html'), ENACTED),
    { validFrom: '2027-01-01', value: null, source: checked('§ 4 Abs. 1 Nr. 3, Abs. 2 CO2KostAufG (Veröffentlichung des UBA steht aus)', '__4.html'), enacted: ENACTED },
  ],
  describe: (v) => (v === null ? 'noch nicht veröffentlicht' : `${euro2(v)} €/t`),
  overridable: { reason: 'Das Umweltbundesamt veröffentlicht den Preis spätestens zehn Werktage vor Beginn des Jahres (§ 4 Abs. 2 CO2KostAufG).' },
}

// Durchschnittspreis der Versteigerungen im EU-Emissionshandel für den Anteil einer Wärmelieferung aus
// Anlagen des Emissionshandels (§ 3 Abs. 4 Nr. 4 b): der des Kalenderjahres vor der Rechnungsstellung,
// veröffentlicht vom UBA bis 31.03. des Folgejahres (§ 4 Abs. 3). Die Fassungen tragen das Rechnungsjahr,
// wie die DEHSt sie nennt (Abweichung 4): Rechnungsjahr 2023 ↔ Berichtsjahr 2022.
const DEHST: Source = {
  rank: 'law',
  cite: '§ 3 Abs. 4 Nr. 4 b, § 4 Abs. 3 CO2KostAufG; Veröffentlichung der DEHSt (Stand 16.12.2025)',
  url: 'https://www.dehst.de/DE/Themen/nEHS/Verkauf-Versteigerung/Kohlendioxidkostenaufteilungsgesetz/kohlendioxidkostenaufteilungsgesetz_node.html',
  retrieved: '2026-10-05',
  checked: 'checked',
}
export const co2PriceEts: LawParam<number | null, 'eventDate'> = {
  id: 'co2.price-ets',
  title: 'Durchschnittspreis des EU-Emissionshandels (Plausibilität)',
  norm: '§ 3 Abs. 4 Nr. 4 b, § 4 Abs. 3 CO2KostAufG',
  timing: 'eventDate',
  versions: [
    yearVersion(2023, 80.4, DEHST, ENACTED),
    yearVersion(2024, 83.68, DEHST, ENACTED),
    yearVersion(2025, 65.01, DEHST, ENACTED),
    yearVersion(2026, 73.86, DEHST, ENACTED),
    { validFrom: '2027-01-01', value: null, source: DEHST, enacted: ENACTED },
  ],
  describe: (v) => (v === null ? 'noch nicht veröffentlicht' : `${euro2(v)} €/t (Durchschnitt des Vorjahres der Rechnung)`),
  overridable: { reason: 'Das Umweltbundesamt veröffentlicht den Durchschnittspreis bis zum 31. März des Folgejahres (§ 4 Abs. 3 CO2KostAufG).' },
}

// Standardwerte der EBeV 2030, Anlage 2 Teil 4 (BGBl. I 2022, 2881; Vollzitat
// „Emissionsberichterstattungsverordnung 2030 vom 21. Dezember 2022 (BGBl. I S. 2868)“, ohne spätere
// Änderung): Nr. 6 Erdgas 0,0558 t CO₂/GJ, Umrechnungsfaktor 3,2508 GJ/MWh (Brennwert in Heizwert);
// Nr. 3b Heizöl EL 0,074 t CO₂/GJ, Dichte 0,845 t/1000 l, Heizwert 42,8 GJ/t; Nr. 5b Flüssiggas zu
// Heizzwecken 0,0655 t CO₂/GJ, Heizwert 46,0 GJ/t. Für das Lieferjahr maßgeblich (§ 3 Abs. 2 Satz 1
// CO2KostAufG); die EBeV 2030 gilt für 2023 bis 2030 (§ 1). Kohle fehlt bewusst (Abweichung 6).
export type EbevFactors = {
  readonly gas: { readonly tPerGj: number; readonly hsGjPerMwh: number }
  readonly oil: { readonly tPerGj: number; readonly tPerM3: number; readonly gjPerT: number }
  readonly lpg: { readonly tPerGj: number; readonly gjPerT: number }
}
export const co2EbevFactors: LawParam<EbevFactors, 'deliveryYear'> = {
  id: 'co2.ebev-factors',
  title: 'Standardwerte der Brennstoffemissionen (Plausibilität)',
  norm: '§ 3 Abs. 2 CO2KostAufG; Anlage 2 Teil 4 EBeV 2030',
  timing: 'deliveryYear',
  versions: [{
    validFrom: '2023-01-01',
    validTo: '2030-12-31',
    value: { gas: { tPerGj: 0.0558, hsGjPerMwh: 3.2508 }, oil: { tPerGj: 0.074, tPerM3: 0.845, gjPerT: 42.8 }, lpg: { tPerGj: 0.0655, gjPerT: 46.0 } },
    source: { rank: 'law', cite: 'Anlage 2 Teil 4 Nr. 3b, 5b, 6 EBeV 2030', url: 'https://www.gesetze-im-internet.de/ebev_2030/anlage_2.html', retrieved: '2026-10-05', checked: 'checked' },
    enacted: 'Emissionsberichterstattungsverordnung 2030 vom 21. Dezember 2022 (BGBl. I S. 2868)',
  }],
  describe: (v) => `Erdgas ${v.gas.tPerGj.toLocaleString('de-DE')} t CO₂/GJ; Heizöl EL ${v.oil.tPerGj.toLocaleString('de-DE')} t CO₂/GJ; Flüssiggas ${v.lpg.tPerGj.toLocaleString('de-DE')} t CO₂/GJ`,
}
```

(Liegen `Source` und `Version` im Typimport noch nicht vor, beide aus `'./register.ts'` ergänzen.)

- [ ] **Step 4: Parameter (`shared/law/ustg.ts`)**

Ans Dateiende:

```ts
// Ermäßigter Satz für Gas über das Erdgasnetz und Wärme über ein Wärmenetz (Heizung PR 17, Abweichung 5):
// § 28 Abs. 5 und 6 UStG wenden § 12 Abs. 2 („sieben Prozent“) vom 01.10.2022 bis 31.03.2024 auch auf
// diese Lieferungen an (beide am 05.10.2026 auf gesetze-im-internet.de gelesen). Maßgeblich ist der Tag,
// an dem die Lieferung ausgeführt ist, bei Gas und Wärme das Ende des Ablesezeitraums (BMF-Schreiben vom
// 25.10.2022, Rz. 4). Außerhalb des Zeitraums gibt es keine Fassung; dann gilt `ustg.standard-rate`.
export const ustgGasHeatNetworkRate: LawParam<number, 'eventDate'> = {
  id: 'ustg.gas-heat-network-rate',
  title: 'Umsatzsteuer auf Gas und Wärme aus Netzen (Plausibilität)',
  norm: '§ 28 Abs. 5 und 6, § 12 Abs. 2 UStG',
  timing: 'eventDate',
  versions: [{
    validFrom: '2022-10-01',
    validTo: '2024-03-31',
    value: 7,
    source: checked('§ 28 Abs. 5 und 6 UStG', 'https://www.gesetze-im-internet.de/ustg_1980/__28.html'),
    enacted: '§ 28 Abs. 5 und 6 UStG in der am 05.10.2026 auf gesetze-im-internet.de veröffentlichten Fassung',
  }],
  describe: (v) => `${v} %`,
}
```

`shared/law/params.ts`: die vier importieren und in `LAW_PARAMS` nach Kennung einordnen (`co2.ebev-factors`,
`co2.price`, `co2.price-ets` hinter `co2.cut.missing`; `ustg.gas-heat-network-rate` vor `ustg.standard-rate`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/law-literals.test.ts test/law-release.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/law server/test/law.test.ts server/test/law-history.test.ts
git commit -m "Rechtsregister: CO₂-Preise, Durchschnittspreise des Emissionshandels, EBeV-Werte, Umsatzsteuer auf Gas und Wärme 2022 bis 2024

Nur für die Plausibilität; 2027 offen und überschreibbar.

Refs #97"
```

---

### Task 3: Einträge des Vermieters: Tabelle, Routen, Berechnung, `law.value-overridden`

**Files:**
- Modify: `server/src/db/schema.ts`, `server/src/db/read.ts`, `server/src/index.ts`, `server/src/snapshot.ts`, `server/src/calc.ts`, `server/test/migrations.test.ts`, `server/test/schema.test.ts` (falls er jede Tabelle führt)
- Create: `server/drizzle/00xx_rechtswerte.sql` (erzeugt), `server/src/db/lawOverrides.ts`
- Test: `server/test/db-rechtswerte.test.ts` (neu), `server/test/api.test.ts`, `server/test/calc-rechtswerte.test.ts`

**Interfaces:**
- Consumes: Task 1, 2; `LAW_PARAMS`; `Stock`, `readStock`; `snapshotFor`, `heatingSnapshotFor`; `computeSettlement` (`lawLog`, `warn`).
- Produces:
  - schema.ts: `lawOverrides` (Tabelle `law_overrides`)
  - `server/src/db/lawOverrides.ts`: `class LawOverrideError extends Error { status = 400 }`, `readLawOverrides(db: Database): Promise<LawOverride[]>`, `lawOverrideSlots(overrides: readonly LawOverride[], today: string): LawOverrideSlot[]`, `saveLawOverride(db: Database, paramId: string, year: number, body: unknown, today: string): Promise<LawOverrideSlot>`, `removeLawOverride(db: Database, paramId: string, year: number): Promise<boolean>`
  - `Stock.lawOverrides: LawOverride[]`; `Snapshot.lawOverrides?: LawOverride[]`
  - Routen `GET /api/law-overrides`, `PUT /api/law-overrides/:paramId/:year`, `DELETE /api/law-overrides/:paramId/:year`
  - calc.ts: Code `law.value-overridden` (hint)

- [ ] **Step 1: Write the failing tests**

`server/test/db-rechtswerte.test.ts`:

```ts
// Einträge des Vermieters für Rechtswerte, die noch nicht veröffentlicht sind (Heizung PR 17, Entwurf 4.5,
// 5.9).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { LawOverrideError, lawOverrideSlots, readLawOverrides, removeLawOverride, saveLawOverride } from '../src/db/lawOverrides.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-rechtswerte-'))
function rejects(connection: Connection, sql: string): string | null {
  try {
    connection.exec(sql)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = tempDir()
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const refused = (text: RegExp) => (e: unknown) => e instanceof LawOverrideError && e.status === 400 && text.test(e.message)

test('Tabelle: 1. Januar, Quelle Pflicht, JSON gültig, ein Eintrag je Parameter und Jahr', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    const ins = (from: string, json: string, source: string) =>
      `INSERT INTO law_overrides (param_id, valid_from, value_json, source, entered_at) VALUES ('co2.price', '${from}', '${json}', '${source}', '2026-12-20')`
    assert.equal(rejects(c, ins('2027-01-01', '64.2', 'UBA')), null)
    assert.match(rejects(c, ins('2027-01-01', '65', 'UBA')) ?? '', /UNIQUE|PRIMARY/)
    assert.match(rejects(c, ins('2028-02-01', '65', 'UBA')) ?? '', /law_overrides_valid_from_year/)
    assert.match(rejects(c, ins('2028-01-01', '65', '  ')) ?? '', /law_overrides_source_filled/)
    assert.match(rejects(c, ins('2028-01-01', 'kaputt', 'UBA')) ?? '', /law_overrides_value_json/)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Speichern: nur überschreibbar, nur wo null, Zahl über 0, Quelle Pflicht', async () => {
  await withDatabase(async (opened) => {
    const slot = await opened.write((db) => saveLawOverride(db, 'co2.price', 2027, { value: 64.2, source: ' UBA, Bekanntmachung vom 15.12.2026 ' }, '2026-12-20'))
    assert.deepEqual([slot.status, slot.override?.value, slot.override?.source, slot.official], ['entered', 64.2, 'UBA, Bekanntmachung vom 15.12.2026', null])
    await assert.rejects(opened.write((db) => saveLawOverride(db, 'co2.price', 2026, { value: 61, source: 'x' }, '2026-12-20')), refused(/steht der amtliche Wert schon/))
    await assert.rejects(opened.write((db) => saveLawOverride(db, 'hkv.cut.not-by-consumption', 2027, { value: 10, source: 'x' }, '2026-12-20')), refused(/lässt sich nicht eintragen/))
    await assert.rejects(opened.write((db) => saveLawOverride(db, 'co2.price', 2027, { value: 0, source: 'x' }, '2026-12-20')), refused(/größer als 0/))
    await assert.rejects(opened.write((db) => saveLawOverride(db, 'co2.price', 2027, { value: 64, source: '' }, '2026-12-20')), refused(/Quelle/))
    await assert.rejects(opened.write((db) => saveLawOverride(db, 'co2.price', 2022, { value: 30, source: 'x' }, '2026-12-20')), refused(/für 2022 nicht/))
    assert.deepEqual((await opened.read((db) => readLawOverrides(db))).map((o) => [o.paramId, o.validFrom, o.value]), [['co2.price', '2027-01-01', 64.2]])
    assert.equal(await opened.write((db) => removeLawOverride(db, 'co2.price', 2027)), true)
    assert.equal(await opened.write((db) => removeLawOverride(db, 'co2.price', 2027)), false)
  })
})

test('Zeilen der Einstellungen: offen bis ins Folgejahr, eingetragen, überholt', () => {
  const eintrag = { paramId: 'co2.price', validFrom: '2026-01-01', value: 61, source: 'alt', enteredAt: '2025-12-20' }
  const slots = lawOverrideSlots([eintrag], '2026-10-05')
  const preis = slots.filter((s) => s.paramId === 'co2.price').map((s) => [s.year, s.status, s.official])
  assert.deepEqual(preis, [[2026, 'superseded', 60], [2027, 'open', null]])
  assert.deepEqual(slots.filter((s) => s.paramId === 'co2.price-ets').map((s) => [s.year, s.status]), [[2027, 'open']])
})
```

`server/test/calc-rechtswerte.test.ts` (bestehende Datei aus PR 1; anhängen):

```ts
test('Eintrag des Vermieters: die Abrechnung nennt ihn als Hinweis und im Rechtsstand (Heizung PR 17)', () => {
  // Ein Schnappschuss ohne Lieferungen fragt keinen überschreibbaren Wert; der Hinweis entsteht nur aus dem
  // Protokoll. Deshalb hier ein Schnappschuss mit einer Lieferung 2027 (Prüfung aus Task 4/5).
  const s = settleWithDelivery2027([{ paramId: 'co2.price', validFrom: '2027-01-01', value: 64.2, source: 'UBA, Bekanntmachung vom 15.12.2026', enteredAt: '2026-12-20' }])
  const n = (s.notices ?? []).find((x) => x.code === 'law.value-overridden') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /CO₂-Preis je Tonne \(Plausibilität\) 2027: 64,20 €\/t, von Ihnen eingetragen \(Quelle: UBA, Bekanntmachung vom 15\.12\.2026\)/)
  const v = s.legalBasis.values.find((x) => x.id === 'co2.price' && x.validFrom === '2027-01-01') ?? assert.fail('nicht im Rechtsstand')
  assert.deepEqual(v.overridden, { source: 'UBA, Bekanntmachung vom 15.12.2026', enteredAt: '2026-12-20' })
})
```

`settleWithDelivery2027` baut einen Schnappschuss mit einer Gasanlage (`method: 'manual'`), einer
Heizposition 2027 und einer verknüpften Lieferung vom 01.01.2027 bis 31.12.2027 mit `emissionsKg: 10000`,
`co2CostCents: 76398` (10 t × 64,20 € × 1,19); der Helfer steht in Task 5 Step 1 und wird hier aus
`'../testing/co2Snapshot.ts'` importiert. **Diesen Test erst in Task 5 grün erwarten**; in Task 3 bleibt
er mit `test.todo` stehen und wird in Task 5 Step 1 auf `test` umgestellt. (Der Helfer liegt in
`server/testing/`, weil `node --test` jede Datei unter `test/` als Test ausführt; CLAUDE.md.)

In `server/test/api.test.ts` anhängen:

```ts
test('Rechtswerte über die Routen: Liste, eintragen, entfernen (Heizung PR 17)', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const liste = await s.api<LawOverrideSlot[]>('/api/law-overrides')
    assert.ok(liste.some((x) => x.paramId === 'co2.price' && x.status === 'open'))
    const gesetzt = await send('/api/law-overrides/co2.price/2027', { method: 'PUT', body: JSON.stringify({ value: 64.2, source: 'UBA' }) })
    assert.equal(gesetzt.status, 200)
    assert.equal((await jsonOf<LawOverrideSlot>(gesetzt)).status, 'entered')
    const falsch = await send('/api/law-overrides/co2.price/2026', { method: 'PUT', body: JSON.stringify({ value: 61, source: 'x' }) })
    assert.equal(falsch.status, 400)
    assert.equal((await send('/api/law-overrides/co2.price/2027', { method: 'DELETE' })).status, 200)
  } finally {
    await s.stop()
  }
})
```

(`LawOverrideSlot` in den Typimport aus `'../../shared/types.ts'` aufnehmen.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-rechtswerte.test.ts test/api.test.ts`
Expected: FAIL, fehlendes Modul `lawOverrides.ts`.

- [ ] **Step 3: Tabelle (`server/src/db/schema.ts`)**

Ans Dateiende:

```ts
// ---------- Rechtswerte des Vermieters (Heizung PR 17, Entwurf 4.5, 5.9) ----------

// Ein vom Vermieter eingetragener Wert für einen überschreibbaren Parameter, je Kalenderjahr
// (Abweichung 2). Installationsweit, nicht je Objekt: ein Preis gilt für alle Häuser.
export const lawOverrides = sqliteTable(
  'law_overrides',
  {
    paramId: text('param_id').notNull(),
    validFrom: text('valid_from').notNull(),
    valueJson: text('value_json').notNull(),
    source: text('source').notNull(),
    enteredAt: text('entered_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paramId, t.validFrom] }),
    check('law_overrides_valid_from_year', sql.raw(`"valid_from" GLOB '[0-9][0-9][0-9][0-9]-01-01'`)),
    check('law_overrides_source_filled', sql.raw('length(trim("source")) > 0')),
    check('law_overrides_value_json', sql.raw('json_valid("value_json")')),
  ],
)
```

Run: `npm --prefix server run db:generate -- --name rechtswerte`
Expected: ein `CREATE TABLE \`law_overrides\`` mit Primärschlüssel und drei `CONSTRAINT … CHECK`, kein
`__new_`.

Run (Marke):

```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag.includes('rechtswerte')) console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```

Die ausgegebene Zeile in `server/test/migrations.test.ts` hinter den Marken von PR 16 eintragen. Prüft `schema.test.ts` jede
Tabelle gegen ein Gegenstück im Modell, dort `law_overrides` mit `LawOverride` (Spalte `value_json` ↔ Feld
`value`) eintragen.

- [ ] **Step 4: Lesen und Schreiben (`server/src/db/lawOverrides.ts`, neu)**

```ts
// Einträge des Vermieters für Rechtswerte, die eine Behörde später veröffentlicht (Heizung PR 17, Entwurf
// 4.5). Erlaubt nur bei überschreibbaren Parametern und nur für ein Jahr, in dem das Register `null` hat;
// immer mit Quelle. Ein veröffentlichter Wert geht vor (lawOverridable), der Eintrag heißt dann „überholt“.
import { and, eq } from 'drizzle-orm'
import { LAW_PARAMS } from '../../../shared/law/params.ts'
import { coversDate, valueAt, yearStart, type LawParam, type Timing } from '../../../shared/law/register.ts'
import type { LawOverride, LawOverrideSlot, LawValue } from '../../../shared/types.ts'
import type { Database } from './client.ts'
import { lawOverrides } from './schema.ts'

export class LawOverrideError extends Error {
  status = 400
}

const overridable = (): LawParam<LawValue, Timing>[] => LAW_PARAMS.filter((p) => p.overridable !== undefined)

export async function readLawOverrides(db: Database): Promise<LawOverride[]> {
  const rows = await db.select().from(lawOverrides).orderBy(lawOverrides.paramId, lawOverrides.validFrom)
  const out: LawOverride[] = []
  for (const r of rows) {
    const value: unknown = JSON.parse(r.valueJson)
    // Abweichung 10: Was keine Zahl ist, kann kein Preis sein und bleibt ungenutzt.
    if (typeof value === 'number' && Number.isFinite(value)) out.push({ paramId: r.paramId, validFrom: r.validFrom, value, source: r.source, enteredAt: r.enteredAt })
  }
  return out
}

const officialAt = (p: LawParam<LawValue, Timing>, from: string): number | null => {
  if (!coversDate(p, from)) return null
  const v = valueAt(p, from)
  return typeof v === 'number' ? v : null
}

// Je überschreibbarem Parameter die Jahre, in denen das Register `null` hat, bis ins Folgejahr von heute,
// und jedes Jahr mit einem Eintrag.
export function lawOverrideSlots(overrides: readonly LawOverride[], today: string): LawOverrideSlot[] {
  const last = Number(today.slice(0, 4)) + 1
  const slots: LawOverrideSlot[] = []
  for (const p of overridable()) {
    const firstNull = p.versions.find((v) => v.value === null)?.validFrom
    const years = new Set<number>(overrides.filter((o) => o.paramId === p.id).map((o) => Number(o.validFrom.slice(0, 4))))
    if (firstNull) for (let y = Number(firstNull.slice(0, 4)); y <= last; y++) if (coversDate(p, yearStart(y)) && valueAt(p, yearStart(y)) === null) years.add(y)
    for (const year of [...years].sort((a, b) => a - b)) {
      const validFrom = yearStart(year)
      const official = officialAt(p, validFrom)
      const override = overrides.find((o) => o.paramId === p.id && o.validFrom === validFrom) ?? null
      slots.push({
        paramId: p.id, title: p.title, norm: p.norm, reason: p.overridable?.reason ?? '', year, validFrom, official, override,
        status: official !== null ? 'superseded' : override ? 'entered' : 'open',
      })
    }
  }
  return slots
}

export async function saveLawOverride(db: Database, paramId: string, year: number, body: unknown, today: string): Promise<LawOverrideSlot> {
  const p = overridable().find((x) => x.id === paramId)
  if (!p) throw new LawOverrideError('Dieser Rechtswert lässt sich nicht eintragen; eintragen dürfen Sie nur Werte, die eine Behörde später veröffentlicht.')
  if (!Number.isInteger(year)) throw new LawOverrideError('Bitte nennen Sie das Jahr als vierstellige Zahl.')
  const validFrom = yearStart(year)
  if (!coversDate(p, validFrom)) throw new LawOverrideError(`„${p.title}“ gibt es für ${year} nicht.`)
  if (valueAt(p, validFrom) !== null) throw new LawOverrideError(`Für ${year} steht der amtliche Wert schon im Programm; ein eigener Eintrag ist nicht nötig.`)
  const value: unknown = body !== null && typeof body === 'object' ? Reflect.get(body, 'value') : undefined
  const sourceRaw: unknown = body !== null && typeof body === 'object' ? Reflect.get(body, 'source') : undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) throw new LawOverrideError('Der Wert muss eine Zahl größer als 0 sein.')
  const source = typeof sourceRaw === 'string' ? sourceRaw.trim() : ''
  if (source === '') throw new LawOverrideError('Bitte nennen Sie die Quelle, etwa „UBA, Bekanntmachung vom …“.')
  await db.insert(lawOverrides).values({ paramId, validFrom, valueJson: JSON.stringify(value), source, enteredAt: today })
    .onConflictDoUpdate({ target: [lawOverrides.paramId, lawOverrides.validFrom], set: { valueJson: JSON.stringify(value), source, enteredAt: today } })
  const slot = lawOverrideSlots(await readLawOverrides(db), today).find((s) => s.paramId === paramId && s.year === year)
  if (!slot) throw new Error('Der Eintrag ist nach dem Speichern nicht auffindbar.')
  return slot
}

export async function removeLawOverride(db: Database, paramId: string, year: number): Promise<boolean> {
  const where = and(eq(lawOverrides.paramId, paramId), eq(lawOverrides.validFrom, yearStart(year)))
  const before = await db.select({ p: lawOverrides.paramId }).from(lawOverrides).where(where)
  if (before.length === 0) return false
  await db.delete(lawOverrides).where(where)
  return true
}
```

Für 2022 (`co2.price` hat keine Fassung) meldet `saveLawOverride` „gibt es für 2022 nicht“; der Test
erwartet `/für 2022 nicht/`. Für `co2.price` 2026 meldet es „steht der amtliche Wert schon“.

- [ ] **Step 5: Bestand, Schnappschuss, Berechnung**

`server/src/db/read.ts`: `Stock` bekommt `lawOverrides: LawOverride[]`; in `readStock` hinter dem letzten
Feld `lawOverrides: await readLawOverrides(db),` (Import aus `'./lawOverrides.ts'`).

`server/src/snapshot.ts`: `Snapshot` bekommt

```ts
  // Einträge des Vermieters für noch nicht veröffentlichte Rechtswerte (Heizung PR 17); installationsweit.
  lawOverrides?: LawOverride[]
```

`SnapshotSource` bekommt `lawOverrides?: LawOverride[]`; `snapshotFor` und `heatingSnapshotFor` setzen
`lawOverrides: source.lawOverrides ?? []`.

`server/src/calc.ts`: in `computeSettlement` die Zeile `const lawLog = createLawLog()` ersetzen durch

```ts
  const lawLog = createLawLog(snapshot.lawOverrides ?? [])
```

In `noticeKinds`:

```ts
  // Heizung PR 17 (Entwurf 4.5): ein Rechtswert, den der Vermieter eingetragen hat.
  'law.value-overridden': { level: 'hint', title: 'Selbst eingetragener Rechtswert', terms: ['legalBasis'] },
```

Direkt vor `// Die Höchstdauer hat P gebildet (shared/period.ts); eingefroren wird sie hier.` (hinter den
Blöcken von PR 15 und PR 16):

```ts
  // Eingetragene Rechtswerte (Heizung PR 17, Entwurf 4.5): in jeder Abrechnung, die einen nutzt.
  for (const v of lawLog.values) {
    if (!v.overridden) continue
    warn('law.value-overridden',
      `${v.title} ${v.validFrom?.slice(0, 4) ?? ''}: ${v.text}, von Ihnen eingetragen (Quelle: ${v.overridden.source}), weil der amtliche Wert noch nicht im Programm steht. Bringt ein Update den amtlichen Wert, gilt dieser; eine abgeschlossene Abrechnung zeigt den Unterschied dann unter „Abweichung“.`)
  }
```

- [ ] **Step 6: Routen (`server/src/index.ts`)**

Importe `LawOverrideError, lawOverrideSlots, readLawOverrides, removeLawOverride, saveLawOverride` aus
`'./db/lawOverrides.ts'`; `LawOverrideError` in die Liste der Ablehnungen der Fehlerbehandlung aufnehmen
(`err instanceof … || err instanceof LawOverrideError`). Bei den Routen der Einstellungen:

```ts
// Rechtswerte, die eine Behörde später veröffentlicht (Heizung PR 17, Entwurf 4.5).
const todayIso = (): string => new Date().toISOString().slice(0, 10)
app.get('/api/law-overrides', async (_req, res) => {
  res.json(lawOverrideSlots(await readData(readLawOverrides), todayIso()))
})
app.put('/api/law-overrides/:paramId/:year', async (req, res) => {
  res.json(await writeData((db) => saveLawOverride(db, req.params.paramId, Number(req.params.year), bodyObject(req), todayIso())))
})
app.delete('/api/law-overrides/:paramId/:year', async (req, res) => {
  const removed = await writeData((db) => removeLawOverride(db, req.params.paramId, Number(req.params.year)))
  res.json({ ok: true, removed })
})
```

(Diese Routen hängen nicht am Objekt und brauchen kein `?property=`.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-rechtswerte.test.ts test/api.test.ts test/migrations.test.ts test/schema.test.ts test/db-golden.test.ts test/db-changeover.test.ts test/db-backup.test.ts test/settlement-golden.test.ts && npm run typecheck`
Expected: PASS (der Test in calc-rechtswerte.test.ts steht noch als `todo`).

- [ ] **Step 8: Commit**

```bash
git add server/src server/drizzle server/test
git commit -m "Rechtswerte: Einträge des Vermieters mit Quelle, Routen, Hinweis in der Abrechnung

Tabelle law_overrides je Parameter und Jahr; nur überschreibbare Werte und
nur, wo das Register null hat. Ein amtlicher Wert geht vor.

Refs #97"
```

---

### Task 4: Die Prüfung je Lieferung (`server/src/co2Plausibility.ts`)

**Files:**
- Create: `server/src/co2Plausibility.ts`
- Modify: `server/test/law-literals.test.ts` (`ENGINE_FILES`)
- Test: `server/test/co2-plausibility.test.ts` (neu)

**Interfaces:**
- Consumes: `co2Price`, `co2PriceEts`, `co2EbevFactors`, `ustgGasHeatNetworkRate`, `ustgStandardRate`, `lawOverridable`, `law`, `coversDate`, `yearStart`, `LawLog`; `FuelDelivery`, `HeatingEnergy`.
- Produces:
  - `type PlausibilityDelivery = Pick<FuelDelivery, 'id' | 'label' | 'invoiceDate' | 'deliveredAt' | 'invoiceFrom' | 'invoiceTo' | 'quantity' | 'quantityUnit' | 'energyKwh' | 'gasBasis' | 'emissionsKg' | 'co2CostCents' | 'estimated'>`
  - `type PlausibilityFinding = { kind: 'emissions'; deliveryId: string; label: string; emissionsKg: number; expectedKg: number; basis: string } | { kind: 'cost'; deliveryId: string; label: string; emissionsKg: number; co2CostCents: number; lowCents: number; highCents: number; prices: number[]; vat: number[]; years: number[] }`
  - `KG_TOLERANCE = { absolute: 1, relative: 0.01 }`, `COST_TOLERANCE = { absoluteCents: 100, relative: 0.03 }`
  - `co2Plausibility(d: PlausibilityDelivery, energy: HeatingEnergy, log: LawLog): PlausibilityFinding[]`
  - `plausibilityText(f: PlausibilityFinding, fmtCents: (c: number) => string): string`

- [ ] **Step 1: Write the failing test**

`server/test/co2-plausibility.test.ts`:

```ts
// Plausibilität der CO₂-Angaben einer Rechnung (Heizung PR 17, #97, Entwurf 15.2 F6): kg gegen die
// Standardwerte der EBeV 2030, € gegen Preis und Umsatzsteuer. Nur „bitte prüfen“.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { co2Plausibility, plausibilityText, type PlausibilityDelivery } from '../src/co2Plausibility.ts'
import { createLawLog } from '../../shared/law/register.ts'

const base: PlausibilityDelivery = {
  id: 'd', label: 'Lieferung', invoiceDate: null, deliveredAt: null, invoiceFrom: null, invoiceTo: null,
  quantity: null, quantityUnit: null, energyKwh: null, gasBasis: null, emissionsKg: null, co2CostCents: null, estimated: false,
}
const kinds = (d: PlausibilityDelivery, energy: Parameters<typeof co2Plausibility>[1], log = createLawLog()) => co2Plausibility(d, energy, log).map((f) => f.kind)
const euro = (c: number) => `${(c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

test('Heizöl 3.000 l am 15.03.2025: 8.028,9 kg und 525,49 € (Entwurf 8.2) sind plausibel', () => {
  const d = { ...base, deliveredAt: '2025-03-15', invoiceDate: '2025-03-15', quantity: 3000, quantityUnit: 'l' as const, emissionsKg: 8028.9, co2CostCents: 52549 }
  assert.deepEqual(kinds(d, 'oil'), [])
})

test('Heizöl netto statt brutto (441,59 €): Hinweis mit der Spanne', () => {
  const d = { ...base, deliveredAt: '2025-03-15', quantity: 3000, quantityUnit: 'l' as const, emissionsKg: 8028.9, co2CostCents: 44159 }
  const [f] = co2Plausibility(d, 'oil', createLawLog())
  if (!f || f.kind !== 'cost') return assert.fail('kein Hinweis zu den Kosten')
  assert.equal(f.lowCents, 52549)
  assert.match(plausibilityText(f, euro), /„Lieferung“: Die CO₂-Kosten von 441,59 € passen nicht zu 8\.028,9 kg CO₂/)
  assert.match(plausibilityText(f, euro), /wären es 525,49 €/)
  assert.match(plausibilityText(f, euro), /55,00 €\/t \(2025\) zuzüglich 19 % Umsatzsteuer/)
})

test('Review Focus 1: Gas 2023 mit 7 % plausibel, mit 19 % nicht', () => {
  const gas = { ...base, invoiceFrom: '2023-01-01', invoiceTo: '2023-12-31', invoiceDate: '2024-01-20', energyKwh: 100000, gasBasis: 'hs' as const, emissionsKg: 18139 }
  assert.deepEqual(kinds({ ...gas, co2CostCents: 58228 }, 'gas'), [])
  assert.deepEqual(kinds({ ...gas, co2CostCents: 64758 }, 'gas'), ['cost'])
})

test('Review Focus 2: Gas über zwei Preisjahre, Spanne 55 bis 60 €/t', () => {
  const gas = { ...base, invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', invoiceDate: '2026-03-30', emissionsKg: 10000 }
  assert.deepEqual(kinds({ ...gas, co2CostCents: 65450 }, 'gas'), [], 'alles zu 55 €')
  assert.deepEqual(kinds({ ...gas, co2CostCents: 71400 }, 'gas'), [], 'alles zu 60 €')
  assert.deepEqual(kinds({ ...gas, co2CostCents: 68000 }, 'gas'), [], 'geteilt')
  const [f] = co2Plausibility({ ...gas, co2CostCents: 60000 }, 'gas', createLawLog())
  if (!f || f.kind !== 'cost') return assert.fail('kein Hinweis')
  assert.deepEqual([f.lowCents, f.highCents, f.years], [65450, 71400, [2025, 2026]])
  assert.match(plausibilityText(f, euro), /zwischen 654,50 € und 714,00 €/)
})

test('Review Focus 3: Fernwärme mit Emissionshandel, Spanne vom nationalen Preis bis zum Durchschnitt; ohne Rechnungsdatum keine Preisprüfung', () => {
  const fw = { ...base, invoiceFrom: '2024-01-01', invoiceTo: '2024-12-31', invoiceDate: '2025-02-10', emissionsKg: 10000 }
  assert.deepEqual(kinds({ ...fw, co2CostCents: 60000 }, 'districtHeating'), [])
  assert.deepEqual(kinds({ ...fw, co2CostCents: 90000 }, 'districtHeating'), ['cost'])
  assert.deepEqual(kinds({ ...fw, invoiceDate: null, co2CostCents: 90000 }, 'districtHeating'), [])
})

test('Review Focus 4: Lieferung 2027 ohne Preis keine Prüfung; mit Eintrag gegen den Eintrag', () => {
  const g = { ...base, invoiceFrom: '2027-01-01', invoiceTo: '2027-12-31', emissionsKg: 10000, co2CostCents: 76398 }
  assert.deepEqual(kinds(g, 'gas'), [])
  const log = createLawLog([{ paramId: 'co2.price', validFrom: '2027-01-01', value: 64.2, source: 'UBA', enteredAt: '2026-12-20' }])
  assert.deepEqual(kinds(g, 'gas', log), [])
  assert.deepEqual(kinds({ ...g, co2CostCents: 64200 }, 'gas', log), ['cost'])
  assert.ok(log.values.some((v) => v.id === 'co2.price' && v.overridden))
})

test('Review Focus 5: Heizöl aus 2022 wird nicht geprüft', () => {
  assert.deepEqual(kinds({ ...base, deliveredAt: '2022-11-15', invoiceDate: '2022-11-15', quantity: 2000, quantityUnit: 'l', emissionsKg: 1, co2CostCents: 1 }, 'oil'), [])
})

test('EBeV: Gas nach Brennwert mit dem Faktor des Heizwerts gerechnet fällt auf; Flüssiggas in kg passt', () => {
  const falsch = { ...base, invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', energyKwh: 100000, gasBasis: 'hs' as const, emissionsKg: 20088 }
  const [f] = co2Plausibility(falsch, 'gas', createLawLog())
  if (!f || f.kind !== 'emissions') return assert.fail('kein Hinweis zu den kg')
  assert.ok(Math.abs(f.expectedKg - 18139.464) < 1e-6)
  assert.match(plausibilityText(f, euro), /20\.088 kg CO₂ passen nicht zu 100\.000 kWh nach Brennwert/)
  assert.deepEqual(kinds({ ...base, deliveredAt: '2025-05-10', quantity: 1000, quantityUnit: 'kg', emissionsKg: 3013 }, 'lpg'), [])
})

test('Flüssiggas im Zeitraum der Ermäßigung: 7 % und 19 % gelten beide (Abweichung 5)', () => {
  const lpg = { ...base, deliveredAt: '2023-05-10', quantity: 1000, quantityUnit: 'kg' as const, emissionsKg: 3013 }
  assert.deepEqual(kinds({ ...lpg, co2CostCents: 9672 }, 'lpg'), [])
  assert.deepEqual(kinds({ ...lpg, co2CostCents: 10756 }, 'lpg'), [])
})

test('Geschätzte Lieferung, ohne kg oder ohne Zeitpunkt: keine Prüfung', () => {
  assert.deepEqual(kinds({ ...base, estimated: true, deliveredAt: '2025-03-15', quantity: 3000, quantityUnit: 'l', emissionsKg: 1, co2CostCents: 1 }, 'oil'), [])
  assert.deepEqual(kinds({ ...base, co2CostCents: 1 }, 'oil'), [])
})
```

Nachgerechnet: Heizöl 3.000 × 0,845 × 42,8 × 0,074 = 8.028,85 kg; 8,0289 t × 55 € × 1,19 = 525,49 €.
Gas 2023: 100.000 kWh × 0,0558 × 3,2508 = 18.139,46 kg; 18,139 t × 30 € × 1,07 = 582,28 € (7 %) bzw.
647,58 € (19 %); der Unterschied (65,30 €) liegt über 3 % von 582,28 € (17,47 €). Zwei Jahre: 10 t × 55 ×
1,19 = 654,50 €, × 60 × 1,19 = 714,00 €; 600 € liegt mehr als 3 % (19,64 €) unter 654,50 €. Fernwärme
2024, Rechnung 2025: 10 t × 45 × 1,19 = 535,50 € bis 10 t × 65,01 × 1,19 = 773,62 €; 900 € liegt mehr als
3 % (23,21 €) darüber. 2027 mit Eintrag: 10 t × 64,20 × 1,19 = 763,98 €; 642,00 € liegt 121,98 € darunter.
Flüssiggas 2023: 3,013 t × 30 × 1,07 = 96,72 €, × 1,19 = 107,56 €.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/co2-plausibility.test.ts`
Expected: FAIL, fehlendes Modul.

- [ ] **Step 3: Implementation (`server/src/co2Plausibility.ts`)**

```ts
// Plausibilität der CO₂-Angaben einer Rechnung (Heizung PR 17, #97, Entwurf 4.5 und 15.2 F6). Nur ein
// „bitte prüfen“: Keine Zahl der Abrechnung hängt daran, und Mietfuchs rechnet nie kg oder € aus kWh vor
// (Entwurf 16). Verglichen wird, was auf der Rechnung steht, mit dem, was nach Gesetz dastehen müsste:
//
// - kg gegen die Standardwerte der EBeV 2030 für das Lieferjahr (§ 3 Abs. 2 CO2KostAufG), nur Erdgas,
//   Heizöl EL und Flüssiggas (Abweichung 6);
// - € gegen kg × Preis zum Zeitpunkt der Lieferung zuzüglich Umsatzsteuer (§ 3 Abs. 3). Über zwei
//   Preisjahre und bei Fernwärme mit Anteil aus dem Emissionshandel (§ 3 Abs. 4 Nr. 4 b) eine Spanne
//   (Review Focus 2, 3); im Übergangszeitraum der Umsatzsteuer ebenso bei Flüssiggas (Abweichung 5).
import { co2EbevFactors, co2Price, co2PriceEts } from '../../shared/law/co2kostaufg.ts'
import { coversDate, law, lawOverridable, yearStart, type LawLog } from '../../shared/law/register.ts'
import { ustgGasHeatNetworkRate, ustgStandardRate } from '../../shared/law/ustg.ts'
import type { FuelDelivery, HeatingEnergy } from '../../shared/types.ts'

export type PlausibilityDelivery = Pick<FuelDelivery, 'id' | 'label' | 'invoiceDate' | 'deliveredAt' | 'invoiceFrom' | 'invoiceTo' | 'quantity' | 'quantityUnit' | 'energyKwh' | 'gasBasis' | 'emissionsKg' | 'co2CostCents' | 'estimated'>

export type PlausibilityFinding =
  | { kind: 'emissions'; deliveryId: string; label: string; emissionsKg: number; expectedKg: number; basis: string }
  | { kind: 'cost'; deliveryId: string; label: string; emissionsKg: number; co2CostCents: number; lowCents: number; highCents: number; prices: number[]; vat: number[]; years: number[] }

// Grenzen ohne Rechtsquelle (Abweichung 7, Entwurf 15.2 F6).
export const KG_TOLERANCE = { absolute: 1, relative: 0.01 }
export const COST_TOLERANCE = { absoluteCents: 100, relative: 0.03 }

// GJ je MWh, physikalisch (1 kWh = 3,6 MJ); kein Rechtswert.
const GJ_PER_MWH = 3.6
const PRICE_ENERGIES: readonly HeatingEnergy[] = ['gas', 'oil', 'lpg', 'coal', 'districtHeating']
// Gas über das Erdgasnetz, Wärme über ein Wärmenetz (§ 28 Abs. 5, 6 UStG); Flüssiggas nur nach BMF Rz. 5.
const REDUCED_BY_LAW: readonly HeatingEnergy[] = ['gas', 'districtHeating']

const de = (n: number, digits = 1): string => n.toLocaleString('de-DE', { maximumFractionDigits: digits })

function expectedEmissions(d: PlausibilityDelivery, energy: HeatingEnergy, year: number, log: LawLog): { kg: number; basis: string } | null {
  if (!coversDate(co2EbevFactors, yearStart(year))) return null
  const f = law(co2EbevFactors, { year }, log)
  const kwh = d.energyKwh
  if (energy === 'gas') {
    if (kwh === null || d.gasBasis === null) return null
    return d.gasBasis === 'hs'
      ? { kg: kwh * f.gas.tPerGj * f.gas.hsGjPerMwh, basis: `${de(kwh, 0)} kWh nach Brennwert` }
      : { kg: kwh * f.gas.tPerGj * GJ_PER_MWH, basis: `${de(kwh, 0)} kWh nach Heizwert` }
  }
  if (energy === 'oil') {
    if (d.quantityUnit === 'l' && d.quantity !== null) return { kg: d.quantity * f.oil.tPerM3 * f.oil.gjPerT * f.oil.tPerGj, basis: `${de(d.quantity, 0)} Litern Heizöl` }
    if (kwh !== null) return { kg: kwh * f.oil.tPerGj * GJ_PER_MWH, basis: `${de(kwh, 0)} kWh Heizöl` }
    return null
  }
  if (energy === 'lpg') {
    if (d.quantityUnit === 'kg' && d.quantity !== null) return { kg: d.quantity * f.lpg.gjPerT * f.lpg.tPerGj, basis: `${de(d.quantity, 0)} kg Flüssiggas` }
    if (kwh !== null) return { kg: kwh * f.lpg.tPerGj * GJ_PER_MWH, basis: `${de(kwh, 0)} kWh Flüssiggas` }
    return null
  }
  return null
}

function vatRates(energy: HeatingEnergy, date: string, log: LawLog): number[] | null {
  const reducedHere = coversDate(ustgGasHeatNetworkRate, date)
  if (reducedHere && REDUCED_BY_LAW.includes(energy)) return [law(ustgGasHeatNetworkRate, { date }, log)]
  if (!coversDate(ustgStandardRate, date)) return null
  const standard = law(ustgStandardRate, { date }, log)
  if (reducedHere && energy === 'lpg') return [law(ustgGasHeatNetworkRate, { date }, log), standard]
  return [standard]
}

export function co2Plausibility(d: PlausibilityDelivery, energy: HeatingEnergy, log: LawLog): PlausibilityFinding[] {
  if (d.estimated || d.emissionsKg === null || !(d.emissionsKg > 0)) return []
  const start = d.invoiceFrom ?? d.deliveredAt
  const end = d.invoiceTo ?? d.deliveredAt
  if (start === null || end === null) return []
  const out: PlausibilityFinding[] = []
  const endYear = Number(end.slice(0, 4))

  const expected = expectedEmissions(d, energy, endYear, log)
  if (expected !== null) {
    const tol = Math.max(KG_TOLERANCE.absolute, KG_TOLERANCE.relative * expected.kg)
    if (Math.abs(d.emissionsKg - expected.kg) > tol) {
      out.push({ kind: 'emissions', deliveryId: d.id, label: d.label, emissionsKg: d.emissionsKg, expectedKg: expected.kg, basis: expected.basis })
    }
  }

  if (d.co2CostCents === null || !PRICE_ENERGIES.includes(energy)) return out
  // Rechnungen vor 2023: CO₂-Kosten bleiben unberücksichtigt (§ 11 Abs. 2 Satz 2), kein Preis im Register.
  if (d.invoiceDate !== null && !coversDate(co2Price, d.invoiceDate)) return out
  const years: number[] = []
  for (let y = Number(start.slice(0, 4)); y <= endYear; y++) years.push(y)
  if (!years.every((y) => coversDate(co2Price, yearStart(y)))) return out
  const prices: number[] = []
  for (const y of years) {
    const p = lawOverridable(co2Price, { year: y }, log)
    if (p === null) return out
    prices.push(p)
  }
  if (energy === 'districtHeating') {
    if (d.invoiceDate === null || !coversDate(co2PriceEts, d.invoiceDate)) return out
    const ets = lawOverridable(co2PriceEts, { date: d.invoiceDate }, log)
    if (ets === null) return out
    prices.push(ets)
  }
  const vat = vatRates(energy, end, log)
  if (vat === null) return out
  const t = d.emissionsKg / 1000
  const lowCents = Math.round(t * Math.min(...prices) * (1 + Math.min(...vat) / 100) * 100)
  const highCents = Math.round(t * Math.max(...prices) * (1 + Math.max(...vat) / 100) * 100)
  const tol = (x: number) => Math.max(COST_TOLERANCE.absoluteCents, COST_TOLERANCE.relative * x)
  if (d.co2CostCents < lowCents - tol(lowCents) || d.co2CostCents > highCents + tol(highCents)) {
    out.push({ kind: 'cost', deliveryId: d.id, label: d.label, emissionsKg: d.emissionsKg, co2CostCents: d.co2CostCents, lowCents, highCents, prices, vat, years })
  }
  return out
}

const euroPerT = (v: number): string => `${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/t`

// Der Text des Hinweises. Bei einer Spanne nennt er beide Enden und die Preise; bei Fernwärme mit Anteil
// aus dem Emissionshandel ist ein Preis mehr als Jahre im Befund.
export function plausibilityText(f: PlausibilityFinding, fmtCents: (c: number) => string): string {
  if (f.kind === 'emissions') {
    return `„${f.label}“: ${de(f.emissionsKg)} kg CO₂ passen nicht zu ${f.basis}. Mit den Standardwerten der Emissionsberichterstattungsverordnung wären es ${de(f.expectedKg)} kg. ` +
      'Bitte prüfen Sie die Angaben der Rechnung, auch ob Brennwert oder Heizwert gemeint ist (§ 3 Abs. 1 und 2 CO2KostAufG).'
  }
  const expected = f.lowCents === f.highCents ? `wären es ${fmtCents(f.lowCents)}` : `wären es zwischen ${fmtCents(f.lowCents)} und ${fmtCents(f.highCents)}`
  const ets = f.prices.length > f.years.length ? ', mit dem Durchschnittspreis des Emissionshandels' : ''
  const priceText = f.prices.length === 1 && f.years.length === 1
    ? `${euroPerT(f.prices[0] ?? 0)} (${f.years[0]})`
    : `${f.prices.map(euroPerT).join(' bis ')} (${f.years.join(' und ')}${ets})`
  return `„${f.label}“: Die CO₂-Kosten von ${fmtCents(f.co2CostCents)} passen nicht zu ${de(f.emissionsKg)} kg CO₂: Bei ${priceText} zuzüglich ${f.vat.join(' oder ')} % Umsatzsteuer ${expected}. ` +
    'Bitte prüfen Sie die Angaben der Rechnung (§ 3 Abs. 3 CO2KostAufG).'
}
```

Damit lauten die Texte der Tests: „„Lieferung“: Die CO₂-Kosten von 441,59 € passen nicht zu 8.028,9 kg CO₂:
Bei 55,00 €/t (2025) zuzüglich 19 % Umsatzsteuer wären es 525,49 €. …“ und bei zwei Jahren „… Bei 55,00 €/t
bis 60,00 €/t (2025 und 2026) zuzüglich 19 % Umsatzsteuer wären es zwischen 654,50 € und 714,00 €. …“. Bei
zwei Preisen für ein Jahr (Fernwärme) „… 45,00 €/t bis 65,01 €/t (2024, mit dem Durchschnittspreis des
Emissionshandels) …“; die Preise stehen in der Reihenfolge nationaler Preis, dann Durchschnittspreis, nicht
sortiert, und die Spanne der Euro-Beträge nimmt Minimum und Maximum.

In `server/test/law-literals.test.ts` `ENGINE_FILES` um `'server/src/co2Plausibility.ts'` ergänzen (kein
Datums-, kein Rechtszahl-Literal: Die Zahlen 3,6, 1, 100, 0,01 und 0,03 trifft `CODE_PATTERN` nicht).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix server test -- test/co2-plausibility.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/co2Plausibility.ts server/test/co2-plausibility.test.ts server/test/law-literals.test.ts
git commit -m "CO₂-Plausibilität je Rechnung: kg gegen EBeV 2030, Kosten gegen Preis und Umsatzsteuer

Spannen über zwei Preisjahre, beim Emissionshandel und für Flüssiggas im
Übergangszeitraum; vor 2023 keine Prüfung.

Refs #97"
```

---

### Task 5: Berechnung: `co2.cost-implausible`

**Files:**
- Modify: `server/src/calc.ts`, `server/src/snapshot.ts`, `server/test/calc-rechtswerte.test.ts`, gegebenenfalls `server/test/fixtures/settlement/F13*/expected.json` und `README.md`
- Create: `server/testing/co2Snapshot.ts`
- Test: `server/test/calc-co2-plausibilitaet.test.ts` (neu)

**Interfaces:**
- Consumes: `co2Plausibility`, `plausibilityText` (Task 4); im CO₂-Block von `computeSettlement` `pot`, `etsExempt`, `fuelOf`, `plantSubject`, `lawLog`, `warn`, `fmtCents`; `Snapshot.fuel.deliveries`.
- Produces: `SnapshotFuelDelivery` pickt zusätzlich `'invoiceDate' | 'quantity' | 'quantityUnit' | 'energyKwh' | 'gasBasis'` (soweit nicht schon da); Code `co2.cost-implausible` (hint); `server/testing/co2Snapshot.ts` mit `settleWithDelivery(over): ComputedSettlement` und `settleWithDelivery2027(overrides)`.

- [ ] **Step 1: Write the failing tests**

`server/testing/co2Snapshot.ts`:

```ts
// Ein Schnappschuss mit Gasanlage, einer Heizposition und einer verknüpften Lieferung, für die Tests der
// CO₂-Plausibilität (Heizung PR 17). Liegt in testing/, weil node --test jede Datei unter test/ ausführt.
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOfPeriod, type Snapshot } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey, previousPeriod } from '../../shared/period.ts'
import type { FuelDelivery, LawOverride } from '../../shared/types.ts'

export function settleWithDelivery(year: number, delivery: Partial<FuelDelivery>, overrides: LawOverride[] = []): ComputedSettlement {
  const key = periodKey(`${year}-01`)
  const P = periodOfKey(CALENDAR_RULES, key)
  if (!P) throw new Error(`kein Zeitraum ${year}`)
  const item = { id: 'gas', period: key, category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 300000, key: 'area' as const, heatingPlantId: 'hp', heatingPart: 'fuel' as const, fuelDeliveryId: 'd' }
  const source = {
    units: [{ id: 'u1', name: 'EG', areaM2: 300, participates: true }],
    tenancies: [{ id: 't1', unitId: 'u1', tenantName: 'Meier', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }],
    costItems: [item], meters: [], readings: [], payments: [], closedSettlements: [],
  }
  const d: FuelDelivery = {
    id: 'd', plantId: 'hp', label: 'Gasrechnung', invoiceDate: `${year + 1}-01-20`, deliveredAt: null, invoiceFrom: `${year}-01-01`, invoiceTo: `${year}-12-31`,
    unitId: null, amountCents: null, quantity: null, quantityUnit: null, energyKwh: null, gasBasis: null, heatingValue: null,
    emissionsKg: 10000, co2CostCents: null, emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null,
    estimated: false, usedByService: true, parts: [], ...delivery,
  }
  const snapshot: Snapshot = {
    ...snapshotOfPeriod(source, P, previousPeriod(CALENDAR_RULES, P)),
    heatingPlants: [{ id: 'hp', energy: 'gas', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', units: null }],
    fuel: { deliveries: [d], items: [item], frozen: [], closed: [], degreeDays: [] },
    lawOverrides: overrides,
  }
  return computeSettlement(snapshot)
}

export const settleWithDelivery2027 = (overrides: LawOverride[]): ComputedSettlement => settleWithDelivery(2027, { co2CostCents: 76398 }, overrides)
```

(Die Felder von `FuelDelivery` und `SnapshotHeatingPlant` sind die aus PR 7, PR 11 und PR 16; verlangt
eine spätere PR weitere Pflichtfelder, ergänzt der Übersetzer sie hier.)

`server/test/calc-co2-plausibilitaet.test.ts`:

```ts
// Plausibilität der CO₂-Angaben in der Abrechnung (Heizung PR 17, #97).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { settleWithDelivery } from '../testing/co2Snapshot.ts'

const hints = (s: ReturnType<typeof settleWithDelivery>) => (s.notices ?? []).filter((n) => n.code === 'co2.cost-implausible')

test('Gas 2025, 10 t, 654,50 € plausibel; 550,00 € nicht: ein hint am Topf der Anlage', () => {
  assert.equal(hints(settleWithDelivery(2025, { co2CostCents: 65450 })).length, 0)
  const [n, ...rest] = hints(settleWithDelivery(2025, { co2CostCents: 55000 }))
  if (!n) return assert.fail('kein Hinweis')
  assert.equal(rest.length, 0)
  assert.equal(n.level, 'hint')
  assert.match(n.text, /„Gasrechnung“: Die CO₂-Kosten von 550,00 €/)
})

test('Wer nichts einträgt, merkt nichts: ohne CO₂-Kosten und kWh kein Hinweis', () => {
  assert.equal(hints(settleWithDelivery(2025, {})).length, 0)
})

test('Die benutzten Werte stehen im Rechtsstand, als Plausibilität benannt', () => {
  const s = settleWithDelivery(2025, { co2CostCents: 65450 })
  const ids = s.legalBasis.values.map((v) => v.id)
  assert.ok(ids.includes('co2.price'))
  assert.ok(ids.includes('ustg.standard-rate'))
  assert.match(s.legalBasis.values.find((v) => v.id === 'co2.price')?.title ?? '', /Plausibilität/)
})
```

In `server/test/calc-rechtswerte.test.ts` den Test „Eintrag des Vermieters …“ von `test.todo` auf `test`
stellen und `settleWithDelivery2027` aus `'../testing/co2Snapshot.ts'` importieren.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-co2-plausibilitaet.test.ts test/calc-rechtswerte.test.ts`
Expected: FAIL, kein Hinweis `co2.cost-implausible` bzw. `law.value-overridden`.

- [ ] **Step 3: Schnappschuss (`server/src/snapshot.ts`)**

`SnapshotFuelDelivery` (PR 7) um `| 'invoiceDate' | 'quantity' | 'quantityUnit' | 'energyKwh' | 'gasBasis'`
ergänzen, soweit PR 11 sie nicht schon pickt.

- [ ] **Step 4: Berechnung (`server/src/calc.ts`)**

Import `co2Plausibility, plausibilityText` aus `'./co2Plausibility.ts'`. In `noticeKinds`:

```ts
  // Heizung PR 17 (#97, Entwurf 15.2 F6): kg oder CO₂-Kosten einer Rechnung passen nicht zum Gesetz.
  'co2.cost-implausible': { level: 'hint', title: 'CO₂-Angaben der Rechnung prüfen', terms: ['co2Split'] },
```

Im Block `for (const pot of co2Pots)` direkt hinter dem Block `if (fuelOf) { report.fuel = … }` (PR 7
Task 7):

```ts
    // Plausibilität der CO₂-Angaben je Rechnung dieser Heizperiode (Heizung PR 17, #97). Bei Wärme aus
    // dem Emissionshandel mit Anschluss nach dem Stichtag gilt das Gesetz nicht (etsExempt, PR 7).
    if (fuelOf && !etsExempt) {
      const used = new Set(fuelOf.lines.map((l) => l.deliveryId))
      for (const d of (snapshot.fuel?.deliveries ?? []).filter((x) => x.plantId === pot.plantId && used.has(x.id))) {
        for (const f of co2Plausibility(d, pot.energy, lawLog)) warn('co2.cost-implausible', plausibilityText(f, fmtCents), plantSubject)
      }
    }
```

(`pot.energy` ist die Energie der Abrechnung, bei Contracting `districtHeating`, PR 16. `plantSubject` ist
der Gegenstand der Anlage aus PR 7; heißt er dort anders, diesen nehmen. Liegt `fuelOf` in PR 7 nur bei
`applicable` vor, bleibt das so: Vor 2023 prüft die Plausibilität ohnehin nichts.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-co2-plausibilitaet.test.ts test/calc-rechtswerte.test.ts test/calc-notices.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Golden**

Run: `npm --prefix server test -- test/settlement-golden.test.ts test/db-golden.test.ts`

Expected: F01–F12, F14–F16, F18 grün ohne Änderung. **F17** (Heizöl, Entwurf 8.2) bleibt ohne Hinweis:
Beide Lieferungen sind nach EBeV und Preis 2025 gerechnet (8.028,9 kg/525,49 €; 6.690,75 kg/437,91 €), ihr
`legalBasis.values` bekommt aber die benutzten Werte (`co2.ebev-factors`, `co2.price`,
`ustg.standard-rate`); die Vergleiche der Golden lassen `legalBasis.values` aus (Entwurf 4.7, „Umstellung
ohne Golden-Änderung“), sonst dort ergänzen. **F13** trägt erfundene kg (Entwurf 12.1, „bis dahin ist der
Wert erfunden“); meldet die Berechnung dort `co2.cost-implausible`, sind kg und € der erfundenen Rechnung
nicht zueinander stimmig. Dann bekommt `expected.json` von F13 den Hinweis in `warnings` und `notices`,
und das README von F13 den Satz: „Seit Heizung PR 17 meldet die Abrechnung `co2.cost-implausible`, weil kg
und CO₂-Kosten der erfundenen Rechnung nicht nach § 3 Abs. 3 CO2KostAufG zusammenpassen; keine Zahl ändert
sich. Mit der echten Rechnung (Gegenprüfung E.10) entfällt der Hinweis.“ Keine Zahl des Fixtures ändert sich.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add server/src/calc.ts server/src/snapshot.ts server/testing/co2Snapshot.ts server/test
git commit -m "Abrechnung: CO₂-Angaben jeder Rechnung auf Plausibilität geprüft (co2.cost-implausible)

Refs #97"
```

---

### Task 6: Blatt „CO₂-Angaben für den Messdienst“ (Server)

**Files:**
- Create: `server/src/co2Sheet.ts`
- Modify: `server/src/index.ts`, `shared/types.ts`
- Test: `server/test/co2-sheet.test.ts` (neu), `server/test/api.test.ts`

**Interfaces:**
- Consumes: `co2Plausibility`, `plausibilityText` (Task 4); `rangeOf` (fuel.ts, PR 7); `servesUnit` (PR 5); `isDwelling` (shared/heating.ts); `asBilledPlant` (PR 16); `createLawLog`; `Stock` mit `heatingPlants`, `fuelDeliveries`, `co2Statements`, `heatingPeriodRows`, `units`, `properties`, `settings`, `lawOverrides`; `plantContext`, `heatingPeriodOf` (PR 8).
- Produces:
  - `shared/types.ts`: `type Co2SheetDelivery = { id: string; label: string; invoiceDate: string | null; from: string | null; to: string | null; deliveredAt: string | null; quantity: number | null; quantityUnit: FuelQuantityUnit | null; energyKwh: number | null; gasBasis: GasBasis | null; emissionFactor: number | null; emissionsKg: number | null; co2CostCents: number | null; amountCents: number | null; estimated: boolean; findings: string[] }`, `type Co2SheetStock = Pick<HeatingPeriodData, 'stockUnit' | 'openingQuantity' | 'openingEmissionsKg' | 'openingCo2Cents' | 'openingInvoicedBefore2023' | 'closingQuantity' | 'closingMeasuredOn'>`, `type Co2Sheet = { propertyName: string; address: string; landlordName: string; plantName: string; energy: HeatingEnergy; contracting: boolean; fuelEnergy: HeatingEnergy | null; period: { key: string; from: string; to: string }; areaM2: number | null; areaSource: 'entered' | 'served' | null; nonResidential: boolean; restriction: Co2Restriction; districtEtsNew: boolean; stock: Co2SheetStock | null; deliveries: Co2SheetDelivery[]; totals: { emissionsKg: number; co2CostCents: number } }`
  - `co2SheetOf(input: Co2SheetInput): Co2Sheet` mit `type Co2SheetInput = { propertyName: string; address: string; landlordName: string; plant: HeatingPlant; h: { key: string; from: string; to: string }; units: readonly Unit[]; enteredAreaM2: number | null; stock: Co2SheetStock | null; deliveries: readonly FuelDelivery[]; overrides: readonly LawOverride[] }`
  - Route `GET /api/heating-plants/:id/periods/:period/co2-sheet` → `Co2Sheet` (404 ohne Anlage oder Heizperiode)

- [ ] **Step 1: Write the failing test**

`server/test/co2-sheet.test.ts`:

```ts
// Das Blatt „CO₂-Angaben für den Messdienst“ (Heizung PR 17, #210, Abweichung 9).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { co2SheetOf, type Co2SheetInput } from '../src/co2Sheet.ts'
import type { FuelDelivery, HeatingPlant, Unit } from '../../shared/types.ts'

const plant = { id: 'hp', propertyId: 'o', name: 'Kessel', energy: 'oil', supply: 'central', method: 'service', units: null, contracting: false, nonResidential: false, restriction: 'none', districtEtsNew: false } as HeatingPlant
const lieferung = (over: Partial<FuelDelivery>): FuelDelivery => ({
  id: 'd', plantId: 'hp', label: 'Heizöl', invoiceDate: '2025-03-15', deliveredAt: '2025-03-15', invoiceFrom: null, invoiceTo: null, unitId: null,
  amountCents: 315000, quantity: 3000, quantityUnit: 'l', energyKwh: null, gasBasis: null, heatingValue: null, emissionsKg: 8028.9, co2CostCents: 52549,
  emissionFactor: 0.2664, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [], ...over,
} as FuelDelivery)
const input = (over: Partial<Co2SheetInput> = {}): Co2SheetInput => ({
  propertyName: 'Haus am Park', address: 'Parkweg 1', landlordName: 'Erika Muster', plant,
  h: { key: '2025-01', from: '2025-01-01', to: '2025-12-31' },
  units: [{ id: 'u1', name: 'EG', areaM2: 120 } as Unit, { id: 'u2', name: 'OG', areaM2: 180 } as Unit],
  enteredAreaM2: null, stock: null,
  deliveries: [lieferung({}), lieferung({ id: 'd2', label: 'Heizöl Oktober', deliveredAt: '2025-10-10', invoiceDate: '2025-10-10', quantity: 2500, emissionsKg: 6690.75, co2CostCents: 43791 }), lieferung({ id: 'alt', deliveredAt: '2024-11-01', invoiceDate: '2024-11-01' })],
  overrides: [], ...over,
})

test('Blatt: Rechnungen der Heizperiode mit den Angaben nach § 3 Abs. 1, Summen, Fläche aus den Wohnungen', () => {
  const s = co2SheetOf(input())
  assert.deepEqual(s.deliveries.map((d) => d.id), ['d', 'd2'])
  assert.deepEqual(s.totals, { emissionsKg: 14719.65, co2CostCents: 96340 })
  assert.deepEqual([s.areaM2, s.areaSource], [300, 'served'])
  assert.deepEqual(s.deliveries[0]?.findings, [])
  assert.equal(s.landlordName, 'Erika Muster')
})

test('Blatt: eingetragene Fläche geht vor; Hinweise der Prüfung stehen an der Rechnung', () => {
  const s = co2SheetOf(input({ enteredAreaM2: 290, deliveries: [lieferung({ co2CostCents: 44159 })] }))
  assert.deepEqual([s.areaM2, s.areaSource], [290, 'entered'])
  assert.match(s.deliveries[0]?.findings[0] ?? '', /passen nicht zu 8\.028,9 kg CO₂/)
})

test('Blatt: Contracting nennt Wärmelieferung und den Brennstoff', () => {
  const s = co2SheetOf(input({ plant: { ...plant, energy: 'gas', contracting: true } as HeatingPlant, deliveries: [] }))
  assert.deepEqual([s.energy, s.contracting, s.fuelEnergy], ['districtHeating', true, 'gas'])
})
```

(Die Umwandlungen mit `as` stehen nur im Test, wo vollständige Objekte nur Lärm wären; die Summen:
8.028,9 + 6.690,75 = 14.719,65 kg; 525,49 + 437,91 = 963,40 €.)

In `server/test/api.test.ts` anhängen:

```ts
test('Blatt für den Messdienst über die Route: 200 mit Rechnungen, 404 ohne Anlage (Heizung PR 17, #210)', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', postJson({ energy: 'gas', method: 'service' })))
    await send(`/api/heating-plants/${plant.id}/deliveries`, postJson({ label: 'Gas 2025', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', invoiceDate: '2026-01-20', amountCents: 300000, energyKwh: 100000, gasBasis: 'hs', emissionsKg: 18139, co2CostCents: 117000 }))
    const blatt = await send(`/api/heating-plants/${plant.id}/periods/2025-01/co2-sheet`, { method: 'GET' })
    assert.equal(blatt.status, 200)
    const sheet = await jsonOf<Co2Sheet>(blatt)
    assert.deepEqual(sheet.deliveries.map((d) => d.label), ['Gas 2025'])
    assert.equal((await send('/api/heating-plants/fehlt/periods/2025-01/co2-sheet', { method: 'GET' })).status, 404)
  } finally {
    await s.stop()
  }
})
```

(`Co2Sheet` in den Typimport aufnehmen. Die Felder der Lieferung sind die der Route aus PR 7 Task 5; nimmt
sie andere Namen, diese.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/co2-sheet.test.ts test/api.test.ts`
Expected: FAIL, fehlendes Modul.

- [ ] **Step 3: Typen (`shared/types.ts`)**

Die Typen aus „Produces“ ans Ende des CO₂-Abschnitts.

- [ ] **Step 4: Implementation (`server/src/co2Sheet.ts`)**

```ts
// Das Blatt „CO₂-Angaben für den Messdienst“ (Heizung PR 17, #210, Abweichung 9): je Rechnung, die die
// Heizperiode berührt, die Angaben des § 3 Abs. 1 Nr. 1–4 CO2KostAufG und was der Messdienst für die
// Einstufung braucht (Fläche, § 8, § 9, § 2 Abs. 4, Vorrat). Abgegrenzt wird nicht: Der Messdienst rechnet
// über seinen Zeitraum selbst.
import { asBilledPlant } from '../../shared/heatDelivery.ts'
import { isDwelling } from '../../shared/heating.ts'
import { servesUnit } from '../../shared/heatingPeriod.ts'
import { createLawLog } from '../../shared/law/register.ts'
import type { Co2Sheet, Co2SheetStock, FuelDelivery, HeatingPlant, LawOverride, Unit } from '../../shared/types.ts'
import { co2Plausibility, plausibilityText } from './co2Plausibility.ts'
import { rangeOf } from './fuel.ts'

export type Co2SheetInput = {
  propertyName: string
  address: string
  landlordName: string
  plant: HeatingPlant
  h: { key: string; from: string; to: string }
  units: readonly Unit[]
  enteredAreaM2: number | null
  stock: Co2SheetStock | null
  deliveries: readonly FuelDelivery[]
  overrides: readonly LawOverride[]
}

const fmtCents = (c: number): string => `${(c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

export function co2SheetOf(i: Co2SheetInput): Co2Sheet {
  const billed = asBilledPlant(i.plant)
  const touching = i.deliveries.filter((d) => {
    if (d.plantId !== i.plant.id) return false
    const r = rangeOf(d)
    return r !== null && r.from <= i.h.to && r.to >= i.h.from
  })
  const log = createLawLog(i.overrides)
  const deliveries = touching.map((d) => ({
    id: d.id, label: d.label, invoiceDate: d.invoiceDate, from: d.invoiceFrom, to: d.invoiceTo, deliveredAt: d.deliveredAt,
    quantity: d.quantity, quantityUnit: d.quantityUnit, energyKwh: d.energyKwh, gasBasis: d.gasBasis, emissionFactor: d.emissionFactor,
    emissionsKg: d.emissionsKg, co2CostCents: d.co2CostCents, amountCents: d.amountCents, estimated: d.estimated,
    findings: co2Plausibility(d, billed.energy, log).map((f) => plausibilityText(f, fmtCents)),
  }))
  const served = i.units.filter((u) => servesUnit(i.plant, u) && isDwelling(u)).reduce((a, u) => a + (u.areaM2 ?? 0), 0)
  const area = i.enteredAreaM2 ?? (served > 0 ? served : null)
  return {
    propertyName: i.propertyName, address: i.address, landlordName: i.landlordName,
    plantName: i.plant.name, energy: billed.energy, contracting: i.plant.contracting, fuelEnergy: billed.fuelEnergy ?? null,
    period: { key: i.h.key, from: i.h.from, to: i.h.to },
    areaM2: area, areaSource: i.enteredAreaM2 !== null ? 'entered' : area !== null ? 'served' : null,
    nonResidential: i.plant.nonResidential, restriction: i.plant.restriction, districtEtsNew: i.plant.districtEtsNew,
    stock: i.stock, deliveries,
    totals: {
      emissionsKg: Math.round(deliveries.reduce((a, d) => a + (d.emissionsKg ?? 0), 0) * 100) / 100,
      co2CostCents: deliveries.reduce((a, d) => a + (d.co2CostCents ?? 0), 0),
    },
  }
}
```

(`isDwelling` steht nach #140 in `shared/heating.ts`; verlangt es Felder, die `Unit` hat, genügt der
Aufruf. `rangeOf` aus PR 7 liefert für eine Lieferung mit Lieferdatum den Tag selbst als Spanne.)

- [ ] **Step 5: Route (`server/src/index.ts`)**

```ts
// Das Blatt „CO₂-Angaben für den Messdienst“ (Heizung PR 17, #210).
app.get('/api/heating-plants/:id/periods/:period/co2-sheet', async (req, res) => {
  const sheet = await readData(async (db) => {
    const stock = await readStock(db)
    const plant = stock.heatingPlants.find((p) => p.id === req.params.id)
    const ctx = plant ? await plantContext(db, plant.id) : null
    const h = ctx ? heatingPeriodOf(ctx, req.params.period) : null
    if (!plant || !h) return null
    const property = stock.properties.find((p) => p.id === plant.propertyId)
    const statement = stock.co2Statements.find((s) => s.plantId === plant.id && s.period === h.key)
    const row = stock.heatingPeriodRows.find((r) => r.plantId === plant.id && r.period === h.key) ?? null
    return co2SheetOf({
      propertyName: property?.name ?? '', address: property?.address ?? '',
      landlordName: property?.landlordName ?? stock.settings.landlordName,
      plant, h: { key: String(h.key), from: h.from, to: h.to },
      units: stock.units.filter((u) => u.propertyId === plant.propertyId),
      enteredAreaM2: statement?.areaM2 ?? null,
      stock: row && row.stockUnit !== null ? {
        stockUnit: row.stockUnit, openingQuantity: row.openingQuantity, openingEmissionsKg: row.openingEmissionsKg, openingCo2Cents: row.openingCo2Cents,
        openingInvoicedBefore2023: row.openingInvoicedBefore2023, closingQuantity: row.closingQuantity, closingMeasuredOn: row.closingMeasuredOn,
      } : null,
      deliveries: stock.fuelDeliveries, overrides: stock.lawOverrides,
    })
  })
  if (!sheet) return res.status(404).json({ error: 'Diese Heizanlage oder Heizperiode gibt es nicht (mehr).' })
  res.json(sheet)
})
```

(Namen der Felder an `Stock` nach PR 6–8 und #92: `properties` mit `name`, `address`, `landlordName`
(`null` heißt Vorgabe), `settings.landlordName`, `co2Statements`, `heatingPeriodRows`, `fuelDeliveries`.
Weicht einer ab, den Namen der jeweiligen PR nehmen.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/co2-sheet.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/co2Sheet.ts server/src/index.ts shared/types.ts server/test/co2-sheet.test.ts server/test/api.test.ts
git commit -m "Blatt „CO₂-Angaben für den Messdienst“: Rechnungen der Heizperiode mit den Angaben nach § 3 CO2KostAufG

Refs #210"
```

---

### Task 7: Oberfläche: Einträge in den Einstellungen, Rechtsstand, Ausdruck

**Files:**
- Create: `client/src/lawOverrideForm.ts`, `client/src/components/LawOverridesCard.tsx`, `client/src/co2Sheet.ts`, `client/src/components/Co2SheetView.tsx`
- Modify: `client/src/pages/Einstellungen.tsx`, `client/src/notices.ts`, `client/src/pages/Heizkosten.tsx`
- Test: `client/src/lawOverrideForm.test.ts` (neu), `client/src/notices.test.ts`, `client/src/co2Sheet.test.ts` (neu), `client/src/components/LawOverridesCard.test.tsx` (neu)

**Interfaces:**
- Consumes: Routen aus Task 3 und 6; `LawOverrideSlot`, `Co2Sheet`; `parseDecimal` (co2Form.ts); `energyLabelOf` (PR 16); `api`, `errorText`, `fmtEuro`, `fmtDate`; `useToast`.
- Produces:
  - `lawOverrideForm.ts`: `statusText(slot)`, `type OverrideDraft = { value: string; source: string }`, `draftOf(slot)`, `overrideBody(draft): { body: { value: number; source: string } } | { error: string }`
  - `notices.ts`: `legalBasisLines` nennt eingetragene Werte
  - `co2Sheet.ts`: `type SheetRow = { label: string; cells: string[] }`, `sheetHead(sheet)`, `sheetRows(sheet)`, `sheetFacts(sheet)`
  - Komponenten `LawOverridesCard()`, `Co2SheetView({ plantId, period, onClose })`

- [ ] **Step 1: Write the failing tests**

`client/src/lawOverrideForm.test.ts`:

```ts
import { expect, test } from 'vitest'
import { draftOf, overrideBody, statusText } from './lawOverrideForm'
import type { LawOverrideSlot } from './types'

const slot = (over: Partial<LawOverrideSlot> = {}): LawOverrideSlot => ({
  paramId: 'co2.price', title: 'CO₂-Preis je Tonne (Plausibilität)', norm: '§ 3 Abs. 3, § 4 Abs. 1 CO2KostAufG', reason: 'UBA veröffentlicht …',
  year: 2027, validFrom: '2027-01-01', official: null, override: null, status: 'open', ...over,
})

test('Status in Worten', () => {
  expect(statusText(slot())).toBe('2027: noch nicht veröffentlicht')
  expect(statusText(slot({ status: 'entered', override: { paramId: 'co2.price', validFrom: '2027-01-01', value: 64.2, source: 'UBA', enteredAt: '2026-12-20' } }))).toBe('2027: 64,20 von Ihnen eingetragen am 20.12.2026 (Quelle: UBA)')
  expect(statusText(slot({ status: 'superseded', official: 64.2, override: { paramId: 'co2.price', validFrom: '2027-01-01', value: 65, source: 'UBA', enteredAt: '2026-12-20' } }))).toBe('2027: amtlich 64,20; Ihr Eintrag 65,00 ist überholt')
})

test('Rumpf: Zahl mit Komma und Quelle Pflicht', () => {
  expect(overrideBody({ value: '64,20', source: 'UBA' })).toEqual({ body: { value: 64.2, source: 'UBA' } })
  expect(overrideBody({ value: '', source: 'UBA' })).toEqual({ error: 'Bitte geben Sie den Wert als Zahl an, etwa 64,20.' })
  expect(overrideBody({ value: '64,20', source: ' ' })).toEqual({ error: 'Bitte nennen Sie die Quelle, etwa „UBA, Bekanntmachung vom …“.' })
  expect(draftOf(slot())).toEqual({ value: '', source: '' })
})
```

In `client/src/notices.test.ts` anhängen:

```ts
test('Rechtsstand: ein eingetragener Wert nennt die Quelle des Vermieters (Heizung PR 17)', () => {
  const lines = legalBasisLines({ asOf: '2026-10-05', rules: [], values: [{ id: 'co2.price', title: 'CO₂-Preis je Tonne (Plausibilität)', norm: '§ 4', cite: 'UBA', value: 64.2, text: '64,20 €/t', validFrom: '2027-01-01', validTo: '2027-12-31', overridden: { source: 'UBA', enteredAt: '2026-12-20' } }] })
  expect(lines.values).toEqual(['CO₂-Preis je Tonne (Plausibilität): 64,20 €/t, von Ihnen eingetragen (Quelle: UBA), gilt ab 01.01.2027 bis 31.12.2027'])
})
```

`client/src/co2Sheet.test.ts`:

```ts
import { expect, test } from 'vitest'
import { sheetFacts, sheetHead, sheetRows } from './co2Sheet'
import type { Co2Sheet } from './types'

const sheet: Co2Sheet = {
  propertyName: 'Haus am Park', address: 'Parkweg 1', landlordName: 'Erika Muster', plantName: 'Kessel', energy: 'oil', contracting: false, fuelEnergy: null,
  period: { key: '2025-01', from: '2025-01-01', to: '2025-12-31' }, areaM2: 300, areaSource: 'served', nonResidential: false, restriction: 'none', districtEtsNew: false,
  stock: null,
  deliveries: [{ id: 'd', label: 'Heizöl', invoiceDate: '2025-03-15', from: null, to: null, deliveredAt: '2025-03-15', quantity: 3000, quantityUnit: 'l', energyKwh: null, gasBasis: null, emissionFactor: 0.2664, emissionsKg: 8028.9, co2CostCents: 52549, amountCents: 315000, estimated: false, findings: [] }],
  totals: { emissionsKg: 8028.9, co2CostCents: 52549 },
}

test('Kopf, Zeilen und Angaben zur Einstufung', () => {
  expect(sheetHead(sheet)).toEqual({ title: 'CO₂-Angaben für den Messdienst', lines: ['Haus am Park, Parkweg 1', 'Vermieter: Erika Muster', 'Heizanlage: Kessel (Öl)', 'Heizperiode: 01.01.2025 bis 31.12.2025'] })
  expect(sheetRows(sheet)).toEqual([
    { label: 'Heizöl', cells: ['15.03.2025', 'geliefert 15.03.2025', '3.000 l', '–', '0,2664 kg/kWh', '8.028,9 kg', '525,49 €', '3.150,00 €'] },
    { label: 'Summe', cells: ['', '', '', '', '', '8.028,9 kg', '525,49 €', ''] },
  ])
  expect(sheetFacts(sheet)).toEqual([
    'Fläche für die Einstufung: 300 m² (Wohnfläche der versorgten Wohnungen)',
    'Kein Nichtwohngebäude (§ 8 CO2KostAufG); keine Einschränkung nach § 9 CO2KostAufG',
    'Angaben je Rechnung nach § 3 Abs. 1 Nr. 1 bis 4 CO2KostAufG, wie sie der Lieferant ausweist',
  ])
})
```

`client/src/components/LawOverridesCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import LawOverridesCard from './LawOverridesCard'

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn(async () => [{ paramId: 'co2.price', title: 'CO₂-Preis je Tonne (Plausibilität)', norm: '§ 4', reason: 'r', year: 2027, validFrom: '2027-01-01', official: null, override: null, status: 'open' }]) }))

test('Die Karte zeigt jeden offenen Wert mit Eingabe und Quelle', async () => {
  render(<LawOverridesCard />)
  expect(await screen.findByText('2027: noch nicht veröffentlicht')).toBeTruthy()
  expect(screen.getByLabelText(/Quelle/)).toBeTruthy()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- lawOverrideForm notices co2Sheet LawOverridesCard`
Expected: FAIL.

- [ ] **Step 3: Logik der Einträge (`client/src/lawOverrideForm.ts`)**

```ts
// Rechtswerte, die eine Behörde später veröffentlicht (Heizung PR 17, Entwurf 4.5), in den Einstellungen.
import { fmtDate } from './api'
import { parseDecimal } from './co2Form'
import type { LawOverrideSlot } from './types'

const dec = (v: number): string => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function statusText(s: LawOverrideSlot): string {
  if (s.status === 'superseded') return `${s.year}: amtlich ${dec(s.official ?? 0)}; Ihr Eintrag ${dec(s.override?.value ?? 0)} ist überholt`
  if (s.status === 'entered' && s.override) return `${s.year}: ${dec(s.override.value)} von Ihnen eingetragen am ${fmtDate(s.override.enteredAt)} (Quelle: ${s.override.source})`
  return `${s.year}: noch nicht veröffentlicht`
}

export type OverrideDraft = { value: string; source: string }
export const draftOf = (s: LawOverrideSlot): OverrideDraft =>
  s.override ? { value: dec(s.override.value), source: s.override.source } : { value: '', source: '' }

export function overrideBody(d: OverrideDraft): { body: { value: number; source: string } } | { error: string } {
  const value = parseDecimal(d.value)
  if (value === null || !(value > 0)) return { error: 'Bitte geben Sie den Wert als Zahl an, etwa 64,20.' }
  if (d.source.trim() === '') return { error: 'Bitte nennen Sie die Quelle, etwa „UBA, Bekanntmachung vom …“.' }
  return { body: { value, source: d.source.trim() } }
}
```

(`parseDecimal` liefert nach PR 6 `null` für leere oder unlesbare Eingaben; liefert es dort `NaN`, die
Bedingung um `Number.isNaN(value)` ergänzen.)

- [ ] **Step 4: Karte (`client/src/components/LawOverridesCard.tsx`) und Einstellungen**

```tsx
// Karte „Rechtswerte, die noch nicht veröffentlicht sind“ (Heizung PR 17, Entwurf 4.5).
import { useEffect, useState } from 'react'
import { api, errorText } from '../api'
import { draftOf, overrideBody, statusText, type OverrideDraft } from '../lawOverrideForm'
import { useToast } from './feedback'
import type { LawOverrideSlot } from '../types'

export default function LawOverridesCard() {
  const [slots, setSlots] = useState<LawOverrideSlot[]>([])
  const [drafts, setDrafts] = useState<Record<string, OverrideDraft>>({})
  const toast = useToast()
  const keyOf = (s: LawOverrideSlot) => `${s.paramId}|${s.year}`
  async function load() {
    const list = await api<LawOverrideSlot[]>('/api/law-overrides')
    setSlots(list)
    setDrafts(Object.fromEntries(list.map((s) => [keyOf(s), draftOf(s)])))
  }
  useEffect(() => { load().catch((e) => toast(errorText(e))) }, [])
  async function save(s: LawOverrideSlot) {
    const r = overrideBody(drafts[keyOf(s)] ?? { value: '', source: '' })
    if ('error' in r) return toast(r.error)
    try {
      await api(`/api/law-overrides/${s.paramId}/${s.year}`, { method: 'PUT', body: JSON.stringify(r.body) })
      await load()
    } catch (e) { toast(errorText(e)) }
  }
  async function remove(s: LawOverrideSlot) {
    try {
      await api(`/api/law-overrides/${s.paramId}/${s.year}`, { method: 'DELETE' })
      await load()
    } catch (e) { toast(errorText(e)) }
  }
  if (slots.length === 0) return null
  return (
    <section className="card">
      <h3>Rechtswerte, die noch nicht veröffentlicht sind</h3>
      <p>Einige Werte veröffentlicht eine Behörde erst kurz vor oder nach Jahresbeginn. Mietfuchs braucht sie nur, um die CO₂-Angaben Ihrer Rechnungen zu prüfen; keine Zahl Ihrer Abrechnung hängt daran. Bringt ein Update den amtlichen Wert, gilt dieser.</p>
      {slots.map((s) => {
        const k = keyOf(s)
        const d = drafts[k] ?? { value: '', source: '' }
        return (
          <fieldset key={k}>
            <legend>{s.title} ({s.norm})</legend>
            <p>{statusText(s)}</p>
            {s.status !== 'superseded' && (
              <>
                <label>Wert <input inputMode="decimal" value={d.value} onChange={(e) => setDrafts({ ...drafts, [k]: { ...d, value: e.target.value } })} /></label>
                <label>Quelle <input value={d.source} onChange={(e) => setDrafts({ ...drafts, [k]: { ...d, source: e.target.value } })} /></label>
                <button type="button" onClick={() => save(s)}>Speichern</button>
              </>
            )}
            {s.override && <button type="button" onClick={() => remove(s)}>Eintrag entfernen</button>}
          </fieldset>
        )
      })}
    </section>
  )
}
```

In `client/src/pages/Einstellungen.tsx` die Karte unter den übrigen Karten einfügen:
`<LawOverridesCard />` (Import aus `'../components/LawOverridesCard'`).

- [ ] **Step 5: Rechtsstand (`client/src/notices.ts`)**

In `legalBasisLines` die Zeile der Werte ersetzen:

```ts
    values: (legalBasis.values ?? []).map((v) => {
      const range = [v.validFrom && `ab ${fmtDate(v.validFrom)}`, v.validTo && `bis ${fmtDate(v.validTo)}`].filter(Boolean).join(' ')
      const origin = v.overridden ? `von Ihnen eingetragen (Quelle: ${v.overridden.source})` : `(${v.cite})`
      return `${v.title}: ${v.text}${v.overridden ? ', ' : ' '}${origin}${range ? `, gilt ${range}` : ''}`
    }),
```

(Ohne Eintrag bleibt die Zeile wortgleich: „Titel: Text (Fundstelle), gilt …“.)

- [ ] **Step 6: Ausdruck (`client/src/co2Sheet.ts`, `client/src/components/Co2SheetView.tsx`)**

`client/src/co2Sheet.ts`:

```ts
// Das Blatt „CO₂-Angaben für den Messdienst“ (Heizung PR 17, #210), DOM-frei.
import { fmtDate, fmtEuro } from './api'
import { energyLabelOf } from './heatingForm'
import { co2DistrictEtsNew } from '../../shared/law/co2kostaufg.ts'
import { germanDate, LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import type { Co2Sheet } from './types'

export type SheetRow = { label: string; cells: string[] }
const num = (n: number, digits: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: digits })
const UNIT_TEXT: Record<string, string> = { l: 'l', kg: 'kg', m3: 'm³', kWh: 'kWh', srm: 'SRm' }

export function sheetHead(s: Co2Sheet): { title: string; lines: string[] } {
  return {
    title: 'CO₂-Angaben für den Messdienst',
    lines: [
      [s.propertyName, s.address].filter(Boolean).join(', '),
      `Vermieter: ${s.landlordName}`,
      `Heizanlage: ${s.plantName ? `${s.plantName} ` : ''}(${energyLabelOf({ energy: s.energy, contracting: s.contracting, fuelEnergy: s.fuelEnergy ?? undefined })})`,
      `Heizperiode: ${fmtDate(s.period.from)} bis ${fmtDate(s.period.to)}`,
    ],
  }
}

export function sheetRows(s: Co2Sheet): SheetRow[] {
  const rows = s.deliveries.map((d) => ({
    label: d.estimated ? `${d.label} (geschätzt)` : d.label,
    cells: [
      d.invoiceDate ? fmtDate(d.invoiceDate) : '–',
      d.from && d.to ? `${fmtDate(d.from)} bis ${fmtDate(d.to)}` : d.deliveredAt ? `geliefert ${fmtDate(d.deliveredAt)}` : '–',
      d.quantity !== null && d.quantityUnit ? `${num(d.quantity, 2)} ${UNIT_TEXT[d.quantityUnit] ?? d.quantityUnit}` : '–',
      d.energyKwh !== null ? `${num(d.energyKwh, 0)} kWh${d.gasBasis === 'hs' ? ' (Brennwert)' : d.gasBasis === 'hi' ? ' (Heizwert)' : ''}` : '–',
      d.emissionFactor !== null ? `${num(d.emissionFactor, 4)} kg/kWh` : '–',
      d.emissionsKg !== null ? `${num(d.emissionsKg, 2)} kg` : '–',
      d.co2CostCents !== null ? fmtEuro(d.co2CostCents) : '–',
      d.amountCents !== null ? fmtEuro(d.amountCents) : '',
    ],
  }))
  return [...rows, { label: 'Summe', cells: ['', '', '', '', '', `${num(s.totals.emissionsKg, 2)} kg`, fmtEuro(s.totals.co2CostCents), ''] }]
}

export function sheetFacts(s: Co2Sheet): string[] {
  const area = s.areaM2 === null ? 'Fläche für die Einstufung: nicht bekannt' : `Fläche für die Einstufung: ${num(s.areaM2, 2)} m² (${s.areaSource === 'entered' ? 'von Ihnen eingetragen' : 'Wohnfläche der versorgten Wohnungen'})`
  const restriction = s.restriction === 'none' ? 'keine Einschränkung nach § 9 CO2KostAufG'
    : s.restriction === 'both' ? 'Einschränkung nach § 9 CO2KostAufG bei Gebäude und Versorgung' : `Einschränkung nach § 9 CO2KostAufG (${s.restriction === 'building' ? 'Gebäude' : 'Versorgung'})`
  const facts = [area, `${s.nonResidential ? 'Nichtwohngebäude (§ 8 CO2KostAufG)' : 'Kein Nichtwohngebäude (§ 8 CO2KostAufG)'}; ${restriction}`]
  // Der Stichtag kommt aus dem Register (PR 7, `co2.district-ets-new`), nicht als Literal.
  if (s.districtEtsNew) facts.push(`Wärme aus Anlagen des Emissionshandels, erster Anschluss nach dem ${germanDate(valueAt(co2DistrictEtsNew, LAW_AS_OF).connectedAfter)} (§ 2 Abs. 4 Satz 2 CO2KostAufG)`)
  if (s.stock) facts.push(`Vorrat: Anfangsbestand ${num(s.stock.openingQuantity ?? 0, 2)} ${UNIT_TEXT[s.stock.stockUnit ?? ''] ?? ''} mit ${num(s.stock.openingEmissionsKg ?? 0, 2)} kg CO₂${s.stock.openingInvoicedBefore2023 ? ' (Rechnung vor 2023, ohne CO₂-Kosten)' : ''}; Endbestand ${num(s.stock.closingQuantity ?? 0, 2)}${s.stock.closingMeasuredOn ? ` am ${fmtDate(s.stock.closingMeasuredOn)}` : ''}`)
  facts.push('Angaben je Rechnung nach § 3 Abs. 1 Nr. 1 bis 4 CO2KostAufG, wie sie der Lieferant ausweist')
  return facts
}
```

`client/src/components/Co2SheetView.tsx`:

```tsx
// Druckansicht „CO₂-Angaben für den Messdienst“ (Heizung PR 17, #210).
import { useEffect, useState } from 'react'
import { api, errorText } from '../api'
import { sheetFacts, sheetHead, sheetRows } from '../co2Sheet'
import type { Co2Sheet } from '../types'

const COLUMNS = ['Rechnung vom', 'Zeitraum', 'Menge', 'Energiegehalt', 'Emissionsfaktor', 'CO₂', 'CO₂-Kosten', 'Betrag']

export default function Co2SheetView({ plantId, period, onClose }: { plantId: string; period: string; onClose: () => void }) {
  const [sheet, setSheet] = useState<Co2Sheet | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api<Co2Sheet>(`/api/heating-plants/${plantId}/periods/${period}/co2-sheet`).then(setSheet).catch((e) => setError(errorText(e)))
  }, [plantId, period])
  if (error) return <p className="error">{error}</p>
  if (!sheet) return <p>Wird geladen …</p>
  const head = sheetHead(sheet)
  return (
    <article className="co2-sheet">
      <div className="no-print">
        <button type="button" onClick={() => window.print()}>Drucken</button>
        <button type="button" onClick={onClose}>Zurück</button>
      </div>
      <h2>{head.title}</h2>
      {head.lines.map((l) => <p key={l}>{l}</p>)}
      <table>
        <thead><tr><th>Lieferung</th>{COLUMNS.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{sheetRows(sheet).map((r) => <tr key={r.label}><td>{r.label}</td>{r.cells.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
      </table>
      <ul>{sheetFacts(sheet).map((f) => <li key={f}>{f}</li>)}</ul>
      {sheet.deliveries.some((d) => d.findings.length > 0) && (
        <section>
          <h3>Bitte prüfen</h3>
          <ul>{sheet.deliveries.flatMap((d) => d.findings).map((f) => <li key={f}>{f}</li>)}</ul>
        </section>
      )}
    </article>
  )
}
```

`client/src/pages/Heizkosten.tsx`: Zustand `const [sheetFor, setSheetFor] = useState<{ plantId: string;
period: string } | null>(null)`; ist er gesetzt, rendert die Seite nur
`<Co2SheetView plantId={sheetFor.plantId} period={sheetFor.period} onClose={() => setSheetFor(null)} />`.
Je Anlage und Heizperiode in der Karte „CO₂-Kosten“ bzw. unter der Karte „Brennstoff“ einen Knopf:

```tsx
          <button type="button" onClick={() => setSheetFor({ plantId: plant.id, period: String(view.period) })}>Ausdruck „CO₂-Angaben für den Messdienst“</button>
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix client test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src
git commit -m "Oberfläche: Rechtswerte eintragen, Eintrag im Rechtsstand, Ausdruck für den Messdienst

Refs #97, #210"
```

---

### Task 8: Lexikon, Checkliste der Durchsicht, CHANGELOG, CLAUDE.md, Gesamtprüfung

**Files:**
- Modify: `shared/glossary.ts`, `docs/superpowers/specs/2026-10-02-rechtsdurchsicht-2026.md`, `CHANGELOG.md`, `CLAUDE.md`
- Test: `server/test/glossary.test.ts`

- [ ] **Step 1: Lexikon**

`server/test/glossary.test.ts` anhängen:

```ts
test('Lexikon: Rechtsstand erklärt eingetragene Werte (Heizung PR 17)', () => {
  assert.match(GLOSSARY.legalBasis.needed, /selbst eintragen/)
  assert.match(GLOSSARY.legalBasis.needed, /amtliche Wert/)
})
```

In `shared/glossary.ts` bei `legalBasis` den Satz `needed` ersetzen:

```ts
    needed: 'Sie müssen nichts tun. Er zeigt, nach welchen Regeln eine Abrechnung erstellt wurde. Werte, die eine Behörde erst später veröffentlicht, etwa den CO₂-Preis des neuen Jahres, können Sie in den Einstellungen mit Quelle selbst eintragen; Mietfuchs braucht sie nur für die Prüfung Ihrer Rechnungen. Bringt ein Update den amtlichen Wert, gilt dieser.',
```

- [ ] **Step 2: Checkliste der Durchsicht (Entwurf 4.8 Nr. 2)**

In `docs/superpowers/specs/2026-10-02-rechtsdurchsicht-2026.md` unter den Punkten der jährlichen
Durchsicht ergänzen (prüft `rechtsdurchsicht-2026.test.ts` die Liste wörtlich, dort ebenso):

```markdown
- **Veröffentlichte Werte eintragen** (Heizung PR 17): CO₂-Preis des Folgejahres nach der Veröffentlichung
  des UBA (§ 4 Abs. 2 CO2KostAufG, spätestens zehn Werktage vor Jahresbeginn) und den Durchschnittspreis
  des Emissionshandels des Vorjahres (§ 4 Abs. 3, bis 31.03.) als neue Fassung an die Stelle von `null`
  setzen, `law-history.test.ts` ergänzen, `LAW_AS_OF` setzen. Die EBeV 2030 gilt bis 2030; vor 2031 die
  Nachfolgeverordnung lesen.
```

- [ ] **Step 3: CHANGELOG („Hinzugefügt“)**

```markdown
- **CO₂-Angaben geprüft** ([#97](https://github.com/speedone/mietfuchs/issues/97)): Die Abrechnung prüft
  kg und CO₂-Kosten jeder erfassten Rechnung gegen die Standardwerte der EBeV 2030, den CO₂-Preis des
  Lieferjahres (2023 bis 2026), bei Fernwärme den Durchschnittspreis des Emissionshandels, und die
  Umsatzsteuer, einschließlich des ermäßigten Satzes für Gas und Wärme vom 01.10.2022 bis 31.03.2024.
  Abweichungen nennt sie als Hinweis; keine Zahl ändert sich. Den CO₂-Preis 2027 und spätere Werte, die
  noch nicht im Programm stehen, können Sie in den Einstellungen mit Quelle eintragen.
- **Ausdruck „CO₂-Angaben für den Messdienst“** ([#210](https://github.com/speedone/mietfuchs/issues/210)):
  Auf der Seite Heizkosten stellt Mietfuchs je Heizperiode die Angaben der Rechnungen (kg CO₂, CO₂-Kosten,
  Emissionsfaktor, Energiegehalt, Menge), Fläche und Angaben zu §§ 8, 9 CO2KostAufG zum Weitergeben
  zusammen.
```

- [ ] **Step 4: CLAUDE.md**

Im Absatz „Hinweise und Regelverzeichnis“ hinter dem Satz zu `RULES_AS_OF`/`LAW_AS_OF` ergänzen:

```markdown
**Werte, die erst später veröffentlicht werden** (Heizung PR 17, Entwurf 4.5): `co2.price` (ab 2027) und
`co2.price-ets` (ab Rechnungsjahr 2027) haben `null` und sind `overridable`. Sie fragt nur
`lawOverridable`, das einen Eintrag des Vermieters aus `law_overrides` (je Kalenderjahr, mit Quelle) liest
und als `overridden` protokolliert; `law()` lehnt überschreibbare Parameter ab. Ein Release mit dem
amtlichen Wert setzt ihn an die Stelle von `null` (die einzige zweite Ausnahme in `law-history.test.ts`),
und der Eintrag heißt „überholt“. Gebraucht werden diese Werte, die EBeV-Werte und
`ustg.gas-heat-network-rate` nur für `co2.cost-implausible` (server/src/co2Plausibility.ts): Spannen über
Preisjahre, Emissionshandel und Steuersätze, Grenzen 1 €/3 % und 1 kg/1 % (Festlegung nach 15.2 F6).
Das Blatt „CO₂-Angaben für den Messdienst“ baut `server/src/co2Sheet.ts` (#210).
```

- [ ] **Step 5: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: Exit-Status 0.

Run: `npm --prefix server test -- test/law-release.test.ts` mit `MIETFUCHS_RELEASE=1`:

```bash
MIETFUCHS_RELEASE=1 npm --prefix server test -- test/law-release.test.ts
```

Expected: PASS: Kein Parameter dieses Plans ist `unchecked`.

Run (Smoke-Test gegen eine laufende Instanz mit Wegwerf-Ordner, `CI=1` und geschlossenem Update-Port):

```bash
D=$(mktemp -d); NKA_DATA_DIR=$D CI=1 NKA_UPDATE_URL=http://127.0.0.1:9 NKA_PORT=3001 npm start & sleep 5; node scripts/smoke-test.mjs --url http://127.0.0.1:3001 --mode npm; kill %1; rm -rf $D
```

Expected: Das Skript endet mit Exit-Status 0.

- [ ] **Step 6: Commit**

```bash
git add shared/glossary.ts server/test/glossary.test.ts docs/superpowers/specs/2026-10-02-rechtsdurchsicht-2026.md CHANGELOG.md CLAUDE.md
git commit -m "Doku: Plausibilität der CO₂-Angaben, eingetragene Rechtswerte, Ausdruck für den Messdienst

Refs #97, #210"
```

---

## Selbstprüfung

**1. Abdeckung des Entwurfs.**

| Anforderung | Task |
|---|---|
| `co2.price` 30/45/55/60, 2027 `null`, `deliveryYear`, überschreibbar (4.3) | 1, 2 |
| `co2.price-ets` 80,40/83,68/65,01/73,86, Rechnungsdatum − 1 Jahr (4.3, 3.13) | 2 (Abweichung 4) |
| `co2.ebev-factors` Erdgas, Heizöl EL, Flüssiggas (4.3) | 2 |
| `law_overrides` mit Quelle, `law.value-overridden`, amtlicher Wert geht vor, überholt (4.5, 5.9, 10.1) | 1, 3, 7 |
| Protokoll mit `overridden` (4.2), `deviation` zeigt Unterschied (4.4) | 1 (Kennung je Jahr), bestehendes `settlementDiff` |
| Nur, was im BGBl. steht (4.6) | 2 (2027 `null`) |
| `co2.cost-implausible` hint (10.1, 15.2 F6) | 4, 5 |
| Ausdruck „CO₂-Angaben für den Messdienst“ (7.6, 14.1, #210) | 6, 7 |
| Keine Rechnung aus kWh, nur Plausibilität (16) | Global Constraints, 4 |
| Checkliste der Durchsicht (4.8 Nr. 2) | 8 |
| Golden unverändert bis auf begründete Hinweise | 5 Step 6 |

**2. Platzhalter.** Keine „TBD“. Wo Namen von PR 6–8 in Routen und Bestand eingehen, nennt Task 6 Step 5 die
erwarteten Felder; wo PR 7 den Stichtag des Emissionshandels führt (`co2DistrictEtsNew.value.connectedAfter`),
liest Task 7 ihn von dort.

**3. Typen.** `LawOverride`, `LawOverrideSlot`, `LawOverrideStatus` (Task 1) werden in Task 3 und 7 mit
denselben Feldern benutzt; `PlausibilityFinding` (mit `emissionsKg` an beiden Arten) in Task 4–6;
`Co2Sheet`, `Co2SheetDelivery`, `Co2SheetStock` (Task 6) im Client (Task 7).

**4. Review Focus.** 1 → Task 4 „Review Focus 1“; 2 → Task 4 „Review Focus 2“; 3 → Task 4 „Review Focus 3“;
4 → Task 1 (Register), Task 3 (Routen, Speichern), Task 4 und Task 5 (`settleWithDelivery2027`); 5 → Task 4
„Review Focus 5“.
