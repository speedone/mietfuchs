# Heizung PR 15: Betriebsstrom der Heizung (#212) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Betriebsstrom einer Zentralheizung (Brenner, Umwälzpumpe, Regelung) lässt sich als
Heizposition erfassen, die auch im Allgemeinstrom steckt; Mietfuchs erkennt, wenn er dort nicht in
gleicher Höhe abgezogen ist (`heating.operating-power-double`, mit Betrag), und legt Betriebsstrom und
Abzug auf Wunsch gemeinsam an: geschätzt nach Leistung der Geräte und Heiztagen, gemessen mit
Zwischenzähler oder mit einem selbst geschätzten Betrag samt Grundlage. Die Grundlage der Schätzung
bleibt an beiden Positionen gespeichert und steht im Rechenweg.

**Architecture:** Drei Spalten an `cost_items` (`operating_power`, `operating_power_item_id` mit
`RESTRICT` auf die eigene Tabelle, `operating_power_basis` als Text) in zwei erzeugten Migrationen
(`0037_betriebsstrom`, `0038_betriebsstrom_bedingungen`). Die Rechnung der Schätzhilfe liegt
DOM-frei in `shared/operatingPower.ts`, damit Formular und Server dieselbe Zahl rechnen. Eine Route
legt Betriebsstrom und Abzug in **einer** Transaktion an (`server/src/db/operatingPower.ts`). Die
Abrechnung prüft in `computeSettlement` jede Position, die sie verteilt, gegen die Abzüge aus allen
Zeiträumen (`Snapshot.operatingPowerDeductions`), über eine reine Funktion in
`server/src/operatingPower.ts`; ein Abzug in einer abgeschlossenen Abrechnung zählt nur, wenn er im
eingefrorenen Stand steht.

