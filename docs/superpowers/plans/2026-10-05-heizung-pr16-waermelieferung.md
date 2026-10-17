# Heizung PR 16: Wärmelieferung und Contracting (#213) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Heizanlage kann als Wärmelieferung eines Dritten (Contracting) gekennzeichnet werden;
Mietfuchs rechnet sie dann wie Fernwärme (kein Pflichtanteil von 70 % nach § 7 Abs. 3 HeizkostenV,
Faktor ÷ 1,15 für Formelwerte nach § 9 Abs. 2 Satz 6 Nr. 2, CO₂ aus der Rechnung des Lieferanten nach
§ 2 Abs. 1 Satz 2, § 3 Abs. 4 CO2KostAufG) und nennt bei einer Umstellung während laufender
Mietverhältnisse die Voraussetzungen des § 556c BGB und der WärmeLV, bei vorheriger Eigenversorgung der
Mieter die Rechtslage nach BGH VIII ZR 46/25 und 47/25 (`heating.contracting`, hint).

**Architecture:** Vier Spalten an `heating_plants` in zwei erzeugten Migrationen. Eine einzige Naht für
die Rechnung: `billingEnergy(plant)` in `shared/heatDelivery.ts` liefert bei Contracting
`'districtHeating'`, und `snapshotFor` gibt der Berechnung die Anlage mit dieser Energie (dazu
`fuelEnergy`, `contracting`). Damit greifen die Regeln, die PR 6–11 für Fernwärme schon haben, ohne dass
calc.ts, co2.ts, fuel.ts oder dhw.ts eine Zeile mehr kennen. Die Schreibwege (Einrichtung der eigenen
Abrechnung, Vorrat, Warmwasser) fragen dieselbe Funktion; ein Wächter verbietet dort die rohe Energie.
Der Hinweis entsteht in `server/src/heatDelivery.ts` (reine Funktion) und wird in `computeSettlement`
gemeldet.

**Tech Stack:** Node 24 (TypeScript ohne Build), Express 5, Drizzle ORM 0.45 über `sqlite-proxy`,
drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich 0.5
(R-A2: Wärmelieferung in § 7 Abs. 3), 2 (§ 556c BGB „geprüft 05.10.“; VIII ZR 46/25, 47/25 „geprüft
05.10.“), 4.3 (`hkv.consumption-share-forced`: „nicht bei Wärmelieferung, § 7 Abs. 3“; `hkv.dhw.factors`:
„Wärmelieferung ÷ 1,15“), 5.3 (`energy`: Wärmelieferung „hinsichtlich der für die Wärmeerzeugung
eingesetzten Brennstoffe“), 8.5 (§ 7 Abs. 3), 10.1 (`heating.contracting`, hint, PR 16), 12.2
(`heating.test.ts`: „nicht bei Wärmelieferung (§ 7 Abs. 3)“), 13 PR 16, 14.1 („Contracting,
Wärmelieferung: Hinweise § 556c, WärmeLV“), 14.2 (#213).

**Baut auf:** PR 1 bis PR 15. Gearbeitet wird auf `feat/heizung-pr16-waermelieferung`, abgezweigt von
der Spitze von PR 15, gestapelt gestellt und nach dem Merge von PR 15 auf `main` umgestellt.

## Änderungen nach Prüfung vom 05.10.2026

Die rechtliche Prüfung der Pläne PR 15 bis 22 vom 05.10.2026 hat diesen Plan an diesen Stellen geändert:

1. **Keine Beschränkung auf Brennstoffe der EBeV** (Abweichung 2, Review Focus 3, Task 2 Step 1, 3, 5
   und 7, Task 5 Step 1 und 3, Task 6). Die Folgen der Wärmelieferung nach der HeizkostenV (§ 7 Abs. 3,
   § 9 Abs. 1 Satz 2, § 9 Abs. 2 Satz 6 Nr. 2) hängen nicht am Brennstoff; Pellet-Contracting mit
   ÷ 1,15 ist richtig. `CONTRACTING_ENERGIES` umfasst jetzt alle Energieträger außer Fernwärme (ohnehin
   Wärmelieferung) und Wärmepumpe (Satz 6 Nr. 2 oder Nr. 3 offen, als Auslegung abgelehnt); die
   Bedingung `heating_plants_contracting_energy` und die Sätze der Ablehnung folgen.
2. **CO₂-Pflicht nach dem Brennstoff des Lieferanten** (neue Abweichung 9, Task 3 Step 5a): Weil
   Pellet-, Holz- und Strom-Contracting jetzt möglich sind und als Fernwärme rechnen, fragt die Prüfung
   „CO₂-Angaben nötig“ `co2Required(pot)`; sonst meldete PR 6 dort `co2.missing` mit einer Kürzung, die
   das Gesetz nicht vorsieht (§ 2 Abs. 1 Satz 2 CO2KostAufG).
3. **VIII ZR 46/25 und 47/25 nach dem Volltext** (Global Constraints, Abweichung 7, Task 4 Step 1, 3 und
   6, Lexikon, CHANGELOG, CLAUDE.md). Der Hinweis sagt jetzt: „jedenfalls“ die Kosten nach § 7 Abs. 2,
   § 8 Abs. 2 HeizkostenV (Rn. 27, 46); ob die vollen Kosten nach § 7 Abs. 4, § 8 Abs. 4 samt
   kalkulatorischer Kosten, hat der BGH offengelassen (Rn. 47). Die Quelle ist primär; Task 4 Step 6 ist
   kein Leseschritt mehr.
4. **Mietvertrag statt Einzug** (Abweichung 4, Task 4 Step 3): § 556c setzt einen bei der Umstellung
   laufenden Mietvertrag voraus (VIII ZR 46/25 Rn. 30). Mietfuchs kennt nur den Mietbeginn; der Text
   sagt, dass der Vertragsschluss maßgeblich ist.

## Global Constraints

- **Wer nichts einstellt, merkt nichts** (1.2 Nr. 1): Ohne `contracting` und ohne Tag der Umstellung ist
  jede Zahl, jeder Hinweis und `legalBasis.values` gleich dem Stand nach PR 15. Golden F01–F18 bleiben
  wortgleich.
- **Fernwärme bleibt, wie sie ist:** Eine Anlage mit `energy = 'districtHeating'` rechnet genau wie nach
  PR 15; neu ist für sie nur der Hinweis bei eingetragener Umstellung (§ 556c Abs. 1 Nr. 1 nennt das
  Wärmenetz ausdrücklich).
- **Rechtswerte nur aus dem Register:** „drei Monate“ (§ 556c Abs. 2 BGB, § 11 Abs. 1 WärmeLV) und „80
  Prozent“ (§ 556c Abs. 1 Satz 2 BGB) kommen aus `bgb.heat-delivery-switch`; 70 % aus
  `hkv.consumption-share-forced` (PR 10), 1,15 und 1,11 aus `hkv.dhw.factors` (PR 11). Keine Zahl dieser
  Normen als Literal im Muster von `law-literals.test.ts`.
- **Stufe hängt am Code:** `heating.contracting` ist `hint` (10.1), auch wenn der Text eine Kürzung der
  Umlage beschreibt: Mietfuchs kennt Kostenvergleich und Effizienz nicht und kann nichts beziffern.
- **Migrationen:** zwei erzeugte Schritte `waermelieferung` (Spalten) und `waermelieferung_bedingungen`
  (Bedingungen, Neubau von `heating_plants`), hinter PR 15; drizzle-kit vergibt die Nummer (nach der
  Plänen von PR 13 bis 15: `0037`/`0038`). Keine Datenanweisung.
- **Eingefrorener Eingang** und `legacy/validate.ts` bleiben unverändert.
- **Rechtsaussagen, am 05.10.2026 gelesen:** § 556c BGB (gesetze-im-internet.de, unverändert durch Art. 6
  G v. 23.07.2026, BGBl. 2026 I Nr. 226, das nur §§ 555b, 559e, 559f ändert; am Regelungstext des BGBl.
  geprüft); WärmeLV §§ 1–13 (Vollzitat „Wärmelieferverordnung vom 7. Juni 2013 (BGBl. I S. 1509)“,
  Textnachweis ab 01.07.2013, § 13: Inkrafttreten 1. Juli 2013); HeizkostenV § 1 Abs. 1 Nr. 2, § 7 Abs. 2
  bis 4, § 8 Abs. 3 und 4; BetrKV § 2 Nr. 4 Buchst. c; CO2KostAufG § 2 Abs. 1 Satz 2, § 3 Abs. 1 und 4.
  **Primär, Volltext am 05.10.2026 gelesen** (bundesgerichtshof.de, PDF; ECLI:DE:BGH:2026:200526UVIIIZR46.25.0):
  BGH, Urteile vom 20.05.2026, VIII ZR 46/25 und 47/25. Rn. 27: Der Vermieter kann „[j]edenfalls aber …
  Zahlung des Anteils der Kosten der zentralen Wärmeversorgung durch die Wärmelieferantin verlangen, der
  auch bei einer zentralen Wärmeversorgung durch die Klägerin gemäß § 7 Abs. 2 … HeizkostenV … aF, § 8
  Abs. 2 HeizkostenV angefallen wäre“; Rn. 28: § 556c Abs. 1 Satz 1 BGB ist auf die Umstellung von der
  Selbstversorgung der Mieter „weder unmittelbar noch entsprechend anwendbar“; Rn. 30: die unmittelbare
  Anwendung setzt einen „zum Zeitpunkt der beabsichtigten Umstellung bereits laufenden Mietvertrag“
  voraus; Rn. 44–46: stillschweigende Einigung durch Ankündigung und Zahlung der Vorauszahlungen;
  Rn. 47: ob die Vereinbarung „die gesamten Kosten nach § 7 Abs. 4, § 8 Abs. 4 HeizkostenV einschließlich
  der kalkulatorischen Kosten“ umfasst, ist vom Berufungsgericht festzustellen. Die Fassungen bei
  otto-schmidt.de und in der Pressemitteilung („nur … der Anteil“) sind danach ungenau. Inkrafttreten des § 556c Abs. 1, 2
  am 01.07.2013 über buzer.de (sekundär); der Parameter stützt das Datum auf § 13 WärmeLV (primär).
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen deutsch; Nutzertexte siezen
  (`anrede.test.ts`). Server-Importe mit `.ts`, reine Typimporte mit `import type`, kein `enum`.
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port).
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0. Commit-Nachrichten
  deutsch, mit `Refs #213` und den Attribution-Zeilen der ausführenden Sitzung.

## Review Focus

1. **Ein Gaskessel im Keller, den ein Contractor betreibt, in einem ungedämmten Altbau mit gedämmten
   Leitungen** (`insulationRule = 'applies'`). Erwartet: Der Anteil nach Verbrauch ist frei zwischen 50
   und 70 %, nicht zwingend 70 % (§ 7 Abs. 3 verweist nicht auf Abs. 1 Satz 2), in der Berechnung, in der
   Schreibprüfung der Einrichtung und im Formular. Tests in Task 3.
2. **Ein Contracting-Kessel mit Öl, und der Vermieter will einen Vorrat eintragen.** Den Vorrat führt der
   Lieferant, nicht der Vermieter; der Vermieter bezahlt Wärme in kWh. Erwartet: Die Anlage gilt nicht als
   Vorratsenergie; Lieferungen sind Wärmerechnungen. Test in Task 3.
3. **Contracting wird bei einer Pelletheizung, einer Wärmepumpe oder einer Etagenheizung gewählt.**
   Erwartet: Bei Pellets wird Contracting angenommen und rechnet als Wärmelieferung (÷ 1,15 nach § 9 Abs. 2
   Satz 6 Nr. 2, kein Pflichtanteil nach § 7 Abs. 3), aber ohne CO₂-Pflicht und ohne `co2.missing`, denn
   der eingesetzte Brennstoff hat keine CO₂-Kosten (Abweichung 9). Bei Wärmepumpe und Etagenheizung 400
   mit einem Satz statt einer Anlage, die still falsch rechnet. Tests in Task 2 und Task 3.
4. **Ein Mieter zog am Tag der Umstellung ein** (Mietbeginn = Umstellung). Er wohnte nicht schon vorher;
   § 556c betrifft ihn nicht. Erwartet: kein Hinweis für ihn, wohl aber für den Mieter, der am Vortag
   schon wohnte. Test in Task 4.
