# Mieterhöhung: Vergleichs-, Index- und Staffelmiete (#191)

Stand: Entwurf vom 20.11.2026, gegengeprüft am selben Tag (Abschnitt am Ende). Grundlage: Issue #191, die Rechtsrecherche vom 20.11.2026 (Wortlaut der §§ 126b, 187,
188, 193, 556d bis 556g, 557 bis 560 BGB amtlich gelesen, elf BGH-Urteile im Volltext), der Code von `main` (e381e75f).
Vorbild für „rechnen, zeigen, nach Bestätigung in die Staffel übernehmen“ ist die Übernahme der Vorauszahlung (#317,
server/src/prepaymentSteps.ts). Schließt zugleich den letzten Punkt von #190 („nächster möglicher Erhöhungszeitpunkt,
Ende der Kappungsgrenze“).

## Ziel

Der Vermieter sieht zu jedem Mietverhältnis, **ob, wann und um wie viel** er die Kaltmiete erhöhen darf, bekommt ein
**Schreiben zum Ausdrucken** mit den gesetzlich nötigen Angaben und trägt die neue Miete **nach Zustimmung bzw. Zugang
mit einem Klick** in die Kaltmiete-Staffel ein. Das Cockpit erinnert an Staffelstufen, an den frühesten Zeitpunkt einer
Erhöhung und an laufende Zustimmungsfristen.

**Wer nichts erhöht, merkt nichts**: Alle neuen Angaben haben eine Voreinstellung, die das bisherige Verhalten ergibt.
Mietkonto, Abrechnung, Steuer und Golden-Tests rechnen unverändert, denn die Kaltmiete-Staffel bleibt die einzige
Quelle des Solls.

## Nicht-Ziele

- Modernisierungserhöhung (§§ 559 ff.), Fehlbelegung (§ 558 Abs. 4), preisgebundener Wohnraum, Punkteklauseln einer
  Indexmiete, die Prüfung der Mietpreisbremse (§ 556d) mit Zahlen. Modernisierungserhöhungen werden nur **erfasst**
  (als Art einer Staffelstufe), weil sie bei Fristen und Kappungsgrenze außer Betracht bleiben.
- Kein Abruf von Indexwerten oder Mietspiegeln aus dem Netz: Mietfuchs ist lokal. Der Vermieter gibt die Werte ein, die
  Oberfläche verlinkt die amtliche Quelle.
- Keine Gemeindeliste der Kappungsgrenzen-Verordnungen (14 Länder, rund 700 Gemeinden, Quellen widersprüchlich, Hessen
  läuft am 25.11.2026 aus und ist nach LG Frankfurt nichtig). Der Vermieter gibt an, ob eine gilt.
- „Mietrecht II“ (BT-Drs. 21/6807) ist nicht verkündet und wird nicht gerechnet; das Datenmodell hält Datum und Wert
  jeder Indexänderung, damit ein späterer Jahresdeckel nachrechenbar ist.
- Kein Mehrmieter-Modell: `tenantName` bleibt ein Text. Das Schreiben geht an diesen Namen, mit dem Hinweis, dass es an
  alle Mieter des Vertrags gerichtet sein muss.

## Anti-Ziele (Fehlschlag, auch wenn es läuft)

- Mietfuchs nennt einen Betrag über der Kappungsgrenze oder über der eingegebenen Vergleichsmiete als zulässig.
- Mietfuchs erzeugt ein Verlangen, das vor Ablauf der Jahressperrfrist zugehen würde, oder eine Indexerklärung vor
  Ablauf der Jahresfrist.
- Ein bestehender Bestand rechnet nach der Migration im Mietkonto, in der Abrechnung oder in der Steuer anders.
- Eine unbekannte Art einer alten Staffelstufe macht eine Erhöhung früher oder höher möglich, als sie es mit der
  richtigen Art wäre.

## Rechtsregeln (Kurzfassung der Recherche, Fundstellen im Register)