**Tech Stack:** Node 24 (TypeScript ohne Build), Express 5, Drizzle ORM 0.45 über `sqlite-proxy`,
drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich 0.5
(R-A23), 0.12 (Zeile Betriebsstrom: Weg „Betrag selbst geschätzt“), 2 (V ZR 166/15 „geprüft 05.10.“), 4.3 letzter Absatz (Spannen nicht im Register), 10.1
(`heating.operating-power-double`, warning, Betrag, PR 15), 10.3, 11.4 (Anleitungen:
„Betriebsstrom-Satz“), 13 PR 15, 14.1 („Betriebsstrom im Allgemeinstrom: Warnung mit Betrag“), 14.2
(#212), 16 („Prozentspanne als Rechenregel für den Betriebsstrom“ ist Nicht-Ziel).

**Baut auf:** PR 1 bis PR 14 und PR 17, alle in `feat/heizung` gemergt. Gearbeitet wird auf
`feat/heizung-pr15-betriebsstrom`, abgezweigt von `origin/feat/heizung` an `6571bdd` („Heizung PR 17:
Plausibilität der CO₂-Angaben und Ausdruck für den Messdienst“). Der PR geht gegen `feat/heizung`
(CLAUDE.md, „Durchsicht vor jedem PR und vor jedem Merge“). Abgeglichen ist dieser Plan mit dem Code
an `6571bdd`, siehe „Abgleich mit dem Code (Stand 6571bdd)“.

## Rechtsprüfung 09.10.2026 eingearbeitet

Die Rechtsprüfung dieses Plans vom 09.10.2026 hat fünf wichtige Befunde (P-W1 bis P-W5) und zehn kleine
(P-K1 bis P-K10) ergeben. Alle wichtigen sind übernommen und gehen dem übrigen Plan vor; die kleinen
sind in die Aufgaben eingearbeitet oder unten begründet erledigt. Gelesen wurden dafür BGH, Urteil vom
03.06.2016, V ZR 166/15 (Leitsatz, Rn. 13 bis 15), BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07
(Volltext ohne Randnummern; Leitsatz 3 und Gründe II.4), § 7 Abs. 1 und 2, § 8 Abs. 2 HeizkostenV und
§ 2 Nr. 4 Buchst. a, Nr. 5 Buchst. a und Nr. 11 BetrKV. Alle Rechenbeispiele des Plans sind
nachgerechnet und richtig; die Wiedergabe von V ZR 166/15 ist richtig.

**Die wichtigen Befunde und was daraus folgt:**

- **P-W1: Die Grundlagen der Schätzung gehen nach dem Anlegen verloren.** Bestreitet ein Mieter den
  angesetzten Betrag, muss der Vermieter die Grundlagen seiner Schätzung darlegen (BGH, Versäumnisurteil
  vom 20.02.2008, VIII ZR 27/07, Leitsatz 3: „Bestreitet der Mieter den vom Vermieter angesetzten Betrag,
  hat dieser die Grundlagen seiner Schätzung darzulegen.“). Die erste Fassung speicherte nur Betrag und
  Beschreibung. **Folge:** Spalte `operating_power_basis` an beiden Positionen (Task 2); die Schätzhilfe
  schreibt den Rechenweg samt Eingaben hinein (Task 4); das Kostenformular zeigt und ändert ihn (Task 6),
  der Rechenweg der Abrechnung nennt ihn (Task 5); Lexikon und Karte sagen, dass die Angaben
  aufzubewahren sind (Task 1, Task 6).
- **P-W2: Die zulässige Bruchteilsmethode endete in einer falschen Warnung.** Wer nach einem Bruchteil
  der Brennstoffkosten schätzt (V ZR 166/15 Rn. 14), konnte seinen Abzug nicht mit dem Betriebsstrom
  verknüpfen, und die Abrechnung behauptete „doppelt verteilt“. Der Entwurf hat den Weg „Betrag selbst
  geschätzt“ entschieden (0.12, Zeile Betriebsstrom). **Folge:** Die frühere Abweichung 9 entfällt.
  Die Schätzhilfe bekommt den dritten Weg „Betrag selbst geschätzt“ (Euro-Betrag und Freitext
  „Grundlage der Schätzung“, kein vorgegebener Prozentsatz; Task 3, 4, 6), und das Kostenformular
  verknüpft einen von Hand erfassten Abzug mit einer Betriebsstrom-Position (Task 6). Test: verknüpfter
  Handabzug ergibt keine Warnung, unverknüpfter die Warnung (Task 5).
- **P-W3: Ein Abzug in einer abgeschlossenen Abrechnung zählte als erledigt, erreicht die Mieter aber
  nicht.** Liegt der Allgemeinstrom in einem abgeschlossenen Zeitraum, wirkt ein später angelegter Abzug
  dort nicht mehr; der Betriebsstrom würde in der offenen Heizperiode verteilt und im eingefrorenen
  Allgemeinstrom ein zweites Mal gezahlt, genau das, was V ZR 166/15 Rn. 13 verbietet. **Folge:** Die
  Schätzhilfe lehnt mit 409 ab, wenn der Zeitraum der Allgemeinstrom-Position abgeschlossen ist (Task 4);
  der Befund zählt einen Abzug in einer abgeschlossenen Abrechnung nur, wenn er im eingefrorenen Stand
  steht, und warnt sonst mit eigenem Satz (Task 5). Test mit eingefrorener Abrechnung.
- **P-W4: Die Ablehnung bei Gemeinschaftsabrechnung behauptete, die Gemeinschaft erledige das.**
  V ZR 166/15 ist gerade der Fall, in dem sie es nicht getan hatte. **Folge:** Der Satz verweist auf
  die Pflicht der Gemeinschaft und bittet, die Hausgeldabrechnung zu prüfen und sich sonst an die
  Verwaltung zu wenden (Task 4).
- **P-W5: Bei Wärmepumpe und Stromheizung ist Strom Brennstoff, nicht Betriebsstrom.** § 7 Abs. 2
  HeizkostenV nennt „die Kosten der verbrauchten Brennstoffe“; der Entwurf rechnet den Strom der
  Wärmepumpe selbst so (8.3). Die Schätzhilfe hätte ihn als Teil „Betrieb“ angelegt. **Folge:** Für
  `energy` `heatPump` und `electric` gibt es keine Schätzhilfe; Karte und Route sagen in einem eigenen
  Satz, dass der Strom dort als Brennstoffkosten in die Heizposition gehört (Task 3, 4, 6). Test je
  Energieart. Der Fall „Strom der Wärmepumpe läuft über den Allgemeinstrom“ ist ein Vorschlag für ein
  Issue (Task 7).

**Wo jeder Befund steht:**

| Befund | Inhalt | Erledigt in |
|---|---|---|
| P-W1 | Grundlage der Schätzung speichern und zeigen | Task 1 Step 3 (Satz im Lexikon), Task 2 Step 1, 3, 4, 8 (Spalte), Task 4 Step 1, 3 (gespeichert), Task 5 Step 1, 5 (Rechenweg), Task 6 Step 1, 3, 4, 6 (Formular, Karte) |
| P-W2 | Weg „Betrag selbst geschätzt“, Handabzug verknüpfen | Task 3 Step 1, 3 (`ownEstimateShare`), Task 4 Step 1, 3 (dritter Zweig), Task 2 Step 1 (Verknüpfen und Lösen), Task 5 Step 1 (verknüpft/unverknüpft), Task 6 Step 1, 3, 4, 5, 6 |
| P-W3 | Abgeschlossener Zeitraum des Allgemeinstroms | Task 4 Step 1, 3 (409), Task 5 Step 1, 3, 4 (eingefrorener Stand) |
| P-W4 | Satz zur Gemeinschaftsabrechnung | Task 4 Step 1, 3 |
| P-W5 | Wärmepumpe und Stromheizung | Task 1 Step 3 (Lexikon), Task 3 Step 1, 3 (`operatingPowerRefusal`), Task 4 Step 1, 3, Task 6 Step 1, 6 |
| P-K1 | Norm in Karte und Formular | Task 6 Step 4, 6 |
| P-K2 | § 7 Abs. 1 und 2 statt Abs. 2 für den Schlüssel | Task 4 Step 1, 3 |
| P-K3 | § 8 Abs. 2 HeizkostenV, § 2 Nr. 5 Buchst. a BetrKV für das Warmwasser | Task 1 Step 1, 3, 4, Task 5 Step 1, 3 |
| P-K4 | Mietrechtliche Entscheidung VIII ZR 27/07 | Global Constraints, Task 1 Step 1, 3 |
| P-K5 | „Ja, bei jeder Zentralheizung“ zu absolut | Task 1 Step 1, 3, 4; Task 5 Step 1, 3 (Text des Befunds); Task 6 Step 4, 6 |
| P-K6 | Entwurf 13 PR 15 und 16 „nicht gebilligt“ | erledigt im Entwurf mit dem Commit, der diesen Abschnitt bringt (13 PR 15, 16 Nicht-Ziele: „zulässig, ohne eigenen Wert“) |
| P-K7 | Wächter und „höchstens 5 %“ | Task 1 Step 1, 3, 5 (Wortlaut bewusst „oder höchstens 5 %“, Autoren im Text, Test hält ihn fest) |
| P-K8 | Gleiche Heiztage für alle Geräte | Task 2 Step 3 (`days`), Task 3 Step 1, 3 (Tage je Gerät, optional), Task 4 Step 3 (`devicesOf`), Task 6 Step 1, 5, 6 (Eingabe, Satz zum Kesseltausch) |
| P-K9 | Messdienst: Abzug ohne Gegenstück | Task 4 Step 1, 3 (Beschreibung „an Messdienst gemeldet“) |
| P-K10 | Grundpreis (Abweichung 3) | ohne Änderung: als Festlegung im Schätzermessen gekennzeichnet, im Rechenweg sichtbar; keine Norm und keine Entscheidung schließt sie aus |

**Bewusst nicht zitiert:** Eine Randnummer zu VIII ZR 27/07 nennt der Plan nicht, denn am nummerierten
Volltext ist keine bestätigt; zitiert wird Leitsatz 3. Eine Entscheidung dazu, ob der Vorwegabzug auf
der Abrechnung erläutert werden muss, nennt der Plan ebenfalls nicht: Die Grundlage der Schätzung
steht nur im Rechenweg (`no-print`) und im Kostenformular, nicht auf dem Ausdruck für den Mieter, und
dafür braucht es kein Zitat.

## Änderungen nach Prüfung vom 05.10.2026

Die rechtliche Prüfung der Pläne PR 15 bis 22 vom 05.10.2026 (Leitsatz und Rn. 14 von V ZR 166/15 erneut
gelesen) hat diesen Plan an diesen Stellen geändert:

1. **Lexikon und Begründungen zu V ZR 166/15 Rn. 14 berichtigt** (Global Constraints, Task 1 Step 1,
   3, 5 und 7, Task 7 Step 1 und 2). Rn. 14: „Die Schätzung kann sich entweder auf einen Bruchteil der
   Brennstoffkosten stützen … oder an einer Berechnung orientieren, die auf dem Stromverbrauchswert der
   angeschlossenen Geräte und den (ggf. geschätzten) Heiztagen beruht. Welche Schätzmethode … steht in
   ihrem Ermessen, solange sie nicht einen offenkundig ungeeigneten Maßstab wählen.“ Der Bruchteil der
   Brennstoffkosten ist also eine **zulässige** Schätzgrundlage; die Prozentwerte gibt der BGH aus der
   Literatur wieder, ohne selbst einen festzulegen. Die frühere Fassung „nur wiedergegeben, nicht
   gebilligt“ war zu eng und ist überall ersetzt; der Lexikontest prüft den neuen Satz und schließt den
   alten aus. Dass Mietfuchs keinen Prozentsatz vorrechnet, bleibt eine Produktentscheidung (Entwurf 16).
2. **Grundpreisanteil als Festlegung im Schätzermessen benannt** (Abweichung 3, Task 3 Step 1 und 3,
   Task 6 Step 1, Lexikonbeispiel, CHANGELOG). Der Rechenweg heißt jetzt „14,08 % des Rechnungsbetrags
   einschließlich Grundpreis (1.050,00 €) = 147,84 €“; die Zahl ändert sich nicht.
3. **Leitsatz wörtlich** (Global Constraints): Er beginnt mit „In der Jahresabrechnung einer
   Wohnungseigentümergemeinschaft …“; die Übertragung auf jeden Gebäudeeigentümer stützt sich, wie
   vorher, auf § 7 Abs. 2 HeizkostenV.
4. ~~**Neu als Abweichung 9:** Der Weg „Betrag selbst geschätzt“ für die Bruchteilsmethode ist nicht Teil
   dieses Plans; Vorschlag für ein Issue.~~ **Gestrichen mit der Rechtsprüfung vom 09.10.2026 (P-W2):**
   Der Weg gehört in diesen PR.

## Global Constraints

- **Wer nichts einstellt, merkt nichts** (Entwurf 1.2 Nr. 1, 11.1): Ohne `operatingPower` an einer
  Position ist jede Zahl, jeder Hinweis und `legalBasis.values` gleich dem Stand nach PR 14. Golden
  F01–F18, `db-golden`, `calc-wortlaut.test.ts` und `law-wording.test.ts` bleiben ohne Anpassung grün.
- **Keine Prozentspanne als Rechenregel** (Entwurf 4.3 letzter Absatz, 16): Der BGH lässt in V ZR 166/15
  Rn. 14 einen Bruchteil der Brennstoffkosten ausdrücklich als Schätzgrundlage zu („Die Schätzung kann
  sich entweder auf einen Bruchteil der Brennstoffkosten stützen … oder an einer Berechnung orientieren,
  die auf dem Stromverbrauchswert der angeschlossenen Geräte und den (ggf. geschätzten) Heiztagen
  beruht“). Die Spannen 3–6 % (Jennißen), 4–10 % (Schmidt-Futterer/Lammel), 8–10 % (Wall) und
  „höchstens 5 %“ (Gies) gibt er dabei aus der Literatur wieder, **ohne selbst einen Wert festzulegen**.
  Sie stehen deshalb nur im Lexikon, als Literaturwerte, kommen nicht ins Register und in keine
  Rechnung. Dass die Schätzhilfe keinen Prozentsatz vorrechnet, ist eine Produktentscheidung (Entwurf
  16), keine Aussage über die Zulässigkeit der Bruchteilsmethode.
- **Kein Betrag wird automatisch abgezogen** (6.5 sinngemäß): Mietfuchs legt den Abzug nur an, wenn der
  Vermieter es mit der Schätzhilfe ausdrücklich verlangt; die Abrechnung meldet eine Abweichung, sie
  korrigiert sie nicht.
- **Stufe hängt am Code** (CLAUDE.md, #112): `heating.operating-power-double` ist `warning` (10.1), mit
  dem Betrag im Text.
- **Migrationen:** nur `npm --prefix server run db:generate -- --name <name>`, nie von Hand, zwei
  Schritte in dieser Reihenfolge: `betriebsstrom` (drei neue Spalten) und `betriebsstrom_bedingungen`
  (Bedingungen, Neubau von `cost_items`). drizzle-kit vergibt die Nummer. Die Kette endet an `6571bdd`
  bei `0036_rechtswerte`; es entstehen `0037_betriebsstrom` und `0038_betriebsstrom_bedingungen`. Die
  Tests nennen die Schritte nur über ihre Kennung (`tag`), nicht über die Nummer. Keine Datenanweisung.
- **Rechtswerte:** Dieser PR bringt keinen Rechtswert (keinen Satz, keinen Stichtag, keine Frist), also
  keinen neuen Parameter in `shared/law/`. Die Literaturspannen sind keine Rechtswerte und kommen nicht
  ins Register (Entwurf 4.3 letzter Absatz); sie stehen nur im Lexikon und als erlaubte Stellen mit
  Grund im Wächter `server/test/law-literals.test.ts`. Ins Regelverzeichnis (`shared/law/rules.ts`)
  kommt keine Regel: `rulesFor` nimmt jede Regel des Jahres in den Rechtsstand jeder Abrechnung auf
  (calc.ts, `legalBasis.rules`), und eine neue Regel änderte damit `legalBasis` jeder Abrechnung, auch
  ohne Betriebsstrom („Wer nichts einstellt, merkt nichts“). Die Norm steht am Hinweis und im Lexikon.
  Die neuen Dateien der Berechnung (`shared/operatingPower.ts`, `server/src/operatingPower.ts`) kommen
  in `ENGINE_FILES` des Wächters; die Daten der zitierten Entscheidungen stehen dort als erlaubte
  Stellen wie die in calc.ts (Task 1 Step 5, Task 5 Step 3).
- **Eingefrorener Eingang** (`server/src/legacy/{schema,write,migrate}.ts`) und `legacy/validate.ts`
  bleiben unverändert; die db.json kennt keinen Betriebsstrom.
- **Objektgrenze:** Ein Abzug zeigt nur auf eine Position desselben Objekts (`HeatingError` 400).
- **Rechtsaussagen:** Leitsatz und Rn. 14 von BGH, Urteil vom 03.06.2016, V ZR 166/15, am 05.10.2026 auf
  rewis.io gelesen: „In der Jahresabrechnung einer Wohnungseigentümergemeinschaft müssen die Kosten des
  Betriebsstroms der zentralen Heizungsanlage nach Maßgabe der Heizkostenverordnung verteilt werden; wird der Betriebsstrom nicht über einen Zwischenzähler, sondern
  über den allgemeinen Stromzähler erfasst, muss geschätzt werden, welcher Anteil an dem Allgemeinstrom
  hierauf entfällt.“ Rn. 14 nennt zwei zulässige Schätzgrundlagen: einen Bruchteil der
  Brennstoffkosten (mit den Literaturspannen, ohne eigene Festlegung) und eine Berechnung, „die auf dem
  Stromverbrauchswert der angeschlossenen Geräte und den (ggf. geschätzten) Heiztagen beruht“; die Wahl
  steht im Ermessen, „solange [kein] offenkundig ungeeigneter Maßstab“ gewählt wird. Die Pflicht folgt
  aus § 7 Abs. 2 HeizkostenV („die Kosten des Betriebsstromes“, Wortlaut am 05.10.2026 gelesen) und gilt
  damit für jeden Gebäudeeigentümer nach § 1 HeizkostenV, nicht nur in der WEG. § 2 Nr. 11 BetrKV
  (Beleuchtung) nennt nur Außenbeleuchtung und gemeinsam genutzte Gebäudeteile (gelesen 05.10.2026).
  Für den Warmwasseranteil gilt § 8 Abs. 2 HeizkostenV („entsprechend § 7 Abs. 2“) bzw. § 2 Nr. 5
  Buchst. a BetrKV (P-K3); verteilt wird nach § 7 Abs. 1 bzw. § 8 Abs. 1 HeizkostenV, Abs. 2 zählt nur
  die Kosten auf (P-K2).
- **Mietrecht (P-K4):** Für Mietverhältnisse hat der VIII. Senat selbst entschieden: BGH,
  Versäumnisurteil vom 20.02.2008, VIII ZR 27/07 (Gründe II.4: „Sofern es, wie hier, für die
  Heizungsanlage keinen Zwischenzähler gibt, ist eine Schätzung durch den Vermieter zulässig.“;
  Leitsatz 3: Bestreitet der Mieter den angesetzten Betrag, hat der Vermieter die Grundlagen seiner
  Schätzung darzulegen). V ZR 166/15 Rn. 13 zitiert diese Entscheidung selbst. Zitiert wird sie mit
  Leitsatz 3, ohne Randnummer. Die 5 %, die dort abgezogen waren, stehen nur im Tatbestand und sind keine
  Billigung eines Satzes. Ein Vermieter darf den Betriebsstrom auch selbst tragen und gar nicht umlegen
  (V ZR 166/15 Rn. 15 zu BGH VIII ZR 45/11); unzulässig ist nur, ihn mit dem Allgemeinstrom zu
  verteilen (P-K5).
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen deutsch; Nutzertexte siezen
  (`anrede.test.ts`). Server-Importe mit `.ts`, reine Typimporte mit `import type`, kein `enum`.
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port); in api.test.ts erledigen das `startServer`/`startServerIn`.
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0 (nie hinter
  `grep` prüfen). Commit-Nachrichten deutsch, mit `Refs #212`, und mit den Attribution-Zeilen der
  ausführenden Sitzung.

## Review Focus

1. **Der Allgemeinstrom ist mit „Einzelbeträge“ oder „laut Gemeinschaftsabrechnung“ verteilt** (ETW mit
   Hausgeld). Einen Abzug in gleicher Verteilung gibt es dann nicht. Erwartet: Die Schätzhilfe lehnt mit
   einem Satz ab, der sagt, wo der Abzug stattdessen hingehört; bei der Gemeinschaftsabrechnung verweist
   er auf die Pflicht der Gemeinschaft und auf die Prüfung der Hausgeldabrechnung und behauptet nicht,
   die Gemeinschaft erledige das (P-W4). Test in Task 4.
2. **Die Betriebsstrom-Position wird gelöscht, während ein Abzug auf sie zeigt.** Erwartet: 400 mit einem
   Satz, der den Abzug nennt, kein Datenbankfehler und kein stilles Mitlöschen (das änderte den
   Allgemeinstrom eines anderen Zeitraums). Die Sperre einer eingefrorenen Lieferung
   (`guardFrozenLink` in `remove`) bleibt davor erhalten. Test in Task 2.
3. **Der Abzug wird im Kostenformular bearbeitet** (Beschreibung, Betrag, Grundlage). Erwartet: Die
   Kennzeichnung bleibt, der Abzug gehört weiter zu seinem Betriebsstrom; das Formular liest Kennzeichnung,
   Verweis und Grundlage ein und schickt sie unverändert zurück. Ein Server, der das Feld nicht bekommt
   (alter Tab), lässt die Angabe stehen. Test in Task 2 (Server) und Task 6 (Rumpf des Formulars).
4. **Die geschätzten kWh liegen über dem Verbrauch der Stromrechnung** (Leistung in kW statt W, 24 h für
   den Brenner). Erwartet: 400 mit den beiden kWh im Satz, keine Position. Test in Task 3 und Task 4.
5. **Betriebsstrom in der Heizperiode `2025-05`, Abzug beim Allgemeinstrom `2026-01`** (eigene
   Heizperiode, Weg b oder d). Erwartet: keine Warnung, weil der Abzug zu der Position gehört und nicht
   zum Zeitraum; wird der Abzug gelöscht, erscheint die Warnung in der Abrechnung, die den Betriebsstrom
   verteilt. Test in Task 5.
6. **Die Schätzung wird ein Jahr später bestritten** (P-W1). Erwartet: An Betriebsstrom und Abzug steht
   die Grundlage der Schätzung mit allen Eingaben (Geräte mit Leistung, Laufzeit und Tagen, Heiztage,
   gemessene kWh oder Freitext, kWh und Betrag der Stromrechnung); das Kostenformular zeigt sie, der
   Rechenweg der Abrechnung nennt sie, der Ausdruck für den Mieter nicht. Wer den Betrag im Formular
   ändert, ändert die Grundlage selbst mit. Tests in Task 2, 4, 5 und 6.
7. **Der Vermieter schätzt nach einem Bruchteil der Brennstoffkosten** (P-W2). Erwartet: Er legt mit
   „Betrag selbst geschätzt“ beide Positionen an, oder er verknüpft einen von Hand erfassten Abzug im
   Kostenformular mit dem Betriebsstrom; dann keine Warnung. Ein unverknüpfter Handabzug lässt die Warnung
   stehen. Mietfuchs rechnet keinen Prozentsatz vor. Tests in Task 3, 4, 5 und 6.
8. **Der Allgemeinstrom steht in einer abgeschlossenen Abrechnung** (P-W3; eigene Heizperiode oder ein
   Allgemeinstrom des Vorjahres). Erwartet: Die Schätzhilfe lehnt mit 409 ab und legt nichts an. Ein Abzug,
   der dort nach dem Abschluss von Hand angelegt wurde, zählt nicht und ergibt die Warnung mit eigenem
   Satz („nicht gutgeschrieben“); ein Abzug, der im eingefrorenen Stand steht, zählt. Tests in Task 4 und
   Task 5.
9. **Die Anlage ist eine Wärmepumpe oder eine Stromheizung** (P-W5). Erwartet: keine Schätzhilfe, weder
   in der Karte noch über die Route (400); der Satz sagt, dass der Strom dort Brennstoff ist und als
   Brennstoffkosten in die Heizposition gehört (§ 7 Abs. 2 HeizkostenV). Bei Gas, Öl, Fernwärme usw.
   bleibt die Hilfe. Tests je Energieart in Task 3, 4 und 6.
10. **Rechtsaussagen in der Oberfläche** (P-K1 bis P-K5). Erwartet: jede Aussage zur Pflicht mit Norm oder
    Lexikonbegriff; Schlüssel nach § 7 Abs. 1 (nicht Abs. 2); Warmwasser mit § 8 Abs. 2 HeizkostenV und
    § 2 Nr. 5 Buchst. a BetrKV; VIII ZR 27/07 nur mit Leitsatz 3; „selbst tragen“ als zulässige Wahl.
    Tests in Task 1, 4, 5 und 6.
11. **Neue Prüfbedingungen und der Namenswächter.** Erwartet: Jede neue Bedingung endet auf eine bekannte
    Endung (`_known`, `_valid`; `db-errors.test.ts`, „Jede Prüfbedingung im Schema folgt der
    Namenskonvention“) und hat, wo die Endung den falschen Satz ergäbe, einen eigenen Satz in
    `OWN_CHECK_MESSAGES` (errors.ts). Test in Task 2.

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/glossary.ts`, `shared/guides.ts`, `server/test/law-literals.test.ts` | Begriff `operatingPower`, Satz in zwei Anleitungen, erlaubte Literaturspannen | 1 |
| `shared/types.ts` | `OperatingPower`, `OperatingPowerDevice`, `OperatingPowerDeduction`; `CostItem.operatingPower`, `.operatingPowerItemId`, `.operatingPowerBasis` | 2 |
| `server/src/db/schema.ts`, `server/drizzle/0037_betriebsstrom.sql`, `server/drizzle/0038_betriebsstrom_bedingungen.sql`, `meta/*` (erzeugt) | Spalten, Bedingungen | 2 |
| `server/src/db/errors.ts` | eigene Sätze der neuen `_valid`-Bedingungen | 2 |
| `server/src/db/read.ts`, `server/src/db/repository.ts` | Lesen, Schreiben, Prüfen, Löschsperre | 2 |
| `shared/operatingPower.ts` (neu) | Schätzung nach Leistung und Tagen, gemessen, selbst geschätzt; Ablehnung bei Wärmepumpe und Stromheizung | 3 |
| `server/src/db/operatingPower.ts` (neu), `server/src/index.ts` | Betriebsstrom und Abzug anlegen, Route | 4 |
| `server/src/operatingPower.ts` (neu), `server/src/snapshot.ts`, `server/src/calc.ts` | Abzüge im Schnappschuss, eingefrorener Stand, Befund, Hinweis, Rechenweg | 5 |
| `client/src/costForm.ts`, `client/src/components/OperatingPowerFields.tsx` (neu), `client/src/pages/Kosten.tsx`, `client/src/operatingPowerForm.ts` (neu), `client/src/components/OperatingPowerCard.tsx` (neu), `client/src/pages/Heizkosten.tsx` | Fragen am Kostenformular (Kennzeichnung, Verknüpfung, Grundlage), Karte „Betriebsstrom“ | 6 |
| `CHANGELOG.md`, `CLAUDE.md` | Doku | 7 |
| Tests: `server/test/glossary.test.ts`, `server/test/guides.test.ts`, `server/test/law-literals.test.ts`, `server/test/operating-power.test.ts` (neu), `server/test/db-betriebsstrom.test.ts` (neu), `server/test/db-errors.test.ts`, `server/test/migrations.test.ts`, `server/test/db-stock.test.ts`, `server/test/db-repository.test.ts`, `server/test/categories.test.ts`, `server/test/calc-betriebsstrom.test.ts` (neu), `server/test/api.test.ts`, `client/src/costForm.test.ts`, `client/src/operatingPowerForm.test.ts` (neu), `client/src/components/OperatingPowerCard.test.tsx` (neu), `client/src/components/OperatingPowerFields.test.tsx` (neu) | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

Namen genau so, nachgesehen im Code an `6571bdd` (Zeilennummern als Orientierung, sie wandern):

- `shared/heating.ts`: `HEATING_CATEGORY` (`'Heizung und Warmwasser'`).
- `shared/categories.ts`: `CATEGORIES` mit `'Beleuchtung/Allgemeinstrom'`.
- `shared/types.ts`: `CostItem` (ab Zeile 238) mit `heatingPart?` (`'fuel' | 'operating' | 'metering'`),
  `heatingTarget?`, `heatingPlantId?: string | null`, `fuelDeliveryId?: string | null` als letztem Feld;
  `PeriodKey` (Zeile 1264); `HeatingEnergy` (Zeile 1283, mit `'heatPump'` und `'electric'`);
  `HeatingMethod` (`'service' | 'self' | 'manual'`); `HeatingPlant`; `HeatingPeriodView` (Zeile 1669, mit
  `period`, `label`, `closed`, `items`); `CalcStep = { label: string; value: string; term?: TermId }`.
- `server/src/db/schema.ts`: `exactly`, `oneOf` (Datei-intern), `HEATING_PARTS`, `costItems` (ab Zeile
  968), letzte Spalte `heatingTarget`; letzte Bedingung zur Heizung
  `cost_items_fuel_delivery_category_valid` (nicht `…_category`). Bedingungsnamen enden nach
  `db-errors.test.ts` auf `_not_negative`, `_known`, `_is_json`, `_positive`, `_complete`, `_valid` oder
  `_with_property`.
- `server/src/db/errors.ts`: `OWN_CHECK_MESSAGES` (eigener Satz je Bedingung, deren Endung allein den
  falschen Satz ergäbe), `FIELD_NAMES`.
- `server/src/db/repository.ts`: `has`, `raw`, `merged`, `oneOfOrUndefined` (exportiert);
  `asOptionalText` (Zeile 86), `asNullableFilled`, `orNull` (Zeile 1600, Datei-intern); `mergeCostItem`
  (Zeile 337, letztes Feld `fuelDeliveryId`); `costItemRow` (letztes Feld `fuelDeliveryId`);
  `guardCostItem(db, before, after, body, options = {})` (Zeile 1122; der Parameter heißt `before`, am Ende
  `await guardCostItemHeating(…)` und `await guardFuelLink(db, before, after)`); `costItemCollection`
  (Zeile 1761; `remove` prüft zuerst `guardFrozenLink` und muss das behalten);
  `insertCostItemIn(tx, id, body, hints = {})`; `itemPeriodClosed(db, c)` (exportiert, Zeile 533);
  `closeSettlement(db, { id, propertyId, period, closedAt, sentAt, settlement })`; `HeatingError`
  (`status: 400 | 409`), `CrossPropertyError`; `createEntity`, `updateEntity`, `removeEntity`,
  `findEntity`, `createProperty`. `rewriteCostItemFamily` ruft `costItemCollection.remove` beim Aufteilen
  auf; die Sperre greift dort ebenso.
- `server/src/db/read.ts`: `readCostItems(db)` (Zeile 218; optionale Felder als
  `...(c.x !== null ? { x: c.x } : {})`, **nicht** mit `orUndefined`, sonst bricht die strenge Rundreise in
  `db-stock.test.ts`), `readHeatingPlants(db)`, `readStock(db)`.
- `server/src/db/heating.ts`: `createHeatingPlant(db, id, propertyId, body)` → `{ plant, assigned }`;
  `method: 'self'` lehnt sie ab („nur über die Einrichtung“), und die Bedingung
  `heating_plants_self_capture_complete` verlangt bei `self` eine Erfassung (`capture`).
- `server/src/db/heatingPeriodContext.ts`: `plantContext(db: Database, plantId)` → `PlantContext | null`,
  `heatingPeriodOf(ctx, text)` (wirft selbst `HeatingError(400)`, gibt nie `null`),
  `heatingPeriodClosed(db, ctx, h)`.
- `server/src/snapshot.ts`: `SnapshotCostItem` (Zeile 70, Pick), `Snapshot` (Zeile 415, letztes Feld
  `lawOverrides?`), `SnapshotSource`, `narrowToProperty`, `snapshotFor(source, propertyId, period)` (Zeile
  875; `narrowed.closedSettlements` trägt `itemTotals`), `heatingSnapshotFor(…)` (Zeile 957),
  `snapshotOfPeriod(source, period, previous)`.
- `server/src/calc.ts`: `noticeKinds` (Zeile 230), `itemSubject` (Zeile 462), `fmtCents` (Zeile 1663),
  `computeSettlement` (Zeile 1894) mit `warn` (Zeile 2122) und `items` (Zeile 2288); der Unteraufruf nach
  Weg b (um Zeile 6196) reicht `...snapshot` weiter und übernimmt die Hinweise ohne Doppel; die
  Rechenweg-Schritte einer Zeile entstehen um Zeile 4034 (`steps: CalcStep[]`); die Zeile `// Die
  Höchstdauer hat P gebildet (shared/period.ts); eingefroren wird sie hier.` (um Zeile 6386) steht hinter
  der Schleife zu `law.value-overridden` (PR 17).
- `shared/law/`: `register.ts`, `rules.ts` (`RULES`, `rulesFor`), `practice.ts`; `law-literals.test.ts`
  mit `PERCENT_PATTERNS`, `ENGINE_FILES`, `CODE_PATTERN` und `ALLOWED` (`{ file, match, reason }`).
- Server-Tests: `server/test/api.test.ts` mit `startServer()`, `s.api<T>(url, init)`, `s.base`,
  `s.stop()`, `jsonOf`, `errorFrom` und `jsonPost(body)` als `RequestInit` (Zeile 5968; `postJson` ist dort
  etwas anderes: `postJson(s, url, body)`); `migrations.test.ts` mit `VEROEFFENTLICHT`, letzter Eintrag
  `'0036_rechtswerte'`; `db-stock.test.ts` mit `NOT_IN_DB_JSON`; `db-repository.test.ts` mit „Die
  Verschmelzung erreicht jede Spalte des Schemas“.
- Client: `api`, `errorText`, `fmtEuro`, `parseEuro` (`client/src/api.ts`); `useToast()` liefert
  `(msg, kind?: 'ok' | 'error' | 'info') => void` (`client/src/components/feedback.tsx`); `Term`;
  `withProperty(path, propertyId)` (`client/src/property.tsx`); `client/src/costForm.ts` mit `ItemForm`
  (Feld `heatingPart: HeatingPart | ''`), `EMPTY_ITEM_FORM`, `itemToForm`, `draftOf`,
  `buildCostItemBody(form, units, period, tenancies?)` (gibt `costItemBody(draftOf(…), units, p.key)`
  zurück); die Auswahl „Teil der Heizkosten“ steht in `client/src/components/CostPeriodFields.tsx`, nicht
  in Kosten.tsx; Kosten.tsx lädt alle Positionen des Objekts (`items`, alle Zeiträume).
  `client/src/pages/Heizkosten.tsx`: `load` (useCallback) lädt Anlagen, Ansichten und Lieferungen, die
  Karten bekommen `onSaved={() => void load()}`; Positionen lädt die Seite noch nicht; `FuelCard` je
  Anlage und Heizperiode.

### Abgleich mit dem Code (Stand 6571bdd)

Gegenüber der ersten Fassung dieses Plans berichtigt:

| Stelle | Vorher im Plan | Jetzt |
|---|---|---|
| Migrationen | `0035_betriebsstrom`, `0036_betriebsstrom_bedingungen` | `0037_betriebsstrom`, `0038_betriebsstrom_bedingungen` (Kette endet bei `0036_rechtswerte`) |
| Bedingungsnamen | `cost_items_operating_power_included`, `…_deduction`, `…_link` | `…_included_valid`, `…_deduction_valid`, `…_link_valid`, `…_basis_valid`, je mit Satz in `OWN_CHECK_MESSAGES`; sonst bricht der Namenswächter in `db-errors.test.ts` |
| Einfügestelle der Bedingungen | hinter `cost_items_fuel_delivery_category` | hinter `cost_items_fuel_delivery_category_valid` |
| `readCostItems` | `orUndefined(…)` | bedingtes Ausbreiten wie die übrigen optionalen Felder |
| `costItemCollection.remove` | ganz ersetzt | Sperre **vor** dem vorhandenen `guardFrozenLink` ergänzt, der Rest bleibt |
| `guardCostItem` | Parameter `_before` | `before`; Aufruf nach `guardFuelLink` |
| Test „eigene Abrechnung“ | `set({ method: 'self' })` | `set({ method: 'self', capture: 'heatMeter' })` |
| api.test.ts | `postJson(body)` | `jsonPost(body)`; `s.stop()` |
| Kostenformular | Frage in Kosten.tsx hinter „Teil“ | eigene Komponente `OperatingPowerFields.tsx`, in Kosten.tsx neben `CostPeriodFields` |
| Toast | `toast(errorText(e))` | `toast(errorText(e), 'error')` |
| Heizkosten.tsx | `propertyItems`, `version`, `reload` | Positionen in `load` mitladen, `onBooked={() => void load()}` |
| Hinweis-Einfügestelle | „vor `const result`“ | vor `// Die Höchstdauer hat P gebildet …`, hinter der Schleife zu `law.value-overridden` |
| Wächter | nur drei Spannen | dazu `ENGINE_FILES` um die beiden neuen Dateien und die Daten der zitierten Entscheidungen |

Weicht der Code bei der Umsetzung davon ab, gilt der Code; die Namen dieses Plans bleiben, nur die
Einfügestelle wandert.

## Abweichungen vom Entwurf und Festlegungen dieses Plans

Der Entwurf beschreibt PR 15 in drei Sätzen (13 PR 15) und nennt kein Datenmodell (5.1 hat keine Zeile
für PR 15). Jede der folgenden Festlegungen hat dort keine Grundlage und ist hier begründet:

1. **Datenmodell (Festlegung).** `cost_items.operating_power` (`'included' | 'deduction'`, nullbar) und
   `cost_items.operating_power_item_id` (nullbar, `RESTRICT` auf `cost_items`). Begründung: Mietfuchs kann
   einer Heizposition nicht ansehen, ob sie Betriebsstrom ist und ob er im Allgemeinstrom steckt; beides
   ist eine Tatsache, die nur der Vermieter kennt. Die Verknüpfung macht den Abzug unabhängig vom
   Zeitraum (Review Focus 5). Einen Wert „eigener Zähler mit eigener Rechnung“ gibt es nicht: Dann ist
   nichts doppelt, und `null` sagt dasselbe. Dazu `cost_items.operating_power_basis` (Text, nullbar, nur
   neben einer Kennzeichnung): die Grundlage der Schätzung, Zeile für Zeile (P-W1). Text und nicht JSON,
   denn mit ihr wird nicht gerechnet; sie ist ein Beleg dafür, wie geschätzt wurde, wie ein
   Rechenweg, und der Vermieter darf sie im Kostenformular ergänzen. Sie gehört an **beide** Positionen,
   denn bestritten werden kann der Betriebsstrom wie der Abzug.
2. **„Ungekürzt“ wird als „nicht in gleicher Höhe abgezogen“ geprüft (Festlegung).** Der Entwurf nennt
   „der Allgemeinstrom ungekürzt umgelegt“. Geprüft wird je Betriebsstrom-Position mit `included`:
   Betrag + Σ der verknüpften Abzüge = 0. Ist der Abzug kleiner, verteilt die Abrechnung den Rest doppelt
   (der Text nennt den Betrag); ist er größer, trägt der Vermieter einen Teil des Allgemeinstroms selbst
   (zweiter Text desselben Codes, denn auch das ist „Geld landet anders als vermutlich gewollt“, die
   Stufe `warning` nach CLAUDE.md, #112). Ein Code, zwei Texte; die Stufe bleibt am Code.
3. **Euro-Betrag als Anteil an der Stromrechnung einschließlich Grundpreis (Festlegung im
   Schätzermessen).** Der Leitsatz verlangt zu schätzen, „welcher Anteil an dem Allgemeinstrom hierauf
   entfällt“. Mietfuchs rechnet Betrag der Allgemeinstrom-Position × geschätzte kWh ÷ kWh laut
   Stromrechnung, also **einschließlich eines anteiligen Grundpreises**. Ob der Grundpreis anteilig
   mitgeht, regelt keine Norm und keine Entscheidung; die Formel ist eine Festlegung im Schätzermessen,
   das Rn. 14 dem Abrechnenden lässt, und kein „offenkundig ungeeigneter Maßstab“. Dagegen ließe sich
   sagen, der Grundpreis fiele auch ohne Heizung an, die Heizung verursache also nur Arbeitspreis; dafür
   spricht, dass die Position nur den Rechnungsbetrag kennt und keinen Arbeitspreis. Der Rechenweg nennt
   die Festlegung deshalb ausdrücklich („des Rechnungsbetrags einschließlich Grundpreis“, Task 3), damit
   der Vermieter sie sieht und, wenn er nur den Arbeitspreis ansetzen will, beide Positionen im
   Kostenformular in gleicher Höhe ändern kann (sonst meldet Abweichung 2 die Differenz). kWh = Σ Leistung (W) × Laufzeit (h je Tag) × Heiztage ÷
   1.000 (Rn. 14: „Stromverbrauchswert der angeschlossenen Geräte und … Heiztage“). Laufzeit und Heiztage
   gibt der Vermieter ein; **es gibt keine Vorgabe**, denn jede Zahl wäre erfunden.
4. **Gemessen mit Zwischenzähler als zweiter Weg (Festlegung).** Der Leitsatz nennt den Zwischenzähler
   als den Fall ohne Schätzung. Steckt er hinter dem Hauszähler, ist der Strom trotzdem in der
   Stromrechnung und muss abgezogen werden. Die Hilfe nimmt dann die gemessenen kWh statt der Geräte.
   **Dritter Weg „Betrag selbst geschätzt“ (P-W2, Entwurf 0.12):** Euro-Betrag und Freitext „Grundlage
   der Schätzung“ (Pflicht); Mietfuchs gibt keinen Prozentsatz vor und rechnet keinen vor (Entwurf 16).
   Der Betrag darf den Betrag der Stromrechnung nicht übersteigen. Die Karte sagt, dass der BGH als
   Bruchteil einen der **Brennstoffkosten** nennt, nicht des Allgemeinstroms (Rn. 14).
   **Tage je Gerät (P-K8, Festlegung im Schätzermessen):** Jedes Gerät darf eigene Betriebstage haben
   (die Umwälzpumpe der Heizung nur in der Heizzeit, die Warmwasserpumpe das ganze Jahr); ohne Angabe
   gelten die Heiztage. Beim Kesseltausch im Jahr führt der Weg über zwei Buchungen mit Teil-Heiztagen
   oder über den Zwischenzähler; die Karte sagt das in einem Satz.
5. **Schlüssel des Betriebsstroms (Festlegung).** `self`: `heatingSystem`, Teil `operating`, Ziel `both`
   (Entwurf 8.6: Ziel `both` verteilt mit den Gewichten der Anlage). `manual`: Schlüssel und Angaben der
   Brennstoffposition derselben Heizperiode (Betriebsstrom gehört zu den Kosten des § 7 Abs. 2 und § 8
   Abs. 2 HeizkostenV und wird wie der Brennstoff verteilt, § 7 Abs. 1, § 8 Abs. 1); ohne
   Brennstoffposition lehnt die Hilfe ab, mit dem Satz „(§ 7 Abs. 1 und 2 HeizkostenV)“ (P-K2).
   `service`: keine Betriebsstrom-Position, denn der Messdienst verteilt ihn in seinen Beträgen; die Hilfe
   legt nur den Abzug an (ohne Verknüpfung), beschrieben als „Abzug Betriebsstrom Heizung (…), an
   Messdienst gemeldet“ (P-K9), und sagt, dass der Betrag dem Messdienst zu melden ist. Meldet der
   Vermieter ihn nicht, trägt er den Betriebsstrom selbst; das ist zulässig (V ZR 166/15 Rn. 15).
   **Wärmepumpe und Stromheizung (P-W5):** keine Schätzhilfe. Der Strom ist dort Brennstoff („Kosten der
   verbrauchten Brennstoffe“, § 7 Abs. 2 HeizkostenV; Entwurf 8.3) und gehört als Brennstoffkosten (Teil
   `fuel`) in die Heizposition; die Bedingung `…_included_valid` lässt `included` an `fuel` ohnehin
   nicht zu. Der Fall „Strom der Wärmepumpe läuft ohne eigenen Zähler über den Allgemeinstrom“ ist nicht
   Teil dieses Plans (Vorschlag für ein Issue, Task 7): Eine Schätzung nach Leistung und Laufzeit wäre
   für einen Verdichter kaum vertretbar, und § 12 Abs. 3 HeizkostenV verlangt ohnehin eine Erfassung:
   Wurde der Verbrauch aus Wärmepumpen am 01.10.2024 noch nicht erfasst, war sie bis zum Ablauf des
   30.09.2025 einzubauen, und die Verordnung gilt ab dem Abrechnungszeitraum danach (`hkv.heat-pump.capture`,
   PR 10; Wortlaut am 10.10.2026 auf gesetze-im-internet.de gelesen, R2-K6).
6. **Abzug in der Verteilung des Allgemeinstroms (Festlegung).** Der Abzug übernimmt Schlüssel,
   Zählertyp, Direktzuordnung, vereinbarte Anteile und Teilnehmer der Allgemeinstrom-Position; so mindert
   er jeden Anteil genau im Verhältnis. Bei `amounts` und `external` lehnt die Hilfe ab (Review Focus 1),
   mit je eigenem Satz: bei Einzelbeträgen „in den Beträgen selbst abziehen“, bei der
   Gemeinschaftsabrechnung der Verweis auf die Pflicht der Gemeinschaft und die Bitte, die
   Hausgeldabrechnung zu prüfen und sich sonst an die Verwaltung zu wenden (P-W4). Einen Weg zum Abziehen
   bei `external` gibt es in Mietfuchs nicht; der Satz verspricht deshalb keinen.
6a. **Abgeschlossener Zeitraum des Allgemeinstroms (P-W3).** Die Hilfe fragt neben der Heizperiode auch
   `itemPeriodClosed(db, general)` und lehnt mit 409 ab. Ein Abzug, der in einem abgeschlossenen Zeitraum
   steht, zählt im Befund nur, wenn er im eingefrorenen Stand mit seinem Betrag steht (`itemTotals` der
   abgeschlossenen Abrechnung); sonst hat er die Mieter nicht erreicht, und der Befund sagt das mit
   eigenem Satz. Ist der eingefrorene Stand nicht lesbar (`itemTotals` `null`), zählt der Abzug nicht:
   Der Hinweis zu viel ist hier der harmlosere Ausgang als eine stumme Doppelbelastung.
7. **Löschen gesperrt statt kaskadiert (Festlegung).** `RESTRICT` und ein Satz in `costItemCollection.remove`.
8. **Nicht in diesem Plan:** Ein Hinweis, wenn eine Zentralheizung **gar keinen** Betriebsstrom hat und
   der Allgemeinstrom ungekürzt verteilt wird (der Fall des BGH). Der Entwurf verlangt ihn nicht (10.1
   kennt nur `heating.operating-power-double`), und ohne Angabe des Vermieters wäre er bei jeder Anlage mit
   eigenem Stromvertrag falsch. Vorschlag für ein neues Issue (öffentlich, vor dem Anlegen nachfragen):
   „Betriebsstrom fehlt: Hinweis bei Zentralheizung ohne Betriebsstrom-Position“.
9. ~~Nicht in diesem Plan: ein dritter Weg „Betrag selbst geschätzt“.~~ **Gestrichen (P-W2).** Der Entwurf
   hat den Weg entschieden (0.12, Zeile Betriebsstrom); er steht jetzt in Abweichung 4 und in Task 3, 4
   und 6, dazu die Verknüpfung eines von Hand erfassten Abzugs im Kostenformular (Task 6).

---

### Task 1: Lexikon, Anleitungen und Wächter

Der Begriff `operatingPower` mit der Schätzung nach Leistung und Heiztagen als Beispiel und den
Literaturspannen als Literaturwerte, die der BGH wiedergibt, ohne einen festzulegen; je ein Satz in den Anleitungen „Mehrfamilienhaus“ und
„Messdienst“ (Entwurf 11.4). Die Spannen sind keine Rechtswerte, der Wächter bekommt sie als erlaubte
Stellen mit Grund.

**Files:**
- Modify: `shared/glossary.ts`, `shared/guides.ts`, `server/test/law-literals.test.ts`
- Test: `server/test/glossary.test.ts`, `server/test/guides.test.ts`

**Interfaces:**
- Consumes: `GLOSSARY`, `TermId`, `GUIDES`.
- Produces: `TermId` + `'operatingPower'`.

- [ ] **Step 1: Write the failing tests**

In `server/test/glossary.test.ts` anhängen:

```ts
// Heizung PR 15 (#212): Betriebsstrom, mit der Schätzung des BGH als Beispiel und den Spannen der
// Literatur nur als Literaturwerte ohne Festlegung des BGH (Entwurf 4.3 letzter Absatz).
test('Lexikon: Betriebsstrom nennt § 7 Abs. 2 HeizkostenV, das Urteil und rechnet das Beispiel richtig', () => {
  const t = GLOSSARY.operatingPower
  assert.match(t.norm ?? '', /§ 7 Abs\. 2, § 8 Abs\. 2 HeizkostenV/)
  // P-K3: Der Warmwasseranteil steht in § 8 Abs. 2 HeizkostenV und § 2 Nr. 5 Buchst. a BetrKV.
  assert.match(t.norm ?? '', /§ 2 Nr\. 4 Buchst\. a, Nr\. 5 Buchst\. a und Nr\. 11 BetrKV/)
  assert.match(t.norm ?? '', /V ZR 166\/15/)
  // P-K4: die Entscheidung des VIII. Senats für das Mietrecht, nur mit Leitsatz 3, ohne Randnummer.
  assert.match(t.norm ?? '', /BGH, Versäumnisurteil vom 20\.02\.2008, VIII ZR 27\/07 \(Leitsatz 3\)/)
  assert.doesNotMatch(`${t.norm} ${t.needed}`, /VIII ZR 27\/07, Rn\./)
  // 120 W × 6 h + 45 W × 24 h + 5 W × 24 h an 220 Tagen = 422,4 kWh; 422,4 / 3.000 von 1.050,00 €.
  assert.match(t.example, /422,4 kWh/)
  assert.match(t.example, /147,84 €/)
  // V ZR 166/15 Rn. 14: Der Bruchteil der Brennstoffkosten ist eine zulässige Schätzgrundlage; die
  // Prozentwerte gibt der BGH nur aus der Literatur wieder, ohne selbst einen festzulegen.
  assert.match(t.example, /lässt auch einen Bruchteil der Brennstoffkosten als Schätzgrundlage zu/)
  assert.match(t.example, /legt aber selbst keinen Wert fest/)
  assert.doesNotMatch(t.example, /nicht gebilligt/)
  assert.match(t.example, /einschließlich Grundpreis/)
  // P-K7: die vier Spannen mit ihren Autoren. „oder höchstens 5 %“ trifft kein Muster des Wächters
  // (law-literals.test.ts); wer daraus „… und höchstens 5 %“ macht, bekommt dort einen Treffer ohne
  // erlaubte Stelle. Der Wortlaut ist deshalb hier festgehalten.
  assert.match(t.example, /3–6 % Jennißen, 4–10 % Schmidt-Futterer\/Lammel, 8–10 % Wall oder höchstens 5 % Gies/)
  assert.match(t.needed, /offenkundig ungeeignet/)
  // P-K5: Der Vermieter darf ihn auch selbst tragen; unzulässig ist nur der Allgemeinstrom.
  assert.doesNotMatch(t.needed, /bei jeder Zentralheizung/)
  assert.match(t.needed, /oder Sie tragen ihn selbst; im Allgemeinstrom darf er nicht stehen/)
  // P-W1: aufbewahren, denn bei Bestreiten sind die Grundlagen darzulegen.
  assert.match(t.needed, /müssen Sie die Grundlagen Ihrer Schätzung darlegen \(BGH, Versäumnisurteil vom 20\.02\.2008, VIII ZR 27\/07, Leitsatz 3\)/)
  // P-W5: Bei Wärmepumpe und Stromheizung ist der Strom Brennstoff.
  assert.match(t.needed, /Wärmepumpe oder einer Stromheizung ist der Strom Brennstoff/)
})
```

In `server/test/guides.test.ts` anhängen:

```ts
test('Anleitungen: Betriebsstrom steht bei Mehrfamilienhaus und Messdienst, mit Norm (Heizung PR 15)', () => {
  for (const id of ['multiFamily', 'meteringService'] as const) {
    const c = GUIDES[id].caveats.find((x) => x.text.includes('Betriebsstrom'))
    if (!c) return assert.fail(`${id}: kein Satz zum Betriebsstrom`)
    // P-K3: Der Betriebsstrom geht auch in das Warmwasser (§ 8 Abs. 2 HeizkostenV).
    assert.match(c.norm ?? '', /§ 7 Abs\. 2, § 8 Abs\. 2 HeizkostenV; BGH, Urteil vom 03\.06\.2016, V ZR 166\/15/)
    // P-K5: selbst tragen ist zulässig; nur im Allgemeinstrom darf er nicht stehen.
    assert.match(c.text, /oder tragen ihn selbst/)
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/glossary.test.ts test/guides.test.ts`
Expected: FAIL, `Cannot read properties of undefined (reading 'norm')` bzw. „kein Satz zum Betriebsstrom“.

- [ ] **Step 3: Lexikon (`shared/glossary.ts`)**

In `GLOSSARY` hinter `heatingCostOrdinance` einfügen:

```ts
  // Heizung PR 15 (#212). Leitsatz und Rn. 13 bis 15 von BGH, Urteil vom 03.06.2016, V ZR 166/15, am
  // 05.10.2026 und 09.10.2026 gelesen; BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz 3
  // und Gründe II.4 am 09.10.2026 gelesen (Volltext ohne Randnummern, deshalb ohne Randnummer zitiert).
  // Die Spannen der Literatur sind keine Rechtswerte und stehen nur hier (Entwurf 4.3 letzter Absatz);
  // law-literals.test.ts nennt sie als erlaubte Stellen. „oder höchstens 5 %“ bewusst so (P-K7).
  operatingPower: {
    title: 'Betriebsstrom der Heizung',
    short: 'Der Strom für Brenner, Umwälzpumpe und Regelung einer Zentralheizung gehört zu den Heiz- und Warmwasserkosten und wird mit ihnen nach der Heizkostenverordnung verteilt, nicht als Allgemeinstrom. Hat er keinen eigenen Stromvertrag, steckt er in der Stromrechnung des Hauses; dann ist er dort herauszurechnen und abzuziehen.',
    example: 'Brenner 120 W an 6 Stunden am Tag, Umwälzpumpe 45 W und Regelung 5 W rund um die Uhr, an 220 Heiztagen: 158,4 + 237,6 + 26,4 = 422,4 kWh. Die Stromrechnung des Hauses nennt 3.000 kWh für 1.050,00 €; auf die Heizung entfallen 422,4 von 3.000 kWh, also 147,84 € (Anteil am Rechnungsbetrag einschließlich Grundpreis; das ist eine Festlegung im Schätzermessen, keine Vorgabe des Gesetzes). Diese 147,84 € stehen als Betriebsstrom bei den Heizkosten und als Abzug beim Allgemeinstrom, und die Mieter zahlen den Strom nur einmal. Der Bundesgerichtshof lässt auch einen Bruchteil der Brennstoffkosten als Schätzgrundlage zu und nennt dazu Werte aus der Literatur (3–6 % Jennißen, 4–10 % Schmidt-Futterer/Lammel, 8–10 % Wall oder höchstens 5 % Gies), legt aber selbst keinen Wert fest. Gemeint ist ein Bruchteil der Brennstoffkosten, nicht des Allgemeinstroms.',
    norm: '§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; § 2 Nr. 4 Buchst. a, Nr. 5 Buchst. a und Nr. 11 BetrKV; BGH, Urteil vom 03.06.2016, V ZR 166/15; BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07 (Leitsatz 3)',
    needed: 'Ja, wenn der Strom der Heizung über den Zähler des Hauses läuft: Dann gehört sein Anteil zu den Heizkosten, oder Sie tragen ihn selbst; im Allgemeinstrom darf er nicht stehen. Ohne Zwischenzähler ist der Anteil zu schätzen; das hat der Bundesgerichtshof auch für Mietverhältnisse entschieden. Welches Verfahren Sie wählen, liegt in Ihrem Ermessen, solange es nicht offenkundig ungeeignet ist; der Bundesgerichtshof nennt ausdrücklich das Verfahren nach Leistung der Geräte und Heiztagen und einen Bruchteil der Brennstoffkosten. Die Karte „Betriebsstrom“ rechnet nach Leistung und Heiztagen, nimmt den Zwischenzähler oder Ihren selbst geschätzten Betrag; einen Prozentsatz gibt Mietfuchs nicht vor. Bewahren Sie die Angaben auf: Bestreitet ein Mieter den Betrag, müssen Sie die Grundlagen Ihrer Schätzung darlegen (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz 3). Mietfuchs speichert sie an beiden Positionen. Bei einer Wärmepumpe oder einer Stromheizung ist der Strom Brennstoff, nicht Betriebsstrom; er gehört als Brennstoffkosten in die Heizposition (§ 7 Abs. 2 HeizkostenV).',
  },
```

- [ ] **Step 4: Anleitungen (`shared/guides.ts`)**

In `GUIDE_DATA.multiFamily.caveats` und `GUIDE_DATA.meteringService.caveats` je als letzten Eintrag:

`multiFamily`:

```ts
      { text: 'Den Strom für Brenner, Umwälzpumpe und Regelung der Zentralheizung (Betriebsstrom) verteilen Sie mit den Heiz- und Warmwasserkosten oder tragen ihn selbst; als Allgemeinstrom dürfen Sie ihn nicht verteilen. Läuft er über den Stromzähler des Hauses, schätzen Sie ihn und ziehen ihn beim Allgemeinstrom ab; die Karte „Betriebsstrom“ auf der Seite Heizkosten rechnet das nach Leistung und Heiztagen vor oder nimmt Ihren selbst geschätzten Betrag und legt beide Positionen an.', norm: '§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15' },
```

`meteringService`:

```ts
      { text: 'Melden Sie dem Messdienst auch den Betriebsstrom der Heizung (Brenner, Umwälzpumpe, Regelung), damit er ihn mit den Heiz- und Warmwasserkosten verteilt, oder tragen ihn selbst; als Allgemeinstrom dürfen Sie ihn nicht verteilen. Läuft er über den Stromzähler des Hauses, ziehen Sie denselben Betrag beim Allgemeinstrom ab; die Karte „Betriebsstrom“ auf der Seite Heizkosten schätzt ihn nach Leistung und Heiztagen und legt den Abzug an.', norm: '§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15' },
```

(`terms` beider Anleitungen um `'operatingPower'` ergänzen.)

- [ ] **Step 5: Wächter (`server/test/law-literals.test.ts`)**

In `ALLOWED` anhängen:

```ts
  { file: 'shared/glossary.ts', match: '3–6 %', reason: 'Literaturwert (Jennißen), vom BGH in V ZR 166/15 Rn. 14 wiedergegeben; der BGH lässt den Bruchteil der Brennstoffkosten als Schätzgrundlage zu, legt aber keinen Wert fest; kein Rechtswert (Entwurf 4.3)' },
  { file: 'shared/glossary.ts', match: '4–10 %', reason: 'Literaturwert (Schmidt-Futterer/Lammel), vom BGH in V ZR 166/15 Rn. 14 wiedergegeben, ohne eigene Festlegung; kein Rechtswert (Entwurf 4.3)' },
  { file: 'shared/glossary.ts', match: '8–10 %', reason: 'Literaturwert (Wall), vom BGH in V ZR 166/15 Rn. 14 wiedergegeben, ohne eigene Festlegung; kein Rechtswert (Entwurf 4.3)' },
```

„höchstens 5 %“ (Gies) bekommt **keinen** Eintrag: In der Fassung „oder höchstens 5 %“ trifft es kein
Muster, und eine erlaubte Stelle ohne Treffer ist ein Fehler („erlaubte Stelle nicht mehr da“). Der
Lexikontest aus Step 1 hält den Wortlaut fest (P-K7).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/glossary.test.ts test/guides.test.ts test/law-literals.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS. Prüft `guides.test.ts` zitierte Beschriftungen nur in Schritten und Ergebnis, nicht in
`caveats` (Stand PR 1); „Betriebsstrom“ in Anführungszeichen steht ab Task 6 als Überschrift der Karte
ohnehin in der Oberfläche.

- [ ] **Step 7: Commit**

```bash
git add shared/glossary.ts shared/guides.ts server/test/law-literals.test.ts server/test/glossary.test.ts server/test/guides.test.ts
git commit -m "Lexikon und Anleitungen: Betriebsstrom der Heizung

Schätzung nach Leistung und Heiztagen als Beispiel; der Bruchteil der
Brennstoffkosten als zulässige Schätzgrundlage, die Spannen der Literatur
ohne Festlegung des BGH (V ZR 166/15 Rn. 14).

Refs #212"
```

---

### Task 2: Datenmodell, Migrationen, Lesen, Schreiben und Prüfen

**Files:**
- Modify: `shared/types.ts`, `server/src/db/schema.ts`, `server/src/db/errors.ts`, `server/src/db/read.ts`, `server/src/db/repository.ts`, `server/test/migrations.test.ts`, `server/test/db-stock.test.ts`, `server/test/db-repository.test.ts`, `server/test/db-errors.test.ts`, `server/test/categories.test.ts`
- Create: `server/drizzle/0037_betriebsstrom.sql`, `server/drizzle/0038_betriebsstrom_bedingungen.sql`, `server/drizzle/meta/0037_snapshot.json`, `server/drizzle/meta/0038_snapshot.json` (alle erzeugt)
- Test: `server/test/db-betriebsstrom.test.ts` (neu)

**Interfaces:**
- Consumes: `costItems`, `oneOf`, `exactly` (schema.ts); `OWN_CHECK_MESSAGES` (errors.ts); `mergeCostItem`, `costItemRow`, `guardCostItem`, `costItemCollection`, `guardFrozenLink`, `HeatingError`, `merged`, `oneOfOrUndefined`, `asOptionalText`, `orNull` (repository.ts); `HEATING_CATEGORY`.
- Produces:
  - `shared/types.ts`: `type OperatingPower = 'included' | 'deduction'`, `type OperatingPowerDevice = { label: string; watts: number; hoursPerDay: number; days?: number | null }`, `type OperatingPowerDeduction = { id; itemId: string | null; period: PeriodKey; description; amountCents; closed: { label: string; credited: boolean } | null }`; `CostItem.operatingPower?: OperatingPower`, `CostItem.operatingPowerItemId?: string`, `CostItem.operatingPowerBasis?: string`
  - `server/src/db/schema.ts`: `OPERATING_POWER`, Spalten `costItems.operatingPower`, `costItems.operatingPowerItemId`, `costItems.operatingPowerBasis`
  - `shared/operatingPower.ts` (nur die Konstante, die Rechnung folgt in Task 3): `GENERAL_POWER_CATEGORY = 'Beleuchtung/Allgemeinstrom'`
  - repository.ts: `guardOperatingPower(db: Executor, before: CostItem | null, after: CostItem): Promise<void>` (Datei-intern, aufgerufen am Ende von `guardCostItem`)

- [ ] **Step 1: Write the failing tests**

`server/test/db-betriebsstrom.test.ts`:

```ts
// Betriebsstrom der Heizung (Heizung PR 15, #212): die zwei Spalten an cost_items, ihre Bedingungen und
// die Prüfungen beim Schreiben und Löschen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { createEntity, createProperty, CrossPropertyError, findEntity, HeatingError, removeEntity, updateEntity } from '../src/db/repository.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-betriebsstrom-'))

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

const fieldOf = (entity: unknown, key: string): unknown => (entity !== null && typeof entity === 'object' ? Reflect.get(entity, key) : undefined)
const heizung = (over: Record<string, unknown> = {}) => ({
  propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Betriebsstrom Heizung',
  amountCents: 14784, key: 'area', heatingPart: 'operating', operatingPower: 'included', ...over,
})
const abzug = (itemId: string | null, over: Record<string, unknown> = {}) => ({
  propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Abzug Betriebsstrom Heizung',
  amountCents: -14784, key: 'area', operatingPower: 'deduction', operatingPowerItemId: itemId, ...over,
})

test('Kette: die Schritte betriebsstrom und betriebsstrom_bedingungen bringen drei nullbare Spalten, jeder Bestand bleibt NULL', async () => {
  const dir = tempDir()
  try {
    const connection = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_betriebsstrom'))
    if (bis < 0) assert.fail('Schritt …_betriebsstrom fehlt')
    applyMigrations(connection, migrations.slice(0, bis))
    connection.exec(`INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key) VALUES ('alt', 'objekt-1', '2025-01', 'Beleuchtung/Allgemeinstrom', 'Strom', 105000, 'area')`)
    applyMigrations(connection, migrations)
    assert.deepEqual(connection.rows("SELECT operating_power, operating_power_item_id, operating_power_basis FROM cost_items WHERE id = 'alt'"), [[null, null, null]])
    assert.deepEqual(connection.rows('PRAGMA foreign_key_check'), [])
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Prüfbedingungen: Betriebsstrom nur an Heizkosten (Teil Betrieb), Abzug nur am Allgemeinstrom und negativ, Verweis nur am Abzug', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    const insert = (id: string, category: string, amount: number, extra: string, values: string) =>
      `INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key${extra}) VALUES ('${id}', 'objekt-1', '2025-01', '${category}', 'x', ${amount}, 'area'${values})`
    assert.equal(rejects(c, insert('bs', 'Heizung und Warmwasser', 14784, ', heating_part, operating_power', ", 'operating', 'included'")), null)
    assert.match(rejects(c, insert('a', 'Heizung und Warmwasser', 1, ', heating_part, operating_power', ", 'fuel', 'included'")) ?? '', /cost_items_operating_power_included_valid/)
    assert.match(rejects(c, insert('b', 'Grundsteuer', 1, ', operating_power', ", 'included'")) ?? '', /cost_items_operating_power_included_valid/)
    assert.match(rejects(c, insert('d', 'Beleuchtung/Allgemeinstrom', 100, ', operating_power', ", 'deduction'")) ?? '', /cost_items_operating_power_deduction_valid/)
    assert.match(rejects(c, insert('e', 'Gebäudereinigung', -100, ', operating_power', ", 'deduction'")) ?? '', /cost_items_operating_power_deduction_valid/)
    assert.match(rejects(c, insert('f', 'Beleuchtung/Allgemeinstrom', -100, ', operating_power_item_id', ", 'bs'")) ?? '', /cost_items_operating_power_link_valid/)
    assert.match(rejects(c, insert('g', 'Heizung und Warmwasser', 1, ', operating_power', ", 'sonst'")) ?? '', /cost_items_operating_power_known/)
    // P-W1: Eine Grundlage der Schätzung gibt es nur an einer gekennzeichneten Position.
    assert.match(rejects(c, insert('i', 'Grundsteuer', 1, ', operating_power_basis', ", 'Grundlage'")) ?? '', /cost_items_operating_power_basis_valid/)
    assert.equal(rejects(c, insert('h', 'Beleuchtung/Allgemeinstrom', -14784, ', operating_power, operating_power_item_id, operating_power_basis', ", 'deduction', 'bs', 'Pumpe: 45 W × 24 h × 220 Tage = 237,6 kWh'")), null)
    // RESTRICT: Der Betriebsstrom lässt sich nicht löschen, solange der Abzug auf ihn zeigt.
    assert.match(rejects(c, "DELETE FROM cost_items WHERE id = 'bs'") ?? '', /FOREIGN KEY/)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Schreiben: Betriebsstrom und Abzug werden gelesen, wie sie gespeichert sind', async () => {
  await withDatabase(async (opened) => {
    const bs = await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    assert.equal(fieldOf(bs, 'operatingPower'), 'included')
    const ab = await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs', { operatingPowerBasis: 'Pumpe: 45 W × 24 h × 220 Tage = 237,6 kWh' })))
    assert.deepEqual([fieldOf(ab, 'operatingPower'), fieldOf(ab, 'operatingPowerItemId'), fieldOf(ab, 'operatingPowerBasis')], ['deduction', 'bs', 'Pumpe: 45 W × 24 h × 220 Tage = 237,6 kWh'])
    const ohne = await opened.write((db) => createEntity(db, 'costItems', 'gs', { propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area' }))
    // Ohne Angabe fehlen die Schlüssel ganz (die Rundreise in db-stock.test.ts vergleicht streng).
    assert.deepEqual(['operatingPower', 'operatingPowerItemId', 'operatingPowerBasis'].filter((k) => Object.hasOwn(Object(ohne), k)), [])
  })
})

test('Review Focus 3: der Abzug bleibt gekennzeichnet, wenn ein alter Tab ihn ohne die Felder speichert', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs', { operatingPowerBasis: 'Grundlage' })))
    await opened.write((db) => updateEntity(db, 'costItems', 'ab', { description: 'Abzug Betriebsstrom 2025', amountCents: -15000 }))
    const ab = await opened.read((db) => findEntity(db, 'costItems', 'ab'))
    assert.deepEqual([fieldOf(ab, 'operatingPower'), fieldOf(ab, 'operatingPowerItemId'), fieldOf(ab, 'operatingPowerBasis'), fieldOf(ab, 'amountCents')], ['deduction', 'bs', 'Grundlage', -15000])
  })
})

test('P-W1: die Grundlage der Schätzung lässt sich ändern und leeren; ohne Kennzeichnung lehnt der Server mit Satz ab', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung({ operatingPowerBasis: 'alt' })))
    await opened.write((db) => updateEntity(db, 'costItems', 'bs', { operatingPowerBasis: 'neu, mit Typenschild' }))
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'bs')), 'operatingPowerBasis'), 'neu, mit Typenschild')
    await opened.write((db) => updateEntity(db, 'costItems', 'bs', { operatingPowerBasis: null }))
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'bs')), 'operatingPowerBasis'), undefined)
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'gs', { propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area', operatingPowerBasis: 'x' })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Grundlage der Schätzung/.test(e.message))
  })
})

test('P-W2: ein von Hand erfasster Abzug lässt sich nachträglich mit dem Betriebsstrom verknüpfen und wieder lösen', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    await opened.write((db) => createEntity(db, 'costItems', 'hand', { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Abzug Heizstrom 5 % der Brennstoffkosten', amountCents: -14784, key: 'area' }))
    await opened.write((db) => updateEntity(db, 'costItems', 'hand', { operatingPower: 'deduction', operatingPowerItemId: 'bs', operatingPowerBasis: '5 % der Brennstoffkosten 2025 (2.956,80 €)' }))
    const hand = await opened.read((db) => findEntity(db, 'costItems', 'hand'))
    assert.deepEqual([fieldOf(hand, 'operatingPower'), fieldOf(hand, 'operatingPowerItemId')], ['deduction', 'bs'])
    await opened.write((db) => updateEntity(db, 'costItems', 'hand', { operatingPower: null, operatingPowerItemId: null, operatingPowerBasis: null }))
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'hand')), 'operatingPower'), undefined)
  })
})

test('Prüfen: ein Abzug zeigt nur auf Betriebsstrom desselben Objekts, der Betriebsstrom verliert die Kennzeichnung nicht unter einem Abzug', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ description: 'Gas', heatingPart: 'fuel', operatingPower: null })))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x1', abzug('gas'))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /nicht als Betriebsstrom gekennzeichnet/.test(e.message))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x2', abzug('fehlt'))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /gibt es nicht/.test(e.message))
    await opened.write((db) => createProperty(db, 'objekt-2', { name: 'Zweites Haus' }))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x3', abzug('bs', { propertyId: 'objekt-2' }))),
      (e: unknown) => e instanceof CrossPropertyError && /gehört zu einem anderen Objekt/.test(e.message))
    await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs')))
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'bs', { operatingPower: null })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Abzug „Abzug Betriebsstrom Heizung“/.test(e.message))
  })
})

test('Review Focus 2: Betriebsstrom mit Abzug lässt sich nicht löschen; mit einem Satz statt eines Datenbankfehlers', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs')))
    await assert.rejects(opened.write((db) => removeEntity(db, 'costItems', 'bs')),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /„Abzug Betriebsstrom Heizung“/.test(e.message) && /Löschen Sie zuerst den Abzug/.test(e.message))
    assert.equal(await opened.write((db) => removeEntity(db, 'costItems', 'ab')), true)
    assert.equal(await opened.write((db) => removeEntity(db, 'costItems', 'bs')), true)
  })
})
```

In `server/test/db-errors.test.ts` anhängen (nach dem Muster „Lieferungen: jede Bedingung …“, mit den
dort vorhandenen Helfern `withDatabase`, `messageOfFailure` und `sql`):

```ts
test('Betriebsstrom: jede Bedingung, deren Endung allein den falschen Satz ergäbe, hat ihren eigenen (Heizung PR 15)', async () => {
  // Die Schreibprüfung in repository.ts fängt das vorher ab; die Bedingungen sind das Netz darunter.
  await withDatabase(async (opened) => {
    const run = (statement: string) => messageOfFailure(opened, () => opened.write((db) => db.run(sql.raw(statement))))
    const insert = (id: string, category: string, amount: number, extra: string, values: string) =>
      `INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key${extra}) VALUES ('${id}', 'objekt-1', '2025-01', '${category}', 'x', ${amount}, 'area'${values})`
    const included = await run(insert('a', 'Grundsteuer', 1, ', operating_power', ", 'included'"))
    assert.match(included, /Betriebsstrom gibt es nur bei der Kostenart „Heizung und Warmwasser“/, included)
    const deduction = await run(insert('b', 'Beleuchtung/Allgemeinstrom', 100, ', operating_power', ", 'deduction'"))
    assert.match(deduction, /Abzug des Betriebsstroms/, deduction)
    // Ein Verweis auf eine vorhandene Position, damit nicht der Fremdschlüssel antwortet.
    await opened.write((db) => db.run(sql.raw(insert('bs', 'Heizung und Warmwasser', 1, ', heating_part, operating_power', ", 'operating', 'included'"))))
    const link = await run(insert('c', 'Beleuchtung/Allgemeinstrom', -100, ', operating_power_item_id', ", 'bs'"))
    assert.match(link, /Nur ein Abzug/, link)
    const basis = await run(insert('d', 'Grundsteuer', 1, ', operating_power_basis', ", 'x'"))
    assert.match(basis, /Grundlage der Schätzung/, basis)
    for (const text of [included, deduction, link, basis]) assert.doesNotMatch(text, /JJJJ-MM/, text)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-betriebsstrom.test.ts test/db-errors.test.ts`
Expected: FAIL, „Schritt …_betriebsstrom fehlt“, Prüfungen, die nicht ablehnen, und die
Rückfallmeldung statt der eigenen Sätze.

- [ ] **Step 3: Typen (`shared/types.ts`)**

Ans Dateiende:

```ts
// ---------- Betriebsstrom der Heizung (Heizung PR 15, #212) ----------

// An einer Position „Heizung und Warmwasser“ heißt `included`: Dieser Betriebsstrom (Brenner,
// Umwälzpumpe, Regelung) steckt auch in der Stromrechnung des Allgemeinstroms, weil er über den Zähler
// des Hauses läuft, gemessen mit Zwischenzähler oder geschätzt. An einer Position
// „Beleuchtung/Allgemeinstrom“ heißt `deduction`: der Abzug dieses Stroms. Ohne Angabe ist eine
// Position weder das eine noch das andere.
export type OperatingPower = 'included' | 'deduction'

// Ein Gerät der Heizung für die Schätzung nach Leistung und Heiztagen (BGH, Urteil vom 03.06.2016,
// V ZR 166/15, Rn. 14: „Stromverbrauchswert der angeschlossenen Geräte und … Heiztage“). `days`: eigene
// Betriebstage des Geräts (P-K8, etwa die Warmwasserpumpe das ganze Jahr); fehlt die Angabe, gelten die
// Heiztage.
export type OperatingPowerDevice = { label: string; watts: number; hoursPerDay: number; days?: number | null }

// Ein Abzug beim Allgemeinstrom, wie der Schnappschuss ihn führt: aus allen Zeiträumen des Objekts,
// denn er gehört zu der Betriebsstrom-Position, auf die er zeigt, und nicht zum Zeitraum. `itemId` ist
// null bei einer Anlage mit Messdienst, dessen Beträge den Betriebsstrom enthalten. `closed` (P-W3):
// `null`, wenn sein Zeitraum offen ist; sonst die abgeschlossene Abrechnung und ob der Abzug im
// eingefrorenen Stand mit seinem Betrag steht, also den Mietern gutgeschrieben wurde.
export type OperatingPowerDeduction = {
  id: string
  itemId: string | null
  period: PeriodKey
  description: string
  amountCents: number
  closed: { label: string; credited: boolean } | null
}
```

`CostItem` bekommt als letzte Felder (hinter `fuelDeliveryId`):

```ts
  // Betriebsstrom der Heizung (Heizung PR 15): siehe `OperatingPower`. `operatingPowerItemId` nur am
  // Abzug: die Betriebsstrom-Position, zu der er gehört. `operatingPowerBasis` (P-W1): die Grundlage
  // der Schätzung, Zeile für Zeile, an Betriebsstrom und Abzug; bestreitet ein Mieter den Betrag, muss
  // der Vermieter sie darlegen (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz 3).
  operatingPower?: OperatingPower
  operatingPowerItemId?: string
  operatingPowerBasis?: string
```

- [ ] **Step 4: Erster Schritt: Spalten (`server/src/db/schema.ts`)**

Den Typimport aus `'../../../shared/types.ts'` um `OperatingPower` ergänzen und aus
`'drizzle-orm/sqlite-core'` um `type AnySQLiteColumn`. Neben `HEATING_PARTS` (PR 3):

```ts
export const OPERATING_POWER = exactly<OperatingPower>()(['included', 'deduction'] as const)
```

In `costItems` als letzte Spalten (hinter `heatingTarget`):

```ts
    // Betriebsstrom der Heizung (Heizung PR 15, #212). `RESTRICT` auf die eigene Tabelle: Ein
    // Betriebsstrom mit Abzug wird nicht still gelöscht, denn der Abzug mindert den Allgemeinstrom
    // eines womöglich anderen Zeitraums (repository.ts lehnt mit einem Satz ab).
    operatingPower: text('operating_power', { enum: OPERATING_POWER }),
    operatingPowerItemId: text('operating_power_item_id').references((): AnySQLiteColumn => costItems.id, { onDelete: 'restrict' }),
    // Die Grundlage der Schätzung (P-W1), Zeile für Zeile. Text und kein JSON: Gerechnet wird damit
    // nicht, sie belegt, wie geschätzt wurde.
    operatingPowerBasis: text('operating_power_basis'),
```

Run: `npm --prefix server run db:generate -- --name betriebsstrom`
Expected: `server/drizzle/0037_betriebsstrom.sql` mit drei Zeilen `ALTER TABLE \`cost_items\` ADD
\`operating_power\` text;`, `ALTER TABLE \`cost_items\` ADD \`operating_power_item_id\` text REFERENCES
cost_items(id);` und `ALTER TABLE \`cost_items\` ADD \`operating_power_basis\` text;` **ohne** `__new_`.
Steht ein Neubau darin, Datei, Journal-Eintrag und Momentaufnahme löschen und nur die Spalten erzeugen.
Fragt drizzle-kit nach einer Umbenennung, ist die Antwort „create“. Heißt die Datei nicht `0037_…`, ist
die Kette seit `6571bdd` gewachsen; dann gilt die Nummer, die drizzle-kit vergibt.

- [ ] **Step 5: Zweiter Schritt: Bedingungen**

In der Bedingungsliste von `costItems` hinter `cost_items_fuel_delivery_category_valid` (PR 7). Die
Namen enden auf `_known` bzw. `_valid`, sonst bricht „Jede Prüfbedingung im Schema folgt der
Namenskonvention“ (db-errors.test.ts):

```ts
    // Betriebsstrom (Heizung PR 15): nur an Heizkosten mit Teil „Betrieb“ oder ohne Teil; der Abzug nur
    // am Allgemeinstrom und als Gutschrift; ein Verweis nur am Abzug; eine Grundlage nur an einer
    // gekennzeichneten Position (P-W1).
    oneOf('cost_items_operating_power_known', 'operating_power', OPERATING_POWER),
    check('cost_items_operating_power_included_valid', sql.raw(`"operating_power" IS NOT 'included' OR ("category" = 'Heizung und Warmwasser' AND ("heating_part" IS NULL OR "heating_part" = 'operating'))`)),
    check('cost_items_operating_power_deduction_valid', sql.raw(`"operating_power" IS NOT 'deduction' OR ("category" = 'Beleuchtung/Allgemeinstrom' AND "amount_cents" < 0)`)),
    check('cost_items_operating_power_link_valid', sql.raw(`"operating_power_item_id" IS NULL OR "operating_power" = 'deduction'`)),
    check('cost_items_operating_power_basis_valid', sql.raw(`"operating_power_basis" IS NULL OR "operating_power" IS NOT NULL`)),
```

Run: `npm --prefix server run db:generate -- --name betriebsstrom_bedingungen`
Expected: `server/drizzle/0038_betriebsstrom_bedingungen.sql` mit `PRAGMA foreign_keys=OFF`, Neubau
`__new_cost_items` samt `INSERT INTO … SELECT` mit den drei neuen Spalten, `DROP TABLE`, `RENAME`, den
Indizes, `PRAGMA foreign_keys=ON`. Prüfen:

Run: `grep -c '__new_cost_items' server/drizzle/*_betriebsstrom_bedingungen.sql && grep -c 'operating_power' server/drizzle/*_betriebsstrom_bedingungen.sql`
Expected: eine Zahl ≥ 3, dann eine Zahl ≥ 8.

In `server/src/db/errors.ts`, `OWN_CHECK_MESSAGES`, hinter `cost_items_fuel_delivery_category_valid`
(die Endung `_valid` allein spräche von einem Monat in der Form JJJJ-MM):

```ts
  // Betriebsstrom (Heizung PR 15).
  cost_items_operating_power_included_valid: 'Betriebsstrom gibt es nur bei der Kostenart „Heizung und Warmwasser“ mit dem Teil „Betrieb“ oder ohne Teil.',
  cost_items_operating_power_deduction_valid: 'Ein Abzug des Betriebsstroms gehört zur Kostenart „Beleuchtung/Allgemeinstrom“ und hat einen negativen Betrag.',
  cost_items_operating_power_link_valid: 'Nur ein Abzug beim Allgemeinstrom zeigt auf eine Betriebsstrom-Position. Bitte laden Sie die Seite neu.',
  cost_items_operating_power_basis_valid: 'Eine Grundlage der Schätzung gibt es nur bei Betriebsstrom oder seinem Abzug.',
```

- [ ] **Step 6: Marken eintragen**

Run:

```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag.includes('betriebsstrom')) console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```

Expected: zwei Zeilen. In `server/test/migrations.test.ts` in `VEROEFFENTLICHT` hinter
`'0036_rechtswerte'` einfügen, darüber:

```ts
  // Heizung PR 15 (#212): Betriebsstrom, Spalten und Bedingungen. Wird vor dem Merge ein anderer PR
  // davor eingereiht, werden beide Schritte neu erzeugt und die Marken hier ersetzt (wie 0036 bei PR 17).
```

- [ ] **Step 7: Konstante der Kostenart (`shared/operatingPower.ts`, neu)**

```ts
// Betriebsstrom der Heizung (Heizung PR 15, #212): die Rechnung der Schätzhilfe, für Formular und
// Server dieselbe. Die Rechnung selbst folgt in Task 3.

// Die Kostenart des Allgemeinstroms (§ 2 Nr. 11 BetrKV, Beleuchtung). Dieselbe Zeichenkette wie in
// shared/categories.ts; categories.test.ts hält beide zusammen.
export const GENERAL_POWER_CATEGORY = 'Beleuchtung/Allgemeinstrom'
```

In `server/test/categories.test.ts` anhängen:

```ts
test('Betriebsstrom: die Kostenart des Abzugs steht in der Liste der Kostenarten (Heizung PR 15)', () => {
  assert.ok(CATEGORIES.includes(GENERAL_POWER_CATEGORY))
})
```

(Import `import { GENERAL_POWER_CATEGORY } from '../../shared/operatingPower.ts'`; `CATEGORIES` ist dort
schon importiert, sonst aus `'../../shared/categories.ts'`.)

- [ ] **Step 8: Lesen und Schreiben**

`server/src/db/read.ts`, in `readCostItems` hinter dem letzten optionalen Feld (`fuelDeliveryId`, PR 7),
in derselben Form wie die übrigen optionalen Felder (nicht `orUndefined`: Ein Schlüssel mit
`undefined` bräche die strenge Rundreise in db-stock.test.ts):

```ts
      // Betriebsstrom (Heizung PR 15): ebenso nur, wenn es die Angabe gibt.
      ...(c.operatingPower !== null ? { operatingPower: c.operatingPower } : {}),
      ...(c.operatingPowerItemId !== null ? { operatingPowerItemId: c.operatingPowerItemId } : {}),
      ...(c.operatingPowerBasis !== null ? { operatingPowerBasis: c.operatingPowerBasis } : {}),
```

`server/src/db/repository.ts`: `OPERATING_POWER` aus `./schema.ts` importieren. In `mergeCostItem` hinter
dem letzten Feld (`fuelDeliveryId`):

```ts
    // Betriebsstrom (Heizung PR 15). `null` leert; fehlt das Feld, bleibt die Angabe (Review Focus 3,
    // ein alter Tab). Eine leere Grundlage gilt als keine.
    operatingPower: merged(body, 'operatingPower', current.operatingPower, (v) => oneOfOrUndefined(OPERATING_POWER, v)),
    operatingPowerItemId: merged(body, 'operatingPowerItemId', current.operatingPowerItemId, asOptionalText),
    operatingPowerBasis: merged(body, 'operatingPowerBasis', current.operatingPowerBasis, (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)),
```

In `costItemRow` hinter dem letzten Feld (`fuelDeliveryId`):

```ts
  operatingPower: orNull(c.operatingPower), operatingPowerItemId: orNull(c.operatingPowerItemId),
  operatingPowerBasis: orNull(c.operatingPowerBasis),
```

- [ ] **Step 9: Prüfen beim Schreiben und Löschen (`server/src/db/repository.ts`)**

Importe: `GENERAL_POWER_CATEGORY` aus `'../../../shared/operatingPower.ts'`. Hinter `guardCostItem`:

```ts
// Betriebsstrom und Abzug (Heizung PR 15, #212). Ein Abzug gehört zu genau einer Betriebsstrom-Position
// desselben Objekts; ohne Verweis gehört er zu einer Anlage mit Messdienst (Abweichung 5). Die Datenbank
// prüft Kostenart und Vorzeichen (Bedingungen), hier steht, was an einer anderen Zeile hängt.
async function guardOperatingPower(db: Executor, before: CostItem | null, after: CostItem): Promise<void> {
  if (after.operatingPower === 'included' && after.category !== HEATING_CATEGORY) {
    throw new HeatingError(400, `Betriebsstrom gibt es nur bei der Kostenart „${HEATING_CATEGORY}“.`)
  }
  if (after.operatingPower === 'deduction') {
    if (after.category !== GENERAL_POWER_CATEGORY) {
      throw new HeatingError(400, `Ein Abzug des Betriebsstroms gehört zur Kostenart „${GENERAL_POWER_CATEGORY}“.`)
    }
    if (!(after.amountCents < 0)) {
      throw new HeatingError(400, `„${after.description}“ ist ein Abzug und braucht einen negativen Betrag.`)
    }
  }
  if (after.operatingPowerItemId !== undefined) {
    if (after.operatingPower !== 'deduction') {
      throw new HeatingError(400, 'Nur ein Abzug beim Allgemeinstrom zeigt auf eine Betriebsstrom-Position.')
    }
    const [target] = await db
      .select({ propertyId: costItems.propertyId, operatingPower: costItems.operatingPower, description: costItems.description })
      .from(costItems).where(eq(costItems.id, after.operatingPowerItemId))
    if (!target) throw new HeatingError(400, 'Die Betriebsstrom-Position, zu der dieser Abzug gehört, gibt es nicht (mehr).')
    if (target.propertyId !== after.propertyId) {
      throw new CrossPropertyError(`Der Abzug „${after.description}“ gehört zu einem anderen Objekt als der Betriebsstrom „${target.description}“.`)
    }
    if (target.operatingPower !== 'included') {
      throw new HeatingError(400, `„${target.description}“ ist nicht als Betriebsstrom gekennzeichnet, der auch im Allgemeinstrom steckt; ein Abzug kann nicht zu ihr gehören.`)
    }
  }
  if (before?.operatingPower === 'included' && after.operatingPower !== 'included') {
    const abzuege = await db.select({ description: costItems.description }).from(costItems).where(eq(costItems.operatingPowerItemId, after.id))
    if (abzuege.length > 0) {
      throw new HeatingError(400, `Zu „${after.description}“ gehört der Abzug ${abzuege.map((a) => `„${a.description}“`).join(', ')} beim Allgemeinstrom. Löschen Sie zuerst den Abzug, sonst stünde er ohne Betriebsstrom da.`)
    }
  }
  // P-W1: Die Grundlage der Schätzung gehört zu Betriebsstrom oder Abzug.
  if (after.operatingPowerBasis !== undefined && after.operatingPower === undefined) {
    throw new HeatingError(400, 'Eine Grundlage der Schätzung gibt es nur bei Betriebsstrom oder seinem Abzug beim Allgemeinstrom.')
  }
}
```

Am Ende von `guardCostItem`, hinter `await guardFuelLink(db, before, after)`:

```ts
  await guardOperatingPower(db, before, after)
```

In `costItemCollection.remove` die neue Sperre **vor** die vorhandenen Zeilen setzen; die Prüfung der
eingefrorenen Lieferung (`guardFrozenLink`, PR 7) bleibt unverändert dahinter:

```ts
  remove: async (db, id) => {
    // Heizung PR 15: ein Satz statt des Fremdschlüssels (Review Focus 2).
    const abzuege = await db.select({ description: costItems.description }).from(costItems).where(eq(costItems.operatingPowerItemId, id))
    if (abzuege.length > 0) {
      throw new HeatingError(400, `Zu dieser Position gehört ${abzuege.length === 1 ? 'der Abzug' : 'die Abzüge'} ${abzuege.map((a) => `„${a.description}“`).join(', ')} beim Allgemeinstrom. Löschen Sie zuerst den Abzug, damit der Allgemeinstrom nicht still gemindert bleibt.`)
    }
    const [c] = await db.select({ fuelDeliveryId: costItems.fuelDeliveryId, period: costItems.period }).from(costItems).where(eq(costItems.id, id))
    if (c) await guardFrozenLink(db, { id, fuelDeliveryId: c.fuelDeliveryId, period: c.period }, null)
    await db.delete(costItems).where(eq(costItems.id, id))
  },
```

(`rewriteCostItemFamily` löscht beim Aufteilen einer Rechnung über `costItemCollection.remove`; ein
Betriebsstrom mit Abzug wird dort ebenso mit dem Satz abgelehnt. Das ist gewollt: Heizkosten teilt
Mietfuchs ohnehin nicht nach Tagen auf.)

- [ ] **Step 10: Bestehende Wächter nachziehen**

`server/test/db-stock.test.ts`: `NOT_IN_DB_JSON` um `'operatingPower', 'operatingPowerItemId',
'operatingPowerBasis'` ergänzen, mit dem Kommentar „Betriebsstrom (Heizung PR 15) kennt die db.json nicht“.

`server/test/db-repository.test.ts`, Test „Die Verschmelzung erreicht jede Spalte des Schemas“ (Probe für
`costItems`): Die Probe ist eine Heizposition (PR 3); im Rumpf `operatingPower: 'included'` und
`operatingPowerBasis: 'Grundlage'` ergänzen und in der Erwartung dieselben Werte. `operatingPowerItemId`
bleibt dort leer: Ein Verweis braucht eine zweite Position, die Probe prüft ihn in
db-betriebsstrom.test.ts. Leitet der Test die Erwartung aus den Spalten ab und verlangt einen Wert für
jede, steht `operatingPowerItemId` dort als benannte Ausnahme mit diesem Grund.

- [ ] **Step 11: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-betriebsstrom.test.ts test/db-errors.test.ts test/migrations.test.ts test/schema.test.ts test/db-stock.test.ts test/db-repository.test.ts test/categories.test.ts test/db-golden.test.ts test/db-changeover.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 12: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts shared/operatingPower.ts server/src/db/schema.ts server/src/db/errors.ts server/drizzle server/src/db/read.ts server/src/db/repository.ts server/test/db-betriebsstrom.test.ts server/test/db-errors.test.ts server/test/migrations.test.ts server/test/db-stock.test.ts server/test/db-repository.test.ts server/test/categories.test.ts
git commit -m "Betriebsstrom: Kennzeichnung an Heizkosten und Abzug beim Allgemeinstrom

Drei Spalten an cost_items, Bedingungen in einem eigenen Schritt, ein Abzug
zeigt auf seinen Betriebsstrom (RESTRICT, Löschen mit einem Satz gesperrt);
die Grundlage der Schätzung bleibt an beiden Positionen gespeichert.

Refs #212"
```

---

### Task 3: Die Schätzhilfe (`shared/operatingPower.ts`)

Reine Rechnung, für Formular und Server dieselbe: kWh nach Leistung, Laufzeit und Tagen (je Gerät,
P-K8) oder gemessen, Anteil an der Stromrechnung, Euro auf den Cent, Rechenweg als Text; dazu der
selbst geschätzte Betrag mit Grundlage (P-W2) und die Ablehnung bei Wärmepumpe und Stromheizung (P-W5).

**Files:**
- Modify: `shared/operatingPower.ts`, `server/test/law-literals.test.ts` (`ENGINE_FILES`)
- Test: `server/test/operating-power.test.ts` (neu)

**Interfaces:**
- Consumes: `OperatingPowerDevice`, `HeatingEnergy` (shared/types.ts).
- Produces:
  - `type OperatingPowerInput = { devices: readonly OperatingPowerDevice[] | null; heatingDays: number | null; measuredKwh: number | null; billKwh: number; billCents: number }`
  - `type OperatingPowerShare = { kwh: number; measured: boolean; permille: number; cents: number; steps: string[] }`
  - `operatingPowerShare(i: OperatingPowerInput): OperatingPowerShare | { error: string }`
  - `type OwnEstimate = { cents: number; steps: string[] }`, `ownEstimateShare(i: { cents: number | null; basis: string; billCents: number }): OwnEstimate | { error: string }` (P-W2)
  - `operatingPowerRefusal(energy: HeatingEnergy): string | null` (P-W5; `null` heißt: die Hilfe gilt)
  - `basisOf(steps: readonly string[]): string` (P-W1: die Grundlage, wie sie an beiden Positionen gespeichert wird)

- [ ] **Step 1: Write the failing test**

`server/test/operating-power.test.ts`:

```ts
// Die Schätzhilfe für den Betriebsstrom (Heizung PR 15, #212): nach Leistung und Heiztagen (BGH V ZR
// 166/15 Rn. 14) oder gemessen, als Anteil an der Stromrechnung (Abweichung 3).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { operatingPowerShare, type OperatingPowerInput } from '../../shared/operatingPower.ts'

const GERAETE = [
  { label: 'Brenner', watts: 120, hoursPerDay: 6 },
  { label: 'Umwälzpumpe', watts: 45, hoursPerDay: 24 },
  { label: 'Regelung', watts: 5, hoursPerDay: 24 },
]
const geschaetzt = (over: Partial<OperatingPowerInput> = {}): OperatingPowerInput =>
  ({ devices: GERAETE, heatingDays: 220, measuredKwh: null, billKwh: 3000, billCents: 105000, ...over })

test('Schätzung: 120 W · 6 h + 45 W · 24 h + 5 W · 24 h an 220 Tagen = 422,4 kWh, 14,08 % des Rechnungsbetrags einschließlich Grundpreis (1.050,00 €) = 147,84 €', () => {
  const r = operatingPowerShare(geschaetzt())
  if ('error' in r) return assert.fail(r.error)
  assert.ok(Math.abs(r.kwh - 422.4) < 1e-9, String(r.kwh))
  assert.equal(r.measured, false)
  assert.ok(Math.abs(r.permille - 140.8) < 1e-9, String(r.permille))
  assert.equal(r.cents, 14784)
  assert.deepEqual(r.steps, [
    'Brenner: 120 W × 6 h × 220 Tage = 158,4 kWh',
    'Umwälzpumpe: 45 W × 24 h × 220 Tage = 237,6 kWh',
    'Regelung: 5 W × 24 h × 220 Tage = 26,4 kWh',
    'zusammen 422,4 kWh von 3.000 kWh der Stromrechnung = 14,08 %',
    '14,08 % des Rechnungsbetrags einschließlich Grundpreis (1.050,00 €) = 147,84 €',
  ])
})

test('Gemessen mit Zwischenzähler: 500 kWh von 3.000 kWh, Geräte und Heiztage zählen nicht', () => {
  const r = operatingPowerShare(geschaetzt({ devices: null, heatingDays: null, measuredKwh: 500 }))
  if ('error' in r) return assert.fail(r.error)
  assert.equal(r.measured, true)
  assert.equal(r.cents, 17500)
  assert.equal(r.steps[0], 'gemessen mit Zwischenzähler: 500 kWh von 3.000 kWh der Stromrechnung = 16,67 %')
})

test('Rundung kaufmännisch auf den Cent: 1 kWh von 3 kWh aus 1,00 € = 0,33 €; 2 von 3 = 0,67 €', () => {
  const a = operatingPowerShare({ devices: null, heatingDays: null, measuredKwh: 1, billKwh: 3, billCents: 100 })
  const b = operatingPowerShare({ devices: null, heatingDays: null, measuredKwh: 2, billKwh: 3, billCents: 100 })
  assert.deepEqual(['error' in a ? a.error : a.cents, 'error' in b ? b.error : b.cents], [33, 67])
})

test('Review Focus 4: mehr kWh als die Stromrechnung ist ein Fehler mit beiden Zahlen', () => {
  const r = operatingPowerShare(geschaetzt({ devices: [{ label: 'Brenner', watts: 120000, hoursPerDay: 6 }] }))
  assert.ok('error' in r)
  assert.match(r.error, /158\.400 kWh/)
  assert.match(r.error, /3\.000 kWh/)
})

test('Eingaben: ohne Gerät, ohne Heiztage, Laufzeit über 24 h, Heiztage über 366, Leistung 0, Stromrechnung ohne kWh oder Betrag', () => {
  const fehler = (i: OperatingPowerInput): string => { const r = operatingPowerShare(i); return 'error' in r ? r.error : '' }
  assert.match(fehler(geschaetzt({ devices: [] })), /mindestens ein Gerät/)
  assert.match(fehler(geschaetzt({ heatingDays: null })), /Heiztage/)
  assert.match(fehler(geschaetzt({ heatingDays: 400 })), /Heiztage/)
  assert.match(fehler(geschaetzt({ devices: [{ label: 'P', watts: 45, hoursPerDay: 25 }] })), /höchstens 24 Stunden/)
  assert.match(fehler(geschaetzt({ devices: [{ label: 'P', watts: 0, hoursPerDay: 24 }] })), /Leistung/)
  assert.match(fehler(geschaetzt({ billKwh: 0 })), /kWh der Stromrechnung/)
  assert.match(fehler(geschaetzt({ billCents: 0 })), /Betrag der Stromrechnung/)
  assert.match(fehler(geschaetzt({ devices: null, heatingDays: null, measuredKwh: 0 })), /gemessenen kWh/)
  assert.match(fehler(geschaetzt({ devices: [{ label: 'P', watts: 45, hoursPerDay: 24, days: 400 }] })), /Tage von „P“/)
})

// P-K8: Die Heizungs-Umwälzpumpe läuft nur in der Heizzeit, die Warmwasserpumpe das ganze Jahr.
test('Tage je Gerät: ohne Angabe die Heiztage, mit Angabe die eigenen Tage, im Rechenweg genannt', () => {
  const r = operatingPowerShare(geschaetzt({ devices: [
    { label: 'Umwälzpumpe Heizung', watts: 45, hoursPerDay: 24 },
    { label: 'Warmwasserpumpe', watts: 25, hoursPerDay: 4, days: 360 },
  ] }))
  if ('error' in r) return assert.fail(r.error)
  // 45 × 24 × 220 / 1000 = 237,6; 25 × 4 × 360 / 1000 = 36; Σ 273,6 kWh; 273,6 / 3.000 × 1.050,00 € = 95,76 €
  // (keine halben Cent im Beispiel, damit die Gleitkommadarstellung die Rundung nicht kippt)
  assert.ok(Math.abs(r.kwh - 273.6) < 1e-9, String(r.kwh))
  assert.equal(r.cents, 9576)
  assert.deepEqual(r.steps.slice(0, 2), [
    'Umwälzpumpe Heizung: 45 W × 24 h × 220 Tage = 237,6 kWh',
    'Warmwasserpumpe: 25 W × 4 h × 360 Tage = 36 kWh',
  ])
})

// P-W2: der Weg „Betrag selbst geschätzt“, etwa nach einem Bruchteil der Brennstoffkosten (V ZR 166/15
// Rn. 14). Mietfuchs gibt keinen Prozentsatz vor; die Grundlage ist Pflicht.
test('Selbst geschätzt: Betrag und Grundlage, kein Prozentsatz im Rechenweg', () => {
  const r = ownEstimateShare({ cents: 14784, basis: '5 % der Brennstoffkosten 2025 (2.956,80 €), Typenschilder nicht lesbar', billCents: 105000 })
  if ('error' in r) return assert.fail(r.error)
  assert.equal(r.cents, 14784)
  assert.deepEqual(r.steps, [
    'selbst geschätzt: 147,84 €',
    'Grundlage der Schätzung: 5 % der Brennstoffkosten 2025 (2.956,80 €), Typenschilder nicht lesbar',
  ])
  // Kein eigener Anteil am Allgemeinstrom: Der BGH nennt einen Bruchteil der Brennstoffkosten.
  assert.ok(!r.steps.some((s) => /des Rechnungsbetrags/.test(s)))
})

test('Selbst geschätzt: ohne Grundlage, ohne Betrag oder über der Stromrechnung ein Fehler mit Satz', () => {
  const fehler = (i: Parameters<typeof ownEstimateShare>[0]): string => { const r = ownEstimateShare(i); return 'error' in r ? r.error : '' }
  assert.match(fehler({ cents: 14784, basis: '  ', billCents: 105000 }), /Grundlage der Schätzung/)
  assert.match(fehler({ cents: null, basis: 'x', billCents: 105000 }), /Betrag/)
  assert.match(fehler({ cents: 0, basis: 'x', billCents: 105000 }), /Betrag/)
  assert.match(fehler({ cents: 105001, basis: 'x', billCents: 105000 }), /1\.050,01 € liegen über dem Betrag der Stromrechnung \(1\.050,00 €\)/)
})

// P-W5: Bei Wärmepumpe und Stromheizung ist der Strom Brennstoff (§ 7 Abs. 2 HeizkostenV).
test('Wärmepumpe und Stromheizung: keine Schätzhilfe, eigener Satz; jede andere Energie: Hilfe', () => {
  for (const energy of ['heatPump', 'electric'] as const) {
    const satz = operatingPowerRefusal(energy) ?? assert.fail(`${energy}: keine Ablehnung`)
    assert.match(satz, /Strom .* Brennstoff, nicht Betriebsstrom/)
    assert.match(satz, /als Brennstoffkosten in die Heizposition/)
    assert.match(satz, /§ 7 Abs\. 2 HeizkostenV/)
  }
  for (const energy of ['gas', 'oil', 'lpg', 'pellets', 'wood', 'districtHeating', 'coal', 'other'] as const) {
    assert.equal(operatingPowerRefusal(energy), null, energy)
  }
})

test('Grundlage (P-W1): die Zeilen des Rechenwegs, je eine Zeile', () => {
  assert.equal(basisOf(['a: 1 kWh', 'b: 2 kWh']), 'a: 1 kWh\nb: 2 kWh')
})
```

Den Import der Datei ergänzen: `import { basisOf, operatingPowerRefusal, operatingPowerShare, ownEstimateShare, type OperatingPowerInput } from '../../shared/operatingPower.ts'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/operating-power.test.ts`
Expected: FAIL, `operatingPowerShare is not a function` bzw. Exportfehler.

- [ ] **Step 3: Implementation (`shared/operatingPower.ts`)**

Die Datei aus Task 2 Step 7 vollständig ersetzen:

```ts
// Betriebsstrom der Heizung (Heizung PR 15, #212): die Rechnung der Schätzhilfe, für Formular und
// Server dieselbe.
import type { HeatingEnergy, OperatingPowerDevice } from './types.ts'

// Die Kostenart des Allgemeinstroms (§ 2 Nr. 11 BetrKV, Beleuchtung). Dieselbe Zeichenkette wie in
// shared/categories.ts; categories.test.ts hält beide zusammen.
export const GENERAL_POWER_CATEGORY = 'Beleuchtung/Allgemeinstrom'

// Was die Hilfe braucht: entweder Geräte und Heiztage (geschätzt) oder gemessene kWh (Zwischenzähler),
// dazu kWh und Betrag der Stromrechnung des Allgemeinstroms.
export type OperatingPowerInput = {
  devices: readonly OperatingPowerDevice[] | null
  heatingDays: number | null
  measuredKwh: number | null
  billKwh: number
  billCents: number
}

// `permille` ist der Anteil an der Stromrechnung in Promille, ungerundet; `cents` auf den Cent gerundet.
export type OperatingPowerShare = { kwh: number; measured: boolean; permille: number; cents: number; steps: string[] }

const de = (n: number, digits: number): string => n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const euro = (cents: number): string => `${de(cents / 100, 2)} €`
const kwhText = (kwh: number): string => `${kwh.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kWh`
const positive = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

// Der Anteil des Betriebsstroms am Allgemeinstrom (BGH, Urteil vom 03.06.2016, V ZR 166/15, Leitsatz:
// „welcher Anteil an dem Allgemeinstrom hierauf entfällt“). kWh nach Rn. 14 aus Leistung und Heiztagen,
// oder gemessen; Euro = Betrag der Stromrechnung × kWh ÷ kWh der Rechnung, also mit anteiligem
// Grundpreis (Abweichung 3: Festlegung im Schätzermessen nach Rn. 14, keine Norm). Laufzeit und Heiztage gibt der Vermieter ein, Mietfuchs schlägt keine vor.
export function operatingPowerShare(i: OperatingPowerInput): OperatingPowerShare | { error: string } {
  if (!positive(i.billKwh)) return { error: 'Bitte geben Sie die kWh der Stromrechnung des Allgemeinstroms an.' }
  if (!positive(i.billCents)) return { error: 'Der Betrag der Stromrechnung muss größer als 0 sein.' }
  const steps: string[] = []
  let kwh = 0
  const measured = i.measuredKwh !== null
  if (measured) {
    if (!positive(i.measuredKwh)) return { error: 'Bitte geben Sie die gemessenen kWh des Zwischenzählers an.' }
    kwh = i.measuredKwh
  } else {
    const devices = i.devices ?? []
    if (devices.length === 0) return { error: 'Bitte nennen Sie mindestens ein Gerät der Heizung mit Leistung und Laufzeit.' }
    const days = i.heatingDays
    if (days === null || !Number.isInteger(days) || days < 1 || days > 366) return { error: 'Bitte geben Sie die Heiztage an, als ganze Zahl von 1 bis 366.' }
    for (const d of devices) {
      if (!positive(d.watts)) return { error: `Bitte geben Sie die Leistung von „${d.label}“ in Watt an.` }
      if (!positive(d.hoursPerDay) || d.hoursPerDay > 24) return { error: `Die Laufzeit von „${d.label}“ ist höchstens 24 Stunden am Tag.` }
      // P-K8: eigene Tage je Gerät, sonst die Heiztage (Festlegung im Schätzermessen, Abweichung 4).
      const own = d.days ?? days
      if (!Number.isInteger(own) || own < 1 || own > 366) return { error: `Die Tage von „${d.label}“ sind eine ganze Zahl von 1 bis 366.` }
      const deviceKwh = (d.watts * d.hoursPerDay * own) / 1000
      kwh += deviceKwh
      steps.push(`${d.label}: ${d.watts.toLocaleString('de-DE')} W × ${d.hoursPerDay.toLocaleString('de-DE')} h × ${own} Tage = ${kwhText(deviceKwh)}`)
    }
  }
  if (kwh > i.billKwh) {
    return { error: `Die ${measured ? 'gemessenen' : 'geschätzten'} ${kwhText(kwh)} liegen über dem Verbrauch der Stromrechnung (${kwhText(i.billKwh)}). Bitte prüfen Sie Leistung (in Watt) und Laufzeit.` }
  }
  const ratio = kwh / i.billKwh
  const percent = `${de(ratio * 100, 2)} %`
  steps.push(measured
    ? `gemessen mit Zwischenzähler: ${kwhText(kwh)} von ${kwhText(i.billKwh)} der Stromrechnung = ${percent}`
    : `zusammen ${kwhText(kwh)} von ${kwhText(i.billKwh)} der Stromrechnung = ${percent}`)
  const cents = Math.round(i.billCents * ratio)
  // Festlegung im Schätzermessen (Abweichung 3): Anteil am Rechnungsbetrag samt Grundpreis. Der Text
  // sagt es, damit der Vermieter die Festlegung sieht.
  steps.push(`${percent} des Rechnungsbetrags einschließlich Grundpreis (${euro(i.billCents)}) = ${euro(cents)}`)
  return { kwh, measured, permille: ratio * 1000, cents, steps }
}

// Der dritte Weg „Betrag selbst geschätzt“ (P-W2, Entwurf 0.12): etwa ein Bruchteil der Brennstoffkosten
// (BGH, Urteil vom 03.06.2016, V ZR 166/15, Rn. 14). Mietfuchs gibt keinen Prozentsatz vor und rechnet
// keinen vor (Entwurf 16); die Grundlage ist Pflicht, denn bestreitet ein Mieter den Betrag, muss der
// Vermieter sie darlegen (P-W1).
export type OwnEstimate = { cents: number; steps: string[] }
export function ownEstimateShare(i: { cents: number | null; basis: string; billCents: number }): OwnEstimate | { error: string } {
  const basis = i.basis.trim()
  // Das Beispiel nennt bewusst keinen Prozentsatz: Mietfuchs gibt keinen vor (Entwurf 16).
  if (basis === '') return { error: 'Bitte nennen Sie die Grundlage der Schätzung, etwa den Bruchteil der Brennstoffkosten, den Sie angesetzt haben, oder die Geräte mit Leistung und Laufzeit.' }
  if (i.cents === null || !Number.isInteger(i.cents) || i.cents <= 0) return { error: 'Bitte geben Sie den geschätzten Betrag in Euro an.' }
  if (i.cents > i.billCents) return { error: `Die geschätzten ${euro(i.cents)} liegen über dem Betrag der Stromrechnung (${euro(i.billCents)}). Bitte prüfen Sie den Betrag.` }
  return { cents: i.cents, steps: [`selbst geschätzt: ${euro(i.cents)}`, `Grundlage der Schätzung: ${basis}`] }
}

// Wärmepumpe und Stromheizung (P-W5): Dort ist der Strom Brennstoff („Kosten der verbrauchten
// Brennstoffe“, § 7 Abs. 2 HeizkostenV; Entwurf 8.3) und gehört als Teil „Brennstoff/Energie“ in die
// Heizposition, nicht als Betriebsstrom. `null`: Die Schätzhilfe gilt.
const FUEL_IS_POWER: readonly HeatingEnergy[] = ['heatPump', 'electric']
export function operatingPowerRefusal(energy: HeatingEnergy): string | null {
  if (!FUEL_IS_POWER.includes(energy)) return null
  return `Bei einer ${energy === 'heatPump' ? 'Wärmepumpe' : 'Stromheizung'} ist der Strom Brennstoff, nicht Betriebsstrom (§ 7 Abs. 2 HeizkostenV). ` +
    'Erfassen Sie ihn als Brennstoffkosten in die Heizposition („Heizung und Warmwasser“, Teil „Brennstoff/Energie“); die Schätzhilfe für den Betriebsstrom gilt dafür nicht.'
}

// Die Grundlage der Schätzung, wie sie an Betriebsstrom und Abzug gespeichert wird (P-W1): der Rechenweg
// mit allen Eingaben, eine Zeile je Schritt.
export const basisOf = (steps: readonly string[]): string => steps.join('\n')
```

Der Satz in `operatingPowerRefusal` erfüllt den Test aus Step 1 (`/Strom .* Brennstoff, nicht
Betriebsstrom/`, „als Brennstoffkosten in die Heizposition“, Norm). Der Text „Brennstoff/Energie“ ist
die Beschriftung der Auswahl „Teil der Heizkosten“ (`HEATING_PART_OPTIONS` in client/src/costForm.ts);
heißt sie dort anders, den Satz angleichen.

In `server/test/law-literals.test.ts` `ENGINE_FILES` um `'shared/operatingPower.ts'` ergänzen (Global
Constraints, „Rechtswerte“). Die Datei hat keine Datumsangabe in Zeichenketten und keine Zahl aus
`CODE_PATTERN` (24, 366 und 1000 sind keine Rechtszahlen und stehen nicht im Muster).

`toLocaleString('de-DE')` setzt die Tausenderpunkte selbst („158.400 kWh“, „3.000 kWh“), die der Test
in Review Focus 4 erwartet. Eine Gleitkommazahl wie 422,40000000000003 erscheint im Text als „422,4“,
weil `maximumFractionDigits: 1` rundet; gerechnet wird mit dem ungerundeten Wert.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix server test -- test/operating-power.test.ts test/law-literals.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS. Zur Rundung im ersten Test: 105.000 × 422,4 ÷ 3.000 = 14.784 genau; im dritten Test 33,33…
→ 33 und 66,66… → 67; im Test der Tage je Gerät 273,6 × 35 = 9.576 genau.

- [ ] **Step 5: Commit**

```bash
git add shared/operatingPower.ts server/test/operating-power.test.ts server/test/law-literals.test.ts
git commit -m "Betriebsstrom: Schätzung nach Leistung und Tagen, gemessen oder selbst geschätzt

Anteil an der Stromrechnung, Tage je Gerät, Betrag mit Grundlage ohne
vorgegebenen Prozentsatz; keine Schätzhilfe bei Wärmepumpe und Stromheizung,
dort ist der Strom Brennstoff (§ 7 Abs. 2 HeizkostenV).

Refs #212"
```

---

### Task 4: Betriebsstrom und Abzug gemeinsam anlegen (Route)

**Files:**
- Create: `server/src/db/operatingPower.ts`
- Modify: `server/src/index.ts`
- Test: `server/test/db-betriebsstrom.test.ts`, `server/test/api.test.ts`

**Interfaces:**
- Consumes: `operatingPowerShare`, `ownEstimateShare`, `operatingPowerRefusal`, `basisOf`, `GENERAL_POWER_CATEGORY` (Task 3); `readCostItems`, `readHeatingPlants`; `insertCostItemIn`, `itemPeriodClosed`, `HeatingError`, `raw` (repository.ts); `plantContext`, `heatingPeriodOf`, `heatingPeriodClosed` (heatingPeriodContext.ts); `HEATING_CATEGORY`.
- Produces:
  - `type OperatingPowerMethod = 'estimate' | 'measured' | 'own'`
  - `type OperatingPowerBooking = { method: OperatingPowerMethod; share: { cents: number; steps: string[] }; heatingItem: CostItem | null; deduction: CostItem }`
  - `bookOperatingPower(db: Database, plantId: string, body: unknown, newId: () => string): Promise<OperatingPowerBooking | null>` (`null`: keine Anlage)
  - Rumpf: `{ period, generalItemId, billKwh?, devices?, heatingDays?, measuredKwh?, ownCents?, basis? }`; `ownCents` (mit `basis`) wählt den Weg „Betrag selbst geschätzt“, `measuredKwh` den Zwischenzähler, sonst die Geräte
  - Route `POST /api/heating-plants/:id/operating-power` → 201 `OperatingPowerBooking`, 404 ohne Anlage, 400/409 mit Satz

- [ ] **Step 1: Write the failing tests**

In `server/test/db-betriebsstrom.test.ts` den Import ergänzen:

```ts
import { bookOperatingPower } from '../src/db/operatingPower.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
```

und anhängen:

```ts
// ---------- Schätzhilfe: Betriebsstrom und Abzug in einer Transaktion (Task 4) ----------

const strom = { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom 2025', amountCents: 105000, key: 'area' }
const schaetzung = (over: Record<string, unknown> = {}) => ({
  period: '2025-01', generalItemId: 'strom', billKwh: 3000,
  devices: [{ label: 'Brenner', watts: 120, hoursPerDay: 6 }, { label: 'Umwälzpumpe', watts: 45, hoursPerDay: 24 }, { label: 'Regelung', watts: 5, hoursPerDay: 24 }],
  heatingDays: 220, ...over,
})
let n = 0
const ids = () => `neu-${++n}`

test('Schätzhilfe bei freien Schlüsseln: Betriebsstrom nach dem Schlüssel des Brennstoffs, Abzug nach dem des Allgemeinstroms', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ description: 'Gas', heatingPart: 'fuel', operatingPower: null, key: 'meter', meterType: 'waerme', heatingPlantId: 'hp' })))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', { ...strom, key: 'units' }))
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids))
    if (!b) return assert.fail('keine Anlage')
    assert.equal(b.share.cents, 14784)
    const h = b.heatingItem ?? assert.fail('kein Betriebsstrom')
    assert.deepEqual([h.category, h.amountCents, h.key, h.meterType, h.heatingPart, h.operatingPower, h.heatingPlantId, h.period],
      ['Heizung und Warmwasser', 14784, 'meter', 'waerme', 'operating', 'included', 'hp', '2025-01'])
    assert.match(h.description, /Betriebsstrom Heizung \(geschätzt\)/)
    assert.deepEqual([b.deduction.category, b.deduction.amountCents, b.deduction.key, b.deduction.operatingPower, b.deduction.operatingPowerItemId, b.deduction.period],
      ['Beleuchtung/Allgemeinstrom', -14784, 'units', 'deduction', h.id, '2025-01'])
    // P-W1: Die Grundlage mit allen Eingaben steht an beiden Positionen, gelesen aus der Datenbank.
    const grundlage = [
      'Brenner: 120 W × 6 h × 220 Tage = 158,4 kWh',
      'Umwälzpumpe: 45 W × 24 h × 220 Tage = 237,6 kWh',
      'Regelung: 5 W × 24 h × 220 Tage = 26,4 kWh',
      'zusammen 422,4 kWh von 3.000 kWh der Stromrechnung = 14,08 %',
      '14,08 % des Rechnungsbetrags einschließlich Grundpreis (1.050,00 €) = 147,84 €',
    ].join('\n')
    const gelesen = await opened.read((db) => readCostItems(db))
    assert.deepEqual(gelesen.filter((c) => c.operatingPower !== undefined).map((c) => c.operatingPowerBasis), [grundlage, grundlage])
  })
})

// P-W2: der dritte Weg, etwa für einen Bruchteil der Brennstoffkosten (V ZR 166/15 Rn. 14).
test('Schätzhilfe „Betrag selbst geschätzt“: Betrag und Grundlage an beiden Positionen, ohne Prozentsatz', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ description: 'Gas', heatingPart: 'fuel', operatingPower: null, heatingPlantId: 'hp' })))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-01', generalItemId: 'strom', ownCents: 14784, basis: 'Bruchteil der Brennstoffkosten 2025' }, ids))
    const h = b?.heatingItem ?? assert.fail('kein Betriebsstrom')
    assert.equal(b?.method, 'own')
    assert.deepEqual([h.amountCents, b?.deduction.amountCents], [14784, -14784])
    assert.match(h.description, /\(selbst geschätzt\)/)
    assert.equal(h.operatingPowerBasis, 'selbst geschätzt: 147,84 €\nGrundlage der Schätzung: Bruchteil der Brennstoffkosten 2025')
    assert.equal(b?.deduction.operatingPowerBasis, h.operatingPowerBasis)
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-01', generalItemId: 'strom', ownCents: 14784, basis: '' }, ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Grundlage der Schätzung/.test(e.message))
  })
})

// P-W5: Bei Wärmepumpe und Stromheizung ist der Strom Brennstoff, keine Schätzhilfe.
test('Schätzhilfe bei Wärmepumpe und Stromheizung: 400 mit dem Satz zum Brennstoff, nichts angelegt', async () => {
  for (const energy of ['heatPump', 'electric'] as const) {
    await withDatabase(async (opened) => {
      await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy, method: 'service' }))
      await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
      await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids)),
        (e: unknown) => e instanceof HeatingError && e.status === 400 && /ist der Strom Brennstoff, nicht Betriebsstrom/.test(e.message))
      assert.equal((await opened.read((db) => readCostItems(db))).filter((c) => c.operatingPower !== undefined).length, 0, energy)
    })
  }
})

test('Schätzhilfe bei eigener Abrechnung: Schlüssel nach Heizkostenverordnung, Teil Betrieb, Ziel beides', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    // Die eigene Abrechnung richtet PR 10 über die Einrichtung ein; für diesen Test genügen Methode und
    // Erfassung (die Bedingung heating_plants_self_capture_complete verlangt sie).
    await opened.write((db) => db.update(heatingPlants).set({ method: 'self', capture: 'heatMeter' }).where(eq(heatingPlants.id, 'hp')))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', schaetzung({ devices: null, heatingDays: null, measuredKwh: 500 }), ids))
    const h = b?.heatingItem ?? assert.fail('kein Betriebsstrom')
    assert.deepEqual([h.key, h.heatingPart, h.heatingTarget, h.amountCents], ['heatingSystem', 'operating', 'both', 17500])
    assert.match(h.description, /\(gemessen\)/)
  })
})

test('Schätzhilfe beim Messdienst: nur der Abzug, ohne Verweis, beschrieben als an den Messdienst gemeldet (P-K9)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' }))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids))
    assert.equal(b?.heatingItem, null)
    assert.deepEqual([b?.deduction.amountCents, b?.deduction.operatingPowerItemId], [-14784, undefined])
    assert.equal(b?.deduction.description, 'Abzug Betriebsstrom Heizung (geschätzt), an Messdienst gemeldet')
    assert.match(b?.deduction.operatingPowerBasis ?? '', /147,84 €/)
  })
})

test('Schätzhilfe lehnt ab: Allgemeinstrom mit Einzelbeträgen oder Gemeinschaftsabrechnung (Review Focus 1, P-W4), ohne Brennstoffposition (P-K2), keine Stromposition, zu viele kWh (Review Focus 4)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    // P-K2: verteilt wird nach § 7 Abs. 1, Abs. 2 zählt nur die Kosten auf.
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Brennstoffposition/.test(e.message) && /\(§ 7 Abs\. 1 und 2 HeizkostenV\)/.test(e.message))
    await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ description: 'Gas', heatingPart: 'fuel', operatingPower: null, heatingPlantId: 'hp' })))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung({ generalItemId: 'gas' }), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Beleuchtung\/Allgemeinstrom/.test(e.message))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung({ devices: [{ label: 'Brenner', watts: 120000, hoursPerDay: 6 }] }), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /über dem Verbrauch der Stromrechnung/.test(e.message))
    await opened.write((db) => updateEntity(db, 'costItems', 'strom', { key: 'amounts', tenancyAmounts: {} }))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /in den Beträgen selbst ab/.test(e.message))
    await opened.write((db) => updateEntity(db, 'costItems', 'strom', { key: 'external', externalBasis: { measure: 'mea', total: 10000, totalCents: 1000000 } }))
    // P-W4: V ZR 166/15 ist gerade der Fall, in dem die Gemeinschaft es nicht getan hatte.
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 &&
        /dazu ist die Gemeinschaft verpflichtet \(BGH, Urteil vom 03\.06\.2016, V ZR 166\/15\)/.test(e.message) &&
        /Prüfen Sie in der Hausgeldabrechnung, ob der Betriebsstrom bei den Heizkosten steht/.test(e.message) &&
        /wenden Sie sich an die Verwaltung/.test(e.message) &&
        !/tut das die Gemeinschaft/.test(e.message))
    // Nichts angelegt: weder Betriebsstrom noch Abzug.
    const alle = await opened.read((db) => readCostItems(db))
    assert.equal(alle.filter((c) => c.operatingPower !== undefined).length, 0)
  })
})

test('Schätzhilfe: abgeschlossene Heizperiode → 409, unbekannte Heizperiode → 400, unbekannte Anlage → null', async () => {
  await withDatabase(async (opened) => {
    assert.equal(await opened.write((db) => bookOperatingPower(db, 'fehlt', schaetzung(), ids)), null)
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' }))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung({ period: '2025-13' }), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400)
    await opened.write((db) => closeSettlement(db, { id: 'a1', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01T00:00:00Z', sentAt: null, settlement: {} }))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 409)
  })
})

// P-W3: Die Heizperiode ist offen, der Allgemeinstrom steht aber in einer abgeschlossenen Abrechnung. Ein
// Abzug dort erreichte die Mieter nicht mehr; der Betriebsstrom würde zweimal gezahlt (V ZR 166/15 Rn. 13).
test('Schätzhilfe: Allgemeinstrom in einer abgeschlossenen Abrechnung → 409 mit Satz, nichts angelegt', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' }))
    await opened.write((db) => createEntity(db, 'costItems', 'strom24', { ...strom, period: '2024-01', description: 'Hausstrom 2024' }))
    await opened.write((db) => closeSettlement(db, { id: 'a0', propertyId: 'objekt-1', period: periodKey('2024-01'), closedAt: '2025-03-01T00:00:00Z', sentAt: '2025-03-02', settlement: {} }))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung({ generalItemId: 'strom24' }), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 409 && /Allgemeinstrom „Hausstrom 2024“ steht in einer abgeschlossenen Abrechnung/.test(e.message))
    assert.equal((await opened.read((db) => readCostItems(db))).filter((c) => c.operatingPower !== undefined).length, 0)
  })
})
```

Dazu die Importe `import { eq } from 'drizzle-orm'`, `import { heatingPlants } from '../src/db/schema.ts'`,
`import { readCostItems } from '../src/db/read.ts'`, `import { periodKey } from '../../shared/period.ts'`
und `closeSettlement` aus `'../src/db/repository.ts'` (Signatur PR 2:
`closeSettlement(db, { id, propertyId, period, closedAt, sentAt, settlement })`).

In `server/test/api.test.ts` anhängen:

```ts
// ---------- Betriebsstrom (Heizung PR 15) ----------

test('Betriebsstrom über die Route: 201 mit beiden Positionen, 404 ohne Anlage, 400 mit Satz', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'service' })))
    const strom = await s.api<CostItem>('/api/costItems', jsonPost({ period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 105000, key: 'area' }))
    const body = { period: '2025-01', generalItemId: strom.id, billKwh: 3000, devices: [{ label: 'Pumpe', watts: 45, hoursPerDay: 24 }], heatingDays: 220 }
    const angelegt = await send(`/api/heating-plants/${plant.id}/operating-power`, jsonPost(body))
    assert.equal(angelegt.status, 201)
    const b = await jsonOf<{ share: { cents: number }; deduction: CostItem; heatingItem: CostItem | null }>(angelegt)
    // 45 W × 24 h × 220 Tage = 237,6 kWh; 237,6 / 3.000 × 1.050,00 € = 83,16 €
    assert.deepEqual([b.share.cents, b.deduction.amountCents, b.heatingItem], [8316, -8316, null])
    // P-W1: Die Grundlage kommt über die Route mit und bleibt in der Liste der Positionen.
    assert.match(b.deduction.operatingPowerBasis ?? '', /Pumpe: 45 W × 24 h × 220 Tage = 237,6 kWh/)
    const liste = await s.api<CostItem[]>('/api/costItems')
    assert.equal(liste.find((c) => c.id === b.deduction.id)?.operatingPowerBasis, b.deduction.operatingPowerBasis)
    assert.equal((await send('/api/heating-plants/fehlt/operating-power', jsonPost(body))).status, 404)
    const falsch = await send(`/api/heating-plants/${plant.id}/operating-power`, jsonPost({ ...body, billKwh: 0 }))
    assert.equal(falsch.status, 400)
    assert.match(await errorFrom(falsch), /kWh der Stromrechnung/)
  } finally {
    s.stop()
  }
})
```

(`jsonPost` (Zeile 5968, `RequestInit`), `jsonOf`, `errorFrom`, `startServer`, `HeatingPlant` und
`CostItem` gibt es in api.test.ts schon; `postJson` ist dort eine andere Funktion
(`postJson(s, url, body)`) und hier nicht gemeint.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-betriebsstrom.test.ts test/api.test.ts`
Expected: FAIL, `Cannot find module '…/src/db/operatingPower.ts'`.

- [ ] **Step 3: Implementation (`server/src/db/operatingPower.ts`)**

```ts
// Betriebsstrom und Abzug gemeinsam anlegen (Heizung PR 15, #212): die Schätzhilfe der Seite Heizkosten.
// Beide Positionen entstehen in **einer** Transaktion über denselben Weg wie jede andere Position
// (`insertCostItemIn`), damit kein Abzug ohne Betriebsstrom stehenbleibt und dieselben Prüfungen gelten.
//
// Welche Verteilung die beiden bekommen, steht als Abweichung 5 und 6 im Plan: Der Betriebsstrom geht
// wie der Brennstoff (bei eigener Abrechnung nach der Heizkostenverordnung, Ziel `both`), der Abzug wie
// der Allgemeinstrom. Beim Messdienst gibt es nur den Abzug, denn der Messdienst verteilt den
// Betriebsstrom in seinen Beträgen.
//
// Die Grundlage der Schätzung (P-W1) steht an beiden Positionen: Bestreitet ein Mieter den Betrag, muss
// der Vermieter sie darlegen (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz 3).
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { basisOf, GENERAL_POWER_CATEGORY, operatingPowerRefusal, operatingPowerShare, ownEstimateShare } from '../../../shared/operatingPower.ts'
import type { CostItem, OperatingPowerDevice } from '../../../shared/types.ts'
import type { Database } from './client.ts'
import { heatingPeriodClosed, heatingPeriodOf, plantContext } from './heatingPeriodContext.ts'
import { readCostItems, readHeatingPlants } from './read.ts'
import { has, HeatingError, insertCostItemIn, itemPeriodClosed, raw } from './repository.ts'

export type OperatingPowerMethod = 'estimate' | 'measured' | 'own'
export type OperatingPowerBooking = { method: OperatingPowerMethod; share: { cents: number; steps: string[] }; heatingItem: CostItem | null; deduction: CostItem }

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function devicesOf(value: unknown): OperatingPowerDevice[] | null {
  if (!Array.isArray(value)) return null
  return value.map((d, i) => ({
    label: typeof raw(d, 'label') === 'string' && String(raw(d, 'label')).trim() ? String(raw(d, 'label')).trim() : `Gerät ${i + 1}`,
    watts: numberOrNull(raw(d, 'watts')) ?? 0,
    hoursPerDay: numberOrNull(raw(d, 'hoursPerDay')) ?? 0,
    // P-K8: eigene Tage des Geräts, sonst die Heiztage.
    days: numberOrNull(raw(d, 'days')),
  }))
}

const HOW: Record<OperatingPowerMethod, string> = { estimate: 'geschätzt', measured: 'gemessen', own: 'selbst geschätzt' }

// Die Verteilung, die der Abzug vom Allgemeinstrom übernimmt (Abweichung 6), und die der Betriebsstrom
// von der Brennstoffposition übernimmt (Abweichung 5). Einzelbeträge und Gemeinschaftsabrechnung lassen
// sich nicht übertragen.
const UNCOPYABLE: readonly string[] = ['amounts', 'external']
const distributionOf = (c: CostItem) => ({
  key: c.key,
  ...(c.meterType ? { meterType: c.meterType } : {}),
  ...(c.directUnitId ? { directUnitId: c.directUnitId } : {}),
  ...(c.customShares ? { customShares: c.customShares } : {}),
  ...(c.participantUnitIds ? { participantUnitIds: c.participantUnitIds } : {}),
})

export async function bookOperatingPower(db: Database, plantId: string, body: unknown, newId: () => string): Promise<OperatingPowerBooking | null> {
  const plant = (await readHeatingPlants(db)).find((p) => p.id === plantId)
  if (!plant) return null
  // P-W5: Bei Wärmepumpe und Stromheizung ist der Strom Brennstoff, keine Schätzhilfe.
  const refusal = operatingPowerRefusal(plant.energy)
  if (refusal) throw new HeatingError(400, refusal)
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  // heatingPeriodOf wirft selbst HeatingError(400), wenn es die Heizperiode nicht gibt.
  const h = heatingPeriodOf(ctx, typeof raw(body, 'period') === 'string' ? String(raw(body, 'period')) : '')
  if (await heatingPeriodClosed(db, ctx, h)) {
    throw new HeatingError(409, 'Die Abrechnung dieser Heizperiode ist abgeschlossen. Öffnen Sie sie wieder, bevor Sie den Betriebsstrom erfassen.')
  }
  const items = await readCostItems(db)
  const generalId = typeof raw(body, 'generalItemId') === 'string' ? String(raw(body, 'generalItemId')) : ''
  const general = items.find((c) => c.id === generalId && c.propertyId === plant.propertyId)
  if (!general || general.category !== GENERAL_POWER_CATEGORY || !(general.amountCents > 0) || general.operatingPower !== undefined) {
    throw new HeatingError(400, `Bitte wählen Sie die Stromrechnung des Hauses: eine Position der Kostenart „${GENERAL_POWER_CATEGORY}“ mit positivem Betrag.`)
  }
  // P-W3: Steht der Allgemeinstrom in einer abgeschlossenen Abrechnung, erreichte ein Abzug dort die
  // Mieter nicht mehr, und sie zahlten den Betriebsstrom zweimal (V ZR 166/15 Rn. 13).
  if (await itemPeriodClosed(db, general)) {
    throw new HeatingError(409, `Der Allgemeinstrom „${general.description}“ steht in einer abgeschlossenen Abrechnung; ein Abzug dort käme bei den Mietern nicht mehr an. Öffnen Sie diese Abrechnung wieder, bevor Sie den Betriebsstrom erfassen, oder wählen Sie die Stromrechnung eines offenen Zeitraums.`)
  }
  if (general.key === 'amounts') {
    throw new HeatingError(400, 'Der Allgemeinstrom ist nach Einzelbeträgen verteilt; einen Abzug in derselben Verteilung gibt es nicht. Ziehen Sie den Betriebsstrom bitte in den Beträgen selbst ab.')
  }
  if (general.key === 'external') {
    // P-W4: Die Gemeinschaft muss es tun, tut es aber nicht immer (V ZR 166/15 war genau dieser Fall).
    throw new HeatingError(400, 'Der Allgemeinstrom ist laut Gemeinschaftsabrechnung verteilt; einen Abzug in derselben Verteilung gibt es nicht. Den Betriebsstrom mit den Heizkosten zu verteilen, dazu ist die Gemeinschaft verpflichtet (BGH, Urteil vom 03.06.2016, V ZR 166/15). Prüfen Sie in der Hausgeldabrechnung, ob der Betriebsstrom bei den Heizkosten steht; steht er im Allgemeinstrom, wenden Sie sich an die Verwaltung.')
  }
  // Drei Wege: selbst geschätzt (P-W2), gemessen, nach Leistung und Tagen.
  const ownCents = numberOrNull(raw(body, 'ownCents'))
  const measuredKwh = numberOrNull(raw(body, 'measuredKwh'))
  const method: OperatingPowerMethod = ownCents !== null || has(body, 'basis') ? 'own' : measuredKwh !== null ? 'measured' : 'estimate'
  const share = method === 'own'
    ? ownEstimateShare({ cents: ownCents, basis: typeof raw(body, 'basis') === 'string' ? String(raw(body, 'basis')) : '', billCents: general.amountCents })
    : operatingPowerShare({
      devices: method === 'estimate' ? devicesOf(raw(body, 'devices')) : null,
      heatingDays: method === 'estimate' ? numberOrNull(raw(body, 'heatingDays')) : null,
      measuredKwh,
      billKwh: numberOrNull(raw(body, 'billKwh')) ?? 0,
      billCents: general.amountCents,
    })
  if ('error' in share) throw new HeatingError(400, share.error)
  const how = HOW[method]
  const operatingPowerBasis = basisOf(share.steps)

  let heatingBody: Record<string, unknown> | null = null
  if (plant.method !== 'service') {
    const base = {
      propertyId: plant.propertyId, period: h.key, category: HEATING_CATEGORY, description: `Betriebsstrom Heizung (${how})`,
      amountCents: share.cents, heatingPlantId: plant.id, heatingPart: 'operating', operatingPower: 'included', operatingPowerBasis,
    }
    if (plant.method === 'self') {
      heatingBody = { ...base, key: 'heatingSystem', heatingTarget: 'both' }
    } else {
      const fuel = items
        .filter((c) => c.heatingPlantId === plant.id && c.period === h.key && (c.heatingPart === 'fuel' || (c.fuelDeliveryId ?? null) !== null))
        .sort((a, b) => b.amountCents - a.amountCents)[0]
      if (!fuel) {
        // P-K2: Verteilt wird nach § 7 Abs. 1 (beim Warmwasser § 8 Abs. 1); Abs. 2 zählt die Kosten auf.
        throw new HeatingError(400, `Erfassen Sie zuerst die Brennstoffposition der Heizperiode; der Betriebsstrom wird nach ihrem Schlüssel verteilt (§ 7 Abs. 1 und 2 HeizkostenV).`)
      }
      if (UNCOPYABLE.includes(fuel.key)) {
        throw new HeatingError(400, `„${fuel.description}“ ist nach Einzelbeträgen oder laut Gemeinschaftsabrechnung verteilt; in diesem Fall ziehen Sie den Betriebsstrom bitte in den Beträgen selbst ab.`)
      }
      heatingBody = { ...base, ...distributionOf(fuel), ...(fuel.heatingTarget ? { heatingTarget: fuel.heatingTarget } : {}) }
    }
  }
  const heatingId = heatingBody ? newId() : null
  const deductionId = newId()
  const deductionBody = {
    propertyId: plant.propertyId, period: general.period, category: GENERAL_POWER_CATEGORY,
    // P-K9: Beim Messdienst hat der Abzug kein Gegenstück in Mietfuchs; die Beschreibung sagt, wohin der
    // Betrag gehört. Meldet der Vermieter ihn nicht, trägt er ihn selbst (zulässig, V ZR 166/15 Rn. 15).
    description: `Abzug Betriebsstrom Heizung (${how})${plant.method === 'service' ? ', an Messdienst gemeldet' : ''}`,
    amountCents: -share.cents, ...distributionOf(general),
    operatingPower: 'deduction', operatingPowerBasis, ...(heatingId ? { operatingPowerItemId: heatingId } : {}),
  }
  await db.transaction(async (tx) => {
    if (heatingBody && heatingId) await insertCostItemIn(tx, heatingId, heatingBody)
    await insertCostItemIn(tx, deductionId, deductionBody)
  })
  const after = await readCostItems(db)
  const deduction = after.find((c) => c.id === deductionId)
  if (!deduction) throw new Error('Der Abzug ist nach dem Anlegen nicht auffindbar.')
  return { method, share: { cents: share.cents, steps: share.steps }, heatingItem: heatingId ? (after.find((c) => c.id === heatingId) ?? null) : null, deduction }
}
```

(`raw`, `has` und `itemPeriodClosed` sind aus repository.ts exportiert. Verlangt `createHeatingPlant` im
Test für eine Wärmepumpe weitere Angaben (etwa `heatPumpMajority`), diese im Test ergänzen; die
Ablehnung steht vor jeder anderen Prüfung. `heatingTarget` und `fuelDeliveryId` stehen an `CostItem`. Die Konstante `UNCOPYABLE` bleibt für die
Brennstoffposition; beim Allgemeinstrom stehen die beiden Fälle mit je eigenem Satz.)

- [ ] **Step 4: Route (`server/src/index.ts`)**

Import `import { bookOperatingPower } from './db/operatingPower.ts'`. Bei den Routen der Heizanlage
(`/api/heating-plants`, PR 4 Task 6) anhängen:

```ts
// Betriebsstrom und Abzug beim Allgemeinstrom gemeinsam anlegen (Heizung PR 15, #212).
app.post('/api/heating-plants/:id/operating-power', async (req, res) => {
  const booked = await writeData((db) => bookOperatingPower(db, req.params.id, bodyObject(req), newId))
  if (!booked) return res.status(404).json({ error: 'Diese Heizanlage gibt es nicht (mehr).' })
  res.status(201).json(booked)
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-betriebsstrom.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS. Im Test zum Messdienst steht `operatingPowerItemId` als `undefined`, weil read.ts ein
fehlendes Feld weglässt.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/operatingPower.ts server/src/index.ts server/test/db-betriebsstrom.test.ts server/test/api.test.ts
git commit -m "Betriebsstrom: Schätzhilfe legt Betriebsstrom und Abzug in einer Transaktion an

Bei freien Schlüsseln nach dem Schlüssel des Brennstoffs, bei eigener
Abrechnung nach der Heizkostenverordnung, beim Messdienst nur der Abzug.
Die Grundlage der Schätzung steht an beiden Positionen; dritter Weg
„Betrag selbst geschätzt“; 409, wenn der Allgemeinstrom in einer
abgeschlossenen Abrechnung steht; keine Hilfe bei Wärmepumpe und
Stromheizung.

Refs #212"
```

---

### Task 5: Berechnung: `heating.operating-power-double`

**Files:**
- Create: `server/src/operatingPower.ts`
- Modify: `server/src/snapshot.ts`, `server/src/calc.ts`, `server/test/law-literals.test.ts` (`ENGINE_FILES`, `ALLOWED`); `shared/glossary.ts` nur, falls `TermId` den Begriff erst hier braucht (er steht seit Task 1)
- Test: `server/test/calc-betriebsstrom.test.ts` (neu)

**Interfaces:**
- Consumes: `OperatingPowerDeduction` (Task 2); `computeSettlement`, `warn`, `items`, `fmtCents`, `noticeKinds`, die Rechenweg-Schritte einer Zeile (um Zeile 4034); `snapshotFor`, `heatingSnapshotFor`, `SnapshotCostItem`, `SnapshotClosedSettlement` (`itemTotals`), `snapshotOfPeriod`; `periodOfKey`, `periodLabel` (shared/period.ts).
- Produces:
  - `server/src/operatingPower.ts`: `type OperatingPowerFinding = { itemId: string; description: string; amountCents: number; deductedCents: number; differenceCents: number; notCredited: { description: string; label: string; amountCents: number }[] }`, `operatingPowerFindings(distributed: readonly Pick<CostItem, 'id' | 'description' | 'amountCents' | 'operatingPower'>[], deductions: readonly OperatingPowerDeduction[]): OperatingPowerFinding[]`, `operatingPowerText(f: OperatingPowerFinding, fmtCents: (c: number) => string): string`
  - snapshot.ts: `SnapshotCostItem` pickt zusätzlich `'operatingPower' | 'operatingPowerItemId' | 'operatingPowerBasis'`; `Snapshot.operatingPowerDeductions?: OperatingPowerDeduction[]`; `deductionsOf(items: readonly (SnapshotCostItem & { propertyId: string })[], propertyId: string, closed: readonly { period: PeriodKey; itemTotals?: Record<string, number> | null }[], rules: PeriodRules): OperatingPowerDeduction[]`
  - calc.ts: Code `heating.operating-power-double` (warning); Rechenweg-Schritt „Grundlage der Schätzung“ (P-W1)

- [ ] **Step 1: Write the failing tests**

`server/test/calc-betriebsstrom.test.ts`:

```ts
// Betriebsstrom im Allgemeinstrom (Heizung PR 15, #212, Entwurf 10.1): Steckt der Betriebsstrom einer
// Heizposition auch in der Stromrechnung des Hauses, muss dort ein Abzug in gleicher Höhe stehen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { operatingPowerFindings } from '../src/operatingPower.ts'
import { deductionsOf, snapshotOfPeriod, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey, previousPeriod } from '../../shared/period.ts'
import type { CostItem, OperatingPowerDeduction } from '../../shared/types.ts'

const P = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum 2025')
const tenancy = (id: string, unitId: string): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const haus = (costItems: SnapshotCostItem[]): SnapshotSource => ({
  units: [{ id: 'u1', name: 'EG', areaM2: 60, participates: true }, { id: 'u2', name: 'OG', areaM2: 40, participates: true }],
  tenancies: [tenancy('t1', 'u1'), tenancy('t2', 'u2')],
  costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})
const betriebsstrom: SnapshotCostItem = { id: 'bs', period: periodKey('2025-01'), category: 'Heizung und Warmwasser', description: 'Betriebsstrom Heizung', amountCents: 14784, key: 'area', heatingPart: 'operating', operatingPower: 'included' }
const hausstrom: SnapshotCostItem = { id: 'strom', period: periodKey('2025-01'), category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 105000, key: 'area' }
const abzug = (cents: number, id = 'ab', period = '2025-01', closed: OperatingPowerDeduction['closed'] = null): OperatingPowerDeduction =>
  ({ id, itemId: 'bs', period: periodKey(period), description: 'Abzug Betriebsstrom Heizung', amountCents: -cents, closed })
const settle = (items: SnapshotCostItem[], deductions: OperatingPowerDeduction[]) =>
  computeSettlement({ ...snapshotOfPeriod(haus(items), P, previousPeriod(CALENDAR_RULES, P)), operatingPowerDeductions: deductions })
const codes = (s: ReturnType<typeof settle>) => (s.notices ?? []).filter((n) => n.code === 'heating.operating-power-double')

test('Ohne Abzug: warning mit Betrag, der doppelt verteilt wird', () => {
  const s = settle([betriebsstrom, hausstrom], [])
  const [n, ...rest] = codes(s)
  if (!n) return assert.fail('kein Hinweis')
  assert.equal(rest.length, 0)
  assert.equal(n.level, 'warning')
  assert.deepEqual(n.subject, { kind: 'costItem', id: 'bs' })
  assert.match(n.text, /„Betriebsstrom Heizung“/)
  assert.match(n.text, /abgezogen sind dort 0,00 € statt 147,84 €/)
  assert.match(n.text, /147,84 € werden damit doppelt verteilt/)
  assert.match(n.text, /V ZR 166\/15/)
  // P-K3: auch der Warmwasseranteil (§ 8 Abs. 2 HeizkostenV).
  assert.match(n.text, /§ 7 Abs\. 2, § 8 Abs\. 2 HeizkostenV/)
  // P-K5: Selbst tragen ist zulässig; der Text sagt es.
  assert.match(n.text, /oder tragen Sie den Betriebsstrom selbst/)
})

// P-W3: Ein Abzug in einer abgeschlossenen Abrechnung zählt nur, wenn er im eingefrorenen Stand steht.
test('Abzug in einer abgeschlossenen Abrechnung: im eingefrorenen Stand zählt er, sonst Warnung mit eigenem Satz', () => {
  const gutgeschrieben = abzug(14784, 'ab', '2024-01', { label: '2024', credited: true })
  assert.equal(codes(settle([betriebsstrom, hausstrom], [gutgeschrieben])).length, 0)
  const nicht = abzug(14784, 'ab', '2024-01', { label: '2024', credited: false })
  const n = codes(settle([betriebsstrom, hausstrom], [nicht]))[0] ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /abgezogen sind dort 0,00 € statt 147,84 €/)
  assert.match(n.text, /Der Abzug „Abzug Betriebsstrom Heizung“ \(147,84 €\) steht in der abgeschlossenen Abrechnung 2024, aber nicht in ihrem eingefrorenen Stand; den Mietern ist er nicht gutgeschrieben/)
  assert.match(n.text, /Öffnen Sie die Abrechnung 2024 wieder/)
})

// P-W2: Ein von Hand erfasster Abzug zählt, sobald er verknüpft ist; unverknüpft bleibt die Warnung.
test('Handabzug: verknüpft keine Warnung, unverknüpft die Warnung (über deductionsOf, wie snapshotFor)', () => {
  const p = (c: SnapshotCostItem): SnapshotCostItem & { propertyId: string } => ({ ...c, propertyId: 'o1' })
  const hand: SnapshotCostItem = { ...hausstrom, id: 'hand', description: 'Abzug Heizstrom, Bruchteil der Brennstoffkosten', amountCents: -14784 }
  const verknuepft = { ...hand, operatingPower: 'deduction' as const, operatingPowerItemId: 'bs' }
  const mit = deductionsOf([p(betriebsstrom), p(hausstrom), p(verknuepft)], 'o1', [], CALENDAR_RULES)
  assert.equal(codes(settle([betriebsstrom, hausstrom, verknuepft], mit)).length, 0)
  const ohne = deductionsOf([p(betriebsstrom), p(hausstrom), p(hand)], 'o1', [], CALENDAR_RULES)
  assert.equal(codes(settle([betriebsstrom, hausstrom, hand], ohne)).length, 1)
})

// P-W1: Die Grundlage der Schätzung steht im Rechenweg jeder Zeile der Position (nur in der Oberfläche,
// CalcSteps ist `no-print`), am Betriebsstrom wie am Abzug.
test('Rechenweg: „Grundlage der Schätzung“ an Betriebsstrom und Abzug, ohne Grundlage kein Schritt', () => {
  const grundlage = 'Brenner: 120 W × 6 h × 220 Tage = 158,4 kWh\nzusammen 158,4 kWh von 3.000 kWh der Stromrechnung = 5,28 %'
  const bs = { ...betriebsstrom, operatingPowerBasis: grundlage }
  const ab: SnapshotCostItem = { ...hausstrom, id: 'ab', description: 'Abzug', amountCents: -14784, operatingPower: 'deduction', operatingPowerItemId: 'bs', operatingPowerBasis: grundlage }
  const s = settle([bs, hausstrom, ab], [abzug(14784)])
  const stepsOf = (id: string) => s.statements.flatMap((st) => st.rows).filter((r) => r.costItemId === id).flatMap((r) => r.steps ?? [])
  for (const id of ['bs', 'ab']) {
    const step = stepsOf(id).find((x) => x.label === 'Grundlage der Schätzung') ?? assert.fail(`${id}: kein Schritt`)
    assert.equal(step.value, 'Brenner: 120 W × 6 h × 220 Tage = 158,4 kWh; zusammen 158,4 kWh von 3.000 kWh der Stromrechnung = 5,28 %')
    assert.equal(step.term, 'operatingPower')
  }
  assert.ok(!stepsOf('strom').some((x) => x.label === 'Grundlage der Schätzung'))
})

test('Abzug in gleicher Höhe: kein Hinweis; jeder zahlt den Strom einmal', () => {
  const ab: SnapshotCostItem = { ...hausstrom, id: 'ab', description: 'Abzug Betriebsstrom Heizung', amountCents: -14784, operatingPower: 'deduction', operatingPowerItemId: 'bs' }
  const s = settle([betriebsstrom, hausstrom, ab], [abzug(14784)])
  assert.equal(codes(s).length, 0)
  // Summe der verteilten Kosten = Stromrechnung: 1.050,00 €
  assert.equal(s.totalCostsCents, 105000)
})

test('Abzug zu klein und zu groß: Text mit der Differenz, je in seiner Richtung', () => {
  const klein = codes(settle([betriebsstrom, hausstrom], [abzug(10000)]))[0] ?? assert.fail('kein Hinweis')
  assert.match(klein.text, /abgezogen sind dort 100,00 € statt 147,84 €; 47,84 € werden damit doppelt verteilt/)
  const gross = codes(settle([betriebsstrom, hausstrom], [abzug(20000)]))[0] ?? assert.fail('kein Hinweis')
  assert.match(gross.text, /abgezogen sind dort 200,00 €, 52,16 € mehr als der Betriebsstrom/)
})

test('Review Focus 5: Abzug in einem anderen Zeitraum zählt, denn er gehört zur Position', () => {
  assert.equal(codes(settle([betriebsstrom, hausstrom], [abzug(14784, 'ab', '2026-01')])).length, 0)
  assert.equal(codes(settle([betriebsstrom, hausstrom], [abzug(7392, 'a1', '2025-01'), abzug(7392, 'a2', '2026-01')])).length, 0)
})

test('Wer nichts einstellt, merkt nichts: ohne Kennzeichnung kein Hinweis und dieselbe Abrechnung', () => {
  const ohne = settle([{ ...betriebsstrom, operatingPower: undefined }, hausstrom], [])
  assert.equal(codes(ohne).length, 0)
  const ohneFeld = computeSettlement(snapshotOfPeriod(haus([{ ...betriebsstrom, operatingPower: undefined }, hausstrom]), P, previousPeriod(CALENDAR_RULES, P)))
  assert.deepEqual(ohne, ohneFeld)
})

test('Befund rein: nur Positionen mit „included“, Abzüge nur über ihren Verweis', () => {
  const items: Pick<CostItem, 'id' | 'description' | 'amountCents' | 'operatingPower'>[] = [
    { id: 'bs', description: 'B', amountCents: 100, operatingPower: 'included' },
    { id: 'x', description: 'X', amountCents: 100 },
  ]
  const fremd: OperatingPowerDeduction = { id: 'y', itemId: null, period: periodKey('2025-01'), description: 'Messdienst', amountCents: -50, closed: null }
  assert.deepEqual(operatingPowerFindings(items, [fremd]), [{ itemId: 'bs', description: 'B', amountCents: 100, deductedCents: 0, differenceCents: 100, notCredited: [] }])
})

test('Schnappschuss: deductionsOf nimmt Abzüge des Objekts aus allen Zeiträumen und sieht im eingefrorenen Stand nach (P-W3)', () => {
  const c = (id: string, propertyId: string, period: string, op?: 'deduction'): CostItem => ({
    id, propertyId, period: periodKey(period), category: 'Beleuchtung/Allgemeinstrom', description: id, amountCents: op ? -10 : 10, key: 'area',
    ...(op ? { operatingPower: op, operatingPowerItemId: 'bs' } : {}),
  })
  const items = [c('a', 'o1', '2024-01', 'deduction'), c('b', 'o1', '2026-01', 'deduction'), c('c', 'o2', '2025-01', 'deduction'), c('d', 'o1', '2025-01'), c('e', 'o1', '2023-01', 'deduction')]
  // 2024 abgeschlossen, Abzug a steht im eingefrorenen Stand; 2023 abgeschlossen, e fehlt dort.
  const closed = [{ period: periodKey('2024-01'), itemTotals: { a: -10 } }, { period: periodKey('2023-01'), itemTotals: { x: 5 } }]
  const list = deductionsOf(items, 'o1', closed, CALENDAR_RULES)
  assert.deepEqual(list.map((d) => [d.id, d.period, d.itemId, d.closed]), [
    ['a', '2024-01', 'bs', { label: '2024', credited: true }],
    ['b', '2026-01', 'bs', null],
    ['e', '2023-01', 'bs', { label: '2023', credited: false }],
  ])
  // Ein unlesbarer eingefrorener Stand (`itemTotals` null) gilt als nicht gutgeschrieben (Abweichung 6a).
  assert.deepEqual(deductionsOf(items, 'o1', [{ period: periodKey('2024-01'), itemTotals: null }], CALENDAR_RULES)[0]?.closed, { label: '2024', credited: false })
})
```

(`periodLabel` eines Kalenderjahrs ergibt „2024“; gibt es dort einen anderen Wortlaut, die Erwartung an
`periodLabel(periodOfKey(CALENDAR_RULES, periodKey('2024-01')))` angleichen statt die Funktion zu umgehen.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-betriebsstrom.test.ts`
Expected: FAIL, `Cannot find module '…/src/operatingPower.ts'`.

- [ ] **Step 3: Befund (`server/src/operatingPower.ts`, neu)**

```ts
// Betriebsstrom im Allgemeinstrom (Heizung PR 15, #212, Entwurf 10.1). Eine Position mit
// `operatingPower: 'included'` sagt: Dieser Strom steckt auch in der Stromrechnung des Hauses. Dann muss
// beim Allgemeinstrom ein Abzug in gleicher Höhe stehen, sonst zahlen die Mieter ihn doppelt
// (§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15). Die Abzüge zählen über ihren
// Verweis und aus jedem Zeitraum (Review Focus 5); geprüft werden nur die Positionen, die die
// Abrechnung verteilt, damit der Hinweis genau einmal erscheint, nämlich dort, wo der Betriebsstrom steht.
import type { CostItem, OperatingPowerDeduction } from '../../shared/types.ts'

export type OperatingPowerFinding = {
  itemId: string
  description: string
  amountCents: number
  deductedCents: number
  differenceCents: number
  // P-W3: Abzüge in einer abgeschlossenen Abrechnung, die nicht im eingefrorenen Stand stehen. Sie zählen
  // nicht, denn den Mietern sind sie nicht gutgeschrieben; der Text nennt sie.
  notCredited: { description: string; label: string; amountCents: number }[]
}

export function operatingPowerFindings(
  distributed: readonly Pick<CostItem, 'id' | 'description' | 'amountCents' | 'operatingPower'>[],
  deductions: readonly OperatingPowerDeduction[],
): OperatingPowerFinding[] {
  const out: OperatingPowerFinding[] = []
  for (const item of distributed) {
    if (item.operatingPower !== 'included') continue
    const mine = deductions.filter((d) => d.itemId === item.id)
    const counted = mine.filter((d) => d.closed === null || d.closed.credited)
    const notCredited = mine.filter((d) => d.closed !== null && !d.closed.credited)
      .map((d) => ({ description: d.description, label: d.closed?.label ?? '', amountCents: -d.amountCents }))
    const deductedCents = -counted.reduce((a, d) => a + d.amountCents, 0)
    const differenceCents = item.amountCents - deductedCents
    if (differenceCents !== 0) out.push({ itemId: item.id, description: item.description, amountCents: item.amountCents, deductedCents, differenceCents, notCredited })
  }
  return out
}

// Zwei Texte, ein Code (Abweichung 2): zu wenig abgezogen heißt doppelt verteilt, zu viel heißt, der
// Vermieter trägt einen Teil des Allgemeinstroms selbst. Dazu je nicht gutgeschriebenem Abzug ein Satz
// (P-W3). Die Norm nennt auch das Warmwasser (P-K3); selbst tragen ist zulässig (P-K5, V ZR 166/15 Rn. 15).
export function operatingPowerText(f: OperatingPowerFinding, fmtCents: (c: number) => string): string {
  const head = `„${f.description}“: Dieser Betriebsstrom steckt nach Ihrer Angabe auch in der Stromrechnung des Allgemeinstroms`
  const law = '(§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15)'
  const frozen = f.notCredited.map((n) =>
    ` Der Abzug „${n.description}“ (${fmtCents(n.amountCents)}) steht in der abgeschlossenen Abrechnung ${n.label}, aber nicht in ihrem eingefrorenen Stand; den Mietern ist er nicht gutgeschrieben. ` +
    `Öffnen Sie die Abrechnung ${n.label} wieder und stellen Sie sie neu zu, damit er ankommt.`).join('')
  if (f.differenceCents > 0) {
    return `${head}; abgezogen sind dort ${fmtCents(f.deductedCents)} statt ${fmtCents(f.amountCents)}; ${fmtCents(f.differenceCents)} werden damit doppelt verteilt. ` +
      `Erfassen Sie beim Allgemeinstrom einen Abzug in Höhe des Betriebsstroms, etwa mit der Karte „Betriebsstrom“ auf der Seite Heizkosten, oder tragen Sie den Betriebsstrom selbst ${law}.${frozen}`
  }
  return `${head}; abgezogen sind dort ${fmtCents(f.deductedCents)}, ${fmtCents(-f.differenceCents)} mehr als der Betriebsstrom. ` +
    `Diesen Teil des Allgemeinstroms tragen Sie damit selbst; passen Sie den Abzug an den Betriebsstrom an ${law}.${frozen}`
}
```

Hinweis zum ersten Text: Der Test erwartet „abgezogen sind dort 0,00 € statt 147,84 €“ und „147,84 €
werden damit doppelt verteilt“; beides steht so darin (`fmtCents(0)` ergibt „0,00 €“).

`server/test/law-literals.test.ts`: `ENGINE_FILES` um `'server/src/operatingPower.ts'` ergänzen und in
`ALLOWED` anhängen:

```ts
  { file: 'server/src/operatingPower.ts', match: '03.06.2016', reason: 'Datum einer Entscheidung im Zitat (BGH V ZR 166/15, Betriebsstrom), kein Rechtswert' },
```

- [ ] **Step 4: Schnappschuss (`server/src/snapshot.ts`)**

Importe: `OperatingPowerDeduction` als Typ aus `'../../shared/types.ts'`; `periodLabel` und `periodOfKey`
aus `'../../shared/period.ts'`, soweit nicht schon da. In `SnapshotCostItem` die gepickten Felder hinter
`'fuelDeliveryId'` um `| 'operatingPower' | 'operatingPowerItemId' | 'operatingPowerBasis'` ergänzen (die
Grundlage für den Rechenweg, P-W1; verteilt wird nach keinem). In `Snapshot` als letztes Feld (hinter
`lawOverrides?`):

```ts
  // Abzüge des Betriebsstroms beim Allgemeinstrom aus allen Zeiträumen des Objekts (Heizung PR 15). Sie
  // gehören zu der Position, auf die sie zeigen, nicht zum Zeitraum (Review Focus 5). Fehlt das Feld
  // (ein von Hand gebauter Schnappschuss, der Umstieg), gibt es keine.
  operatingPowerDeductions?: OperatingPowerDeduction[]
```

Vor `snapshotFor`:

```ts
// Die Abzüge des Betriebsstroms eines Objekts (Heizung PR 15), in der Reihenfolge der Positionen. Steht
// ein Abzug in einem abgeschlossenen Zeitraum, zählt er nur, wenn der eingefrorene Stand ihn mit seinem
// Betrag führt (P-W3): Sonst hat ihn kein Mieter bekommen. Ein unlesbarer Stand (`itemTotals` null)
// gilt als nicht gutgeschrieben; ein Hinweis zu viel ist hier der harmlosere Ausgang (Abweichung 6a).
export function deductionsOf(
  items: readonly (SnapshotCostItem & { propertyId: string })[],
  propertyId: string,
  closed: readonly { period: PeriodKey; itemTotals?: Record<string, number> | null }[],
  rules: PeriodRules,
): OperatingPowerDeduction[] {
  return items
    .filter((c) => c.propertyId === propertyId && c.operatingPower === 'deduction')
    .map((c) => {
      const frozen = closed.find((s) => s.period === c.period)
      const p = frozen ? periodOfKey(rules, c.period) : null
      return {
        id: c.id, itemId: c.operatingPowerItemId ?? null, period: c.period, description: c.description, amountCents: c.amountCents,
        closed: frozen ? { label: p ? periodLabel(p) : String(c.period), credited: frozen.itemTotals?.[c.id] === c.amountCents } : null,
      }
    })
}
```

In `snapshotFor` im zurückgegebenen Objekt ergänzen (`narrowed` ist der Bestand des Objekts aus allen
Zeiträumen, `narrowed.closedSettlements` trägt `itemTotals`, `objectRules` steht dort schon):

```ts
    operatingPowerDeductions: deductionsOf(narrowed.costItems, propertyId, narrowed.closedSettlements, objectRules),
```

In `heatingSnapshotFor` (PR 5, Weg d) ebenso, mit denselben drei Argumenten aus `narrowed` und
`objectRules`: Der Allgemeinstrom gehört zur Abrechnung des Objekts, nicht zur Heizkostenabrechnung, und
abgeschlossen ist er mit ihr. Der Unteraufruf nach Weg b in `computeSettlement` reicht `...snapshot`
weiter und hat das Feld damit ohnehin. `snapshotOf` für Umstieg und Regression bekommt das Feld nicht:
Die db.json kennt keinen Abzug.

- [ ] **Step 5: Hinweis (`server/src/calc.ts`)**

Import `import { operatingPowerFindings, operatingPowerText } from './operatingPower.ts'`. In `noticeKinds`
hinter den Codes der Heizung:

```ts
  // Heizung PR 15 (#212): Betriebsstrom, der auch im Allgemeinstrom steckt, ohne Abzug in gleicher Höhe.
  'heating.operating-power-double': { level: 'warning', title: 'Betriebsstrom und Abzug beim Allgemeinstrom passen nicht zusammen', terms: ['operatingPower', 'heatingCostOrdinance'] },
```

In `computeSettlement` direkt vor `// Die Höchstdauer hat P gebildet (shared/period.ts); eingefroren wird sie hier.`
(hinter der Schleife zu `law.value-overridden` aus PR 17):

```ts
  // Betriebsstrom im Allgemeinstrom (Heizung PR 15, #212): geprüft werden die Positionen, die diese
  // Abrechnung verteilt (`items`); bei Weg b tut das der Unteraufruf der Heizperiode, und sein Hinweis
  // wird übernommen (ohne Doppel, PR 5). Die Abzüge kommen aus allen Zeiträumen; einer in einer
  // abgeschlossenen Abrechnung zählt nur, wenn er im eingefrorenen Stand steht (P-W3).
  for (const f of operatingPowerFindings(items, snapshot.operatingPowerDeductions ?? [])) {
    warn('heating.operating-power-double', operatingPowerText(f, fmtCents), itemSubject({ id: f.itemId }))
  }
```

Rechenweg (P-W1): In den Schritten einer Zeile (um Zeile 4034, `const steps: CalcStep[] = [ … ]` mit
„Rechnungsbetrag“ und „Umlageschlüssel“) direkt hinter dem Aufbau der Liste und vor `if (carry)`:

```ts
      // Die Grundlage der Schätzung des Betriebsstroms (Heizung PR 15, P-W1): Bestreitet ein Mieter den
      // Betrag, muss der Vermieter sie darlegen. Nur im Rechenweg, der nicht gedruckt wird.
      if (item.operatingPowerBasis) {
        steps.push({ label: 'Grundlage der Schätzung', value: item.operatingPowerBasis.split('\n').join('; '), term: 'operatingPower' })
      }
```

Die Regression des Umstiegs nimmt `steps` ohnehin aus, und die db.json kennt keine Grundlage; eine
Abrechnung ohne Grundlage hat denselben Rechenweg wie vorher (Golden und `calc-rechenweg.test.ts` bleiben
grün).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-betriebsstrom.test.ts test/calc-notices.test.ts test/calc-rechenweg.test.ts test/glossary.test.ts test/settlement-golden.test.ts test/calc-wortlaut.test.ts test/law-literals.test.ts test/law-wording.test.ts && npm run typecheck`
Expected: PASS. `calc-notices.test.ts` prüft, dass jeder Code einen Begriff hat und jede Stufe gültig ist;
`operatingPower` steht seit Task 1 im Lexikon.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/operatingPower.ts server/src/snapshot.ts server/src/calc.ts server/test/calc-betriebsstrom.test.ts server/test/law-literals.test.ts
git commit -m "Abrechnung: Betriebsstrom ohne Abzug in gleicher Höhe beim Allgemeinstrom meldet den Betrag

heating.operating-power-double (warning) nennt, was doppelt verteilt wird
oder was der Vermieter zu viel selbst trägt; Abzüge zählen aus jedem
Zeitraum, aus einer abgeschlossenen Abrechnung nur mit dem eingefrorenen
Stand. Die Grundlage der Schätzung steht im Rechenweg.

Refs #212"
```

---

### Task 6: Oberfläche: Frage am Kostenformular und Karte „Betriebsstrom“

**Files:**
- Modify: `client/src/costForm.ts`, `shared/costItem.ts` (`CostItemBody`), `client/src/pages/Kosten.tsx`, `client/src/pages/Heizkosten.tsx`
- Create: `client/src/operatingPowerForm.ts`, `client/src/components/OperatingPowerCard.tsx`, `client/src/components/OperatingPowerFields.tsx`
- Test: `client/src/costForm.test.ts`, `client/src/operatingPowerForm.test.ts` (neu), `client/src/components/OperatingPowerCard.test.tsx` (neu), `client/src/components/OperatingPowerFields.test.tsx` (neu)

**Interfaces:**
- Consumes: `operatingPowerShare`, `ownEstimateShare`, `operatingPowerRefusal`, `GENERAL_POWER_CATEGORY` (Task 3); Route aus Task 4; `ItemForm`, `EMPTY_ITEM_FORM`, `itemToForm`, `buildCostItemBody` (costForm.ts); `CostItemBody` (shared/costItem.ts); `HEATING_CATEGORY`; `api`, `errorText`, `fmtEuro`, `parseEuro`; `useToast`, `Term`, `withProperty`; `HeatingPeriodView`, `HeatingPlant`.
- Produces:
  - costForm.ts: `ItemForm.operatingPower: '' | 'included' | 'deduction'`, `ItemForm.operatingPowerItemId: string`, `ItemForm.operatingPowerBasis: string`; `OPERATING_POWER_OPTIONS`; `showsOperatingPower(form)`; `showsDeductionLink(form)`; `deductionChoices(items)`; `deductionChoiceOf(form)`; `withDeductionChoice(form, value)`; `withOperatingPower(body, form)`
  - shared/costItem.ts: `CostItemBody` mit den drei optionalen Feldern
  - Komponente `OperatingPowerFields({ form, items, onChange })`
  - operatingPowerForm.ts: `type DeviceRow = { label: string; watts: string; hours: string; days: string }`, `type OperatingPowerForm = { generalItemId: string; mode: 'estimate' | 'measured' | 'own'; devices: DeviceRow[]; heatingDays: string; measuredKwh: string; billKwh: string; ownAmount: string; basis: string }`, `emptyOperatingPowerForm()`, `generalItemOptions(items)`, `operatingPowerPreview(form, items)`, `operatingPowerRequest(form, period)`
  - Komponente `OperatingPowerCard({ plant, view, items, onBooked })`, `plant` mit `energy`

- [ ] **Step 1: Write the failing tests**

`client/src/operatingPowerForm.test.ts`:

```ts
import { expect, test } from 'vitest'
import { emptyOperatingPowerForm, generalItemOptions, operatingPowerPreview, operatingPowerRequest, type OperatingPowerForm } from './operatingPowerForm'
import type { CostItem } from './types'

const strom = { id: 'strom', propertyId: 'o', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom 2025', amountCents: 105000, key: 'area' } as CostItem
const ausgefuellt = (over: Partial<OperatingPowerForm> = {}): OperatingPowerForm => ({
  ...emptyOperatingPowerForm(), generalItemId: 'strom', billKwh: '3.000', heatingDays: '220',
  devices: [{ label: 'Brenner', watts: '120', hours: '6', days: '' }, { label: 'Umwälzpumpe', watts: '45', hours: '24', days: '' }, { label: 'Regelung', watts: '5', hours: '24', days: '' }],
  ...over,
})

test('Auswahl: nur Allgemeinstrom mit positivem Betrag und ohne Kennzeichnung, mit leerem ersten Eintrag', () => {
  const abzug = { ...strom, id: 'ab', amountCents: -100, operatingPower: 'deduction' } as CostItem
  const grund = { ...strom, id: 'g', category: 'Grundsteuer' } as CostItem
  expect(generalItemOptions([strom, abzug, grund])).toEqual([
    { value: '', label: 'Bitte wählen …' },
    { value: 'strom', label: 'Hausstrom 2025 · 1.050,00 €' },
  ])
})

test('Vorschau: 147,84 € mit Rechenweg; ohne Stromrechnung ein Satz', () => {
  const v = operatingPowerPreview(ausgefuellt(), [strom])
  expect(v).toEqual({ ok: true, cents: 14784, lines: expect.arrayContaining(['zusammen 422,4 kWh von 3.000 kWh der Stromrechnung = 14,08 %', '14,08 % des Rechnungsbetrags einschließlich Grundpreis (1.050,00 €) = 147,84 €']) })
  expect(operatingPowerPreview(ausgefuellt({ generalItemId: '' }), [strom])).toEqual({ ok: false, text: 'Bitte wählen Sie die Stromrechnung des Hauses.' })
})

test('Gemessen: die Geräte zählen nicht', () => {
  const v = operatingPowerPreview(ausgefuellt({ mode: 'measured', measuredKwh: '500' }), [strom])
  expect(v).toMatchObject({ ok: true, cents: 17500 })
})

test('Rumpf: Zahlen mit Komma, gemessen ohne Geräte', () => {
  expect(operatingPowerRequest(ausgefuellt({ devices: [{ label: 'Pumpe', watts: '45,5', hours: '24', days: '' }] }), '2025-01')).toEqual({
    period: '2025-01', generalItemId: 'strom', billKwh: 3000, devices: [{ label: 'Pumpe', watts: 45.5, hoursPerDay: 24, days: null }], heatingDays: 220,
  })
  expect(operatingPowerRequest(ausgefuellt({ mode: 'measured', measuredKwh: '500' }), '2025-01')).toEqual({
    period: '2025-01', generalItemId: 'strom', billKwh: 3000, measuredKwh: 500,
  })
})

// P-K8: eigene Tage je Gerät; leer heißt die Heiztage.
test('Tage je Gerät: leer ist null, sonst die Zahl', () => {
  const form = ausgefuellt({ devices: [{ label: 'Pumpe', watts: '45', hours: '24', days: '' }, { label: 'WW-Pumpe', watts: '25', hours: '4', days: '360' }] })
  expect(operatingPowerRequest(form, '2025-01')).toMatchObject({
    devices: [{ label: 'Pumpe', watts: 45, hoursPerDay: 24, days: null }, { label: 'WW-Pumpe', watts: 25, hoursPerDay: 4, days: 360 }],
  })
  expect(operatingPowerPreview(form, [strom])).toMatchObject({ ok: true, cents: 9576 })
})

// P-W2: der dritte Weg, ohne kWh und ohne Geräte.
test('Selbst geschätzt: Vorschau mit Grundlage, Rumpf mit Cent und Grundlage', () => {
  const form = ausgefuellt({ mode: 'own', ownAmount: '147,84', basis: 'Bruchteil der Brennstoffkosten 2025' })
  expect(operatingPowerPreview(form, [strom])).toEqual({ ok: true, cents: 14784, lines: ['selbst geschätzt: 147,84 €', 'Grundlage der Schätzung: Bruchteil der Brennstoffkosten 2025'] })
  expect(operatingPowerRequest(form, '2025-01')).toEqual({ period: '2025-01', generalItemId: 'strom', ownCents: 14784, basis: 'Bruchteil der Brennstoffkosten 2025' })
  expect(operatingPowerPreview({ ...form, basis: '' }, [strom])).toMatchObject({ ok: false, text: expect.stringMatching(/Grundlage der Schätzung/) })
})
```

In `client/src/costForm.test.ts` anhängen:

```ts
test('Betriebsstrom: Frage nur bei Heizkosten mit Teil Betrieb oder ohne Teil; der Rumpf trägt Kennzeichnung und Grundlage', () => {
  const heiz = { ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser', operatingPower: 'included' as const, operatingPowerBasis: 'Pumpe 45 W' }
  expect(showsOperatingPower(heiz)).toBe(true)
  expect(showsOperatingPower({ ...heiz, heatingPart: 'fuel' })).toBe(false)
  expect(withOperatingPower({ a: 1 }, heiz)).toEqual({ a: 1, operatingPower: 'included', operatingPowerItemId: null, operatingPowerBasis: 'Pumpe 45 W' })
  // Ohne Kennzeichnung fällt auch die Grundlage weg (Bedingung …_basis_valid).
  expect(withOperatingPower({ a: 1 }, { ...heiz, operatingPower: '' })).toEqual({ a: 1, operatingPower: null, operatingPowerItemId: null, operatingPowerBasis: null })
  expect(withOperatingPower({ a: 1 }, { ...EMPTY_ITEM_FORM, category: 'Grundsteuer' })).toEqual({ a: 1 })
  expect(OPERATING_POWER_OPTIONS.map((o) => o.value)).toEqual(['', 'included'])
})

// Review Focus 3 und P-W2: Das Formular liest Kennzeichnung, Verweis und Grundlage eines Abzugs ein und
// schickt sie unverändert zurück; ein von Hand erfasster Abzug lässt sich verknüpfen.
test('Betriebsstrom: Abzug am Allgemeinstrom bleibt beim Bearbeiten erhalten und lässt sich verknüpfen', () => {
  const bs = { id: 'bs', propertyId: 'o', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Betriebsstrom Heizung (geschätzt)', amountCents: 14784, key: 'area', operatingPower: 'included' } as CostItem
  const ab = { id: 'ab', propertyId: 'o', period: '2026-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Abzug', amountCents: -14784, key: 'area', operatingPower: 'deduction', operatingPowerItemId: 'bs', operatingPowerBasis: 'Grundlage' } as CostItem
  const form = itemToForm(ab)
  expect([form.operatingPower, form.operatingPowerItemId, form.operatingPowerBasis]).toEqual(['deduction', 'bs', 'Grundlage'])
  expect(withOperatingPower({ a: 1 }, form)).toEqual({ a: 1, operatingPower: 'deduction', operatingPowerItemId: 'bs', operatingPowerBasis: 'Grundlage' })
  // Die Auswahl bei einem Abzug (negativer Betrag am Allgemeinstrom): kein Abzug, Messdienst, jeder Betriebsstrom.
  expect(showsDeductionLink(form)).toBe(true)
  expect(showsDeductionLink({ ...form, amount: '10,00' })).toBe(false)
  expect(deductionChoices([bs, ab])).toEqual([
    { value: '', label: 'Nein, kein Abzug des Betriebsstroms' },
    { value: 'service', label: 'Ja, der Betrag ist dem Messdienst als Betriebsstrom gemeldet' },
    { value: 'bs', label: 'Ja, zu „Betriebsstrom Heizung (geschätzt)“ (2025-01, 147,84 €)' },
  ])
  expect(deductionChoiceOf(form)).toBe('bs')
  const hand = { ...EMPTY_ITEM_FORM, category: 'Beleuchtung/Allgemeinstrom', amount: '-147,84' }
  expect(deductionChoiceOf(hand)).toBe('')
  const verknuepft = withDeductionChoice(hand, 'bs')
  expect(withOperatingPower({}, verknuepft)).toEqual({ operatingPower: 'deduction', operatingPowerItemId: 'bs', operatingPowerBasis: null })
  expect(withOperatingPower({}, withDeductionChoice(hand, 'service'))).toEqual({ operatingPower: 'deduction', operatingPowerItemId: null, operatingPowerBasis: null })
  expect(withOperatingPower({}, withDeductionChoice(verknuepft, ''))).toEqual({ operatingPower: null, operatingPowerItemId: null, operatingPowerBasis: null })
})
```

(`EMPTY_ITEM_FORM`, `itemToForm`, `OPERATING_POWER_OPTIONS`, `showsOperatingPower`, `showsDeductionLink`,
`deductionChoices`, `deductionChoiceOf`, `withDeductionChoice`, `withOperatingPower` aus `./costForm`,
`CostItem` aus `./types` importieren. Die Beschriftung nennt den Zeitraumschlüssel; gibt es im Client
schon einen Helfer für die Beschriftung eines Zeitraums, den nehmen und die Erwartung angleichen.)

`client/src/components/OperatingPowerFields.test.tsx` (P-W1, P-W2, P-K1; Umgebung jsdom):

```tsx
// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import OperatingPowerFields from './OperatingPowerFields'
import { EMPTY_ITEM_FORM, type ItemForm } from '../costForm'
import type { CostItem } from '../types'

const bs = { id: 'bs', propertyId: 'o', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Betriebsstrom Heizung (geschätzt)', amountCents: 14784, key: 'area', operatingPower: 'included' } as CostItem

test('Heizkosten: Frage mit Norm (P-K1), Grundlage der Schätzung sichtbar und änderbar (P-W1)', () => {
  const onChange = vi.fn()
  const form: ItemForm = { ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser', operatingPower: 'included', operatingPowerBasis: 'Pumpe: 45 W × 24 h × 220 Tage = 237,6 kWh' }
  render(<OperatingPowerFields form={form} items={[bs]} onChange={onChange} />)
  expect(screen.getByText(/§ 7 Abs\. 2 HeizkostenV; BGH, Urteil vom 03\.06\.2016, V ZR 166\/15/)).toBeTruthy()
  const basis = screen.getByLabelText(/Grundlage der Schätzung/) as HTMLTextAreaElement
  expect(basis.value).toBe('Pumpe: 45 W × 24 h × 220 Tage = 237,6 kWh')
  fireEvent.change(basis, { target: { value: 'neu' } })
  expect(onChange).toHaveBeenCalledWith({ ...form, operatingPowerBasis: 'neu' })
})

test('Allgemeinstrom mit negativem Betrag: die Auswahl zeigt den gespeicherten Verweis (angezeigter = gespeicherter Wert)', () => {
  const form: ItemForm = { ...EMPTY_ITEM_FORM, category: 'Beleuchtung/Allgemeinstrom', amount: '-147,84', operatingPower: 'deduction', operatingPowerItemId: 'bs' }
  render(<OperatingPowerFields form={form} items={[bs]} onChange={vi.fn()} />)
  expect((screen.getByLabelText(/Abzug des Betriebsstroms/) as HTMLSelectElement).value).toBe('bs')
})
```

`client/src/components/OperatingPowerCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import OperatingPowerCard from './OperatingPowerCard'
import type { CostItem, HeatingPeriodView, HeatingPlant } from '../types'

const strom = { id: 'strom', propertyId: 'o', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom 2025', amountCents: 105000, key: 'area' } as CostItem
const view = { plantId: 'hp', period: '2025-01', label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false, hotWater: { dhwMethod: null, dhwUnmeasurable: null }, co2: null, items: [] } as unknown as HeatingPeriodView
const plant = { id: 'hp', method: 'manual', energy: 'gas' } as HeatingPlant

test('Die Auswahl der Stromrechnung zeigt den gewählten Wert (CLAUDE.md, angezeigter = gespeicherter Wert)', () => {
  render(<OperatingPowerCard plant={plant} view={view} items={[strom]} onBooked={vi.fn()} />)
  const select = screen.getByLabelText(/Stromrechnung des Hauses/) as HTMLSelectElement
  expect(select.value).toBe('')
  fireEvent.change(select, { target: { value: 'strom' } })
  expect(select.value).toBe('strom')
  expect(screen.getAllByText(/Betriebsstrom/).length).toBeGreaterThan(0)
})

// P-K1: Die Rechtsaussage der Karte trägt ihre Norm; P-W1: der Satz zum Aufbewahren.
test('Karte: Norm an der Rechtsaussage, Hinweis auf die Darlegungslast, drei Wege', () => {
  render(<OperatingPowerCard plant={plant} view={view} items={[strom]} onBooked={vi.fn()} />)
  expect(screen.getByText(/§ 7 Abs\. 2, § 8 Abs\. 2 HeizkostenV; BGH, Urteil vom 03\.06\.2016, V ZR 166\/15/)).toBeTruthy()
  expect(screen.getByText(/BGH, Versäumnisurteil vom 20\.02\.2008, VIII ZR 27\/07, Leitsatz 3/)).toBeTruthy()
  expect(screen.getByLabelText(/Betrag selbst geschätzt/)).toBeTruthy()
})

// P-W5: Bei Wärmepumpe und Stromheizung keine Hilfe, nur der Satz.
test('Karte bei Wärmepumpe und Stromheizung: Satz zum Brennstoff, keine Eingaben; bei Gas die Hilfe', () => {
  for (const energy of ['heatPump', 'electric'] as const) {
    const { unmount } = render(<OperatingPowerCard plant={{ ...plant, energy }} view={view} items={[strom]} onBooked={vi.fn()} />)
    expect(screen.getByText(/ist der Strom Brennstoff, nicht Betriebsstrom/)).toBeTruthy()
    expect(screen.queryByLabelText(/Stromrechnung des Hauses/)).toBeNull()
    unmount()
  }
  render(<OperatingPowerCard plant={plant} view={view} items={[strom]} onBooked={vi.fn()} />)
  expect(screen.queryByText(/ist der Strom Brennstoff/)).toBeNull()
})
```

(Die Datei nutzt `HeatingPeriodView` und `HeatingPlant` nur als Requisiten; die Umwandlung über
`unknown` steht ausschließlich im Test, wo ein vollständiges Objekt nur Lärm wäre. Bauen PR 6/7 dafür
einen Helfer im Client-Testordner, den nehmen.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- operatingPowerForm costForm OperatingPowerCard OperatingPowerFields`
Expected: FAIL, fehlende Module bzw. Exporte.

- [ ] **Step 3: Kostenformular (`client/src/costForm.ts`)**

`ItemForm` bekommt als letzte Felder `operatingPower: '' | 'included' | 'deduction'`,
`operatingPowerItemId: string` und `operatingPowerBasis: string`; `EMPTY_ITEM_FORM` je `''`; `itemToForm`
`operatingPower: i.operatingPower ?? ''`, `operatingPowerItemId: i.operatingPowerItemId ?? ''`,
`operatingPowerBasis: i.operatingPowerBasis ?? ''`. Anhängen:

```ts
// Betriebsstrom der Heizung (Heizung PR 15, #212): die Frage, ob dieser Strom auch im Allgemeinstrom
// steckt. Nur bei Heizkosten mit Teil „Betrieb“ oder ohne Teil, wie die Bedingung der Datenbank.
export const OPERATING_POWER_OPTIONS: { value: '' | 'included'; label: string }[] = [
  { value: '', label: 'Nein (eigener Stromvertrag oder kein Betriebsstrom)' },
  { value: 'included', label: 'Ja, er läuft über den Stromzähler des Hauses' },
]
export const showsOperatingPower = (form: Pick<ItemForm, 'category' | 'heatingPart'>): boolean =>
  form.category === HEATING_CATEGORY && (form.heatingPart === '' || form.heatingPart === 'operating')

// Ein Abzug am Allgemeinstrom (P-W2): negativer Betrag bei „Beleuchtung/Allgemeinstrom“. Dann fragt das
// Formular, zu welchem Betriebsstrom er gehört, damit auch ein von Hand erfasster Abzug zählt.
export const showsDeductionLink = (form: Pick<ItemForm, 'category' | 'amount'>): boolean =>
  form.category === GENERAL_POWER_CATEGORY && (parseEuro(form.amount) ?? 0) < 0
export function deductionChoices(items: readonly CostItem[]): { value: string; label: string }[] {
  return [
    { value: '', label: 'Nein, kein Abzug des Betriebsstroms' },
    { value: 'service', label: 'Ja, der Betrag ist dem Messdienst als Betriebsstrom gemeldet' },
    ...items.filter((c) => c.operatingPower === 'included')
      .map((c) => ({ value: c.id, label: `Ja, zu „${c.description}“ (${c.period}, ${fmtEuro(c.amountCents)})` })),
  ]
}
export const deductionChoiceOf = (form: Pick<ItemForm, 'operatingPower' | 'operatingPowerItemId'>): string =>
  form.operatingPower !== 'deduction' ? '' : form.operatingPowerItemId || 'service'
export function withDeductionChoice(form: ItemForm, value: string): ItemForm {
  if (value === '') return { ...form, operatingPower: '', operatingPowerItemId: '', operatingPowerBasis: '' }
  return { ...form, operatingPower: 'deduction', operatingPowerItemId: value === 'service' ? '' : value }
}

// Der Rumpf trägt die drei Felder bei Heizkosten und beim Allgemeinstrom (Review Focus 3): Das Formular
// hat sie eingelesen und schickt sie zurück, wie sie sind. Ohne Kennzeichnung keine Grundlage (Bedingung
// `…_basis_valid`). Bei jeder anderen Kostenart kein Feld.
export function withOperatingPower(body: Record<string, unknown>, form: Pick<ItemForm, 'category' | 'heatingPart' | 'amount' | 'operatingPower' | 'operatingPowerItemId' | 'operatingPowerBasis'>): Record<string, unknown> {
  const basis = (marked: boolean) => (marked && form.operatingPowerBasis.trim() !== '' ? form.operatingPowerBasis.trim() : null)
  if (form.category === HEATING_CATEGORY) {
    const included = showsOperatingPower(form) && form.operatingPower === 'included'
    return { ...body, operatingPower: included ? 'included' : null, operatingPowerItemId: null, operatingPowerBasis: basis(included) }
  }
  if (form.category === GENERAL_POWER_CATEGORY) {
    const deduction = showsDeductionLink(form) && form.operatingPower === 'deduction'
    return { ...body, operatingPower: deduction ? 'deduction' : null, operatingPowerItemId: deduction && form.operatingPowerItemId ? form.operatingPowerItemId : null, operatingPowerBasis: basis(deduction) }
  }
  return body
}
```

(`HEATING_CATEGORY` aus `'../../shared/heating.ts'`, `GENERAL_POWER_CATEGORY` aus
`'../../shared/operatingPower.ts'`, `fmtEuro` und `parseEuro` aus `'./api'`, `CostItem` aus `'./types'`
importieren, soweit nicht schon da; liefert `parseEuro` bei leerer Eingabe etwas anderes als `null`, den
Vergleich angleichen.) In `buildCostItemBody` das Ergebnis durchreichen:

```ts
  const p = typeof period === 'number' ? calendarYearPeriod(period) : period
  const result = costItemBody(draftOf(form, units, tenancies, p), units, p.key)
  return 'body' in result ? { ...result, body: withOperatingPower(result.body, form) } : result
```

(Stand `6571bdd`: `buildCostItemBody` gibt `costItemBody(draftOf(form, units, tenancies, p), units, p.key)`
unmittelbar zurück; nur die Zeile mit `withOperatingPower` ist neu. `BuildResult` ist dort
`{ error } | { body: CostItemBody }` (shared/costItem.ts, Zeile 126), und `CostItemBody` ist eng getippt.
Deshalb bekommt `CostItemBody` die drei Felder als optionale
(`operatingPower?: 'included' | 'deduction' | null`, `operatingPowerItemId?: string | null`,
`operatingPowerBasis?: string | null`), und `withOperatingPower` wird generisch statt auf
`Record<string, unknown>` geschrieben: `withOperatingPower<B extends object>(body: B, form): B & Partial<OperatingPowerBody>`
mit `type OperatingPowerBody = { operatingPower: 'included' | 'deduction' | null; operatingPowerItemId: string | null; operatingPowerBasis: string | null }`.
So bleiben die Tests oben ohne Umwandlung mit `as`. Der Server liest die Felder ohnehin aus dem rohen
Rumpf (Task 2).)

- [ ] **Step 4: Kostenformular (`client/src/components/OperatingPowerFields.tsx`, `client/src/pages/Kosten.tsx`)**

Die Auswahl „Teil der Heizkosten“ steht in `CostPeriodFields.tsx` unter „Weitere Angaben“. Die Fragen zum
Betriebsstrom gehören nicht dorthin, denn wer sie braucht, soll sie ohne Aufklappen sehen; sie kommen als
eigene Komponente in Kosten.tsx direkt vor `<details className="extra-details" …>`:

```tsx
// Betriebsstrom am Kostenformular (Heizung PR 15, #212): an Heizkosten die Frage, ob er über den Zähler
// des Hauses läuft; am Allgemeinstrom mit negativem Betrag, zu welchem Betriebsstrom der Abzug gehört
// (P-W2); an beiden die Grundlage der Schätzung (P-W1). Die Norm steht dabei (P-K1).
import { deductionChoiceOf, deductionChoices, OPERATING_POWER_OPTIONS, showsDeductionLink, showsOperatingPower, withDeductionChoice, type ItemForm } from '../costForm'
import Term from './Term'
import type { CostItem } from '../types'

export default function OperatingPowerFields({ form, items, onChange }: { form: ItemForm; items: readonly CostItem[]; onChange: (next: ItemForm) => void }) {
  const heating = showsOperatingPower(form)
  const deduction = showsDeductionLink(form)
  if (!heating && !deduction) return null
  const marked = (heating && form.operatingPower === 'included') || (deduction && form.operatingPower === 'deduction')
  return (
    <>
      {heating && (
        <label className="field">
          <span>Läuft dieser Betriebsstrom über den Stromzähler des Hauses? <Term id="operatingPower" /></span>
          <select value={form.operatingPower === 'included' ? 'included' : ''} onChange={(e) => onChange({ ...form, operatingPower: e.target.value === 'included' ? 'included' : '' })}>
            {OPERATING_POWER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <small className="muted">
            Dann gehört er zu den Heizkosten, oder Sie tragen ihn selbst; im Allgemeinstrom darf er nicht stehen
            (§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15). Ziehen Sie ihn dort ab, etwa mit der Karte „Betriebsstrom“ auf der Seite Heizkosten.
          </small>
        </label>
      )}
      {deduction && (
        <label className="field">
          <span>Abzug des Betriebsstroms der Heizung? <Term id="operatingPower" /></span>
          <select value={deductionChoiceOf(form)} onChange={(e) => onChange(withDeductionChoice(form, e.target.value))}>
            {deductionChoices(items).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      )}
      {marked && (
        <label className="field">
          <span>Grundlage der Schätzung</span>
          <textarea rows={4} value={form.operatingPowerBasis} onChange={(e) => onChange({ ...form, operatingPowerBasis: e.target.value })} />
          <small className="muted">
            Bewahren Sie die Angaben auf: Bestreitet ein Mieter den Betrag, müssen Sie die Grundlagen Ihrer Schätzung darlegen
            (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz 3). Ändern Sie den Betrag, ändern Sie die Grundlage mit.
          </small>
        </label>
      )}
    </>
  )
}
```

Die Auswahl des Abzugs speist sich aus `deductionChoices`, und ein gespeicherter Verweis auf eine
Position, die nicht (mehr) als Betriebsstrom gekennzeichnet ist, kann nicht entstehen (die Schreibprüfung
lehnt ab, Task 2); der angezeigte Wert entspricht also immer dem gespeicherten (CLAUDE.md, Tests, Ebene 3).

In `client/src/pages/Kosten.tsx` direkt vor `<details className="extra-details" …>` (um Zeile 836):

```tsx
            <OperatingPowerFields form={form} items={items} onChange={setForm} />
```

(`items` sind dort alle Positionen des Objekts aus allen Zeiträumen; `setForm` setzt den Zustand des
Formulars wie bei `CostPeriodFields`.)

- [ ] **Step 5: Formular der Karte (`client/src/operatingPowerForm.ts`)**

```ts
// Die Karte „Betriebsstrom“ der Seite Heizkosten (Heizung PR 15, #212), DOM-frei. Die Rechnung kommt aus
// shared/operatingPower.ts, dieselbe wie auf dem Server.
import { GENERAL_POWER_CATEGORY, operatingPowerShare, ownEstimateShare } from '../../shared/operatingPower.ts'
import { fmtEuro, parseEuro } from './api'
import type { CostItem } from './types'

// `days` leer heißt: die Heiztage (P-K8).
export type DeviceRow = { label: string; watts: string; hours: string; days: string }
export type OperatingPowerForm = {
  generalItemId: string
  // P-W2: dritter Weg „Betrag selbst geschätzt“.
  mode: 'estimate' | 'measured' | 'own'
  devices: DeviceRow[]
  heatingDays: string
  measuredKwh: string
  billKwh: string
  ownAmount: string
  basis: string
}

export const emptyOperatingPowerForm = (): OperatingPowerForm => ({
  generalItemId: '', mode: 'estimate', devices: [{ label: 'Umwälzpumpe', watts: '', hours: '', days: '' }], heatingDays: '', measuredKwh: '', billKwh: '', ownAmount: '', basis: '',
})

// „3.000“ und „45,5“ wie im übrigen Formular; leer oder unlesbar ist null.
function num(text: string): number | null {
  const t = text.trim().replace(/\./g, '').replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function generalItemOptions(items: readonly CostItem[]): { value: string; label: string }[] {
  return [
    { value: '', label: 'Bitte wählen …' },
    ...items
      .filter((c) => c.category === GENERAL_POWER_CATEGORY && c.amountCents > 0 && c.operatingPower === undefined)
      .map((c) => ({ value: c.id, label: `${c.description} · ${fmtEuro(c.amountCents)}` })),
  ]
}

export function operatingPowerPreview(form: OperatingPowerForm, items: readonly CostItem[]): { ok: true; cents: number; lines: string[] } | { ok: false; text: string } {
  const general = items.find((c) => c.id === form.generalItemId)
  if (!general) return { ok: false, text: 'Bitte wählen Sie die Stromrechnung des Hauses.' }
  if (form.mode === 'own') {
    const own = ownEstimateShare({ cents: parseEuro(form.ownAmount), basis: form.basis, billCents: general.amountCents })
    return 'error' in own ? { ok: false, text: own.error } : { ok: true, cents: own.cents, lines: own.steps }
  }
  const measured = form.mode === 'measured'
  const r = operatingPowerShare({
    devices: measured ? null : form.devices.map((d) => ({ label: d.label.trim() || 'Gerät', watts: num(d.watts) ?? 0, hoursPerDay: num(d.hours) ?? 0, days: num(d.days) })),
    heatingDays: measured ? null : num(form.heatingDays),
    measuredKwh: measured ? (num(form.measuredKwh) ?? 0) : null,
    billKwh: num(form.billKwh) ?? 0,
    billCents: general.amountCents,
  })
  return 'error' in r ? { ok: false, text: r.error } : { ok: true, cents: r.cents, lines: r.steps }
}

export function operatingPowerRequest(form: OperatingPowerForm, period: string): Record<string, unknown> {
  if (form.mode === 'own') return { period, generalItemId: form.generalItemId, ownCents: parseEuro(form.ownAmount), basis: form.basis.trim() }
  const base = { period, generalItemId: form.generalItemId, billKwh: num(form.billKwh) }
  if (form.mode === 'measured') return { ...base, measuredKwh: num(form.measuredKwh) }
  return {
    ...base,
    devices: form.devices.map((d) => ({ label: d.label.trim() || 'Gerät', watts: num(d.watts), hoursPerDay: num(d.hours), days: num(d.days) })),
    heatingDays: num(form.heatingDays),
  }
}
```

- [ ] **Step 6: Karte (`client/src/components/OperatingPowerCard.tsx`)**

```tsx
// Karte „Betriebsstrom“ auf der Seite Heizkosten (Heizung PR 15, #212): Schätzung nach Leistung und
// Heiztagen oder gemessen, Vorschau, und Betriebsstrom samt Abzug mit einem Klick.
import { useState } from 'react'
import { api, errorText, fmtEuro } from '../api'
import { emptyOperatingPowerForm, generalItemOptions, operatingPowerPreview, operatingPowerRequest } from '../operatingPowerForm'
import { operatingPowerRefusal } from '../../../shared/operatingPower.ts'
import { useToast } from './feedback'
import Term from './Term'
import type { CostItem, HeatingPeriodView, HeatingPlant } from '../types'

export default function OperatingPowerCard({ plant, view, items, onBooked }: {
  plant: Pick<HeatingPlant, 'id' | 'method' | 'energy'>; view: Pick<HeatingPeriodView, 'period' | 'label' | 'closed'>; items: readonly CostItem[]; onBooked: () => void
}) {
  const [form, setForm] = useState(emptyOperatingPowerForm)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  // P-W5: Bei Wärmepumpe und Stromheizung ist der Strom Brennstoff; die Karte sagt das und rechnet nichts.
  const refusal = operatingPowerRefusal(plant.energy)
  if (refusal) {
    return (
      <section className="card">
        <h3>Betriebsstrom <Term id="operatingPower" /></h3>
        <p>{refusal}</p>
      </section>
    )
  }
  const preview = operatingPowerPreview(form, items)
  const setDevice = (i: number, key: 'label' | 'watts' | 'hours' | 'days', value: string) =>
    setForm({ ...form, devices: form.devices.map((d, k) => (k === i ? { ...d, [key]: value } : d)) })

  async function book() {
    setBusy(true)
    try {
      await api(`/api/heating-plants/${plant.id}/operating-power`, { method: 'POST', body: JSON.stringify(operatingPowerRequest(form, String(view.period))) })
      toast(plant.method === 'service'
        ? 'Der Abzug beim Allgemeinstrom ist angelegt. Melden Sie denselben Betrag Ihrem Messdienst als Betriebsstrom.'
        : 'Betriebsstrom und Abzug beim Allgemeinstrom sind angelegt.')
      setForm(emptyOperatingPowerForm())
      onBooked()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h3>Betriebsstrom <Term id="operatingPower" /></h3>
      {/* P-K1: Rechtsaussage mit Norm; P-K5: selbst tragen ist zulässig. */}
      <p>
        Läuft der Strom für Brenner, Umwälzpumpe und Regelung über den Stromzähler des Hauses, gehört er zu den Heiz- und Warmwasserkosten
        oder Sie tragen ihn selbst; im Allgemeinstrom darf er nicht stehen und ist dort abzuziehen (§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15).
        Mietfuchs rechnet den Anteil an der Stromrechnung und legt beide Positionen an.
      </p>
      {/* P-W1 */}
      <p className="hint">
        Mietfuchs speichert Ihre Angaben als Grundlage der Schätzung an beiden Positionen. Bewahren Sie Typenschilder und Rechnungen auf: Bestreitet ein Mieter
        den Betrag, müssen Sie die Grundlagen Ihrer Schätzung darlegen (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz 3).
      </p>
      <label>
        Stromrechnung des Hauses
        <select value={form.generalItemId} disabled={view.closed} onChange={(e) => setForm({ ...form, generalItemId: e.target.value })}>
          {generalItemOptions(items).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {form.mode !== 'own' && (
        <label>kWh laut Stromrechnung <input inputMode="decimal" value={form.billKwh} disabled={view.closed} onChange={(e) => setForm({ ...form, billKwh: e.target.value })} /></label>
      )}
      <fieldset>
        <legend>Wie bestimmen Sie den Betriebsstrom?</legend>
        <label><input type="radio" checked={form.mode === 'estimate'} disabled={view.closed} onChange={() => setForm({ ...form, mode: 'estimate' })} /> geschätzt nach Leistung und Heiztagen</label>
        <label><input type="radio" checked={form.mode === 'measured'} disabled={view.closed} onChange={() => setForm({ ...form, mode: 'measured' })} /> gemessen mit Zwischenzähler</label>
        {/* P-W2: dritter Weg, ohne vorgegebenen Prozentsatz. */}
        <label><input type="radio" checked={form.mode === 'own'} disabled={view.closed} onChange={() => setForm({ ...form, mode: 'own' })} /> Betrag selbst geschätzt</label>
      </fieldset>
      {form.mode === 'estimate' && (
        <>
          {form.devices.map((d, i) => (
            <div key={i} className="row">
              <label>Gerät <input value={d.label} disabled={view.closed} onChange={(e) => setDevice(i, 'label', e.target.value)} /></label>
              <label>Leistung (W) <input inputMode="decimal" value={d.watts} disabled={view.closed} onChange={(e) => setDevice(i, 'watts', e.target.value)} /></label>
              <label>Stunden je Tag <input inputMode="decimal" value={d.hours} disabled={view.closed} onChange={(e) => setDevice(i, 'hours', e.target.value)} /></label>
              {/* P-K8: eigene Tage je Gerät, leer heißt die Heiztage. */}
              <label>Tage (leer: Heiztage) <input inputMode="numeric" value={d.days} disabled={view.closed} onChange={(e) => setDevice(i, 'days', e.target.value)} /></label>
            </div>
          ))}
          <button type="button" disabled={view.closed} onClick={() => setForm({ ...form, devices: [...form.devices, { label: '', watts: '', hours: '', days: '' }] })}>+ Gerät</button>
          <label>Heiztage <input inputMode="numeric" value={form.heatingDays} disabled={view.closed} onChange={(e) => setForm({ ...form, heatingDays: e.target.value })} /></label>
          <p className="hint">
            Die Leistung steht auf dem Typenschild. Die Umwälzpumpe der Heizung läuft nur in der Heizzeit; eine Pumpe für das Warmwasser läuft auch im Sommer.
            Tragen Sie dann bei diesem Gerät eigene Tage ein. Wurde der Kessel im Jahr getauscht, legen Sie den Betriebsstrom zweimal an, je mit den Tagen des
            alten und des neuen Kessels, oder nehmen Sie den Zwischenzähler.
          </p>
        </>
      )}
      {form.mode === 'measured' && (
        <label>gemessene kWh <input inputMode="decimal" value={form.measuredKwh} disabled={view.closed} onChange={(e) => setForm({ ...form, measuredKwh: e.target.value })} /></label>
      )}
      {form.mode === 'own' && (
        <>
          <label>geschätzter Betrag (€) <input inputMode="decimal" value={form.ownAmount} disabled={view.closed} onChange={(e) => setForm({ ...form, ownAmount: e.target.value })} /></label>
          <label>Grundlage der Schätzung <textarea rows={3} value={form.basis} disabled={view.closed} onChange={(e) => setForm({ ...form, basis: e.target.value })} /></label>
          <p className="hint">
            Der Bundesgerichtshof lässt als Schätzgrundlage auch einen Bruchteil der Brennstoffkosten zu; gemeint sind die Brennstoffkosten, nicht der
            Allgemeinstrom. Mietfuchs gibt keinen Prozentsatz vor; nennen Sie, wie Sie geschätzt haben.
          </p>
        </>
      )}
      {preview.ok ? (
        <ul className="calc-steps">{preview.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      ) : (
        <p className="hint">{preview.text}</p>
      )}
      <button type="button" disabled={view.closed || busy || !preview.ok} onClick={book}>
        {preview.ok ? `${fmtEuro(preview.cents)} als Betriebsstrom und Abzug anlegen` : 'Betriebsstrom und Abzug anlegen'}
      </button>
    </section>
  )
}
```

(`useToast` liegt in `client/src/components/feedback.tsx`; ruft es dort anders, etwa `toast.show(...)`,
die beiden Aufrufe angleichen.)

- [ ] **Step 7: Seite Heizkosten (`client/src/pages/Heizkosten.tsx`)**

Die Seite lädt bisher keine Positionen. In `load` (useCallback) neben den Lieferungen alle Positionen
des Objekts mitladen und in `Loaded` aufnehmen:

```tsx
      // Heizung PR 15: alle Positionen des Objekts aus allen Zeiträumen, für die Karte „Betriebsstrom“.
      const items = await api<CostItem[]>(withProperty('/api/costItems', property?.id))
