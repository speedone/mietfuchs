# Changelog

Alle nennenswerten Änderungen an Mietfuchs. Das Format orientiert sich an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionen an
[Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

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
  bleibt dabei als `mietfuchs.sqlite.vor-restore` liegen, wie die `db.json.vor-restore` daneben.
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

[Unveröffentlicht]: https://github.com/speedone/mietfuchs/compare/v0.7.1...HEAD
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