R1 **Wartefrist § 558 Abs. 1 Satz 1**: Am Tag des Wirksamwerdens ist die Miete seit 15 Monaten unverändert.
R2 **Jahressperrfrist § 558 Abs. 1 Satz 2**: Zugang frühestens ein Jahr nach Wirksamwerden der letzten Erhöhung.
   Erhöhungen nach §§ 559 bis 560 zählen in R1 und R2 nicht (Satz 3), auch einvernehmliche Modernisierungserhöhungen
   nicht, soweit § 559 sie getragen hätte (BGH VIII ZR 285/06 Rn. 16). Eine vereinbarte Erhöhung nach § 557 Abs. 1
   zählt (G2). **Bezugstag** ist tagesgenau (Gegenprüfung M1): bei einer Stufe der Monatserste ihres `from`, bei der
   ersten Miete der Tag des Mietbeginns (`Tenancy.start`). R1 und R2 werden getrennt gerechnet (Wirksamwerden ≥
   Bezugstag + 15 Monate, Zugang ≥ Bezugstag + 12 Monate); vorgeschlagen wird nie ein Zugang am Monatsersten (G3,
   Streitfrage § 187 Abs. 1 oder 2 umgangen).
R3 **Ausschluss**: kein Verlangen nach § 558 während einer Staffel bis zur letzten Stufe (§ 557a Abs. 2 Satz 2) und
   während einer Indexvereinbarung (§ 557b Abs. 2 Satz 3), nicht wenn der Vertrag Erhöhungen ausschließt (§ 557 Abs. 3).
R4 **Kappungsgrenze § 558 Abs. 3**: Höchstmiete = vereinbarte (nicht geminderte) Nettokaltmiete am Tag drei Jahre vor
   dem Wirksamwerden × (1 + p) + Erhöhungen nach §§ 559 bis 560 seit diesem Tag; p = 20 %, 15 % in Gemeinden mit
   Verordnung (BGH VIII ZR 177/03, VIII ZR 266/14 Rn. 20, VIII ZR 33/18). Begann das Mietverhältnis später, gilt die
   Anfangsmiete (G1). Bezugsgröße ist die vereinbarte Miete in ihrer Struktur, bei Inklusivmiete samt
   Betriebskostenanteil (Gegenprüfung S1). **Beginnt die Kaltmiete-Staffel erst nach dem Stichtag**, obwohl das
   Mietverhältnis früher begann (etwa nach dem Umstieg), ist die Ausgangsmiete unbekannt: Die Rechnung sperrt und
   fragt die Miete am Stichtag ab (M3); sie wird nie aus der ersten bekannten Stufe angenommen.
R5 **Höchstbetrag**: min(Vergleichsmiete je m² × tatsächliche Wohnfläche, Kappungsgrenze); bei Inklusivmiete
   Vergleichsmiete × Fläche plus Betriebskostenanteil (S1). Drittmittel (§ 558 Abs. 5) werden nicht gerechnet, sondern
   führen zum Abbruch mit Hinweis.
R6 **Fristen § 558b**: Zustimmung bis zum Ablauf des zweiten Kalendermonats nach Zugang; geschuldet ab Beginn des
   dritten Kalendermonats nach Zugang; Klage innerhalb von drei weiteren Monaten. Ein späterer Wirksamkeitstag darf
   gewählt werden (VIII ZR 280/12).
R7 **Form § 558a**: Textform, Vermieter erkennbar, an den Mieter, Bitte um Zustimmung, bisherige und neue
   Nettokaltmiete als Betrag, Begründung (Mietspiegel mit Name, Stand, Feld und Spanne und dem Hinweis, wo er
   allgemein zugänglich ist; Gutachten; drei Vergleichswohnungen mit Anschrift, Geschoss bzw. Lage, Fläche und Miete
   je m² (M7); Mietdatenbank). **Gibt es für die Gemeinde einen qualifizierten Mietspiegel, stehen seine Angaben
   immer im Schreiben, auch bei anderer Begründung** (§ 558a Abs. 3, M6); die Eingabe fragt danach. Über dem Oberwert
   der Spanne: Warnung. Alle Vermieter als Absender, alle Mieter als Empfänger (S4: Hinweis, `tenantName` muss alle
   nennen). Schweigen ist keine Zustimmung (S8): kein Text darf das unterstellen.
R8 **Teilinklusivmiete**: Ist `costModel` oder `heatingModel` gleich `inclusive`, zeigt das Schreiben den
   enthaltenen Betriebskostenanteil und die Vergleichsrechnung (VIII ZR 108/20 Rn. 16 f.). Eine Pauschale
   (`flatRate`) ist eine eigene Staffel und braucht keine Herausrechnung (S1). Der Anteil wird aus der letzten
   Abrechnung vorbelegt und ist der tatsächliche Anteil der Wohnung (G5).