5. **Die Umstellung liegt vor dem 01.07.2013.** § 556c und die WärmeLV galten noch nicht. Erwartet: ein
   eigener Text ohne die Voraussetzungen des § 556c, und kein Programmfehler, weil das Register für den
   Tag keine Fassung hat. Test in Task 4.

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/law/bgb-betrkv.ts`, `shared/law/params.ts`, `shared/glossary.ts` | Parameter `bgb.heat-delivery-switch`, Begriff `heatDelivery` | 1 |
| `shared/types.ts`, `server/src/db/schema.ts`, `server/drizzle/00xx_waermelieferung*.sql` (erzeugt), `server/src/db/read.ts`, `server/src/db/heating.ts` | Merkmale an der Anlage, Bedingungen, Prüfung | 2 |
| `shared/heatDelivery.ts` (neu), `server/src/snapshot.ts`, `server/src/db/heatingSelf.ts`, `server/src/db/heating.ts`, die Schreibwege des Vorrats (PR 8), `client/src/heatingSelfForm.ts` und ihre Aufrufer | Naht `billingEnergy`, Wächter | 3 |
| `server/src/heatDelivery.ts` (neu), `server/src/calc.ts` | Hinweis `heating.contracting`, Beschriftung im Ausweis | 4 |
| `client/src/heatingForm.ts`, `client/src/components/HeatingCard.tsx`, `client/src/co2View.ts`, `client/src/fuelView.ts` | Fragen der Einrichtung, Beschriftung | 5 |
| `CHANGELOG.md`, `CLAUDE.md` | Doku | 6 |
| Tests: `server/test/law.test.ts`, `law-history.test.ts`, `glossary.test.ts`, `db-waermelieferung.test.ts` (neu), `migrations.test.ts`, `heat-delivery-guard.test.ts` (neu), `heating.test.ts`, `calc-waermelieferung.test.ts` (neu), `client/src/heatingForm.test.ts`, `client/src/components/HeatingCard.test.tsx` | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

- PR 1: `law`, `valueAt`, `onlyVersion`, `germanDate`, `createLawLog`, `LAW_AS_OF`, `LawParam`,
  `Source`; `LAW_PARAMS`; `law.test.ts` mit dem Objekt `modules` im Test „jede Konstante vom Typ
  LawParam …“.
- PR 4 (`server/src/db/heating.ts`): `mergeHeatingPlant`, `emptyHeatingPlant`, `guardHeatingPlant(db,
  before, after)`, `plantRow`, `createHeatingPlant(db, id, propertyId, body): Promise<{ plant; assigned }>`,
  `updateHeatingPlant(db, id, body)`, `LATER`; `HeatingError`; Typen `HeatingPlant`, `HeatingEnergy`;
  `HEATING_ENERGIES`; Client `heatingForm.ts` mit `HeatingForm`, `HeatingPlantBody`, `ENERGY_OPTIONS`,
  `emptyHeatingForm`, `heatingToForm`, `heatingPlantBody`; `HeatingCard`.
- PR 5: `shared/heatingPeriod.ts` `servesUnit`; `snapshotFor`, `heatingSnapshotFor`; in `computeSettlement`
  `plants`, `scope`, Unteraufruf der Heizperiode bei Weg b (Hinweise werden übernommen).
- PR 6: `HeatingStatement` (`plantId`, `plantName`, `energy`, …), gebaut im CO₂-Block von
  `computeSettlement`; `co2View.ts` mit `co2Block(h, tenancyId)`; Hinweis `co2.missing` mit dem Text
  „Weist Ihr Wärmelieferant CO₂-Kosten aus, sind sie“ bei `pot.energy === 'districtHeating'`.
- PR 7: `SnapshotHeatingPlant` (Pick plus optionale Felder), `districtEtsNew` nur bei Fernwärme;
  `STOCK_ENERGIES`, `METERED_ENERGIES`; `fuelView.ts`.
- PR 8: `shared/fuelStock.ts` mit `STOCK_ENERGIES`, `isStockEnergy` (laut Plan PR 9, Zeile „shared/fuelStock.ts“).
- PR 10: `server/src/heating.ts` `consumptionSharesOf(rows, key, energy, forced)`, `OIL_OR_GAS`,
  `KWH_ENERGIES`; `server/src/db/heatingSelf.ts` `distributionOf(rows, energy, h, today)`, `checkShares`
  (Datei-intern); Client `heatingSelfForm.ts` `forcedShare(energy, insulation)`, `kwhEnergy(energy)`,
  `selfSetupBody(form, energy)`, `emptySelfSetup(plant, period)`; `HeatingSelfSetup`;
  `hkvConsumptionShareForced`.
- PR 11: `server/src/dhw.ts` `formulaFactor(energy, e, h, log)` mit dem Zweig
  `energy === 'districtHeating'` (÷ `heatSupplyDivisor`); `hkvDhwFactors` mit `gasCalorific`,
  `heatSupplyDivisor`. PR 11 vermerkt: „PR 16 muss sein Merkmal an dieselbe Stelle in `formulaFactor`
  anschließen“. Dieser Plan tut das über die Naht im Schnappschuss (Abweichung 3), `formulaFactor` bekommt
  die Energie der Abrechnung.

## Abweichungen vom Entwurf und Festlegungen dieses Plans

1. **Datenmodell (Festlegung).** Der Entwurf sagt nur „Merkmal an der Anlage“. Es sind vier Spalten:
   `contracting` (boolean, Vorgabe false), `heat_delivery_since` (Tag der Umstellung während laufender
   Mietverhältnisse), `previous_supply` (`landlord | tenant`: wer vorher versorgte) und
   `switch_announced_on` (Zugang der Umstellungsankündigung). Die drei letzten braucht der Hinweis: ohne
   den Tag weiß Mietfuchs nicht, wen § 556c betrifft (Review Focus 4), ohne die vorherige Versorgung nicht,
   ob VIII ZR 46/25 greift, ohne die Ankündigung nicht, ob § 11 Abs. 3 WärmeLV greift.
2. **Contracting bei jeder zentralen Anlage außer Wärmepumpe (Festlegung, Review Focus 3).** Die Folgen
   der Wärmelieferung nach der HeizkostenV hängen **nicht** am Brennstoff: § 7 Abs. 3 („gilt Absatz 1
   Satz 1 und 3 bis 5 entsprechend“, also ohne den Pflichtanteil des Satzes 2), § 9 Abs. 1 Satz 2
   (Aufteilung nach dem Wärmeverbrauch) und § 9 Abs. 2 Satz 6 Nr. 2 („bei eigenständiger gewerblicher
   Wärmelieferung durch 1,15 zu dividieren“) gelten für jede eigenständige gewerbliche Wärmelieferung nach
   § 1 Abs. 1 Nr. 2 („auch aus Anlagen nach Nummer 1“). Lehnte Mietfuchs etwa Pellet-Contracting ab,
   müsste der Vermieter es als eigene Anlage führen, und der Formelwert wäre um den Faktor 1,15 falsch.
   § 2 Abs. 1 Satz 2 CO2KostAufG („hinsichtlich der für die Wärmeerzeugung eingesetzten Brennstoffe“)
   begrenzt nur die **CO₂-Aufteilung**, nicht die Wärmelieferung; das regelt Abweichung 9 über den
   Brennstoff des Lieferanten. Zugelassen sind deshalb Gas, Öl, Flüssiggas, Kohle, Pellets, Holz, Strom
   und „Sonstiges“. Abgelehnt werden mit einem Satz: **Fernwärme** (sie ist ohne Merkmal Wärmelieferung),
   die **Wärmepumpe** (Auslegung: Ob bei einer vom Contractor betriebenen monovalenten Wärmepumpe § 9
   Abs. 2 Satz 6 Nr. 2, ÷ 1,15, oder Nr. 3, × 0,30, gilt, regelt die Verordnung nicht; Mietfuchs rechnet
   keine der beiden Zahlen, statt eine zu raten) und die **Etagenheizung** (`perUnit`). Die frühere
   Fassung dieser Abweichung („nur Gas, Öl, Flüssiggas und Kohle“) trug die Begründung nicht (Prüfung vom
   05.10.2026).
3. **Contracting rechnet wie Fernwärme (Festlegung über eine Naht).** Statt jede Regel aus PR 6–11 um ein
   Merkmal zu erweitern, bekommt die Berechnung die Anlage mit `energy = 'districtHeating'`
   (`asBilledPlant` in `snapshotFor`). Das ergibt nach dem Wortlaut: kein § 7 Abs. 1 Satz 2 (§ 7 Abs. 3),
   ÷ 1,15 statt × 1,11 für Formelwerte (§ 9 Abs. 2 Satz 6 Nr. 2: „bei eigenständiger gewerblicher
   Wärmelieferung“), kein Vorrat beim Vermieter, kWh laut Wärmerechnung als Energie des Erzeugers, CO₂ aus
   den Angaben des Lieferanten (§ 3 Abs. 4) und `co2.missing` mit dem Text zum Wärmelieferanten.
   Ausgenommen bleibt allein § 2 Abs. 4 Satz 2 CO2KostAufG (Emissionshandel): `districtEtsNew` prüft
   weiter die gespeicherte Energie, ein Kessel im Haus ist keine Anlage des Emissionshandels.
4. **Hinweis nur mit eingetragenem Tag der Umstellung und nur für Mietverhältnisse, die vorher begannen
   (Festlegung, Review Focus 4).** § 556c Abs. 1 setzt voraus, dass „der Mieter die Betriebskosten für
   Wärme … zu tragen“ hat und der Vermieter „umstellt“; das betrifft nur bestehende Mietverhältnisse. Wer
   danach einzieht, trägt die Kosten der Wärmelieferung nach Vereinbarung (§ 2 Nr. 4 Buchst. c BetrKV);
   dazu sagt der Hinweis nichts, das steht im Lexikon. Maßgeblich ist nach BGH VIII ZR 46/25 Rn. 30 der
   **Mietvertrag**, der „zum Zeitpunkt der beabsichtigten Umstellung bereits lauf[t]“, nicht der Einzug;
   Mietfuchs kennt nur den Mietbeginn und nimmt ihn als Näherung. Der Text sagt deshalb „sofern der
   Mietvertrag vor der Umstellung geschlossen wurde“, und wer vor der Umstellung unterschrieb, aber erst
   am Tag der Umstellung einzog, erscheint nicht (Festlegung, im PR-Text nennen).
5. **Neuer Parameter `bgb.heat-delivery-switch` (Festlegung).** Der Entwurf führt in 4.3 keinen
   Parameter für § 556c. Der Hinweis nennt aber zwei Zahlen (drei Monate, 80 Prozent), und Zahlen stehen
   nur im Register (4.3, Wächter). Zeitregel `eventDate` (der Tag der Umstellung), erste Fassung ab
   01.07.2013 (§ 13 WärmeLV). Für eine Umstellung davor gibt es keine Fassung; der Hinweis hat dann einen
   eigenen Text (Review Focus 5).
6. **Kein Eintrag im Regelverzeichnis (Festlegung).** `rulesFor` nennt jede Regel, die im Zeitraum gilt,
   in jeder Abrechnung; eine Regel zu § 556c stünde damit auch bei Häusern ohne Wärmelieferung im
   Rechtsstand. Der Hinweis trägt die Normen selbst; der benutzte Parameter steht in `legalBasis.values`.
7. **Text zu VIII ZR 46/25 nach dem Volltext (Festlegung, Prüfung vom 05.10.2026).** Der Volltext
   (Rn. 27, 28, 44–47) trägt drei Aussagen: § 556c gilt „weder unmittelbar noch entsprechend“; die
   Mieter tragen die Kosten auf Grund einer (auch stillschweigenden) Vereinbarung, etwa durch Ankündigung
   und Zahlung der Vorauszahlungen; der Vermieter kann danach **jedenfalls** den Anteil verlangen, der
   bei eigener zentraler Versorgung nach § 7 Abs. 2, § 8 Abs. 2 HeizkostenV angefallen wäre, und ob die
   Vereinbarung die vollen Kosten nach § 7 Abs. 4, § 8 Abs. 4 HeizkostenV einschließlich der
   kalkulatorischen Kosten umfasst, hat der BGH offengelassen und an das Berufungsgericht
   zurückverwiesen. Der Hinweis sagt genau das; „nur … der Anteil“ (otto-schmidt, Pressemitteilung) ist
   ungenau und steht nicht im Text. Task 4 Step 6 entfällt als Leseschritt und prüft nur den Wortlaut des
   Tests gegen diese Abweichung.
8. **§ 11 Abs. 1 Nr. 4 HeizkostenV nicht in diesem Plan (Lücke, vom Plan PR 14 an PR 16 verwiesen).** Die
   Vorschrift nimmt „die Kosten des Betriebs der zugehörigen Hausanlagen“ von §§ 3 bis 7 aus, „soweit
   diese Kosten in den Fällen des § 1 Absatz 3 nicht in den Kosten der Wärmelieferung enthalten sind,
   sondern vom Gebäudeeigentümer gesondert abgerechnet werden“ (Wortlaut am 05.10.2026 gelesen). § 1
   Abs. 3 ist der Fall, in dem der Lieferant **unmittelbar mit den Nutzern** abrechnet. Den bildet Mietfuchs
   nicht ab: Eine Anlage mit Contracting ist hier immer eine, deren Kosten der Vermieter abrechnet (§ 1
   Abs. 1 Nr. 2). Ohne den Fall des § 1 Abs. 3 gibt es nichts, was Nr. 4 ausnehmen könnte. Vorschlag für ein
   neues Issue (öffentlich, vor dem Anlegen nachfragen): „Wärmelieferung mit unmittelbarer Abrechnung des
   Lieferanten (§ 1 Abs. 3, § 11 Abs. 1 Nr. 4 HeizkostenV)“.
9. **CO₂-Pflicht nach dem Brennstoff des Lieferanten (Festlegung, neu nach Prüfung vom 05.10.2026).**
   Bei Contracting rechnet die Berechnung die Anlage als Fernwärme (Abweichung 3), und PR 6 verlangt bei
   Fernwärme CO₂-Angaben oder meldet `co2.missing` mit der Kürzung um 3 % (§ 7 Abs. 4 CO2KostAufG). Das
   CO2KostAufG erfasst Wärmelieferung aber nur „hinsichtlich der für die Wärmeerzeugung eingesetzten
   Brennstoffe“ (§ 2 Abs. 1 Satz 2). Kennt Mietfuchs den Brennstoff des Contractors und gehört er zu
   denen, für die PR 6 keine CO₂-Aufteilung vorsieht (Pellets, Holz, Strom, Wärmepumpe; Entwurf W8),
   entfällt die Pflicht: `Co2Pot` bekommt `fuelEnergy`, und die Prüfung „CO₂-Angaben nötig“ fragt
   `co2Required(pot)` (Task 3 Step 5a). Bei Gas, Öl, Flüssiggas, Kohle und „Sonstiges“ bleibt es bei der
   Regel der Fernwärme. Fernwärme ohne Merkmal kennt keinen Brennstoff und bleibt unverändert.

---

### Task 1: Rechtsregister und Lexikon

**Files:**
- Modify: `shared/law/bgb-betrkv.ts`, `shared/law/params.ts`, `shared/glossary.ts`
- Test: `server/test/law.test.ts`, `server/test/law-history.test.ts`, `server/test/glossary.test.ts`

**Interfaces:**
- Consumes: `LawParam`, `Source` (register.ts); `hkvConsumptionShare`, `hkvConsumptionShareForced` (PR 10), `hkvDhwFactors` (PR 11).
- Produces: `bgbHeatDeliverySwitch: LawParam<{ readonly noticeMonths: number; readonly efficiencyPercent: number }, 'eventDate'>` (`'bgb.heat-delivery-switch'`); `TermId` + `'heatDelivery'`.

- [ ] **Step 1: Write the failing tests**

`server/test/law.test.ts`: Import ergänzen `bgbHeatDeliverySwitch` (aus `'../../shared/law/bgb-betrkv.ts'`)
und im Test „jede Konstante vom Typ LawParam …“ das Objekt `modules` um `bgbHeatDeliverySwitch`
erweitern. Anhängen:

```ts
test('Stichtag bgb.heat-delivery-switch: ab 01.07.2013 drei Monate und 80 %, davor keine Fassung (§ 556c BGB, § 11, § 13 WärmeLV)', () => {
  const log = createLawLog()
  assert.deepEqual(law(bgbHeatDeliverySwitch, { date: '2013-07-01' }, log), { noticeMonths: 3, efficiencyPercent: 80 })
  assert.deepEqual(law(bgbHeatDeliverySwitch, { date: '2025-10-01' }, log), { noticeMonths: 3, efficiencyPercent: 80 })
  assert.throws(() => valueAt(bgbHeatDeliverySwitch, '2013-06-30'), /Kein Rechtswert/)
  assert.equal(log.values.length, 1)
  assert.equal(bgbHeatDeliverySwitch.describe({ noticeMonths: 3, efficiencyPercent: 80 }), 'Ankündigung spätestens 3 Monate vor der Umstellung; Jahresnutzungsgrad ab 80 %')
  const v = versionAt(bgbHeatDeliverySwitch, '2020-01-01')
  assert.equal(v.source.url, 'https://www.gesetze-im-internet.de/bgb/__556c.html')
  assert.equal(v.source.checked, 'checked')
})
```

`server/test/law-history.test.ts`, in `SHIPPED` hinter den Zeilen von PR 15 (bzw. der letzten
vorhandenen):

```ts
  // 0.11.0 (Heizung PR 16, #213)
  'bgb.heat-delivery-switch|2013-07-01||{"noticeMonths":3,"efficiencyPercent":80}',
