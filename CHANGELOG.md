# Changelog

Alle nennenswerten Änderungen an Mietfuchs. Das Format orientiert sich an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionen an
[Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

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

[Unveröffentlicht]: https://github.com/speedone/mietfuchs/compare/v0.10.0...HEAD
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