R9 **Indexmiete § 557b**: neue Miete = Nettokaltmiete × VPI neu / VPI alt (Verhältnis, nicht Punkte; VIII ZR 291/16),
   beide Werte Monatswerte derselben, beim Zugang aktuellen Reihe (Destatis 61111-0002, Basis 2020 = 100; VIII ZR
   42/20). Hat ein gespeicherter Ausgangsindex eine andere Basis als die aktuelle Reihe, sperrt die Rechnung und
   verlangt beide Werte aus der aktuellen Reihe (M5, Rn. 28, 34). Die Miete muss ein Jahr unverändert sein (§§ 559
   bis 560 ausgenommen); **Zugang erst ein Jahr nach Wirksamwerden der letzten Anpassung bzw. nach Mietbeginn,
   tagesgenau** (M4, G4: die Frist ist Wirksamkeitsvoraussetzung der Erklärung, VIII ZR 42/20 Rn. 37); geschuldet ab
   dem übernächsten Monat nach Zugang. Erklärung in Textform mit beiden Indexwerten, bisheriger und neuer Miete und
   Erhöhung in Euro. Senkungen werden gleich gerechnet und nur angezeigt.
R10 **Staffelmiete § 557a**: Stufen als Beträge in Euro, mindestens ein Jahr Abstand, tritt ohne Erklärung ein.
   Warnung bei Abstand unter einem Jahr. Hinweis, dass jede Stufe bei Fälligkeit die Mietpreisbremse einhalten muss.
R11 **Rundung** (offene Rechtsfrage O1): exakt im Verhältnis rechnen, die neue Miete auf den Cent **abrunden**
   (`practice.rent-increase-rounding`, Auslegung, `adopted`).
R12 **15 % oder 20 %** (O8, O9): 15 %, wenn der Vermieter „ja“ oder „weiß nicht“ angibt; 20 % nur bei „nein“. Die
   Angabe wird je Verlangen mit Datum in `basis` festgehalten (S2). Gerichte können eine Landesverordnung für
   unwirksam halten; Mietfuchs bewertet das nicht.
R13 **Nur Wohnraum, preisfrei** (S6): Die Eingabe verlangt die Bestätigung „Wohnraum, nicht preisgebunden, keine
   Fördermittel“; Garagen, Stellplätze und Gewerbe sind ausgeschlossen.
R14 **Mietart muss beantwortet sein** (M2): Ohne Angabe der Mietart, ohne die Bestätigung „der Vertrag schließt
   Erhöhungen nicht aus“ und ohne „alle vereinbarten Staffelstufen sind erfasst“ ist die Rechnung `blocked`. Eine
   Voreinstellung „nach Vertrag“ wäre nicht die sichere Seite, weil ein Index- oder Staffelvertrag dann ein
   ausgeschlossenes Verlangen nach § 558 angeboten bekäme.

## Datenmodell

1. **Art jeder Staffelstufe der Kaltmiete**: `RentEntry.reason?: RentChangeReason`, neue Spalte
   `base_rents.reason` (TEXT, CHECK auf die Werte, NULL erlaubt).
   ```ts
   export type RentChangeReason =
     | 'agreement'     // Vertragsbeginn oder Vereinbarung nach § 557 Abs. 1 (Voreinstellung, auch für alte Stufen)
     | 'staggered'     // Stufe einer Staffelmiete (§ 557a)
     | 'index'         // Anpassung einer Indexmiete (§ 557b)
     | 'comparison'    // Zustimmung zur Vergleichsmiete (§ 558)
     | 'modernization' // Erhöhung nach §§ 559 bis 559e, auch einvernehmlich, soweit § 559 sie getragen hätte
   ```
   § 560 betrifft nur Betriebskosten und berührt die Kaltmiete-Staffel nicht (S3).
   Fehlt die Art, gilt `agreement`: Sie **zählt** für Wartefrist und Sperrfrist und erhöht die Kappungsgrenze nicht.
   Das ist für jede unbekannte alte Stufe die sichere Seite (Anti-Ziel 4).