```

`server/test/glossary.test.ts` anhängen:

```ts
test('Lexikon: Wärmelieferung nennt § 556c, WärmeLV, § 7 Abs. 3 und die Zahlen aus dem Register (Heizung PR 16)', () => {
  const t = GLOSSARY.heatDelivery
  for (const n of [/§ 556c BGB/, /WärmeLV/, /§ 7 Abs\. 3 und 4/, /§ 9 Abs\. 2 Satz 6 Nr\. 2/, /§ 3 Abs\. 4 CO2KostAufG/, /§ 2 Nr\. 4 Buchst\. c BetrKV/]) assert.match(t.norm ?? '', n)
  assert.match(t.short, /nicht der Pflichtanteil von 70 %/)
  assert.match(t.example, /÷ 1,15/)
  assert.match(t.needed, /spätestens 3 Monate/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/glossary.test.ts`
Expected: FAIL, fehlender Export `bgbHeatDeliverySwitch` bzw. `heatDelivery`.

- [ ] **Step 3: Parameter (`shared/law/bgb-betrkv.ts`)**

Ans Dateiende:

```ts
// Umstellung auf Wärmelieferung im laufenden Mietverhältnis (Heizung PR 16, #213). Wortlaut am
// 05.10.2026 gelesen: § 556c BGB (Abs. 1 Satz 2: „Beträgt der Jahresnutzungsgrad der bestehenden Anlage
// vor der Umstellung mindestens 80 Prozent, kann sich der Wärmelieferant … auf die Verbesserung der
// Betriebsführung … beschränken“; Abs. 2: „spätestens drei Monate zuvor in Textform anzukündigen“) und
// § 11 Abs. 1 WärmeLV („muss dem Mieter spätestens drei Monate vor der Umstellung in Textform zugehen“).
// `eventDate`: der Tag der Umstellung. Die erste Fassung beginnt mit dem Inkrafttreten der WärmeLV am
// 01.07.2013 (§ 13 WärmeLV, primär); dass § 556c Abs. 1 und 2 am selben Tag in Kraft traten, steht nur
// sekundär fest (buzer.de). Für eine Umstellung davor gibt es keine Fassung (Abweichung 5).
export const bgbHeatDeliverySwitch: LawParam<{ readonly noticeMonths: number; readonly efficiencyPercent: number }, 'eventDate'> = {
  id: 'bgb.heat-delivery-switch',
  title: 'Umstellung auf Wärmelieferung im laufenden Mietverhältnis',
  norm: '§ 556c BGB; § 11 WärmeLV',
  timing: 'eventDate',
  versions: [{
    validFrom: '2013-07-01',
    value: { noticeMonths: 3, efficiencyPercent: 80 },
    source: { rank: 'law', cite: '§ 556c Abs. 1 Satz 2, Abs. 2 BGB; § 11 Abs. 1, § 13 WärmeLV', url: 'https://www.gesetze-im-internet.de/bgb/__556c.html', retrieved: '2026-10-05', checked: 'checked' },
    enacted: '§ 556c BGB eingefügt durch Art. 1 G v. 11.03.2013 (BGBl. I S. 434); Wärmelieferverordnung vom 7. Juni 2013 (BGBl. I S. 1509)',
  }],
  describe: (v) => `Ankündigung spätestens ${v.noticeMonths} Monate vor der Umstellung; Jahresnutzungsgrad ab ${v.efficiencyPercent} %`,
}
```

(Der Typimport `LawParam` steht in der Datei schon.) `shared/law/params.ts`: importieren und in
`LAW_PARAMS` (nach Kennung geordnet) hinter `betrkvTvSignal` bzw. vor `bgbDeadlineMonths` einfügen:

```ts
  bgbHeatDeliverySwitch,
```

- [ ] **Step 4: Lexikon (`shared/glossary.ts`)**

Importe ergänzen: `hkvConsumptionShareForced`, `hkvDhwFactors` aus `'./law/heizkostenv.ts'`,
`bgbHeatDeliverySwitch` aus `'./law/bgb-betrkv.ts'`. Unter den Konstanten oben:

```ts
const FORCED = valueAt(hkvConsumptionShareForced, LAW_AS_OF)
const DHW = valueAt(hkvDhwFactors, LAW_AS_OF)
const SWITCH = valueAt(bgbHeatDeliverySwitch, LAW_AS_OF)
const dec = (n: number): string => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
```

In `GLOSSARY` hinter `operatingPower` (PR 15):

```ts
  // Heizung PR 16 (#213). Wortlaut § 556c BGB, WärmeLV §§ 1–13, HeizkostenV §§ 1, 7, 9, BetrKV § 2 Nr. 4,
  // CO2KostAufG §§ 2, 3 am 05.10.2026 gelesen.
  heatDelivery: {
    title: 'Wärmelieferung (Contracting, Fernwärme)',
    short: `Liefert ein Dritter die Wärme, aus einem Wärmenetz (Fernwärme) oder aus einer Anlage im Haus, die er betreibt (Contracting), sind die Kosten der Wärmelieferung sein Entgelt und die Kosten des Betriebs der Hausanlagen. Verteilt werden sie nach der Heizkostenverordnung zu ${SHARE.min} bis ${SHARE.max} Prozent nach Verbrauch; nicht der Pflichtanteil von ${FORCED} % für ungedämmte Gebäude mit Öl- oder Gasheizung, denn der gilt nur für die eigene Heizung.`,
    example: `Ein Contractor betreibt den Gaskessel im Keller und stellt 6.000 € Arbeitspreis und 1.200 € Grundpreis in Rechnung; dazu kommen 150 € Betriebsstrom der Pumpen im Haus. Heizkosten sind 7.350 €. Wird der Warmwasseranteil mit der Formel bestimmt, ist ihr Wert durch ${dec(DHW.heatSupplyDivisor)} zu teilen (÷ ${dec(DHW.heatSupplyDivisor)}), nicht wie bei eigenem Erdgas nach Brennwert mit ${dec(DHW.gasCalorific)} zu malnehmen. Die CO₂-Angaben muss der Lieferant auf seiner Rechnung ausweisen, und aufgeteilt wird wie bei Fernwärme.`,
    norm: '§ 556c BGB; §§ 1, 5, 8 bis 11 WärmeLV; § 1 Abs. 1 Nr. 2, § 7 Abs. 3 und 4, § 9 Abs. 2 Satz 6 Nr. 2 HeizkostenV; § 2 Nr. 4 Buchst. c BetrKV; § 2 Abs. 1 Satz 2, § 3 Abs. 4 CO2KostAufG',
    needed: `Wenn Ihr Haus mit Fernwärme oder von einem Contractor versorgt wird. Umlegen dürfen Sie die Kosten der Wärmelieferung, wenn der Mietvertrag es vorsieht. Haben Sie während laufender Mietverhältnisse von der eigenen Heizung umgestellt, gelten für diese Mieter die Voraussetzungen des § 556c BGB: bessere Effizienz, keine höheren Kosten als vorher und eine Ankündigung in Textform spätestens ${SWITCH.noticeMonths} Monate vor der Umstellung. Hat der Mieter vorher selbst geheizt, gilt § 556c nicht; ob und wie weit er die Kosten trägt, hängt dann von einer (auch stillschweigenden) Vereinbarung ab (BGH, Urteil vom 20.05.2026, VIII ZR 46/25). Mietfuchs nennt das in der Abrechnung, wenn Sie den Tag der Umstellung an der Heizung eintragen.`,
  },
```

(`SHARE` steht in der Datei seit PR 1.) „÷ 1,15“ und „Arbeitspreis“ sind keine Muster des Wächters;
die Zahlen 6.000/1.200/150 sind gewählte Beispielwerte.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/glossary.test.ts test/law-literals.test.ts test/law-release.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/law/bgb-betrkv.ts shared/law/params.ts shared/glossary.ts server/test/law.test.ts server/test/law-history.test.ts server/test/glossary.test.ts
git commit -m "Rechtsregister: Umstellung auf Wärmelieferung (§ 556c BGB, § 11 WärmeLV); Lexikon Wärmelieferung

Refs #213"
```

---

### Task 2: Datenmodell, Migrationen, Prüfung an der Anlage

**Files:**
- Modify: `shared/types.ts`, `server/src/db/schema.ts`, `server/src/db/read.ts`, `server/src/db/heating.ts`, `server/test/migrations.test.ts`
- Create: `server/drizzle/00xx_waermelieferung.sql`, `server/drizzle/00xx_waermelieferung_bedingungen.sql` (erzeugt)
- Test: `server/test/db-waermelieferung.test.ts` (neu)

**Interfaces:**
- Consumes: `heatingPlants`, `oneOf`, `exactly` (schema.ts); `mergeHeatingPlant`, `emptyHeatingPlant`, `plantRow`, `guardHeatingPlant`, `createHeatingPlant`, `updateHeatingPlant` (db/heating.ts); `HeatingError`, `merged`, `asNullableFilled`, `oneOfOrUndefined`, `ISO_DATE` (repository.ts).
- Produces:
  - `shared/types.ts`: `type PreviousSupply = 'landlord' | 'tenant'`; `HeatingPlant.contracting: boolean`, `.heatDeliverySince: string | null`, `.previousSupply: PreviousSupply | null`, `.switchAnnouncedOn: string | null`
  - `shared/heatDelivery.ts` (neu, hier nur): `CONTRACTING_ENERGIES: readonly HeatingEnergy[]` (`gas`, `oil`, `lpg`, `coal`, `pellets`, `wood`, `electric`, `other`; nicht `districtHeating`, `heatPump`), `isHeatDelivery(plant: Pick<HeatingPlant, 'energy' | 'contracting'>): boolean`
  - schema.ts: `PREVIOUS_SUPPLIES`; Spalten `heatingPlants.contracting`, `.heatDeliverySince`, `.previousSupply`, `.switchAnnouncedOn`

- [ ] **Step 1: Write the failing tests**

`server/test/db-waermelieferung.test.ts`:

```ts
// Wärmelieferung (Heizung PR 16, #213): Merkmale an der Anlage, ihre Bedingungen und Prüfungen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { createHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { HeatingError } from '../src/db/repository.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-waermelieferung-'))
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
const heatingError = (status: number, text: RegExp) => (e: unknown) => e instanceof HeatingError && e.status === status && text.test(e.message)

test('Kette: Bestand ohne Wärmelieferung, Vorgaben false und NULL', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_waermelieferung'))
    if (bis < 0) assert.fail('Schritt …_waermelieferung fehlt')
    applyMigrations(c, migrations.slice(0, bis))
    c.exec(`INSERT INTO heating_plants (id, property_id, energy) VALUES ('hp', 'objekt-1', 'gas')`)
    applyMigrations(c, migrations)
    assert.deepEqual(c.rows("SELECT contracting, heat_delivery_since, previous_supply, switch_announced_on FROM heating_plants WHERE id = 'hp'"), [[0, null, null, null]])
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Prüfbedingungen: Contracting bei jeder zentralen Anlage außer Fernwärme und Wärmepumpe; Umstellung nur bei Wärmelieferung', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    const ins = (id: string, cols: string, vals: string) => `INSERT INTO heating_plants (id, property_id, energy${cols}) VALUES ('${id}', 'objekt-1'${vals})`
    assert.equal(rejects(c, ins('a', ', contracting', ", 'gas', 1")), null)
    assert.equal(rejects(c, ins('b', ', contracting', ", 'pellets', 1")), null)
    assert.match(rejects(c, ins('b2', ', contracting', ", 'heatPump', 1")) ?? '', /heating_plants_contracting_energy/)
    assert.match(rejects(c, ins('b3', ', contracting', ", 'districtHeating', 1")) ?? '', /heating_plants_contracting_energy/)
    assert.match(rejects(c, ins('c', ', contracting, supply', ", 'gas', 1, 'perUnit'")) ?? '', /heating_plants_contracting_central/)
    assert.equal(rejects(c, ins('d', ', heat_delivery_since, previous_supply', ", 'districtHeating', '2025-10-01', 'landlord'")), null)
    assert.match(rejects(c, ins('e', ', heat_delivery_since', ", 'gas', '2025-10-01'")) ?? '', /heating_plants_delivery_only/)
    assert.match(rejects(c, ins('f', ', contracting, heat_delivery_since', ", 'gas', 1, '01.10.2025'")) ?? '', /heating_plants_delivery_since_date/)
    assert.match(rejects(c, ins('g', ', contracting, previous_supply', ", 'gas', 1, 'mieter'")) ?? '', /heating_plants_previous_supply_known/)
    assert.match(rejects(c, ins('h', ', contracting, switch_announced_on', ", 'gas', 1, '2025-06-01'")) ?? '', /heating_plants_announced_needs_since/)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Anlage: Contracting anlegen und ändern, Review Focus 3 lehnt mit einem Satz ab', async () => {
  await withDatabase(async (opened) => {
    const { plant } = await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service', contracting: true, heatDeliverySince: '2025-10-01', previousSupply: 'landlord', switchAnnouncedOn: '2025-06-15' }))
    assert.deepEqual([plant.contracting, plant.heatDeliverySince, plant.previousSupply, plant.switchAnnouncedOn], [true, '2025-10-01', 'landlord', '2025-06-15'])
    const pellets = await opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'pellets' }))
    assert.deepEqual([pellets?.energy, pellets?.contracting], ['pellets', true])
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'heatPump' })), heatingError(400, /Wärmepumpe/))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'districtHeating' })), heatingError(400, /Fernwärme ist ohne Merkmal Wärmelieferung/))
    await opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'gas' }))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { heatDeliverySince: '01.10.2025' })), heatingError(400, /Tag der Umstellung/))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { heatDeliverySince: null })), heatingError(400, /Ankündigung ohne Tag der Umstellung/))
    const ohne = await opened.write((db) => updateHeatingPlant(db, 'hp', { contracting: false, heatDeliverySince: null, previousSupply: null, switchAnnouncedOn: null }))
    assert.deepEqual([ohne?.contracting, ohne?.heatDeliverySince], [false, null])
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { heatDeliverySince: '2025-10-01' })), heatingError(400, /nur bei Fernwärme oder Contracting/))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-waermelieferung.test.ts`
Expected: FAIL, „Schritt …_waermelieferung fehlt“.

- [ ] **Step 3: Typen (`shared/types.ts`) und Konstanten (`shared/heatDelivery.ts`)**

Hinter `HeatingSource` (PR 4):

```ts
// Wer vor der Umstellung auf Wärmelieferung versorgte (Heizung PR 16): der Vermieter mit eigener Anlage
// (die Mieter trugen die Heizkosten als Betriebskosten, § 556c BGB) oder die Mieter selbst, etwa mit
// Einzelöfen (BGH, Urteile vom 20.05.2026, VIII ZR 46/25 und 47/25: § 556c gilt dann nicht).
export type PreviousSupply = 'landlord' | 'tenant'
```

`HeatingPlant` bekommt als letzte Felder:

```ts
  // Wärmelieferung (Heizung PR 16, #213). `contracting`: Ein Dritter betreibt die Anlage im Haus und
  // liefert Wärme (eigenständig gewerbliche Wärmelieferung, § 1 Abs. 1 Nr. 2 HeizkostenV); Fernwärme ist
  // es ohne Merkmal. Bei beiden: Tag einer Umstellung während laufender Mietverhältnisse, wer vorher
  // versorgte, und wann die Umstellungsankündigung zuging (§ 556c Abs. 2 BGB, § 11 WärmeLV).
  contracting: boolean
  heatDeliverySince: string | null
  previousSupply: PreviousSupply | null
  switchAnnouncedOn: string | null
```

`shared/heatDelivery.ts` (neu):

```ts
// Wärmelieferung (Heizung PR 16, #213): die Naht, über die Contracting wie Fernwärme rechnet
// (Abweichung 3 im Plan). Liegt in shared/, weil Server und Formular dieselbe Entscheidung brauchen.
import type { HeatingEnergy, HeatingPlant } from './types.ts'

// Contracting gibt es bei jeder zentralen Anlage (§ 1 Abs. 1 Nr. 2 HeizkostenV: „auch aus Anlagen nach
// Nummer 1“); die Folgen nach § 7 Abs. 3 und § 9 Abs. 2 Satz 6 Nr. 2 hängen nicht am Brennstoff
// (Abweichung 2). Nicht dabei: Fernwärme, die ohne Merkmal Wärmelieferung ist, und die Wärmepumpe, bei
// der die Verordnung offenlässt, ob Satz 6 Nr. 2 oder Nr. 3 gilt (Auslegung). Ob CO₂ aufzuteilen ist,
// entscheidet der Brennstoff des Lieferanten (Abweichung 9, `co2Required` in server/src/co2.ts).
export const CONTRACTING_ENERGIES: readonly HeatingEnergy[] = ['gas', 'oil', 'lpg', 'coal', 'pellets', 'wood', 'electric', 'other']

// Wärmelieferung im Sinne von § 1 Abs. 1 Nr. 2 HeizkostenV: Fernwärme oder Contracting.
export const isHeatDelivery = (plant: Pick<HeatingPlant, 'energy' | 'contracting'>): boolean =>
  plant.energy === 'districtHeating' || plant.contracting
```

- [ ] **Step 4: Erster Schritt: Spalten (`server/src/db/schema.ts`)**

Typimport um `PreviousSupply`. Bei den Listen der Heizanlage:

```ts
export const PREVIOUS_SUPPLIES = exactly<PreviousSupply>()(['landlord', 'tenant'] as const)
```

In `heatingPlants` als letzte Spalten:

```ts
    // Wärmelieferung (Heizung PR 16, #213).
    contracting: integer('contracting', { mode: 'boolean' }).notNull().default(false),
    heatDeliverySince: text('heat_delivery_since'),
    previousSupply: text('previous_supply', { enum: PREVIOUS_SUPPLIES }),
    switchAnnouncedOn: text('switch_announced_on'),
```

Run: `npm --prefix server run db:generate -- --name waermelieferung`
Expected: vier Zeilen `ALTER TABLE \`heating_plants\` ADD …` (`contracting` mit `DEFAULT false NOT
NULL`), kein `__new_`.

- [ ] **Step 5: Zweiter Schritt: Bedingungen**

In der Bedingungsliste von `heatingPlants` anhängen:

```ts
    // Wärmelieferung (Heizung PR 16): Contracting nicht bei Fernwärme und Wärmepumpe, nur zentral; Angaben
    // zur Umstellung nur bei Fernwärme oder Contracting; Ankündigung nur mit Tag der Umstellung.
    check('heating_plants_contracting_energy', sql.raw(`"contracting" = 0 OR "energy" IN ('gas', 'oil', 'lpg', 'coal', 'pellets', 'wood', 'electric', 'other')`)),
    check('heating_plants_contracting_central', sql.raw(`"contracting" = 0 OR "supply" = 'central'`)),
    check('heating_plants_delivery_only', sql.raw(`("heat_delivery_since" IS NULL AND "previous_supply" IS NULL AND "switch_announced_on" IS NULL) OR "contracting" = 1 OR "energy" = 'districtHeating'`)),
    check('heating_plants_delivery_since_date', sql.raw(`"heat_delivery_since" IS NULL OR "heat_delivery_since" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)),
    check('heating_plants_announced_date', sql.raw(`"switch_announced_on" IS NULL OR "switch_announced_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)),
    oneOf('heating_plants_previous_supply_known', 'previous_supply', PREVIOUS_SUPPLIES),
    check('heating_plants_announced_needs_since', sql.raw('"switch_announced_on" IS NULL OR "heat_delivery_since" IS NOT NULL')),
```

Run: `npm --prefix server run db:generate -- --name waermelieferung_bedingungen`
Expected: Neubau `__new_heating_plants` mit `INSERT INTO … SELECT` samt der vier Spalten.

Run: `grep -c '__new_heating_plants' server/drizzle/*_waermelieferung_bedingungen.sql`
Expected: eine Zahl ≥ 3.

- [ ] **Step 6: Marken eintragen**

Run:

```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag.includes('waermelieferung')) console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```

In `server/test/migrations.test.ts` hinter den Marken von PR 15 einfügen, darüber
`// Heizung PR 16 (#213). Wird PR 15 vor dem Push neu erzeugt, hier neu eintragen.`

- [ ] **Step 7: Lesen, Verschmelzen, Prüfen (`server/src/db/read.ts`, `server/src/db/heating.ts`)**

`readHeatingPlants` (read.ts), im gebauten Objekt hinter dem letzten Feld:

```ts
      contracting: p.contracting, heatDeliverySince: p.heatDeliverySince ?? null,
      previousSupply: p.previousSupply ?? null, switchAnnouncedOn: p.switchAnnouncedOn ?? null,
```

`server/src/db/heating.ts`: aus `./schema.ts` `PREVIOUS_SUPPLIES`, aus `'../../../shared/heatDelivery.ts'`
`CONTRACTING_ENERGIES` importieren. In `mergeHeatingPlant` hinter dem letzten Feld:

```ts
    contracting: merged(body, 'contracting', current.contracting, (v) => v === true),
    heatDeliverySince: merged(body, 'heatDeliverySince', current.heatDeliverySince, asNullableFilled),
    previousSupply: merged(body, 'previousSupply', current.previousSupply, (v) => oneOfOrUndefined(PREVIOUS_SUPPLIES, v) ?? null),
    switchAnnouncedOn: merged(body, 'switchAnnouncedOn', current.switchAnnouncedOn, asNullableFilled),
```

`emptyHeatingPlant` ergänzen: `contracting: false, heatDeliverySince: null, previousSupply: null,
switchAnnouncedOn: null,`. `plantRow` ergänzen: `contracting: p.contracting, heatDeliverySince:
p.heatDeliverySince, previousSupply: p.previousSupply, switchAnnouncedOn: p.switchAnnouncedOn,`.

In `guardHeatingPlant` vor `await sameProperty(…)`:

```ts
  // Wärmelieferung (Heizung PR 16, #213; Abweichung 2).
  if (after.contracting && after.energy === 'districtHeating') {
    throw new HeatingError(400, 'Fernwärme ist ohne Merkmal Wärmelieferung. Bitte nehmen Sie das Häkchen bei „Contracting“ heraus.')
  }
  if (after.contracting && !CONTRACTING_ENERGIES.includes(after.energy)) {
    throw new HeatingError(400, 'Contracting mit einer Wärmepumpe bildet Mietfuchs noch nicht ab: Ob der Formelwert für das Warmwasser dann wie bei Wärmelieferung oder wie bei einer Wärmepumpe umzurechnen ist, lässt die Heizkostenverordnung offen (§ 9 Abs. 2 Satz 6 Nr. 2 und 3).')
  }
  if (after.contracting && after.supply !== 'central') {
    throw new HeatingError(400, 'Contracting gibt es nur bei einer zentralen Heizung; Etagenheizungen eines Lieferanten kommen mit einer späteren Version.')
  }
  const delivery = after.contracting || after.energy === 'districtHeating'
  if (!delivery && (after.heatDeliverySince !== null || after.previousSupply !== null || after.switchAnnouncedOn !== null)) {
    throw new HeatingError(400, 'Angaben zur Umstellung auf Wärmelieferung gibt es nur bei Fernwärme oder Contracting.')
  }
  for (const [value, what] of [[after.heatDeliverySince, 'Der Tag der Umstellung'], [after.switchAnnouncedOn, 'Der Tag, an dem die Ankündigung zuging,']] as const) {
    if (value !== null && !ISO_DATE.test(value)) throw new HeatingError(400, `${what} ist kein Datum. Bitte wählen Sie ihn im Kalender.`)
  }
  if (after.switchAnnouncedOn !== null && after.heatDeliverySince === null) {
    throw new HeatingError(400, 'Eine Ankündigung ohne Tag der Umstellung lässt sich nicht prüfen. Bitte tragen Sie den Tag der Umstellung ein oder leeren Sie beide.')
  }
```

(`ISO_DATE` und `asNullableFilled` sind in db/heating.ts seit PR 4 importiert.)

Bauen Tests oder Helfer ein vollständiges `HeatingPlant` (Fehler des Übersetzers in `npm run
typecheck`), dort `contracting: false, heatDeliverySince: null, previousSupply: null, switchAnnouncedOn:
null,` ergänzen.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-waermelieferung.test.ts test/migrations.test.ts test/schema.test.ts test/db-heizanlage.test.ts test/db-golden.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts shared/heatDelivery.ts server/src/db/schema.ts server/drizzle server/src/db/read.ts server/src/db/heating.ts server/test/db-waermelieferung.test.ts server/test/migrations.test.ts server/test client/src
git commit -m "Heizanlage: Wärmelieferung (Contracting) und Angaben zur Umstellung

Contracting bei jeder zentralen Anlage außer Fernwärme und Wärmepumpe; Tag
der Umstellung, vorherige Versorgung und Ankündigung nur bei Wärmelieferung.

Refs #213"
```

---

### Task 3: Die Naht `billingEnergy`: Contracting rechnet wie Fernwärme

**Files:**
- Modify: `shared/heatDelivery.ts`, `server/src/snapshot.ts`, `server/src/co2.ts`, `server/src/calc.ts`, `server/src/db/heatingSelf.ts`, `server/src/db/heating.ts`, die Datei des Vorrats aus PR 8 Task 5 (Schreibprüfung mit `isStockEnergy` bzw. `STOCK_ENERGIES`), `client/src/heatingSelfForm.ts`-Aufrufer (`client/src/components/HeatingSelfSetup.tsx`), die Karte „Vorrat“ (PR 8 Task 8) und `client/src/components/FuelCard.tsx` (PR 7)
- Test: `server/test/heat-delivery-guard.test.ts` (neu), `server/test/heating.test.ts`, `server/test/calc-waermelieferung.test.ts` (neu), `server/test/db-waermelieferung.test.ts`

**Interfaces:**
- Consumes: `isHeatDelivery` (Task 2); `consumptionSharesOf`, `OIL_OR_GAS` (PR 10); `snapshotFor`, `heatingSnapshotFor`, `SnapshotHeatingPlant`; `distributionOf` (heatingSelf.ts).
- Produces:
  - `shared/heatDelivery.ts`: `billingEnergy(plant: Pick<HeatingPlant, 'energy' | 'contracting'>): HeatingEnergy`, `asBilledPlant<P extends Pick<HeatingPlant, 'energy' | 'contracting'>>(plant: P): P & { fuelEnergy?: HeatingEnergy }`
  - snapshot.ts: `SnapshotHeatingPlant` mit optionalen `'contracting' | 'heatDeliverySince' | 'previousSupply' | 'switchAnnouncedOn'` und `fuelEnergy?: HeatingEnergy`
  - co2.ts: `Co2Pot.fuelEnergy?: HeatingEnergy`; `NO_CO2_FUELS: readonly HeatingEnergy[]`; `co2Required(pot: Pick<Co2Pot, 'energy' | 'fuelEnergy'>): boolean`

- [ ] **Step 1: Write the failing tests**

`server/test/heat-delivery-guard.test.ts`:

```ts
// Wächter für die Naht der Wärmelieferung (Heizung PR 16, #213, Abweichung 3): Wo die Schreibwege und die
// Oberfläche nach der Energie einer Anlage entscheiden, fragen sie billingEnergy(plant) und nicht
// plant.energy. Sonst rechnet die Abrechnung Contracting wie Fernwärme, aber die Einrichtung verlangt
// 70 % nach Verbrauch oder einen Vorrat (Review Focus 1, 2). Die Berechnung selbst bekommt die Anlage
// schon mit der Energie der Abrechnung (snapshot.ts) und ist deshalb ausgenommen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scan } from '../testing/sourceScan.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ENERGY_DECISION = /\b(?:(?:STOCK_ENERGIES|METERED_ENERGIES|KWH_ENERGIES|OIL_OR_GAS)\.includes|isStockEnergy|kwhEnergy|forcedShare|selfSetupBody)\(\s*[\w.?]+\.energy\b|\b(?:consumptionSharesOf|distributionOf)\([^()]*?,\s*[\w.?]+\.energy\s*,/g
// Die Berechnung bekommt die Anlage aus dem Schnappschuss mit der Energie der Abrechnung.
const ENGINE = new Set(['server/src/calc.ts', 'server/src/co2.ts', 'server/src/fuel.ts', 'server/src/fuelStock.ts', 'server/src/dhw.ts', 'server/src/heating.ts', 'server/src/snapshot.ts'])

function files(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { recursive: true }).map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('.d.ts'))
    .map((f) => path.join(dir, f).split(path.sep).join('/'))
}

export function energyDecisions(file: string, source: string): string[] {
  return scan(source, file.endsWith('.tsx')).code.split('\n').flatMap((line, i) => [...line.matchAll(ENERGY_DECISION)].map((m) => `${file}:${i + 1}: ${m[0]}`))
}

test('Wärmelieferung: Schreibwege und Oberfläche entscheiden nach billingEnergy, nicht nach plant.energy', () => {
  const open = [...files('server/src'), ...files('client/src'), ...files('shared')]
    .filter((f) => !ENGINE.has(f))
    .flatMap((f) => energyDecisions(f, fs.readFileSync(path.join(ROOT, f), 'utf8')))
  assert.deepEqual(open, [], `Bitte billingEnergy(plant) aus shared/heatDelivery.ts nehmen:\n${open.join('\n')}`)
})

test('Wächter der Wärmelieferung: erkennt die Muster und lässt billingEnergy durch (Mutationsprobe)', () => {
  const sample = [
    'if (STOCK_ENERGIES.includes(plant.energy)) x()',
    'const f = forcedShare(plant.energy, form.insulation)',
    'distributionOf(rows, ctx.plant.energy, h, today)',
    'if (STOCK_ENERGIES.includes(billingEnergy(plant))) x()',
    'const g = forcedShare(billingEnergy(plant), form.insulation)',
  ].join('\n')
  assert.deepEqual(energyDecisions('probe.ts', sample).map((s) => s.split(': ')[0]), ['probe.ts:1', 'probe.ts:2', 'probe.ts:3'])
})
```

In `server/test/heating.test.ts` anhängen:

```ts
test('§ 7 Abs. 3: Contracting mit Gas rechnet ohne Pflichtanteil (Review Focus 1, Heizung PR 16)', () => {
  const plant = { energy: 'gas' as const, contracting: true }
  const shares = consumptionSharesOf([row('2025-01', 60, 60, 'applies')], '2025-01', billingEnergy(plant), seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([shares.heating, shares.forced], [60, false])
  const eigen = consumptionSharesOf([row('2025-01', 60, 60, 'applies')], '2025-01', billingEnergy({ energy: 'gas', contracting: false }), seventy) ?? assert.fail('kein Anteil')
  assert.deepEqual([eigen.heating, eigen.forced], [70, true])
})
```

(`row` und `seventy` sind Helfer der Datei aus PR 10; Import
`import { billingEnergy } from '../../shared/heatDelivery.ts'`.)

`server/test/calc-waermelieferung.test.ts` (der Teil zur Naht; der Hinweis folgt in Task 4):

```ts
// Wärmelieferung in der Berechnung (Heizung PR 16, #213): Contracting rechnet wie Fernwärme
// (Abweichung 3), und der Hinweis zu § 556c (Task 4).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapshotFor, type SnapshotSource } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { HeatingPlant } from '../../shared/types.ts'

const P = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
export const anlage = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
  id: 'hp', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'manual', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, units: null,
  contracting: false, heatDeliverySince: null, previousSupply: null, switchAnnouncedOn: null,
  ...over,
} as HeatingPlant)

