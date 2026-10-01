# Belegordner (#170)

## Ziel

Das Belegarchiv war eine einzige Liste aller Belege der Installation, nach Hochladedatum, ohne
Filter, ohne Suche. Nach ein paar Jahren und mit mehreren Objekten sieht man nicht mehr, welcher
Beleg zu welchem Haus gehört, und nicht, welcher fehlt. Vorbild ist der Ordner aus Papier: ein
Ordner je Haus und Jahr, ein Register je Kostenart. Dazu, was Papier nicht kann: zeigen, was fehlt,
alles wiederfinden, die Mappe für Mieter und Steuerberater selbst packen.

Umgesetzt in vier Etappen, jede mit eigenen Commits:

| Etappe | Inhalt |
| --- | --- |
| E1 | Filter Objekt und Jahr, Register je Kostenart mit Summe, Karten mit Vorschaubild, Suche, Prüfsumme |
| E2 | Belegabdeckung je Objekt und Jahr, „Beleg nachreichen“ an der Position, Cockpit-Zeile |
| E3 | Tabelle `uploads`, Posteingang (Hochladen im Ordner, Zuordnen, KI), Backup, Umstieg |
| E4 | Belegmappe für Mieter (PDF), Belege für die Steuer (ZIP) |

## Entscheidungen

### 1. Die Datei ist der Beleg, die Zeile nur eine Beschreibung

Die neue Tabelle `uploads` (Migration `0012_belege`, erzeugt mit `db:generate`) führt je Datei
Originalname, Art, Größe, SHA-256, genaue Hochladezeit und Rechnungsdatum. **Eine fehlende Zeile
ist kein Fehler.** Alles, was vor der Tabelle hochgeladen wurde, und jeder Beleg aus einem Backup
einer älteren Version hat keine, und diese Belege sollen trotzdem vollständig dastehen. Die Route
beschreibt sie dann aus der Datei (`describeFile` in `server/src/uploads.ts`): Originalname und
Hochladezeit aus dem Namen `<Date.now()>_<Name>`, Art aus der Endung, Prüfsumme gerechnet und je
Stand der Datei gemerkt.

Die Hochladezeit kommt aus dem Zeitstempel im Namen und **nicht aus der Zeit der Datei**: Ein ZIP
speichert sie auf zwei Sekunden genau und in Ortszeit ohne Zone, ein Backup aus dem Docker-Image
verschob die Anzeige nach dem Wiederherstellen um ein bis zwei Stunden (Kommentar im Issue).

Kein Fremdschlüssel von `cost_items.invoice_file` auf die Tabelle: Er lehnte genau die Belege ohne
Zeile ab. Die Liste antwortet auch ohne Datenbank, dann ohne Posteingang, denn Belege sind Dateien.

### 2. Objekt und Jahr nur für den Posteingang

Ein Beleg, der an einer Position hängt, hat Objekt und Jahr seiner Positionen. Trüge die Zeile sie
ebenfalls, liefen zwei Wahrheiten auseinander, sobald jemand eine Position verschiebt. Die Spalten
`property_id` und `year` sagen deshalb nur, wohin ein noch nicht verknüpfter Beleg gedacht ist.
Ein Beleg ohne Zuordnung steht im Posteingang jedes Objekts, denn er wartet genau darauf.
`property_id` hat `ON DELETE SET NULL`: Ein (leeres) Objekt zu löschen schiebt seine Belege in den
Posteingang ohne Objekt zurück, statt sie mitzunehmen.

„Unverknüpft“ wird damit ein Arbeitsschritt statt eines Fehlerzustands: Hochladen (mehrere, auch
per Ziehen) → Posteingang → einer Position zuordnen oder per KI auswerten.

### 3. KI aus dem Posteingang ohne zweites Hochladen