```

(`Loaded` um `items: CostItem[]` ergänzen, `setData({ …, items })`; `CostItem` aus `'../types'`.) Dann
je Anlage und Heizperiode (`(data?.views[plant.id] ?? []).map((v) => …)`) hinter der Karte „Brennstoff“
(`<FuelCard … />`):

```tsx
                <OperatingPowerCard plant={plant} view={v} items={data?.items ?? []} onBooked={() => void load()} />
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix client test -- operatingPowerForm costForm OperatingPowerCard OperatingPowerFields Kosten && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/src/costForm.ts client/src/costForm.test.ts shared/costItem.ts client/src/pages/Kosten.tsx client/src/components/OperatingPowerFields.tsx client/src/components/OperatingPowerFields.test.tsx client/src/operatingPowerForm.ts client/src/operatingPowerForm.test.ts client/src/components/OperatingPowerCard.tsx client/src/components/OperatingPowerCard.test.tsx client/src/pages/Heizkosten.tsx
git commit -m "Oberfläche: Betriebsstrom am Kostenformular und Karte mit Schätzhilfe

Kennzeichnung, Verknüpfung eines Abzugs und Grundlage der Schätzung im
Kostenformular; Karte mit drei Wegen und Tagen je Gerät; bei Wärmepumpe
und Stromheizung nur der Satz zum Brennstoff.