test('Naht: snapshotFor gibt Contracting die Energie der Fernwärme und behält den Brennstoff', () => {
  const quelle = (p: HeatingPlant): SnapshotSource => ({
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
    units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: [p],
  } as SnapshotSource)
  const mit = snapshotFor(quelle(anlage({ contracting: true })), 'objekt-1', P).heatingPlants?.[0] ?? assert.fail('keine Anlage')
  assert.deepEqual([mit.energy, mit.fuelEnergy, mit.contracting], ['districtHeating', 'gas', true])
  const ohne = snapshotFor(quelle(anlage()), 'objekt-1', P).heatingPlants?.[0] ?? assert.fail('keine Anlage')
  assert.deepEqual([ohne.energy, ohne.fuelEnergy], ['gas', undefined])
})
```

(Die Umwandlung `as HeatingPlant` deckt nur die Felder späterer PRs ab, die dieser Test nicht kennt; ist
der Typ nach PR 14 vollständig bekannt, die Felder ausschreiben und die Umwandlung streichen.
`SnapshotSource` braucht die Felder der Objekte und Anlagen so, wie PR 2/4 sie verlangen.)

In `server/test/db-waermelieferung.test.ts` anhängen (Review Focus 1 und 2 an den Schreibwegen):

```ts
test('Schreibwege: Contracting mit Öl ist keine Vorratsenergie, Gas ohne Pflichtanteil (Review Focus 1, 2)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'oil', method: 'manual', contracting: true }))
    // Vorrat (PR 8): Bei einer Anlage mit Vorratsenergie nimmt die Heizperiode Anfangs- und Endbestand an;
    // bei Contracting lehnt sie ab, weil der Lieferant den Vorrat führt.
    await assert.rejects(opened.write((db) => saveStock(db, 'hp', '2025-01', { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 190000 })),
      heatingError(400, /Vorrat/))
    // Anteil nach Verbrauch (PR 10): Gas mit Contracting und gedämmten Leitungen nimmt 60 % an.
    await opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'gas' }))
    const d = await opened.write((db) => saveDistribution(db, 'hp', '2026-01', { heatConsumptionPct: 60, waterConsumptionPct: 60, insulationRule: 'applies' }, '2025-12-01'))
    assert.equal(d?.effective?.heating, 60)
  })
})
```

(Importe: `saveStock(db, plantId, period, body)` aus `'../src/db/fuelStock.ts'` (PR 8 Task 5),
`saveDistribution(db, plantId, period, body, today)` aus `'../src/db/heatingSelf.ts'` (PR 10 Task 5),
`heatingPlants` aus `'../src/db/schema.ts'`, `eq` aus `'drizzle-orm'`. `stockOptionsFor(plant)` in
fuelStock.ts entscheidet nach der Energie; der Wächter findet die Zeile darin, und ihr `Pick` bekommt
`'contracting'` dazu. Lehnt PR 8 den Vorrat bei einer Anlage mit Methode `manual` und Lieferungen in kWh schon
aus einem anderen Grund ab, prüft der Test nur `/Vorrat/` im Satz und bleibt gültig. `saveDistribution`
verlangt eine Anlage mit Methode `self`; dafür wie in PR 15 Task 4 die Methode direkt setzen:
`await opened.write((db) => db.update(heatingPlants).set({ method: 'self' }).where(eq(heatingPlants.id, 'hp')))`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/heat-delivery-guard.test.ts test/heating.test.ts test/calc-waermelieferung.test.ts test/db-waermelieferung.test.ts`
Expected: FAIL: Der Wächter findet die Stellen aus PR 7, 8 und 10 (`STOCK_ENERGIES.includes(after.energy)`,
`OIL_OR_GAS.includes(plant.energy)`, `distributionOf(…, ctx.plant.energy, …)`, `forcedShare(plant.energy, …)`
…), `billingEnergy` fehlt, `fuelEnergy` fehlt.