2. **Indexwerte an der Stufe**: `RentEntry.index?: { month: 'JJJJ-MM'; value: number; base: number }` (Wert mit
   einer Nachkommastelle, gespeichert in Zehnteln als INTEGER `index_tenths`, Monat `index_month`, Basisjahr
   `index_base`). Bei einer Indexmiete trägt die erste Stufe den Ausgangsindex laut Vertrag, jede Anpassung den neuen.
3. **Mietart am Mietverhältnis**: `Tenancy.rentKind?: 'free' | 'staggered' | 'index' | null`, Spalte
   `tenancies.rent_kind`, fehlend/`null` = **nicht beantwortet** (R14: Rechnung gesperrt, die Oberfläche fragt).
   `free` heißt Miete nach Vertrag, Erhöhung über § 558. Dazu `Tenancy.rentIncreaseExcluded?: boolean | null`
   (§ 557 Abs. 3), `null`/fehlend = nicht beantwortet, ebenfalls gesperrt. Auf Mietkonto, Abrechnung und Steuer
   wirkt keines der Felder.
4. **Kappungsgrenze am Objekt**: `Property.rentCapReduced?: boolean | null`: `true` Verordnung gilt (15 %), `false`
   keine (20 %), `null`/fehlend unbekannt (15 %). Getrennt von `tightMarket`, denn das ist eine andere Verordnung.
5. **Erhöhungsverlangen und -erklärungen**: neue Tabelle `rent_increases` (je Mietverhältnis, Bereich `units` im
   Verlauf):
   ```ts
   export type RentIncrease = {
     id: string
     tenancyId: string
     kind: 'comparison' | 'index'
     createdOn: string         // 'JJJJ-MM-TT'
     receivedOn: string | null // Zugang beim Mieter (eingegeben; ohne Angabe: noch nicht versandt)
     effectiveFrom: string     // 'JJJJ-MM', erster Monat der neuen Miete
     fromCents: number
     toCents: number
     basis: RentIncreaseBasis  // eingefrorene Eingaben und Rechnung (JSON), für Nachdruck und Prüfung
     status: 'draft' | 'sent' | 'agreed' | 'partial' | 'refused' | 'withdrawn'
     agreedCents: number | null // bei 'partial'
     decidedOn: string | null
   }
   ```
   `basis` ist ein eingefrorenes Ergebnis wie ein Abschluss und deshalb JSON (db/CLAUDE.md: „JSON bleibt nur der
   eingefrorene Abschluss“, hier ebenso begründet). Beim Übergang nach `agreed`/`partial` (Vergleichsmiete) bzw. nach
   `sent` (Indexmiete, wirkt ohne Zustimmung) schreibt dieselbe Transaktion die Stufe in `base_rents` mit Art und
   Indexwert. Ein Rücknehmen (`withdrawn`) entfernt eine so geschriebene Stufe nur, wenn sie unverändert ist.

Die Migration legt die Spalten und die Tabelle an, schreibt keine Daten. Legacy-Eingang (db.json) bleibt unverändert;
neue Felder beginnen leer. Backup und Wiederherstellen nehmen die Tabelle von selbst mit; Validator und schema.test
werden ergänzt; `guardTenancy` prüft, dass eine Stufe mit `index` nur bei `rentKind: 'index'` steht und dass
Indexwerte > 0 sind.

## Rechnung (server/src/rentIncrease.ts, rein)

`planRentIncrease(input) → RentIncreasePlan`, Eingabe: Mietverhältnis (Staffel mit Art und Index, Mietart, Ausschluss,
Kostenmodell, Beginn/Ende), Wohnung (Fläche), Objekt (`rentCapReduced`, Bundesland für Feiertage), `today`, und je
nach Art die Eingaben des Vermieters:

- **Vergleichsmiete**: geplanter Zugang (Vorgabe: frühestmöglicher Tag ≥ heute; einen Postlauf gibt es nicht, siehe
  „Umsetzung PR 1“), gewünschter Wirksamkeitsmonat (Vorgabe frühestmöglich),
  Vergleichsmiete je m² (Mittel- oder Einzelwert) mit optionaler Spanne, Begründungsmittel mit Angaben, Fläche
  bestätigt (Vorgabe `areaM2`), enthaltener Betriebskostenanteil bei `costModel` ≠ `settlement`, Bestätigungen
  „preisfreier Wohnraum“, „keine Fördermittel“, gewünschte neue Miete (Vorgabe: Höchstbetrag).
