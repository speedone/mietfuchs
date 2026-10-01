# Jährliche Durchsicht der Rechtslage 2026 (#110)

Geprüft am 02.10.2026. Rechtsstand danach: `RULES_AS_OF = '2026-10-02'`.

## Wie geprüft wurde

- **Gelesen:** Die Checkliste aus #110, die offenen Punkte aus #109 samt der Recherche vom
  30.09.2026, `server/src/rules.ts` und `shared/glossary.ts`.
- **Quellen:** Wo möglich die Primärquelle:
  - Gesetzestexte als XML-Fassung von gesetze-im-internet.de, jeweils mit Erzeugungsdatum.
  - Drucksachen von dserver.bundestag.de.
  - Urteile und Pressemitteilungen auf bundesgerichtshof.de und bundesfinanzhof.de.
  - Veräußerungsberichte der DEHSt.
- **Grenzen:**
  - Das Suchkontingent der Sitzung war nach etwa der Hälfte aufgebraucht. Danach wurden nur noch bekannte Adressen unmittelbar abgerufen.
  - recht.bund.de (BGBl. 2026), bmjv.de und die Seiten des BMWE antworteten nicht oder mit Fehler 500. dip.bundestag.de verlangt einen Schlüssel.
  - formulare-bfinv.de liefert nur über JavaScript aus. Die Anlage V 2025 ist deshalb nach einer Drittkopie des amtlichen Vordrucks gelesen (Formularkennung „2025AnlV101NET“).
- **Kennzeichnung:** Jede Aussage trägt eine Quelle und eine der Sicherheitsstufen:
  - **P**: Primärquelle selbst gelesen
  - **S**: nur Sekundärquelle
  - **A**: eigene Auslegung des Wortlauts
  - **offen**: nicht gefunden oder nicht geprüft

Jeder Befund bekommt eine Auswirkung auf Mietfuchs: **rechnet anders**, **warnt**, **erklärt** oder **nichts**.

## 1. BetrKV, HeizkostenV, CO2KostAufG

### BetrKV

- **Befund:** unverändert seit Art. 4 G v. 16.10.2023 (BGBl. I Nr. 280); die XML-Fassung ist vom 06.05.2026. Das Gebäudemodernisierungsgesetz (siehe unten) ändert die BetrKV nicht. Einen Entwurf zu Glasfaser, Wärmepumpenstrom, Ladesäulen oder Rauchwarnmeldern gibt es nicht. **P** / offen für Vorhaben ohne Entwurf.
  Quelle: https://www.gesetze-im-internet.de/betrkv/
- **Auswirkung:** nichts. Die Regel `tv-signal` bleibt richtig.

### HeizkostenV

Die Verordnung ist unverändert seit Art. 3 G v. 16.10.2023 (BGBl. I Nr. 280). **P**
Quelle: https://www.gesetze-im-internet.de/heizkostenv/BJNR002610981.html

- **§ 5 Abs. 2:** Geräte, die nach dem 01.12.2021 eingebaut werden, müssen fernablesbar sein. Ab dem 01.12.2022 eingebaute müssen zusätzlich an ein Smart-Meter-Gateway angebunden werden können. **P**
- **§ 5 Abs. 3:** Nicht fernablesbare Altgeräte „müssen bis zum 31. Dezember 2026 die Anforderungen nach den Absätzen 2 und 5 durch Nachrüstung oder Austausch erfüllen“. Ausnahmen: technische Unmöglichkeit, unangemessener Aufwand, unbillige Härte. **P**
- **§ 5 Abs. 4:** Die Anbindung der bis 01.12.2022 eingebauten fernablesbaren Geräte an das Gateway und ihre Interoperabilität sind nach dem 31.12.2031 Pflicht. **P**
- **§ 6a:** Gilt, sobald fernablesbare Geräte eingebaut sind. Seit 01.01.2022 ist dem Mieter monatlich eine Verbrauchsinformation mitzuteilen. Mindestinhalt: Vormonat, Vergleich mit dem Vorjahresmonat und mit einem Durchschnittsnutzer. **P**
- **§ 12 Abs. 1 Satz 2 und 3:** 3 % Kürzung, wenn „entgegen § 5 Absatz 2 oder Absatz 3“ keine fernablesbare Ausstattung eingebaut ist oder die Informationen nach § 6a fehlen. Das gilt nicht im Verhältnis des Wohnungseigentümers zur Gemeinschaft. **P**
  - Für Altgeräte gibt es einen Verstoß gegen Abs. 3 erst nach Ablauf des 31.12.2026. Die Kürzung greift also für Abrechnungszeiträume ab 2027. **A**