- [ ] **Step 3: Die Naht (`shared/heatDelivery.ts`)**

Anhängen:

```ts
// Die Energie, nach der abgerechnet wird: Bei Contracting ist es Wärme laut Rechnung des Lieferanten,
// also dasselbe wie Fernwärme. Daraus folgen nach dem Wortlaut: kein Pflichtanteil nach § 7 Abs. 1
// Satz 2 (§ 7 Abs. 3 HeizkostenV), ÷ 1,15 für Formelwerte (§ 9 Abs. 2 Satz 6 Nr. 2), kein Vorrat beim
// Vermieter, CO₂ aus den Angaben des Lieferanten (§ 3 Abs. 4 CO2KostAufG).
export const billingEnergy = (plant: Pick<HeatingPlant, 'energy' | 'contracting'>): HeatingEnergy =>
  plant.contracting ? 'districtHeating' : plant.energy

// Die Anlage, wie die Berechnung sie sieht: mit der Energie der Abrechnung und dem Brennstoff des
// Lieferanten für Beschriftungen (`fuelEnergy`).
export function asBilledPlant<P extends Pick<HeatingPlant, 'energy' | 'contracting'>>(plant: P): P & { fuelEnergy?: HeatingEnergy } {
  return plant.contracting ? { ...plant, energy: 'districtHeating', fuelEnergy: plant.energy } : plant
}
```

- [ ] **Step 4: Schnappschuss (`server/src/snapshot.ts`)**

`SnapshotHeatingPlant`: die optionalen Felder um `'contracting' | 'heatDeliverySince' | 'previousSupply' |
'switchAnnouncedOn'` erweitern und `& { fuelEnergy?: HeatingEnergy }` anhängen. In `snapshotFor` und
`heatingSnapshotFor` die Zeile mit `(source.heatingPlants ?? []).filter((p) => p.propertyId ===
propertyId)` um `.map(asBilledPlant)` ergänzen (Import aus `'../../shared/heatDelivery.ts'`). Fehlen
`contracting` an einer Quelle (von Hand gebaut), liefert `asBilledPlant` die Anlage unverändert, denn
`undefined` ist falsch.

`asBilledPlant` verlangt `contracting` im Typ; bei der Quelle (`SnapshotSource.heatingPlants`) ist es nach
Task 2 da, weil sie `HeatingPlant` führt. Hat die Quelle einen engeren Typ, ihn um `'contracting'`
erweitern (Pick).

- [ ] **Step 5: Schreibwege und Oberfläche auf `billingEnergy` umstellen**

Run: `npm --prefix server test -- test/heat-delivery-guard.test.ts`
Expected: FAIL mit der Liste der Stellen. Jede gemeldete Stelle wird nach diesem Muster umgestellt:

```ts
// vorher
if (STOCK_ENERGIES.includes(after.energy)) throw new HeatingError(400, LATER.stock)
// nachher
if (STOCK_ENERGIES.includes(billingEnergy(after))) throw new HeatingError(400, LATER.stock)
```

Die nach den Plänen von PR 7, 8 und 10 erwarteten Stellen, je mit ihrer neuen Zeile:

`server/src/db/heatingSelf.ts` (PR 10 Task 5):

```ts
  const shares = consumptionSharesOf(rows, h.key, billingEnergy(ctx.plant), () => valueAt(hkvConsumptionShareForced, h.from))
```

in `distributionOf` den Parameter `energy` beibehalten und die beiden Aufrufer ändern:

```ts
  return distributionOf(await shareRows(db, plantId), billingEnergy(ctx.plant), h, today)
```

```ts
        ? distributionOf(rows.map((r) => ({ period: String(r.period), heatConsumptionPct: r.heatConsumptionPct, waterConsumptionPct: r.waterConsumptionPct, insulationRule: r.insulationRule })), billingEnergy(ctx.plant), h, today)
```

in `checkShares`:

```ts
  if (insulationRule === 'applies' && OIL_OR_GAS.includes(billingEnergy(plant))) {
```

```ts
  const before = consumptionSharesOf(rows, h.key, billingEnergy(plant), () => valueAt(hkvConsumptionShareForced, h.from))
```

`server/src/db/heating.ts` (PR 7 Task 4, PR 10 Task 5):

```ts
    if (before.energy !== after.energy && STOCK_ENERGIES.includes(billingEnergy(after)) && (lieferungen?.n ?? 0) > 0) {
```

```ts
    if (after.hotWater === 'combined' && !KWH_ENERGIES.includes(billingEnergy(after))) throw new HeatingError(400, LATER.dhwHeatingValue)
```

Vorrat (PR 8 Task 5), `server/src/db/fuelStock.ts`, in `stockOptionsFor` den Typ des Parameters auf
`Pick<HeatingPlant, 'energy' | 'method' | 'contracting'>` erweitern und die Bedingung ersetzen:

```ts
  if (STOCK_ENERGIES.includes(billingEnergy(plant))) {
```

Lieferungen (PR 8 Task 5 Step 6), `server/src/db/fuel.ts`, in `guardFuelDelivery`:

```ts
  if (STOCK_ENERGIES.includes(billingEnergy(plant))) {
```

(Steht in einer der beiden Dateien `isStockEnergy(plant.energy)`, wird daraus
`isStockEnergy(billingEnergy(plant))`.)

Client, `client/src/components/HeatingSelfSetup.tsx` (PR 10 Task 11): direkt unter den Requisiten

```tsx
  const billed = asBilledPlant(plant)
```

und in der Datei `forcedShare(plant.energy, …)` → `forcedShare(billed.energy, …)`, `selfSetupBody(form,
plant.energy)` → `selfSetupBody(form, billed.energy)`, `emptySelfSetup(plant, period)` →
`emptySelfSetup(billed, period)`. Die Karte „Vorrat“ (PR 8 Task 8) und `FuelCard` (PR 7 Task 11) bekommen
dieselbe Zeile `const billed = asBilledPlant(plant)` und fragen `billed.energy`, wo sie nach der Energie
entscheiden.

Meldet der Wächter weitere Stellen, gilt dieselbe Regel: Entscheidet die Stelle über Abrechnung, Vorrat,
Warmwasser oder den Anteil nach Verbrauch, nimmt sie `billingEnergy`; ist es eine Beschriftung des
Energieträgers, prüft der Wächter sie nicht (sie trifft keins der Muster).

- [ ] **Step 5a: CO₂-Pflicht nach dem Brennstoff des Lieferanten (`server/src/co2.ts`, `server/src/calc.ts`, Abweichung 9)**

