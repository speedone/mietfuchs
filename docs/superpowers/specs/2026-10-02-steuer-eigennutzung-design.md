# Werbungskosten bei teilweiser Eigennutzung (#163)

Teil von #96, ausgegliedert, weil es eine Zahl der Steuererklärung betrifft. Recherche und
Konzeptentwurf stehen im Kommentar zu #163; hier stehen die Entscheidungen zu den offenen Fragen
F1 bis F6 und was daraus gebaut wurde. Rechtsaussagen tragen ihre Quelle; was nicht amtlich
belegt ist, steht als **Auslegung** da.

## Ziel

Bei einem Haus, in dem der Vermieter selbst wohnt, sind die Kosten nur zu dem Teil
Werbungskosten, der auf den vermieteten Teil entfällt. Bisher zeigte die Steuerübersicht die
Werbungskosten in voller Höhe und rechnete den Überschuss damit; der private Anteil stand nur als
Satz daneben („nimmt die Aufteilung nicht vor“). In der Abnahme vor v0.9.0 (Fall 1) standen
3.210 € Werbungskosten da, davon 2.196 € privat.

**Wer selbst nicht im Haus wohnt, merkt nichts.** Ohne selbstgenutzte Wohnung ist der private
Anteil jeder Position 0, und jede Zahl der Übersicht bleibt, wie sie war. Eine Invariante über
Zufallsbestände hält das fest.

## Rechtslage in drei Sätzen

- Aufwendungen für eine eigengenutzte oder unentgeltlich überlassene Wohnung sind keine
  Werbungskosten (§ 9 Abs. 1, § 12 Nr. 1 EStG; Anleitung zur Anlage V 2024).
- Was einer Wohnung direkt zugeordnet werden kann, gehört ganz zu ihr: „Sind die Aufwendungen nur
  teilweise Werbungskosten …, tragen Sie bitte den direkt zuordenbaren Anteil (z. B.
  Badrenovierung) in die Zeilen ‚durch direkte Zuordnung ermittelt‘ ein. Können Sie die
  Aufwendungen nicht direkt zuordnen (z. B. bei einer Dachreparatur) und haben Sie diese in
  anderer Weise den Wohnungen zugeordnet (z. B. nach dem errechneten Verhältnis der Nutzflächen in
  Prozent), dann füllen Sie bitte die Zeilen ‚durch verhältnismäßige Zuordnung ermittelt‘ aus.
  Haben Sie die Aufwendungen zum ersten Mal verhältnismäßig aufgeteilt, dann erläutern Sie bitte
  den Aufteilungsmaßstab sowie die Zuordnung in einer gesonderten Aufstellung.“ (Anleitung zur
  Anlage V 2024, Zeilen 33 bis 84, wörtlich gelesen.)
- Was sich nicht eindeutig zuordnen lässt, wird „regelmäßig nach dem Verhältnis der
  eigengenutzten Wohn-/Nutzflächen des Gebäudes zu denen, die der Vermietung … dienen“ aufgeteilt
  (BFH, Urteil vom 24.06.2008, IX R 26/06, Rz. 10).

## Entscheidungen

### F1: Umlagefähige Kosten — Eigenanteil aus der Abrechnung