- **Indexmiete**: Ausgangsindex (aus der letzten Stufe, sonst einzugeben), neuer Indexwert mit Monat und Basis,
  geplanter Zugang.

Ergebnis: `state: 'possible' | 'notYet' | 'blocked'`, Gründe als ganze Sätze mit Norm, frühester Zugang und
frühester Wirksamkeitsmonat, Zustimmungsfrist, Klagefrist (nach O2: Klage frühestens nach dem nach § 193
verlängerten Ende, Klagefrist-Ende aus dem nicht verlängerten Monatsende), Kappungsgrenze mit Herleitung
(Ausgangsmiete, Stichtag, Prozent, ausgenommene Erhöhungen), Vergleichsmiete × Fläche, Höchstbetrag, verlangte Miete,
Warnungen (über dem Oberwert, Fläche abweichend, Teilinklusiv). Alle Rechtszahlen aus dem Register, Geld in Cent.

`nextRentEvents(tenancy, …)` für das Cockpit: nächste Staffelstufe, frühester Zugang eines Verlangens bzw. einer
Indexerklärung, Ende der Zustimmungs- und der Klagefrist offener Verlangen.

## Rechtsregister (shared/law)

| Schlüssel | Wert | Norm | Status |
| --- | --- | --- | --- |
| `bgb.rent-increase-wait-months` | 15 | § 558 Abs. 1 Satz 1, 3 | checked |
| `bgb.rent-increase-lock-months` | 12 | § 558 Abs. 1 Satz 2, 3 | checked |
| `bgb.rent-cap` | `{ years: 3, percent: 20, reducedPercent: 15 }` | § 558 Abs. 3 | checked |
| `bgb.rent-increase-consent` | `{ consentMonths: 2, effectiveMonth: 3, suitMonths: 3 }` | § 558b Abs. 1, 2 | checked |
| `bgb.index-rent` | `{ minMonths: 12, effectiveMonthOffset: 2 }` | § 557b Abs. 2, 3 | checked |
| `bgb.staggered-rent` | `{ minMonths: 12 }` | § 557a Abs. 2 | checked |
| `practice.rent-increase-rounding` | `'floor-cent'` | Auslegung (O1) | adopted |
| `practice.vpi-series` | `{ table: '61111-0002', base: 2020 }` | Destatis | adopted |
| ~~`practice.letter-delivery-days`~~ | entfällt, siehe „Umsetzung PR 1“ | | |

Die Verweise auf die Landesportale der Kappungsgrenzen-Verordnungen stehen im Lexikon, nicht im Register (keine Zahl).

## Oberfläche

1. **Stammdaten, Mietverhältnis**: Auswahl „Art der Miete“ (nicht angegeben / nach Vertrag / Staffelmiete /
   Indexmiete) und „Schließt der Vertrag Mieterhöhungen aus?“ (nicht angegeben / nein / ja). In der Kaltmiete-Staffel je Stufe die Art (Auswahl, Vorgabe nach Mietart)
   und bei Indexmiete Indexmonat und -wert. Warnung bei Staffelabstand unter einem Jahr.
2. **Stammdaten, Objekt**: „Gilt in der Gemeinde eine Kappungsgrenzen-Verordnung (15 %)?“ ja / nein / weiß nicht,
   mit Lexikonverweis.
3. **Seitenfenster „Mieterhöhung“**, geöffnet aus dem Mietverhältnis (Stammdaten) und aus dem Cockpit:
   - Kopf: Mietart, aktuelle Miete, seit wann, frühester Zugang, Kappungsgrenze.
   - Vergleichsmiete: Formular wie oben, rechts bzw. darunter die Rechnung mit Herleitung, unten „Schreiben
     ansehen“ (Druckansicht im Briefformat, DIN 5008 wie das Anschreiben, gleicher Briefkopf) und „Als versendet
     speichern“ mit Zugangsdatum.
   - Indexmiete: Indexwerte, Rechnung, Schreiben, „Als versendet speichern“ (schreibt die Stufe).
   - Staffelmiete: Liste der Stufen mit Hinweis zur Mietpreisbremse; nach der letzten Stufe Vergleichsmiete.
   - Offene Verlangen: Status setzen (zugestimmt / teilweise / abgelehnt / zurückgenommen); „zugestimmt“ trägt die
     Stufe ein. Nachdruck aus `basis`.