Test, in `server/test/calc-waermelieferung.test.ts` anhängen:

```ts
import { co2Required } from '../src/co2.ts'

test('Abweichung 9: Pellet-Contracting verlangt keine CO₂-Angaben, Gas-Contracting und Fernwärme schon (§ 2 Abs. 1 Satz 2 CO2KostAufG)', () => {
  assert.equal(co2Required({ energy: 'districtHeating', fuelEnergy: 'pellets' }), false)
  assert.equal(co2Required({ energy: 'districtHeating', fuelEnergy: 'wood' }), false)
  assert.equal(co2Required({ energy: 'districtHeating', fuelEnergy: 'electric' }), false)
  assert.equal(co2Required({ energy: 'districtHeating', fuelEnergy: 'gas' }), true)
  assert.equal(co2Required({ energy: 'districtHeating', fuelEnergy: 'other' }), true)
  assert.equal(co2Required({ energy: 'districtHeating' }), true)
  assert.equal(co2Required({ energy: 'oil' }), true)
  assert.equal(co2Required({ energy: 'pellets' }), false)
})
```

Run: `npm --prefix server test -- test/calc-waermelieferung.test.ts`
Expected: FAIL, fehlender Export `co2Required`.

`server/src/co2.ts`: `Co2Pot` bekommt hinter `energy`:

```ts
  // Bei Contracting (Heizung PR 16) der Brennstoff des Lieferanten; `energy` ist dann `districtHeating`.
  fuelEnergy?: HeatingEnergy
```

In `co2PotsOf` im zurückgegebenen Objekt hinter `energy: plant.energy,`:

```ts
        ...(plant.fuelEnergy !== undefined ? { fuelEnergy: plant.fuelEnergy } : {}),
```

Hinter `CO2_FUELS`:

```ts
// Brennstoffe ohne CO₂-Aufteilung (Entwurf W8): Für sie entstehen keine CO₂-Kosten nach dem BEHG, die
// das CO2KostAufG aufteilen könnte. Bei Wärmelieferung zählt der „für die Wärmeerzeugung eingesetzte
// Brennstoff“ (§ 2 Abs. 1 Satz 2 CO2KostAufG); kennt Mietfuchs ihn (Contracting, Heizung PR 16), entfällt
// bei diesen die Pflicht. Fernwärme ohne Merkmal hat keinen bekannten Brennstoff und bleibt erfasst.
export const NO_CO2_FUELS: readonly HeatingEnergy[] = ['pellets', 'wood', 'electric', 'heatPump']

// Ob für einen Topf CO₂-Angaben nötig sind (sonst `co2.missing`).
export const co2Required = (pot: Pick<Co2Pot, 'energy' | 'fuelEnergy'>): boolean =>
  CO2_FUELS.includes(pot.energy) ||
  (pot.energy === 'districtHeating' && !(pot.fuelEnergy !== undefined && NO_CO2_FUELS.includes(pot.fuelEnergy)))
```

`server/src/calc.ts`, im Zweig „Ohne Angaben“ des CO₂-Blocks (PR 6 Task 7) die Bedingung

```ts
      if (CO2_FUELS.includes(pot.energy) || pot.energy === 'districtHeating') {
```

ersetzen durch

```ts
      if (co2Required(pot)) {
```

und `co2Required` aus `'./co2.ts'` importieren. Der Zweig `else if (pot.energy === 'other')` bleibt; ein
Pellet-Contracting fällt in keinen der beiden Zweige und meldet nichts. Fragt eine andere Stelle des
CO₂-Blocks (PR 7 bis PR 15) mit derselben Bedingung `CO2_FUELS.includes(pot.energy) || pot.energy ===
'districtHeating'` nach der Pflicht, wird sie ebenso ersetzt (`grep -n "=== 'districtHeating'" server/src/calc.ts`).

Run: `npm --prefix server test -- test/calc-waermelieferung.test.ts test/calc-co2.test.ts`
Expected: PASS.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/heat-delivery-guard.test.ts test/heating.test.ts test/calc-waermelieferung.test.ts test/db-waermelieferung.test.ts test/law-literals.test.ts && npm --prefix client test && npm run typecheck`
Expected: PASS.

Prüfung am Formelwert (PR 11), ohne neuen Code: `formulaFactor` bekommt aus dem Schnappschuss
`'districtHeating'`. In `server/test/dhw.test.ts` anhängen:

```ts
test('Contracting mit Gas oder Pellets: Formelwert ÷ 1,15 wie Wärmelieferung, nicht × 1,11 (§ 9 Abs. 2 Satz 6 Nr. 2, Heizung PR 16)', () => {
  // Dieselbe Eingabe wie im Test „Wärmelieferung“ dieser Datei, nur mit der Energie, die snapshotFor bei
  // Contracting liefert. Die Folge hängt nicht am Brennstoff (Abweichung 2).
  assert.equal(billingEnergy({ energy: 'gas', contracting: true }), 'districtHeating')
  assert.equal(billingEnergy({ energy: 'pellets', contracting: true }), 'districtHeating')
})
```

(Der Rechentest für ÷ 1,15 steht in PR 11 für `districtHeating` und gilt damit; dieser Test hält nur
fest, dass Contracting dort ankommt.)

- [ ] **Step 7: Run all tests and commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add shared/heatDelivery.ts server/src client/src server/test
git commit -m "Wärmelieferung: Contracting rechnet wie Fernwärme, über eine Naht im Schnappschuss

Kein Pflichtanteil nach § 7 Abs. 1 Satz 2 (§ 7 Abs. 3 HeizkostenV), ÷ 1,15
für Formelwerte, kein Vorrat beim Vermieter, CO₂ aus der Rechnung des
Lieferanten. Ein Wächter hält Schreibwege und Oberfläche an billingEnergy.

Refs #213"
```

---

### Task 4: Hinweis `heating.contracting` und Beschriftung im Ausweis

**Files:**
- Create: `server/src/heatDelivery.ts`
- Modify: `server/src/calc.ts`, `shared/types.ts`
- Test: `server/test/calc-waermelieferung.test.ts`

**Interfaces:**
- Consumes: `bgbHeatDeliverySwitch` (Task 1); `isHeatDelivery` (Task 2); `asBilledPlant`, Felder aus Task 3; `servesUnit` (PR 5); in `computeSettlement` `plants`, `items`, `statements`, `warn`, `lawLog`, `fmtDay`; `law`, `onlyVersion`.
- Produces:
  - `server/src/heatDelivery.ts`: `type SwitchFinding = { plantId: string; since: string; previousSupply: PreviousSupply | null; announcedOn: string | null; tenants: string[] }`, `switchFindings(plants, items, tenancies, units): SwitchFinding[]`, `subtractMonths(iso: string, months: number): string`, `switchText(f, rule: { noticeMonths: number; efficiencyPercent: number } | null, fmtDay, firstDay: string): string`
  - `shared/types.ts`: `HeatingStatement.contracting?: boolean`, `HeatingStatement.fuelEnergy?: HeatingEnergy`
  - calc.ts: Code `heating.contracting` (hint)

- [ ] **Step 1: Write the failing tests**

In `server/test/calc-waermelieferung.test.ts` anhängen:

```ts
import { computeSettlement } from '../src/calc.ts'
import { subtractMonths, switchFindings, switchText } from '../src/heatDelivery.ts'
import { snapshotOfPeriod, type SnapshotTenancy } from '../src/snapshot.ts'
import { previousPeriod } from '../../shared/period.ts'

const mieter = (id: string, start: string): SnapshotTenancy => ({
  id, unitId: id === 't1' ? 'u1' : 'u2', tenantName: id === 't1' ? 'Meier' : 'Schulz', persons: 1, personHistory: [{ from: start, persons: 1 }], start, end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const settle = (plant: HeatingPlant) => {
  const src = {
    units: [{ id: 'u1', name: 'EG', areaM2: 60, participates: true }, { id: 'u2', name: 'OG', areaM2: 40, participates: true }],
    // Meier wohnt seit 2010, also schon vor jeder Umstellung der Tests; Schulz zieht am Tag der Umstellung ein.
    tenancies: [mieter('t1', '2010-01-01'), mieter('t2', '2025-10-01')],
    costItems: [{ id: 'w', period: periodKey('2025-01'), category: 'Heizung und Warmwasser', description: 'Wärmelieferung', amountCents: 735000, key: 'area' as const, heatingPlantId: 'hp' }],
    meters: [], readings: [], payments: [], closedSettlements: [],
  }
  return computeSettlement({ ...snapshotOfPeriod(src, P, previousPeriod(CALENDAR_RULES, P)), heatingPlants: [asBilledPlant(plant)] })
}
const contracting = (s: ReturnType<typeof settle>) => (s.notices ?? []).filter((n) => n.code === 'heating.contracting')

test('§ 556c: Umstellung am 01.10.2025, Ankündigung rechtzeitig; nur der Mieter, der vorher wohnte (Review Focus 4)', () => {
  const [n, ...rest] = contracting(settle(anlage({ contracting: true, heatDeliverySince: '2025-10-01', previousSupply: 'landlord', switchAnnouncedOn: '2025-06-15' })))
  if (!n) return assert.fail('kein Hinweis')
  assert.equal(rest.length, 0)
  assert.equal(n.level, 'hint')
  assert.match(n.text, /Meier/)
  assert.doesNotMatch(n.text, /Schulz/)
  assert.match(n.text, /maßgeblich ist, ob der Mietvertrag vor der Umstellung geschlossen wurde/)
  assert.match(n.text, /mit verbesserter Effizienz/)
  assert.match(n.text, /mindestens 80 %/)
  assert.match(n.text, /spätestens 3 Monate vorher in Textform/)
  assert.match(n.text, /§ 5 WärmeLV/)
  assert.doesNotMatch(n.text, /§ 11 Abs\. 3 WärmeLV/)
})

test('§ 11 Abs. 3 WärmeLV: Ankündigung zu spät oder nicht erfasst', () => {
  const spaet = contracting(settle(anlage({ contracting: true, heatDeliverySince: '2025-10-01', previousSupply: 'landlord', switchAnnouncedOn: '2025-07-02' })))[0] ?? assert.fail('kein Hinweis')
  assert.match(spaet.text, /am 02\.07\.2025 zu, weniger als 3 Monate vor der Umstellung/)
  assert.match(spaet.text, /§ 11 Abs\. 3 WärmeLV/)
  const genau = contracting(settle(anlage({ contracting: true, heatDeliverySince: '2025-10-01', previousSupply: 'landlord', switchAnnouncedOn: '2025-07-01' })))[0] ?? assert.fail('kein Hinweis')
  assert.doesNotMatch(genau.text, /weniger als/)
  const ohne = contracting(settle(anlage({ contracting: true, heatDeliverySince: '2025-10-01', previousSupply: null })))[0] ?? assert.fail('kein Hinweis')
  assert.match(ohne.text, /Ob und wann die Umstellungsankündigung zuging, ist nicht erfasst/)
})

test('VIII ZR 46/25: vorher selbst geheizt, § 556c gilt nicht', () => {
  const n = contracting(settle(anlage({ contracting: true, heatDeliverySince: '2025-10-01', previousSupply: 'tenant' })))[0] ?? assert.fail('kein Hinweis')
  assert.match(n.text, /VIII ZR 46\/25 und 47\/25/)
  assert.match(n.text, /§ 556c BGB gilt dann nicht/)
  assert.match(n.text, /auch stillschweigend/)
  // Volltext Rn. 27, 47: „jedenfalls“ § 7 Abs. 2, § 8 Abs. 2; die vollen Kosten nach § 7 Abs. 4 offen.
  assert.match(n.text, /jedenfalls die Kosten verlangen, die bei eigener zentraler Versorgung nach § 7 Abs\. 2 und § 8 Abs\. 2 HeizkostenV/)
  assert.match(n.text, /§ 7 Abs\. 4 und § 8 Abs\. 4 HeizkostenV einschließlich der kalkulatorischen Kosten umfasst, hat der BGH offengelassen/)
  assert.doesNotMatch(n.text, /nur bis zu/)
  assert.doesNotMatch(n.text, /verbesserter Effizienz/)
})

test('Review Focus 5: Umstellung vor dem 01.07.2013, eigener Text, kein Programmfehler', () => {
  const n = contracting(settle(anlage({ energy: 'districtHeating', heatDeliverySince: '2012-10-01', previousSupply: 'landlord' })))[0] ?? assert.fail('kein Hinweis')
  assert.match(n.text, /vor dem 01\.07\.2013/)
  assert.match(n.text, /richtet sich nach dem Mietvertrag/)
})

test('Wer nichts einträgt, merkt nichts: ohne Tag der Umstellung kein Hinweis; Fernwärme ohne Angabe wie bisher', () => {
  assert.equal(contracting(settle(anlage({ contracting: true }))).length, 0)
  assert.equal(contracting(settle(anlage({ energy: 'districtHeating' }))).length, 0)
})

test('Monate abziehen: Monatsende bleibt im Monat', () => {
  assert.equal(subtractMonths('2025-10-01', 3), '2025-07-01')
  assert.equal(subtractMonths('2025-05-31', 3), '2025-02-28')
  assert.equal(subtractMonths('2024-05-31', 3), '2024-02-29')
  assert.equal(subtractMonths('2026-02-15', 3), '2025-11-15')
})

test('Befund rein: Anlage ohne Positionen in dieser Abrechnung meldet nichts (Weg b, Hinweis kommt aus dem Unteraufruf)', () => {
  const p = asBilledPlant(anlage({ contracting: true, heatDeliverySince: '2025-10-01' }))
  assert.deepEqual(switchFindings([p], [], [mieter('t1', '2010-01-01')], [{ id: 'u1' }]), [])
  const erste = onlyVersion(bgbHeatDeliverySwitch).validFrom ?? assert.fail('keine Grenze')
  assert.match(switchText({ plantId: 'hp', since: '2025-10-01', previousSupply: null, announcedOn: null, tenants: ['Meier'] }, { noticeMonths: 3, efficiencyPercent: 80 }, (d) => d, erste), /^Meier wohnte/)
})
```

Importe ergänzen: `asBilledPlant` aus `'../../shared/heatDelivery.ts'`, `onlyVersion` aus
`'../../shared/law/register.ts'`, `bgbHeatDeliverySwitch` aus `'../../shared/law/bgb-betrkv.ts'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-waermelieferung.test.ts`
Expected: FAIL, `Cannot find module '…/src/heatDelivery.ts'`.