Die Schnellerfassung übernimmt Belege aus dem Posteingang (`handoff` über App.tsx). Der Browser
holt die Datei aus dem Ordner, weil er PDFs vor der Auswertung selbst liest (#21), und schickt dem
Server nur ihren Namen im Feld `existingFile`. Sonst läge danach eine Kopie im Ordner, die die
Prüfsumme sofort als doppelt meldet. Ein Abbruch löscht einen solchen Beleg nicht, denn er gehörte
schon vorher dem Vermieter. Das Rechnungsdatum, das die KI liest, kommt an den Beleg.

### 4. Doppelte am Inhalt

Gleicher Inhalt heißt gleiche Prüfsumme, auch unter anderem Namen und bevor der Beleg an einer
Position hängt. Die frühere Regel „gleiche Dateigröße“ entfällt (zwei Scans desselben Geräts sind
oft gleich groß). „Gleicher Steller, gleiche Summe, gleiches Jahr“ bleibt ein schwächerer Verdacht.

### 5. Belegabdeckung am Betrag, Ampel höchstens gelb

Gemessen wird der Anteil der Kosten mit Beleg, nicht der Anteil der Positionen: Ein fehlender
Grundsteuerbescheid wiegt schwerer als eine Quittung über 4 €. Eine Gutschrift zählt mit ihrem
Betrag, eine Position über 0 € gar nicht, ein Verweis auf eine fehlende Datei als fehlend. 100 %
erscheint nur, wenn wirklich nichts fehlt. Die Cockpit-Zeile „Belege vollständig“ wird **nie
rot**: Rot heißt dort, die Abrechnung lässt sich so nicht erstellen, und ein fehlender Beleg
ändert keine Zahl. Wichtig wird er erst, wenn ein Mieter Einsicht verlangt.

### 6. Löschen

Unverändert gilt: gelöscht wird nur, was an keiner Position **irgendeines** Objekts hängt
(`invoiceFilesInUse` fragt ohne Objekt). Die Zeile geht mit. Ein Beleg darf an Positionen
mehrerer Objekte hängen; eine Rechnung über zwei Häuser ist erlaubt (#95).

### 7. Backup, Umstieg, eingefrorener Eingang

Die Tabelle steckt im Schnappschuss der Datenbank (`VACUUM INTO`) und kommt so ins Backup und
zurück, auf die Millisekunde. Ein Archiv ohne sie (nur `db.json` oder eine Datenbank vor 0012)
ergibt nach dem Wiederherstellen eine leere Tabelle; seine Belege stehen ohne Angaben im
Posteingang. Der Umstieg aus einer `db.json` hinterlässt die Tabelle leer. Der eingefrorene
Eingang (`server/src/legacy/`) und seine Prüfsummen sind unberührt: Die Tabelle entsteht in der
Kette nach 0000. Praxislauf Fall 13 prüft Backup und Wiederherstellen mit Posteingang über zwei
Starts.

### 8. Belege für die Steuer: Server, adm-zip

Ein ZIP je Objekt und Jahr (`GET /api/receipts/tax/:year?property=`), ein Ordner je Gruppe aus
`ANLAGE_V_GROUP` in der Reihenfolge der Steuerübersicht, die Zuführung zur Erhaltungsrücklage
gesondert (#143), **alle** Positionen einschließlich der nicht umlagefähigen. Ein Beleg für mehrere
Positionen derselben Gruppe liegt einmal darin. Dazu `Übersicht.csv` (UTF-8 mit BOM für Excel,
Semikolon, Dezimalkomma) mit jeder Position, auch ohne Beleg („kein Beleg“, „Datei fehlt“): Was
fehlt, soll der Steuerberater sehen. Gebaut auf dem Server, weil adm-zip dort ohnehin ist und die
Dateien dort liegen.

### 9. Belegmappe für Mieter: Browser, pdf-lib

Eine PDF je Objekt und Jahr: Deckblatt „Nr. · Position · Betrag · Beleg · Seite“, danach die
Belege, jede Seite nummeriert („Seite 7 von 12“), damit sich der Verweis auch ausgedruckt findet.
Reihenfolge: die Zeilen der Mieter in der Abrechnung, über alle Mieter vereinigt (bei einer
abgeschlossenen Abrechnung die eingefrorene). Nur **umgelegte** Positionen; nicht Umlagefähiges
und der Vermieteranteil gehören in die Steuermappe. Ein Beleg für mehrere Positionen liegt einmal
bei, das Deckblatt verweist mehrfach auf dieselbe Seite.

**Neue Abhängigkeit pdf-lib 1.17.1** (MIT, reines JavaScript, Abhängigkeiten pako, tslib und zwei
eigene Pakete; rund 18 Mio. Abrufe je Woche). Erwogen: ein eigener kleiner PDF-Schreiber aus
pdf.js-Seitenbildern (keine Abhängigkeit, aber jede Textebene ginge verloren und die Datei würde
groß) und der gepflegte Ableger `@cantoo/pdf-lib` (aktiver, aber eine Größenordnung weniger
verbreitet). pdf-lib ist seit 2021 unverändert, dafür ausgereift; ein Wechsel auf den Ableger
betrifft nur `client/src/tenantFolder.ts`. Für die Programmdateien unkritisch: Das Frontend wird
eingebettet, natives gibt es nicht. pdf-lib wird erst beim Erstellen geladen (eigener Teil, rund
430 kB), damit die Seite schlank bleibt. Ein PDF, das pdf-lib nicht übernehmen kann (verschlüsselt,
beschädigt), und Bildformate außer JPEG/PNG kommen über pdf.js beziehungsweise ein Canvas als
Seitenbilder hinein. Die Standardschrift kennt nur WinAnsi; `winAnsiSafe` ersetzt, was fehlt.

## Rechtliches: Was in die Mieter-Mappe gehört

**Wortlaut.** § 556 Abs. 4 BGB lautet seit dem 01.01.2025: „Der Vermieter hat dem Mieter auf
Verlangen Einsicht in die der Abrechnung zugrundeliegenden Belege zu gewähren. Der Vermieter ist
berechtigt, die Belege elektronisch bereitzustellen.“
([gesetze-im-internet.de/bgb/__556.html](https://www.gesetze-im-internet.de/bgb/__556.html),
gelesen am 02.10.2026; eingefügt durch das Vierte Bürokratieentlastungsgesetz, BGBl. 2024 I
Nr. 323, laut Rechtsdurchsicht im Issue.) Die Mappe ist genau dieses elektronische Bereitstellen.
Zwei Folgerungen: Es geht um die Belege, die **der Abrechnung zugrunde liegen**, also die
umgelegten Positionen, und es ist ein Recht **auf Verlangen**, keine Pflicht, jedem Mieter
unaufgefordert alles mitzugeben.

**Einzelverbrauchsdaten anderer Mieter.** Der BGH hat entschieden, dass der Mieter „die
Einsichtnahme in die vom Vermieter erhobenen Einzelverbrauchsdaten anderer Nutzer eines gemeinsam
versorgten Mietobjekts hinsichtlich der Heizkosten beanspruchen“ kann; ein besonderes Interesse
muss er nicht darlegen, das allgemeine Interesse, die Abrechnung zu kontrollieren, genügt (Urteil
vom 07.02.2018, VIII ZR 189/17, Pressemitteilung Nr. 25/2018,
[bundesgerichtshof.de](https://www.bundesgerichtshof.de/SharedDocs/Pressemitteilungen/DE/2018/2018025.html)).
Die Pressemitteilung äußert sich zum Datenschutz nicht ausdrücklich; eine Sekundärquelle
(Fundstellenübersicht bei [dejure.org](https://dejure.org/dienste/vernetzung/rechtsprechung?Gericht=BGH&Datum=07.02.2018&Aktenzeichen=VIII%20ZR%20189/17))
fasst das Urteil so zusammen, dass Datenschutzbedenken dem Kontrollrecht nachstehen. Den Volltext
habe ich nicht gelesen.

**Entscheidung.** Voreinstellung sind die Belege der umgelegten Positionen. Belege zu Positionen
mit dem Schlüssel „Einzelbeträge je Mieter“ (typisch: Abrechnung eines Messdienstes mit Beträgen
und Verbrauchswerten aller Wohnungen, oft mit Namen) kommen **nur auf ausdrückliche Wahl** hinein,
mit Hinweis; sonst stehen sie auf dem Deckblatt mit „auf Anfrage“. Begründung: Einsehen darf der
Mieter sie (BGH, oben), aber nur auf Verlangen, und Art. 5 Abs. 1 lit. c DSGVO
(Datenminimierung) spricht dagegen, die Daten aller Mieter jedem Mieter unaufgefordert
mitzugeben. Die Abwägung mit der DSGVO ist **eigene Einschätzung** und nicht durch Rechtsprechung
belegt. Bewusst eng gezogen: Positionen nach Verbrauch (`meter`) verteilt Mietfuchs selbst aus
den erfassten Ständen, ihr Beleg ist die Rechnung des Versorgers über das ganze Haus und nennt
keine Mieter; eine Messdienst-Abrechnung kommt nach CLAUDE.md über Einzelbeträge herein.

**Nicht belegt** (Suchbudget der Sitzung erschöpft, die Recherche über einen Hilfsagenten blieb an
einer Freigabe hängen): ob die Gesetzesbegründung zu „elektronisch bereitstellen“ bestimmte Wege
(E-Mail, Portal) nennt oder das Recht auf Einsicht in Papier unberührt lässt; der Anspruch auf
Kopien gegen Kostenerstattung nach älterer BGH-Rechtsprechung; ob § 556 Abs. 4 nur für Wohnraum
gilt (die Vorschrift steht im Untertitel über Wohnraummietverhältnisse, die Sekundärquelle der
Rechtsdurchsicht sagt dasselbe). Die Oberfläche sagt dazu deshalb nichts.

## Folgearbeit

- **Ziehen auf eine Position** („Beleg hierher ziehen“): Heute geht Nachreichen über Hochladen
  oder die Auswahl aus dem Posteingang; Ziehen gibt es nur in den Posteingang.
- **Rechnungsdatum von Hand eintragen**: Die Route nimmt `invoiceDate` an, die Oberfläche zeigt es
  nur an; ein Feld auf der Karte fehlt noch. Ohne KI-Auswertung steht deshalb das Hochladedatum da.
- **Mehrere Belege auf einmal per KI auswerten** aus dem Posteingang: Die Übergabe nimmt eine
  Liste, die Oberfläche bietet je Karte einen Knopf.
- **Mappe je Mieter** statt je Objekt, etwa nur mit den Positionen, an denen er beteiligt ist
  (Teilnehmer, #94); heute enthält die Mappe die Positionen aller Mieterzeilen.
- **Anlage-V-Mappe bei Eigennutzung** (#163): Das ZIP ordnet nach Gruppen, teilt aber nichts nach
  Eigennutzung auf.
- **Vorschaubilder** rendern alle sichtbaren PDFs gleichzeitig; bei sehr vielen Belegen wäre eine
  Begrenzung oder ein Laden beim Sichtbarwerden schonender.
- Rechtliche Lücken oben (Gesetzesbegründung, Kopien, Wohnraum) mit Primärquelle schließen.