**Entscheidung:** Für umlagefähige Kostenarten ist der private Anteil der Eigenanteil, den die
Nebenkostenabrechnung desselben Jahres für diese Position ausweist (`landlordParts` mit dem Grund
`selfUse`, #142). Abrechnung und Steuerübersicht nennen damit dieselbe Zahl.

**Begründung.** Der BFH nennt das Flächenverhältnis für Aufwendungen, die sich „nicht eindeutig
zuordnen“ lassen. Die Abrechnung ordnet aber vieles eindeutig zu: nach gemessenem Verbrauch, nach
Einzelbeträgen des Messdienstes, direkt auf eine Wohnung, nur auf die Teilnehmer einer Position.
Ein pauschales Flächenverhältnis wäre dort ungenauer als die Abrechnung, nicht genauer. Wo sie nach
Fläche verteilt, kommt ohnehin dasselbe heraus wie beim BFH-Maßstab, solange keine Wohnung außerhalb
der Abrechnungseinheit liegt. Und die Abrechnung ist ein Papier, das beim Mieter liegt; ein
zweiter Eigenanteil für dieselbe Rechnung wäre eine zweite Wahrheit, die niemand erklären kann.
Gemessen an der Leitlinie des Projekts (#91: nachvollziehbar und konsistent) ist das die bessere
Wahl.

**Was nicht belegt ist (Auslegung).** Bei Personen, Wohneinheiten, vereinbarten Anteilen und der
Gemeinschaftsabrechnung folgt der Eigenanteil dem Schlüssel und nicht der Fläche. Eine Aussage der
Rechtsprechung oder Verwaltung zu Umlageschlüsseln als Aufteilungsmaßstab wurde nicht gefunden.
Für den Sonderfall gemeinsam genutzter Räume hat der BFH die Zahl der Nutzer als objektiven Maßstab
anerkannt (BFH vom 25.06.2009, zitiert in H 21.2 EStH 2024); das zeigt, dass der Flächenmaßstab
nicht der einzige sachgerechte ist, deckt die Umlageschlüssel aber nicht ab. Deshalb rechnet die
Übersicht für diese Positionen zusätzlich den privaten Anteil nach der Fläche des ganzen Gebäudes
und **beziffert den Unterschied in einem Hinweis** (`mixedUseKeyNotArea`), mit dem Rat, den
Maßstab mit dem Steuerberater abzustimmen.

**Ausnahme:** Hat die Abrechnung eine Position gar nicht verteilt (Grund `noBasis`, etwa Verbrauch
ohne Ablesungen), sagt sie über den Eigenanteil nichts. Dann gilt die Regel für Gebäudekosten
(Fläche, siehe unten).

### F2: Keine Zeilennummer je Position

Ob umlagefähige Kosten, deren Eigenanteil beim Vermieter bleibt, zu den „umgelegten“ oder „nicht
umgelegten“ Kosten gehören, sagt die Anleitung nicht. Ihr Wortlaut („Neben- und / oder
Betriebskosten …, die Sie auf Ihre Mieter umgelegt haben“, Zeilen 73 bis 75; „die Sie nicht auf
Ihre Mieter umgelegt haben“, Zeilen 76 bis 78; Anleitung 2024) lässt beides zu. **Mietfuchs nennt
deshalb keine Zeilennummer je Position**, sondern bleibt bei den beschreibenden Gruppen. Genannt
wird, was amtlich belegt ist: die Zeilen 11 und 12 (Gesamtwohnfläche, eigengenutzter Wohnraum,
Vordruck 2025) und die Form der Zeilenpaare „durch direkte Zuordnung ermittelt“ / „durch
verhältnismäßige Zuordnung ermittelt“ mit „Gesamtbetrag“ und „abzugsfähiger Anteil (in %)“
(Vordruck 2025). Genau diese Angaben liefert die Tabelle je Position.

### F3: Die Garage zählt mit ihrer Fläche

Der BFH rechnet mit „Wohn-/Nutzflächen“; eine vermietete Garage ist Nutzfläche und dient der
Vermietung. Sie zählt deshalb im Nenner, **sofern eine Fläche eingetragen ist**. Eine Garage mit
0 m² (#135) ändert am Verhältnis nichts. Für Zeile 11 gilt das nicht: „Nicht zu den Wohnflächen
gehören Zubehörräume, z. B. Keller, Dachböden, Schuppen und Garagen“ (Anleitung 2024). Der
Hinweis zur Aufteilung sagt das. Eine eigene Eigenschaft „Wohnraum / Nutzraum“ an der Einheit wäre
eine Erweiterung mit Migration und gehört nicht hierher.

### F4: § 35a — nur erwähnen

Der Lohnanteil bleibt, wie er ist (`labor35aCents`). Die Ermäßigung gibt es nur, soweit die
Aufwendungen keine Werbungskosten sind und den eigenen Haushalt betreffen (§ 35a Abs. 4 und 5
EStG); ob und wie der Anteil der eigenen Wohnung in die eigene Erklärung gehört, entscheidet
Mietfuchs nicht. Trägt eine Position mit Lohnanteil einen privaten Teil, nennt ein Hinweis das
(`mixedUseLabor35a`); das Lexikon (`ownShare`) sagt es schon.

### F5: Wechsel der Nutzung im Jahr — Hinweis statt Staffel

Die Nutzung einer Einheit hat keine Zeitachse. Hatte eine selbstgenutzte Einheit im Jahr ein
Mietverhältnis, sagt ein Hinweis (`mixedUseChangedInYear`), dass der Flächenanteil der
Gebäudekosten nicht nach Tagen gerechnet ist. Eine Nutzungsstaffel an der Einheit bräuchte eine
Migration und eine eigene Abnahme; sie gehört in ein eigenes Issue.

### F6: Anleitung 2025

Eine Anleitung zur Anlage V 2025 war nicht auffindbar (gesucht: ELSTER-Hilfe, Formular-Management-
System der Bundesfinanzverwaltung, Landesamt für Steuern Bayern, stotax-Helpdesk). Geprüft wurde
der amtliche Vordruck 2025 („2025AnlV101NET – September 2025 –“, Kopie bei steuern.de): Zeile 11
„Gesamtwohnfläche (in m²)“, Zeile 12 „in Zeile 11 enthaltener eigengenutzter / unentgeltlich an
Dritte überlassener Wohnraum (in m²)“, die Zeilenpaare mit direkter und verhältnismäßiger
Zuordnung und der Satz „Bitte füllen Sie die Zeilen zu den verhältnismäßig zugeordneten
Werbungskosten nur aus, wenn die Aufwendungen für das Gebäude nur teilweise Werbungskosten sind“.
Die Erläuterungen stammen aus der Anleitung 2024 (September 2024), wörtlich gelesen. Weil keine
Zeilennummer je Position genannt wird (F2), hängt an einer Verschiebung der Zeilen 73 bis 78 nichts.

## Rechenregel je Position

Selbstgenutzt heißt `selfUsed && !participates`, wie überall. Abziehbar ist immer der Rest:
`abziehbar = Betrag − privat`, je Position, damit nichts verloren geht.

| Lage | privat | Zuordnung |
| --- | --- | --- |
| umlagefähig, verteilt | Eigenanteil der Abrechnung | `settlement` (bei Direktzuordnung `direct-self` / `direct-rented`) |
| umlagefähig, nicht verteilt (`noBasis`) | wie Gebäudekosten | `area` |
| umlagefähig, direkt auf eine Einheit außerhalb der Abrechnungseinheit | 0 | `direct-outside` |
| nicht umlagefähig, direkt auf die eigene Einheit | Betrag | `direct-self` |
| nicht umlagefähig, direkt auf eine vermietete oder leere Einheit | 0 | `direct-rented` |
| nicht umlagefähig, direkt auf eine Einheit außerhalb | 0, Hinweis | `direct-outside` |
| nicht umlagefähig, sonst | Betrag × Fläche eigen ∩ B / Fläche B | `area` |
| B ohne Fläche oder eigene Einheit in B ohne Fläche | 0, Hinweis | `unsplittable` |

B sind die betroffenen Einheiten: die Teilnehmer der Position, sonst alle Einheiten des Objekts
(Grundmenge ganzes Gebäude wie #68). Gerundet wird kaufmännisch je Position und bei einer
Gutschrift spiegelbildlich. Die Zuführung zur Erhaltungsrücklage bleibt außen vor (#143).

**Bei abgeschlossener Abrechnung gilt ihr eingefrorener Stand**, wie schon bei Eigenanteil und
Vorauszahlungen (#70): Der Auszug in `frozenSettlementOf` liest die Eigenanteile je Position aus
`landlord.rows[].landlordParts`. Ein Archivstück von vor #142 kennt sie nicht; dann wird die
eingefrorene Summe im Verhältnis der heutigen Eigenanteile auf die Positionen verteilt
(Restverfahren, Kennung als Entscheid), und ein Hinweis sagt, dass sich seit dem Abschluss etwas
geändert haben kann.

**Nicht umlagefähig direkt zuordnen.** Bisher speicherte das Formular für „Nicht umlagefähig“
immer den neutralen Schlüssel. Jetzt bietet es „Betrifft (für die Steuer)“ an: das ganze Gebäude
oder eine Einheit. Gespeichert wird `key: 'direct'` mit der Einheit; die Abrechnung liest den
Schlüssel weiterhin nicht. Keine Migration.

## Nachträge aus der Durchsicht

- **Einheiten außerhalb der Abrechnungseinheit.** Die Abrechnung verteilt nur über die
  Abrechnungseinheit; ihr Eigenanteil behandelte eine getrennt abgerechnete Gewerbeeinheit wie
  privat (100 m² eigen, 100 m² vermietet, 100 m² Gewerbe, Grundsteuer 3.000 € nach Fläche:
  1.500 € statt 1.000 €). Entschieden: Gehört eine solche Einheit zu den betroffenen Einheiten
  einer umlagefähigen Position, die nach Fläche, Einheiten, Personen, vereinbarten Anteilen oder
  laut Gemeinschaft verteilt wird, gilt für die Steuer der Flächenmaßstab über das ganze Gebäude
  (BFH-Regelmaßstab); der Eigenanteil der Abrechnung steht als `settlementPrivateCents` zum
  Vergleich daneben, und ein Hinweis beziffert den Abstand. Verbrauch und Einzelbeträge bleiben
  bei der Abrechnung, denn sie ordnen eindeutig zu. Damit ist F1 eingeschränkt: „Abrechnung und
  Steuer sagen dasselbe“ gilt, solange alle Einheiten zur Abrechnungseinheit gehören.
- **Abgeschlossene Abrechnung.** Der eingefrorene Eigenanteil gilt nur für Positionen, die mit
  demselben Betrag im eingefrorenen Stand stehen (`itemTotals` aus den Zeilen der Mieter und des
  Vermieters). Eine danach erfasste Position galt sonst als 0 privat, ein danach geänderter Betrag
  ergab einen negativen abziehbaren Teil. Solche Positionen rechnet die Übersicht heute und zählt
  sie für einen Hinweis (`closedItemsChanged`).
- **Nicht umlagefähig für bestimmte Einheiten.** Das Formular bietet neben „ganzes Gebäude“ und
  einer Einheit „bestimmte Einheiten“ (Teilnehmer), etwa für das Dach des Hinterhauses.
- **Personenschlüssel.** Der Hinweis zum Abstand nennt Leerstand als typische Ursache; Kosten
  einer leerstehenden Wohnung bleiben bei Vermietungsabsicht abziehbar.

## Was nicht gerechnet wird

AfA (Zeilen 33/34 kennen ebenfalls die verhältnismäßige Zuordnung), Schuldzinsen (sie folgen der
Zuordnung des Darlehens, BMF vom 16.04.2004 und BFH vom 04.02.2020, IX R 1/18), die Verteilung
nach § 82b EStDV, die Kürzung bei verbilligter Vermietung (Zeilen 87/88: Aufwendungen voll
eintragen, gekürzt wird dort), der Verkehrswertmaßstab und die Tagesgewichtung bei wechselnder
Nutzung. Alles steht als Hinweis da.

## Datenmodell der Antwort

`TaxReport.expenses` bekommt `privateCents`, `deductibleCents` und `items` (je Position Betrag,
privat, abziehbar, Zuordnung, abzugsfähiger Anteil in Prozent, der Vergleich nach Fläche und der
Rechenweg). Gruppen und Kostenarten bekommen `privateCents` und `deductibleCents`. `totalCents`
bleibt die Bruttosumme. **Der Überschuss rechnet mit dem abziehbaren Teil**; ohne Eigennutzung ist
das dieselbe Zahl wie bisher. Dazu `selfUseChangedInYear` und `closedSelfUseDiffers`. Die
Datenbank ändert sich nicht.

**Regression des Umstiegs:** `taxReport` wird verglichen. Beide Seiten rechnen mit demselben Code;
fehlende Flächen und Direktzuordnungen auf gelöschte Wohnungen werden beim Geraderücken so
übernommen, wie die Regel sie liest (`u.areaM2 || 0`, unbekannte Wohnung wie keine). `steps` steht
schon auf der Liste der Beschriftungen.

## Darstellung

- Kopfkarte „Werbungskosten (abziehbar)“, darunter „gesamt … · davon privat …“.
- Mit Eigennutzung eine Tabelle je Position: Gesamt · privat · abziehbar · Zuordnung („direkt“,
  „anteilig 42,86 %“), aufklappbar mit dem Rechenweg; im Druck steht die Zuordnung als Spalte, das
  Blatt taugt so als gesonderte Aufstellung.
- Ohne Eigennutzung bleibt die Tabelle, wie sie war.
- Hinweise: `mixedUseSplit`, `mixedUseKeyNotArea`, `mixedUseAreaMissing`,
  `mixedUseDirectOutside`, `mixedUseChangedInYear`, `mixedUseClosedChanged`, `mixedUseLabor35a`,
  `mixedUseNotCalculated`.

## Quellen

- § 9, § 11, § 12, § 35a EStG, gesetze-im-internet.de
- Anleitung zur Anlage V 2024 (September 2024), Kopie: http://www.steuerhexe.de/wp-content/uploads/2025/05/Anlage-V-2024-Anleitung.pdf
  (ebenso https://helpdesk.stotax.de/filesystem/est_2024/46_Anleitung_Anlage_V_2024.pdf), wörtlich gelesen
- Vordruck Anlage V 2025 („2025AnlV101NET – September 2025 –“), Kopie: https://www.steuern.de/fileadmin/user_upload/Steuerformulare_2025/Anlage_V_2025_steuern-de.pdf, Seiten 1 und 2 gelesen
- BFH, Urteil vom 24.06.2008, IX R 26/06, Rz. 10 (Zitat aus dem Konzeptentwurf zu #163)
- H 21.2 EStH 2024 (BFH 25.06.2009 Nutzerzahl; BMF 16.04.2004 Schuldzinsen), https://esth.bundesfinanzministerium.de/
- BFH, Urteil vom 04.02.2020, IX R 1/18 (Darlehenszuordnung)