- [ ] **Step 3: Befund und Text (`server/src/heatDelivery.ts`)**

```ts
// Umstellung auf Wärmelieferung im laufenden Mietverhältnis (Heizung PR 16, #213). Mietfuchs kann die
// Voraussetzungen des § 556c BGB nicht prüfen (Effizienz, Kostenvergleich nach §§ 8 bis 10 WärmeLV); es
// nennt sie für die Mieter, die schon vor der Umstellung wohnten (Abweichung 4), und prüft nur, was es
// weiß: den Zugang der Ankündigung (§ 556c Abs. 2 BGB, § 11 Abs. 1 und 3 WärmeLV). Hat der Mieter vorher
// selbst geheizt, gilt § 556c nicht (BGH, Urteile vom 20.05.2026, VIII ZR 46/25 und 47/25, Volltext
// am 05.10.2026 gelesen; Abweichung 7).
import type { CostItem, HeatingEnergy, PreviousSupply, Unit } from '../../shared/types.ts'
import { servesUnit } from '../../shared/heatingPeriod.ts'

export type SwitchFinding = { plantId: string; since: string; previousSupply: PreviousSupply | null; announcedOn: string | null; tenants: string[] }

type PlantFacts = {
  id: string
  energy: HeatingEnergy
  units: readonly { unitId: string }[] | null
  contracting?: boolean
  heatDeliverySince?: string | null
  previousSupply?: PreviousSupply | null
  switchAnnouncedOn?: string | null
}

// Je Anlage mit eingetragener Umstellung, deren Positionen diese Abrechnung verteilt, die Mieter, deren
// Mietverhältnis vor dem Tag der Umstellung begann. Die Energie ist die der Abrechnung (Task 3), also bei
// Contracting `districtHeating`.
export function switchFindings(
  plants: readonly PlantFacts[],
  items: readonly Pick<CostItem, 'heatingPlantId'>[],
  tenancies: readonly { tenantName: string; unitId: string; start: string }[],
  units: readonly Pick<Unit, 'id' | 'noConnection'>[],
): SwitchFinding[] {
  const out: SwitchFinding[] = []
  for (const p of plants) {
    const since = p.heatDeliverySince ?? null
    if (since === null || (p.energy !== 'districtHeating' && !p.contracting)) continue
    if (!items.some((c) => c.heatingPlantId === p.id)) continue
    const served = new Set(units.filter((u) => servesUnit(p, u)).map((u) => u.id))
    const tenants = tenancies.filter((t) => served.has(t.unitId) && t.start < since).map((t) => t.tenantName)
    if (tenants.length === 0) continue
    out.push({ plantId: p.id, since, previousSupply: p.previousSupply ?? null, announcedOn: p.switchAnnouncedOn ?? null, tenants })
  }
  return out
}

// Monate abziehen; ein Tag, den es im Zielmonat nicht gibt, wird zum letzten des Monats.
export function subtractMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const total = (y ?? 0) * 12 + ((m ?? 1) - 1) - months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(d ?? 1, last)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const names = (list: readonly string[]): string => (list.length === 1 ? list[0] ?? '' : `${list.slice(0, -1).join(', ')} und ${list.at(-1) ?? ''}`)

// `rule` ist null, wenn das Register für den Tag der Umstellung keine Fassung hat (vor dem 01.07.2013).
// `firstDay` ist der Beginn der ersten Fassung von `bgb.heat-delivery-switch` (calc.ts reicht ihn aus dem
// Register herein, damit hier kein Datum steht).
export function switchText(f: SwitchFinding, rule: { noticeMonths: number; efficiencyPercent: number } | null, fmtDay: (iso: string) => string, firstDay: string): string {
  const who = names(f.tenants)
  const verb = f.tenants.length === 1 ? 'wohnte' : 'wohnten'
  if (rule === null) {
    return `${who} ${verb} schon vor der Umstellung auf Wärmelieferung am ${fmtDay(f.since)}. Die Umstellung liegt vor dem ${fmtDay(firstDay)}; § 556c BGB und die Wärmelieferverordnung gelten erst für spätere Umstellungen. Ob die Kosten der Wärmelieferung umgelegt werden dürfen, richtet sich nach dem Mietvertrag.`
  }
  if (f.previousSupply === 'tenant') {
    return `${who} ${verb} schon vor der Umstellung auf Wärmelieferung am ${fmtDay(f.since)} und heizte${f.tenants.length === 1 ? '' : 'n'} vorher selbst. § 556c BGB gilt dann nicht (BGH, Urteile vom 20.05.2026, VIII ZR 46/25 und 47/25). ` +
      'Die Heizkosten tragen diese Mieter nur auf Grund einer Vereinbarung, die auch stillschweigend entstehen kann, etwa wenn sie nach einer Mitteilung über die Umstellung Heizkostenvorauszahlungen leisten. ' +
      'Dann können Sie jedenfalls die Kosten verlangen, die bei eigener zentraler Versorgung nach § 7 Abs. 2 und § 8 Abs. 2 HeizkostenV angefallen wären. Ob die Vereinbarung auch die vollen Kosten der Wärmelieferung nach § 7 Abs. 4 und § 8 Abs. 4 HeizkostenV einschließlich der kalkulatorischen Kosten umfasst, hat der BGH offengelassen; das hängt von der Auslegung im Einzelfall ab.'
  }
  const deadline = subtractMonths(f.since, rule.noticeMonths)
  const notice = f.announcedOn === null
    ? ' Ob und wann die Umstellungsankündigung zuging, ist nicht erfasst.'
    : f.announcedOn > deadline
      ? ` Die Umstellungsankündigung ging am ${fmtDay(f.announcedOn)} zu, weniger als ${rule.noticeMonths} Monate vor der Umstellung. Ohne ordnungsgemäße Ankündigung beginnt die Frist für Einwendungen gegen die Abrechnung der Wärmelieferkosten erst mit einer Mitteilung, die § 11 Abs. 1 und 2 WärmeLV entspricht (§ 11 Abs. 3 WärmeLV).`
      : ''
  return `${who} ${verb} schon vor der Umstellung auf Wärmelieferung am ${fmtDay(f.since)} (Mietfuchs nennt die Mieter nach dem Mietbeginn; maßgeblich ist, ob der Mietvertrag vor der Umstellung geschlossen wurde). Die Kosten der Wärmelieferung tragen sie als Betriebskosten nur, wenn die Wärme mit verbesserter Effizienz aus einer neuen Anlage des Lieferanten oder aus einem Wärmenetz kommt (hatte die bisherige Anlage einen Jahresnutzungsgrad von mindestens ${rule.efficiencyPercent} %, genügt eine verbesserte Betriebsführung), ` +
    `die Kosten der Wärmelieferung die bisherigen Betriebskosten für Wärme und Warmwasser nicht übersteigen (Kostenvergleich nach §§ 8 bis 10 WärmeLV) und die Umstellung spätestens ${rule.noticeMonths} Monate vorher in Textform angekündigt wurde (§ 556c BGB, § 11 WärmeLV). ` +
    `Ist eine Voraussetzung nicht erfüllt, können Sie vom Lieferanten verlangen, die Bestandteile seines Preises gesondert auszuweisen, die den umlegbaren Kosten nach § 7 Abs. 2 und § 8 Abs. 2 HeizkostenV entsprechen (§ 5 WärmeLV).${notice}`
}
```

`server/src/heatDelivery.ts` kommt in `ENGINE_FILES` von `server/test/law-literals.test.ts`: Die Datei
enthält kein Datums- und kein Prozentliteral.

- [ ] **Step 4: Hinweis und Beschriftung (`server/src/calc.ts`, `shared/types.ts`)**

`shared/types.ts`, `HeatingStatement` als letzte Felder:

```ts
  // Wärmelieferung durch einen Contractor (Heizung PR 16): `energy` ist dann `districtHeating` (die
  // Energie der Abrechnung), `fuelEnergy` der Brennstoff des Lieferanten, für die Beschriftung.
  contracting?: boolean
  fuelEnergy?: HeatingEnergy
```

calc.ts: Importe `switchFindings, switchText` aus `'./heatDelivery.ts'`, `bgbHeatDeliverySwitch` aus
`'../../shared/law/bgb-betrkv.ts'`. In `noticeKinds`:

```ts
  // Heizung PR 16 (#213): Umstellung auf Wärmelieferung im laufenden Mietverhältnis. Ein Hinweis, denn
  // Mietfuchs kann die Voraussetzungen des § 556c BGB nicht prüfen und nichts beziffern.
  'heating.contracting': { level: 'hint', title: 'Umstellung auf Wärmelieferung (§ 556c BGB)', terms: ['heatDelivery', 'heatingCostOrdinance'] },
```

In `computeSettlement` direkt hinter der Schleife von PR 15 (`for (const f of operatingPowerFindings(…))`):

```ts
  // Umstellung auf Wärmelieferung (Heizung PR 16, #213): nur in der Abrechnung, die die Heizkosten der
  // Anlage verteilt (`items`), für die Mieter, die schon vorher wohnten.
  const switchRule = bgbHeatDeliverySwitch.versions[0]?.validFrom ?? ''
  const tenancyRows = snapshot.tenancies.filter((t) => statements.has(t.id))
  for (const f of switchFindings(plants, items, tenancyRows, snapshot.units)) {
    const rule = f.since >= switchRule ? law(bgbHeatDeliverySwitch, { date: f.since }, lawLog) : null
    warn('heating.contracting', switchText(f, rule, fmtDay, switchRule), { kind: 'heatingPlant', id: f.plantId })
  }
```

(`plants` ist seit PR 5 `snapshot.heatingPlants ?? []`; `statements` die Map der Abrechnungen;
`fmtDay` der Datumshelfer in `computeSettlement`. „Ein Datum vor der ersten Fassung“ wird hier am Beginn
der ersten Fassung erkannt, nicht über einen Fehler des Registers.)

An der Stelle, an der der CO₂-Block (PR 6 Task 7) ein `HeatingStatement` baut
(`heatingStatements.push({ plantId: …, plantName: …, energy: pot.energy, … })`), ergänzen:

```ts
        ...(plantOf?.contracting ? { contracting: true, fuelEnergy: plantOf.fuelEnergy } : {}),
```