- **§ 11 und § 12 Abs. 3:** Wärmepumpen sind nicht mehr ausgenommen. Wer ihren Verbrauch am 01.10.2024 noch nicht erfasste, musste bis 30.09.2025 nachrüsten. **P**
- **§ 5 Abs. 8:** Der Evaluationsbericht war zum 31.08.2025 fällig. **offen**, nicht gefunden.
- **Novelle zur Umsetzung von EED (EU) 2023/1791 oder EPBD (EU) 2024/1275:** nicht gefunden. **offen**

**Auswirkung:**
- **warnt** (umgesetzt): neue Regel `heating-remote-reading` ab 01.01.2027 und ein Hinweis in der Abrechnung, siehe Abschnitt 6.
- Eine **bezifferte** 3-%-Kürzung braucht ein Feld „fernablesbar“ am Zähler. Sie gehört zur Heizkostenabrechnung (#97, #99) und ist nicht umgesetzt.
- **erklärt:** Lexikon „Heizkostenverordnung“ um die Nachrüstfrist ergänzt.
- Zu den Wärmepumpen stimmt das Lexikon bereits.

### CO2KostAufG

- **Geändert** durch Art. 5 des Gebäudemodernisierungsgesetzes vom 23.07.2026 (BGBl. 2026 I Nr. 226), in Kraft seit 29.07.2026. **P**
  Quelle: https://www.gesetze-im-internet.de/co2kostaufg/ (XML-Fassung vom 29.07.2026)
  - **§ 5a (neu):** Gilt bei Einbau und Betrieb einer Heizung nach § 43 GModG im Bestandsgebäude. Vermieter und Mieter tragen je hälftig:
    - die Gas-Netzentgelte ab 01.01.2028,
    - die CO2-Kosten, abweichend vom Stufenmodell,
    - ab 01.01.2029 die Kosten der verpflichtend beizumischenden Brennstoffe.

    Abs. 2: Versorgt sich der Mieter selbst, ermittelt er das selbst. **P**
  - **§ 5b:** Neubauten. **§ 5c:** Evaluierung. **§ 5d:** Härtefälle. **§ 3 Abs. 1 Nr. 6:** Der Anteil der Brennstoffe nach § 43 muss auf der Rechnung stehen. **P** (§§ 5b bis 5d nur im Überblick gelesen)
- **Stufenmodell (Anlage) unverändert:** 10 Stufen, von unter 12 kg CO2/m²/a (Vermieter 0 %) bis ab 52 (Vermieter 95 %). **P**
- **§ 4, maßgeblicher Preis:**
  - 2026 der Mittelwert des Preiskorridors, also 60 €/t.
  - Ab 2027 der Durchschnittspreis der Versteigerungen vom 01.07. bis 30.11. des Vorjahres; das UBA veröffentlicht ihn spätestens zehn Werktage vor Jahresbeginn. **P** (Wortlaut)
  - Der Betrag von 60 € ist aus 55 und 65 € gerechnet. **A**
- **§ 10, Erfahrungsbericht** (fällig 31.12.2025, danach alle zwei Jahre): nicht gefunden. **offen**
- **Auswirkung:** nichts heute. Mietfuchs rechnet die CO2-Aufteilung noch nicht. Das gehört zu #97, Kommentartext unten.

### CO2-Preis (BEHG) und ETS 2

- **BEHG § 10 Abs. 2:** 2025 Festpreis 55 €/t, 2026 Korridor 55 bis 65 €/t. Stand Art. 2 G v. 27.02.2025 (BGBl. I Nr. 70). **P**
  Quelle: https://www.gesetze-im-internet.de/behg/
- **2026 tatsächlich:** Alle Versteigerungen gingen zum Höchstpreis von 65 €/t weg. Laut DEHSt-Bericht August 2026 sind es mehr als 170,7 Mio. Zertifikate. **P**
  Quelle: https://www.dehst.de/SharedDocs/downloads/DE/nehs/verkaufsberichte-nehs/2026/2026-08-veraeusserungsbericht.pdf
- **ETS 2:** auf 2028 verschoben, laut DEHSt-Meldung zur Einigung vom 05.11.2025. Rechtsgrundlage ist laut BT-Drs. 21/7869 die Verordnung (EU) 2026/667 vom 11.03.2026. **P** für die deutsche Darstellung; den Text der EU-Verordnung selbst nicht gelesen.
- **BT-Drs. 21/7869 gibt es.** Es ist der Gesetzentwurf der Bundesregierung „Entwurf eines Dritten Gesetzes zur Änderung des Brennstoffemissionshandelsgesetzes“ vom 07.09.2026. **P**
  Quelle: https://dserver.bundestag.de/btd/21/078/2107869.pdf
  - Er schreibt den Korridor 55 bis 65 €/t auch für 2027 fest und verschiebt das Ende der Pflichten nach dem BEHG auf 2028.
  - Das CO2KostAufG ändert er nicht.
  - Ob er beschlossen ist: **offen**.
- **UBA-Wert 2027:** noch nicht veröffentlicht, fällig Mitte Dezember 2026. Schließen die Versteigerungen bis November weiter bei 65 €, ergäben sich 65 €/t. Das ist eine **Prognose**, nicht belegt.
- **Auswirkung:** nichts heute (#97).

### Emissionsfaktoren (EBeV 2030, Anlage 2)

- **Befund:** unverändert seit der Erstfassung (BGBl. I 2022, 2868). Erdgas 0,0558 t CO2/GJ, Heizöl EL 0,074 t CO2/GJ, Flüssiggas 0,0655 t CO2/GJ. **P**
  Quelle: https://www.gesetze-im-internet.de/ebev_2030/
- **Auswirkung:** nichts heute (#97).

### Gebäudemodernisierungsgesetz (bisher GEG)

- **Befund:** verkündet am 28.07.2026 (BGBl. 2026 I Nr. 226), erste Teile in Kraft seit 29.07.2026. Die Kurzbezeichnung des GEG ist jetzt „GModG“. **P** (gesetze-im-internet); die Daten des Ablaufs laut https://www.gmodg.bund.de/ **S**
- **§ 43 GModG:** Neue Gas- und Ölheizungen im Bestand müssen anteilig Biobrennstoff nutzen, ab 2029 10 %, ab 2030 15 %. **P**
- **§ 71o GEG** entfällt. Der Mieterschutz steht jetzt in §§ 5a bis 5d CO2KostAufG und im neuen § 559f BGB, der die Modernisierungsumlage einer Wärmepumpe an die Jahresarbeitszahl bindet. **P**
- **§ 60a GModG:** Betriebsprüfung von Wärmepumpen; das Ergebnis ist dem Mieter auf Verlangen vorzulegen. **P**
- Die verkündete Fassung im BGBl. selbst ist nicht gelesen (recht.bund.de war nicht erreichbar). **offen**
- **Auswirkung:**
  - nichts für Betriebskosten. Mietfuchs rechnet keine Modernisierungsumlage.
  - Für Abrechnungen ab 2028 kommt die hälftige Teilung nach § 5a CO2KostAufG hinzu (#97).

## 2. BGB §§ 556 ff. und WEG

- **§ 556 BGB:** seit 01.01.2025 unverändert. Abs. 4 lautet: „Der Vermieter hat dem Mieter auf Verlangen Einsicht in die der Abrechnung zugrundeliegenden Belege zu gewähren. Der Vermieter ist berechtigt, die Belege elektronisch bereitzustellen.“ **P**
  - Herkunft: Viertes Bürokratieentlastungsgesetz vom 23.10.2024 (BGBl. I Nr. 323), laut https://dejure.org/gesetze/BGB/556.html. **S**
  - Quelle: https://www.gesetze-im-internet.de/bgb/__556.html
  - **Auswirkung:** erklärt, später. Gehört zur Belegmappe in #170.
- **§§ 556a, 556b, 556c, 560 BGB:** 2025/2026 unverändert. **P** (Wortlaut), **S** (Fassungsliste dejure)
- **§ 556d BGB:** Die Mietpreisbremse gilt bis 31.12.2029 (Gesetz vom 17.07.2025, BGBl. I Nr. 163). **P**
  - **Auswirkung:** nichts.
- **„Mietrecht II“** (Kabinett 29.04.2026, erste Lesung 09.07.2026): Indexmiete, Möblierung, Kurzzeitmiete, Schonfrist. Zu Betriebskosten, Belegeinsicht oder §§ 556, 560 steht nach den Sekundärquellen nichts darin. **S**
  - Quelle: https://www.mietervereinigung-berlin.de/news/mietrechtspaket-ii-moeblierte-wohnungen-mietpreisbremse.html; den Entwurfstext selbst nicht gelesen.
  - **Auswirkung:** nichts heute. Bis Dezember verfolgen.
- **BGB-Änderungen 2026** (BGBl. I Nr. 139 vom 12.05., Nr. 212 vom 16.07., Nr. 226 vom 23.07.): Nr. 226 ist das GModG mit § 559f. Ob Nr. 139 und 212 das Mietrecht berühren: **offen**. In der Fassungsliste der §§ 556, 556d und 557b tauchen sie nicht auf.
- **WEG:** unverändert seit Art. 1 G v. 10.10.2024 (virtuelle Versammlung). **P**
  - Quelle: https://www.gesetze-im-internet.de/woeigg/

## 3. EStG (§ 35a, § 11) und Anlage V

### § 35a EStG

- **Geltende Fassung:** 20 %, höchstens 510 € (Minijob), 4.000 € (Dienstleistungen) und 1.200 € (Handwerker). Kein Abzug, soweit Werbungskosten. **P**
  Quelle: https://www.gesetze-im-internet.de/estg/__35a.html
- **Einkommensteuerreformgesetz 2027:** existiert als Gesetzentwurf.
  - BR-Drs. 507/26 vom 04.09.2026: https://dserver.bundestag.de/brd/2026/0507-26.pdf
  - wortgleich BT-Drs. 21/8235 vom 28.09.2026: https://dserver.bundestag.de/btd/21/082/2108235.pdf
  - Art. 1 Nr. 5 fasst § 35a Abs. 3 Satz 1 neu: „15 Prozent …, höchstens jedoch um 900 Euro“, erstmals für den VZ 2027.
  - Abs. 1 und 2 bleiben.
  - **Nicht beschlossen.** Die Frist für die Stellungnahme des Bundesrats läuft am 16.10.2026 ab. **P**
- **BMF-Schreiben:** maßgeblich bleibt das vom 09.11.2016 (BStBl I 2016, 1213), geändert am 01.09.2021. Ein Nachfolger ist nicht gefunden. **S**/**offen**
  - Nach Rz. 47 f. kann der Mieter die Handwerkerkosten aus einer Nebenkostenabrechnung im Jahr ihres Zugangs ansetzen. **S**
- **Auswirkung:** nichts vor der Verkündung, so wie in #110 vorgemerkt. Danach:
  - Regel und Lexikon „Lohnanteil nach § 35a EStG“ nach Jahr unterscheiden.
  - Darauf hinweisen, dass eine Abrechnung 2026, die 2027 zugeht, beim Mieter schon unter 15 %/900 € fallen kann.
  - Mietfuchs rechnet die Ermäßigung selbst nicht aus, es weist nur den Lohnanteil aus. Der bleibt gleich.

### § 11 EStG

- **Befund:** unverändert, auch nicht im Entwurf 2027. **P**
  Quelle: https://www.gesetze-im-internet.de/estg/__11.html
- **Auswirkung:** nichts. Der Hinweis zur Zehn-Tage-Regel bleibt richtig.

### Anlage V 2025

Gelesen nach einer Drittkopie des amtlichen Vordrucks, Formularkennung 2025AnlV101NET. **S**

- **Zeile 6:** „Aktenzeichen laut Grundsteuermessbescheid – bisher Einheitswert-Aktenzeichen –“, schon seit dem Vordruck 2024.
- **Zeilen 11 und 12:** Gesamtwohnfläche sowie eigengenutzte oder unentgeltlich überlassene Fläche.
- **Zeilen 13 bis 15:** Mieteinnahmen ohne Umlagen.
- **Zeile 20:** laufend vereinnahmte Umlagen.
- **Zeile 21:** im Jahr erhaltene Nachzahlungen und geleistete Erstattungen.
- **Zeile 24 (Kennzahl 13):** „Neben- / Betriebskosten wurden nicht gesondert vereinbart. 1 = Ja“.
- **Zeilen 55 bis 72:** Erhaltungsaufwand „einschließlich Entnahmen aus der Erhaltungsrücklage“.
- **Zeilen 76 bis 78:** nicht umgelegte Kosten „– ohne Erhaltungsrücklage –“.

Die Hinweise zu den Zeilen 20, 21 und 24 in `client/src/pages/Steuer.tsx` und `client/src/taxView.ts` passen dazu.

- **Anlage V 2026:** Vordruck und Entwurf sind noch nicht veröffentlicht. **offen**
- **Bekanntmachungsschreiben des BMF zu den Vordrucken 2025:** nicht gefunden. **offen**
- **Auswirkung:** nichts. Aus #109 ist damit die Frage zur Zeile 6 beantwortet; Kommentar für #96 unten.

## 4. Rechtsprechung

### BGH VIII. Zivilsenat (2025 und 2026)

- **20.05.2026, VIII ZR 6/24** (Nachschlagewerk). **P**, Urteil selbst gelesen.
  Quelle: https://www.bundesgerichtshof.de/SharedDocs/Entscheidungen/DE/Zivilsenate/VIII_ZS/2024/VIII_ZR___6-24.pdf
  - a) Die Einwendungsfrist des § 556 Abs. 3 Satz 5 und 6 gilt auch für den Einwand, das Wirtschaftlichkeitsgebot sei verletzt.
  - b) Fehlende Vergleichsangebote allein verletzen das Gebot nicht. Es kommt auf objektiv überhöhte, nicht marktgerechte Preise an.
  - c) Kann der Vermieter die Frist unverschuldet nicht einhalten, muss er im Regelfall binnen drei Monaten nach Wegfall des Hindernisses nachfordern (Rn. 62). Hat er gegen den Messbescheid oder den Einheitswert- bzw. Grundsteuerwertbescheid Einspruch eingelegt, besteht das Hindernis fort, bis über den Einspruch entschieden ist; bis dahin darf er abwarten (Rn. 66 f.).
  - **Achtung:** Die Recherche vom 30.09.2026 (#109) führte „BGH VIII ZR 6/24“ unter „nicht belegt“, und zwar als angebliches Urteil zu Pflichtangaben. Das Aktenzeichen gibt es, das Urteil betrifft aber Wirtschaftlichkeit, Einwendungsfrist und Grundsteuer. Zu Pflichtangaben bleibt es unbelegt.
  - **Auswirkung:** erklärt (umgesetzt), Lexikon „Abrechnungsfrist“. Nach der Grundsteuerreform 2025 sind verspätete und angefochtene Bescheide häufig.
- **20.05.2026, VIII ZR 46/25 und VIII ZR 47/25** (Pressemitteilung 090/2026). **P**
  Quelle: https://www.bundesgerichtshof.de/SharedDocs/Pressemitteilungen/DE/2026/2026090.html
  - § 556c BGB ist weder unmittelbar noch entsprechend anwendbar, wenn der Mieter bisher mit eigenen Einzelöfen geheizt hat und der Vermieter auf gewerbliche Wärmelieferung umstellt. Die Kosten sind dann ohne Vereinbarung nicht ohne Weiteres umlagefähig.
  - **Auswirkung:** erklärt, später (#97/#99). Mietfuchs kennt die Wärmelieferung nicht als eigene Art.
- **Weitere Entscheidungen**, alle **nichts** für Mietfuchs: VIII ZB 82/25 (Streitwert einer Klage auf Belegeinsicht), VIII ZR 250/23 (Verkehrssicherung), VIII ZR 50/23, VIII ZR 125/23 und VIII ZR 56/25 (Mietpreisbremse), VIII ZR 228/23 (Untervermietung). Fundstellen in der Pressemitteilungsliste des BGH. **S** (nur aus der Liste übernommen, nicht einzeln gelesen)
- **Nicht gefunden** seit 2025: Urteile zu Umlageschlüssel, Rauchwarnmeldermiete, Gartenpflege, Hauswart, § 560 Abs. 4 und Indexmiete.
  - Die Durchsicht der Pressemitteilungen 2025/2026 ist vollständig. Die Entscheidungsdatenbank ist nur mit den Stichworten „Betriebskosten“ und „Heizkosten“ durchsucht.
  - „VIII ZR 123/24“ (nebenkosten-assistent.de) ist nicht nachprüfbar, bitte nicht zitieren.

### BGH V. Zivilsenat (WEG)

Alle Leitsätze in der Datenbank des BGH gelesen. **P**

- **11.04.2025, V ZR 96/24:** Entnahmen aus der Erhaltungsrücklage gehen nicht in die Verteilung und nicht in die Abrechnungsspitze ein.
  **Auswirkung:** erklärt, später (#96).
- **14.02.2025, V ZR 128/23 und V ZR 236/23** (Pressemitteilung 033/2025): Die Gemeinschaft darf den Schlüssel per Beschluss ändern, zum Beispiel auf beheizte Wohnfläche. Über § 556a Abs. 3 BGB ändert sich dann auch der Schlüssel gegenüber dem Mieter.
  **Auswirkung:** nichts. Mietfuchs übernimmt die Beträge der Gemeinschaft bereits so, wie sie abgerechnet hat.
- **27.03.2026, V ZR 7/25:** Die Gemeinschaft muss nicht allgemein Vergleichsangebote einholen. Das passt zu VIII ZR 6/24.
- **Weitere Leitsätze**, alle **nichts**: V ZR 108/24, V ZR 206/24, V ZR 190/24, V ZR 102/24.

### BFH IX. Senat (2025 und 2026)

Auf bundesfinanzhof.de gelesen. **P**

- **14.01.2025, IX R 19/24:** Die Zuführung zur Erhaltungsrücklage ist erst bei Verausgabung abziehbar.
  Quelle: https://www.bundesfinanzhof.de/de/entscheidung/entscheidungen-online/detail/STRE202510025/
  **Auswirkung:** bereits umgesetzt (#143, Lexikon „Erhaltungsrücklage“).
- **Weitere Urteile**, alle **nichts** für Mietfuchs: IX R 2/24, IX R 23/24 (Ferienwohnung), IX R 24/24 (§ 7b), IX R 26/24, IX R 4/24, IX R 9/24, IX R 33/22.
- **Ohne neues Urteil seit 2025:** § 35a (zuletzt VI R 24/20 vom 20.04.2023, Mieter), Aufteilung bei Eigennutzung, verbilligte Vermietung, Zufluss und Abfluss von Nebenkosten.
- **Grundsteuer:** Der BFH hält das Bundesmodell (II R 3/25 u. a., 12.11.2025) und das Landesgrundsteuergesetz Baden-Württemberg (II R 26/24, II R 27/24, 22.04.2026) für verfassungsgemäß.
  **Auswirkung:** nichts. Die Grundsteuer bleibt nach § 2 Nr. 1 BetrKV umlagefähig.

## 5. Offene Rechtsfragen aus #109, erneut durchgesehen

| Frage | Stand 02.10.2026 |
|---|---|
| HeizkostenV: Frist für fernablesbare Geräte, Wärmepumpen | **beantwortet** (P). Frist bis 31.12.2026, danach 3 % Kürzung. Wärmepumpen sind seit 01.10.2024 nicht mehr ausgenommen, Nachrüstung bis 30.09.2025. |
| Anlage V ab 2025: Aktenzeichen aus dem Grundsteuermessbescheid? | **beantwortet** (S, Drittkopie des amtlichen Vordrucks). Ja, Zeile 6, schon seit dem Vordruck 2024. |
| CO2-Kostenaufteilung: Umfang bei Fernwärme, Selbstversorger bei Etagenheizung | Teilweise. Für die neuen Anlagen nach § 43 GModG regelt § 5a Abs. 2 den Selbstversorger ausdrücklich (P). Die Regeln zu Wärmelieferung und Fernwärme in § 3 wurden nicht Satz für Satz auf Änderungen geprüft (offen). Rechtsprechung zum CO2KostAufG wurde nicht gefunden. |
| Wohnfläche im CO2KostAufG | weiter offen, das Gesetz definiert sie auch nach der Änderung nicht. |
| Nachträgliche Änderung einer Abrechnungseinheit | weiter offen, keine neue Entscheidung gefunden. |
| Übrige Punkte | Stand der Recherche vom 30.09.2026, nichts Neues. |

## 6. Umgesetzt auf diesem Zweig

- **`server/src/rules.ts`:**
  - neue Regel `heating-remote-reading`, `validFrom: '2027-01-01'`, Rechtsgrundlage § 5 Abs. 2 und 3, § 6a, § 12 Abs. 1 Satz 2 und 3 HeizkostenV;
  - `RULES_AS_OF = '2026-10-02'`.
- **`server/src/calc.ts`:**
  - neuer Hinweis `heating.remote-reading`, Stufe `hint`, ohne Betrag.
  - Er erscheint einmal je Abrechnung, sobald die Regel im Jahr gilt und ein Mieter über eine Heizposition abgerechnet wird; er hängt an der ersten solchen Position.
  - Nicht bei Warmmiete oder Pauschale.
  - Ab 2027 steht die Regel mit im Rechtsstand der Abrechnung.
- **`shared/glossary.ts`:**
  - „Heizkostenverordnung“: Nachrüstfrist 31.12.2026 und der Hinweis ab 2027.
  - „Abrechnungsfrist“: verspäteter oder angefochtener Grundsteuerbescheid, drei Monate, VIII ZR 6/24.
- **Test an der Grenze:** `server/test/rechtsdurchsicht-2026.test.ts`.
  - Abrechnung 2026 ohne Hinweis, 2027 mit Hinweis.
  - Regelabdeckung am 31.12.2026 und 01.01.2027.
  - eine Meldung bei zwei Heizpositionen, keine ohne Heizposition und keine bei Warmmiete.
  - Lexikontexte.
  - Regel, Hinweis und Abrechnungsfrist waren vor der Änderung rot und danach grün. Die Prüfung der Nachrüstfrist im Lexikon kam erst nach der Textänderung dazu.
- **`CHANGELOG.md`:** zwei Einträge unter „Unveröffentlicht“.

**Bewusst nicht umgesetzt:**
- § 35a (erst nach Verkündung),
- CO2-Preis und §§ 5a bis 5d CO2KostAufG (#97),
- die bezifferte 3-%-Kürzung (#97/#99, braucht das Feld am Zähler),
- Hinweis zu § 556c nach VIII ZR 46/25 (#97/#99),
- elektronische Belegeinsicht (#170).

## 7. Bis zur Durchsicht im Dezember 2026 verfolgen

1. **Einkommensteuerreformgesetz 2027** (BR-Drs. 507/26, BT-Drs. 21/8235): Stellungnahme des Bundesrats (Frist 16.10.2026), Beschluss, Verkündung. Erst dann eine Regel `labor-35a` mit Gültigkeit und das Lexikon nach Jahr.
2. **BT-Drs. 21/7869** (BEHG, Korridor 2027) und der **UBA-Wert 2027** nach § 4 CO2KostAufG (spätestens zehn Werktage vor dem 01.01.2027). Dazu die DEHSt-Berichte September bis November.
3. **Anlage V 2026:** Vordruck und Anleitung, Zeilennummern 6, 11, 12, 20, 21 und 24 gegen die Hinweise der Steuerübersicht prüfen. Die amtliche Anleitung 2025 gegenlesen.
4. **Mietrecht II:** zweite und dritte Lesung; prüfen, ob noch etwas zu Betriebskosten oder Belegen hineinkommt.
5. **BGBl. 2026 I Nr. 139 und 212:** Berühren sie das Mietrecht? Den Wortlaut des GModG im BGBl. nachlesen.
6. **HeizkostenV:** Evaluationsbericht nach § 5 Abs. 8 und eine mögliche Novelle zur EED/EPBD. **CO2KostAufG:** Erfahrungsbericht nach § 10.
7. **BGH VIII. Zivilsenat:** Entscheidungsdatenbank für Betriebs- und Heizkosten nachsehen, denn Leitsatzentscheidungen wie VIII ZR 6/24 erscheinen ohne Pressemitteilung.
8. **Nachfolger des BMF-Schreibens zu § 35a.**