Refs #212"
```

---

### Task 7: CHANGELOG, CLAUDE.md, Gesamtprüfung

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: CHANGELOG (Abschnitt „Unveröffentlicht“, „Hinzugefügt“)**

```markdown
- **Betriebsstrom der Heizung** ([#212](https://github.com/speedone/mietfuchs/issues/212)): Eine
  Heizposition lässt sich als Betriebsstrom kennzeichnen, der über den Stromzähler des Hauses läuft.
  Steht beim Allgemeinstrom kein Abzug in gleicher Höhe, nennt die Abrechnung den Betrag, der doppelt
  verteilt wird. Die Karte „Betriebsstrom“ auf der Seite Heizkosten schätzt ihn nach Leistung der Geräte
  und Heiztagen (BGH, Urteil vom 03.06.2016, V ZR 166/15), nimmt den Zwischenzähler oder einen selbst
  geschätzten Betrag mit Grundlage und legt Betriebsstrom und Abzug gemeinsam an; der Euro-Betrag ist der
  Anteil am Rechnungsbetrag einschließlich Grundpreis. Die Grundlage der Schätzung bleibt an beiden
  Positionen gespeichert und steht im Rechenweg, denn bestreitet ein Mieter den Betrag, müssen Sie sie
  darlegen (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07). Einen von Hand erfassten Abzug
  verknüpfen Sie im Kostenformular mit dem Betriebsstrom. Steht der Allgemeinstrom in einer
  abgeschlossenen Abrechnung, legt die Karte nichts an. Bei Wärmepumpe und Stromheizung ist der Strom
  Brennstoff und gehört in die Heizposition. Einen Bruchteil der Brennstoffkosten lässt der BGH als
  Schätzgrundlage zu; Mietfuchs rechnet keinen Prozentsatz vor, das Lexikon nennt die Literaturwerte.
```

- [ ] **Step 2: CLAUDE.md**

Im Abschnitt der Berechnungs-Engine hinter dem Absatz zum Leerstand beim Personenschlüssel einfügen:

```markdown
- **Betriebsstrom der Heizung** (#212, Heizung PR 15): `cost_items.operating_power` sagt an einer
  Heizposition `included` (der Strom läuft über den Zähler des Hauses und steckt im Allgemeinstrom), an
  einer Position „Beleuchtung/Allgemeinstrom“ `deduction` (der Abzug); der Abzug zeigt mit
  `operating_power_item_id` auf seinen Betriebsstrom (`RESTRICT`, Löschen mit einem Satz gesperrt). Die
  Abrechnung prüft jede Position, die sie verteilt, gegen die Abzüge **aus allen Zeiträumen**
  (`operatingPowerDeductions` im Schnappschuss), denn eine eigene Heizperiode und der Allgemeinstrom
  liegen oft in verschiedenen; `heating.operating-power-double` nennt die Differenz. Ein Abzug in einer
  abgeschlossenen Abrechnung zählt nur, wenn er in ihrem eingefrorenen Stand steht (`itemTotals`), sonst
  hat ihn kein Mieter bekommen, und der Hinweis sagt das. Die Schätzhilfe (`shared/operatingPower.ts`,
  Route `POST /api/heating-plants/:id/operating-power`) rechnet kWh aus Leistung, Laufzeit und Tagen je
  Gerät, nimmt den Zwischenzähler oder einen selbst geschätzten Betrag mit Pflichtgrundlage, Euro als
  Anteil an der Stromrechnung samt Grundpreis (Festlegung im Schätzermessen, im Rechenweg benannt), und
  legt beide Positionen in einer Transaktion an; 409, wenn der Allgemeinstrom in einer abgeschlossenen
  Abrechnung steht. Die Grundlage der Schätzung steht als Text in `cost_items.operating_power_basis` an
  beiden Positionen und im Rechenweg (`no-print`), denn bestreitet ein Mieter den Betrag, muss der
  Vermieter sie darlegen (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz 3). Bei
  Wärmepumpe und Stromheizung gibt es keine Hilfe: Der Strom ist dort Brennstoff (§ 7 Abs. 2
  HeizkostenV). Die Prozentspannen der Literatur stehen nur im Lexikon: BGH V ZR 166/15 Rn. 14 lässt
  den Bruchteil der Brennstoffkosten als Schätzgrundlage zu, gibt die Werte aber nur wieder und legt
  keinen fest; Mietfuchs rechnet ihn bewusst nicht vor. Kein Eintrag im Regelverzeichnis, denn der
  änderte den Rechtsstand jeder Abrechnung.
```

- [ ] **Step 2a: Vorschläge für Issues (öffentlich, vor dem Anlegen nachfragen)**

Nicht anlegen, nur im PR-Text als Vorschlag nennen (CLAUDE.md, „Issues sind öffentlich, deshalb vor dem
Anlegen nachfragen“):

1. „Betriebsstrom fehlt: Hinweis bei Zentralheizung ohne Betriebsstrom-Position“ (Abweichung 8).
2. „Wärmepumpe: Strom der Wärmepumpe läuft ohne eigenen Zähler über den Allgemeinstrom“ (P-W5): Der
   Strom ist dort Brennstoff und gehört ganz zu den Heizkosten; § 12 Abs. 3 HeizkostenV verlangt eine
   Erfassung (bis zum Ablauf des 30.09.2025 nachzurüsten, `hkv.heat-pump.capture`; R2-K6). Zu klären ist, ob Mietfuchs dafür einen Abzug
   beim Allgemeinstrom als Brennstoff anlegen soll und wie der Betrag ohne Zähler belegt wird.

- [ ] **Step 3: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: Exit-Status 0.

Run (Smoke-Test gegen eine laufende Instanz mit Wegwerf-Ordner):

```bash
D=$(mktemp -d); NKA_DATA_DIR=$D CI=1 NKA_UPDATE_URL=http://127.0.0.1:9 NKA_PORT=3001 npm start & sleep 5; node scripts/smoke-test.mjs --url http://127.0.0.1:3001 --mode npm; kill %1; rm -rf $D
```

Expected: Das Skript endet mit Exit-Status 0.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "Doku: Betriebsstrom der Heizung in CHANGELOG und CLAUDE.md

Refs #212"
```

---

## Selbstprüfung

**1. Abdeckung des Entwurfs.**

| Anforderung | Task |
|---|---|
| `heating.operating-power-double` mit Betrag, warning (10.1, 13 PR 15, 14.1) | 5 |
| Betriebsstrom im Topf erkennen (13 PR 15) | 2 (Kennzeichnung), 5 |
| Allgemeinstrom ungekürzt erkennen | 5 (Abweichung 2) |
| Abzug beim Allgemeinstrom als zweite Position | 2, 4 |
| Schätzhilfe nach Anschlusswerten und Heiztagen (Rn. 14) | 3, 4, 6 |
| Spannen nur im Lexikon, nicht im Register, keine Rechenregel (4.3, 16) | 1 |
| Lexikon mit Beispiel und Rechtsgrundlage (10.3) | 1 |
| Anleitungen „Betriebsstrom-Satz“ (11.4) | 1 |
| Wer nichts einstellt, merkt nichts (1.2 Nr. 1) | 5 (Test „ohne Kennzeichnung“), 2 (Kette lässt Bestand NULL) |
| Migrationen erzeugt, zwei Schritte (5, W7) | 2 |
| Weg „Betrag selbst geschätzt“ (0.12, Zeile Betriebsstrom; P-W2) | 3, 4, 6 |
| Grundlage der Schätzung gespeichert und gezeigt (P-W1) | 2, 4, 5, 6 |
| Abgeschlossener Allgemeinstrom (P-W3) | 4, 5 |
| Gemeinschaftsabrechnung (P-W4), Wärmepumpe und Stromheizung (P-W5) | 3, 4, 6 |
| CHANGELOG, CLAUDE.md (13 „Für jede PR gilt“) | 7 |

**2. Platzhalter.** Keine „TBD“. Wo ein Name aus PR 3–14 eingeht, steht er unter „Schnittstellen“ oder
„Abgleich mit PR 13 und PR 14“; die Nummern der Migrationen nennt drizzle-kit, die Tests greifen über die Kennung.

**3. Typen.** `OperatingPower`, `OperatingPowerDevice` (mit `days`), `OperatingPowerDeduction` (mit
`closed`) (Task 2), `OperatingPowerInput`, `OperatingPowerShare`, `OwnEstimate` (Task 3),
`OperatingPowerMethod`, `OperatingPowerBooking` (Task 4), `OperatingPowerFinding` (mit `notCredited`,
Task 5), `OperatingPowerForm`, `DeviceRow` (mit `days`), `OperatingPowerBody` (Task 6) werden mit
denselben Feldern benutzt (`cents`, `steps`, `measured`, `itemId`, `amountCents`, `differenceCents`,
`operatingPowerBasis`).

**4. Review Focus.** 1 → Task 4 „Schätzhilfe lehnt ab“; 2 → Task 2 „Review Focus 2“; 3 → Task 2
„Review Focus 3“ und Task 6 `withOperatingPower`, „Abzug am Allgemeinstrom bleibt beim Bearbeiten
erhalten“; 4 → Task 3 und Task 4; 5 → Task 5 „Review Focus 5“; 6 → Task 2 „P-W1“, Task 4 (Grundlage an
beiden Positionen, über die Route), Task 5 „Rechenweg“, Task 6 `OperatingPowerFields`; 7 → Task 3
„Selbst geschätzt“, Task 4 „Betrag selbst geschätzt“, Task 2 „P-W2“, Task 5 „Handabzug“, Task 6;
8 → Task 4 „Allgemeinstrom in einer abgeschlossenen Abrechnung“, Task 5 „Abzug in einer abgeschlossenen
Abrechnung“ und `deductionsOf`; 9 → Task 3, Task 4, Task 6 je „Wärmepumpe und Stromheizung“; 10 → Task 1
(Lexikon, Anleitungen), Task 4 (§ 7 Abs. 1 und 2), Task 5 (§ 8 Abs. 2, selbst tragen), Task 6 (Norm in
Karte und Formular); 11 → Task 2 (db-errors.test.ts).

**5. Rechtsprüfung 09.10.2026.** Jeder Befund P-W1 bis P-W5 hat einen Test, der vor dem Code rot ist,
und Code; P-K1 bis P-K9 sind eingearbeitet, P-K10 ist ohne Änderung begründet erledigt (Tabelle
„Wo jeder Befund steht“). Abweichung 9 ist gestrichen.