4. **Cockpit „Demnächst fällig“** (neue `kind`-Werte): `rentStep` (Staffelstufe in den nächsten 90 Tagen, Info),
   `rentIncrease` (Erhöhung ab Datum möglich, Info, nur wenn heute ≥ frühester Zugang − 90 Tage), `rentConsent`
   (Zustimmungsfrist läuft / abgelaufen ohne Antwort: offen, mit Klagefrist).
5. **Lexikon**: Vergleichsmiete, Kappungsgrenze (mit Verweisen je Land), Indexmiete, Staffelmiete,
   Mieterhöhungsverlangen, Zustimmungsfrist; gesiezt, mit nachgerechneten Beispielen und Norm.

## Schreiben

Gerendert im Client mit den vorhandenen Bausteinen (`LetterHead`, `PrintPages`, Briefpapier), Werte vom Server aus
`basis`. Vergleichsmiete: Betreff „Mieterhöhungsverlangen nach § 558 BGB“, Bitte um Zustimmung, bisherige und neue
Nettokaltmiete (bei Teilinklusivmiete samt Betriebskostenanteil und Vergleichsrechnung), Wirksamkeitsmonat,
Begründungsmittel mit den eingegebenen Angaben (Mietspiegel: Name, Stand, Feld, Spanne; Vergleichswohnungen: drei
Anschriften mit Miete je m²; Gutachten: Hinweis „liegt bei“), Kappungsgrenze, Zustimmungsfrist als Datum, Hinweis
auf Klage nach Fristablauf ohne Drohung, Unterschrift. Indexmiete: Betreff „Anpassung der Miete nach § 557b BGB
(Indexmiete)“, beide Indexwerte mit Monat und Basis, bisherige und neue Miete, Erhöhung in Euro, ab Monat.
Die Vorauszahlungen bleiben unverändert und werden genannt. Kein Text ist frei bearbeitbar außer einem
Zusatzabsatz; die Pflichtangaben stehen fest.

## Aufteilung in PRs (gestapelt)

1. **Daten und Register**: Spalten, Tabelle (leer), Typen, Validator, Wächter, Rechtsregister, Lexikon, Stammdaten
   (Mietart, Art je Stufe, Indexwerte, Kappungsgrenze am Objekt), Entwurf und Plan im Repo.
2. **Rechnung**: rentIncrease.ts mit Invarianten, Route `GET /api/tenancies/:id/rent-increase/plan` (POST mit
   Eingaben, nur lesend), Seitenfenster mit Rechnung ohne Schreiben.
3. **Schreiben und Übernahme**: Tabelle `rent_increases` befüllt, Routen zum Speichern und Statuswechsel mit
   Marke wie #317, Druckansicht, Verlauf-Sätze, Druckbreiten-Fall.
4. **Cockpit**: drei neue Einträge in „Demnächst fällig“, Sprungziele, Doku, CHANGELOG, Schließt den Rest von #190.

## Tests

- Rechnung: Beispiele aus der Recherche (Fristbeispiel Zugang 20.11.2026 → Zustimmung bis 31.01.2027, wirksam
  01.02.2027, Klage bis 30.04.2027; BGH-Rechenbeispiele VIII ZR 177/03 und VIII ZR 291/16 nachgerechnet).
- Invarianten über zufällige Staffeln (fester Startwert): Höchstbetrag ≤ Kappungsgrenze und ≤ Vergleichsmiete ×
  Fläche; frühester Zugang nie vor Sperrfrist; eine Stufe mit Art `modernization` verschiebt nie Fristen nach vorn und
  erhöht die Grenze genau um ihren Betrag; Art `agreement` statt einer anderen Art macht nie etwas früher oder höher.
- Bestandsschutz: settlement-golden, db-golden, Steuer-Golden und invariant-mietkonto unverändert grün; Migration
  auf einer echten Vorversion; Backup und Wiederherstellen mit `rent_increases`.
- Client: Auswahlfelder zeigen den gespeicherten Wert (Art je Stufe, Mietart, Kappungsgrenze ja/nein/unbekannt).

