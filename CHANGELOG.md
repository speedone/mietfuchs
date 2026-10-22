# Changelog

Alle nennenswerten Änderungen an Mietfuchs. Das Format orientiert sich an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionen an
[Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Hinzugefügt

- Nicht vereinbarte Betriebskosten trägt der Vermieter ([#258](https://github.com/speedone/mietfuchs/issues/258)):
  Nehmen Sie im Kostenformular eine Wohnung aus der Verteilung, fragt Mietfuchs, warum sie die Kosten
  nicht trägt. Steht eine Kostenart nicht im Mietvertrag, tragen Sie den Anteil dieses Mieters selbst;
  die übrigen Mieter zahlen deshalb nie mehr. Hat eine Wohnung mehrere Mietverhältnisse, wählen Sie
  das betroffene aus. Über „Ein Mieter trägt das laut Mietvertrag nicht …“ nennen Sie solche Mieter
  auch ohne Umweg. Bei „Sonstige Betriebskosten“ fragt das Formular je Mieter, ob der Vertrag die Kosten
  nennt. Bestehende Positionen „Sonstige Betriebskosten“ zeigen deshalb einen Hinweis, bis Sie je
  Mieter beantwortet haben, ob der Mietvertrag ihn nennt; die Beträge ändern sich dadurch nicht. Für
  die Heizung verweist das Formular auf die Inklusivmiete. Beim Übernehmen aus dem Vorjahr fragt die
  Vorschau bei einem neuen Mieter nach dessen Vertrag.
- Anteil im Ein- und Auszugsmonat im Formular des Mietverhältnisses: Unter Kaltmiete,
  Vorauszahlung, Heizvorauszahlung und Pauschale steht bei einem Einzug oder Auszug mitten im Monat,
  wie viele Tage dieses Monats zählen und welcher Betrag daraus wird, etwa „Einzug am 15.10.2026: Im
  Oktober 2026 zählen 17 von 31 Tagen, also 82,26 € statt 150,00 €.“ Die Staffel nennt weiterhin nur
  Monate, denn Mieterhöhungen und Anpassungen der Vorauszahlung gelten ab einem Monatsbeginn; gerechnet
  wurde der angebrochene Monat schon vorher anteilig. Die Beträge sind dieselben wie in Abrechnung und
  Mietkonto.
- Bundesland am Objekt, für Fristen und Feiertage: In den Stammdaten tragen Sie unter „Bundesland (für
  Fristen und Feiertage)“ ein, in welchem Land das Objekt liegt. Ohne Angabe gelten nur die
  Feiertage, die in allen Ländern gelten. Feiertage, die nur in einzelnen Gemeinden gelten (Mariä
  Himmelfahrt in Teilen Bayerns, das Augsburger Friedensfest, Fronleichnam in Teilen Sachsens und
  Thüringens), nennt die Karte, zählt sie aber nicht mit. Das Mietkonto sagt im laufenden Jahr, bis
  wann die Miete des Monats zu zahlen ist: am dritten Werktag, ohne Samstag (§ 556b Abs. 1 BGB, BGH
  VIII ZR 129/09), sofern der Mietvertrag nichts anderes bestimmt; verschiebt ein Feiertag einzelner
  Gemeinden die Frist, steht das dabei. Gestrichelte Monate heißen dort jetzt „zählen noch nicht als
  Rückstand“ statt „noch nicht fällig“. Die
  Berechnung des Rückstands ändert sich dadurch nicht. Darunter liegen zwei
  geprüfte Bausteine für künftige Fristen: die gesetzlichen Feiertage der 16 Länder ab 1995 und das
  Fristende am nächsten Werktag nach § 193 BGB. Regeln und Feiertage stehen im Rechtsregister, jede
  Fassung mit Fundstelle; der Rechtsstand ist jetzt der 15.10.2026
  ([#290](https://github.com/speedone/mietfuchs/issues/290)).
- „Bezahlt am (für die Steuer)“ an der Kostenposition: Wer eine Rechnung in einem anderen Jahr
  bezahlt hat als im Jahr ihrer Abrechnung, etwa eine Nachzahlung im Folgejahr oder eine
  Versicherung, die schon im Dezember für das nächste Jahr gezahlt wurde, trägt das Datum unter
  „Weitere Angaben“ ein. Die Steuerübersicht und die Belege für die Steuer stellen die Position dann
  in das Jahr der Zahlung (§ 11 Abs. 2 EStG), auch über Abrechnungsjahre hinweg; der private Teil
  kommt weiter aus der Abrechnung ihres Zeitraums. Das Datum steht für die ganze Position und geht
  einem angegebenen Jahr der Zahlung vor. Ändert es das Steuerjahr, widerspricht es dem Jahr der
  Zahlung oder liegt es weit außerhalb des Zeitraums, fragt Mietfuchs vor dem Speichern nach. Bei
  Hausgeld laut Gemeinschaftsabrechnung gibt es kein Datum, sondern einen Hinweis; bei Abschlägen
  bleibt das Feld leer. Um den Jahreswechsel weist Mietfuchs auf die Zehn-Tage-Regel hin, bei der
  Grundsteuer nicht. Die Belegbuchung trägt das Rechnungsdatum nicht als Zahlungsdatum ein. Ohne
  Datum ändert sich keine Zahl, und die Abrechnung an die Mieter liest das Datum nie
  ([#255](https://github.com/speedone/mietfuchs/issues/255)).
- Die Steuerübersicht zeigt, was zwischen den Jahren verschoben ist: Positionen aus der Abrechnung
  eines anderen Jahres, die in diesem Jahr bezahlt sind, mit Herkunft und Grund (Zahlungsdatum,
  angegebenes Jahr der Zahlung oder Stromrechnung), und umgekehrt die Positionen der Abrechnung
  dieses Jahres, die in einem anderen Steuerjahr stehen. Liegt ein Zahlungsdatum weit außerhalb des
  Abrechnungszeitraums, etwa nach einem Wechsel des Zeitraums, bittet sie um Prüfung. Ein ruhiger
  Satz nennt, wie viele Positionen ohne Angabe im Jahr ihrer Abrechnung stehen. Die Übersicht in den
  Belegen für die Steuer hat dazu die Spalte „Jahr der Zahlung“. Keine Zahl ändert sich
  ([#255](https://github.com/speedone/mietfuchs/issues/255)).

- Zahlungen im Mietkonto haben eine Art: „Miete“ (Voreinstellung) oder „Nachzahlung oder Guthaben
  aus der Abrechnung“, ein ausgezahltes Guthaben mit Minus. Das Mietkonto verteilt nur die Miete auf
  die Monate und führt Nachzahlungen und Guthaben gesondert, auch für Mieter, die schon ausgezogen
  sind; vorher ließ ein im Juni erstattetes Guthaben den Dezember offen stehen, und eine Nachzahlung
  erschien als Überzahlung. Die Steuerübersicht zählt beide Arten weiter als Zufluss und nennt
  Nachzahlungen und Erstattungen aus der Nebenkostenabrechnung zusätzlich gesondert: den Zufluss
  ohne Abrechnung für die Zeilen der Mieten und Umlagen und den Saldo, für 2023 bis 2025 mit Zeile 21
  der Anlage V; beide ergeben zusammen den Zufluss. Bisher erfasste Zahlungen bleiben Miete, keine Zahl
  ändert sich; ein früher als Miete erfasstes Guthaben oder eine Nachzahlung stellen Sie in der Liste
  der Zahlungseingänge unter „Art“ auf „Abrechnung“ um. Ein mit der Miete verrechnetes Guthaben
  tragen Sie als volle Miete und das Guthaben mit Minus als Abrechnung ein
  ([#280](https://github.com/speedone/mietfuchs/issues/280)).
- Vor jedem Release und einmal die Woche prüft ein Browserlauf jede Seite in Chromium, Firefox und
  WebKit (Safari), am Rechner und am Handy, hell und dunkel: keine Fehler in der Konsole, keine Seite
  breiter als der Bildschirm, Barrierefreiheit mit axe-core, dazu Seitenfenster, Monatsfeld,
  Begriffserklärung, Fehlermeldungen und die Navigation am Handy per Tastatur. Ohne ihn wird beim Tag
  nichts ans Release gehängt ([#340](https://github.com/speedone/mietfuchs/issues/340)).
- Musterseite für die Entwicklung: Unter `?muster` (dunkel mit `?muster=dunkel`) zeigt Mietfuchs alle Bausteine der
  Oberfläche mit festen Werten, ohne Bestand. Der Browserlauf prüft sie wie jede Seite, und `npm run screenshots`
  fotografiert sie hell und dunkel ([#346](https://github.com/speedone/mietfuchs/issues/346)).

### Geändert

- Die Karte „Objekt“ in den Stammdaten zeigt die Angaben nur noch an, übersichtlich in zwei Spalten,
  auch was fehlt („nicht angegeben“) und ob Vermieter und Bankverbindung aus den Einstellungen kommen.
  Bearbeitet wird über „Bearbeiten“ im Seitenfenster, wie bei Wohnungen und Mietverhältnissen;
  „+ Weiteres Objekt anlegen“ steht jetzt oben rechts auf der Seite. Eine gespeicherte IBAN, die
  vermutlich falsch eingetragen ist, nennt schon die Karte.
- Heizkosten: Der Hinweis zu den CO₂-Kosten sagt in einem Satz, was zu tun ist (die Rechnung als
  Lieferung eintragen). Der Weg von Hand steht eingeklappt darunter und nur noch, wenn niemand die
  Heizkosten abrechnet („Niemand“); bei der eigenen Heizkostenabrechnung passt er nicht
  ([#341](https://github.com/speedone/mietfuchs/issues/341)).
- Kontraste: Leere Monatskacheln im Mietkonto sind nicht mehr abgedunkelt (Schrift jetzt über 4,5:1), und
  die Vorjahresbalken samt Legende im Kostenvergleich heben sich im hellen wie im dunklen Design
  mindestens 3:1 von der Karte ab ([#341](https://github.com/speedone/mietfuchs/issues/341)).
- Neue, ruhigere Gestaltung: neutrale graue Flächen, weiße Karten mit feiner Linie und eine helle
  Seitenleiste, in der der gewählte Menüpunkt hell getönt hervorsteht. Indigo bleibt für das, womit
  Sie etwas tun: den Hauptknopf, Links, den Fortschritt und den Fokusrahmen. Es gibt nur noch drei
  Arten von Knöpfen (Hauptknopf, Knopf mit Rahmen, roter Knopf zum Löschen), Feldbeschriftungen
  stehen fett in Textfarbe, und das dunkle Design ist fast schwarz. Summen- und Rechenwegzeilen der
  Abrechnung heben sich im Dunkeln deutlicher ab. Am Handy stehen in Staffeln (etwa „Personenzahl
  gültig ab“) die Felder auf einer Höhe, auch wenn eine Beschriftung umbricht, und die Knöpfe unten
  im Seitenfenster teilen sich die Breite ohne den Hinweis auf Tastenkürzel. Gedruckt wird wie
  bisher hell ([#346](https://github.com/speedone/mietfuchs/issues/346)).
- Am Handy (schmaler als 900 Bildpunkte) steht die Navigation nicht mehr als hoher Block über jeder
  Seite. Oben bleibt ein schmaler Kopf mit der Seite und „Objekt · Jahr“; ☰ öffnet das Menü von
  links mit allen Seiten, Objekt, Jahr und Design, ⇅ springt dort direkt zur Wahl von Objekt und
  Jahr. Unten liegt eine Leiste mit Cockpit, Erfassen, Zähler, Stammdaten und „Mehr“. Die Listen
  der Wohnungen, Mietverhältnisse, Zähler, Kosten und Zahlungen erscheinen am Handy als Karten statt
  als Tabelle zum seitlichen Wischen; in der Abrechnung und im Kostenvergleich bleibt beim Wischen
  die erste Spalte stehen. Am Rechner ändert sich nichts
  ([#346](https://github.com/speedone/mietfuchs/issues/346)).
- Mietfuchs steht ab dieser Version unter der GNU Affero General Public License, Version 3
  (AGPL-3.0), statt unter der MIT-Lizenz. Für Vermieter, die Mietfuchs auf dem eigenen Rechner
  nutzen, ändert sich nichts. Wer eine veränderte Fassung weitergibt oder als Online-Dienst
  anbietet, muss ihren Quellcode unter derselben Lizenz offenlegen. Versionen bis 0.11.3 bleiben
  unter der MIT-Lizenz.

- Das Versanddatum einer abgeschlossenen Abrechnung wird erst mit „Speichern“ übernommen; vorher
  stand schon ein verklicktes Datum im Kalender fest, und an ihm hängt die Frist nach § 556 Abs. 3
  BGB. „Verwerfen“ stellt das gespeicherte Datum wieder her, und wer mit einem ungespeicherten
  Datum Jahr oder Objekt wechselt, wird vorher gefragt, ebenso beim Wechsel zwischen Betriebs- und
  Heizkostenabrechnung. Nach demselben Muster speichern die beiden Druckeinstellungen auf der
  Abrechnung (Vorschlag zur Vorauszahlung, Belegkopien) und der Schalter für die Update-Prüfung in
  den Einstellungen erst mit „Speichern“, ebenso auf der Seite Heizkosten die Karten „Ausnahmen und
  Vereinbarungen“ (ein „Speichern“ für die ganze Karte) und „Betriebsstrom der Heizung“ sowie die
  Verknüpfung einer Position mit ihrer Lieferung, im Belegordner Objekt und Jahr eines Belegs im
  Posteingang und das Zuordnen eines Belegs zu einer Position, und in der Auswertung eines Belegs das
  Jahr der Buchung (bis es gespeichert ist, gibt es dort weder Vorschau noch Buchung). Die
  Schaltflächen nennen für Vorleser zuerst ihren sichtbaren Text, also auch „Speichert …“
  ([#309](https://github.com/speedone/mietfuchs/issues/309)).
- Wer mit einer angefangenen Eingabe die Seite wechselt, über die Seitenleiste, das Menüblatt oder
  die untere Leiste am Handy, wird vorher gefragt („Ungespeicherte Änderungen verwerfen?“); vorher
  war die Eingabe still weg. Ebenso fragt der Browser, wenn Sie den Tab mit offener Eingabe
  schließen oder neu laden. Das gilt auch für Sprünge aus einer Seite wie „Hier beheben →“ und für das
  Blatt „CO₂-Angaben für den Messdienst“, und für Seitenfenster, Eingaben auf der Seite wie die
  Ablesung, die Karten auf der Seite Heizkosten, „Betrag prüfen“ im Belegordner und die Entscheidungen in
  einer Belegauswertung. Nach dem Speichern fragt nichts mehr nach
  ([#346](https://github.com/speedone/mietfuchs/issues/346)).

- Rückfragen („Zahlung löschen?“, „Ungespeicherte Änderungen verwerfen?“) liegen jetzt als echtes
  Dialogfenster über allem, auch über dem Menü am Handy: Das Menü bleibt dafür offen, und nach
  „Abbrechen“ stehen Sie wieder dort, wo Sie waren. Enter wirkt auf den Knopf, auf dem der Fokus steht
  (bei „Löschen“ und „Verwerfen“ zuerst „Abbrechen“), Esc und ein Klick daneben brechen ab, und
  Vorleser nennen die Rückfrage mit ihrer Frage und ihrem Satz dazu (Befund H1 aus
  [#341](https://github.com/speedone/mietfuchs/issues/341);
  [#346](https://github.com/speedone/mietfuchs/issues/346)).

- Seitenfenster (Wohnung, Mietverhältnis, Zähler, Kosten, Zahlung, Heizung und die übrigen) fragen
  „Änderungen verwerfen?“, bevor sie Ihre Eingaben verwerfen: bei Esc, beim ✕, bei „Abbrechen“ und bei
  einem Klick daneben. Ohne Änderung schließen sie sofort wie bisher, und ein Seitenwechsel fragt bei
  einem unveränderten Fenster nicht mehr nach. Solange ein Seitenfenster offen ist, ist der Rest der
  Seite gesperrt: Tab wandert durch das Fenster und die Leiste des Browsers, aber nicht mehr in die
  Seite dahinter, und nach dem Schließen steht der Fokus wieder auf dem Knopf, der es geöffnet hat (Befund M4 aus [#341](https://github.com/speedone/mietfuchs/issues/341);
  [#346](https://github.com/speedone/mietfuchs/issues/346)).

- Fehler beim Speichern stehen jetzt an dem Feld, das sie betreffen, und zusätzlich in einer
  Sammelmeldung „Bitte prüfen Sie N Angaben“, deren Zeilen zum Feld führen. Im Seitenfenster steht sie
  im festen Fuß über den Knöpfen und ist damit immer zu sehen, auch wenn das Fenster nach unten gerollt
  ist; in einer Karte oben in der Karte. Statt eines Satzes für mehrere Felder („Bitte Mieter, Wohnung
  und Einzugsdatum prüfen.“) nennt jede Zeile ihr Feld. Vorleser hören die Meldung sofort, das Feld ist
  als fehlerhaft markiert, und beim Ändern des Felds verschwindet die Meldung. Pflichtfelder tragen ein
  Sternchen, erklärt durch „* Pflichtangabe“ über den Feldern; beim Öffnen ist kein leeres Feld rot.
  Umgestellt sind die Seitenfenster für Wohnung, Mietverhältnis,
  Zähler, Kostenposition, Zahlung, Heizung und eigene Heizkostenabrechnung, die Ablesung auf der Seite
  Zähler, die Karten auf der Seite Heizkosten, die Karte „Objekt“ und „Vermieter & Zahlung“. Schlägt
  das Löschen fehl, steht der Grund als Mitteilung da, die acht Sekunden stehen bleibt, statt oben auf
  der Seite außerhalb des Bildes (Befunde H3 und M5 aus
  [#341](https://github.com/speedone/mietfuchs/issues/341);
  [#346](https://github.com/speedone/mietfuchs/issues/346)).

- Jahresfelder blättern: Neben „Geeicht bis Ende (Jahr)“ am Zähler und „Jahr der Zahlung (für die
  Steuer)“ beim Auslesen einer Messdienstabrechnung stehen jetzt ‹ › zum Blättern um ein Jahr; im
  leeren Feld beginnt es beim laufenden Jahr bzw. beim Ende des Zeitraums. Ein zweistelliges Jahr wie
  „28“ wird nicht still ergänzt, sondern beim Verlassen am Feld gemeldet („Jahr vierstellig angeben“);
  ein Eichjahr vor 1900 oder nach 2100 gilt als Tippfehler.

- Monate tippen Sie jetzt in ein Textfeld, wie Sie sie kennen: „3.2025“, „03/25“, „2025-03“, „März
  2025“ oder „Mrz 27“; beim Verlassen steht dort „März 2025“. Daneben öffnet ▦ ein Raster mit den
  zwölf Monaten und dem Jahr, das sich auch per Tastatur bedienen lässt (Pfeile, Pos1/Ende, Bild auf
  und ab für das Jahr, Enter wählt, Esc schließt nur das Raster); am Handy erscheint es als Blatt am
  unteren Rand. Das gilt für die Staffeln am Mietverhältnis (Kaltmiete, Vorauszahlung,
  Heizvorauszahlung, Pauschale), den Wechsel des Abrechnungszeitraums und die Heizperiode. Vorher waren
  es zwei Auswahllisten für Monat und Jahr, deren Monat im Mietverhältnis zu „ab Einz“ abgeschnitten
  war. Ein Text, der kein Monat ist („13.2025“), wird nicht verworfen: Das Feld sagt, was nicht
  stimmt (auch bei Mehrdeutigem wie „1.10“, das ein Tag mit Monat sein kann), und die Staffeln melden jede Zeile an ihrem Feld („Kaltmiete, Zeile 2: Geben Sie den Monat
  ein, ab dem der Betrag gilt.“). Die Personenzahl bleibt bewusst ein Datum, denn sie wird tagesgenau
  gerechnet (Befund M11 aus [#341](https://github.com/speedone/mietfuchs/issues/341);
  [#287](https://github.com/speedone/mietfuchs/issues/287),
  [#346](https://github.com/speedone/mietfuchs/issues/346)).

- Begriffserklärungen öffnen jetzt als kleines Fenster über der Seite, statt sich in den Text zu
  schieben: Hinter jedem gestrichelt unterstrichenen Begriff steht ein „?“, das sich am Handy auch mit
  dem Finger gut treffen lässt. Die Erklärung schiebt keine Felder mehr weg, wird in schmalen Spalten und
  neben Häkchen nicht mehr zur schmalen Säule und steht am Handy als Blatt am unteren Rand. Sie zeigt die
  Erklärung und ein Beispiel; Rechtsgrundlage und „Brauche ich das?“ stehen unter „Mehr in ‚Hilfe &
  Begriffe‘ →“, das direkt zum Begriff führt (bei ungespeicherter Eingabe mit Rückfrage). Esc, ein Klick
  daneben oder erneutes Antippen schließen sie; im Seitenfenster schließt Esc nur die Erklärung (Befunde
  M1, MOB3 aus [#341](https://github.com/speedone/mietfuchs/issues/341);
  [#346](https://github.com/speedone/mietfuchs/issues/346)).

- Objekt und Abrechnungsjahr wählen Sie nur noch in der Seitenleiste (am Handy im Menü). Jede Seite
  nennt beides oben über dem Titel, etwa „Lindenweg 12 · Abrechnungsjahr 2025“; die zweite
  Jahresauswahl auf Abrechnung, Kosten, Schnellerfassung, Kostenvergleich und Zähler entfällt. Der
  Belegordner zeigt Objekt und Jahr der Seitenleiste und hat statt eigener Auswahlfelder die Häkchen
  „Belege aller Objekte zeigen“ und „Belege aller Jahre zeigen“. Mietkonto und Steuer behalten ihre
  Auswahl des Kalenderjahres, wenn der Abrechnungszeitraum vom Kalenderjahr abweicht, jetzt mit der
  Beschriftung „Kalenderjahr“; beim Kalenderjahr als Abrechnungszeitraum entfällt sie dort, denn dann ist
  es dasselbe Jahr. Die Auswahl von Objekt und Jahr in der Seitenleiste sieht jetzt gleich aus, mit
  demselben Pfeil, derselben Höhe und Schrift, und zeigt ihren Fokus auch im Kontrastmodus von Windows.
  Der Fuß der Seitenleiste (Design, Hinweis) steht nicht mehr fest über der Navigation: Bei kleiner
  Fensterhöhe verdeckte er „Einstellungen“ und „Hilfe & Begriffe“ (Befunde M13, M15, N1 aus
  [#341](https://github.com/speedone/mietfuchs/issues/341);
  [#346](https://github.com/speedone/mietfuchs/issues/346)).
- Hinweise sind übersichtlicher: Jeder Hinweis der Abrechnung, der Steuerübersicht und der Zähler-Seite
  zeigt seine Stufe als Zeichen und Wort (Fehler, Warnung, Hinweis) und einen fetten Titel. Begründungen,
  die vor allem aus Paragraphen, Urteilen und Drucksachen bestehen, stehen unter „Mehr dazu“ und werden
  immer mitgedruckt; Kürzungen, Beträge, Daten und was zu tun ist bleiben immer sichtbar, ein Fehler
  ganz. Der Wortlaut der Hinweise ist derselbe wie bisher, auch bei abgeschlossenen Abrechnungen. In
  der Steuerübersicht steht die Beschreibung einer Position vorn, Gruppe und Kostenart klein darunter.
  Das Cockpit sagt nach dem Versand „Versendet am …; noch offen: …“ statt „dann ist die Abrechnung
  versandfertig“ und nennt das Ergebnis dann nicht mehr „voraussichtlich“; abgeschlossen, aber noch
  nicht versendet, zeigt es die Frist, die weiterläuft, und ein verspäteter Versand steht als solcher
  da.
  Ohne Daten nennen Cockpit und Abrechnung den ersten fehlenden Schritt mit einem Knopf dorthin
  („Wohnung anlegen“, „Mietverhältnis anlegen“), ohne „Entwurf“ und ohne Frist; „+ Mietverhältnis
  hinzufügen“ sagt, warum es gesperrt ist. Die gedruckte Abrechnung nennt das Objekt nicht mehr
  doppelt („Lindenweg 12 · Lindenweg 12, …“), trägt das Datum (Versand, sonst Tag des Drucks) und die
  Anschrift des Mieters; ist er ausgezogen und fehlt eine Anschrift für den Schriftverkehr, warnt die
  Seite vor dem Druck ([#229](https://github.com/speedone/mietfuchs/issues/229)). „Was heißt das?“
  erscheint nicht mehr im Druck der Steuerübersicht (Befunde M8, M9, M14, N5, N12 aus
  [#341](https://github.com/speedone/mietfuchs/issues/341);
  [#346](https://github.com/speedone/mietfuchs/issues/346)).

- Feste Wörter auf den Knöpfen: Im Seitenfenster heißt der Knopf, der speichert, „Anlegen“, wenn
  etwas neu entsteht, und „Speichern“, wenn Sie etwas ändern; „Übernehmen“, „Hinzufügen“, „OK“ und
  „Umstellen“ gibt es dort nicht mehr. Knöpfe, die ein Fenster öffnen, heißen „+ … anlegen“ („+ Wohnung
  anlegen“, „+ Mietverhältnis anlegen“, „+ Zähler anlegen“, „+ Zahlung anlegen“, „+ Heizanlage
  anlegen“); auf der Seite Kosten gibt es dafür nur noch „+ Kostenposition anlegen“ oben rechts statt
  zwei verschieden beschrifteter Knöpfe. Die gezahlte Vorauszahlung („✎ anpassen“) speichern und
  verwerfen Sie wie jeden anderen Entwurf am Feld mit „Speichern“ und „Verwerfen“. Knöpfe, die etwas
  entfernen oder eine abgeschlossene Abrechnung wieder öffnen („Objekt löschen …“, „Entfernen …“ an der
  Heizanlage und an Lieferungen, „Wieder öffnen …“, „CO₂-Angaben entfernen …“, „Vorrat entfernen …“),
  tragen „…“, wenn eine Rückfrage folgt, werden beim Überfahren rot und stehen mit Abstand zu
  „Speichern“. Jede Rückfrage nennt ihr Verb statt „OK“. Die Anleitungen nennen die neuen Wörter
  (Befunde N3, M19 aus [#341](https://github.com/speedone/mietfuchs/issues/341);
  [#346](https://github.com/speedone/mietfuchs/issues/346)).

- Ablesung, Lieferung, Mieterwechsel und Wechsel des Abrechnungszeitraums öffnen jetzt im Seitenfenster
  wie Wohnung, Zähler oder Kostenposition, statt als Formular in einer Zeile, einer Karte oder am Ende
  der Seite: „+ Ablesung anlegen“ bei den Ablesungen eines Zählers, „+ Lieferung anlegen“ und
  „Ändern“ in der Karte „Lieferungen“, „Mieterwechsel“ am Mietverhältnis und „Abrechnungszeitraum
  ändern“ in der Karte „Abrechnungszeitraum“. Fehlende Angaben stehen am Feld und gesammelt im Fuß über
  „Anlegen“ bzw. „Speichern“, und Schließen mit Eingaben fragt, ob sie verworfen werden sollen. Der
  Mieterwechsel zeigt Auszug, Zwischenablesung und neuen Mieter in einem Fenster statt in drei Schritten
  mit „Weiter“; der Einzug ist der Tag nach dem Auszug, bis Sie ihn ändern. Beim Zeitraumwechsel bleibt
  es bei „Vorschau“ und danach „Speichern“. Gespeichert wird genau wie vorher, mit denselben Angaben
  in derselben Anfrage (Befunde M18, N16, N16a aus [#341](https://github.com/speedone/mietfuchs/issues/341);
  [#346](https://github.com/speedone/mietfuchs/issues/346)).

- Ein Speichern je Karte: Auf der Seite Heizkosten tragen „CO₂: Angaben zum Gebäude“ (Angaben und Fläche
  der Einstufung), „Heizung nach § 43 GModG“ und „Anteil nach Verbrauch“ (vorher „Speichern“ bzw.
  „Pflichtanteil eintragen“ und daneben „Antwort speichern“) ein „Speichern“ am Fuß der Karte, das erst
  erscheint, wenn Sie etwas geändert haben, mit dem Hinweis „Ungespeicherte Änderungen“ und „Verwerfen“.
  Was je Zeile gespeichert wird (die Mitteilung nach § 5d Abs. 4 je Mieter, die Monate der monatlichen
  Verbrauchsinformation, die Warmwassertemperatur, der Grund einer fehlenden Zwischenablesung und in den
  Einstellungen die noch nicht veröffentlichten Rechtswerte), hat sein „Speichern“ direkt am Feld, ebenfalls
  erst nach einer Änderung. Die Karten der Seite Heizkosten haben einen einheitlichen Kopf, ohne die
  wiederholte Heizperiode im Titel (außer beim Ableseergebnis, das sie für den Ausdruck nennt); die Frage „Wie bestimmen Sie den Betriebsstrom?“ zeigt jede Antwort in
  einer eigenen Zeile, und „Nicht möglich“ und „Nicht durchgeführt“ bei einer fehlenden Zwischenablesung
  sehen aus wie Knöpfe (Befunde N8, M18 aus [#341](https://github.com/speedone/mietfuchs/issues/341);
  [#346](https://github.com/speedone/mietfuchs/issues/346)).
- Felder in ihrer eigenen Breite und Neues anlegen immer oben rechts: Ein Betrag, ein Datum, ein Monat (mit
  dem Raster ▦ direkt am Feld), eine Postleitzahl oder ein Zählerstand ist ein kurzes Feld, Adresse, Name und
  Bezeichnung sind lang, und ein Auswahlfeld ist so breit wie sein längster Eintrag; am Handy ist jedes Feld voll
  breit. In der Karte „Objekt“ schneiden Adresse und Kabelanlage nichts mehr ab, der angespannte Wohnungsmarkt
  steht ohne eigenen Kasten, und beim Ändern des Abrechnungszeitraums sind „Was möchten Sie ändern?“ und
  „Neuer Zeitraum beginnt ab Monat“ nicht mehr so breit wie das ganze Fenster. „+ Zähler anlegen“ steht jetzt
  wie „+ Kostenposition anlegen“ oben im Seitenkopf, „+ Wohnung anlegen“, „+ Mietverhältnis anlegen“,
  „+ Heizanlage anlegen“, „+ Lieferung anlegen“ und „+ Ablesung anlegen“ oben rechts in ihrer Karte, und aus
  „Weiteres Objekt anlegen“ neben „Speichern“ wird „+ Weiteres Objekt anlegen“ oben rechts in der Karte
  „Objekt“; im Fuß einer Karte stehen nur „Speichern“ und rechts die Gefahrknöpfe. Damit am Handy nichts
  abgeschnitten ist, heißen einige Einträge kürzer, und was sie bedeuten, steht als Hinweis am Feld: beim
  Bundesland „unbekannt“, bei der Frage, wer abrechnet, „Niemand“, beim Abrechnungszeitraum „Wechsel ab einem
  Monat“ und „Beginnmonat von Anfang an“. Die Suche im Belegordner steht in voller Breite und nennt als Hinweis,
  was sie findet
  ([#346](https://github.com/speedone/mietfuchs/issues/346)).
- Hinweise und Fehlermeldungen auf den Seiten stehen einheitlich im Baustein für Hinweise: mit Zeichen und Stufe
  („⚠ Warnung“, „✖ Fehler“) statt als farbiger Kasten ohne Wort: Ladefehler oben auf den Seiten, Befunde einer
  Vorschau, „Betrag prüfen“ im Belegordner, die Hinweise der KI-Einstellungen und der Auswertung, Abweichungen
  einer abgeschlossenen Abrechnung und die ungültigen IBAN im Cockpit
  ([#346](https://github.com/speedone/mietfuchs/issues/346)).
- Karten mit Überschrift haben überall denselben Kopf wie auf der Seite Heizkosten: Kosten, Mietkonto, Zähler,
  Abrechnung, Kostenvergleich, Belegordner, Einstellungen, Abrechnungszeitraum und CO₂-Erstattung
  ([#346](https://github.com/speedone/mietfuchs/issues/346)).
- CO₂-Erstattung an Mieter, die selbst heizen: Erfassen und Bearbeiten öffnen ein Seitenfenster wie überall sonst,
  mit „+ Erstattung anlegen“ oben rechts in der Karte; wer mit Eingaben schließt, wird gefragt
  ([#346](https://github.com/speedone/mietfuchs/issues/346)).
- Schätzung nach § 9a auf der Seite Heizkosten: „Schätzen“ und „Ändern“ öffnen ein Seitenfenster wie überall sonst,
  statt das Formular in der Karte aufzuklappen; gespeichert wird mit „Anlegen“ bzw. „Speichern“, und wer mit Eingaben
  schließt, wird gefragt (Befund M18 aus [#341](https://github.com/speedone/mietfuchs/issues/341)).

### Behoben

- Monatsraster für Bildschirmleser: Jeder Monat heißt jetzt so, wie er sichtbar dasteht, mit dem vollen
  Monat dahinter („Mär (März 2025)“), statt nur „März 2025“ zum sichtbaren „Mär“. Das verlangt WCAG 2.5.3;
  die Prüfung mit axe meldet es seit Fassung 4.14.
- Eigene Heizkostenabrechnung: Fehlt in einer begonnenen Heizperiode der Anteil nach Verbrauch fürs
  Warmwasser, etwa weil die vorige Heizperiode kein zentrales Warmwasser hatte, lässt er sich jetzt
  nachtragen, auch nach einem Kesseltausch. Bisher verlangte die Karte ihn, zeigte aber kein Feld dafür,
  und die Abrechnung blieb unvollständig.
- Eigene Heizkostenabrechnung: Die Antwort zum Wärmeschutz lässt sich wieder speichern, wenn die
  Heizperiode schon begonnen hat und kein Pflichtanteil gilt. Bisher meldete die Karte, der Anteil fehle, obwohl er in diesem Fall nicht änderbar ist; gespeichert wird jetzt mit dem
  geltenden Anteil, und eine aus der vorigen Heizperiode übernommene Vereinbarung über mehr als 70 % bleibt
  bestehen ([#376](https://github.com/speedone/mietfuchs/issues/376)).
- Wechsel des Abrechnungszeitraums: Wer nach der Vorschau den Monat oder die Art der Änderung noch einmal
  änderte, speicherte mit „Speichern“ (vorher „Zeitraum wechseln“) trotzdem den Wechsel der alten Vorschau,
  etwa ab Mai, obwohl im Feld September stand. Jetzt verfällt die Vorschau samt Antworten und Bestätigung
  mit jeder Änderung, und gespeichert wird erst nach einer neuen Vorschau
  ([#346](https://github.com/speedone/mietfuchs/issues/346)).
- Ein Doppelklick auf „Anlegen“ oder „Speichern“ in einem Seitenfenster (oder Strg+S während des
  Speicherns) legte etwa eine Ablesung oder eine Lieferung zweimal an. Solange gespeichert wird, ist der
  Knopf jetzt gesperrt, und ein zweiter Aufruf entfällt
  ([#346](https://github.com/speedone/mietfuchs/issues/346)).

- Heizkosten, Ablesungen: Fehlt an einer Grenze der Heizperiode ein Stand, nennt die Liste jetzt den
  Zähler mit Zählernummer, etwa „EG links, Beginn der Heizperiode am 31.12.2024: keine Ablesung am
  Zähler „Warmwasser neu“ (Nr. WW-4711)“. Vorher stand dort nur die Wohnung, und bei mehreren Zählern
  blieb offen, welcher gemeint war (Befund M7 aus [#341](https://github.com/speedone/mietfuchs/issues/341)).
- Mietkonto: Der Hinweis zum offenen Dezember erscheint nur noch, wenn allein der Dezember offen
  ist. Vorher stand er auch bei zwölf offenen Monaten oder einem zu niedrigen November. Er nennt
  jetzt den fehlenden Betrag und neben der erst im Januar eingegangenen Dezembermiete die zweite
  häufige Ursache: Das Mietkonto verteilt Zahlungen der Reihe nach ab Januar, ein Fehlbetrag aus
  einem früheren Monat steht deshalb im Dezember (Befund M3 aus
  [#341](https://github.com/speedone/mietfuchs/issues/341)).
- Heizung in den Stammdaten: Nach „Ich selbst“ und „Anlegen“ stand auf der Karte „Abrechnung: Niemand
  …“, auch nach „Später“. Bis zum „Umstellen“ verteilt Mietfuchs die Heizkosten weiter nach den
  Umlageschlüsseln der Kostenpositionen, und genau das sagt die Karte jetzt: „Abrechnung: nach den
  Umlageschlüsseln der Kostenpositionen, ohne eigene Heizkostenabrechnung“. Der Knopf heißt „Eigene
  Heizkostenabrechnung einrichten“, und Einrichtung wie Mitteilung nach „Später“ sagen, dass die
  Abrechnung erst mit „Umstellen“ wechselt (Befund M6 aus [#341](https://github.com/speedone/mietfuchs/issues/341)).
- Cockpit: Die grüne Zeile „Mietverhältnisse & Flächen“ nannte Einheiten wie Garage und Stellplatz nur
  mit „0 m² und 0 Personen: …“. Sie sagt jetzt, warum das in Ordnung ist: Einheiten ohne Wohnfläche und
  ohne Bewohner zählen bei Fläche und Personen nicht mit; verteilt eine Position nach Einheiten, steht
  dabei, welche von ihnen dort je als eine Einheit zählen (Befund N2 aus
  [#341](https://github.com/speedone/mietfuchs/issues/341)).
- Hilfe & Begriffe am Handy: Eine aufgeklappte Anleitung machte die Seite breiter als den Bildschirm
  (gemessen 563 statt 390 Bildpunkte), weil lange Rechtsgrundlagen nicht umbrachen. Unter 640
  Bildpunkten brechen sie jetzt um. Der Browserlauf misst die Breite jeder Seite zusätzlich mit allem
  Aufklappbaren offen (Befund MOB1 aus [#341](https://github.com/speedone/mietfuchs/issues/341)).
- Texte: Die Schnellerfassung spricht von „Mietfuchs“ statt von „dem Tool“, und Schnellerfassung und Kosten
  nennen den Namen des Modells nicht mehr im Seitentext, der steht in den Einstellungen. In der
  Kostentabelle heißt der Lohnanteil „davon §35a-Lohn“ mit Begriffserklärung statt „§35a:“, und der
  Aufklapper zum Rechtsstand der Abrechnung sagt, was darin steht („Angewandte Regeln und
  Rechtswerte · Rechtsstand …“) (Befund N9 aus [#341](https://github.com/speedone/mietfuchs/issues/341)).
- Schreibweisen: Paragrafen stehen einheitlich mit Leerzeichen („§ 556 BGB“, „nach § 35a EStG“), Feldnamen
  wie „§35a-Lohn“ bleiben. Die Verteilbasis nach Verbrauch nennt die Einheit der Zähler („30 von 120 m³
  (gemessen)“), und die Stände eines Zählers stehen mit gleich vielen Nachkommastellen da („316,0“ neben
  „332,7“) (Befund N4 aus [#341](https://github.com/speedone/mietfuchs/issues/341)).
- Stammdaten: Bei einer Pauschale stand in der Spalte „Vorauszahlung je Monat“ nur „—“; jetzt steht dort
  „Pauschale:“ mit dem Betrag (Befund N15 aus [#341](https://github.com/speedone/mietfuchs/issues/341)).
- Mietkonto: In der Zahlungstabelle stehen Datum, Name und Betrag auf einer Linie mit der Auswahl „Art“,
  und der Satz über den Monatskacheln erklärt die Farben (Befund N6 aus
  [#341](https://github.com/speedone/mietfuchs/issues/341)).
- Einstellungen, KI-Belegauswertung: Fehlt das gewählte Modell, stand grün „Der Dienst antwortet, ein Modell
  steht zur Wahl.“ direkt über „… ist nicht installiert“. Jetzt sagt eine Warnung beides in einem Satz („Der
  Dienst antwortet, „qwen3.5:4b“ ist dort aber nicht installiert.“, darin „Modell laden“; bei einem anderen
  Dienst als Ollama im Heimnetz mit der Frage nach dem Namen, außer der Dienst nennt gar keine Modelle).
  „Modell laden“ und „Befehl kopieren“ sind gleich groß, und „Standard-Anbieter“ steht bündig
  über den Feldern (Befund N14 aus [#341](https://github.com/speedone/mietfuchs/issues/341)).
- Hilfe & Begriffe: Die Begriffe sind zugeklappt wie die Anleitungen, und eine Buchstabenleiste springt zum
  ersten Begriff eines Buchstabens (Umlaute beim Grundbuchstaben). Eine Suche klappt die Treffer auf, ein Sprung
  aus einer Begriffserklärung den angesprungenen Begriff. Die Seite ist damit rund 9.700 statt 29.000
  Bildpunkte lang (Befund N10 aus [#341](https://github.com/speedone/mietfuchs/issues/341)).
- Belegordner: Im Posteingang sind „Weiter prüfen“ und „Per KI auswerten“ so hoch wie die Auswahlfelder daneben,
  und „Beleg nachreichen“ springt nicht mehr zur Seite, wenn neben „Aus dem Posteingang …“ die Knöpfe zum
  Speichern erscheinen (Befund N7 aus [#341](https://github.com/speedone/mietfuchs/issues/341)).
- Auswertung prüfen (Schnellerfassung und Kosten): Die Tabelle passt bei 1440 Bildpunkten ohne seitliches
  Scrollen. Je Position stehen zwei Zeilen: oben „Was geschieht?“ über drei Spalten, sodass ein langer Eintrag
  wie „Mit „Gartenpflege Saison“ (1.380,00 €, ohne Beleg) verknüpfen“ ganz zu lesen ist, daneben der Betrag;
  darunter Beschreibung, Kostenart, Umlageschlüssel und der §35a-Lohn (Befund M10 aus
  [#341](https://github.com/speedone/mietfuchs/issues/341)).
- Mietkonto und Steuer bei abweichendem Abrechnungszeitraum: „Kalenderjahr“ ist beschriftet wie die Felder daneben
  und nicht mehr klein und grau wie in der Seitenleiste
  ([#346](https://github.com/speedone/mietfuchs/issues/346)).
- Belegordner nach einem Wechsel des Abrechnungszeitraums: Beginnen Rumpf und neuer Zeitraum im selben Jahr,
  zeigen Register, Belegabdeckung und Belegmappe für Mieter den in der Seitenleiste gewählten Zeitraum. Vorher
  standen die Positionen beider Zeiträume gemischt da, und die Belegmappe nahm immer den Rumpf
  ([#346](https://github.com/speedone/mietfuchs/issues/346)).
- Hinweise: Steht mitten in einem Satz ein Rückverweis wie „deshalb“ oder „daher“, bleibt der Satz mit der
  Begründung davor sichtbar und liegt nicht mehr unter „Mehr dazu“
  ([#346](https://github.com/speedone/mietfuchs/issues/346)).
- „Zeitraum der Heizung ändern“ und die getrennte Heizkostenabrechnung öffnen im Seitenfenster wie der Wechsel des
  Abrechnungszeitraums. „Speichern“ steht im Fuß und ist bis zur Vorschau gesperrt; wer danach noch etwas ändert,
  braucht eine neue Vorschau, statt dass die alte für einen anderen Stand gespeichert wird
  ([#346](https://github.com/speedone/mietfuchs/issues/346)).
- Die Karte „Objekt“ verlangt eine Bezeichnung: Leer ließ sie sich speichern, und die Seitenleiste
  zeigte danach „Ohne Namen“. Hat das Objekt noch keinen Namen, etwa nach einer frischen Installation,
  steht im Feld „Mein Objekt“; Sie können es überschreiben, und mit dem ersten Speichern der Karte wird
  es übernommen (Befund M12 aus [#341](https://github.com/speedone/mietfuchs/issues/341)).
- Angaben zur Heizkostenabrechnung (§ 6a HeizkostenV): Stehen alle Wärmezähler in MWh oder GJ, rechnet
  Mietfuchs den Vergleich mit dem Durchschnittsnutzer jetzt aus. Vorher galt er als offen, und der
  Hinweis nannte eine mögliche Kürzung um bis zu 3 %, obwohl ein Vergleichswert eingetragen war. Der
  Verbrauch steht im Vergleich in kWh, wie der Vergleichswert, ebenso der Vergleich mit dem Vorjahr
  ([#345](https://github.com/speedone/mietfuchs/issues/345)).
- Zähler mit verschiedenen Einheiten werden umgerechnet: Stand ein Wärmezähler in MWh neben solchen
  in kWh oder ein Wasserzähler in Litern neben solchen in m³, zählte Mietfuchs die Werte zusammen,
  als hätten alle dieselbe Einheit. Beim Verbrauchsschlüssel zahlte so ein Mieter mit einem Zähler
  in Litern 998,00 € statt 333,33 € von 1.000 €, in der eigenen Heizkostenabrechnung ein Mieter mit
  einem Zähler in MWh 932,38 € statt 2.358,00 € Gas. Jetzt rechnet Mietfuchs Wärme in kWh, MWh und
  GJ, Wasser in m³ und Litern und Strom in kWh und MWh ineinander um, auch beim Hauptzähler. Was
  sich bei welchem Bestand ändert:
  - Stehen alle Zähler, nach denen gemeinsam verteilt wird, in derselben Einheit, ändert sich keine
    Zahl, auch nicht bei einheitlich MWh oder Litern; eine Schätzung nach § 9a bleibt in ihrer Zahl,
    und die Heizkostenabrechnung nennt den Verbrauch in der Einheit der Zähler.
  - Gemischt bekannte Einheiten (MWh neben kWh, Liter neben m³) werden jetzt richtig umgerechnet, und
    die Beträge ändern sich. Ist eine solche Abrechnung schon abgeschlossen, zeigt Mietfuchs die
    Abweichung; zugestellt bleibt, was zugestellt wurde.
  - Der Warmwasseranteil aus einem Wärmezähler am Speicher in MWh oder GJ war bisher um das
    Tausendfache zu klein (etwa 0,015 % statt 15 %); er wird jetzt richtig berechnet, und die Heizkosten
    verschieben sich zwischen Heizung und Warmwasser. Ebenso rechnen der Vorschlag des
    Warmwasservolumens und die monatliche Verbrauchsinformation Liter in m³ und MWh in kWh um.
  - Steht neben anderen eine Einheit, die Mietfuchs für die Sparte nicht kennt, etwa „m³“ an einem
    Wärmezähler (die frühere Vorgabe für jede Sparte), rechnet Mietfuchs wie bisher, als zeigten alle
    dieselbe Einheit, und warnt. Die Warnung nennt die Zähler mit ihrer Einheit und führt zur Seite
    Zähler: Wählen Sie dort für jeden Zähler die Einheit, die er wirklich zeigt.
  - Gas über „Sonstiges“: Schreibweisen wie „m³“, „cbm“ und „Kubikmeter“ gelten als dieselbe Einheit.
    Stehen Gaszähler in m³ neben solchen in kWh, verteilt Mietfuchs nach ihnen nicht, denn das sind
    verschiedene Größen; der Betrag steht beim Vermieter, bis die Einheiten stimmen.
  - Zähler, die im Abrechnungszeitraum nichts messen (stillgelegt oder ohne Ablesung), zählen für die
    Einheit nicht mit.

  Auf der Seite Zähler ist die Einheit bei Wärme, Wasser und Strom eine Auswahl. Ein Zähler ohne
  gespeicherte Einheit bekommt dort keine Vorgabe, sondern „Bitte wählen“, und wechselt die Sparte
  auf eine, die die Einheit nicht kennt, sagt das ein Hinweis am Feld; gespeichert wird nur eine
  gewählte Einheit ([#342](https://github.com/speedone/mietfuchs/issues/342)).
- Steuerübersicht bei teilweiser Eigennutzung, wenn der Betriebsstrom der Heizung aus der
  Stromrechnung des Hauses herausgerechnet ist: Der Abzug beim Allgemeinstrom stand bisher im Jahr
  der Heizposition, die Stromrechnung im Jahr ihrer Zahlung. Lagen beide Jahre auseinander, etwa bei
  einem Abrechnungszeitraum von Mai bis April oder einer eigenen Heizperiode, blieb in einem Jahr ein
  privater Rest von einigen Euro übrig, auch in einem Jahr ohne Zahlung, und im anderen fehlte er.
  Jetzt steht der Abzug immer im Jahr, in dem die Stromrechnung bezahlt ist, und sein privater Teil
  richtet sich nach dem Heizanteil des Zeitraums, in dem der Betriebsstrom bei den Heizkosten steht,
  auch wenn das ein anderes Jahr ist. Steht der Betriebsstrom in einer eigenen Heizperiode, kann
  sich der private Teil deshalb auch innerhalb desselben Steuerjahres ändern. Die Summe beider Jahre
  bleibt gleich, im Betrag wie im privaten Teil. Ein Jahr der Zahlung am Abzug gibt es nicht mehr, ein früher gespeichertes zählt
  nicht und wird beim nächsten Speichern geleert. Dadurch lässt sich auch ein Wechsel des
  Abrechnungszeitraums speichern, den Mietfuchs bisher ablehnte, weil kein Jahr zu Betriebsstrom und
  Abzug zugleich passte. Die Abrechnung an die Mieter ändert sich nicht
  ([#267](https://github.com/speedone/mietfuchs/issues/267)).
- Rückfragen: Enter wählt den Knopf mit dem Fokus und bestätigt nicht mehr immer; vor dem Löschen
  steht der Fokus auf „Abbrechen“, Tab bleibt im Dialog, und danach steht der Fokus wieder auf dem
  Knopf, der die Rückfrage geöffnet hat ([#341](https://github.com/speedone/mietfuchs/issues/341)).
- Zähler: Eine Meldung zu „Ablesung speichern“ steht jetzt am Feld und in einer Sammelmeldung beim
  Knopf statt oben auf der Seite, wo sie beim Klick nicht zu sehen war; der Fokus geht auf die
  Sammelmeldung, und ihr Link führt zum betroffenen Feld ([#341](https://github.com/speedone/mietfuchs/issues/341)).
- Abrechnung: Ein ungültiger Betrag bei „✎ anpassen“ wird nicht mehr stumm verworfen, sondern am
  Feld gemeldet ([#341](https://github.com/speedone/mietfuchs/issues/341)).
- Ableseergebnis für den Mieter: Es nennt die Einheit des Zählers und seine Nachkommastellen, ein
  Wärmezähler in MWh steht dort also nicht mehr als gerundete kWh ([#341](https://github.com/speedone/mietfuchs/issues/341)).
- Abrechnung: Enthält eine offene Abrechnung Fehler, fragt Mietfuchs vor dem Drucken nach, und schon
  die erste Rückfrage zum Abschließen nennt sie, je mit „Hier beheben →“. Solange Fehler offen sind,
  trägt der Ausdruck einer offenen Abrechnung den Vermerk „Entwurf, nicht versenden“, auch beim Druck
  über das Browsermenü ([#341](https://github.com/speedone/mietfuchs/issues/341)).
- „Angespannter Wohnungsmarkt“ am Objekt erklärt jetzt sich selbst und nicht die hälftige Teilung
  der CO₂-Kosten ([#341](https://github.com/speedone/mietfuchs/issues/341)).
- Bedienung mit Tastatur und Vorleser: Das Dateifeld der Ablagefläche auf „Kosten“ und in der
  Schnellerfassung hat einen Namen, Links mitten im Text sind unterstrichen, und eine Tabelle oder ein
  Befehl, die am Handy seitlich rollen, sind mit der Tastatur erreichbar
  ([#340](https://github.com/speedone/mietfuchs/issues/340)).

## [0.11.3] – 2026-10-17

### Geändert

- **Abschließen einer Abrechnung mit Fehlern nur nach Rückfrage**
  ([#319](https://github.com/speedone/mietfuchs/issues/319)). Meldet die Abrechnung oder die
  Heizkostenabrechnung einen Fehler (etwa sich überschneidende Mietverhältnisse oder vereinbarte
  Anteile über 100 %), nennt der Dialog beim Abschließen jeden Fehler mit „Hier beheben →“ und
  schließt erst mit „Trotzdem abschließen“ ab. Fehlt zugleich eine Rechnung des Versorgers, steht
  beides in einem Dialog. Ändert sich zwischen Rückfrage und Bestätigung etwas an den Fehlern, oder
  entsteht einer erst mit der Schätzung, fragt Mietfuchs erneut. Warnungen und Hinweise fragen nicht nach. Die Prüfung macht der Server,
  ein Fenster von vor dem Update schließt deshalb nicht mehr still ab, sondern meldet die Fehler.

### Behoben

- **Vorauszahlung und Miete im Einzugs- und Auszugsmonat** ([#311](https://github.com/speedone/mietfuchs/issues/311)):
  Beginnt oder endet ein Mietverhältnis im Lauf eines Monats, setzt Mietfuchs Vorauszahlung,
  Heizvorauszahlung, Kaltmiete und Pauschale dieses Monats jetzt anteilig nach Kalendertagen an,
  in der Abrechnung wie im Mietkonto. Vorher zählte ein Monat nur, wenn das Mietverhältnis am
  Monatsersten bestand: Bei 150 € Vorauszahlung und Einzug am 15.03. fehlten dem Mieter 82,26 €,
  bei Auszug am 15.06. wurden ihm 75,00 € zu viel gutgeschrieben. Das Mietkonto führte im
  Einzugsmonat kein Soll und im Auszugsmonat das volle, und die Abrechnung meldete dann einen
  Rückstand, den es nicht gab. Anteilig nach Kalendertagen ist eine Auslegung von Mietfuchs; ein
  neuer Hinweis „Vorauszahlung im angebrochenen Monat“ nennt den angesetzten Betrag, und die
  Abrechnung nennt ihn dem Mieter. Was ändert sich an bestehenden Daten: Offene Abrechnungen mit
  Ein- oder Auszug außerhalb des Monatsersten bzw. -letzten ändern sich; prüfen Sie sie. Abgeschlossene
  Abrechnungen bleiben, wie sie versendet wurden; die Abweichung zeigt Mietfuchs je Mieter an.
  Hat der Mieter im angebrochenen Monat anders gezahlt, tragen Sie die gezahlte Summe in der
  Abrechnung bei „abzüglich geleisteter Vorauszahlungen“ mit „✎ anpassen“ ein.
- Erklärungen zur Vorauszahlung berichtigt ([#313](https://github.com/speedone/mietfuchs/issues/313)):
  Die Steuerübersicht schrieb, die Abrechnung stelle die tatsächlich geleisteten Vorauszahlungen
  ein; sie setzt die vereinbarten an, oder den mit „✎ anpassen“ erfassten Betrag. Lexikon und
  Anleitung „Mieterwechsel und Leerstand im Jahr“ nennen jetzt, dass gegen das tatsächlich
  Gezahlte abgerechnet wird.

## [0.11.2] – 2026-10-17

### Geändert

- **Große Backups brauchen deutlich weniger Arbeitsspeicher.** Backup und „Belege für die
  Steuer“ werden jetzt beim Herunterladen Stück für Stück erzeugt, statt erst ganz im Speicher zu
  entstehen, und beim Wiederherstellen werden die Belege direkt auf die Platte ausgepackt. Ein
  Backup mit 400 MB Belegen brauchte vorher rund 1,4 GB Arbeitsspeicher, jetzt rund 0,3 GB. Wiederherstellen lässt
  sich jetzt ein Backup bis 20 GB (vorher 500 MB), sofern so viel Platz frei ist. Backups aus
  älteren Versionen lassen sich unverändert einspielen, und ein neues Backup lässt sich auch in
  einer älteren Version einspielen.

### Behoben

- Steuerübersicht bei einem Zeitraum über zwei Kalenderjahre (Abrechnungszeitraum wie Mai bis April,
  ebenso eine eigene Heizperiode in der Abrechnung oder als eigene Heizkostenabrechnung): Drei
  Hinweise standen im falschen Jahr. Der Hinweis zum Brennstoff aus dem Vorrat zählte den Übertrag
  in zwei Steuerjahren, bei einer eigenen Heizkostenabrechnung ohne Lieferung gar nicht, und nannte
  so einen falschen Abstand zum Eigenanteil der Abrechnung, auch in Jahren ohne Heizrechnung. Jetzt
  steht der Übertrag im Jahr, in dem der Brennstoff seiner Abrechnung bezahlt ist, bei Zahlungen in
  zwei Jahren anteilig; ohne Brennstoffrechnung im Jahr, in dem der Zeitraum beginnt. Bei einem
  Kalenderobjekt mit eigener Heizperiode steht er damit im Jahr der Zahlung statt im Jahr der
  Abrechnung. „Eigennutzung im Jahr geändert“ erschien auch für ein Jahr, in dem die selbstgenutzte
  Einheit gar nicht vermietet war, und der Hinweis auf eine abweichende abgeschlossene Abrechnung
  auch im Jahr ohne ihre Positionen. Die Werbungskosten, ihr privater und ihr abziehbarer Teil
  waren nicht betroffen.
- **Ein manipuliertes Backup wird abgelehnt, bevor es ausgepackt wird.** Ein Archiv, das winzig
  ist und ausgepackt riesig würde, eines mit Zehntausenden Einträgen, eines mit einem Namen, der
  aus dem Datenordner hinausführt, und eines, dessen Inhalt nicht zu seinen Angaben passt, wird
  jetzt abgelehnt, ohne dass etwas ersetzt ist. Vorher kam etwa ein Archiv von unter 1 MB durch,
  das sich auf 900 MB auspackte, und belegte dabei 2 GB Arbeitsspeicher. Reicht der Platz auf
  dem Datenträger nicht, sagt Mietfuchs das vorher, und Reste eines abgebrochenen
  Wiederherstellens räumt der nächste Start weg.

## [0.11.1] – 2026-10-17

### Behoben

- **Monatsfelder lassen sich jetzt auch in Safari und Firefox bedienen.** Die Felder „gültig ab“
  der Staffeln für Kaltmiete, Vorauszahlung, Pauschale und Heizvorauszahlung waren eine
  Monatsauswahl, die Safari auf dem Mac und Firefox nicht kennen: Je nach Fassung ließ sich dort
  gar nichts eingeben, oder nur „2026-01“ kam durch, und „01.2026“ oder „01.01.2026“ endete in der
  Meldung „Bitte Kaltmiete-Staffel prüfen“. Dasselbe galt für „Neuer Zeitraum beginnt ab“ beim
  Wechsel des Abrechnungszeitraums und für die Monatsfelder der Heizung. Monat und Jahr werden
  jetzt in jedem Browser aus zwei Listen gewählt, Tippfehler gibt es keine mehr; ist nur eines
  gewählt, sagt die Meldung, was fehlt. Die Jahre reichen bis zehn Jahre voraus, sodass sich auch
  eine Staffelmiete eintragen lässt. Dabei behoben: Eine weitere Zeile einer Staffel ohne Monat,
  etwa eine Mieterhöhung, deren Monat stehen blieb, galt still „ab Einzug“ und damit rückwirkend
  für die ganze Mietzeit. „Ab Einzug“ gibt es jetzt nur noch in der ersten Zeile; in jeder
  weiteren fragt Mietfuchs nach dem Monat, und zwei Zeilen zum selben Monat werden nicht mehr
  still zusammengelegt.
  ([#287](https://github.com/speedone/mietfuchs/issues/287))
- Kontoauszüge lesen: Ein ZIP-Archiv wird geprüft, bevor etwas entpackt wird (höchstens 3.000
  Einträge samt Ordnern, 8 Ordnerebenen und 20 MB entpackt, eine Datei höchstens 10 MB), und überlange Textfelder werden
  gekürzt; eine IBAN wird nie gekürzt, eine überlange gilt als fehlend. Ein Archiv mit Kommentar
  oder einem zweiten Verzeichnisende wird abgelehnt, denn darüber ließ sich der Prüfung ein
  anderer Inhalt zeigen als beim Entpacken. Wird eine Grenze überschritten, sagt die Meldung, wie
  Sie die Auszüge aufteilen ([#188](https://github.com/speedone/mietfuchs/issues/188)).

## [0.11.0] – 2026-10-17

### Neu

- Abrechnungszeitraum wählbar: In den Stammdaten stellen Sie unter „Abrechnungszeitraum“ ein, ob ein
  Objekt im Kalenderjahr oder etwa von Mai bis April abrechnet. Ein Wechsel zeigt vorher, was
  geschieht: den Rumpfzeitraum davor, welche Rechnungen nach Tagen aufgeteilt werden, und er fragt
  die tatsächlich gezahlten Vorauszahlungen neu ab, wo eine Jahreskorrektur nicht mehr passt.
  Abgeschlossene Abrechnungen bleiben unangetastet. Vorgabe ist der Wechsel ab dem laufenden Monat;
  „von Anfang an“ sagt, dass es auch frühere Abrechnungen ändert. Rechnungen ohne Leistungszeitraum
  teilt der Wechsel nach Tagen auf die neuen Zeiträume auf, statt eine Jahresrechnung ganz in den
  Rumpf zu legen; vorbelegt ist das nur, wenn keine Belegzeile darauf gebucht ist und sich das Jahr
  der Zahlung nicht verschiebt, sonst nennt die Vorschau die Verschiebung in Euro und fragt. Heizkosten
  teilt er nicht, dort warnen Vorschau und Abrechnung mit Betrag. Die Vorschau nennt für jede schon
  begonnene Abrechnung Frist und Ergebnis je Mieter vorher und nachher; ist die Frist eines Rumpfs
  schon abgelaufen, steht das rot da, mit der Nachzahlung, die nicht mehr verlangt werden darf, und
  gespeichert wird erst nach Bestätigung, die auch der Server verlangt. Ein Teil einer nach Tagen
  geteilten Rechnung lässt sich in der Belegbuchung nicht mit weiteren Zeilen verknüpfen. Eine Seite,
  die vor dem Update geöffnet wurde, bekommt beim Wechsel mit Heizkosten eine Meldung über fehlende
  Angaben; neu laden genügt. Rechnungen tragen auf Wunsch ihren
  Leistungszeitraum; kalte Betriebskosten über zwei Abrechnungszeiträume teilt Mietfuchs beim
  Speichern nach Tagen auf, Heizkosten nicht. Reicht ein Zeitraum über zwei Kalenderjahre, fragt das
  Formular nach dem Jahr der Zahlung (vorbelegt nur mit dem Rechnungsdatum eines Belegs; bei
  Heizkosten mit dem Hinweis, was für Abschläge über zwei Jahre gilt), und die Steuerübersicht bleibt
  beim Kalenderjahr. Im
  Rumpfzeitraum gibt es einen Vorschlag für die neue Vorauszahlung, Brennstoff nach
  Gradtagen. Wer im Kalenderjahr abrechnet, merkt davon nichts
  ([#208](https://github.com/speedone/mietfuchs/issues/208)).
- **Heizanlage in den Stammdaten.** Unter „Heizung“ geben Sie an, womit geheizt wird, wer die
  Heizkostenabrechnung erstellt (ein Messdienst, bei einer Eigentumswohnung die Gemeinschaft, oder
  niemand), welche Wohnungen angeschlossen sind und ob die Zähler und Heizkostenverteiler aus der
  Ferne ablesbar sind. Vorhandene Heizpositionen offener Zeiträume kommen beim Einrichten zur
  Anlage, neue von selbst. An keinem Betrag ändert sich dadurch etwas; stehen an Zählern schon
  Angaben zur Fernablesbarkeit, können Hinweise dazukommen
  ([#99](https://github.com/speedone/mietfuchs/issues/99)).
- **Fernablesbarkeit nach Einbaudatum, beziffert.** Zähler kennen jetzt die Sparten Warmwasser und
  Heizkostenverteiler, dazu „aus der Ferne ablesbar“ und das Einbaudatum; beim Messdienst genügt die
  Angabe an der Heizanlage. Ist ein Gerät nicht fernablesbar, obwohl es das sein muss (nach dem
  01.12.2021 eingebaut: ab dem Einbau, ältere ab 2027), nennt die Abrechnung die Kürzung von 3 %
  der Heizkosten je Mieter; ist das nur möglich, etwa weil ein einzelnes Gerät in einem sonst nicht
  fernablesbaren System ersetzt wurde (§ 5 Abs. 2 Satz 4 HeizkostenV), sagt sie „bis zu“. Ob die
  Geräte einzeln ersetzt oder als Ganzes neu eingebaut wurden, fragt die Heizanlage, wenn es darauf
  ankommt. Ohne Angaben bleibt es beim
  bisherigen Hinweis ([#214](https://github.com/speedone/mietfuchs/issues/214)).
- **Zweifamilienhaus als Art des Objekts**, mit einem Hinweis, wenn die angelegten Wohnungen nicht
  dazu passen; ob die Ausnahme des § 2 HeizkostenV gilt, richtet sich weiter nach den Wohnungen
  ([#180](https://github.com/speedone/mietfuchs/issues/180)).
- **Eigene Heizperiode.** Rechnet Ihr Messdienst die Heizkosten etwa von Mai bis April ab, stellen
  Sie unter Stammdaten → Heizung den Zeitraum der Heizung ein, mit Vorschau. Die Heizkosten einer
  Heizperiode stehen dann in der Betriebskostenabrechnung des Jahres, in dem sie endet; vorhandene
  Heizpositionen kommen dorthin. Die Einrichtung erklärt dazu die drei Wege (Heizperiode des
  Messdienstes in der Abrechnung des Kalenderjahres, das ganze Objekt auf den Zeitraum des
  Messdienstes umstellen, den Messdienst auf den 31.12. umstellen lassen) mit Vor- und Nachteilen
  und schlägt bei einer gemeinsamen Vorauszahlung den ersten vor. Wer in diesem Jahr nicht mehr im Haus wohnte, bekommt eine
  Abrechnung nur mit seinen Heizkosten; Mietfuchs empfiehlt dafür die frühere Frist und sagt, bis
  wann die Abrechnung des Messdienstes anzufordern ist
  ([#217](https://github.com/speedone/mietfuchs/issues/217)).
- **Getrennte Heizkostenabrechnung.** Werden die Heizkosten mit eigener Vorauszahlung getrennt
  abgerechnet, bekommt jede Heizperiode ihre eigene Heizkostenabrechnung mit eigener Frist und
  eigenem Abschluss. Beim Einschalten teilt eine Vorschau die bisherige Vorauszahlung in
  Heizvorauszahlung und übrige Vorauszahlung, erfasst Jahreskorrekturen neu und nennt die Fristen;
  ausgeschaltet wird erst ab der ersten Heizperiode, die nicht abgeschlossen ist. Wer bei der Frage
  nach dem Zeitraum der Heizung „getrennt“ antwortet, kommt gleich zur Aufteilung; ändert das
  Aufteilen oder ein Wechsel der Heizperiode schon begonnene Abrechnungen, nennt die Vorschau Frist und
  Ergebnis vorher und nachher, und bei abgelaufener Frist wird erst nach Bestätigung gespeichert.
  Ein Mietverhältnis, das in einem älteren Stand geöffnet war, überschreibt die aufgeteilten
  Vorauszahlungen nicht mehr: Mietfuchs lädt nach jeder Änderung an der Heizung neu und lehnt das
  Speichern eines veralteten Formulars ab, statt die Heizvorauszahlung still zu löschen. Die
  Heizkostenabrechnung spricht von Heizkosten und Heizkostenvorauszahlung, die
  Betriebskostenabrechnung daneben von der Vorauszahlung für die übrigen Nebenkosten. Jeder Monat der
  Vorauszahlung wird genau einmal angerechnet. Am Mietverhältnis steht die Heizvorauszahlung in einer
  eigenen Gruppe, die nennt, welche Heizung sie verlangt; das Lexikon erklärt den Begriff. Mietkonto und Mietverhältnis zeigen beide
  Vorauszahlungen, das Cockpit jede Heizkostenabrechnung mit ihrer Frist
  ([#217](https://github.com/speedone/mietfuchs/issues/217)).

- **CO₂-Kosten beim Messdienst und bei der Eigentümergemeinschaft.** Auf der neuen Seite
  „Heizkosten“ (sichtbar ab einer Heizanlage) tragen Sie die CO₂-Angaben der Heizkostenabrechnung
  ein: ob es eine Zeile „Abzüglich CO₂-Kosten Vermieter“ gibt, die Summe der Kosten aller Nutzer und
  die Zahlen der CO₂-Seite. Eine Probe zeigt, ob der Betrag Ihrer Position dazu passt. Beim
  Vorwegabzug steht der CO₂-Anteil des Vermieters als eigener Grund beim Vermieter und in der
  Steuerübersicht als Werbungskosten, der Teil Ihrer eigenen Wohnung im Eigenanteil; weist der
  Messdienst die CO₂-Kosten nur aus, bekommt jeder Mieter eine eigene Abzugszeile. Die Abrechnung
  druckt die Einstufung und die Grundlagen mit (§ 7 Abs. 3 CO2KostAufG); fehlen der CO₂-Ausstoß
  insgesamt oder die Wohnfläche, sagt die Abrechnung, dass Mieter kürzen dürfen. Das Kostenformular
  nennt, welcher Betrag der Messdienstabrechnung gemeint ist, und die Probe rechnet in Worten vor
  ([#97](https://github.com/speedone/mietfuchs/issues/97), [#209](https://github.com/speedone/mietfuchs/issues/209)).
- **Warmwasser laut Messdienst.** Hat der Messdienst die Wärme für das Warmwasser mit einer Formel
  bestimmt, ohne dass deren Voraussetzung vorliegt (§ 9 Abs. 2 Satz 2 bzw. 4 HeizkostenV), nennt die
  Abrechnung die Kürzung von 15 % je Mieter auf seine Heiz- und Warmwasserkosten (§ 9 Abs. 2 Satz 1,
  § 12 Abs. 1 Satz 1 HeizkostenV; BGH, Urteil vom 12.01.2022, VIII ZR 151/20)
  ([#211](https://github.com/speedone/mietfuchs/issues/211)).
- Anleitung „CO₂-Kosten der Heizung aufteilen“ und Lexikon-Einträge zur CO₂-Aufteilung, Einstufung,
  Fläche, Abzugszeile und zum Warmwasseranteil.
- **Rechnungen des Versorgers als Lieferungen.** Auf der Seite „Heizkosten“ tragen Sie Gas-,
  Fernwärme- und Stromrechnungen mit ihrem Rechnungszeitraum ein. Reicht eine Rechnung über die
  Heizperiode hinaus, teilt Mietfuchs sie auf: nach einem eingetragenen Anteil, einem Zählerstand
  zum Stichtag, einer Zwischenrechnung, Teilmengen der Rechnung, den Gradtagzahlen Ihres Orts oder
  der Gradtagszahlentabelle; feste Preisbestandteile nach Tagen. Bei freien Schlüsseln verknüpfen
  Sie die Positionen mit ihrer Rechnung; der Teil einer anderen Heizperiode steht dann als eigene
  Zeile bei den Mietern und als Gegenbuchung bei Ihnen, und jede Rechnung ist über die Jahre genau
  einmal verteilt. Heizkosten gehören in die Heizperiode, in der der Brennstoff verbraucht wurde
  (BGH VIII ZR 156/11) ([#97](https://github.com/speedone/mietfuchs/issues/97)).
- **Rückfrage beim Abschließen, wenn eine Rechnung fehlt.** Fehlt für einen Teil der Heizperiode
  noch eine Rechnung, fragt Mietfuchs nach: abwarten (die Vorgabe, mit dem Ende der Frist), mit
  Vorbehalt schätzen oder ohne Schätzung abschließen. Eine Schätzung nennt ihre Grundlage; ob eine
  noch fehlende Versorgerrechnung geschätzt werden darf, ist höchstrichterlich nicht entschieden.
  Kommt die Rechnung später, nennt die Abrechnung die Differenz, vor und nach Ablauf der Frist mit
  dem, was Sie tun können (§ 556 Abs. 3 Satz 3 BGB); bei zu hoher Schätzung die Gutschrift je Mieter
  ([#97](https://github.com/speedone/mietfuchs/issues/97)).
- Anleitung „Gasrechnung über die Heizperiode hinaus“ und Lexikon-Einträge zu Lieferung, festem
  Preisbestandteil, Schätzung mit Vorbehalt, Nichtwohngebäude, Beschränkungen und Fernwärme aus dem
  Emissionshandel.
- **CO₂-Kosten selbst aufteilen.** Mit den Lieferungen teilt Mietfuchs die CO₂-Kosten bei freien
  Schlüsseln selbst auf, und auch dann, wenn der Messdienst nicht aufgeteilt hat: Einstufung nach
  dem auf die Heizperiode umgerechneten Ausstoß, § 8 (Nichtwohngebäude) und § 9 (Beschränkungen)
  CO2KostAufG, der Abzug je Mieter nach seinem Anteil am Brennstoff; Wärme aus dem Emissionshandel
  bei einem ersten Anschluss nach dem 01.01.2023 ohne Aufteilung (§ 2 Abs. 4 Satz 2 CO2KostAufG). Die
  Abrechnung druckt die Grundlagen und den Block „Brennstoff“ mit
  ([#97](https://github.com/speedone/mietfuchs/issues/97)).
- **Brennstoffvorrat bei Heizöl, Flüssiggas, Pellets, Holz und Kohle.** Auf der Seite „Heizkosten“
  tragen Sie Lieferungen mit Lieferdatum und Menge ein und je Heizperiode in der Karte „Vorrat“ den
  Endbestand, den Anfangsbestand nur in der ersten Heizperiode; danach ist er der Endbestand der
  Vorperiode. Mietfuchs rechnet daraus den verbrauchten Brennstoff (Anfangsbestand + Lieferungen −
  Endbestand) und bewertet den Endbestand wie die Messdienste zu den Preisen der jüngsten Lieferungen.
  Verteilen Sie die Heizkosten selbst nach Schlüsseln, tragen die Mieter den Verbrauch, mit den Zeilen
  „aus dem Vorrat“ und „im Vorrat“ (§ 7 Abs. 2 HeizkostenV, BGH VIII ZR 156/11); hat der Messdienst die
  CO₂-Kosten nicht aufgeteilt, teilt Mietfuchs sie nach dem verbrauchten Brennstoff auf. Brennstoff
  mit Rechnung vor dem 01.01.2023 zählt für die Einstufung, trägt aber keine CO₂-Kosten (§ 11 Abs. 2
  Satz 2 CO2KostAufG). Die Abrechnung druckt die Bestandsrechnung mit
  ([#97](https://github.com/speedone/mietfuchs/issues/97),
  [#99](https://github.com/speedone/mietfuchs/issues/99)).
- Lexikon-Eintrag „Brennstoffvorrat“.
- **Mehrere Heizanlagen in einem Objekt.** In den Stammdaten legen Sie mit „+ weitere Heizanlage“ eine
  zweite Anlage an, etwa für ein zweites Haus, das mit dem ersten abrechnet. Jede Anlage hat einen Namen
  und ihre Wohnungen; die bisherige bekommt beides im selben Schritt. Jede Anlage wird für die
  CO₂-Aufteilung für sich eingestuft, außer sie steht nach Ihrer Angabe im selben Gebäude wie eine
  andere: Dann werden beide gemeinsam eingestuft, über den Ausstoß aller Anlagen und die Fläche aller
  versorgten Wohnungen, eine eingetragene Fläche je Anlage eingerechnet (§ 5 Abs. 1 Satz 1 und 2
  CO2KostAufG; eine Auslegung, höchstrichterlich nicht geklärt). Die erste Anlage wird nicht nach dem
  Gebäude gefragt; entfernen Sie eine Anlage, auf die andere verweisen, bleiben diese im selben Gebäude. Verteilt eine Heizposition über Wohnungen beider Anlagen, sagt die
  Abrechnung das als Fehler an der Position, mit der Kürzung um 3 % und dem Handgriff; verteilt wird sie
  weiter wie bisher. Auf den Seiten Kosten und Zähler wählen Sie ab zwei Heizanlagen die Anlage; die Wahl
  beteiligt an der Position die Wohnungen der Anlage
  ([#97](https://github.com/speedone/mietfuchs/issues/97)).
- **Etagenheizungen, deren Vertrag Sie haben.** Unter „Jede Wohnung hat eine eigene Heizung“ mit „Ich
  habe den Vertrag“ legt Mietfuchs eine Etagenheizung an. Die Rechnung jeder Wohnung ordnen Sie dieser
  Wohnung direkt zu und tragen sie auf der Seite Heizkosten mit ihrer Wohnung ein. Die CO₂-Einstufung
  rechnet über die vermieteten Wohnungen mit eigener Heizung und deren Gesamtwohnfläche (§ 5 Abs. 1
  Satz 2 CO2KostAufG); jeder Mieter bekommt den Anteil des Vermieters an den CO₂-Kosten seiner Wohnung
  nach seinem Anteil an deren Heizkosten, ein Leerstand bleibt beim Vermieter. Jede Wohnung braucht
  dafür einen eigenen Gaszähler. Für Etagenheizungen gilt die Heizkostenverordnung nicht, und ob Sie die
  Gaskosten umlegen dürfen, ist nicht geklärt; die Abrechnung sagt das
  ([#97](https://github.com/speedone/mietfuchs/issues/97)).
- **Heizung erneuert (Kessel getauscht).** Wird die Heizung erneuert, etwa Öl gegen Gas, wählen Sie bei der
  Heizanlage „Heizung erneuert (Kessel getauscht)“: Die bisherige Anlage endet am Tag vor dem Tausch, eine
  neue beginnt mit denselben Wohnungen; auch ein zweiter Tausch geht, und das Entfernen der neuen Anlage
  macht den Tausch rückgängig; entfernen Sie eine Anlage aus der Mitte, übernimmt die nächste ihren
  Zeitraum. Bleibt der Brennstoff im Tank derselbe, fragt Mietfuchs „Verheizt der neue Kessel den
  Brennstoff im Tank weiter?“: Mit Ja wird der Restbestand ihr Anfangsbestand, auch wenn die neue Anlage im
  Jahr des Tauschs noch keine eigene Rechnung hat; mit Nein und bei anderem Brennstoff tragen ihn die Mieter
  nicht, denn sie tragen nur den verbrauchten Brennstoff, und er steht mit seinem Wert bei Ihrem Anteil.
  Eine Rechnung der alten Anlage, die Sie erst im Folgejahr buchen, rechnet Mietfuchs dem Zeitraum der
  Lieferung zu. Bleibt Gas über denselben Zähler, braucht es
  keinen Tausch. Eingestuft wird
  das Gebäude im Jahr des Tauschs über den Ausstoß beider Anlagen (§ 5 Abs. 1 Satz 1 CO2KostAufG). Die
  Steuerübersicht nimmt die Rechnungen wie bisher voll. Neue Anleitung „Heizung erneuert, zweite
  Heizanlage oder Etagenheizung“ und Lexikon-Einträge „Etagenheizung“ und „Heizung erneuert
  (Kesseltausch) und Restbestand“ ([#97](https://github.com/speedone/mietfuchs/issues/97)).

- **Heizkosten selbst abrechnen.** Wer Wärme- und Warmwasserzähler jeder Wohnung selbst abliest, wählt in
  den Stammdaten bei der Heizung „Ich selbst, mit Zählern oder Heizkostenverteilern“. Mietfuchs verteilt
  dann nach der Heizkostenverordnung: Grund- und Verbrauchskosten je Topf, den Warmwasseranteil aus der
  gemessenen Wärme am Speicher, beim Mieterwechsel den abgelesenen Verbrauch und die Grundkosten nach
  Gradtagen; Leerstand, Eigennutzung und Pauschale als eigene Nutzer. Die Abrechnung druckt die Preise je
  m², kWh und m³. Fehlt eine Zwischenablesung, sagt die Abrechnung, um wie viel die Mieter kürzen dürfen.
  Die Seite Heizkosten zeigt die Ablesungen als Ampel und druckt das Ableseergebnis je Wohnung
  ([#99](https://github.com/speedone/mietfuchs/issues/99)). Die eigene Abrechnung gilt ab der Heizperiode,
  für die Sie sie einrichten; frühere bleiben bei ihrem Schlüssel. Nach einem Kesseltausch gilt der Anteil
  nach Verbrauch weiter, und der Tausch fragt den Stand des Wärmezählers am Warmwasserspeicher ab. Den
  vorgeschriebenen Anteil bei Öl- und Gasheizung können Sie auch in einer begonnenen Heizperiode
  nachtragen. Die Angaben nach § 6a HeizkostenV druckt die Abrechnung mit (siehe unten).
- Bei einer Wärmepumpe fragt die Einrichtung auch, ob sie erst nach dem Stichtag der Verordnung
  eingebaut wurde.
- **Warmwasser ohne Wärmezähler.** Bei der eigenen Heizkostenabrechnung bestimmt Mietfuchs den
  Warmwasseranteil auch nach den beiden Formeln des § 9 Abs. 2 HeizkostenV, aus dem gemessenen
  Warmwasser (mit Vorschlag aus den Warmwasserzählern) oder aus der Wohnfläche. Die Faktoren 1,11
  (Erdgas nach Brennwert), 1,15 (Wärmelieferung) und 0,30 (monovalente Wärmepumpe, für Zeiträume ab
  01.10.2024) gelten nur für diese Formelwerte. Brennstoff in Litern, Kubikmetern oder Kilogramm wird
  mit dem Heizwert laut Rechnung umgerechnet, hilfsweise und nur bei Heizkesseln mit der Tabelle der
  Verordnung. Wird ohne zulässigen Grund nach einer Formel abgerechnet, nennt die Abrechnung die
  Kürzung um 15 % je Mieter. Der Ausdruck nennt Anteil, Verfahren, Rechenweg und die Herkunft jedes
  Heizwerts ([#211](https://github.com/speedone/mietfuchs/issues/211),
  [#99](https://github.com/speedone/mietfuchs/issues/99)).
- Hinweise, wenn der Heizwert aus der Tabelle stammt und wenn der Warmwasseranteil ungewöhnlich ist
  (unter 5 oder über 50 %, nur zur Prüfung).
- Wärmepumpe in Abrechnungszeiträumen, die vor dem 01.10.2024 beginnen: Die Heizanlage fragt, ob die
  Wärmepumpe mehr als die Hälfte der Wärme des Gebäudes liefert. Dann galt die Heizkostenverordnung damals
  nicht (§ 11 Abs. 1 Nr. 3 Buchst. a in der alten Fassung): ein Hinweis, keine Kürzungsbeträge, und Heizung
  und Warmwasser werden gemeinsam nach dem Heizschlüssel verteilt, ohne Warmwasseranteil. Ohne Antwort
  rechnet Mietfuchs ebenso, warnt aber und beziffert je Mieter die mögliche Kürzung um 15 %.
- Die Heizanlage fragt bei einer Wärmepumpe und bei eigener Abrechnung, ob sie die Wärme allein erzeugt.
- An einer Gasrechnung lässt sich angeben, ob die Kilowattstunden nach Brennwert oder nach Heizwert
  berechnet sind, an einer Lieferung mit Menge der Heizwert laut Rechnung oder die Zeile der Tabelle.
  Beide lassen sich auch nach dem Abschluss einer Heizperiode nachtragen.
- Mengen mit Tausenderpunkt („3.000“) liest die Seite Heizkosten jetzt wie Beträge als dreitausend. Beim
  Heizwert und beim Volumen des Warmwassers fragt sie bei „11.325“ nach, ob 11,325 oder 11325 gemeint ist;
  einen Heizwert außerhalb des üblichen Bands der Einheit lehnt Mietfuchs mit einem Satz ab.
- **Eigene Heizkostenabrechnung nach Heizkostenverteilern.** Je Gerät Skala (Einheits- oder
  Produktskala) und Bewertungsfaktor, der Stichtagswert laut Anzeige als eigene Eingabe; die Abrechnung
  nennt jedem Mieter seine Geräte mit Einheiten, Skala und Faktor und zählt den Verbrauch in Einheiten.
  Dazu die Werte eines Ablesedienstes je Wohnung und Nutzungszeitraum auf der Seite Heizkosten, womit auch
  Verdunster und Funk-Heizkostenverteiler abgedeckt sind; liefert der Dienst Warmwasserwerte, zählen sie
  statt der Warmwasserzähler. Mieterwechsel, Leerstand und Zwischenablesung gelten wie bei Wärmezählern
  ([#99](https://github.com/speedone/mietfuchs/issues/99)).
- Hinweise: Bewertungsfaktor oder Skala fehlt (die Anlage wird dann nicht verteilt), Stichtag eines Geräts
  mitten in der Heizperiode, und verschiedene Geräte in einer Anlage. Die dafür nötige Vorerfassung nach
  § 5 Abs. 7 HeizkostenV kommt später ([#218](https://github.com/speedone/mietfuchs/issues/218)); bis
  dahin bleibt der Weg über den Messdienst.
- Womit der Verbrauch erfasst wird, gehört zu jedem Zeitraum der eigenen Heizkostenabrechnung: Wer die
  Geräte zum Beginn einer Heizperiode wechselt und die Einrichtung ab dieser Heizperiode neu durchläuft,
  rechnet frühere Heizperioden weiter mit den früheren Geräten. Skala und Faktor eines Geräts, dessen
  Ablesungen in einer abgeschlossenen Heizperiode zählen, sind gesperrt; ein Gerät mit anderem Faktor ist
  ein neuer Zähler. Ebenso gehört die Warmwasserbereitung zum Zeitraum; eine Änderung gilt ab der Heizperiode,
  ab der Sie die Einrichtung neu durchlaufen.
- Gezählt wird ein Gerät nur in den Heizperioden, die seine Ablesungen überdecken: Ein ausgebauter
  Wärmezähler und ein neuer Heizkostenverteiler mit dem Wechsel am 31.12. sperren keine der beiden
  Heizperioden, und ein Heizkostenverteiler neben dem Wärmezähler derselben Wohnung stört nicht, solange eines
  der beiden die ganze Heizperiode abdeckt. Wechselt das Gerät einer Wohnung mitten in der Heizperiode, etwa am
  30.06., verteilt Mietfuchs die Anlage nicht und nennt den Weg, statt den Verbrauch des alten Geräts still
  wegzulassen.
- Positionen, Verteilung und Ansicht einer Heizperiode richten sich nach deren Warmwasserbereitung, auch wenn
  die Anlage sie später geändert hat: Eine Wartung 2025 „für Heizung und Warmwasser“ behält ihr Ziel, und ein
  Ziel, das nicht passt, ersetzt die Seite Kosten nicht mehr still, sondern meldet es am Feld.
- Beim Mieterwechsel nennt die Abrechnung jedem Mieter nur seine Geräte und Werte in seinem Zeitraum; das
  Ableseergebnis nennt am Stichtag den Stichtagswert. Der Ablesedienst kann die Heizung in Einheiten oder kWh
  nennen, das Warmwasser in m³. Nach einem Kesseltausch rechnet die neue Anlage mit denselben Werten des
  Ablesedienstes. Verdunster lassen sich nicht aus der Ferne ablesen; Lexikon und Karte nennen die Frist bis
  zum 31.12.2026 (§ 5 Abs. 3 HeizkostenV) und die Kürzung um 3 % danach.
- Eigene Heizkostenabrechnung: Fällt ein Zähler oder Heizkostenverteiler aus oder kann der Verbrauch aus einem
  anderen zwingenden Grund nicht ordnungsgemäß erfasst werden, schätzen Sie den Verbrauch der Wohnung auf der
  Seite Heizkosten in der Karte „Schätzung (§ 9a)“ nach einem der drei Wege des § 9a HeizkostenV (vorbelegt:
  Durchschnitt des Gebäudes je m²), mit Grund, Begründung (sie steht auf der Abrechnung des Mieters) und
  Bestätigung. Wer bis zu einem Mieterwechsel gültig abgelesen ist, behält seinen Wert. Betrifft die Schätzung
  mehr als 25 % der Fläche, verteilt Mietfuchs die Kosten dieses Topfs nur nach Fläche; der Dialog nennt den
  Flächenanteil vorher, und dass Mietfuchs dabei die ganze Fläche einer Wohnung zählt, ist als Auslegung
  benannt. Eine Schätzung neben vollständigen Ablesungen wird gemeldet. Wechselt danach die Erfassung der
  Heizperiode, rechnet die Schätzung nicht mehr, bis Sie sie neu eintragen. Auch ein Gerätewechsel mitten in der Heizperiode lässt sich so
  abrechnen. ([#99](https://github.com/speedone/mietfuchs/issues/99))
- Heizkostenabrechnung mit den Informationen nach § 6a HeizkostenV: Die Abrechnung druckt je Mieter die
  eingesetzten Energieträger, die Steuern und Abgaben laut Rechnung, die Entgelte der Erfassung, Kontaktadressen
  zum Energiesparen, beim Verbrauchervertrag die Information zur Streitbeilegung und, bei eigener Abrechnung,
  den Vergleich mit einem Durchschnittsnutzer und den witterungsbereinigten Vergleich mit dem vorhergehenden
  Abrechnungszeitraum als Balken, beides nur mit den eigenen Zahlen des Mieters; bei Fernwärme die jährlichen Treibhausgasemissionen.
  Den Vergleichswert des Durchschnittsnutzers und die Klimafaktoren tragen Sie auf der Seite Heizkosten in der
  Karte „Angaben zur Abrechnung (§ 6a)“ mit ihrer Quelle ein; einen Durchschnitt des eigenen Hauses rechnet
  Mietfuchs nicht, denn die Begründung der Verordnung schließt ihn aus. Bei Heizkostenverteilern und freien
  Schlüsseln bestätigen Sie dort, dass der Vergleich Ihres Ablesedienstes beiliegt. Fehlt einem Mieter eine
  Angabe, nennt die Abrechnung seine Kürzung um 3 %, einmal, auch wenn zugleich die monatliche
  Verbrauchsinformation fehlt; ist nur die Wärme nach § 11 ausgenommen, nur auf den Anteil Warmwasser. Ist sein
  Verbrauch nach § 9a geschätzt, verlangt Mietfuchs für ihn nur die Mindestangaben (Kontaktinformationen,
  Streitbeilegung) und nennt keine Kürzung; das je Mieter anzuwenden ist eine Auslegung. Ob die Abrechnung auf dem Verbrauch beruht und damit die
  volle Pflicht gilt, entscheidet, wie Mietfuchs tatsächlich verteilt, auch bei freien Schlüsseln.
  ([#99](https://github.com/speedone/mietfuchs/issues/99))
- Karte „Ausnahmen und Vereinbarungen“ auf der Seite Heizkosten, je Heizperiode: Ausnahme nach § 11
  HeizkostenV, für die Wärme oder für Wärme und Warmwasser, die abweichende Vereinbarung im Zweifamilienhaus mit
  eigener Wohnung (§ 2) und die Bestätigung, dass die Mieter die monatliche Verbrauchsinformation anders
  bekommen. Jede Antwort gilt ab dieser Heizperiode und ändert keine frühere. Unter der Ausnahme nennt Mietfuchs
  für den ausgenommenen Teil keine Kürzung nach § 12, und sind Wärme und Warmwasser ausgenommen, werden die
  CO₂-Kosten nur bei vereinbarter Abrechnung aufgeteilt (§ 2 Abs. 7 CO2KostAufG); die Vereinbarung nach § 2
  hebt nur die Kürzung um 15 % auf, die Informationspflichten bleiben. Ist „nach Wohnfläche“ vereinbart, verteilt
  die eigene Heizkostenabrechnung nach der Fläche, auch wenn Ablesungen fehlen. Wirkt eine Angabe an einer abgeschlossenen Heizperiode vorbei
  auf eine offene, fragt die Karte vorher nach.
  ([#99](https://github.com/speedone/mietfuchs/issues/99))
- Monatliche Verbrauchsinformation: Rechnen Sie die Heizkosten selbst ab und sind Zähler als fernablesbar
  eingetragen, erstellt Mietfuchs auf der Seite Heizkosten in der Karte „Monatliche Verbrauchsinformation“ je
  Mieter und Monat die Information nach § 6a HeizkostenV aus den Zählerständen genau am Monatsende, nie
  geschätzt: Verbrauch der Heizung in kWh, Warmwasser in m³ und getrennt davon umgerechnet in kWh (angelehnt
  an § 9 Abs. 2 Satz 2, ohne Summe), Vergleich mit Vormonat und Vorjahresmonat desselben Mieters und mit einem
  Durchschnittsnutzer, dessen Vergleichswert Sie mit Quelle eintragen. Das Blatt je Mieter lässt sich drucken
  und nennt keinen anderen Nutzer; den Tag der Mitteilung vermerken Sie je Monat. Fehlt ein Monat oder ist er
  unvollständig, nennt die Abrechnung die Monate und je Mieter einmal die Kürzung um 3 %, für Mieter mit nicht
  ganz fernablesbarer Wohnung mit dem Vorbehalt der Einzelfallprüfung; beides ist als Auslegung gekennzeichnet,
  abgezogen wird nichts. Heizkostenverteiler ergeben keine kWh, dann erstellt der Ablesedienst die Information.
  Bei getrennt bereitetem Warmwasser tragen Sie die mittlere Warmwassertemperatur für die Umrechnung in derselben
  Karte ein. Mietfuchs verlangt die Information für jeden Monat, auch außerhalb der Heizperiode (Auslegung).
  Gilt die Verordnung für eine Wärmepumpe noch nicht (§ 12 Abs. 3 HeizkostenV) oder galt die frühere Ausnahme für
  Gebäude mit überwiegend Wärme aus der Wärmepumpe, fordert die Karte wie die Abrechnung keine Monate ein.
  ([#99](https://github.com/speedone/mietfuchs/issues/99))
- Mehr als 70 % nach Verbrauch, wenn es mit den Mietern vereinbart ist (§ 10 HeizkostenV), in der
  Einrichtung und auf der Seite Heizkosten; nie mehr als 100 %.
  ([#99](https://github.com/speedone/mietfuchs/issues/99))
- **CO₂-Angaben geprüft** ([#97](https://github.com/speedone/mietfuchs/issues/97)): Die Abrechnung prüft
  kg und CO₂-Kosten jeder erfassten Rechnung gegen die Standardwerte der EBeV 2030, den CO₂-Preis des
  Lieferjahres (2021 bis 2026), bei Fernwärme den Durchschnittspreis des Emissionshandels, und die
  Umsatzsteuer, einschließlich des ermäßigten Satzes für Gas und Wärme vom 01.10.2022 bis 31.03.2024 und
  eines Mischsatzes bei Rechnungen über die Stichtage. Abweichungen nennt sie als Hinweis; keine Zahl
  ändert sich. Den CO₂-Preis 2027 und spätere Werte, die das Umweltbundesamt noch nicht veröffentlicht
  hat, können Sie in den Einstellungen mit Quelle eintragen; bringt ein Update den amtlichen Wert, gilt
  dieser.
- **Ausdruck „CO₂-Angaben für den Messdienst“** ([#210](https://github.com/speedone/mietfuchs/issues/210)):
  Auf der Seite Heizkosten stellt Mietfuchs je Heizperiode die Angaben der Rechnungen (kg CO₂, CO₂-Kosten,
  Emissionsfaktor, Energiegehalt, Menge, Betrag), den Anfangsbestand eines Vorrats, die Fläche und die
  Angaben zu §§ 8, 9 CO2KostAufG zum Drucken und Weitergeben zusammen. Die Summe enthält nur, was auch die
  Abrechnung zählt; stornierte Rechnungen, abgedeckte Schätzungen und Rechnungen vor 2023 stehen mit
  einem Vermerk darin. Hinweise der Prüfung stehen auch an der Lieferung. Unter der Summe der Rechnungen
  (nicht abgegrenzt) steht, was die Abrechnung daraus macht: beim Vorrat Endbestand und Verbrauch in der
  Heizperiode, sonst der Teil der Rechnungen in der Heizperiode, dazu die Einstufung laut Abrechnung.
- **Betriebsstrom der Heizung** ([#212](https://github.com/speedone/mietfuchs/issues/212)): Eine
  Heizposition lässt sich als Betriebsstrom kennzeichnen, der über den Stromzähler des Hauses läuft.
  Steht beim Allgemeinstrom kein Abzug in gleicher Höhe, nennt die Abrechnung den Betrag, der doppelt
  verteilt wird (§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15). Die
  Karte „Betriebsstrom“ auf der Seite Heizkosten schätzt ihn nach Leistung der Geräte und Heiztagen,
  auf Wunsch mit eigenen Tagen je Gerät, nimmt den Zwischenzähler oder einen selbst geschätzten Betrag
  mit Grundlage und legt Betriebsstrom und Abzug gemeinsam an; der Euro-Betrag ist der Anteil am
  Rechnungsbetrag einschließlich Grundpreis. Die Grundlage der Schätzung bleibt an beiden Positionen
  gespeichert und steht im Rechenweg, denn bestreitet ein Mieter den Betrag, müssen Sie sie darlegen
  (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz c). Einen von Hand erfassten Abzug
  verknüpfen Sie im Kostenformular mit dem Betriebsstrom und mit der Stromrechnung, aus der er stammt;
  er übernimmt deren Verteilung, und die Rechnung lässt sich nicht löschen, solange er besteht. Die
  Abrechnung meldet einen Abzug, der anders verteilt ist als seine Rechnung, und mehr Abzug als Rechnung. Die Karte bietet nur Stromrechnungen an, die
  die Heizperiode berühren, übernimmt deren Jahr der Zahlung (auch bei Abrechnung von Mai bis April),
  zeigt, was schon gebucht ist, und fragt bei einer zweiten Buchung zurück; mehr Abzug als Rechnung
  lehnt auch das Kostenformular ab, und ein Wechsel des Abrechnungszeitraums nimmt Rechnung und Abzüge
  gemeinsam mit. Steht der Allgemeinstrom in
  einer abgeschlossenen Abrechnung, legt die Karte nichts an; ein Abzug, der dort nach dem Abschluss
  angelegt oder geändert wurde, zählt nur mit dem, was die zugestellte Abrechnung gutgeschrieben hat, und
  der Hinweis sagt je Fall, was zu tun ist und wo nach Ablauf der Frist die Grenze liegt (§ 556 Abs. 3
  Satz 3 BGB). Bei Wärmepumpe und Stromheizung gehört der Strom zur Wärmeerzeugung zu den Heizkosten,
  aber nicht als Betriebsstrom (§ 7 Abs. 2 HeizkostenV nennt ihn neben den Brennstoffen); läuft er über
  den Hauszähler, kennzeichnen Sie seine Heizposition und verknüpfen den Abzug, als Auslegung von
  Mietfuchs gekennzeichnet. Umwälzpumpen und Regelung kennzeichnen Sie dort als Betriebsstrom, bei
  Fernwärme die der Hausanlage (§ 7 Abs. 4, § 8 Abs. 4 HeizkostenV). Einen Bruchteil der
  Brennstoffkosten lässt der BGH für Wohnungseigentümer als Schätzgrundlage zu; Mietfuchs rechnet keinen
  Prozentsatz vor, das Lexikon nennt die Literaturwerte. In der Steuerübersicht zählt die Stromrechnung des
  Allgemeinstroms in jedem Steuerjahr genau einmal zu den Werbungskosten
  ([#268](https://github.com/speedone/mietfuchs/issues/268)): Ein Abzug, den Sie nicht umlegen und selbst
  tragen, mindert nur die Abrechnung an die Mieter, und Betriebsstrom, der zugleich in den Heizkosten steht,
  zählt nicht doppelt. Die Übersicht zeigt dafür die Zeile „Betriebsstrom der Heizung“ beim Allgemeinstrom,
  bei Eigennutzung mit dem privaten Teil nach Ihrem Eigenanteil an den Heizkosten der verknüpften Anlage, bei einem
  Abzug ohne Verweis nach der Fläche des ganzen Gebäudes (beides eine Auslegung), und
  auch das ZIP „Belege für die Steuer“ führt sie. Im Kostenformular heißt der Abzug ohne Verweis ohne
  Messdienst „Ja, ich lege ihn nicht um und trage ihn selbst“. Stehen Abzug und Betriebsstrom in verschiedenen
  Steuerjahren, verschiebt sich in der Anlage V nichts mehr; jedes Jahr zeigt die in ihm bezahlten Rechnungen. Der
  Hinweis dazu und der Satz in der Vorschau beim Wechsel des Abrechnungszeitraums entfallen deshalb. Zeigt ein Abzug
  auf eine Position, die nicht als Betriebsstrom in den Heizkosten gekennzeichnet ist, nennt der Rechenweg den Verweis
  zum Prüfen; steht neben einem abweichenden verknüpften Abzug einer ohne Verweis, sagt der Hinweis, dass dieser Teil
  richtig erfasst ist. Die Abrechnung an die Mieter ändert sich nicht.
- **Hinweis, wenn der Betriebsstrom der Heizung fehlt** ([#224](https://github.com/speedone/mietfuchs/issues/224)):
  Hat eine Zentralheizung mit Brenner im Abrechnungszeitraum weder einen Betriebsstrom noch einen Abzug beim
  Allgemeinstrom, sagt die Abrechnung das, mit dem Weg über die Karte „Betriebsstrom“ (§ 7 Abs. 2, § 8 Abs. 2
  HeizkostenV; § 2 Nr. 4 Buchst. a BetrKV; BGH, Urteil vom 03.06.2016, V ZR 166/15). Der Hinweis ist eine
  Auskunft und färbt das Cockpit nicht. Ohne Angabe an der Heizanlage schweigt er bewusst, sobald für die Anlage
  irgendeine Heizposition „Betrieb“ erfasst ist, auch wenn es nur die Wartung ist, und ebenso bei Fernwärme, bei
  einer Heizung mit Messdienst und ohne Allgemeinstrom: Dort lässt sich ohne weitere Angabe nicht erkennen, ob
  der Betriebsstrom fehlt.
- **Angabe an der Heizanlage, wie der Betriebsstrom erfasst ist** ([#266](https://github.com/speedone/mietfuchs/issues/266)):
  Auf der Seite Heizkosten fragt die Karte „Betriebsstrom der Heizung“ bei einer Zentralheizung mit Brenner ohne
  Messdienst, ob die Heizung einen eigenen Stromvertrag mit eigener Rechnung hat oder über die Stromrechnung des
  Hauses läuft, auch mit Zwischenzähler. Mit „über die Stromrechnung des Hauses, beim Allgemeinstrom abgezogen“
  meldet die Abrechnung „Abzug des Betriebsstroms fehlt“, wenn beim Allgemeinstrom kein Abzug steht, auch wenn
  die Wartung als Heizposition „Betrieb“ erfasst ist; das ist die Lage aus BGH, Urteil vom 03.06.2016,
  V ZR 166/15 (Wohnungseigentum), und BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07 (Mietrecht):
  Betriebsstrom im Allgemeinstrom ohne Abzug, und eine erfasste Wartung ändert daran nichts. Dieser Hinweis
  färbt das Cockpit gelb. Ist die Heizposition „Betrieb“ schon der Betriebsstrom selbst, sagt er, wie man ihn
  nicht doppelt anlegt, und er nennt den netto eingetragenen Allgemeinstrom (BGH, Urteil vom 20.01.2016,
  VIII ZR 93/15). Mit „eigener Stromvertrag, Rechnung als Heizposition erfasst“ weist die Abrechnung darauf hin,
  wenn keine Heizposition „Betrieb“ erfasst ist; das ist eine Auskunft. Mit „eigener Stromvertrag, die Kosten
  trägt der Vermieter selbst“ schweigt der Hinweis. Ohne Angabe bleibt alles wie bisher; die Angabe ändert keine
  Zahl der Abrechnung und übersteht den Kesseltausch.
- **Hinweis, wenn der Strom einer Wärmepumpe im Allgemeinstrom mitlaufen kann** ([#253](https://github.com/speedone/mietfuchs/issues/253)):
  Hat eine Wärmepumpe oder ein Elektrokessel keine eigene Stromrechnung und steht beim Allgemeinstrom kein
  Abzug, weist die Abrechnung darauf hin. Seit dem 01.01.2024 zählt § 2 Nr. 4 Buchst. a BetrKV diesen Strom zu
  den Heizkosten, seit dem 01.10.2024 auch § 7 Abs. 2 HeizkostenV, soweit sie für die Anlage gilt; dass er aus dem Allgemeinstrom
  herauszurechnen ist, ist eine Auslegung von Mietfuchs und steht so da. Für Zeiträume vor 2024 kommt der
  Hinweis nicht.
- Beim Wechsel des Abrechnungszeitraums folgt der Abzug des Betriebsstroms immer seiner Stromrechnung, auch
  wenn deren Leistungszeitraum ganz in einem neuen Zeitraum liegt; bisher lehnte der Wechsel das ab. Mehrere
  Abzüge einer Rechnung werden gemeinsam geteilt, sodass aus keinem Teil mehr abgezogen wird, als er beträgt,
  und das Jahr der Zahlung eines Abzugs folgt seinem Betriebsstrom. Die Hilfe am Feld „Jahr der Zahlung (Steuer)“
  erklärt, warum dort das Jahr des Betriebsstroms gilt.

- **Wärmelieferung und Contracting** ([#213](https://github.com/speedone/mietfuchs/issues/213)): Betreibt ein
  Dritter die Heizung im Haus und liefert die Wärme, setzen Sie bei der Heizanlage das Häkchen „Contracting“ und
  wählen den Brennstoff seines Kessels, auch bei einer Wärmepumpe. Die Anlage rechnet dann wie Fernwärme: kein
  Pflichtanteil von 70 % nach Verbrauch (§ 7 Abs. 3 HeizkostenV), Formelwerte für das Warmwasser ÷ 1,15, kein
  Vorrat bei Ihnen, und die Rechnungen des Lieferanten sind Wärmerechnungen. CO₂-Angaben verlangt Mietfuchs nach
  dem Brennstoff des Lieferanten: bei Gas, Öl, Flüssiggas, Kohle und „Etwas anderes“ wie bei Fernwärme, bei
  Pellets, Holz, Strom und Wärmepumpe nicht (§ 2 Abs. 1 Satz 2 CO2KostAufG). Die Informationen nach § 6a
  HeizkostenV nennen den Brennstoff des Kessels und verlangen keine Werte eines Wärmenetzes; nach dem
  Betriebsstrom fragt Mietfuchs wie bei Fernwärme nicht. Bei Contracting mit einer Wärmepumpe rechnet Mietfuchs
  den Warmwasseranteil nur gemessen, denn ob der Formelwert durch 1,15 zu teilen oder mit 0,30 zu malnehmen ist,
  regelt die Verordnung nicht. Die Ausnahme für Gebäude, die überwiegend mit Wärme aus Wärmepumpen versorgt wurden
  (§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV in der Fassung bis 30.09.2024), und der Übergang nach § 12 Abs. 3 gelten
  auch bei Contracting mit einer Wärmepumpe, denn beide knüpfen an den Wärmeerzeuger an (§ 1 Abs. 1 Nr. 2: Wärmelieferung
  „auch aus Anlagen nach Nummer 1“; Auslegung am Wortlaut). Wer während laufender Mietverhältnisse umgestellt hat, trägt den Tag der
  Umstellung ein; die Abrechnung nennt dann für die Mieter, deren Vertrag vorher lief, die Voraussetzungen des
  § 556c BGB und die Ankündigung nach der Wärmelieferverordnung (auch bei einer Betriebskostenpauschale, denn
  § 556 Abs. 2 BGB lässt Betriebskosten „als Pauschale oder als Vorauszahlung“ ausweisen; das ist eine Auslegung;
  nicht bei einer Inklusivmiete), bei fehlender oder verspäteter Ankündigung die
  Folge nach § 11 Abs. 3 WärmeLV, und bei vorheriger Eigenversorgung der Mieter die Rechtslage nach BGH,
  Urteile vom 20.05.2026, VIII ZR 46/25 und 47/25 (im entschiedenen Fall jedenfalls die Kosten nach § 7 Abs. 2,
  § 8 Abs. 2 HeizkostenV; ob mehr, hängt von der Vereinbarung ab). Eine Umstellung in einem laufenden Zeitraum
  erfassen Sie mit „Heizung erneuert (Kessel getauscht)“; an einer Anlage mit Lieferungen, Vorrat oder
  CO₂-Angaben oder mit Heizpositionen oder Angaben eines offenen Zeitraums lässt sich das Häkchen nicht umschalten,
  sonst rechnete Mietfuchs auch die Zeit davor um. Der
  Hilfetext zur Energie riet bisher, Contracting als Fernwärme einzutragen; so eingetragene Anlagen bleiben
  Fernwärme und rechnen weiter richtig, nur ohne bekannten Brennstoff. Ohne Häkchen und ohne Tag der
  Umstellung ändert sich keine Zahl und kein Hinweis.
- Eichfrist der Zähler: An jedem Zähler außer Heizkostenverteilern lässt sich eintragen, bis zu welchem Jahr
  er geeicht ist. Aus der Jahreszahl auf dem Zähler („M22“ oder die Jahresangabe der Eichmarke) schlägt
  Mietfuchs das Jahr vor: bei Kalt- und Warmwasserzählern und Wärmezählern sechs Jahre; bei Warmwasser- und
  Wärmezählern bis zur Jahreszahl 2015 fünf Jahre, denn deren Frist lief vor der Verlängerung am 03.11.2021
  ab. Die Änderungsverordnung vom 26.10.2021 enthält keine Übergangsregel. Mietfuchs wendet die Frist von
  6 Jahren auch auf Fristen an, die am 03.11.2021 noch liefen; eine schon abgelaufene Frist lebt nicht wieder
  auf. Das ist eine Auslegung. Der Vorschlag nennt sie. Stammt eine
  Ablesung des Zeitraums aus der Zeit nach Ablauf, warnt die Zähler-Seite und nennt die Beweislast nach dem
  Bundesgerichtshof und die Verlängerung im Stichprobenverfahren; das Cockpit zeigt dazu eine eigene gelbe
  Zeile „Eichfrist“, die Ampel „Zählerstände“ bleibt unberührt. Die Werte werden weiter verwendet, keine Zahl
  einer Abrechnung ändert sich, und wer nichts einträgt, sieht nichts.
  ([#98](https://github.com/speedone/mietfuchs/issues/98))
- **Hälftige Teilung ab 2028 nach §§ 5a, 5b, 5d CO2KostAufG** ([#215](https://github.com/speedone/mietfuchs/issues/215)):
  Bei einer Gas-, Öl- oder Flüssiggasheizung, die nach dem 29.07.2026 in ein bestehendes Gebäude eingebaut
  wurde (§ 43 Abs. 1 GModG), oder einer solchen Heizung in einem Neubau tragen Vermieter und Mieter ab dem
  01.01.2028 die Gasnetzentgelte und die CO₂-Kosten je zur Hälfte, ab dem 01.01.2029 auch die Kosten des
  Pflichtanteils an Biobrennstoff, höchstens für 30 % des verbrauchten Brennstoffs. Mietfuchs teilt anteilig
  nach Anfall, je Rechnung nach Zählerstand, Zwischenrechnung oder Gradtagen; dass auch die CO₂-Kosten nach
  Anfall geteilt werden, ist eine Auslegung und steht so da. Den Anteil des Vermieters an Netzentgelten und
  Biobrennstoff zieht die Abrechnung als eigene Zeile ab (§ 7 Abs. 5); fehlt eine Angabe an der Gasrechnung,
  nennt sie die Kürzung von 3 % je Mieter. Notfalleinbau (§ 5a Abs. 4; nach einem Ausfall 2028 zwölf Monate ab
  dem Einbau, so die Gesetzesbegründung), Neubau mit Bauantrag vor dem 13.05.2026 (§ 5b) und das selbst bewohnte
  Gebäude mit höchstens zwei Wohnungen an einer gemeinsamen Heizung außerhalb angespannter Wohnungsmärkte
  (§ 5d Abs. 3) sind berücksichtigt, ebenso Anlagen, die ein Contractor betreibt. § 9 kürzt nur den Anteil nach
  Stufen, nicht die Hälfte nach § 5a; das ist eine Auslegung zu Ihren Lasten. Neu dafür an der Heizanlage die
  Karte „Heizung nach § 43 GModG“, am Objekt die Frage, ob das Gebäude in einem Gebiet mit angespanntem
  Wohnungsmarkt liegt (mit Geltung der Verordnung), am Mietverhältnis der Tag der Mitteilung nach § 5d Abs. 4
  und an der Lieferung Netzentgelte und Biobrennstoff. Biobrennstoff aus einem Vorrat und die Grenze von 30 % ab
  2040 rechnet Mietfuchs noch nicht ([#227](https://github.com/speedone/mietfuchs/issues/227)); die Abrechnung
  sagt das, außer an jeder Lieferung ab dem 01.01.2029 ist 0 eingetragen (früher gelieferter Brennstoff enthält keinen Pflichtanteil). Das Blatt „CO₂-Angaben für den Messdienst“ nennt die
  Teilung nach § 5a und die Netzentgelte und Biobrennstoffkosten der Rechnungen. Ohne Tag des Einbaus ändert sich
  keine Zahl und kein Hinweis.
- **Mieter heizt selbst, und die CO₂-Erstattung dafür** ([#97](https://github.com/speedone/mietfuchs/issues/97)):
  Am Mietverhältnis lässt sich unter Heizung „Mieter heizt selbst“ wählen, wenn der Mieter Brennstoff oder Wärme
  über einen eigenen Vertrag bezieht, etwa für eine Gastherme oder für eine zentrale Heizung, deren Brennstoff er
  selbst kauft. Wartung und Betriebsstrom, die Sie tragen, rechnet Mietfuchs weiter ab. Die Einrichtung der Heizung
  fragt bei Gas, Öl, Flüssiggas und Kohle, wer den Liefervertrag hat; hat ihn der Mieter, legt sie keine Heizanlage an
  und bietet an, die Mietverhältnisse umzustellen. Versorgt ein Mieter über seinen Vertrag auch Wohnungen anderer,
  rechnet Mietfuchs das nicht. Bei einer zentralen Heizung erinnert die Abrechnung daran, ihren Betriebsstrom beim
  Allgemeinstrom abzuziehen, wenn andere Mieter diesen mittragen; der Abzug für eine andere Heizanlage zählt dabei
  nicht. Steht ein Mietverhältnis schon ohne Angabe der Art auf „Mieter heizt selbst“, trägt die Einrichtung die Art
  nach, und beim Mieterwechsel sagt die Maske, dass der Nachmieter „Mieter heizt selbst“ übernimmt. Auf der Seite Kosten erfassen Sie die Anzeige des Mieters nach § 6 Abs. 2
  CO2KostAufG. Mietfuchs rechnet nach (Stufe, gekürzte Tabelle bei kürzerem Zeitraum des Lieferanten,
  Nichtwohngebäude, Beschränkungen nach § 9, 5 % weniger bei Geräten im Eigentum des Mieters wie einem eigenen
  Gasherd, kein Anspruch bei gewerblicher Nutzung ohne getrennte Messung, ab 2028 die hälftige Teilung nach § 5a),
  verrechnet den Betrag als Gutschrift in der Betriebskostenabrechnung, weist auf eine Abweichung von der
  Nachrechnung hin und nennt die Fristen für Anzeige, Verrechnung und Auszahlung; verrechnet wird nur bei
  vereinbarter Vorauszahlung, und eine Erstattung gibt es nur bei „Mieter heizt selbst“. Der Vorschlag für die
  neue Vorauszahlung rechnet ohne die Erstattung. In der Steuerübersicht wirkt eine verrechnete Erstattung über die
  Zahlungen, eine ausgezahlte steht im Jahr der Auszahlung bei den Werbungskosten, als eigene Zeile der Aufstellung
  je Position und in der Übersicht des ZIP „Belege für die Steuer“, deren Summe damit den Werbungskosten gleicht.
- **Die KI liest Messdienstabrechnung und Lieferantenrechnung**
  ([#103](https://github.com/speedone/mietfuchs/issues/103)): Auf der Seite Heizkosten liest die Karte
  „Messdienstabrechnung auslesen“ die Heiz- und Warmwasserkostenabrechnung eines Messdienstes: Nutzerbeträge je
  Kostenblock, Zeitraum, Nutzeinheiten, die Summe der Nutzerkosten, die Zeile „Abzüglich CO₂-Kosten Vermieter“,
  Brennstoffkosten, den CO₂-Block und die Ermittlung des Warmwassers. Jede Nutzerzeile wird nur bei genau einem
  Treffer einem Mieter, der eigenen Wohnung oder dem Leerstand zugeordnet, sonst ordnen Sie sie zu; der Betrag der
  Heizposition ist die Summe vor dem Abzug. Kalte Blöcke übernimmt die Karte nur, wenn die Heizperiode dem
  Abrechnungszeitraum gleicht, und reicht ein Zeitraum über zwei Kalenderjahre, fragt sie je Block nach dem Jahr der
  Zahlung. Die Frage nach der Abzugszeile bleibt ohne Vorgabe; widerspricht Ihre Antwort der gelesenen Zeile, sagt die
  Karte es. In der Karte „Lieferungen“ füllt „Rechnung mit KI auslesen“ das Formular aus der Rechnung eines Brennstoff-
  oder Wärmelieferanten vor: Rechnungsbetrag vor Abschlägen, Menge, Teilmengen bei einer Preisänderung, Heizwert und die
  Angaben nach § 3 Abs. 1 CO2KostAufG samt Emissionsfaktor. Den Preisbestandteil für den nach § 43 Abs. 1 GModG anteilig
  zu nutzenden Brennstoff übernimmt sie nur, wo Mietfuchs ihn rechnet, und sagt sonst, warum nicht. Gespeichert wird in
  beiden Karten erst, wenn Sie übernehmen. Lieferungen von Gas, Fernwärme und Strom tragen jetzt auch Menge, Teilmengen
  und Emissionsfaktor, Lieferungen aus dem Vorrat den Emissionsfaktor.
- Rohrwärme: Rechnen Sie die Heizkosten selbst mit Heizkostenverteilern ab, nennt die Abrechnung als Hinweis, dass
  bei überwiegend ungedämmten, frei auf der Wand verlaufenden Leitungen der Verbrauch nach anerkannten Regeln der
  Technik bestimmt werden kann (§ 7 Abs. 1 Satz 3 HeizkostenV, Verfahren in VDI 2077 Blatt 3.5), für Leitungen unter
  Putz oder im Estrich aber nicht (BGH, Urteil vom 15.03.2017, VIII ZR 5/16). Das Lexikon erklärt den Begriff.
  Die Bestimmung selbst rechnet Mietfuchs nicht; der Hinweis färbt die Ampel nicht, und keine Zahl ändert sich
  ([#219](https://github.com/speedone/mietfuchs/issues/219)).

- Vorerfassung nach Nutzergruppen: Rechnen Sie die Heizkosten eines Gebäudes selbst ab, das überwiegend nicht dem
  Wohnen dient, nennt die Abrechnung als Hinweis, dass bei unterschiedlichen Nutzungsarten eine Vorerfassung nach
  Nutzergruppen möglich ist (§ 5 Abs. 7 Satz 2 HeizkostenV) und wann sie vorgeschrieben ist; das Lexikon erklärt den
  Begriff. Die Vorerfassung selbst rechnet Mietfuchs nicht; verschiedene Geräte an einer Anlage bleiben ein Fehler
  mit Verweis auf den Messdienst. Der Hinweis färbt die Ampel nicht, und keine Zahl ändert sich
  ([#218](https://github.com/speedone/mietfuchs/issues/218)).

- Nutzerwechselgebühr auch bei Wasser: Heißt eine Position „Wasser/Abwasser“ oder eine Position nach Zählern etwa
  „Zwischenablesung“ oder „Nutzerwechselgebühr“, weist die Abrechnung wie bei der Heizung darauf hin, dass diese
  Kosten keine umlagefähigen Betriebskosten sind (BGH, Urteil vom 14.11.2007, VIII ZR 19/07), und nennt den Weg über
  „Nicht umlagefähig“. Neu im Lexikon: „Nutzerwechselgebühr“. Keine Zahl ändert sich
  ([#223](https://github.com/speedone/mietfuchs/issues/223)).

- Wärmelieferung mit unmittelbarer Abrechnung durch den Lieferanten: Bei Fernwärme oder Contracting bietet die
  Einrichtung der Heizung die Antwort „Der Wärmelieferant rechnet unmittelbar mit den Mietern ab“. Mietfuchs legt
  dann keine Heizanlage an, fragt nicht nach Geräten und Umstellung und stellt die Mietverhältnisse auf „Mieter heizt
  selbst“. Legt der Lieferant die Anteile am Gesamtverbrauch zugrunde, gelten die Pflichten der Heizkostenverordnung
  für ihn (§ 1 Abs. 3 HeizkostenV), und die Kosten der Hausanlagen, die Sie gesondert abrechnen, sind von der
  Verteilung nach Verbrauch ausgenommen (§ 11 Abs. 1 Nr. 4 HeizkostenV); misst er jede Wohnung selbst, gilt die
  Verordnung für diese Verteilung nicht. Die Erklärung steht vor dem Speichern unter der Frage. Vorher blieb nur
  eine Antwort, nach der die Abrechnung eine Kürzung um 15 % und einen Hinweis zu den CO₂-Kosten nannte, die in diesem Fall
  nicht zutreffen. Die Hinweise zu einer Heizung, deren Brennstoff der Mieter selbst bezieht, sagen jetzt
  „Brennstoff oder Wärme“. Keine Zahl ändert sich ([#225](https://github.com/speedone/mietfuchs/issues/225)).
- **Das Cockpit weist auf vermutlich falsch eingetragene IBANs hin.** Seit der Prüfung beim
  Speichern kommt keine neue ungültige IBAN hinzu, eine schon gespeicherte bleibt aber stehen.
  Steht am gewählten Objekt, in den Einstellungen (wenn das Objekt keine eigene Bankverbindung
  hat) oder an einem seiner Mietverhältnisse, das im Vorjahr oder später noch lief, eine IBAN,
  deren Prüfziffer, Länge oder Länderkennung nicht passt, nennt das Cockpit sie mit Ort
  und Grund, etwa „2 IBANs sind vermutlich falsch eingetragen“, und führt mit „Hier beheben →“
  zur Stelle. Der Hinweis ist ein ruhiger Kasten am Ende des Cockpits: Er zählt nicht zur
  Fertigstellung und färbt keine Ampel, denn eine falsche IBAN ändert keine Zahl der
  Abrechnung. Sind alle IBANs gültig oder leer, erscheint nichts
  ([#279](https://github.com/speedone/mietfuchs/issues/279)).

### Geändert

- Neue Warnung „Monatliche Verbrauchsinformation“ bei einer Heizanlage, deren Zähler oder
  Heizkostenverteiler als fernablesbar eingetragen sind: Seit 2022 stehen den Mietern dann monatliche
  Informationen zu, sonst bis zu 3 % Kürzung. Bekommen Ihre Mieter sie über den Messdienst (in einem Portal
  nur mit einer Nachricht jeden Monat), bestätigen Sie das in der Karte „Ausnahmen und Vereinbarungen“.
  Die Warnung zu den Angaben nach § 6a bei der eigenen Heizkostenabrechnung heißt jetzt „Angaben zur
  Heizkostenabrechnung unvollständig“ und erscheint auch bei freien Schlüsseln, deren Heizkosten nach
  Zählern verteilt werden; keine Zahl ändert sich. ([#99](https://github.com/speedone/mietfuchs/issues/99))
- Die Warnung „Monatliche Verbrauchsinformation“ nennt bei eigener Heizkostenabrechnung mit als fernablesbar
  eingetragenen Zählern die Monate, die nicht mitgeteilt oder unvollständig sind, statt „bis zu 3 %“ pauschal;
  ist nur die Anlage als fernablesbar angegeben oder liefert der Ablesedienst die Werte, bleibt sie wie bisher.
  Die Fundstelle der Begründung zur Summierung der Kürzungsrechte heißt jetzt richtig BR-Drs. 643/21, S. 24 f.
  ([#99](https://github.com/speedone/mietfuchs/issues/99))
- Der Fehler „Heizkostenabrechnung unvollständig“ bei einem fehlenden Stand, einem Zählerwechsel ohne
  Endstand, negativem Verbrauch oder fehlenden Werten des Ablesedienstes verweist jetzt auf die Schätzung
  statt auf eine spätere Version. ([#99](https://github.com/speedone/mietfuchs/issues/99))
- Die Ablehnung einer Verteilung „nach Verbrauch“ mit Heizkostenverteilern bei freien Schlüsseln verweist
  jetzt auf die eigene Heizkostenabrechnung mit der Erfassung „Heizkostenverteiler“.

- Eigene Heizkostenabrechnung: Die Heizung darf jetzt auch bei Heizöl, Flüssiggas, Pellets, Holz und
  Kohle das Warmwasser bereiten; die Einrichtung sperrt das nicht mehr.
- Holzhackschnitzel: Seit 01.12.2021 nennt die Heizkostenverordnung 4 kWh je Kilogramm; die frühere
  Angabe 650 kWh je Schüttraummeter gilt nur für Zeiträume davor, und den Brennstoffverbrauch bestimmt
  die Verordnung seither in Litern, Kubikmetern oder Kilogramm.

- Bei freien Schlüsseln kann eine Heizposition „nur Heizung“ sein; beim Mieterwechsel teilt sie sich
  dann nach Gradtagen statt nach Tagen. Positionen „Heizung und Warmwasser“ bleiben, wie sie sind.
- Eine Heizposition, deren Beschreibung „Zwischenablesung“ oder „Nutzerwechsel“ enthält, bekommt einen
  Hinweis: Diese Kosten trägt der Vermieter, soweit im Mietvertrag nichts anderes vereinbart ist.
- **Oberfläche aufgeräumt.** Felder, Hilfetexte und Knöpfe stehen in Karten, Seitenfenstern und
  aufklappbaren Bereichen mit einheitlichem Abstand, statt aneinanderzukleben; eingegebene Werte,
  Platzhalter und Hilfetexte sind nicht mehr fett, Kontrollkästchen stehen überall links neben
  ihrem Text. Aufklappbare Bereiche und Links sehen überall gleich aus, Schrift in Akzentfarbe ist
  im dunklen Design gut lesbar, und „Abbrechen“ wird beim Überfahren nicht mehr rot. Die Hinweise
  der Abrechnung stehen als Liste mit Titel und aufklappbarem Text, das Cockpit nennt sie Zeile für
  Zeile. Breite Tabellen zeigen auf dem Handy, dass sich seitlich scrollen lässt, und die
  Seitentitel heißen wie in der Navigation.
- **Jahr der Zahlung bei der Belegbuchung.** Reicht der Abrechnungszeitraum über zwei
  Kalenderjahre, liegt das Jahr der Zahlung immer zwischen dem ersten Jahr und dem Jahr nach dem
  Ende des Zeitraums: Ein Rechnungsdatum außerhalb wird auf die nächste Grenze gesetzt, auch bei
  Positionen ohne Heizbezug, und die Vorschau sagt das. Bei einer Heizposition mit eigener
  Heizperiode gilt ohne Rechnungsdatum das Jahr, in dem die Heizperiode endet
  ([#217](https://github.com/speedone/mietfuchs/issues/217)).
- Abrechnungszeiträume werden intern als Zeitraum geführt und nicht mehr als Kalenderjahr:
  Kostenpositionen, abgeschlossene Abrechnungen und gezahlte Vorauszahlungen hängen an einem
  Zeitraum, der im Kalenderjahr wie bisher heißt. Wer im Kalenderjahr abrechnet, merkt davon
  nichts; jede Zahl bleibt gleich. Die Abrechnung nennt ihre Frist jetzt selbst, und Frist und
  Höchstdauer des Zeitraums (§ 556 Abs. 3 BGB) frieren mit der abgeschlossenen Abrechnung ein.
  Vorbereitung für Abrechnungszeiträume wie Mai bis April
  ([#208](https://github.com/speedone/mietfuchs/issues/208)).
- **Rechtsregister.** Jede Rechtszahl, mit der Mietfuchs rechnet oder die es nennt (Kabel-TV bis
  30.06.2024, 50 bis 70 % nach Verbrauch, die Kürzungen um 15 % und 3 %, die Fernablesbarkeit ab
  2027, ein Leerstandstag mit einer Person, der Regelsatz der Umsatzsteuer), steht jetzt an einer
  Stelle, mit Gültigkeit und Fundstelle. Eine abgeschlossene Abrechnung friert die Werte ein, mit
  denen sie gerechnet wurde; die Abrechnung zeigt sie unter „Rechtsstand“, und weicht ein Wert
  später ab, sagt es der Vergleich mit der heutigen Berechnung. Abgeschlossene Abrechnungen
  bleiben unverändert; bei einer Abrechnung von vor dieser Version steht „Rechtswerte nicht
  gespeichert“. Keine Zahl und kein Hinweistext einer Abrechnung ändert sich; neu gesetzt ist nur
  der angezeigte Rechtsstand, jetzt das Datum des Rechtsregisters (12.10.2026 statt 02.10.2026).
  ([#97](https://github.com/speedone/mietfuchs/issues/97), [#110](https://github.com/speedone/mietfuchs/issues/110))
- **KI-Belegauswertung:** Ob der Abstand zwischen Positionen und Rechnungsbetrag Umsatzsteuer
  ist, misst Mietfuchs jetzt am Satz des Rechnungsdatums, für das zweite Halbjahr 2020 also an
  16 %. Passt der Abstand nicht, bleiben die Positionen wie auf dem Beleg stehen.
- **Wasser nach Zählern: Warmwasserzähler zählen mit.** Beim Kaltwasser nach Verbrauch gehen die
  Warmwasserzähler der Wohnungen in die Verteilung ein, denn die Wasserkosten des Warmwassers
  gehören dazu. Ob eine Wohnung einen Zähler hat, sagt aber nur ein Kaltwasserzähler; mit nur einem
  Warmwasserzähler gilt für ihr Kaltwasser der Rest des Hauptzählers. Zähler, die zur Heizanlage
  selbst gehören (etwa ein Wärmezähler am Speicher), gelten nicht als Hauptzähler des Hauses. Beides
  betrifft nur Bestände mit diesen neuen Zählern, keine bisherige Abrechnung
  ([#99](https://github.com/speedone/mietfuchs/issues/99)).

- **Angekündigt: Hinweis zu den CO₂-Kosten bei Heizpositionen ab 2023.** Für Abrechnungszeiträume, die
  am oder nach dem 01.01.2023 beginnen, sagt die Abrechnung bei Positionen „Heizung und Warmwasser“,
  ob die CO₂-Kosten aufzuteilen sind, und nennt die Kürzung von 3 % je Mieter, wenn die Aufteilung
  fehlt. Ohne Heizanlage ist das ein Hinweis mit dem Knopf „Heizung einrichten →“, mit einer Gas-,
  Öl-, Flüssiggas- oder Kohleheizung ohne CO₂-Angaben eine Warnung; beide färben die Ampel im Cockpit.
  Keine Zahl ändert sich ([#97](https://github.com/speedone/mietfuchs/issues/97)).
- **Anleitung „Fertige Abrechnung eines Messdienstes übernehmen“:** Der Betrag Ihrer selbstgenutzten
  Wohnung steht wie in der Abrechnung; den CO₂-Teil Ihrer Wohnung tragen Sie in der Karte „CO₂-Kosten“
  ein. Wer ihn nach der bisherigen Anleitung in den Eigenbetrag geschrieben hat, dem meldet die Probe
  das ([#209](https://github.com/speedone/mietfuchs/issues/209)).
- Eine Heizanlage mit erfassten CO₂-Angaben lässt sich erst entfernen, wenn die Angaben entfernt sind.
- Ohne Heizanlage bleibt der Hinweis zu einer Heizrechnung über die Heizperiode hinaus wie bisher;
  mit einer Anlage und freien Schlüsseln rät er, die Rechnung als Lieferung einzutragen.
- Ablesungen des Versorgungszählers in einer abgeschlossenen Heizperiode und Lieferungen, von denen
  eine abgeschlossene Heizperiode einen Teil eingefroren hat, lassen sich erst nach dem Wiederöffnen
  ändern; eine Heizanlage mit Lieferungen lässt sich erst entfernen, wenn die Lieferungen entfernt
  sind. Ebenso bleibt die letzte Position einer solchen Lieferung mit ihr verknüpft, und die
  Gradtagzahlen des Orts für Monate einer abgeschlossenen Heizperiode bleiben, wie sie sind.
- Wird eine Rechnung nach dem Abschluss einer Heizperiode storniert oder auf 0 € gesetzt, sperrt
  Mietfuchs nichts: Der Teil, den die Mieter der abgeschlossenen Abrechnung zu viel getragen haben,
  steht beim Vermieter, und eine Warnung nennt den Betrag und rät, jene Abrechnung wieder zu öffnen und
  neu abzuschließen; das gilt auch, wenn jene Abrechnung mit einer Schätzung abgeschlossen wurde. Die
  stornierte Rechnung deckt danach keine Tage mehr ab, die Lücke wird wieder gemeldet; ein Hinweis nennt
  die Rechnung und rät, eine echte Rechnung über 0 € nicht zu schätzen.
  Wurde die Position einer Rechnung erst nach dem Abschluss ihrer Heizperiode mit der Lieferung
  verknüpft, sagt es ein Hinweis in der anderen Heizperiode.
- **Angekündigt: Hinweis bei Heizöl, Flüssiggas, Pellets, Holz und Kohle mit freien Schlüsseln.** Ohne
  Anfangs- und Endbestand sagt die Abrechnung, dass die Heizkosten nach Lieferung statt nach Verbrauch
  verteilt sind und das angreifbar ist; an den Zahlen ändert sich nichts, bis Sie den Vorrat eintragen
  ([#99](https://github.com/speedone/mietfuchs/issues/99)).
- Die Steuerübersicht nennt den Unterschied zum Eigenanteil der Abrechnung, der aus dem Vorrat kommt:
  Die Abrechnung rechnet nach Verbrauch, die Steuerübersicht nach Bezahltem.
- Der Vorrat und die Lieferungen einer abgeschlossenen Heizperiode lassen sich erst nach dem
  Wiederöffnen ändern; ebenso Einheit und Endbestand einer Heizperiode, deren Folgeperiode
  abgeschlossen ist, und, wenn diese den Endbestand übernommen hat, Menge, Lieferdatum und Verknüpfung
  der Lieferungen. Beträge bleiben änderbar.
- Beim ersten Vorrat nach einer Abrechnung nach Lieferungen fragt die Karte „Vorrat“, ob der
  Anfangsbestand schon umgelegt wurde; dann zählt er mit 0 €, damit die Mieter ihn nicht zweimal
  tragen. Ohne Antwort nimmt Mietfuchs das an, wenn im Vorjahr Brennstoff abgerechnet ist; stehen dort
  nur Heizkosten ohne Angabe, warnt die Abrechnung und nennt sie. Verteilt eine Heizperiode ohne
  Übertrag, geht ihr Endbestand mit 0 € weiter. Bleibt ein Bestand bei Ihnen hängen, nennt die
  Abrechnung den Betrag. Stehen im Vorjahr nur kleinere Heizkosten ohne Angabe, zählt der
  Anfangsbestand mit seinem Wert, und ein Hinweis bittet Sie, das zu prüfen.
- Im Kostenformular wählen Sie bei Heizkosten „Teil der Heizkosten“: Brennstoff/Energie, Betrieb,
  Ablesung oder ohne Angabe.
- **Grundlage für das Einlesen von Kontoauszügen.** Mietfuchs kann Kontoauszüge im Format camt
  lesen (camt.053, dazu camt.052 und camt.054, die Fassungen 001.02 bis 001.08) und im älteren
  Format MT940, wie es Sparkassen und Programme wie StarMoney als `.sta` ausgeben, auch mehrere
  in einem ZIP, noch ohne Oberfläche. Das Format wird am Inhalt erkannt. Nennt ein Auszug Anfangs-
  und Endsaldo, lässt sich prüfen, dass kein Umsatz fehlt. Beträge werden centgenau gelesen, eine Sammelbuchung wird in
  ihre Posten zerlegt, und jede Buchung trägt einen Fingerabdruck, an dem der spätere Import
  einen doppelt eingelesenen Auszug erkennt. Was sich nicht sicher lesen lässt (fremde Währung,
  Bruchteile eines Cents, ein abgeschnittener Download, eine beschädigte Datei im ZIP), wird
  gemeldet statt geraten ([#188](https://github.com/speedone/mietfuchs/issues/188)).

- Der Fehler „Mieter heizt selbst und hängt an Ihrer Heizanlage“ sagt bei einer zentralen Heizung, dass für einen
  Brennstoffvertrag beim Mieter keine Heizanlage angelegt wird, und nennt den Weg dorthin: Anlage entfernen, die
  Heizung neu einrichten und beim Liefervertrag den Mieter wählen. Dasselbe steht beim Ändern einer Gas-, Öl-,
  Flüssiggas- oder Kohleheizung in der Karte „Heizung“. Keine Zahl ändert sich
  ([#97](https://github.com/speedone/mietfuchs/issues/97)).

### Behoben

- **Wohnung mit Etagenheizung löschen.** Hingen an einer Wohnung Rechnungen ihrer Etagenheizung, scheiterte das
  Löschen mit einer Meldung über einen fehlenden Eintrag, oder die Rechnung verschwand samt kg CO₂ und CO₂-Kosten
  ohne Nachfrage mit der Wohnung. Jetzt sagt Mietfuchs vorher, welche Rechnungen an der Wohnung hängen, und
  löscht die Wohnung erst, wenn Sie die Rechnungen auf der Seite Heizkosten selbst gelöscht haben. Keine Zahl
  ändert sich.
- **Kein Hinweis auf eine CO₂-Kürzung, wenn der Mieter selbst heizt** ([#97](https://github.com/speedone/mietfuchs/issues/97)):
  Erfassten Sie Wartung oder Betriebsstrom einer Gastherme, deren Gasvertrag der Mieter hat, als „Heizung und
  Warmwasser“, nannte die Abrechnung eine Kürzung um 3 % nach § 7 Abs. 4 CO2KostAufG und eine nach § 12
  HeizkostenV. Darin stecken aber keine CO₂-Kosten des Vermieters, und für eine Gastherme in der Wohnung gilt die
  Heizkostenverordnung nicht. Steht das Mietverhältnis auf „Mieter heizt selbst“, entfallen beide Hinweise; der
  Hinweis ohne Heizanlage nennt diesen Weg. Keine Zahl ändert sich.
- **Vorschlag für die Vorauszahlung im Rumpfzeitraum ohne CO₂-Abzug** ([#215](https://github.com/speedone/mietfuchs/issues/215)):
  Teilte Mietfuchs die CO₂-Kosten bei freien Schlüsseln selbst auf, ging die Abzugszeile „CO₂-Anteil des
  Vermieters“ in einem Zeitraum unter einem Jahr nicht in den Vorschlag nach § 560 BGB ein; der Vorschlag war um
  den hochgerechneten Abzug zu hoch. Jetzt wird sie mit dem Faktor ihrer Heizpositionen hochgerechnet, wie beim
  Messdienst. Keine Zahl einer Abrechnung ändert sich, nur der Vorschlag.
- **Heizkosten: Schätzvorschlag aus einer zu kurzen Rechnung.** Den Vorschlag für eine fehlende
  Rechnung rechnet Mietfuchs aus der letzten Rechnung hoch. War das eine Rechnung über wenige
  Sommertage, ergab das beliebig hohe Beträge (gemessen: 50,00 € über zwei Julitage ergaben 54.400,00 €
  für den Rest der Heizperiode), und ein Klick beim Abschließen verteilte sie. Vorlage ist jetzt nur
  eine Rechnung, die mindestens 100 ‰ der Gradtage der Lücke abdeckt, sonst die nächstältere; gibt es
  keine, schlägt Mietfuchs nichts vor und sagt im Hinweis zur Lücke, warum
  ([#251](https://github.com/speedone/mietfuchs/issues/251)).
- **Heizkosten: Lieferung mit negativer Summe (Gutschrift ohne Rechnung).** Ergaben die Positionen
  einer Lieferung zusammen weniger als 0 €, rechnete Mietfuchs sie wie eine Rechnung: Sie deckte Tage
  ab, verdrängte dort eine Schätzung, diente als Vorlage für einen negativen Schätzvorschlag und
  zählte CO₂-Ausstoß. Jetzt belegt sie keinen Verbrauch und zählt dafür wie ein Storno; ihr Betrag
  mindert weiter die Heizkosten der Heizperioden ihres Zeitraums. Ein Hinweis nennt sie, und die
  Seite Heizkosten fragt „Was ist diese Gutschrift?“: einer anderen Lieferung zuordnen, Anleitung für
  den Zahlbetrag nach Abzug der Abschläge, oder bestätigen, dass die Rechnung nicht in Mietfuchs
  steht. Im Vorrat macht eine solche Lieferung die Bestandsrechnung ungültig, statt den Endbestand
  mit einem negativen Wert zu bewerten. Hatte eine abgeschlossene Heizperiode einen anderen Teil einer
  Rechnung eingefroren, als heute auf sie entfiele (Rechnung danach gemindert, auch bis unter 0 €,
  oder gestiegen), trugen die Mieter der offenen Heizperiode den Unterschied; mit Mieterwechsel waren
  das im gemessenen Fall 2.332,08 € zu viel für den Vormieter und ebenso viel zu viel Gutschrift für
  den Nachmieter. Jetzt tragen sie nur ihren heutigen Teil, der Unterschied steht beim Vermieter mit
  dem Hinweis, dass die Mieter der abgeschlossenen Abrechnung zu viel getragen haben, bzw. was sich
  dort nachfordern ließe. Dabei behoben: Eine teilweise abgedeckte, eingefrorene Schätzung wurde beim
  Abgleich ein zweites Mal gekürzt, sodass der Hinweis eine Nachforderung statt einer Gutschrift
  nennen konnte. Offene Abrechnungen mit solchen Lieferungen können sich dadurch ändern;
  abgeschlossene bleiben unverändert, die Abweichung zeigt die heutige Berechnung
  ([#251](https://github.com/speedone/mietfuchs/issues/251)).
- **Messdienst-Abrechnung mit Vorwegabzug: der CO₂-Anteil des Vermieters fehlte in der
  Steuerübersicht.** Die Anleitung „Fertige Abrechnung eines Messdienstes übernehmen“ ließ als
  Betrag den Gesamtbetrag der Abrechnung eintragen. Techem und ista ziehen den CO₂-Anteil, den der
  Vermieter trägt, aber meist schon vorher ab; dann ist dieser Gesamtbetrag um ihn zu niedrig, und
  der Anteil fehlte bei den Werbungskosten. Den Mietern wurde dabei nichts falsch berechnet. Die
  Anleitung sagt jetzt: Als Betrag gilt, was Sie bezahlt haben, also die Summe aller Nutzerbeträge
  für Heizung und Warmwasser (einschließlich Leerstand) plus den abgezogenen CO₂-Anteil. Der Teil,
  der auf eine selbstgenutzte Wohnung entfällt, gehört zu deren Betrag, und zwar wie ihn die
  Einzelabrechnung nennt; näherungsweise nur, wenn die Abrechnung gar keine Beträge je Wohnung
  nennt. Kaltwasser und weitere Nebenkosten
  derselben Abrechnung kommen als eigene Positionen. Weist die Abrechnung keinen CO₂-Anteil aus,
  rät die Anleitung zur Nachfrage beim Messdienst. Haben Sie eine Messdienst-Abrechnung mit
  Vorwegabzug schon erfasst, erhöhen Sie den Betrag der Position um den abgezogenen CO₂-Anteil und,
  wenn Sie selbst im Haus wohnen, den Betrag Ihrer Wohnung um deren Teil davon; die Beträge der
  Mieter bleiben
  ([#209](https://github.com/speedone/mietfuchs/issues/209)).
- **„Als PDF sichern“ in Safari scheitert nicht mehr.** Beim Drucken einer einzelnen
  Abrechnung oder der Steuerübersicht meldete Safari, die Datei existiere nicht. Safari meldet
  das Ende des Drucks schon, bevor das PDF fertig ist, und Mietfuchs setzte Dateinamen und
  Druckauswahl zu früh zurück. Aufgeräumt wird jetzt erst beim nächsten Klick oder Tastendruck.
  ([#286](https://github.com/speedone/mietfuchs/issues/286)).
- **Ein zweiter Start fasst die Daten nicht mehr an, solange Mietfuchs schon läuft.** Startete
  man Mietfuchs ein zweites Mal, etwa über das Startmenü, während es unsichtbar im Hintergrund
  lief, öffnete der zweite Start erst die Datenbank und bemerkte den belegten Port danach. Nach
  einem Update migrierte die neue Version so die Datei unter der noch laufenden alten und legte
  eine „Sicherung vor dem Update“ an, hinter der die alte Version weiterschrieb. Jetzt belegt
  Mietfuchs zuerst den Port und öffnet die Datenbank erst danach; läuft dort schon Mietfuchs,
  holt der zweite Start nur die Oberfläche nach vorn und lässt Datenbank, Sicherungen und eine
  vorhandene `db.json` unberührt. Das gilt auch für zwei gleichzeitige Starts. Solange Mietfuchs
  beim Start noch die Datenbank vorbereitet, antwortet `/healthz` mit 503 und
  `"status": "starting"`; alle anderen Anfragen warten, bis der Start fertig ist
  ([#244](https://github.com/speedone/mietfuchs/issues/244)).
- **Steuer: privater Teil beim Ausgleich des Betriebsstroms über dem Betrag** ([#268](https://github.com/speedone/mietfuchs/issues/268)):
  Stand bei einer Heizanlage neben der Rechnung eine Gutschrift mit anderem Schlüssel oder anderen Beteiligten,
  konnte der Eigenanteil an deren Heizkosten weit über 100 % liegen. Die Zeile „Betriebsstrom der Heizung,
  Ausgleich“ bekam dann einen privaten Teil über ihrem Betrag, auch mit falschem Vorzeichen (gemessen: Ausgleich
  −30,00 €, privat −262,50 €, abziehbar +232,50 €). Liegt der Eigenanteil außerhalb von 0 bis 100 %, gilt jetzt die
  Wohn- und Nutzfläche des Gebäudes (im Beispiel privat −15,00 €), und der Rechenweg sagt das. Die Abrechnung an die
  Mieter ändert sich nicht.
- **CO₂-Erstattung zum Verrechnen bei einem Mieter ohne Abrechnung verschwand still** ([#97](https://github.com/speedone/mietfuchs/issues/97)):
  Bekam ein Mieter, der selbst heizt, für den gewählten Zeitraum keine Abrechnung (Inklusivmiete oder Pauschale
  ohne Vorauszahlung, Wohnung außerhalb der Abrechnungseinheit), wurde eine dort zum Verrechnen eingetragene
  Erstattung weder verrechnet noch gemeldet (gemessen: 120,00 €, in keinem Jahr ein Hinweis). Jetzt lehnt das
  Speichern das mit einem Satz ab und verweist auf die Auszahlung (§ 6 Abs. 2 Satz 5 CO2KostAufG); ein schon
  vorhandener Eintrag bekommt in diesem Zeitraum einen Hinweis.
- **Kürzung nach § 12 HeizkostenV bei Rechnungen über das Kalenderjahr und Zeitraum Mai bis April** ([#208](https://github.com/speedone/mietfuchs/issues/208)):
  Den Anteil einer Gasrechnung, der über einen Übertrag in den vorigen Zeitraum gehört, sah der Hinweis nicht. Dort
  fehlte er ganz (auch der zur Fernablesung), im Zeitraum der Rechnung nannte er 15 % des ganzen Anteils (gemessen:
  270,00 € statt 126,90 €). Jetzt nennt jede Abrechnung 15 % dessen, was der Mieter in ihr trägt (im Beispiel
  143,10 € und 126,90 €). Keine Zahl der Abrechnung ändert sich, Mietfuchs zieht die Kürzung nicht selbst ab.
- **Vorschlag für die Vorauszahlung im Übergangsjahr zur getrennten Heizkostenabrechnung enthielt die Heizkosten** ([#217](https://github.com/speedone/mietfuchs/issues/217)):
  Die Betriebskostenabrechnung des Jahres, in dem die getrennte Heizkostenabrechnung beginnt, enthält noch die
  letzte Heizperiode davor. Der Vorschlag nach § 560 Abs. 4 BGB „Vorauszahlung für die übrigen Nebenkosten (ohne
  Heizung)“ rechnete sie mit (gemessen: 105,00 € statt 18,00 €), obwohl die Heizkosten künftig über die
  Heizvorauszahlung laufen. Jetzt bleiben die Heizkosten einer Anlage, die danach getrennt abgerechnet wird,
  außen vor. Keine Zahl der Abrechnung ändert sich, nur der Vorschlag.
- **Eigentumswohnung: CO₂-Karte fragte nach der Summe des ganzen Hauses** ([#97](https://github.com/speedone/mietfuchs/issues/97)):
  Rechnet die Gemeinschaft ab, steht in der Position der eigene Anteil laut Hausgeldabrechnung. Die Karte „CO₂-Kosten“
  fragte aber nach der „Summe der Kosten aller Nutzer“; wer die Summe des Hauses eintrug, bekam eine Probe, die
  nicht aufging, und der CO₂-Anteil wurde nicht gebucht. Jetzt fragt sie nach den Heizkosten Ihrer Wohnung laut
  Einzelabrechnung und dem CO₂-Anteil des Vermieters für Ihre Wohnung, setzt eine Nutzeinheit voraus, und Probe
  und Hinweise sprechen von der Abrechnung der Gemeinschaft statt vom Messdienst.
- **Wechsel in einen Rumpfzeitraum: Vorschlag für die Gasrechnung, den das Übernehmen ablehnte** ([#208](https://github.com/speedone/mietfuchs/issues/208)):
  Wechselte der Abrechnungszeitraum mitten im Jahr, schlug die Vorschau für eine mit einer Brennstoffrechnung
  verknüpfte Heizposition den Rumpf vor, obwohl sie in die Heizperiode gehört, in der die Rechnung endet; das
  Übernehmen lehnte genau diesen Vorschlag ab. Jetzt bietet die Vorschau nur diese Heizperiode an.
- **Kesseltausch bei getrennter Heizkostenabrechnung: Sperre mit Weg statt „kommt mit einer späteren Version“** ([#217](https://github.com/speedone/mietfuchs/issues/217)):
  Wurden die Heizkosten getrennt abgerechnet, lehnte Mietfuchs jeden Kesseltausch ab, auch wenn die getrennte
  Abrechnung schon vorher geendet hatte. Jetzt sperrt nur noch ein Tausch in einer getrennt abgerechneten
  Heizperiode oder davor, und die Meldung nennt den Weg: die getrennte Heizkostenabrechnung ab dieser Heizperiode
  ausschalten, dann den Tausch erfassen; die Heizkosten rechnet danach die Betriebskostenabrechnung ab. Eine
  getrennte Heizkostenabrechnung nach einem Kesseltausch kann Mietfuchs noch nicht.
- **„Vorauszahlung für die übrigen Nebenkosten (ohne Heizung)“ auch nach dem Ausschalten der getrennten Heizkostenabrechnung** ([#217](https://github.com/speedone/mietfuchs/issues/217)):
  Hatte ein Objekt je eine getrennte Heizkostenabrechnung, nannte jede spätere Betriebskostenabrechnung den Vorschlag
  nach § 560 Abs. 4 BGB „ohne Heizung“, auch wenn er die Heizkosten wieder enthielt (gemessen: 100,00 € aus 1.200,00 €
  Heizkosten). Jetzt hängt die Beschriftung daran, ob der Vorschlag dieser Abrechnung die Heizkosten auslässt.
- **IBANs werden beim Speichern geprüft.** Die Bankverbindung des Vermieters in den
  Einstellungen, die abweichende IBAN eines Objekts und die IBAN des Mieters nahmen jeden Text
  an; eine vertippte IBAN fiel erst auf, wenn eine Nachzahlung nicht ankam. Jetzt prüft Mietfuchs
  Länderkennung, Länge und Prüfziffer nach ISO 13616, und zwar beim Verlassen des Feldes und vor
  dem Speichern; die Meldung steht am Feld und sagt, was nicht stimmt. Leerzeichen, Bindestriche
  und Kleinbuchstaben sind erlaubt, gespeichert wird ohne Trennzeichen und in Großbuchstaben,
  angezeigt in Vierergruppen, auch auf der gedruckten Abrechnung. Ein leeres Feld bleibt erlaubt. Auch der Server lehnt eine neue
  oder geänderte ungültige IBAN ab. Eine schon gespeicherte ungültige IBAN wird nicht still
  geändert: Das Formular nennt sie als Hinweis, und andere Angaben lassen sich weiter speichern.
  Backup, Wiederherstellen und der Umstieg übernehmen IBANs unverändert und ohne Prüfung
  ([#279](https://github.com/speedone/mietfuchs/issues/279)).

## [0.10.1] – 2026-10-04

### Behoben

- **Eine Rundungsregel für jede Verteilung.** Bisher rundete die Abrechnung je nach Lage
  verschieden: Trugen die Mieter eine Rechnung ganz, nach dem Restcent-Verfahren, sonst jeder
  Mieter für sich, und der Vermieter bekam den Rest. Dabei konnten die Anteile der Mieter
  zusammen über dem Rechnungsbetrag liegen und der Vermieter bei −1 Cent stehen (1,00 € auf
  67/67/65 m² vermietet und 1 m² selbstgenutzt: 34 + 34 + 33 Cent), und Eigenanteil und §35a-Lohn
  wurden noch einmal getrennt gerundet und begrenzt. Jetzt wird jede Position einmal nach dem
  Restcent-Verfahren verteilt, über die Mieter und die Anteile des Vermieters (Eigennutzung,
  Leerstand, Pauschale und weitere Gründe) zugleich. Jeder Anteil ist sein rechnerischer Wert, auf-
  oder abgerundet; die Summe ist genau der Rechnungsbetrag, und kein Anteil des Vermieters wechselt
  das Vorzeichen. Bei gleichem Rest bekommt der Vermieter den Cent vor einem Mieter. Einen
  „Rundungsrest“ weist der Vermieteranteil nicht mehr aus. Der §35a-Lohnanteil wird in denselben
  Anteilen verteilt: Er liegt in keiner Zeile über dem Kostenanteil, und alle Zeilen zusammen
  ergeben genau den Lohnanteil der Rechnung. In offenen Abrechnungen kann sich dadurch ein
  Mieteranteil, ein Lohnanteil oder der Eigenanteil (auch in der Steuerübersicht) um einen Cent
  je Position verschieben. In der Aufschlüsselung des Vermieteranteils können größere Beträge
  zwischen Gründen wandern, bei gleicher Summe: Bei vereinbarten Anteilen, die zusammen mit
  Wohnungen außerhalb der Abrechnungseinheit über 100 % ergeben, steht der Leerstand jetzt voll
  da und „außerhalb der Abrechnungseinheit“ nur noch bis 100 %. Diese Zusagen („genau der
  Lohnanteil der Rechnung“, „höchstens ein Cent je Mieter und Position“, „kein Anteil des
  Vermieters wechselt das Vorzeichen“) gelten für widerspruchsfreie Daten; bei Datenfehlern, also
  sich überschneidenden Mietverhältnissen (siehe
  [#204](https://github.com/speedone/mietfuchs/issues/204)) oder einem rückwärts laufenden Zähler,
  kann sich mehr ändern, etwa der Eigenanteil auf seinen exakten Wert.
  Abgeschlossene Abrechnungen bleiben, wie sie sind; die Seite Abrechnung zeigt den Unterschied
  zur heutigen Berechnung als Abweichung.
  ([#202](https://github.com/speedone/mietfuchs/issues/202))
- **Überschneidende Mietverhältnisse einer Wohnung werden gemeldet.** War etwa der Auszug am
  30.09. eingetragen und der Nachmieter ab 01.09., bekamen beide für dieselben 30 Tage ihren vollen
  Anteil, und der Leerstand des Vermieters wurde negativ, ohne dass es irgendwo stand. Jetzt nennt
  die Abrechnung beide Mieter, den Zeitraum und den Betrag, den die Mieter dieser Wohnung im Jahr
  bei den betroffenen Positionen zusammen zu viel tragen (1.200 € Grundsteuer nach Fläche, die
  Wohnung mit 50 von 100 m²: 49,32 €), als Fehler mit „Hier beheben →“ zum Mietverhältnis. Das ist
  die Summe der Positionen, bei denen zu viel berechnet wird, kein Saldo: Bei anderen Positionen
  können die Mieter zugleich zu wenig tragen. Hängt der Betrag davon ab, welches der beiden Daten
  falsch ist, etwa beim Personenschlüssel oder neben einer Pauschale, stehen beide Beträge da, oder
  es heißt, dass die Mieter dadurch nicht zu viel tragen. Was bei Gutschriften zu viel
  gutgeschrieben wird, steht getrennt von den Kosten. Gerechnet wird weiter wie erfasst.
  Die Ampel „Hinweise der Berechnung“ im Cockpit wird bei jedem Hinweis der Stufe Fehler rot statt
  gelb, also auch bei den beiden bisherigen Fällen: Einzelbeträge über dem Rechnungsbetrag und
  vereinbarte Anteile über 100 %, bei denen eine Position gar nicht verteilt wird. Beim
  Speichern eines Mietverhältnisses, das sich mit einem anderen derselben Wohnung überschneidet,
  fragen die Stammdaten nach. Bestände mit Überschneidung bleiben ladbar und lassen sich wie
  bisher sichern und wiederherstellen; abgeschlossene Abrechnungen bleiben, wie sie sind.
  ([#204](https://github.com/speedone/mietfuchs/issues/204))
- **Cockpit beim ersten Start: keine Zahl offener Punkte ohne Liste.** Solange für das Jahr nichts
  erfasst ist, zeigt das Cockpit statt der Checkliste nur die Knöpfe zum Anfangen; die Zeile
  darüber nannte trotzdem „Noch 4 Punkte offen“, ohne dass irgendwo stand, welche. Sie nennt jetzt
  den ersten Schritt: Stammdaten anlegen, dann Belege erfassen.
  ([#180](https://github.com/speedone/mietfuchs/issues/180))
- **`/healthz` nach dem Umstieg.** Beim zweiten Start meldete der Umstieg „Es gibt noch keine
  db.json“, obwohl die frühere Datei als `db.json.abgeloest` daneben liegt. Jetzt steht dort, dass
  der Umstieg bereits erfolgt ist. ([#180](https://github.com/speedone/mietfuchs/issues/180))
- **Der Hinweis auf die Sicherung vor dem Update übersteht einen Neustart.** Bisher kannte ihn nur
  der Start, der die Datenbank aktualisiert hatte; wurde Mietfuchs neu gestartet, bevor Sie die
  Oberfläche geöffnet hatten (etwa in Docker), erfuhren Sie nichts von der Sicherung. Jetzt bleibt
  er stehen, bis Sie ihn mit „Verstanden“ schließen, dann auch in anderen Browsern. Gemerkt wird
  das in der Datei `sicherung-vor-update.json` im Datenordner. Außerdem nennt die Konsole die
  Sicherung beim Update mit vollem Pfad. Nach dem Umstieg aus einer `db.json` gibt es beides
  nicht: Die Sicherung davor wäre eine leere Datenbank, der Rückweg ist dort `db.json.abgeloest`.
  ([#180](https://github.com/speedone/mietfuchs/issues/180))
- **Lange Objektnamen in der Seitenleiste.** Die Auswahl „Objekt“ schnitt lange Namen ab. Der
  Name steht jetzt vollständig da und bricht bei Bedarf in die nächste Zeile um; der Tooltip
  bleibt. ([#180](https://github.com/speedone/mietfuchs/issues/180))
- **Ampel zum Vorjahr, wenn eine Rechnung in zwei Belegen kommt.** Zeilen, die dieselbe Schätzung
  ersetzen, rechneten bisher nur innerhalb eines Belegs gemeinsam. Kommt etwa die Wasserrechnung in
  zwei Belegen zu 700 € und 800 € gegen eine Schätzung von 1.500 €, zeigte jeder Beleg für sich eine
  Abweichung, als ersetze er die Schätzung allein (bei 1.400 € im Vorjahr −50 % und −43 %). Jetzt
  rechnen die offenen Zeilen aller Belege des Objekts zusammen, und beide zeigen dieselbe Zahl:
  +7 %. Derselbe Beleg zweimal hochgeladen zählt dabei nur einmal. ([#170](https://github.com/speedone/mietfuchs/issues/170))

## [0.10.0] – 2026-10-04

### Neu

- **Hinweis zur Fernablesbarkeit ab dem Abrechnungsjahr 2027.** Nicht fernablesbare Zähler und
  Heizkostenverteiler müssen bis zum 31.12.2026 nachgerüstet oder getauscht sein (§ 5 Abs. 3
  HeizkostenV); fehlt das oder fehlen die monatlichen Verbrauchsinformationen, darf der Mieter
  seinen Anteil an den Heizkosten um 3 % kürzen (§ 12 Abs. 1 HeizkostenV). Ab 2027 erinnert die
  Abrechnung einmal daran, sobald ein Mieter über die Heizung abgerechnet wird, auch bei einer
  Heizposition, die direkt einer vermieteten Wohnung zugeordnet ist. Einen Betrag nennt sie nicht,
  weil Mietfuchs nicht weiß, welche Geräte eingebaut sind; aus demselben Grund färbt der Hinweis
  die Ampel im Cockpit nicht gelb, und das Cockpit nennt nur noch die Hinweise, die etwas
  verlangen. Die Regel steht im Regelverzeichnis mit „gilt ab 01.01.2027“, der Rechtsstand ist der
  02.10.2026.
  ([#110](https://github.com/speedone/mietfuchs/issues/110))
- **Kosten aus dem Vorjahr übernehmen.** Auf der Seite Kosten listet „Aus 2025 übernehmen …“ die
  Positionen des Vorjahres im gewählten Objekt, mit Kostenart, Beschreibung (die Jahreszahl ist
  ersetzt), Rechnungssteller und dem Umlageschlüssel samt Teilnehmern, Anteilen, Zählertyp und
  Maßstab. Sie tragen je Zeile nur den neuen Betrag ein, bei einer Hausgeldabrechnung dazu die
  Kosten der Gemeinschaft; angelegt wird erst auf Knopfdruck, ohne Beleg und nie mit dem Betrag
  des Vorjahres. Positionen mit Einzelbeträgen je Mieter öffnen Sie dafür im Formular. Was im Jahr
  schon erfasst ist, wird nur nach Rückfrage noch einmal angelegt.
  ([#141](https://github.com/speedone/mietfuchs/issues/141))
- **Der Wechsel des Abrechnungsjahres fragt nach, wenn ein Formular offen ist**, wie schon der
  Wechsel des Objekts; sonst gingen Eingaben verloren oder landeten im falschen Jahr.
- **Der Umlageschlüssel wird je Kostenart gemerkt.** Eine neue Position bekommt den Schlüssel,
  den dieselbe Kostenart im Vorjahr hatte, im Formular wie bei der KI-Auswertung auf der Seite
  Kosten und in der Schnellerfassung; bei „Sonstige Betriebskosten“ nur von der Position mit
  derselben Beschreibung. Eine KI-Zeile, deren gemerkter Schlüssel nur einzelne Wohnungen trifft,
  ist hervorgehoben und nicht vorab angehakt. Weicht eine Position davon ab, weisen Formular und
  Abrechnung darauf hin, mit dem neuen Begriff „Wechsel des Umlageschlüssels“ (§ 556a Abs. 2
  und 3 BGB) im Lexikon. Bei einer Eigentumswohnung schlägt Mietfuchs ohne Vorjahr „laut
  Gemeinschaftsabrechnung“ vor (außer bei der Grundsteuer), und die Summe der
  Miteigentumsanteile steht nach der ersten Position nicht mehr an jeder weiteren neu an.
  ([#141](https://github.com/speedone/mietfuchs/issues/141))
- **Dieselbe Rechnung wird nicht mehr still zweimal erfasst.** Steht für das Jahr des Belegs
  schon eine Position derselben Kostenart, etwa aus dem Vorjahr übernommen mit geschätztem
  Betrag, legt die Schnellerfassung die Zeile nicht mehr vorab angehakt neu an, sondern bietet an,
  den Beleg mit der bestehenden Position zu verknüpfen (siehe den Eintrag zur Belegbuchung
  unten). Umgekehrt erkennt „Aus dem Vorjahr übernehmen“ eine schon per KI erfasste Rechnung auch
  dann, wenn die KI sie anders beschrieben hat. Bei „Sonstige Betriebskosten“ und „Nicht
  umlagefähig“ zählt nur eine Position mit ähnlicher Beschreibung oder vom selben
  Rechnungssteller. Die Abrechnung weist als Hinweis darauf hin, wenn zwei Positionen derselben
  Kostenart im Jahr stehen und eine davon keinen Beleg hat, und rät dann zum Löschen einer der
  beiden (nur den Beleg zuzuordnen ließe die Summe doppelt); die Ampel im Cockpit zählt ihn mit,
  wenn eine Position mit und eine ohne Beleg dasteht oder es mehr sind als im Vorjahr. Auch das
  Kostenformular fragt beim Anlegen nach, wenn dieselbe Rechnung schon erfasst sein könnte. Im
  Januar vergleicht die Schnellerfassung mit dem Jahr des Belegs statt mit dem gewählten. Eine
  Gutschrift gilt dabei nie als dieselbe Rechnung wie eine Rechnung derselben Kostenart (sonst
  riete der Hinweis, eine der beiden zu löschen), nur zwei Gutschriften können es sein.
  ([#141](https://github.com/speedone/mietfuchs/issues/141))
- **Belege werden auf dem Server gebucht, und eine Rechnung landet genau einmal in den Kosten.**
  Das Ergebnis einer KI-Auswertung wird gespeichert, mit Positionen, Beträgen und
  Rechnungssteller, und bleibt nach dem Neuladen erhalten: Der Posteingang zeigt „Weiter
  prüfen“, die Schnellerfassung die offenen Auswertungen des Objekts. Schnellerfassung, KI auf der
  Kostenseite und Posteingang benutzen dieselbe Prüfung und dieselbe Ampel: je Zeile neu
  anlegen, mit einer vorhandenen Position verknüpfen oder verwerfen (die Auswertung bleibt
  gespeichert), dann zeigt die Vorschau, was mit jeder Position geschieht, auch welche Zeilen
  verworfen werden, und „Buchen“ tut genau das. „Ausblenden“ auf der Kostenseite nimmt nur die
  Karte aus der Warteschlange; die Auswertung bleibt offen und steht in der Schnellerfassung.
  Die KI auf der Kostenseite schickt Objekt und Jahr mit, ein nicht gebuchter Beleg wartet
  deshalb im Posteingang des richtigen Objekts. Eine rote Zeile ist nicht vorab angehakt, und
  das Jahr aus dem Beleg geht dem gewählten vor; das gewählte bleibt dabei gespeichert, und weicht
  das Jahr aus dem Beleg davon ab (eine Jahresrechnung vom Februar, deren Leistungszeitraum die KI
  nicht gelesen hat), ist die Zeile gelb und nicht vorab angehakt, „Alle grünen übernehmen“ bucht
  sie nicht. Die Vorschau nennt das Jahr jeder neuen Position, und beide Seiten zeigen „Jahr …“ an
  einem Beleg aus einem anderen Jahr. Hängt ein Beleg oder ein Beleg gleichen Inhalts schon von
  Hand an einer Position, gilt sie für jede seiner Zeilen als mögliche Doppelung, gleich welcher
  Kostenart: Die Zeile ist rot, und angelegt wird sie nur nach ausdrücklicher Bestätigung. Ebenso
  jede Zeile, die beim erneuten Auswerten eines schon gebuchten Belegs dazukommt, etwa weil ein
  Betrag von Hand berichtigt war oder die KI die Rechnung anders aufteilt; sie nennt die schon
  gebuchten Positionen, und auch das Verknüpfen mit einer davon, das ihren Betrag erhöht,
  geschieht nur nach „Trotzdem verknüpfen“. Eine verknüpfte Position trägt die Summe aller Zeilen, die an ihr hängen,
  auch aus zwei Belegen wie Abschlag und Restrechnung; eine Schätzung aus dem Vorjahr wird mit
  Ansage ersetzt, ebenso ein §35a-Lohnanteil, den die Rechnung nicht nennt; die Ampel vergleicht
  dann den Stand nach dem Verknüpfen mit dem Vorjahr und zählt Schätzung und Rechnung nicht
  zusammen; ersetzen mehrere Zeilen eines Belegs dieselbe Schätzung, rechnen sie dabei gemeinsam
  und zeigen dieselbe Abweichung. Eine Gutschrift wird
  nie verrechnet und nie als Ziel angeboten. Doppelt klicken, neu laden oder eine Anfrage
  wiederholen bucht nichts zweimal: Was genau so gebucht ist, meldet Erfolg ohne Änderung; eine
  Abweichung oder ein Stand, der sich seit der Vorschau geändert hat, antwortet mit dem
  aktuellen Stand und einer neuen Vorschau, statt still anders zu buchen. Löst man eine Zeile,
  sagt die Vorschau, ob der Beleg der Position wechselt. Ändert das Verknüpfen oder „Betrag prüfen“
  im Belegordner den Betrag einer Position, deren Abrechnung schon abgeschlossen ist, sagen Vorschau
  und Kasten es: Die Abrechnung bleibt, wie sie verschickt wurde, und ändert sich der Saldo eines
  Mieters, zeigt die Abrechnungsseite das als Abweichung. Objekt und Jahr einer Auswertung sind
  nach der ersten Buchung fest; vorher ziehen Posteingang und Auswertung sie gegenseitig mit.
  Belegmappe und Steuer-ZIP nehmen auch Belege auf, die nur über eine gebuchte Zeile an einer
  Position hängen; die Karte im Belegordner zeigt die Summe der eigenen Zeilen, und der
  Hinweis auf eine mögliche doppelte Rechnung erscheint bei gleichen Beträgen an einer Position.
  ([#170](https://github.com/speedone/mietfuchs/issues/170))
- **Belegordner statt Belegarchiv.** Voreingestellt sind das gewählte Objekt und das
  Abrechnungsjahr, umschaltbar auf alle Objekte und alle Jahre. Je Kostenart gibt es ein Register
  mit Summe; jeder Beleg steht als Karte mit Vorschaubild, Rechnungssteller, Betrag, Rechnungsdatum
  (sofern die KI es gelesen hat) und den Positionen, an denen er hängt. Die Suche findet
  Rechnungssteller, Beschreibung, Betrag („128,40“), Dateinamen und Jahr. Doppelt hochgeladene
  Belege erkennt Mietfuchs am Inhalt (Prüfsumme), auch unter anderem Namen; der frühere Hinweis
  „gleiche Dateigröße“ entfällt. Der Eintrag steht in der Seitenleiste unter „Sammeln“.
  ([#170](https://github.com/speedone/mietfuchs/issues/170))
- **Belegabdeckung und „Beleg nachreichen“.** Der Belegordner zeigt je Objekt und Jahr, welcher
  Anteil der erfassten Kosten durch einen Beleg gedeckt ist, und an jeder Position ohne Beleg
  lässt sich einer hochladen oder aus dem Posteingang zuordnen. Das Cockpit führt dazu die Zeile
  „Belege vollständig“; sie wird höchstens gelb, denn ein fehlender Beleg ändert keine Zahl.
  ([#170](https://github.com/speedone/mietfuchs/issues/170))
- **Posteingang.** Belege lassen sich direkt im Belegordner hochladen, auch mehrere auf einmal
  oder per Ziehen. Sie liegen dann im Posteingang, mit Objekt und Jahr, und werden von dort einer
  Position zugeordnet oder per KI ausgewertet, ohne ein zweites Mal hochgeladen zu werden.
  Originalname und genaue Hochladezeit bleiben erhalten, auch über ein Backup hinweg; bisher
  verschob das Wiederherstellen die Anzeige um bis zu zwei Stunden. Nennt der Name eines Belegs
  eine Kostenart, stehen beim Zuordnen die passenden Positionen oben. Nach dem Zuordnen oder
  Nachreichen fragt der Belegordner nach dem Betrag der Position, denn eine aus dem Vorjahr
  übernommene trägt oft noch einen geschätzten. Bei Einzelbeträgen, „laut Gemeinschaftsabrechnung“
  oder einem Lohnanteil über dem neuen Betrag öffnet sich dafür die Position im Formular. „Per KI
  auswerten“ führt in dieselbe Prüfung wie die Schnellerfassung.
  ([#170](https://github.com/speedone/mietfuchs/issues/170))
- **Mappen packen.** „Belegmappe für Mieter“ erstellt je Objekt und Jahr eine PDF mit den Belegen
  der umgelegten Positionen in der Reihenfolge der Abrechnung und einem Deckblatt „Position →
  Beleg, Seite“, für die Belegeinsicht, die seit 2025 auch elektronisch gewährt werden darf
  (§ 556 Abs. 4 BGB). Belege mit Einzelbeträgen je Mieter, etwa die Abrechnung eines
  Messdienstes, und zu Positionen, die nur einzelne Mieter betreffen (Direktzuordnung,
  Teilnehmer), kommen wegen der Daten anderer Mieter nur auf ausdrückliche Wahl hinein. Ein
  Beleg, der sich nicht übernehmen lässt, steht auf dem Deckblatt mit dem Hinweis, ihn gesondert
  beizulegen.
  „Belege für die Steuer“ lädt ein ZIP aller Belege des Jahres, geordnet nach den Gruppen der
  Anlage V, einschließlich der nicht umlagefähigen, mit einer Übersicht als CSV.
  ([#170](https://github.com/speedone/mietfuchs/issues/170))
- **Steuerübersicht: Werbungskosten bei teilweiser Eigennutzung aufgeteilt.** Wohnen Sie selbst
  im Haus, zeigt die Übersicht als Hauptzahl die abziehbaren Werbungskosten und daneben den
  privaten Teil. Jede Position ist aufgeteilt: Was einer Einheit direkt zugeordnet ist, gehört
  ganz zu ihr; Kosten des ganzen Gebäudes werden nach dem Verhältnis der Wohn- und Nutzflächen
  aufgeteilt (BFH, Urteil vom 24.06.2008, IX R 26/06); bei umlagefähigen Kosten gilt der
  Eigenanteil aus der Nebenkostenabrechnung, bei abgeschlossener Abrechnung ihr eingefrorener
  Stand, soweit eine Position seither nicht nachgetragen oder geändert wurde. Gibt es Einheiten
  außerhalb der Abrechnungseinheit, etwa ein getrennt abgerechnetes Gewerbe, gilt auch für
  umlagefähige Kosten die Fläche des ganzen Gebäudes. Die Tabelle nennt je Position Gesamtbetrag, privat, abziehbar und die Zuordnung wie im
  Vordruck („direkt“ oder anteilig mit dem abzugsfähigen Anteil in Prozent), mit Rechenweg zum
  Aufklappen; der Ausdruck taugt als gesonderte Aufstellung für das Finanzamt. Hinweise nennen,
  was nicht gerechnet wird (AfA, Schuldzinsen, § 82b EStDV, verbilligte Vermietung), und
  beziffern den Unterschied, wo die Abrechnung nicht nach Fläche verteilt. Die Übersicht im ZIP
  „Belege für die Steuer“ nennt je Position ebenso den privaten und den abziehbaren Teil, mit
  denselben Summen wie die Steuerübersicht. Ohne selbstgenutzte Wohnung ändert sich keine Zahl.
  ([#163](https://github.com/speedone/mietfuchs/issues/163))
- **Kosten: „Nicht umlagefähig“ lässt sich für die Steuer einer Einheit zuordnen.** Die Auswahl
  „Betrifft (für die Steuer)“ ordnet etwa eine Badrenovierung der vermieteten Wohnung (voll
  abziehbar) oder der eigenen Wohnung (privat) zu, oder eine Dachreparatur nur den Einheiten des
  betroffenen Gebäudeteils; ohne Auswahl gilt das ganze Gebäude. Die
  Nebenkostenabrechnung bleibt davon unberührt.
  ([#163](https://github.com/speedone/mietfuchs/issues/163))
- **Anleitungen je Vermietungsart auf „Hilfe & Begriffe“.** Für acht Lagen sagt Mietfuchs, wie
  Sie sie anlegen und was daraus wird: Haus mit Einliegerwohnung, Mehrfamilienhaus, vermietete
  Eigentumswohnung mit Hausgeldabrechnung, mehrere Objekte, Garage oder Stellplatz, Pauschale
  oder Inklusivmiete, die fertige Abrechnung eines Messdienstes und Mieterwechsel mit Leerstand.
  Jede Anleitung nennt, ob sie auf Sie zutrifft, die Schritte mit einem Knopf zur passenden Seite,
  ein nachgerechnetes Beispiel, worauf Sie rechtlich achten müssen (mit Norm) und was Mietfuchs
  noch nicht kann (mit Verweis auf das Issue). Die Suche der Seite findet Anleitungen und Begriffe
  und klappt die Treffer auf.
  ([#164](https://github.com/speedone/mietfuchs/issues/164))

### Geändert

- **Lexikon: Abrechnungsfrist bei verspätetem oder angefochtenem Grundsteuerbescheid.** Liegt der
  Bescheid ohne Ihr Verschulden noch nicht vor, oder haben Sie gegen ihn, den Grundsteuerwert-
  oder den Messbescheid Einspruch eingelegt, dürfen Sie mit der Grundsteuer warten, bis der
  endgültige Bescheid da oder über den Einspruch entschieden ist. Das Übrige rechnen Sie
  fristgerecht ab und behalten sich die Grundsteuer ausdrücklich vor; gefordert wird sie im
  Regelfall innerhalb von drei Monaten danach (BGH, Urteil vom 20.05.2026, VIII ZR 6/24). Bei der
  Heizkostenverordnung nennt das Lexikon die Nachrüstfrist für fernablesbare Geräte zum
  31.12.2026.
  ([#110](https://github.com/speedone/mietfuchs/issues/110))
- **Der Überschuss der Steuerübersicht rechnet mit den abziehbaren Werbungskosten.** Bisher zog
  er bei teilweiser Eigennutzung die vollen Kosten ab und fiel um den privaten Anteil zu niedrig
  aus. Für bestehende Daten: Wer eine selbstgenutzte Wohnung angelegt hat, sieht für vergangene
  Jahre einen höheren Überschuss; eine Zahl, die schon in einer Steuererklärung steht, gleichen
  Sie bitte mit Ihrem Steuerberater ab. Ältere Positionen „Nicht umlagefähig“ ohne Zuordnung
  gelten als Kosten des ganzen Gebäudes, bis Sie sie einer Einheit zuordnen. Trägt eine Position
  aus einer älteren Version schon eine Zuordnung, gilt diese; die Steuerübersicht weist darauf hin
  (siehe *Hinweise zur Aktualisierung*).
  ([#163](https://github.com/speedone/mietfuchs/issues/163))

### Behoben

- **§35a-Bescheinigung: je Mieter wie von Hand gerundet.** Der Lohnanteil, den die Abrechnung je
  Mieter bescheinigt, ging vom schon auf Cent gerundeten Kostenanteil aus und konnte so einen Cent
  zu niedrig sein (etwa 45,20 € statt 300 € × 55/365 = 45,21 €). Jetzt wird er je Mieter so
  gerundet, wie man ihn von Hand nachrechnet, Lohnanteil × ungerundeter Kostenanteil ÷
  Rechnungsbetrag, und liegt nie über dem Kostenanteil des Mieters. Ist eine Rechnung ganz Lohn,
  ist der bescheinigte Lohnanteil genau sein Kostenanteil (etwa 109,15 € bei 109,15 €). Ergäben
  die gerundeten Lohnanteile zusammen mehr als den Lohnanteil der Rechnung, bekommen einzelne
  Mieter je einen Cent weniger. Tragen die Mieter die Rechnung ganz, ergeben ihre Lohnanteile
  zusammen genau den Lohnanteil der Rechnung, und einzelne Mieter können dafür einen Cent mehr oder
  weniger bekommen als von Hand gerundet. Jede solche Abweichung nennt der Rechenweg an der Zeile,
  mit dem rechnerischen Wert, ebenso einen auf den Kostenanteil begrenzten Lohnanteil. **Es ändert
  sich nur der §35a-Ausweis**, in noch offenen Abrechnungen um höchstens einen Cent je Mieter und
  Position; Kostenanteile, Nachzahlungen und Guthaben, Vermieter- und Eigenanteil sowie die
  Steuerübersicht bleiben unverändert. Abgeschlossene Abrechnungen bleiben, wie sie verschickt
  wurden.
  ([#180](https://github.com/speedone/mietfuchs/issues/180))
- **Stammdaten: Die Tabelle „Mietverhältnisse“ passt in ihre Karte.** „Mieterwechsel“, ✎ und 🗑
  waren auch auf großen Bildschirmen nur durch waagrechtes Scrollen erreichbar. Jetzt brechen
  Kopfzeilen, Staffeln und Aktionen um; am Handy ist die Tabelle deutlich schmaler.
  ([#180](https://github.com/speedone/mietfuchs/issues/180))
- **Texte: Ein- und Mehrzahl, Aufzählungen und Anführungszeichen.** Statt „Wohnung(en)“,
  „Mietverhältnis(se)“, „Position(en)“ oder „Belegdatei(en)“ stehen in Cockpit, Abrechnung und
  Kosten die passenden Formen; eine Garage ohne Fläche heißt im Hinweis „Einheit“ statt
  „Wohnung“. Aufzählungen in Hinweisen enden mit „und“, auch die Positionen beim Hinweis „Einheit
  ohne Fläche“. Die Zählerwarnung nennt die Zählerart mit ihrer Beschriftung („Kaltwasser“ statt
  „kaltwasser“). Anführungszeichen schließen typografisch („…“ statt „…"), etwa in den Warnungen zu
  Kabel und Heizung, auf der Zählerseite und in den Fragen vor dem Wiederherstellen und Löschen.
  Ebenso „1 grüner Vorschlag bereit“ in der Schnellerfassung, „ein Modell steht zur Wahl“ in den
  KI-Einstellungen und „(1 Tag)“ im Zeitraum auf der Abrechnung; im Belegordner fehlte nach dem
  Betrag der Position ein Leerzeichen vor „Stimmt er …“.
  Abgeschlossene Abrechnungen behalten ihren Wortlaut.
  ([#180](https://github.com/speedone/mietfuchs/issues/180),
  [#142](https://github.com/speedone/mietfuchs/issues/142))
- **Belegordner: Löschen eines Verzeichnisnamens antwortet „nicht gefunden“** statt mit einem
  Serverfehler. Gelöscht wurde auch vorher nichts.
  ([#180](https://github.com/speedone/mietfuchs/issues/180))

### Hinweise zur Aktualisierung

- Die Datenbank bekommt beim ersten Start drei Tabellen dazu: Angaben zu Belegen (Migration
  `0012_belege`) und die gespeicherten Auswertungen (Migration `0013_belegbuchung`). Beim Update
  von 0.9.0 laufen beide Schritte in einem Start, davor legt Mietfuchs eine Sicherung
  `mietfuchs.sqlite.vor-0012_belege` an. Vorhandene Positionen und Belege brauchen nichts: Belege
  stehen weiter im Belegordner, ihre Angaben liest Mietfuchs aus der Datei, und für bestehende
  Positionen gilt weiter der Beleg an der Position. Backup und Wiederherstellen nehmen Angaben
  und Auswertungen mit.
  ([#170](https://github.com/speedone/mietfuchs/issues/170))
- Bis Version 0.8.0 speicherte das Formular auch bei „Nicht umlagefähig“ einen Umlageschlüssel,
  oft „direkt“ mit einer Wohnung. Wurde eine solche Position seitdem nicht neu gespeichert, gilt
  diese Wohnung jetzt als „Betrifft (für die Steuer)“: Die Kosten sind dann ganz privat (eigene
  Wohnung) oder ganz abziehbar (vermietete Wohnung) statt nach Fläche aufgeteilt. Gibt es eine
  selbstgenutzte Wohnung, nennt die Steuerübersicht jede Position „Nicht umlagefähig“, die
  bestimmten Einheiten zugeordnet ist. Betrifft eine davon das ganze Gebäude, wählen Sie unter
  *Kosten* bei „Betrifft (für die Steuer)“ „das ganze Gebäude (nach Fläche)“. Eine bewusste
  Zuordnung bleibt, wie sie ist.
  ([#163](https://github.com/speedone/mietfuchs/issues/163))

## [0.9.0] – 2026-10-02

### Neu

- **Nach einem Update sagt Mietfuchs, dass eine Sicherung angelegt wurde.** Hat der Start die
  Datenbank auf den neuen Stand gebracht, nennt die Oberfläche oben auf jeder Seite einmal die
  neue Version und den Namen der Sicherung im Datenordner (`mietfuchs.sqlite.vor-…`) und
  verweist auf die Anleitung, wie man zur vorigen Version zurückkommt. Der Hinweis lässt sich
  schließen und kommt beim nächsten Start nicht wieder. Nach dem Umstieg aus einer `db.json` und
  nach dem Wiederherstellen eines Backups erscheint er nicht, denn dort entsteht keine solche
  Sicherung.
  ([#154](https://github.com/speedone/mietfuchs/issues/154))
- **Steuerübersicht: Hinweise zu den Zeilen 24 und 20 der Anlage V.** Ist eine Inklusivmiete
  vereinbart, erinnert die Übersicht an das Kennzeichen „Nebenkosten nicht gesondert vereinbart“
  in Zeile 24, bei gemischten Verträgen mit dem Rat, den Eintrag zu klären; eine
  Betriebskostenpauschale ist nach dem Wortlaut der Zeile 20 den Umlagen zuzuordnen.
  ([#96](https://github.com/speedone/mietfuchs/issues/96))
- **Baujahr der Kabel- oder Antennenanlage am Objekt.** Wurde die Anlage ab dem 01.12.2021
  errichtet, waren die Gebühren für das TV-Signal nie umlagefähig, auch 2022 und 2023 nicht
  (§ 2 Satz 2 BetrKV). Tragen Sie das in den Stammdaten beim Objekt ein; die Abrechnung warnt dann
  in jedem Jahr bei der Kostenart „Kabel/Antenne“.
  ([#121](https://github.com/speedone/mietfuchs/issues/121))
- **Einheit ohne Anschluss.** An einer Wohnung oder Garage lässt sich angeben, für welche
  Zählertypen es keinen Anschluss gibt, etwa kein Wasser in der Garage. Beim Verbrauchsschlüssel
  gilt sie dann nicht als Wohnung ohne Zähler: Es gibt keine unzutreffende Warnung mehr, und der
  Rest des Hauptzählers zählt wieder als Eigenanteil, wenn nur Ihre eigene Wohnung keinen Zähler
  hat.
  ([#117](https://github.com/speedone/mietfuchs/issues/117))
- **Wiederöffnen verliert den verschickten Stand nicht mehr.** Öffnen Sie eine abgeschlossene
  Abrechnung wieder, bleibt der bisherige Stand unter „Frühere Abschlüsse dieses Jahres“ erhalten,
  mit Abschluss-, Versand- und Öffnungsdatum und den Salden je Mieter. So lässt sich eine
  Korrektur gegenüber Mieter und Finanzamt begründen.
  ([#56](https://github.com/speedone/mietfuchs/issues/56))
- **Abgeschlossene Jahre zeigen, wenn die heutige Berechnung abweicht.** Öffnen Sie die
  Abrechnung eines abgeschlossenen Jahres, rechnet Mietfuchs im Hintergrund neu und nennt je
  Mieter, ob sich der Saldo seit dem Abschluss verändert hat und zu wessen Gunsten. Zugunsten des
  Mieters ist eine Korrektur möglich und in der Regel geboten; zugunsten des Vermieters sagt der
  Hinweis, ob die Frist nach § 556 Abs. 3 BGB schon abgelaufen ist. Die verschickte Abrechnung
  bleibt dabei unverändert.
  ([#56](https://github.com/speedone/mietfuchs/issues/56))
- **Rechenweg auf Klick.** Unter jeder Zeile der Abrechnung zeigt „Rechenweg“ Schritt für
  Schritt, wie Ihr Anteil zustande kommt: Rechnungsbetrag, Umlageschlüssel, Anteil an der
  Verteilbasis, die Rechnung selbst und das gerundete Ergebnis, bei Bedarf mit dem Hinweis, wohin
  ein Restcent gegangen ist, und dem Lohnanteil nach § 35a. So können Sie jede Zahl nachvollziehen
  und einem Mieter erklären. Auf dem Ausdruck für den Mieter erscheint der Rechenweg nicht.
  ([#114](https://github.com/speedone/mietfuchs/issues/114))
- **Fachbegriffe erklären sich selbst.** In den Formularen sind Begriffe wie Umlageschlüssel,
  Miteigentumsanteile, Pauschale oder Eigenanteil gestrichelt unterstrichen; ein Antippen zeigt,
  was sie bedeuten, ein Beispiel mit Zahlen, die Rechtsgrundlage und ob Sie das überhaupt
  brauchen. Jeder Hinweis auf der Abrechnung nennt die passenden Begriffe, und die neue Seite
  „Hilfe & Begriffe“ sammelt alle zum Nachschlagen.
  ([#113](https://github.com/speedone/mietfuchs/issues/113))
- **Hinweise sagen, wie ernst sie sind und wo man sie behebt.** Auf der Seite Abrechnung steht
  jeder Hinweis jetzt mit Stufe (Fehler, Warnung, Hinweis) und kurzem Titel, und ein Knopf
  „Hier beheben →“ führt zur Seite, auf der man es ändert. Darunter nennt die Abrechnung ihren
  Rechtsstand: das Datum, auf dem Mietfuchs' Regeln stehen, und die Regeln, die im Jahr gelten.
  Beim Abschließen wird er mit eingefroren, eine spätere Rechtsänderung erklärt eine versandte
  Abrechnung also nicht rückwirkend anders.
  ([#112](https://github.com/speedone/mietfuchs/issues/112))
- **Mehrere Objekte in einer Installation.** Neben dem bisherigen Haus lassen sich weitere
  Objekte anlegen: weitere Mehrfamilienhäuser, vermietete Eigentumswohnungen,
  Einfamilienhäuser oder etwa ein Garagenhof. Jedes Objekt hat seine eigenen Wohnungen, Zähler
  und Kosten und damit eine eigene Abrechnung, ein eigenes Mietkonto und eine eigene
  Steuerübersicht. Das Objekt wählen Sie in der Seitenleiste über dem Abrechnungsjahr. Solange
  Sie nur ein Objekt haben, erscheint dort nichts, und für Sie ändert sich nichts: Nach dem
  Update steht Ihr bisheriger Bestand in „Objekt 1“, benannt wie bisher Ihr Haus, und durch die
  Objekte ergibt jede Abrechnung auf den Cent dieselben Zahlen (anders nur beim Wasser mit
  Hauptzähler, siehe unter „Behoben“ #116). Weitere Objekte legen Sie in den Stammdaten
  an. Dort kann ein Objekt auch einen abweichenden Vermieter, eine andere Bankverbindung oder
  Zahlungsfrist haben, etwa das Haus der Eltern oder einer Erbengemeinschaft; sonst gelten die
  Angaben aus den Einstellungen. ([#92](https://github.com/speedone/mietfuchs/issues/92))
- **Vermietete Eigentumswohnungen: Umlage laut Gemeinschaftsabrechnung.** Tragen Sie als Betrag
  Ihren Anteil aus der Hausgeldabrechnung ein und daneben Maßstab (etwa Miteigentumsanteile),
  Summe in der Anlage und Gesamtkosten. Die Abrechnung zeigt dem Mieter den Rechenweg
  („124 von 10.000 MEA · Gesamtkosten der Anlage 50.000,00 €“), und passt Ihr Betrag nicht zu
  den Angaben, weist Mietfuchs darauf hin. Die Miteigentumsanteile einer Wohnung stehen in den
  Stammdaten. ([#94](https://github.com/speedone/mietfuchs/issues/94))
- **Einzelbeträge je Mieter**, etwa aus der Heizkostenabrechnung von Techem, ista, Brunata oder
  Minol: Jeder Mieter trägt genau seinen Betrag, auch bei einem Wechsel unterm Jahr, und den Rest
  trägt der Vermieter. Fehlt für einen Mieter ein Betrag, sagt die Abrechnung es.
  ([#94](https://github.com/speedone/mietfuchs/issues/94))
- **Nur bestimmte Wohnungen beteiligen**: Unter „Weitere Optionen“ einer Kostenposition lässt
  sich festlegen, welche Wohnungen sie tragen, etwa der Aufzug nur für ein Haus.
  ([#94](https://github.com/speedone/mietfuchs/issues/94))
- **Pauschale, Inklusivmiete und Warmmiete.** Am Mietverhältnis lässt sich unter „Weitere
  Angaben“ festlegen, dass die Nebenkosten als Pauschale gezahlt werden oder in der Miete
  enthalten sind, getrennt für Heizung und Warmwasser. Ein solcher Mieter bekommt keine
  Abrechnung, sein Anteil bleibt beim Vermieter und zählt als Werbungskosten; die Seite
  Abrechnung nennt ihn unter „Ohne Abrechnung“. Ist für die Heizung eine Pauschale vereinbart,
  obwohl das Haus nicht das selbstbewohnte Zweifamilienhaus ist, weist Mietfuchs auf die
  Heizkostenverordnung hin. ([#93](https://github.com/speedone/mietfuchs/issues/93))
- **Kostenart „Heizung und Warmwasser“**, auch in der KI-Auswertung und in der
  Steuerübersicht. ([#93](https://github.com/speedone/mietfuchs/issues/93))
- **Vor jedem Update der Datenbank legt Mietfuchs eine Sicherung daneben**, als
  `mietfuchs.sqlite.vor-<Schritt>` im Datenordner. Lässt sie sich nicht anlegen, etwa weil die
  Platte voll ist, bleibt die Datenbank unverändert und Mietfuchs sagt, woran es liegt. Wie Sie
  damit zu einer älteren Version zurückkehren, steht in [MIGRATION.md](MIGRATION.md) unter „Zurück
  zu einer älteren Version“.
  ([#92](https://github.com/speedone/mietfuchs/issues/92))

### Geändert

- **Mietfuchs siezt jetzt durchgängig.** Cockpit, Schnellerfassung, Kosten, KI-Einstellungen,
  Update-Hinweis und einige leere Listen duzten, während Lexikon, Nutzungshilfe, Steuerübersicht
  und die Meldungen des Servers siezten.
  ([#142](https://github.com/speedone/mietfuchs/issues/142))

### Behoben

- **Personenschlüssel bei Leerstand: den Anteil der leeren Wohnung trägt der Vermieter.** Bisher
  hatte eine leerstehende Wohnung beim Schlüssel „Personen“ keine Personentage und fiel aus der
  Verteilbasis; ihr Anteil ging an die übrigen Mieter, anders als bei Fläche und Einheiten. Jetzt
  zählt jede Wohnung der Abrechnungseinheit für jeden Tag ohne Mietverhältnis mit einer Person,
  auch zwischen zwei Mietern, und dieser Anteil steht im Vermieteranteil als Leerstand. Den
  Grundsatz hat der BGH am Flächenschlüssel entschieden (Urteil vom 31.05.2006, VIII ZR 159/05);
  für den Personenschlüssel ist er nicht abschließend geklärt, nach BGH, Beschluss vom 08.01.2013,
  VIII ZR 180/12, kommt eine fiktive Person für die Zeit des Leerstands in Betracht. Die eine
  Person ist eine Auslegung von Mietfuchs; ein Hinweis an der Abrechnung sagt das, der Rechenweg
  nennt die Leerstandstage. Selbstgenutzte Wohnungen, Einheiten ohne Fläche und ohne Bewohner
  (Garage, Stellplatz, auch leer) sowie Wohnungen, die an der Position nicht teilnehmen, bleiben
  wie bisher; zu einer ganz leeren Einheit mit 0 m² gibt es einen Hinweis, falls sie doch eine
  Wohnung ist. Das Cockpit fragt bei einer leeren Einheit mit 0 m² entsprechend nach, statt eine
  Wohnfläche zu verlangen. Eine leere Garage mit eingetragener Fläche zählt als Leerstand.
  **Ihre Zahlen ändern sich**: In noch offenen Jahren mit einer Position nach Personen und einer
  zeitweise leeren Wohnung zahlen die Mieter weniger und Sie mehr. Wohnen Sie selbst im Haus, kann
  dabei der private Anteil (Eigenanteil) in der Steuerübersicht kleiner werden, denn der Anteil des
  Leerstands ist anders als der Eigenanteil als Werbungskosten abziehbar. Abgeschlossene Abrechnungen
  bleiben unverändert; die Seite Abrechnung zeigt dort wie bei jeder Änderung an, welcher Saldo
  sich nach heutiger Berechnung unterscheiden würde.
  ([#177](https://github.com/speedone/mietfuchs/issues/177))
- **Abrechnung: was beim Mieter auf dem Papier steht.** „(manuell angepasst)“ an der
  Vorauszahlung erscheint nur noch am Bildschirm. Statt „Abrechnung nach dem Abflussprinzip“, was
  nicht zutraf, steht dort „Abgerechnet werden die Kosten des Abrechnungsjahres …“. Wechselt die
  Personenzahl im Jahr, nennt die Kopfzeile den Bereich und die Personentage („1 bis 2 Personen
  (457 Personentage)“) statt nur des letzten Stands; gerechnet wird unverändert. „✎ anpassen“
  schließt jetzt auch mit Esc, Enter übernimmt. Nach dem Wiederöffnen nennt die Seite das
  Versanddatum der früheren Fassung, statt die Frist nach § 556 Abs. 3 BGB scheinbar neu laufen zu
  lassen. ([#142](https://github.com/speedone/mietfuchs/issues/142))
- **„Hier beheben →“ führt zum Eintrag, nicht nur zur Seite.** Ein Hinweis der Abrechnung öffnet
  die betroffene Kostenposition, Wohnung oder das Mietverhältnis zum Bearbeiten, klappt die
  Ablesungen des Zählers auf oder hebt die Zeile im Mietkonto hervor.
  ([#142](https://github.com/speedone/mietfuchs/issues/142))
- **Abrechnung und Steuer: Gründe, Beträge und Beschriftungen.** Die Spalte „Grund“ beim
  Vermieteranteil nennt je Position die tatsächlichen Gründe (etwa Eigennutzung, Leerstand,
  Betriebskostenpauschale, Inklusivmiete, Wohnung außerhalb der Abrechnungseinheit, Rest des
  Hauptzählers, Rest nach Einzelbeträgen, Rundungsrest), bei mehreren
  mit Betrag; vorher stand dort immer „Eigennutzung / Leerstand / Rundung / keine Verteilbasis“,
  und so bleibt es bei einer vorher abgeschlossenen Abrechnung. Die Warnung zum Kabelfernsehen
  nach 2024 nennt den Betrag, der auf die Mieter umgelegt ist. Ein aufgeklappter Begriff im
  Rechenweg steht unter der Zeile, statt den Wert darunter zu schieben. Die Kopfzeile endet ohne
  Adresse nicht mehr mit „·“. In der Steuerübersicht stehen Inklusivmieten (ganz oder teilweise)
  in einer eigenen Zeile statt unter „ohne Umlagen (Kaltmiete)“, und der Hinweis zu Zeile 24 bei
  gemischten Verträgen liest sich als ein Satz. Keine Summe ändert sich.
  ([#142](https://github.com/speedone/mietfuchs/issues/142))
- **Erfassen: Hinweis und Vorbelegungen.** Ist die Abrechnung des Jahres abgeschlossen, sagt die
  Kostenseite das oben und dass Änderungen als Abweichung angezeigt werden; bearbeiten lässt sich
  weiterhin. Im Formular der Kostenposition schlägt Wasser/Abwasser „nach Verbrauch“ (Kaltwasser)
  vor, wenn jede beteiligte Wohnung einen Kaltwasserzähler hat oder keinen Wasseranschluss; die
  Übernahme aus der KI-Belegauswertung schlägt weiter „nach Personenzahl“ vor. Eine neue Zahlung in einem früheren Jahr steht auf dem 31.12. dieses
  Jahres statt auf heute. Ein neues Mietverhältnis wählt die erste vermietbare Wohnung ohne
  laufendes Mietverhältnis vor statt einer selbstgenutzten.
  ([#142](https://github.com/speedone/mietfuchs/issues/142))
- **Stammdaten: was die Listen zeigen und was die Löschfrage sagt.** Die Liste der
  Mietverhältnisse kennzeichnet Pauschale und Inklusivmiete („Pauschale“, „inklusiv“, „kalt
  pauschal · Heizung abgerechnet“), die Wohnungsliste zeigt die Miteigentumsanteile. Die Frage
  vor dem Löschen einer Wohnung nennt mit Anzahl, was mitgelöscht wird: Mietverhältnisse, Zähler,
  Ablesungen, Zahlungen und Angaben an Kostenpositionen; direkt zugeordnete Rechnungen bleiben.
  ([#142](https://github.com/speedone/mietfuchs/issues/142))
- **Kostenposition: weniger Missverständliches.** „Nicht umlagefähig“ und „Zuführung
  Erhaltungsrücklage“ zeigen keine Schlüsselauswahl mehr, die Liste sagt „— trägt der Vermieter“;
  gerechnet wird unverändert; auch das Cockpit verlangt für sie keine Ablesungen und prüft ihretwegen
  nicht die Verteilbasis. „Summe in der Anlage“ heißt je Maßstab „Summe der
  Miteigentumsanteile in der Anlage (z. B. 1.000 MEA)“, „Summe der Wohnflächen …“ oder „Zahl der
  Einheiten …“. Beim Verbrauchsschlüssel ist der Zählertyp vorgewählt, wenn es nur einen gibt.
  Bei Einzelbeträgen heißt es „den Rest trägt der Vermieter“. Das Lexikon erklärt das Hausgeld
  (Vorschuss). ([#142](https://github.com/speedone/mietfuchs/issues/142))
- **Lexikon: Einliegerwohnung.** Der Begriff erklärt, wie man sie in Mietfuchs anlegt
  (eigene Wohnung selbstgenutzt, Hauszähler als Hauptzähler), was beim Eigenanteil, bei den
  Heizkosten (§ 2 HeizkostenV) und in der Anlage V daraus folgt; Stammdaten und Zählerformular
  verweisen darauf. ([#142](https://github.com/speedone/mietfuchs/issues/142))
- **Anschlüsse einer Einheit, positiv gefragt.** Statt „Kein Anschluss für“ fragt das
  Wohnungsformular unter „Weitere Angaben — Anschlüsse“, welche Anschlüsse die Einheit hat;
  angehakt heißt angeschlossen. Angeboten werden nur Zählerarten, die es im Objekt gibt, und eine
  Ausnahme steht in der Zusammenfassung und in der Wohnungsliste („ohne Wasseranschluss“).
  Gespeichert wird wie bisher nur die Ausnahme, bestehende Angaben gelten unverändert.
  ([#142](https://github.com/speedone/mietfuchs/issues/142))
- **Zähler: Endstand, Datum und Einheit.** Fehlt beim Zählerwechsel der Endstand, steht in der
  Tabelle „Endstand alt: fehlt“ statt einer Lücke. Die Meldungen zu Ablesungen nennen das Datum
  deutsch („am 01.07.2025“). Die Einheit eines neuen Zählers folgt seiner Sparte: kWh für Wärme
  und Strom, m³ für Wasser, bei Sonstigem leer statt „m³“.
  ([#142](https://github.com/speedone/mietfuchs/issues/142))
- **Backup: Name und Datum der Belege.** Die Datei heißt `mietfuchs-backup-….zip` statt
  `nebenkosten-backup-….zip`. Nach dem Wiederherstellen tragen Belege wieder ihr ursprüngliches
  Datum statt des Tages der Wiederherstellung.
  ([#142](https://github.com/speedone/mietfuchs/issues/142))
- **Ein Jahr ohne Kosten kündigt kein Guthaben mehr an.** Cockpit und Übersicht zeigten für ein
  Jahr ganz ohne Kosten die volle Vorauszahlung als voraussichtliches Guthaben und im Vergleich
  zum Vorjahr überall „−100 %“. Jetzt steht dort „Noch keine Kosten … erfasst“, verglichen wird
  erst, wenn das Jahr Kosten hat. ([#142](https://github.com/speedone/mietfuchs/issues/142))
- **Der Fuß der Seitenleiste steht am unteren Fensterrand.** „Design“, „Mietfuchs beenden“ und
  der Satz zur lokalen Ablage lagen auf langen Seiten erst nach langem Scrollen im Bild; jetzt
  bleibt die Seitenleiste stehen, ihr Fuß steht bei jeder Fensterhöhe unten, und nur die
  Navigation darüber scrollt. Am Handy gibt es die Umschaltung des Designs wieder, als kleinen
  Knopf „🌗“.
  ([#142](https://github.com/speedone/mietfuchs/issues/142))
- **Ein weiteres Objekt anzulegen sieht nicht mehr aus, als wären die Daten weg.** „Weiteres
  Objekt anlegen“ öffnet jetzt einen eigenen Dialog: Er erklärt, was ein Objekt ist, sagt, dass
  das bisherige unverändert bleibt, fragt Name, Art und Adresse mit Beschriftung ab, und der Knopf
  „Anlegen und zu „…“ wechseln“ kündigt den Wechsel an. Im neuen, noch leeren Objekt steht oben
  auf jeder Seite ein Hinweis, dass es noch keine Wohnungen hat und die Daten im vorigen Objekt
  unverändert sind, mit den Knöpfen „Zurück zu „…““ und „Wohnungen anlegen“. Ab zwei Objekten
  nennt der Seitenkopf jeder Seite das gewählte Objekt, der Umschalter in der Seitenleiste bleibt
  auch am Handy mit „Objekt“ beschriftet, und der Abschlussdialog der Abrechnung nennt das Objekt.
  Bei einer Eigentumswohnung bitten die Stammdaten nur noch um die eigene Wohnung statt um alle
  Wohnungen des Hauses.
  ([#157](https://github.com/speedone/mietfuchs/issues/157))
- **Der Mieterwechsel wird ganz oder gar nicht gespeichert.** Der Assistent in den Stammdaten
  speicherte Auszug, Zwischenablesungen und neues Mietverhältnis nacheinander. Scheiterte der
  letzte Schritt, etwa an einer ungültigen Vorauszahlung, war das alte Mietverhältnis schon
  beendet und die Ablesungen standen da; ein zweiter Versuch legte sie doppelt an. Jetzt geht der
  Wechsel in einem Schritt, die Meldung bleibt im Assistenten stehen, und ein doppelt abgeschickter
  Wechsel legt nichts zweimal an. Zählerstände liest der Assistent wie die Zähler-Seite („1.234“
  ist 1234). Eine unlesbare Kaltmiete oder Vorauszahlung und ein negativer Zählerstand werden
  jetzt im Assistenten gemeldet, statt still wegzufallen. ([#150](https://github.com/speedone/mietfuchs/issues/150))
- **Ein leeres Feld bei der Ablesung ist kein Zählerstand 0 mehr.** Blieb auf der Zähler-Seite der
  Zählerstand leer, speicherte Mietfuchs eine 0; jetzt kommt eine Meldung. Bleibt beim
  Zählerwechsel der Endstand des alten Geräts leer, wird er als fehlend gespeichert und nicht als
  0, damit der Hinweis „Endstand fehlt“ erscheint, statt dass ein falscher Verbrauch Kosten
  zwischen Mietern verschiebt. Zählerstände werden außerdem wie alle Mengen gelesen: „1.234“ ist
  1.234 und nicht 1,234, auf der Zähler-Seite wie in der Schnellerfassung; einen vom Foto gelesenen
  Stand zeigt die Schnellerfassung in deutscher Schreibweise an. Prüfen Sie bitte Ablesungen mit
  Zählerwechsel und dem Endstand 0.
  ([#149](https://github.com/speedone/mietfuchs/issues/149))
- **Ein Objektwechsel speichert nichts mehr ins falsche Haus.** Wechselten Sie das Objekt,
  während ein Formular offen war, landete der Eintrag still im anderen Objekt, etwa eine Zahlung
  beim Mieter des vorigen Hauses, wo sie die Steuerübersicht verändert. Jetzt fragt Mietfuchs vor
  dem Wechsel nach. Wechseln Sie, wird das Formular ohne Speichern geschlossen; brechen Sie ab,
  bleiben Objekt, Formular und Eingaben, wie sie waren; ebenso mit Esc. Dasselbe gilt für
  angefangene Ablesungen, den Mieterwechsel, noch nicht übernommene Belegauswertungen,
  ungespeicherte Änderungen an der Objektkarte und in den Einstellungen sowie für den Wechsel
  nach „Weiteres Objekt anlegen“. Wer schnell hin und her wechselt, sieht keine Wohnungen des
  anderen Objekts mehr.
  ([#145](https://github.com/speedone/mietfuchs/issues/145))
- **Lehnt Mietfuchs das Speichern ab, steht jetzt da, warum.** Bei Kosten, Zählern und
  Ablesungen, Zahlungen, Wohnungen und Mietverhältnissen blieb der Dialog bisher wortlos offen,
  und der Grund stand nur in der Browser-Konsole. Jetzt erscheint er im Dialog, und Ihre Eingaben
  bleiben stehen. Dasselbe gilt beim Löschen, beim Abschließen und Wiederöffnen einer Abrechnung,
  bei der Korrektur der gezahlten Vorauszahlung, den Einstellungen und beim Übernehmen
  ausgewerteter Belege. Eine Meldung verschwindet, sobald Sie ein Formular öffnen oder schließen,
  und steht nicht mehr an einer Stelle, zu der sie nicht gehört.
  ([#146](https://github.com/speedone/mietfuchs/issues/146))
- **Gutschriften lassen sich im Kostenformular erfassen.** Ein negativer Betrag wie „-54,00“
  wird angenommen, auch mit dem typografischen Minus „−“, etwa aus einem kopierten Text. Ein
  Betrag von 0 € wird weiterhin abgelehnt, und die Meldung sagt jetzt, was am Betrag nicht
  stimmt. Eine Gutschrift trägt keinen §35a-Lohnanteil und lässt sich nicht nach Einzelbeträgen
  verteilen; das Formular sagt beides. Dieselbe Regel gilt beim Übernehmen ausgewerteter Belege in
  der Schnellerfassung und bei den Kosten: Eine Gutschrift wird übernommen und ist in der Vorschau
  gelb als Gutschrift markiert; eine Position mit 0 € fällt nicht mehr still weg, sondern ist als
  nicht übernehmbar gekennzeichnet und nicht vorab angehakt. „Alle grünen übernehmen“ übernimmt
  nur die grünen Positionen; bleiben angehakte gelbe oder rote übrig, etwa eine Gutschrift, bleibt
  der Beleg offen, und ein Hinweis nennt, was noch zu prüfen ist.
  ([#139](https://github.com/speedone/mietfuchs/issues/139))
- **„Sonstiges“ statt „Sonstig“.** Die Zählerart und die Kästchen „Kein Anschluss für“ heißen
  jetzt „Sonstiges“, passend zu Kaltwasser und Wärme. Gespeichert wird unverändert derselbe Wert.
  ([#138](https://github.com/speedone/mietfuchs/issues/138))
- **Steuerübersicht zählte ungültige §35a-Lohnanteile mit.** Einen Lohnanteil unter 0, über dem
  Rechnungsbetrag oder an einer Gutschrift bescheinigt die Abrechnung nicht und warnt; die
  Steuerübersicht addierte ihn trotzdem. Beide wenden jetzt dieselbe Regel an.
  ([#148](https://github.com/speedone/mietfuchs/issues/148))
- **Rechenweg „laut Gemeinschaftsabrechnung“ rechnet den Anteil vor.** Er beginnt jetzt mit den
  Kosten der Gemeinschaft und dem Schritt „Anteil an der Gemeinschaft: 85,4 von 1.000 MEA ×
  6.000,00 € = 512,40 €“, nennt einen davon abweichenden angesetzten Betrag und erst dann die
  Verteilung auf die Wohnungen des Vermieters („Anteil Ihrer Wohnung daran“ statt „Anteil an Ihren
  Wohnungen“). Auf der Abrechnung heißt die Spalte bei solchen Positionen „Gesamtkosten bzw.
  Anteil an der Gemeinschaft“, die Zeile sagt, welches von beiden sie zeigt, und die Verteilung
  nennt „Kosten der Gemeinschaft“ statt „Gesamtkosten der Anlage“; weicht der Betrag ab, steht
  „angesetzt laut Hausgeldabrechnung“ auch im Druck. Im Kostenformular ist der rechnerische Anteil
  markiert, wenn er um mehr als 1 € vom Betrag abweicht.
  ([#144](https://github.com/speedone/mietfuchs/issues/144))
- **Heizkosten nur nach Fläche verteilt: jetzt mit Hinweis auf § 12 HeizkostenV.** Wird für eine
  Wohnung keine Heizposition nach Verbrauch verteilt (weder nach Zählern noch als Einzelbeträge
  des Messdienstes noch laut Gemeinschaftsabrechnung; eine Gutschrift oder eine Verbrauchsposition
  ohne Ablesungen zählt dabei nicht), nennt die Abrechnung je Mieter den Betrag,
  um den er seinen Anteil kürzen darf: 15 Prozent (§ 12 Abs. 1 HeizkostenV), denn die Verordnung
  verlangt 50 bis 70 Prozent nach Verbrauch (§ 7 Abs. 1, § 8 Abs. 1). Grundkosten nach Fläche
  neben einer Verbrauchsposition sind der Regelfall und kein Mangel; liegt der Anteil nach Zählern
  dann außerhalb von 50 bis 70 Prozent, gibt es einen Hinweis ohne Betrag. Eine Direktzuordnung
  (etwa die Wartung einer Gastherme) zählt nicht als Verteilung. Im Haus mit höchstens zwei
  Wohnungen, von denen Sie eine selbst bewohnen, darf anderes vereinbart werden (§ 2); dort gibt
  es statt des Betrags einen Hinweis, und eine Einheit ohne Fläche und ohne Bewohner (Garage,
  Stellplatz) zählt dabei nicht als Wohnung, auch nicht
  für die Warnung zur Warmmiete. Mieter mit Pauschale oder Warmmiete bekommen keine
  Heizkostenabrechnung und deshalb keinen Betrag. Das Cockpit meldet in diesem Fall nicht mehr
  „Ablesungen nicht erforderlich“.
  Eine Einheit ohne Wärmeanschluss oder eine Garage ohne Fläche und Bewohner bekommt weder die
  Warnung zur Warmmiete noch einen Kürzungsbetrag.
  ([#140](https://github.com/speedone/mietfuchs/issues/140))
- **Zuführung zur Erhaltungsrücklage zählte als Werbungskosten.** Bei einer vermieteten
  Eigentumswohnung ist sie erst abziehbar, wenn und soweit die Gemeinschaft das Geld für
  Erhaltungsmaßnahmen ausgibt (BFH, Urteil vom 14.01.2025, IX R 19/24). Dafür gibt es jetzt die
  Kostenart „Zuführung Erhaltungsrücklage“: nicht umlagefähig wie bisher, in der Steuerübersicht
  aber neben den Werbungskosten ausgewiesen, und ohne §35a-Lohnanteil. Heißt eine Position „Nicht
  umlagefähig“ nach einer Zuführung zur Rücklage (nicht nach einer Entnahme), weist die
  Steuerübersicht darauf hin; bei einer Eigentumswohnung erklärt sie zudem, dass abgeflossen das
  gezahlte Hausgeld ist (§ 11 Abs. 2 EStG). Die Hilfe zu „Nicht umlagefähig“ und zur
  Hausgeldabrechnung ist richtiggestellt, das Lexikon kennt den Begriff „Erhaltungsrücklage“.
  Bereits erfasste Rücklagen bitte auf die neue Kostenart umstellen.
  Eine Entnahme aus der Rücklage, also eine daraus bezahlte Erhaltung, schlägt Mietfuchs als „Nicht
  umlagefähig“ vor.
  ([#143](https://github.com/speedone/mietfuchs/issues/143))
- **Auf dem Handy passt jede Seite auf den Bildschirm.** Stammdaten, Zähler, Kosten, Abrechnung
  und Mietkonto waren breiter als ein Handy und ließen sich nur mit waagerechtem Wischen lesen.
  Breite Tabellen scrollen jetzt innerhalb ihrer Karte, das Monatsraster im Mietkonto zeigt vier
  Monate je Zeile, und die Navigation oben ist nach denselben Gruppen geordnet wie am Rechner. Der
  Ausdruck bleibt unverändert.
  ([#137](https://github.com/speedone/mietfuchs/issues/137))
- **Die Abrechnung weist auf einen Rückstand im Mietkonto hin.** Zahlt ein Mieter einen Monat
  nicht, rechnete die Abrechnung trotzdem die volle Vorauszahlung an und sagte nichts dazu; wer
  nicht an die Korrektur dachte, verschickte ein zu hohes Guthaben. Jetzt erscheint eine Warnung
  mit dem offenen Betrag, solange für das Jahr keine gezahlte Vorauszahlung eingetragen ist.
  Umgerechnet wird nicht, denn ob eine Teilzahlung die Kaltmiete oder die Vorauszahlung betraf,
  wissen nur Sie. „Hier beheben →“ führt ins Mietkonto. Im laufenden Jahr zählen nur die Monate
  vor dem aktuellen. Wer gar keine Zahlungen erfasst, bekommt den Hinweis nicht.
  Dieselbe Regel gilt jetzt im Mietkonto: Im laufenden Jahr stehen die kommenden Monate als „noch
  nicht fällig“ da und zählen nicht zu den offenen Rückständen.
  ([#133](https://github.com/speedone/mietfuchs/issues/133))
- **Der Vorschlag für die neue Vorauszahlung war zu niedrig, wenn der Mieter erst im Jahr einzog.**
  Mietfuchs teilte den Anteil des Teiljahres durch zwölf, obwohl die Kosten künftig für ein ganzes
  Jahr anfallen; der Mieter hätte im Folgejahr nachgezahlt. Jetzt wird der Anteil zuerst auf das
  volle Jahr hochgerechnet. Endet das Mietverhältnis im Jahr, auch zum 31.12., steht kein Vorschlag
  mehr auf der Abrechnung. Abgeschlossene Abrechnungen behalten ihren eingefrorenen Stand.
  Bei Einzug im Jahr sagt die Abrechnung auch, dass der Anteil auf ein volles Jahr hochgerechnet
  ist.
  ([#134](https://github.com/speedone/mietfuchs/issues/134))
- **Garage und Stellplatz lassen sich mit 0 m² und 0 Personen anlegen.** Bisher verlangte das
  Formular eine Fläche über 0 und mindestens eine Person, und die Garage stand mit erfundenen
  Werten in der Verteilbasis von Flächen- und Personenschlüssel. Jetzt sind 0 m² und 0 Personen
  erlaubt, mit einem kurzen Hinweis am Feld; negative und gebrochene Personenzahlen bleiben
  ausgeschlossen, und die Meldung sagt, was erlaubt ist. Ist eine Einheit mit 0 m²
  ausdrücklich an 0 Personen vermietet, nennt die Abrechnung das nur als Hinweis mit den
  betroffenen Positionen, und das Cockpit färbt sich allein deswegen nicht gelb. Eine bewohnte
  Wohnung mit 0 m², eine leerstehende ohne Fläche oder eine Wohnung mit Fläche und 0 Personen
  meldet sie weiter als Warnung, denn dann ist die Angabe vermutlich vergessen.
  ([#135](https://github.com/speedone/mietfuchs/issues/135))
- **Die Cockpit-Ampel „Zählerstände“ sieht den Hauptzähler.** Bisher zählte sie nur Zähler mit
  Wohnung; fehlte der Endstand des Hauptzählers, blieb sie grün, obwohl er seit #116 die
  Verteilbasis sein kann und die Abrechnung dann nicht stimmt.
  ([#136](https://github.com/speedone/mietfuchs/issues/136))
- **Eine Gutschrift verringert jetzt auch den Eigenanteil.** Bisher sank bei einer Gutschrift
  nur der Vermieteranteil, der Teil Ihrer selbstgenutzten Wohnung blieb unverändert, und die
  Steuerübersicht wies einen zu hohen privaten Anteil aus. Bei noch offenen Jahren mit Gutschriften
  ändert sich deshalb der private Anteil in der Steuerübersicht; abgeschlossene Abrechnungen
  behalten ihren eingefrorenen Stand.
  ([#129](https://github.com/speedone/mietfuchs/issues/129))
- Ein Zählertausch, der als neuer Zähler angelegt wurde statt als Wechsel, gilt beim Hauptzähler
  nicht mehr als Lücke in der Messung, auch wenn daneben ein zweiter Zähler weiterläuft oder ein
  Zähler aus früheren Jahren noch angelegt ist.
- **Miteigentumsanteile „78.43“ wurden als 7843 gelesen**, eine Wohnfläche „1.200“ als 1,2. Das
  Wohnungsformular liest Zahlen jetzt in deutscher und technischer Schreibweise; bei der
  Gemeinschaftsabrechnung hätte der Fehler die Verteilung verschoben. Bitte prüfen Sie die
  Miteigentumsanteile Ihrer Wohnungen, wenn Sie sie mit Punkt eingegeben haben. Geldbeträge liest
  Mietfuchs jetzt nach derselben Regel, „1.240“ € sind also 1.240 € und nicht mehr 1,24 €.
  ([#105](https://github.com/speedone/mietfuchs/issues/105))
- Kleinigkeiten aus den Durchsichten: Das Kostenformular beachtet die Teilnehmer beim Hinweis zur
  Gemeinschaftsabrechnung und bei der Liste der Einzelbeträge, die Summe der Anlage behält ihre
  Nachkommastellen, eine auf Wohnungen beschränkte Position zeigt das schon in der Liste, die
  Warnungen zu fehlender Fläche oder Personenzahl nennen nur Wohnungen, die an einer solchen
  Position teilnehmen, das Cockpit kennt die Gemeinschaftsabrechnung, und die Karte „Objekt“
  verliert keine Eingaben mehr und meldet Fehler beim Speichern.
  ([#105](https://github.com/speedone/mietfuchs/issues/105))
- **Eine alte `db.json` neben einer schon gefüllten Datenbank bleibt nicht mehr stumm.** Wer
  Mietfuchs zuerst startet, etwas speichert und danach seine alte Datei in den Datenordner legt,
  sah bisher ein leeres Haus ohne Erklärung. Der Umstieg unterbleibt weiterhin mit Absicht, damit
  kein neuerer Stand überschrieben wird. Jetzt erscheint aber ein Hinweis, der erklärt, wie Sie
  die alte Datei als ZIP-Archiv über „Backup wiederherstellen …“ prüfen und übernehmen. Stehen in
  der Datenbank bis dahin nur Einstellungen, zeigt Mietfuchs keine leeren Seiten an, in die man
  aus Versehen einen zweiten Bestand schreiben könnte.
  ([#89](https://github.com/speedone/mietfuchs/issues/89))
- **Einzelbeträge vom Messdienst: Der Betrag Ihrer eigenen Wohnung lässt sich jetzt eintragen.**
  Vorher steckte er im Rest beim Vermieter, und die Steuerübersicht nannte den privaten, nicht
  abziehbaren Anteil zu niedrig. Beim Schlüssel „Einzelbeträge je Mieter“ steht dafür unter den
  Mietern ein Feld je selbstgenutzter Wohnung; der Betrag ist Ihr Eigenanteil. Bitte tragen Sie
  ihn bei Abrechnungen eines Messdienstes nach, die auch Ihre Wohnung erfassen.
  ([#104](https://github.com/speedone/mietfuchs/issues/104))
- **Rechtliche Hinweise nach einer Recherche mit Quellen berichtigt** (Stand 30.09.2026). Beim
  Kabelfernsehen gilt die Übergangsregel nur für Anlagen, die vor dem 01.12.2021 errichtet
  wurden, und bei einer Breitband-Verteilanlage bleibt danach nur der Betriebsstrom umlagefähig.
  Bei einer Pauschale oder Warmmiete für Heizung und Warmwasser erklärt die Warnung jetzt, dass
  der Heizanteil als Vorauszahlung zu behandeln und nach Verbrauch abzurechnen ist (BGH VIII ZR
  212/05). Im Lexikon wurden die Einträge zur Heizkostenverordnung, zu § 35a, zum Eigenanteil, zum
  Verbrauchsschlüssel und zum Hauptzähler genauer.
  ([#109](https://github.com/speedone/mietfuchs/issues/109))
- Im Formular für Kostenpositionen ragte das Auswahlfeld „Umlageschlüssel“ über den Rand des
  Seitenfensters, weil seine längste Option breiter ist als das Fenster.
- **Einliegerwohnung mit Zwischenzähler: Der Mieter zahlte das Wasser des Vermieters mit.**
  Hat eine Wohnung keinen eigenen Zähler, verteilte der Verbrauchsschlüssel die ganze Rechnung
  auf die Wohnungen mit Zähler. Jetzt gilt der Hauptzähler des Hauses als Grundlage, und der
  Rest nach Abzug der Zwischenzähler bleibt beim Vermieter, bei der eigenen Wohnung als
  Eigenanteil. Beispiel: 200 m³ im Haus, 40 m³ in der Einliegerwohnung, 1.000 € Wasser; der
  Mieter zahlt jetzt 200 € statt 1.000 €. Voraussetzung ist, dass der Hauptzähler unter
  Zähler als „Haus (Hauptzähler)“ erfasst ist; fehlt er, weist die Abrechnung darauf hin.
  Bitte prüfen Sie noch nicht abgeschlossene Abrechnungen mit dem Schlüssel „Verbrauch“.
  Außerdem erklärt die Warnung zur Warmmiete, wie Mietfuchs die Ausnahme für das
  Zweifamilienhaus mit selbstbewohnter Wohnung erkennt.
  ([#116](https://github.com/speedone/mietfuchs/issues/116))
- **Kabelfernsehen ist seit dem 1. Juli 2024 nicht mehr umlagefähig, und Mietfuchs sagt es jetzt.**
  Mit dem Wegfall des Nebenkostenprivilegs dürfen die Gebühren für das TV-Signal nur noch bis zum
  30.06.2024 über die Nebenkosten umgelegt werden, und nur bei Anlagen, die vor dem 01.12.2021
  errichtet wurden; danach bleibt bei solchen Anlagen nur der Betriebsstrom umlagefähig, bei einer
  Gemeinschaftsantenne auch Prüfung und Einstellung. Für das Abrechnungsjahr 2024 und später weisen
  die Abrechnung und das Kostenformular bei der Kostenart „Kabel/Antenne“ darauf hin. Mietfuchs
  kürzt nicht selbst, weil es nicht wissen kann, welcher Teil der Rechnung das TV-Signal ist.
  Prüfen Sie bitte Abrechnungen ab 2024 mit dieser Kostenart.
  ([#107](https://github.com/speedone/mietfuchs/issues/107))
- **Ein Release-Kandidat meldet sich als Vorabversion.** Die Programmdatei, das Docker-Image und
  die Linux-Pakete aus einem Tag wie `v0.9.0-rc.2` meldeten sich als fertige 0.9.0, und
  erschien die echte 0.9.0, kam kein Update-Hinweis. Jetzt trägt der Bau die Nummer aus dem Tag,
  die Einstellungen sagen „Sie nutzen die Vorabversion 0.9.0-rc.2. Neueste veröffentlichte
  Version: 0.8.0.“, und die fertige Version wird angeboten, sobald sie erscheint. Die Pakete
  sortieren den Kandidaten vor die fertige Version, sodass die Paketverwaltung sie als
  Aktualisierung annimmt. ([#166](https://github.com/speedone/mietfuchs/issues/166))

## [0.8.0] – 2026-09-22

### Geändert

- **Das Backup enthält jetzt die Datenbank, und beim Wiederherstellen kommt sie mit
  zurück.** Am Vorgehen ändert sich für Sie nichts: Backup bleibt „diesen Ordner kopieren", und
  der Knopf in den Einstellungen lädt weiterhin ein ZIP herunter. Neu ist, was darin liegt.
  Im Archiv liegt genau die Ablage, die Ihre Daten wirklich trägt, und beim Wiederherstellen
  gilt eine mitgelieferte Datei `db.json` vor der Datenbank. Das klingt nach einer Kleinigkeit
  und ist keine: Spielen Sie ein Backup ein, das noch von einer Version stammt, die in die
  `db.json` geschrieben hat, bekommen Sie dadurch den Stand zurück, mit dem Sie zuletzt
  gearbeitet haben, und nicht einen älteren aus der Datenbank daneben.
  Spielen Sie ein Backup zurück, das noch mit einer älteren Version erstellt wurde und deshalb
  keine Datenbank enthält, wird sie aus den wiederhergestellten Daten neu aufgebaut, und zwar
  mit derselben Nachrechnung wie beim Umzug: Erst wenn Abrechnung, Verbrauchsübersicht,
  Mietkonto und Steuerübersicht auf den Cent dieselben sind, gilt sie. Ihre bisherige Datenbank
  bleibt dabei als `mietfuchs.sqlite.vor-restore` liegen; lag daneben noch eine `db.json`, wird
  auch sie als `db.json.vor-restore` gesichert.
  Ein Archiv aus einer neueren Mietfuchs-Version oder mit beschädigter Datenbank wird abgelehnt,
  bevor irgendetwas ersetzt ist; Ihre bisherigen Daten sind dann unverändert.
  ([#55](https://github.com/speedone/mietfuchs/issues/55))

- **Ihre Daten ziehen beim ersten Start in eine Datenbank um.** Im Datenordner liegt dafür die
  Datei `mietfuchs.sqlite`, und ab dem Umzug wird dort gelesen und gespeichert. Der Umzug läuft
  von selbst, es ist kein Befehl und keine Antwort nötig, und die Oberfläche sagt einmal, dass er
  stattgefunden hat. Ihre bisherige Datei `db.json` heißt danach `db.json.abgeloest`: Ihr Inhalt
  bleibt unverändert als Rückweg liegen, nur der Name sagt jetzt, dass sie nicht mehr
  mitgeschrieben wird. Daneben liegt ein Protokoll, das aufzählt, was übernommen wurde. Am Backup
  ändert sich nichts: weiterhin diesen Ordner kopieren. Bevor der Umzug gilt, rechnet Mietfuchs
  Abrechnung, Verbrauchsübersicht, Mietkonto und Steuerübersicht für jedes Jahr, in dem etwas
  erfasst ist, aus beiden Beständen nach und vergleicht sie auf den Cent. Weicht ein einziger
  ab, wird nichts übernommen, und Sie erfahren, in welchem Jahr und in welcher Zahl. Haben Sie
  nicht mehr den ganzen Ordner, sondern nur ein Backup-Archiv oder eine lose `db.json` von
  früher, dann beschreibt [MIGRATION.md](MIGRATION.md) den Weg dafür.
  ([#55](https://github.com/speedone/mietfuchs/issues/55))

- **Nach dem Wiederherstellen gelten sofort die Einstellungen aus dem Backup.** Vorher zeigte
  Mietfuchs bis zum nächsten Start noch die Einstellungen von davor, und die nächste beliebige
  Änderung an ihnen hätte den alten Stand wieder festgeschrieben. Betroffen waren auch
  Vermietername und IBAN, die im Kopf der gedruckten Abrechnung stehen.
  ([#55](https://github.com/speedone/mietfuchs/issues/55))

- **Scheitert der Umzug, zeigt Mietfuchs Ihre Daten nicht an und sagt Ihnen, warum.** Verloren ist
  dabei nichts: Ihr Bestand steht unverändert in der Datei `db.json`, und beim nächsten Start wird
  es erneut versucht. Dass Mietfuchs in diesem Fall nichts anzeigt, ist Absicht. Es könnte
  stattdessen die noch leere Datenbank zeigen, aber dann sähen Sie ein leeres Haus, und alles,
  was Sie hineinschrieben, stünde danach als zweiter Bestand neben Ihrem eigentlichen. Eine
  ehrliche Meldung ist besser als eine Oberfläche, die so tut, als hätten Sie noch nichts
  erfasst. ([#55](https://github.com/speedone/mietfuchs/issues/55))

- **Eine Vorauszahlung aus sehr alten Beständen zählt beim Umzug auch im Mietkonto mit.** Wer
  Mietfuchs schon vor der Vorauszahlungs-Staffel benutzt hat, kann ein Mietverhältnis haben, bei
  dem die Vorauszahlung noch als fester Monatsbetrag gespeichert ist. Die Abrechnung hat diesen
  Betrag immer gelesen, das Mietkonto nicht; dort war das monatliche Soll um die Vorauszahlung zu
  niedrig. Beim Umzug wird daraus ein gewöhnlicher Staffeleintrag, und damit rechnen Abrechnung,
  Mietkonto und Steuerübersicht ab jetzt mit demselben Betrag. Für Sie heißt das: Das Soll steigt
  um die Vorauszahlung, dieselbe Zahlung deckt also weniger Monate, und ein Monat kann von
  „bezahlt“ auf „teilweise“ wechseln. Gefordert wird damit, was die Abrechnung ohnehin ansetzt.
  Betrifft es Sie, steht es nach dem Umzug in der Oberfläche und im Protokoll.
  ([#55](https://github.com/speedone/mietfuchs/issues/55),
  [#70](https://github.com/speedone/mietfuchs/issues/70))

- **Wer Mietfuchs aus dem Quellcode startet, braucht jetzt mindestens Node 24.15.** Zwei Gründe
  kommen dort zusammen. Der Server ist von JavaScript auf TypeScript umgestellt und wird
  weiterhin nicht gebaut: Node führt die Dateien unmittelbar aus und streift die Typen dabei ab,
  und das gilt erst ab 24.12 als stabil. Dazu kommt die Datenbank, die gerade entsteht: Sie
  nutzt das eingebaute `node:sqlite`, und bis Node 24.14 meldet das bei jedem Start eine
  Warnung, dass es sich um eine experimentelle Funktion handelt. Ab 24.15 ist sie weg. Statt sie
  zu unterdrücken, was auch nützliche Warnungen verschluckt hätte, liegt die Untergrenze jetzt
  dort. Für alle anderen ändert sich nichts: Die Programmdatei, die Linux-Pakete und das
  Docker-Image bringen ihre Laufzeit selbst mit, und an der Bedienung, an den Daten und an den
  Einstellungen ist nichts anders.
  ([#48](https://github.com/speedone/mietfuchs/issues/48),
  [#55](https://github.com/speedone/mietfuchs/issues/55))

### Behoben

- **Ein Zählerwechsel ohne Endstand des alten Geräts ergibt keinen negativen Verbrauch mehr.**
  Wird ein Zähler als gewechselt gekennzeichnet, gehört der letzte Stand des alten Geräts dazu.
  Fehlte er, las Mietfuchs ihn als Null, und aus einem Zählerstand von 980 wurde ein Verbrauch
  von minus 980; im Jahr gemessen minus 910. Das blieb nicht bei der Anzeige: Bei einer Rechnung
  nach Verbrauch geht eine solche Zahl in die Verteilung ein und verschiebt die Anteile aller
  Mieter. Über die Eingabemaske ist das nicht möglich, dort wird der Endstand verlangt; über
  eine von Hand bearbeitete Datei oder ein Backup aus fremder Quelle schon. Jetzt steht eine
  Meldung auf der Zähler-Seite, und der Verbrauch des alten Geräts bis zum Wechsel wird weder
  verteilt noch erfunden. Wie bei zwei Ablesungen am selben Tag gilt auch hier: Die Lücke zahlt
  ein anderer Mieter und nicht der Vermieter. Nachgemessen an zwei Wohnungen mit 2.000 € Wasser
  sinkt der Anteil des einen von 802,40 € auf 540,15 €, während der andere 1.459,85 € statt
  1.197,60 € zahlt. Ein ausdrücklich eingetragener Endstand von 0 bleibt dabei eine
  Angabe und keine Lücke. ([#83](https://github.com/speedone/mietfuchs/issues/83))

- **Eine getrennt abgerechnete Wohnung gilt in der Steuerübersicht nicht mehr als Eigennutzung.**
  Seit einiger Zeit gibt es drei Zustände: vermietet, selbstgenutzt und außerhalb der
  Abrechnungseinheit. Die Steuerübersicht kannte nur zwei und behandelte alles, was nicht
  vermietet ist, als selbstgenutzt. Wer etwa eine Gewerbeeinheit getrennt abrechnet, bekam
  deshalb die Aufforderung, den privaten Anteil herauszurechnen, obwohl er gar nichts selbst
  nutzt. Der Flächenanteil misst jetzt außerdem das **Selbstgenutzte** statt des Vermieteten, denn
  nur das ist eindeutig: Ob eine Wohnung außerhalb der Abrechnungseinheit vermietet ist, weiß
  Mietfuchs nicht, und steuerlich ist ohnehin der private Anteil die Frage. Genannt werden dabei
  die Quadratmeter, denn genau die fragt die Anlage V im Kopf ab. Gibt es Wohnungen,
  die Mietfuchs nicht einordnen kann, steht das jetzt als eigener Hinweis dabei, statt sie
  stillschweigend als selbstgenutzt zu zählen. Dass der Flächenanteil über das ganze Gebäude
  rechnet und die Abrechnung nur über die Wohnungen der Abrechnungseinheit, erklärt die Seite
  jetzt ebenfalls: Beide Zahlen sind richtig, sie beantworten verschiedene Fragen.
  ([#68](https://github.com/speedone/mietfuchs/issues/68))

- **Zwei Ablesungen am selben Tag verlieren ihren Verbrauch nicht mehr stillschweigend.** Liegen
  zwei Stände desselben Zählers auf demselben Tag, lässt sich die Differenz dazwischen nicht
  tagesanteilig verteilen, denn es ist kein Tag vergangen. Sie fiel deshalb ersatzlos heraus, und
  bei einer Rechnung nach Verbrauch **zahlt das ein anderer Mieter**. Nachgemessen an zwei
  Wohnungen mit je 100 m³ und 2.000 € Wasser: Fehlen bei einer davon 10 m³, sinkt ihr Anteil auf
  947,37 €, und der der anderen steigt auf 1.052,63 €. Dem Vermieter entgeht dabei nichts, und
  genau das macht es schlimm: Ein Mieter bekommt eine Abrechnung mit zu viel darauf, und
  niemandem fällt es auf. Am ehesten passiert das beim Zählerwechsel, wenn der Endstand des alten
  Geräts und der erste Stand des neuen auf denselben Tag fallen, und beim Nacherfassen einer
  falschen Ablesung. Jetzt steht auf der Zähler-Seite eine Meldung mit dem Tag und der Menge, die
  herausfällt, und das Cockpit schaltet die Ampel „Zählerstände" auf Rot. Verteilt wird sie bewusst nicht: Zwei Ablesungen am
  selben Tag sind fast immer eine Korrektur, und dann wäre die Differenz ein Tippfehler und kein
  Wasser; beim Zählerwechsel wäre sie Verbrauch über null Tage. Welche der beiden Ablesungen
  stimmt, wissen nur Sie. ([#69](https://github.com/speedone/mietfuchs/issues/69))

- **Eine Miete, die um den Jahreswechsel eingeht, fällt nicht mehr aus der Steuerübersicht
  heraus.** Betroffen waren zwei alltägliche Fälle. Endet ein Mietverhältnis am 31. Dezember und
  geht die Dezembermiete erst im Januar ein, kannte die Steuerübersicht dieses Geld in **keinem**
  der beiden Jahre. Dasselbe umgekehrt, wenn ein Dauerauftrag die Januarmiete schon Ende Dezember
  bucht und das Mietverhältnis erst im Januar beginnt. Der Grund war, dass die Einnahmen aus dem
  Mietkonto kamen und das nur Mietverhältnisse führt, die im Jahr laufen. Jetzt zählt die
  Steuerübersicht jede Zahlung mit Datum im Jahr, wie es das Zuflussprinzip verlangt. Das Mietkonto
  bleibt, wie es war: Dort geht es darum, bis zu welchem Monat ein laufendes Mietverhältnis
  gedeckt ist. ([#70](https://github.com/speedone/mietfuchs/issues/70))

- **Die Steuerübersicht sagt es, wenn für einen Teil der Mietverhältnisse keine Zahlung erfasst
  ist.** Bisher gab es einen Hinweis nur, wenn im ganzen Jahr gar nichts erfasst war. Sind die
  Eingänge für einen Mieter gepflegt und für einen zweiten nicht, sieht die Summe vollständig aus,
  ist aber zu niedrig, und diese Zahl geht in die Anlage V. Jetzt steht dabei, für wie viele von
  wie vielen Mietverhältnissen etwas fehlt. Die Zeile „davon tatsächlich eingegangen" heißt
  außerdem nicht mehr „davon": Eine Zahlung kann zu einem Mietverhältnis gehören, das im Jahr gar
  keine Zeile im Mietkonto hat, und ist dann kein Teil des Solls.
  ([#70](https://github.com/speedone/mietfuchs/issues/70))

- **Die Steuerübersicht rechnet jetzt von sich aus mit dem, was tatsächlich eingegangen ist.**
  Bisher war das vereinbarte Soll voreingestellt, weil es auch ohne erfasste Zahlungen eine Zahl
  liefert. Für die Anlage V ist das aber die falsche Grundlage: Steuerlich zählt, was Ihnen im
  Jahr zugeflossen ist, und eine vereinbarte, nicht gezahlte Miete ist keine Einnahme. Das Soll
  bleibt umschaltbar, denn zum Abgleich ist es nützlich, und wer es ansetzt, sieht jetzt einen
  Hinweis darauf, auch auf dem Ausdruck. Sind für ein Jahr noch keine Zahlungen erfasst, stehen
  dort 0 € und ein Satz, der zum Mietkonto führt, statt einer Summe, die stimmig aussieht und
  nicht in die Steuererklärung gehört.
  ([#70](https://github.com/speedone/mietfuchs/issues/70))

- **Abrechnung und Steuerübersicht erklären jetzt, warum sie bei den Vorauszahlungen verschiedene
  Zahlen nennen.** Die Abrechnung setzt die tatsächlich geleisteten Vorauszahlungen an, denn sie
  muss es, und sie verteilt nur über Wohnungen, die zur Abrechnungseinheit gehören. Die
  Steuerübersicht führt daneben das vereinbarte Soll über alle Mietverhältnisse. Beide Zahlen sind
  richtig, sie beantworten verschiedene Fragen, aber sie standen unkommentiert nebeneinander, und
  wer sie verglich, musste eine davon für falsch halten. Jetzt steht die Zahl der Abrechnung mit
  einem Satz dabei, sobald sich die beiden unterscheiden. Ist die Abrechnung des Jahres
  abgeschlossen, gilt die Zahl, die auf dem zugestellten Papier steht. Ebenso erklärt das Mietkonto
  einen offenen Dezember: Eine Miete zählt zu dem Jahr, in dem sie eingegangen ist, und geht die
  Dezembermiete erst im Januar ein, erscheint sie im Mietkonto des Folgejahres.
  ([#70](https://github.com/speedone/mietfuchs/issues/70))

- **Am Jahreswechsel weist die Steuerübersicht auf die Zehn-Tage-Regel hin.** Regelmäßig
  wiederkehrende Einnahmen wie die Miete, die kurz vor oder nach dem Jahreswechsel fließen,
  gehören unter Umständen in das andere Jahr (§ 11 Abs. 1 Satz 2 EStG). Ob das greift, hängt
  auch davon ab, wann die Miete nach dem Mietvertrag fällig war. Mietfuchs entscheidet das nicht
  selbst, sondern sagt es dazu, wie schon bei der Aufteilung gemischt genutzter Gebäude.
  ([#70](https://github.com/speedone/mietfuchs/issues/70))

- **Das Mietkonto sortiert unabhängig davon, wie der Rechner eingestellt ist.** Bisher hing die
  Reihenfolge der Wohnungen an der Spracheinstellung der Laufzeit, dieselben Daten konnten also
  auf zwei Rechnern verschieden dastehen. Jetzt gilt fest deutsche Sortierung, „Älter" steht
  also weiterhin vor „Zaun". An einer Zahl ändert das nichts.
  ([#70](https://github.com/speedone/mietfuchs/issues/70))

- **Das Wiederherstellen aus einem Backup lässt niemanden mehr mit einem Fehler stehen.** Zwei
  Dinge gingen dabei schief, und beide trafen ausgerechnet die Lage, in der man ein Backup
  überhaupt braucht. Zum einen wurde bisher nur geprüft, ob sich die Datei im Archiv überhaupt
  lesen lässt. Enthielt sie etwas anderes als einen Mietfuchs-Datenbestand, weil sie unterwegs
  beschädigt wurde oder aus einem fremden Programm stammte, wurde sie trotzdem übernommen;
  danach beantwortete Mietfuchs keine einzige Anfrage mehr, und helfen konnte nur noch, die
  Datei von Hand zurückzukopieren. Jetzt wird das Archiv vorher geprüft: Passt etwas nicht,
  bleibt alles, wie es war, und die Meldung nennt jede Beanstandung mit der Stelle und dem
  Grund, etwa dass bei der zweiten Wohnung eine negative Wohnfläche steht. Bestände, die zwar
  ungewöhnlich, aber in Ordnung sind, gehen weiterhin durch, damit niemand vor seinem eigenen
  Backup steht: eine Rechnung, deren Zuordnung auf eine gelöschte Wohnung zeigt, zwei Einträge
  einer Staffel zum selben Stichtag oder eine Datei aus einer älteren Version. Zum anderen
  scheiterte das Wiederherstellen auf einem frischen Rechner mit einer technischen
  Fehlermeldung, weil Mietfuchs den bisherigen Stand beiseitelegen wollte und es dort noch gar
  keinen gab. Genau das ist aber der häufigste Fall, nämlich der Umzug auf einen neuen Rechner
  und der Neuanfang nach einem Schaden. Jetzt gelingt es auch dort, und die Sicherheitskopie
  `db.json.vor-restore` entsteht nur, wenn es wirklich etwas zu sichern gab.
  ([#59](https://github.com/speedone/mietfuchs/issues/59))

- **Ein Beleg, bei dem die KI einen Betrag nicht lesen konnte, ließ sich gar nicht mehr
  übernehmen.** Statt der erkannten Positionen stand dann „Fehler“ in der Warteschlange, und
  der ganze Beleg war verloren, obwohl Beschreibungen, Kostenarten und die übrigen Beträge
  brauchbar waren. Jetzt steht die Position ganz normal da, nur mit leerem Betragsfeld zum
  Ausfüllen; in der Schnellerfassung zeigt die Ampel sie rot mit dem Hinweis „Betrag fehlt oder
  ist 0“. Auf der Kostenseite ist eine solche Position nicht mehr vorgehakt, damit sie nicht
  angehakt dasteht und beim Übernehmen dann stillschweigend übersprungen wird; wer den Betrag
  einträgt, setzt den Haken selbst. Ebenso wird ein Betrag jetzt auch dann übernommen, wenn das
  Modell ihn als Text geschrieben hat („12,50“ statt 12.5) oder die Währung dazugeschrieben hat
  („12,50 €“ wie „EUR 12,50“); beim Zählerstand gilt dasselbe für „1234 m³“ und „4711 kWh“.
  Betroffen waren vor allem kleine Modelle auf dem eigenen Rechner, die sich nicht streng an die
  Vorgabe halten. ([#63](https://github.com/speedone/mietfuchs/issues/63))
- **Fehlte auf einer Nettorechnung der Betrag einer Position, erfand Mietfuchs Zahlen, die
  stimmig aussahen.** Weist eine Rechnung ihre Positionen ohne Umsatzsteuer aus und nennt sie erst
  in der Summe, rechnet Mietfuchs die Positionen auf den Rechnungsbetrag hoch. Fehlte dabei eine
  Position, wurde der ganze Rechnungsbetrag auf die übrigen verteilt: Die Summe passte zum Beleg,
  jede einzelne Position war aber zu hoch, in den nachgerechneten Beispielen um 20, 23 und 59
  Prozent, und eine Position ohne Betrag bekam sogar einen. Beim Prüfen fiel nichts davon auf.
  Jetzt rechnet Mietfuchs nur noch hoch, wenn jeder Betrag gelesen wurde und der Abstand zwischen
  Positionssumme und Rechnungsbetrag zu einer Umsatzsteuer passt, also höchstens dem Regelsatz
  von 19 Prozent entspricht. Fehlt eine Position, ist der Abstand größer, als eine Steuer ihn
  machen kann, und die Beträge bleiben so stehen, wie sie auf der Rechnung stehen. Das gilt auch
  dann, wenn die KI einen nicht gelesenen Betrag als 0 geliefert oder die Position ganz
  weggelassen hat. Eine Position, die laut Rechnung tatsächlich nichts kostet, verhindert das
  Hochrechnen dagegen nicht. ([#63](https://github.com/speedone/mietfuchs/issues/63))
- **Aus demselben Grund wurde der Arbeitskostenanteil nach §35a zu hoch vorgeschlagen.** Steht
  er nur als ein Betrag unter der Rechnung, verteilt Mietfuchs ihn auf die Positionen. Fehlte
  eine, bekamen die übrigen deren Anteil mit dazu, und weil eine Position ohne Betrag nicht
  übernommen wird, stand am Ende zu viel §35a in der Steuerübersicht: aus einer Rechnung über
  900 € mit 500 € Arbeitskosten wurden 500 € auf 600 € gebuchte Kosten, während 333 € richtig
  gewesen wären. Verteilt wird jetzt nur, wenn jeder Betrag gelesen wurde und derselbe Abstand
  erklärbar ist. Eine Abschlagszahlung und eine Nettorechnung, bei der die KI das Kennzeichen
  nicht gesetzt hat, bleiben dabei ausdrücklich in Ordnung: Auch ein ausbleibender
  Arbeitskostenanteil kostet bares Geld.
  ([#63](https://github.com/speedone/mietfuchs/issues/63))
- **Ein API-Schlüssel konnte im Klartext in einer Fehlermeldung auf dem Bildschirm stehen.**
  Antwortete ein KI-Dienst mit etwas, das Mietfuchs nicht als Auswertung lesen konnte, zeigte
  die Meldung die Antwort im Wortlaut. Gab der Dienst dabei die eigene Anfrage zurück, wie es
  manche bei einem Fehler tun, stand der Schlüssel darin. Jetzt ersetzt Mietfuchs ihn in jeder
  Meldung durch Sternchen, so wie es die übrigen Meldungen schon taten. Betroffen war nur, wer
  einen KI-Dienst mit Schlüssel eingetragen hat, also OpenAI, Mistral, IONOS oder Ollama Cloud;
  ein Ollama auf dem eigenen Rechner oder im Heimnetz braucht keinen Schlüssel und war deshalb
  nie betroffen. Zu tun ist nichts, solange die Meldung nur auf dem eigenen Bildschirm stand.
  Wer eine solche Meldung weitergegeben hat, etwa als Bildschirmfoto in einem Fehlerbericht,
  in einem Forum oder in einer E-Mail, sollte den Schlüssel beim Anbieter widerrufen, dort
  einen neuen erzeugen und ihn in den Einstellungen eintragen.
- **Eine unbrauchbare Datei `secrets.json` legt Mietfuchs nicht mehr lahm.** Enthielt die Datei
  mit den API-Schlüsseln statt der Schlüssel nur das Wort `null`, antwortete der Server mit
  einem Fehler, und die Oberfläche blieb leer: keine Wohnungen, keine Einstellungen, kein
  Zugang zu den eigenen Daten. Jetzt gilt ein unbrauchbarer Inhalt als „kein Schlüssel
  gespeichert“, und der Schlüssel lässt sich in den Einstellungen einfach neu eintragen. Die
  Datei liegt im Datenordner neben der `db.json`; diesen Inhalt bekam sie nur, wenn sie von
  Hand bearbeitet wurde oder ein Wiederherstellen sie beschädigt hat.
- **Ein falsch gesetztes `NKA_PORT` bricht den Start jetzt mit einer klaren Meldung ab.** Ein
  Wert, der keine Portnummer ist, galt bisher als Pfad eines Unix-Sockets: Mietfuchs meldete
  „läuft auf http://127.0.0.1:undefined“ und war über keine Adresse erreichbar.
- **Das Versanddatum einer abgeschlossenen Abrechnung wird geprüft, bevor es gespeichert
  wird.** An diesem Datum hängt die Frist nach §556 BGB, und Mietfuchs zeigt im Cockpit und auf
  der Abrechnung an, ob sie gewahrt ist. Über die Schnittstelle ließ sich dort bisher jede
  beliebige Angabe hinterlegen, auch eine, die gar kein Datum ist; die Frist wurde dann gegen
  Unsinn gerechnet. Jetzt nimmt Mietfuchs nur ein Datum an und weist alles andere ab. Über die
  Oberfläche war das nie möglich, dort kommt das Datum aus einem Datumsfeld.
- **Fremde Programme hinterlassen keine unsinnigen Felder mehr in den Daten.** Wer Mietfuchs
  nicht über die Oberfläche, sondern über seine Schnittstelle anspricht, etwa mit einem eigenen
  Skript, konnte beim Anlegen und Ändern von Wohnungen, Mietverhältnissen, Kosten, Zählern,
  Ablesungen, Zahlungen und Einstellungen Felder mit den Namen „0“, „1“ … erzeugen, die
  dauerhaft in der `db.json` stehen blieben. Solche Angaben verwirft Mietfuchs jetzt. Über die
  Oberfläche war das nie möglich, wer Mietfuchs nur dort bedient, war also nie betroffen.
- **Auch erfundene Einstellungen werden nicht mehr gespeichert.** Dasselbe galt für jeden
  beliebigen Namen: Wer über die Schnittstelle eine Einstellung namens `lieblingsfarbe` schickte,
  bekam sie dauerhaft gespeichert. Seit die Einstellungen in der Datenbank in benannten Spalten
  stehen, gibt es für ein unbekanntes Feld keinen Ort mehr, an dem es landen könnte.
  ([#60](https://github.com/speedone/mietfuchs/issues/60))

## [0.7.1] – 2026-09-20

### Geändert

- **Der Startmenü-Eintrag unter Linux startet ohne Konsolenfenster.** Mit Fenster startete auf
  Systemen ohne Terminalprogramm gar nichts, und zwar ohne sichtbare Meldung. Beendet wird
  Mietfuchs jetzt über den Knopf „Mietfuchs beenden“ unten in der Seitenleiste, den es nur bei
  der Programmdatei gibt. Ein zweiter Klick im Startmenü holt die laufende Oberfläche nach
  vorn, statt scheinbar nichts zu tun, und misslingt der Start, meldet sich Mietfuchs unter
  Linux zusätzlich über eine Systemmeldung.
  ([#45](https://github.com/speedone/mietfuchs/issues/45))

## [0.7.0] – 2026-09-20

### Geändert

- **Gescannte Belege werden schneller ausgewertet.** Die Seiten gehen jetzt mit 1200 statt 1684
  Bildpunkten an der langen Kante an das Modell. Der KI-Prüflauf hat vier Größen an denselben
  Belegen verglichen: Bis 1200 bleibt die Trefferquote gleich, darunter bricht sie ein, und
  mehr bringt nichts. Das spart rund 40 Prozent der Eingabe-Token und damit auf einem Rechner
  ohne Grafikkarte merklich Zeit. Wer ein Modell mit anderem Bedarf nutzt, ändert die Größe
  unter „Erweitert“ oder mit `NKA_AI_IMAGE_EDGE`; daneben steht, welchem dpi-Wert sie bei A4
  entspricht. ([#35](https://github.com/speedone/mietfuchs/issues/35))

### Hinzugefügt

- **Modelle lassen sich aus Mietfuchs laden.** In den Einstellungen steht neben einem fehlenden
  Modell ein Knopf „Modell laden“: Mietfuchs holt es über Ollama und zeigt den Fortschritt.
  Abbrechen ist möglich, ein späterer Versuch setzt dort an, wo der letzte aufgehört hat. Vorher
  fragt Mietfuchs nach, denn Modelle sind mehrere Gigabyte groß. Der Befehl fürs Terminal steht
  weiterhin daneben. ([#33](https://github.com/speedone/mietfuchs/issues/33))
- **Installationspakete für Linux.** Neben dem Archiv gibt es Mietfuchs jetzt als `.deb`
  (Debian, Ubuntu, Mint), `.rpm` (Fedora, openSUSE, RHEL und Verwandte) und als Paket für Arch
  Linux, je für x64 und ARM64. Installiert wird mit dem gewohnten Befehl der Distribution;
  danach steht Mietfuchs mit Symbol im Startmenü. Die Daten liegen dann in
  `~/.local/share/mietfuchs`, weil ein Programm in `/usr/bin` nicht neben sich schreiben darf.
  Wer das Archiv nutzt, behält seinen Ordner `data/` neben der Programmdatei. Der Update-Hinweis
  erklärt in einer Paketinstallation den Weg über die Paketverwaltung.
  ([#25](https://github.com/speedone/mietfuchs/issues/25))
- **Beim Start steht im Programmfenster, wo die Daten liegen.** Wer sie sichern oder umziehen
  will, muss den Ordner nicht mehr suchen.
  ([#25](https://github.com/speedone/mietfuchs/issues/25))
- **Empfehlungen, welches Modell taugt.** Die Einstellungen zeigen einige Modelle mit Größe,
  Bildverständnis und den Messwerten des KI-Prüflaufs. Mit eingeschalteter Update-Prüfung holt
  Mietfuchs höchstens einmal am Tag die aktuelle Liste aus dem Repo, sonst gilt die
  mitgelieferte. Empfehlungen belegen nur vor, jedes andere Modell lässt sich weiterhin
  eintragen. ([#33](https://github.com/speedone/mietfuchs/issues/33))

### Behoben

- **Rechnungen mit Nettopositionen werden richtig übernommen.** Weisen Handwerker oder
  Schornsteinfeger die Positionen ohne Umsatzsteuer aus und nennen sie erst in der Summe,
  rechnet Mietfuchs die Positionen jetzt selbst auf den Rechnungsbetrag hoch, statt die
  Nettobeträge zu übernehmen. Ein Hinweis nennt das, damit man es prüfen kann.
  ([#34](https://github.com/speedone/mietfuchs/issues/34))
- **Der Arbeitskostenanteil nach §35a geht nicht mehr verloren**, wenn die Rechnung ihn nur als
  einen Betrag nennt („Im Rechnungsbetrag sind Arbeitskosten von 90,56 € enthalten“). Mietfuchs
  verteilt ihn nach Beträgen auf die Positionen und weist darauf hin.
  ([#34](https://github.com/speedone/mietfuchs/issues/34))

## [0.6.0] – 2026-09-19

### Hinzugefügt

- **KI-Dienste neben Ollama.** In den Einstellungen lässt sich statt Ollama auf dem eigenen
  Rechner auch ein Dienst im Internet einstellen: OpenAI, IONOS AI Model Hub, Mistral, Ollama
  Cloud, LM Studio oder jeder andere OpenAI-kompatible Dienst. Vorlagen belegen die Adresse
  vor, ändern lässt sich alles. Ein Beleg dauert dort Sekunden statt Minuten und kostet
  Bruchteile eines Cents. ([#18](https://github.com/speedone/mietfuchs/issues/18))
- **Belege gehen erst nach einer Bestätigung aus dem Haus.** Zeigt die Adresse ins Internet,
  oder reicht Ollama das Modell an einen Cloud-Dienst weiter, fragt Mietfuchs einmal nach,
  mit Link zu den Bedingungen des Anbieters. Die Bestätigung gilt für genau diese Adresse und
  lässt sich widerrufen. Kosten und Schnellerfassung zeigen, wohin die Belege gehen.
  ([#18](https://github.com/speedone/mietfuchs/issues/18))
- **API-Schlüssel liegen getrennt von der Datenbank** in `data/secrets.json`, unter Linux und
  macOS nur für den eigenen Benutzer lesbar. Sie sind nicht im Backup und gehen nie an den
  Browser zurück. Im Container legen `NKA_AI_API_KEY` oder `NKA_AI_API_KEY_FILE` (Docker-Secret)
  den Schlüssel fest. ([#18](https://github.com/speedone/mietfuchs/issues/18))
- **Erweiterte Einstellungen für die KI:** ein eigener Anbieter für Fotos und Scans, Zeitlimit,
  Kontextgröße, Länge der Antwort, Stufe der strukturierten Ausgabe, Denkaufwand und
  zusätzliche Hinweise an das Modell. Dazu die Variablen `NKA_AI_PROVIDER`, `NKA_AI_URL`,
  `NKA_AI_MODEL` und `NKA_AI_MAX_TOKENS`. ([#18](https://github.com/speedone/mietfuchs/issues/18))
- **Programmdateien für Linux und Windows auf ARM**, etwa für einen Raspberry Pi 4 oder 5 mit
  64-Bit-System oder Windows-Laptops mit Snapdragon-Prozessor. Der Update-Hinweis kennt die
  neuen Dateien. ([#22](https://github.com/speedone/mietfuchs/issues/22))
- **Jede Programmdatei wird vor dem Release auf ihrem System gestartet und geprüft**, auf
  Windows, macOS und Linux jeweils mit Intel/AMD und ARM. Die Linux-Dateien laufen dabei
  zusätzlich auf 15 Distributionen, das Docker-Image auf beiden Plattformen. Ins Release
  kommt nur, was alle Prüfungen besteht. ([#22](https://github.com/speedone/mietfuchs/issues/22))
- **Ollama lässt sich leichter einrichten.** Die Einstellungen zeigen die installierten Modelle
  zur Auswahl, mit Größe und ob ein Modell Bilder versteht. Fehlt das gewählte Modell, steht der
  Befehl zum Laden mit Kopier-Knopf daneben. Antwortet Ollama unter einer anderen üblichen
  Adresse, etwa vom Docker-Container aus, schlägt Mietfuchs sie zur Übernahme vor.
  ([#17](https://github.com/speedone/mietfuchs/issues/17))
- **Ollama im Docker-Container:** `docker compose --profile ki up -d` startet Ollama mit und
  lädt das Modell einmalig. ([#17](https://github.com/speedone/mietfuchs/issues/17))
- **Umgebungsvariablen für die KI-Auswertung:** `NKA_OLLAMA_URL` und `NKA_OLLAMA_MODEL` legen
  Adresse und Modell fest, die Einstellungen zeigen sie dann gesperrt. `NKA_OLLAMA_NUM_CTX`
  ändert die Kontextgröße, `NKA_AI_TIMEOUT` das Zeitlimit.
  ([#17](https://github.com/speedone/mietfuchs/issues/17))
- **Fortschritt und Abbrechen bei der KI-Auswertung.** Kosten und Schnellerfassung zeigen, was
  das Modell gerade tut und wie lange es schon läuft. „Abbrechen“ und das Verlassen der Seite
  stoppen auch das Modell. ([#17](https://github.com/speedone/mietfuchs/issues/17))

### Behoben

- **Lange KI-Auswertungen brechen nicht mehr nach fünf Minuten ab.** Auf einem Rechner ohne
  Grafikkarte kann ein gescannter Beleg länger dauern. Dann endete die Auswertung nach fünf
  Minuten mit „Ollama nicht erreichbar“, in Firefox auch schon im Browser. Jetzt gilt nur das
  eigene Zeitlimit von 20 Minuten. ([#17](https://github.com/speedone/mietfuchs/issues/17))
- **Ollama las lange Belege nur teilweise.** Ohne Angabe nimmt Ollama auf den meisten Rechnern
  4.096 Token Kontext und kürzt längere Anfragen, ohne es zu melden. Mietfuchs setzt jetzt
  16.384. Neuere Modelle denken außerdem nicht mehr erst minutenlang nach, bevor sie antworten.
  ([#17](https://github.com/speedone/mietfuchs/issues/17))
- **Verständliche Meldungen bei der KI-Auswertung**, etwa wenn Ollama nicht läuft, das Modell
  fehlt oder die Antwort am Kontextende abgeschnitten wurde. Ein Modell ohne Bildverständnis
  bekommt keine Fotos und Scans mehr, statt sich eine Rechnung auszudenken.
  ([#17](https://github.com/speedone/mietfuchs/issues/17))
- **Das voreingestellte KI-Modell gab es nicht.** Mietfuchs schlug `qwen3.6-35b` vor, das es in
  der Ollama-Bibliothek nie gab. Neu voreingestellt ist `qwen3.5:4b`, ausgewählt mit einem
  Prüflauf an Beispielbelegen auf einem Rechner ohne Grafikkarte. Wer den alten Namen noch
  eingestellt hat, wird automatisch umgestellt.
  ([#17](https://github.com/speedone/mietfuchs/issues/17))
- **Die macOS-Programmdateien tragen eine gültige Signatur.** Die Datei für Intel-Macs war
  ungültig signiert. macOS 26 startet sie trotzdem, neuere Versionen beenden solche Programme
  aber sofort. Die macOS-Dateien werden jetzt auf einem Mac neu signiert und geprüft.
  ([#22](https://github.com/speedone/mietfuchs/issues/22))
- **Gescannte PDFs werden auch in der Programmdatei ausgewertet.** Bei PDFs ohne Textebene
  brach die KI-Auswertung in der Programmdatei mit „DOMMatrix is not defined“ ab. Im
  Docker-Image und beim Start aus dem Quellcode lief sie. Jetzt liest der Browser das PDF vor
  dem Hochladen: Er schickt die Textebene mit und bei Scans die ersten vier Seiten als Bilder.
  Das verhält sich in allen Betriebsarten gleich.
  ([#21](https://github.com/speedone/mietfuchs/issues/21))
- **Umlaute in Dateinamen bleiben erhalten.** Aus „Gebührenbescheid.pdf“ wurde beim Hochladen
  „Geb__hrenbescheid.pdf“. Bereits hochgeladene Belege behalten ihren Namen.
- **Fehler beim Hochladen erscheinen als verständliche Meldung**, etwa bei einer Datei über
  25 MB, statt als technische Fehlerseite. Passwortgeschützte oder beschädigte PDFs werden
  ebenfalls klar benannt.
- **Belegkopien im Druck und die Auswertung von PDFs laufen auch in etwas älteren Browsern.**
  pdf.js wird jetzt in der Fassung für ältere Browser geladen (laut pdf.js ab Chrome 125,
  Safari 18 und Firefox ESR). Die bisherige Fassung setzte die allerneuesten Browser voraus.

### Sicherheit

- **Der Server enthält kein pdf.js mehr.** `npm audit` meldete für die dort genutzte Version
  eine Lücke, über die ein präpariertes PDF Code ausführen kann. Sie setzt Formular-Skripte
  voraus, die Mietfuchs nicht einschaltet, betroffen war Mietfuchs also nicht. Mit dem Wegfall
  ist die Meldung trotzdem erledigt.
- **Ein Backup wird vollständig geprüft, bevor die Wiederherstellung etwas ersetzt.** Ein
  präpariertes Archiv konnte bisher die Daten ersetzen und danach abbrechen, sodass ein halb
  wiederhergestellter Stand übrig blieb. Jetzt werden verdächtige Einträge abgelehnt, und
  ausgepackt darf ein Backup höchstens 1 GB groß werden.
  ([#23](https://github.com/speedone/mietfuchs/issues/23))
- **Alle Abhängigkeiten sind auf dem neuesten Stand**, darunter Express 5, Vite 8 und
  TypeScript 7. Damit sind die von `npm audit` gemeldeten Lücken geschlossen, etwa in `multer`
  (Überlastung durch präparierte Uploads) und `adm-zip` (übermäßiger Speicherverbrauch beim
  Wiederherstellen). Dependabot hält sie künftig aktuell.
  ([#23](https://github.com/speedone/mietfuchs/issues/23))

## [0.5.0] – 2026-09-19

### Hinzugefügt

- **Hinweis auf neue Versionen.** Beim ersten Start fragt Mietfuchs einmal, ob es bei neuen
  Versionen Bescheid geben soll. Nur mit Zustimmung sieht es beim Öffnen bei GitHub nach.
  GitHub sieht dabei nur die IP-Adresse und die installierte Versionsnummer. Gibt es eine neue
  Version, erscheint oben in der Seitenleiste ein Hinweis. Er führt zu einer Anleitung in den
  Einstellungen: bei der Programmdatei mit dem Download der passenden Datei und den Schritten
  für das eigene System, bei Docker und bei einer Installation aus dem Quellcode mit den
  nötigen Befehlen. „Später“ blendet den Hinweis bis zur nächsten Version aus. In den
  Einstellungen lässt sich die Prüfung jederzeit ein- und ausschalten oder von Hand anstoßen.
  Ein automatisches Update gibt es bewusst nicht.
  ([#14](https://github.com/speedone/mietfuchs/issues/14))

### Geändert

- **Docker-Image läuft mit Node 24.** Das ist die aktuelle LTS-Version von Node mit
  Sicherheitsupdates bis April 2028. Bisher lief das Image mit Node 22.
  ([#15](https://github.com/speedone/mietfuchs/issues/15))

### Behoben

- **Backup-Knöpfe in den Einstellungen sehen wie Knöpfe aus.** „Backup herunterladen“ erschien
  als einfacher Link und „Backup wiederherstellen“ wie normaler Text, obwohl beide anklickbar
  sind.
- **Die Zustandsprüfung `/healthz` nennt in der Programmdatei die richtige Version** statt
  „unbekannt“.

### Hinweise zur Aktualisierung

- Wer Mietfuchs aus dem Quellcode mit `npm start` betreibt, braucht jetzt mindestens
  Node 22.12. Node 20 bekommt seit April 2026 keine Sicherheitsupdates mehr und wird nicht mehr
  getestet. Programmdateien und Docker-Image bringen ihre Laufzeit selbst mit, dort ist nichts
  zu tun.

## [0.4.0] – 2026-09-19

### Hinzugefügt

- **Zustandsprüfung unter `/healthz`** für den Betrieb im Container. Die Adresse meldet
  „ok“, wenn die Daten lesbar sind und der Datenordner beschreibbar ist. Sonst antwortet
  sie mit HTTP 503, etwa bei einer beschädigten `db.json` oder einem schreibgeschützt
  eingehängten Datenordner. Das Docker-Image nutzt sie als `HEALTHCHECK`: `docker ps` zeigt
  dann *healthy* oder *unhealthy* an, auch wenn der Prozess hängt. Beitrag von
  [@thorstenhornung1](https://github.com/thorstenhornung1) in
  [#12](https://github.com/speedone/mietfuchs/pull/12).

### Behoben

- **Fehlende Verteilbasis wird gemeldet.** Fehlte bei einer Wohnung der Abrechnungseinheit die
  Wohnfläche oder bei einem Mietverhältnis die Personenzahl, verteilte der Schlüssel deren
  Anteil kommentarlos auf die übrigen Wohnungen: Die anderen Mieter zahlten mit. Fehlte die
  Angabe überall, ging der Betrag ebenso kommentarlos an den Vermieter, und dasselbe galt für
  eine Direktzuordnung auf eine Wohnung außerhalb der Abrechnungseinheit. Die Abrechnung meldet
  diese Fälle jetzt und nennt die betroffene Wohnung. Leerstand und Eigennutzung bleiben ohne
  Meldung. Außerdem bricht die Berechnung nicht mehr ab, wenn bei einer Wohnung die Angabe der
  Wohnfläche ganz fehlt. Beitrag von [@thorstenhornung1](https://github.com/thorstenhornung1) in
  [#10](https://github.com/speedone/mietfuchs/pull/10).
  ([#7](https://github.com/speedone/mietfuchs/issues/7))
- **§35a-Bescheinigung übersteigt nie den Lohnanteil der Rechnung.** Der Lohnanteil wurde je
  Abrechnungszeile einzeln gerundet. Zusammen konnten die Mieter dadurch mehr bescheinigt
  bekommen, als die Rechnung enthält, etwa 3 × 66,67 € = 200,01 € bei 200,00 € Lohnanteil.
  Jetzt bekommen die Mieter zusammen den auf ihre Kostenanteile entfallenden Lohnanteil,
  kaufmännisch gerundet und höchstens den der Rechnung. Diese Summe wird wie die Kosten
  centgenau verteilt. Tragen die Mieter die Position vollständig, stimmt die Summe genau.
  Ein negativer oder zu hoher Lohnanteil wird nicht bescheinigt, sondern gemeldet, und das
  Formular lehnt einen negativen Lohnanteil jetzt ab. Beitrag von
  [@thorstenhornung1](https://github.com/thorstenhornung1) in
  [#11](https://github.com/speedone/mietfuchs/pull/11).
  ([#7](https://github.com/speedone/mietfuchs/issues/7))

### Hinweise zur Aktualisierung

- In noch nicht abgeschlossenen Jahren kann sich der §35a-Betrag eines Mieters um 1 ct ändern.
  Die Kosten selbst und abgeschlossene Abrechnungen bleiben unverändert.

## [0.3.1] – 2026-09-19

### Behoben

- **Linux-Programmdatei startet auch ohne grafische Oberfläche.** Fehlte `xdg-open` — auf
  einem Server, in einem Container oder bei Anmeldung per SSH —, beendete sich die
  Programmdatei direkt nach dem Start, obwohl der Server schon lief. Jetzt erscheint ein
  Hinweis, die Adresse von Hand im Browser zu öffnen, und Mietfuchs läuft weiter. Beitrag von
  [@thorstenhornung1](https://github.com/thorstenhornung1) in
  [#8](https://github.com/speedone/mietfuchs/pull/8).
  ([#7](https://github.com/speedone/mietfuchs/issues/7))
- **Rundungscent hängt nicht mehr von der Reihenfolge der Daten ab.** Haben mehrere
  Mietverhältnisse exakt gleiche Anteile, etwa bei drei gleich großen Wohnungen, bleibt beim
  Verteilen ein Cent übrig. Wer ihn trägt, entschied bisher die Reihenfolge der
  Mietverhältnisse in der Datendatei. Jetzt entscheidet die interne Kennung des
  Mietverhältnisses, sodass dieselben Daten immer dieselbe Abrechnung ergeben. Beitrag von
  [@thorstenhornung1](https://github.com/thorstenhornung1) in
  [#9](https://github.com/speedone/mietfuchs/pull/9).
  ([#7](https://github.com/speedone/mietfuchs/issues/7))

### Hinweise zur Aktualisierung

- In noch nicht abgeschlossenen Jahren kann der Rundungscent bei gleichen Anteilen einem
  anderen Mieter zufallen als vorher. Abgeschlossene Abrechnungen bleiben unverändert.

## [0.3.0] – 2026-09-18

### Hinzugefügt

- **Nutzungsart je Wohnung.** Eine Wohnung ist jetzt entweder *vermietet*, *selbstgenutzt*
  oder *nicht beteiligt*. Selbstgenutzte Wohnungen zählen in die Verteilbasis von Wohnfläche,
  Wohneinheiten und Personenzahl; ihr Anteil erscheint im Vermieteranteil. Hintergrund:
  Betriebskosten aus einer Rechnung über das ganze Haus dürfen nur anteilig auf die Mieter
  umgelegt werden — der auf eine selbstgenutzte Wohnung entfallende Teil bleibt beim Vermieter,
  genauso wie der Anteil leerstehender Wohnungen. Für den Personenschlüssel lässt sich die
  Personenzahl des eigenen Haushalts hinterlegen.
  ([#3](https://github.com/speedone/mietfuchs/issues/3))
- **Umlageschlüssel „nach vereinbarten Anteilen (%)".** Feste Prozentanteile je Wohnung, wie
  sie im Mietvertrag vereinbart sein können (§556a Abs. 1 BGB). Die Anteile gelten absolut:
  Was unter 100 % fehlt, trägt der Vermieter — so lässt sich ein vereinbarter Eigenanteil
  abbilden. Bei einem Mieterwechsel wird der Anteil tagesanteilig geteilt.
  ([#5](https://github.com/speedone/mietfuchs/issues/5))
- **Eigenanteil als Betrag.** Abrechnung und Steuerübersicht weisen aus, welcher Teil des
  Vermieteranteils auf selbstgenutzte Wohnungen entfällt. Für die Anlage V ist dieser Teil
  privat veranlasst und damit nicht als Werbungskosten abziehbar; die Aufteilung nimmt die
  Übersicht weiterhin nicht automatisch vor.
- **Prüfzeile „Verteilbasis" im Cockpit.** Weist auf Wohnungen hin, die als *nicht beteiligt*
  geführt werden, obwohl sie eine Wohnfläche haben — in diesem Fall tragen die Mieter deren
  Anteil mit.
- **Fertiges Docker-Image.** Das Image wird für `linux/amd64` und `linux/arm64` nach
  `ghcr.io/speedone/mietfuchs` veröffentlicht. Damit lässt sich Mietfuchs per `docker run`
  oder mit einer eigenständigen Compose-Datei starten, ohne das Repository zu klonen.
  ([#4](https://github.com/speedone/mietfuchs/issues/4))
- **`NKA_DATA_DIR`** verlegt den Datenordner auf einen beliebigen Pfad. Gedacht für Tests
  gegen einen Wegwerf-Ordner und für Installationen, deren Daten woanders liegen sollen.

### Behoben

- **Downloads für macOS und Linux lassen sich wieder direkt starten.** Die Programmdateien
  kommen jetzt als `.zip` (macOS) bzw. `.tar.gz` (Linux) statt als rohe Datei: HTTP überträgt
  keine Dateirechte, rohe Downloads verloren deshalb das Ausführungsrecht. Die Archive
  erhalten es, ein `chmod +x` entfällt. Die README beschreibt außerdem den seit macOS 15
  gültigen Weg, eine nicht signierte Programmdatei freizugeben. Beitrag von
  [@thorstenhornung1](https://github.com/thorstenhornung1) in
  [#2](https://github.com/speedone/mietfuchs/pull/2).
  ([#1](https://github.com/speedone/mietfuchs/issues/1))
- **Zählertyp wurde falsch gespeichert.** Das Feld war mit „Kaltwasser" vorbelegt, die Auswahl
  bot aber nur Typen an, für die Wohnungszähler existieren. Ohne Kaltwasserzähler zeigte das
  Feld deshalb den ersten angebotenen Typ an, gespeichert wurde trotzdem „Kaltwasser": die
  Kostenposition fand keinen passenden Verbrauch und landete vollständig im Vermieteranteil.
  Das Feld verlangt nun eine ausdrückliche Auswahl.
  ([#6](https://github.com/speedone/mietfuchs/issues/6))
- **Verteilbasis bei nicht vermieteten Wohnungen.** Wohnungen ohne Beteiligung fielen
  vollständig aus der Basis von Wohnfläche, Wohneinheiten und Personenzahl — die Mieter trugen
  dadurch den gesamten Rechnungsbetrag. Die neue Nutzungsart *selbstgenutzt* behebt das, sobald
  sie gesetzt ist (siehe *Hinweise zur Aktualisierung*). Beim Verbrauchsschlüssel war das schon
  vorher richtig, weil ein eigener Zähler die Basis mitbildet.
  ([#3](https://github.com/speedone/mietfuchs/issues/3))
- **Direktzuordnung auf eine nicht beteiligte Wohnung ließ einen Betrag verschwinden.** Bestand
  für die Wohnung im Abrechnungsjahr noch ein Mietverhältnis, wurde deren Anteil als verteilt
  gebucht, obwohl ihn niemand erhielt: Mieteranteile plus Vermieteranteil ergaben dann weniger
  als die Gesamtkosten. Der Betrag läuft jetzt in den Vermieteranteil.
- **Robustheit der Verteilung gegenüber unplausiblen Daten.** Prozentanteile über 100 % werden
  nicht mehr verteilt (sie hätten auch den §35a-Anteil über den Rechnungsbetrag getrieben),
  eine negative Personenzahl der eigenen Wohnung kann die Verteilbasis nicht mehr verkleinern,
  und widersprüchliche Kennzeichen an einer Wohnung (vermietet *und* selbstgenutzt) gelten als
  vermietet. Verweise auf gelöschte Wohnungen — bei Direktzuordnung wie bei Prozentanteilen —
  und fehlende Angaben an der selbstgenutzten Wohnung (Fläche, Personenzahl) erzeugen jetzt
  eine Warnung in der Abrechnung, statt stillschweigend die Mieter zu belasten.
- **Steuerübersicht folgt abgeschlossenen Abrechnungen.** Der ausgewiesene Eigenanteil stammt
  bei einer eingefrorenen Abrechnung aus deren Snapshot, damit Übersicht und versendete
  Abrechnung nicht auseinanderlaufen.
- **Packaging bricht bei echten Archivfehlern ab.** Bisher wurde jeder Fehler beim Verpacken
  als „Werkzeug nicht verfügbar" abgetan; ein fehlgeschlagenes Archiv fiel erst beim
  Release-Upload auf.

### Hinweise zur Aktualisierung

- Bestehende Daten rechnen unverändert weiter: Die Nutzungsart wird **nicht** automatisch
  gesetzt, weil das die Verteilung bereits abgerechneter Jahre verändern würde. Selbstgenutzte
  Wohnungen sind in den Stammdaten einmalig auf *Eigennutzung* zu stellen; das Cockpit weist
  darauf hin. Abgeschlossene (eingefrorene) Abrechnungen bleiben in jedem Fall unberührt.
- Kostenpositionen, die vor diesem Update mit Verbrauchsumlage gespeichert wurden, können noch
  den falschen Zählertyp „Kaltwasser" tragen. Die Auswahl zeigt den gespeicherten Typ jetzt
  korrekt an — betroffene Positionen einmal öffnen, den richtigen Typ wählen und speichern.

## [0.2.1] – 2026-07-07

### Behoben

- Die gepackte Binary öffnet den Browser auf `127.0.0.1` statt `localhost` — unter Windows
  führte die Namensauflösung sonst gelegentlich auf eine IPv6-Adresse, auf der der Server
  nicht lauschte.

## [0.2.0] – 2026-07-07

### Hinzugefügt

- **Eigenständige Binaries** für Windows, macOS (Intel und Apple Silicon) und Linux, gebaut
  per Bun `--compile`. Eine Datei, kein Node nötig; die Daten liegen im Ordner `data/` neben
  der Programmdatei, der Browser öffnet sich automatisch.
- README-Anleitung zum Herunterladen und Starten der fertigen Binaries.

## [0.1.1] – 2026-07-07

### Behoben

- Fokus-Handling im Drawer stabilisiert.
- Routing des Dev-Proxys auf IPv6-Hosts korrigiert.

## [0.1.0] – 2026-06-13

Erste öffentliche Version: Erfassung von Kosten, Belegen und Zählerständen, centgenaue
Verteilung nach Wohnfläche, Personenzahl, Wohneinheiten, Verbrauch oder Direktzuordnung,
druckfertige Abrechnung je Mieter, Mietkonto, Steuerübersicht für die Anlage V, optionale
KI-Belegauswertung gegen eine lokale Ollama-Instanz, Backup und Wiederherstellung.

[Unveröffentlicht]: https://github.com/speedone/mietfuchs/compare/v0.11.3...HEAD
[0.11.3]: https://github.com/speedone/mietfuchs/compare/v0.11.2...v0.11.3
[0.11.2]: https://github.com/speedone/mietfuchs/compare/v0.11.1...v0.11.2
[0.11.1]: https://github.com/speedone/mietfuchs/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/speedone/mietfuchs/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/speedone/mietfuchs/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/speedone/mietfuchs/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/speedone/mietfuchs/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/speedone/mietfuchs/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/speedone/mietfuchs/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/speedone/mietfuchs/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/speedone/mietfuchs/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/speedone/mietfuchs/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/speedone/mietfuchs/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/speedone/mietfuchs/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/speedone/mietfuchs/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/speedone/mietfuchs/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/speedone/mietfuchs/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/speedone/mietfuchs/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/speedone/mietfuchs/releases/tag/v0.1.0