(`plantOf` ist dort seit PR 7 `plants.find((p) => p.id === pot.plantId)`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-waermelieferung.test.ts test/calc-notices.test.ts test/law-literals.test.ts test/glossary.test.ts test/settlement-golden.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Text gegen den Volltext von VIII ZR 46/25 halten**

Der Volltext ist am 05.10.2026 gelesen (Global Constraints, Abweichung 7). Der Test „VIII ZR 46/25“
hält die drei Aussagen fest: § 556c gilt nicht, die Vereinbarung kann stillschweigend entstehen, und
„jedenfalls“ die Kosten nach § 7 Abs. 2, § 8 Abs. 2 HeizkostenV, die vollen Kosten nach § 7 Abs. 4 offen.
Vor dem Merge nur prüfen, ob der Text von `switchText` noch genau diese drei Aussagen trifft; den
Prüfstand „Volltext gelesen am 05.10.2026“ in CLAUDE.md (Task 6) eintragen.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/heatDelivery.ts server/src/calc.ts shared/types.ts server/test/calc-waermelieferung.test.ts server/test/law-literals.test.ts
git commit -m "Abrechnung: Hinweis bei Umstellung auf Wärmelieferung (§ 556c BGB, WärmeLV, VIII ZR 46/25)

Für Mieter, die schon vor der Umstellung wohnten: die Voraussetzungen des
§ 556c, die Ankündigung mit § 11 Abs. 3 WärmeLV, bei vorheriger
Eigenversorgung der Mieter die Rechtslage nach dem BGH.

Refs #213"
```

---

### Task 5: Oberfläche: Fragen der Einrichtung und Beschriftung

**Files:**
- Modify: `client/src/heatingForm.ts`, `client/src/components/HeatingCard.tsx`, `client/src/co2View.ts`, `client/src/fuelView.ts`
- Test: `client/src/heatingForm.test.ts`, `client/src/components/HeatingCard.test.tsx`

**Interfaces:**
- Consumes: `CONTRACTING_ENERGIES` (Task 2); `HeatingForm`, `HeatingPlantBody`, `ENERGY_OPTIONS`, `emptyHeatingForm`, `heatingToForm`, `heatingPlantBody` (PR 4); `HeatingStatement.contracting`, `.fuelEnergy` (Task 4).
- Produces: `HeatingForm.contracting: boolean`, `.deliverySince: string`, `.previousSupply: '' | PreviousSupply`, `.announcedOn: string`; `PREVIOUS_SUPPLY_OPTIONS`; `asksContracting(energy)`, `asksSwitch(form)`; `energyLabelOf(h: Pick<HeatingStatement, 'energy' | 'contracting' | 'fuelEnergy'>): string`

- [ ] **Step 1: Write the failing tests**

In `client/src/heatingForm.test.ts` anhängen:

```ts
describe('Wärmelieferung (Heizung PR 16)', () => {
  test('Contracting bei jeder zentralen Anlage außer Fernwärme und Wärmepumpe; Umstellung bei Contracting oder Fernwärme', () => {
    expect(asksContracting('gas')).toBe(true)
    expect(asksContracting('pellets')).toBe(true)
    expect(asksContracting('heatPump')).toBe(false)
    expect(asksContracting('districtHeating')).toBe(false)
    expect(asksContracting('perUnit')).toBe(false)
    expect(asksSwitch(ausgefuellt({ energy: 'districtHeating' }))).toBe(true)
    expect(asksSwitch(ausgefuellt({ energy: 'gas', contracting: false }))).toBe(false)
    expect(asksSwitch(ausgefuellt({ energy: 'gas', contracting: true }))).toBe(true)
  })
  test('Rumpf: Angaben zur Umstellung nur, wo gefragt; Contracting fällt beim Wechsel zur Wärmepumpe weg', () => {
    const body = heatingPlantBody(ausgefuellt({ contracting: true, deliverySince: '2025-10-01', previousSupply: 'landlord', announcedOn: '2025-06-15' }), UNITS)
    expect('body' in body && body.body).toMatchObject({ contracting: true, heatDeliverySince: '2025-10-01', previousSupply: 'landlord', switchAnnouncedOn: '2025-06-15' })
    const pumpe = heatingPlantBody(ausgefuellt({ energy: 'heatPump', contracting: true, deliverySince: '2025-10-01' }), UNITS)
    expect('body' in pumpe && pumpe.body).toMatchObject({ contracting: false, heatDeliverySince: null, previousSupply: null, switchAnnouncedOn: null })
    const pellets = heatingPlantBody(ausgefuellt({ energy: 'pellets', contracting: true }), UNITS)
    expect('body' in pellets && pellets.body).toMatchObject({ contracting: true })
    const ohneTag = heatingPlantBody(ausgefuellt({ contracting: true, announcedOn: '2025-06-15' }), UNITS)
    expect(ohneTag).toEqual({ error: 'Eine Ankündigung ohne Tag der Umstellung lässt sich nicht prüfen. Bitte tragen Sie den Tag der Umstellung ein oder leeren Sie beide.' })
  })
  test('Beschriftung: Contracting nennt den Brennstoff', () => {
    expect(energyLabelOf({ energy: 'districtHeating', contracting: true, fuelEnergy: 'gas' })).toBe('Wärmelieferung (Contracting, erzeugt mit Gas)')
    expect(energyLabelOf({ energy: 'districtHeating', contracting: true, fuelEnergy: 'pellets' })).toBe('Wärmelieferung (Contracting, erzeugt mit Pellets)')
    expect(energyLabelOf({ energy: 'districtHeating' })).toBe('Fernwärme')
    expect(energyLabelOf({ energy: 'oil' })).toBe('Öl')
  })
})
```

(`asksContracting`, `asksSwitch`, `energyLabelOf` in den Import aus `'./heatingForm'` aufnehmen.)

In `client/src/components/HeatingCard.test.tsx` anhängen:

```tsx
test('Wärmelieferung: die Auswahl „Wer versorgte vorher?“ zeigt den gespeicherten Wert', async () => {
  const plant = { ...PLANT_FOR_CARD, energy: 'gas', contracting: true, heatDeliverySince: '2025-10-01', previousSupply: 'tenant', switchAnnouncedOn: null }
  renderCard([plant])
  const select = (await screen.findByLabelText(/Wer versorgte vorher/)) as HTMLSelectElement
  expect(select.value).toBe('tenant')
  expect((screen.getByLabelText(/Ein Dritter betreibt die Heizung/) as HTMLInputElement).checked).toBe(true)
})
```

(`PLANT_FOR_CARD` und `renderCard` sind die Helfer des Tests aus PR 4 Task 10; heißen sie anders, deren
Namen nehmen.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- heatingForm HeatingCard`
Expected: FAIL, fehlende Exporte.

- [ ] **Step 3: Logik (`client/src/heatingForm.ts`)**

Importe: `CONTRACTING_ENERGIES` aus `'../../shared/heatDelivery.ts'`, Typen `PreviousSupply`,
`HeatingStatement`. `HeatingForm` als letzte Felder:

```ts
  // Wärmelieferung (Heizung PR 16, #213)
  contracting: boolean
  deliverySince: string
  previousSupply: '' | PreviousSupply
  announcedOn: string
```

`HeatingPlantBody`: den Pick um `'contracting' | 'heatDeliverySince' | 'previousSupply' |
'switchAnnouncedOn'` erweitern. `emptyHeatingForm`: `contracting: false, deliverySince: '',
previousSupply: '', announcedOn: ''`. `heatingToForm`: `contracting: plant.contracting, deliverySince:
plant.heatDeliverySince ?? '', previousSupply: plant.previousSupply ?? '', announcedOn:
plant.switchAnnouncedOn ?? ''`. Anhängen:

```ts
export const PREVIOUS_SUPPLY_OPTIONS: { value: '' | PreviousSupply; label: string }[] = [
  { value: '', label: '— bitte wählen —' },
  { value: 'landlord', label: 'Ich, mit einer eigenen Heizung; die Mieter zahlten Heizkosten' },
  { value: 'tenant', label: 'Die Mieter selbst, etwa mit Einzelöfen oder Gasthermen' },
]
export const asksContracting = (energy: HeatingForm['energy']): boolean => energy !== '' && energy !== 'perUnit' && CONTRACTING_ENERGIES.includes(energy)
export const asksSwitch = (form: Pick<HeatingForm, 'energy' | 'contracting'>): boolean =>
  form.energy === 'districtHeating' || (form.contracting && asksContracting(form.energy))

export function energyLabelOf(h: Pick<HeatingStatement, 'energy' | 'contracting' | 'fuelEnergy'>): string {
  const label = (e: string) => ENERGY_OPTIONS.find((o) => o.value === e)?.label ?? e
  return h.contracting && h.fuelEnergy ? `Wärmelieferung (Contracting, erzeugt mit ${label(h.fuelEnergy)})` : label(h.energy)
}
```

In `heatingPlantBody` vor dem `return { body: … }`:

```ts
  const contracting = form.contracting && asksContracting(form.energy)
  const sw = asksSwitch({ energy: form.energy, contracting })
  if (sw && form.announcedOn !== '' && form.deliverySince === '') {
    return { error: 'Eine Ankündigung ohne Tag der Umstellung lässt sich nicht prüfen. Bitte tragen Sie den Tag der Umstellung ein oder leeren Sie beide.' }
  }
```

und im Rumpf ergänzen:

```ts
      contracting,
      heatDeliverySince: sw && form.deliverySince !== '' ? form.deliverySince : null,
      previousSupply: sw && form.previousSupply !== '' ? form.previousSupply : null,
      switchAnnouncedOn: sw && form.announcedOn !== '' ? form.announcedOn : null,
```

- [ ] **Step 4: Karte (`client/src/components/HeatingCard.tsx`)**

Direkt hinter der Frage „Womit wird geheizt?“:

```tsx
          {asksContracting(form.energy) && (
            <label>
              <input type="checkbox" checked={form.contracting} onChange={(e) => setForm({ ...form, contracting: e.target.checked })} />
              {' '}Ein Dritter betreibt die Heizung im Haus und liefert die Wärme (Contracting) <Term id="heatDelivery" />
            </label>
          )}
          {asksSwitch(form) && (
            <fieldset>
              <legend>Umstellung während laufender Mietverhältnisse</legend>
              <p className="hint">Nur ausfüllen, wenn Sie von einer anderen Versorgung auf diese Wärmelieferung umgestellt haben, während Mieter schon im Haus wohnten.</p>
              <label>Tag der Umstellung <input type="date" value={form.deliverySince} onChange={(e) => setForm({ ...form, deliverySince: e.target.value })} /></label>
              <label>
                Wer versorgte vorher?
                <select value={form.previousSupply} onChange={(e) => setForm({ ...form, previousSupply: PREVIOUS_SUPPLY_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '' })}>
                  {PREVIOUS_SUPPLY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label>Umstellungsankündigung zugegangen am <input type="date" value={form.announcedOn} onChange={(e) => setForm({ ...form, announcedOn: e.target.value })} /></label>
            </fieldset>
          )}
```

(Importe `asksContracting`, `asksSwitch`, `PREVIOUS_SUPPLY_OPTIONS` aus `'../heatingForm'`; `Term`.)

- [ ] **Step 5: Beschriftung im Ausweis (`client/src/co2View.ts`, `client/src/fuelView.ts`)**

Wo diese Dateien den Energieträger einer Heizperiode beschriften (in PR 6 Task 12 über
`ENERGY_OPTIONS.find((o) => o.value === h.energy)?.label`), stattdessen:

```ts
energyLabelOf(h)
```

(Import aus `'./heatingForm'`.) Ein Test in `client/src/co2View.test.ts`:

```ts
test('Contracting: der Ausweis nennt Wärmelieferung mit Brennstoff', () => {
  const view = co2Block({ ...statement(), energy: 'districtHeating', contracting: true, fuelEnergy: 'gas' }, 't1') ?? assert.fail('kein Block')
  expect(view.lines.some((l) => l.value.includes('Wärmelieferung (Contracting, erzeugt mit Gas)'))).toBe(true)
})
```

(`statement()` ist der Helfer der Datei aus PR 6 Task 12, der ein `HeatingStatement` baut; heißt er
anders, diesen nehmen.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix client test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src
git commit -m "Oberfläche: Contracting und Umstellung in der Einrichtung, Beschriftung im Ausweis

Refs #213"
```

---

### Task 6: CHANGELOG, CLAUDE.md, Gesamtprüfung

- [ ] **Step 1: CHANGELOG („Hinzugefügt“)**

```markdown
- **Wärmelieferung und Contracting** ([#213](https://github.com/speedone/mietfuchs/issues/213)): Eine
  zentrale Heizanlage (außer einer Wärmepumpe) kann als Contracting gekennzeichnet werden und rechnet dann
  wie Fernwärme: kein Pflichtanteil von 70 % nach Verbrauch (§ 7 Abs. 3 HeizkostenV), Formelwerte für das
  Warmwasser ÷ 1,15, CO₂ aus der Rechnung des Lieferanten; heizt der Lieferant mit Pellets, Holz oder
  Strom, verlangt Mietfuchs keine CO₂-Angaben. Wer während laufender Mietverhältnisse
  umgestellt hat, trägt den Tag ein; die Abrechnung nennt dann für die betroffenen Mieter die
  Voraussetzungen des § 556c BGB und der Wärmelieferverordnung, bei vorheriger Eigenversorgung der Mieter
  die Rechtslage nach BGH VIII ZR 46/25 und 47/25 (jedenfalls die Kosten nach § 7 Abs. 2, § 8 Abs. 2
  HeizkostenV; ob mehr, hängt von der Vereinbarung ab).
```

- [ ] **Step 2: CLAUDE.md**

Im Abschnitt „Berechnungs-Engine“ hinter dem Absatz zum Betriebsstrom (PR 15):

```markdown
- **Wärmelieferung, Contracting** (#213, Heizung PR 16): `heating_plants.contracting` (zentral, jeder
  Energieträger außer Fernwärme und Wärmepumpe; die Folgen der HeizkostenV hängen nicht am Brennstoff).
  Ob CO₂ aufzuteilen ist, sagt `co2Required` (co2.ts) nach dem Brennstoff des Lieferanten (`fuelEnergy`):
  bei Pellets, Holz und Strom nicht (§ 2 Abs. 1 Satz 2 CO2KostAufG). **Eine Naht:** `billingEnergy`/`asBilledPlant` in
  `shared/heatDelivery.ts` geben der Berechnung bei Contracting `energy = 'districtHeating'` (in
  `snapshotFor`), und damit gelten die Regeln der Fernwärme aus PR 6–11 ohne weitere Zeile (§ 7 Abs. 3,
  § 9 Abs. 2 Satz 6 Nr. 2, CO₂ nach § 3 Abs. 4). Schreibwege und Oberfläche fragen dieselbe Funktion; der
  Wächter `heat-delivery-guard.test.ts` verbietet dort `plant.energy` in Entscheidungen über Vorrat,
  kWh-Abrechnung und Pflichtanteil. Ausgenommen bleibt § 2 Abs. 4 Satz 2 CO2KostAufG, der an der
  gespeicherten Energie hängt. `heating.contracting` (hint) nennt für Mieter, die vor dem Tag der
  Umstellung einzogen, § 556c BGB und die WärmeLV oder, bei vorheriger Eigenversorgung der Mieter, BGH VIII
  ZR 46/25 und 47/25 (Volltext gelesen am 05.10.2026: jedenfalls § 7 Abs. 2, § 8 Abs. 2 HeizkostenV; der
  volle Umfang nach § 7 Abs. 4 hängt von der Vereinbarung ab).
```

- [ ] **Step 3: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: Exit-Status 0.

Run (Smoke-Test gegen eine laufende Instanz mit Wegwerf-Ordner, `CI=1` und geschlossenem Update-Port):

```bash
D=$(mktemp -d); NKA_DATA_DIR=$D CI=1 NKA_UPDATE_URL=http://127.0.0.1:9 NKA_PORT=3001 npm start & sleep 5; node scripts/smoke-test.mjs --url http://127.0.0.1:3001 --mode npm; kill %1; rm -rf $D
```

Expected: Das Skript endet mit Exit-Status 0.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "Doku: Wärmelieferung und Contracting in CHANGELOG und CLAUDE.md

Refs #213"
```

---

## Selbstprüfung

**1. Abdeckung des Entwurfs.**

| Anforderung | Task |
|---|---|
| Merkmal an der Anlage (13 PR 16) | 2 |
| Hinweise zu § 556c: Effizienz, Kostenneutralität, Ankündigung drei Monate vorher in Textform | 1 (Register), 4 |
| WärmeLV (§§ 5, 8–11) | 1 (Lexikon), 4 |
| VIII ZR 46/25, 47/25: kein § 556c nach Einzelöfen | 4 (Text `tenant`), Abweichung 7 |
| § 7 Abs. 3: kein zwingendes 70 % (8.5, 4.3, 12.2) | 3 (Berechnung, Schreibprüfung, Formular) |
| CO₂ wie Fernwärme, ohne Pflicht bei Pellets, Holz, Strom des Lieferanten | 3 (Naht, Step 5a) |
| `heating.contracting` hint (10.1) | 4 |
| Lexikon (10.3) | 1 |
| Abgrenzung zur Fernwärme (#213) | Abweichung 2, 3; Lexikon |
| Wer nichts einstellt, merkt nichts | 4 (Test), Global Constraints |

**2. Platzhalter.** Wo der Code von PR 7, 8, 10, 11 noch nicht steht, nennt Task 3 die erwarteten Zeilen
wörtlich und lässt den Wächter jede weitere finden; die Regel für jede gefundene Stelle steht dabei.

**3. Typen.** `PreviousSupply`, `HeatingPlant.contracting/heatDeliverySince/previousSupply/switchAnnouncedOn`
(Task 2), `billingEnergy`, `asBilledPlant`, `fuelEnergy` (Task 3), `SwitchFinding`, `switchFindings`,
`switchText(f, rule, fmtDay, firstDay)` (Task 4), `HeatingForm.contracting/deliverySince/previousSupply/announcedOn`
(Task 5) stimmen in allen Aufrufen überein.

**4. Review Focus.** 1 → Task 3 (heating.test.ts, db-waermelieferung.test.ts, Wächter); 2 → Task 3
(Vorrat); 3 → Task 2 und Task 3 Step 5a; 4 → Task 4 (Schulz zieht am Tag der Umstellung ein); 5 → Task 4.