## Gegenprüfung vom 20.11.2026

Unabhängig gegen Wortlaut und BGH-Volltexte geprüft (gegenpruefung.md). Alle Registerzahlen bestätigt. Die
Muss-Befunde M1 bis M7 und die Soll-Befunde S1 bis S8 sind oben eingearbeitet. Antworten: G1 Anfangsmiete, wenn die
Staffel im Monat des Mietbeginns beginnt, sonst M3; G2 ja, eine vereinbarte Erhöhung zählt (§ 558 Abs. 1 Satz 3,
VIII ZR 285/06, VIII ZR 177/03); G3 monatsgenau für Stufen, tagesgenau beim Mietbeginn, kein Zugang am Monatsersten;
G4 ab Wirksamwerden der letzten Anpassung bzw. Mietbeginn; G5 ein Betrag genügt, vorbelegt aus der letzten
Abrechnung. Schädlich wäre im freien Zusatzabsatz eine Änderung der Mietstruktur oder der Vorauszahlungen
(VIII ZR 108/20 Rn. 18 f.): Der Zusatzabsatz bekommt einen Hinweis darauf.

Testwert: VIII ZR 291/16 mit Abrunden ergibt 771,53 € (nicht die gerundete Erhöhung des BGH).

## Umsetzung PR 1 (Daten und Register), 20.11.2026

Abweichungen und Festlegungen gegenüber dem Entwurf:

- **Kein Postlauf im Register** (S7). Im Bestand gibt es keine Zugangsregel: prepaymentSteps.ts (`monthNotes`) rechnet
  nur mit dem Versanddatum und sagt „prüfen Sie“, BGH VIII ZR 271/10 betrifft die Wirkung für die Zukunft, nicht den
  Postlauf, und shared/rentDue.ts rechnet Zahlungseingänge (`bgb.transfer-execution-days`), keine Briefe. Für eine Zahl
  von Tagen bis zum Zugang eines einfachen Briefs gibt es keine belastbare Quelle (die Bekanntgabefiktion in § 122
  Abs. 2 AO und § 41 Abs. 2 VwVfG gilt für Behörden, nicht für Willenserklärungen nach § 130 BGB). **Offener Punkt für
  PR 2:** Vorgabe des geplanten Zugangs ist „heute“, der Vermieter trägt den tatsächlichen Zugang ein; nur `receivedOn`
  zählt für Fristen.
- **`bgb.rent-cap` ohne Beginn der Fassung.** Die 15 % gibt es seit dem Mietrechtsänderungsgesetz 2013; der Tag des
  Inkrafttretens ist nicht im BGBl. gelesen, deshalb hat die Fassung kein `validFrom` (Gegenprüfung K2). **Offener
  Punkt** für die jährliche Durchsicht: BGBl. 2013 I lesen und die Fassung teilen (bis dahin rechnet Mietfuchs nur mit
  Zugängen ab heute, wo die Fassung gilt).
- **Basisjahr eines Indexwerts**: ganze Zahl von 1950 bis 2100 (Repository und Bedingung). Im Formular heißt ein leeres
  Basisjahr die aktuelle Reihe aus `practice.vpi-series`; gespeichert wird immer die Zahl.
- **Indexwert**: höchstens eine Nachkommastelle, sonst eine 400 mit Satz (nicht gerundet), gespeichert in Zehnteln.
- **Unbekannte Werte** von `rentKind` und `reason` sind eine 400 mit Satz und werden nicht still zu „nicht angegeben“
  bzw. `agreement`, damit eine vertippte Modernisierung nicht als Vereinbarung gespeichert wird.
- **Vorgabe der Art einer Stufe** im Formular: die erste Stufe `agreement`, jede weitere nach der Art der Miete
  (`staggered`, `index`, sonst `agreement`). Alte Stufen ohne Art zeigen „Nicht angegeben (wie Vereinbarung)“.
- **`RentIncreaseBasis`** ist bis PR 3 nur „ein JSON-Objekt“ (`{ readonly [key: string]: unknown }`, Bedingung
  `json_type = 'object'`); den Inhalt legt PR 3 fest.
- **Hinweis zum Staffelabstand** nur bei `rentKind: 'staggered'`; eine Stufe der Art Modernisierung zählt dabei nicht.
