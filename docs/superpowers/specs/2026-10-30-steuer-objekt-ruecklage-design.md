# Steuer je Objekt: Entnahmen aus der Erhaltungsrücklage, Kopfangaben der Anlage V, Gesamtsicht (#96)

Teil von #91, Teilprojekt 5. Gehört zum Release „Quellrechnung und Steuerjahr“ (0.14.0), zusammen mit #455, #312, #262
und #478, dazu #281; Reihenfolge und Migrationen im Release-Plan (`2026-10-30-release-0.14-plan.md`).
Rechtsaussagen tragen ihre Quelle; was nicht amtlich belegt ist, steht als **Auslegung** da. Fachfragen entscheidet
dieser Entwurf selbst; die Entscheidungen des Leads stehen am Ende.

**Stand nach der Durchsicht** (`2026-10-30-crossreview.md`): eingearbeitet sind X1, X3, X5 bis X11 und R-A bis R-H
samt den kleinen Befunden.

## Leitsatz

**Wer kein Kennzeichen setzt und keine neue Kostenart wählt, sieht keine andere Zahl.** Alle neuen Angaben sind
optional und leer voreingestellt, die neue Kostenart kommt in keinem Bestand vor, und die Prüfsummen in
`server/test/fixtures/tax-golden.json` bleiben unverändert (Begründung unter „Golden-Tests“).

## Stand auf `main` (8fbce5f6): was aus #96 schon erledigt ist

Geprüft an Code, Tests und CHANGELOG, nicht nur an den Issue-Kommentaren.

| Punkt aus #96 | Stand | Wo |
|---|---|---|
| Steuerübersicht je Objekt | erledigt (#92) | `taxReportFor(source, propertyId, year)`, calc.ts |
| Zuführung zur Erhaltungsrücklage nicht in den Werbungskosten | erledigt (#143, v0.9.0) | Kostenart „Zuführung Erhaltungsrücklage“, `ANLAGE_V_GROUP[…] = null`, `reserveContributionCents`, Hinweis `reserveContribution` |
| Hinweis, wenn „Nicht umlagefähig“ wie eine Zuführung aussieht | erledigt (#143) | `reserveSuspects`, `looksLikeReserveContribution` |
| Eigentumswohnung: abgeflossen ist das gezahlte Hausgeld | als Hinweis erledigt (#143) | `etwHousingMoney` in taxView.ts |
| Entnahme aus der Rücklage | **teilweise**: Die KI und `matchCategory` schlagen „Nicht umlagefähig“ vor; sie zählt damit in den Werbungskosten, im Jahr der Abrechnung. Keine eigene Zeile, kein Hinweis auf Z. 55/56, kein Schutz gegen ein Zahlungsdatum des Eigentümers | shared/categories.ts, extract.ts |
| Zeilen 11/12 (Gesamtwohnfläche, eigengenutzt) | erledigt (#163, v0.10.0) | `totalAreaM2`, `selfUsedAreaM2`, Hinweis mit Zeilen 11/12 für 2025 |
| Zeile 24 (Inklusivmiete), Zeile 20 (Pauschale) | erledigt (#132) | `costModels`, Hinweise `inclusiveLine24…` |
| Zeile 21 (Nachzahlungen/Erstattungen nach Zufluss) | erledigt (#280), Zeilen 2023 bis 2025 | `settlementLine` in taxView.ts |
| Werbungskosten nach Abfluss (Zahlungsdatum je Beleg) | erledigt (#255) | `outflowShares` in outflow.ts |
| Teilweise Eigennutzung (Kopfkarte mit privatem Anteil) | erledigt (#163) | `splitForTax`, `deductibleCents` |
| Verbilligte Vermietung (Z. 87/88) | erledigt (#257) | cheapRent.ts |
| Kopfangaben Z. 6 (Aktenzeichen), Z. 7 (Daten), Z. 10 (Angehörige, Ferienwohnung) | **offen** | kein Feld am Objekt oder Mietverhältnis |
| Mieteinnahmen getrennt nach Kaltmiete/Umlagen nach Zufluss | offen, **gehört zu #312** | |
| Trennung nach Angehörigen (Z. 19, 22, 23) | offen; das Kennzeichen kommt hier (PR 2), die Beträge rechnet #312 PR 2 direkt danach | |
| Gesamtsicht über alle Objekte | **offen** | |
| Miteigentum | bleibt draußen (#96) | |
| § 35a in der Abrechnung getrennt nach Abs. 2/3, „unbar gezahlt“ | offen, gehört nicht zum Steuerjahr, sondern zur Abrechnung; eigenes Issue | |

Offen bleiben also für diesen Entwurf: **(A)** die Entnahme mit eigener Kostenart, Zeile und Jahresregel, dazu
Sonderumlage und die Drei-Jahres-Frist, **(B)** die Kopfangaben Z. 6, 7 und 10, **(C)** die Gesamtsicht.

## Rechtslage

**R1. Zuführung ist keine Werbungskosten, die Verausgabung durch die Gemeinschaft ist es.** „Der hierfür erforderliche
Veranlassungszusammenhang zur Vermietungstätigkeit besteht erst, wenn die Wohnungseigentümergemeinschaft die
angesammelten Mittel für Erhaltungsmaßnahmen verausgabt“ (BFH, Urteil vom 14.01.2025, IX R 19/24, Leitsatz und
Rz. 21: „Erst zu diesem Zeitpunkt kommen die aufgewandten Mittel dem vermieteten Objekt zugute“; Rz. 23: Die
Verausgabung ist das „auslösende Moment“, der Abzug wird verschoben, nicht versagt). Ständige Rechtsprechung seit
BFH, Urteil vom 26.01.1988, IX R 119/83, BFHE 152, 471 (zitiert in IX R 19/24, Rz. 13; H 21.2 EStH). Die Vorinstanz
FG Nürnberg, 12.03.2024, 1 K 866/23, wurde bestätigt. Die Anleitung zur Anlage V 2024 sagt es gleich: „Beiträge zur
Erhaltungsrücklage … können Sie nicht bereits zum Zeitpunkt der Abführung … abziehen, sondern erst dann, wenn das Geld
für Erhaltungsmaßnahmen ausgegeben wird“ (Erläuterung zu den Zeilen 55 bis 72).

**R2. Herstellungskosten aus der Rücklage sind keine Erhaltung.** Erst bei der Verausgabung steht fest, ob es
Erhaltungsaufwand oder Herstellungskosten sind (IX R 19/24, Rz. 13); auch Erhaltungsaufwand kann nach § 6 Abs. 1
Nr. 1a EStG zu Herstellungskosten werden (Rz. 24). Herstellungskosten wirken nur über die AfA, die Mietfuchs nicht
rechnet.

**R3. Der Vordruck nennt die Entnahme ausdrücklich.** Anlage V 2025 („2025AnlV101 – September 2025 –“, selbst gelesen):

- Z. 55/56 „2025 voll abzuziehende Erhaltungsaufwendungen (einschließlich Entnahmen aus der Erhaltungsrücklage)“, 55
  direkt zugeordnet (Kz. 36), 56 verhältnismäßig mit „Gesamtbetrag“ und „abzugsfähiger Anteil (in %)“ (Kz. 37).
- Z. 57–60 „Auf bis zu 5 Jahre zu verteilende Erhaltungsaufwendungen (einschließlich Entnahmen aus der
  Erhaltungsrücklage) – §§ 11a, 11b EStG, § 82b EStDV –“; Z. 61–72 die Anteile aus 2021 bis 2024.
- Z. 73–75 „Umgelegte Kosten“, Z. 76–78 „Nicht umgelegte Kosten (z. B. Verwaltungskosten, Bank- und
  Kontoführungsgebühren – ohne Erhaltungsrücklage –)“, Z. 80–82 „Sonstige Kosten“, Z. 83 Summe.

Die Anleitung 2024 (September 2024) nennt dieselben Zeilen 55–72, 73–75, 76–78, 80–82, 83 (selbst gelesen). Für
2024 und 2025 sind die Zeilen der Werbungskosten also belegt. Der Kopf unterscheidet sich: 2025 ist Z. 7 neu (Kauf-
bzw. Bauvorgang), Veräußerung rückt nach Z. 8, Nutzung nach Z. 10, Flächen Z. 11/12. In der Anleitung 2024 ist Z. 7
die Veräußerung, Z. 9 die Nutzung, „Zeile 10 bis 12“ die Flächen. Ein Vordruck 2026 ist nicht veröffentlicht (#110).

**R4. Welches Jahr: das der Ausgabe durch die Gemeinschaft, nicht das des Beschlusses.** Maßgeblich ist die
Verausgabung (R1), also die Zahlung der Gemeinschaft an den Handwerker. Weder der Beschluss über die Maßnahme noch
der Beschluss über die Jahresabrechnung (im Folgejahr) noch der Eingang der Abrechnung beim Eigentümer. Die
Jahresabrechnung der Gemeinschaft ist eine Einnahmen- und Ausgabenrechnung der tatsächlichen Zahlungen, die
Zuführung zur Rücklage ist darin keine Ausgabe (BGH, Urteil vom 04.12.2009, V ZR 44/09; Darstellung der Rücklage
zuletzt BGH, Urteil vom 25.09.2020, V ZR 80/19). Rücklagenentnahmen gehören nicht in die Abrechnungsspitze (BGH,
Urteil vom 11.04.2025, V ZR 96/24, siehe #110). **Folge: Die Entnahmen, die die Hausgeldabrechnung für das
Wirtschaftsjahr X ausweist, sind im Jahr X ausgegeben und dort Werbungskosten.** Das ist genau das Jahr der
Abrechnung, mit dem Mietfuchs eine Position ohne Datum ansetzt (`outflowShares`, Quelle `period`). **Auslegung:**
Bezahlt die Gemeinschaft im Januar X+1 eine Rechnung über Arbeiten aus X, steht sie in der Abrechnung X+1 und zählt
dort; das folgt aus der Ist-Rechnung der Gemeinschaft, ein Urteil eigens dazu ist nicht bekannt.

**R5. Sonderumlage.** Auch eine Sonderumlage ist erst abziehbar, wenn der Verwalter sie verausgabt (FG
Niedersachsen, Urteil vom 28.06.2005, laut Deubner, Aktenzeichen dort nicht genannt; trägt dieselbe Begründung wie
IX R 19/24). **Auslegung:** Fließt die Sonderumlage in die Rücklage, ist sie eine Zuführung; bezahlt die Gemeinschaft
damit unmittelbar eine Maßnahme, ist der eigene Anteil an der Maßnahme laut Jahresabrechnung im Jahr der Ausgabe
Erhaltungsaufwand. Die Zahlung des Eigentümers an die Gemeinschaft ist in keinem Fall das maßgebliche Datum.

**R6. Miterworbene Rücklage.** „Haben Sie beim Erwerb von Wohneigentum eine Erhaltungsrücklage miterworben, so gehört
diese nicht zur Bemessungsgrundlage für die Abschreibung. Zum Werbungskostenabzug beachten Sie bitte die Erläuterungen
zu den Zeilen 55 bis 72“ (Anleitung 2024). Entnahmen daraus sind also wie jede andere Entnahme zu behandeln.

**R7. Anschaffungsnahe Herstellungskosten.** Erhaltungsaufwand innerhalb von drei Jahren nach der Anschaffung, der
ohne Umsatzsteuer 15 % der Anschaffungskosten des Gebäudes übersteigt, ist Herstellungskosten (§ 6 Abs. 1 Nr. 1a
EStG; Anleitung 2024 zu Z. 55–72). Entnahmen zählen mit (IX R 19/24, Rz. 24). Mietfuchs kennt die
Anschaffungskosten nicht und kann nur auf die Frist hinweisen.

**R8. Kopf der Anlage V.** Vordruck 2025: Z. 4/5 Lage, Z. 6 „Aktenzeichen laut Grundsteuermessbescheid (ohne
Sonderzeichen) – bisher Einheitswert-Aktenzeichen –“, Z. 7 „Notar-/Kaufvertrag vom“, „Eigentumsübergang am“,
„Bauantrag/Bauanzeige/Baubeginnsanzeige vom“, „Fertig gestellt am“, Z. 8 Veräußerung, Z. 9
Wirtschafts-Identifikationsnummer, Z. 10 „ganz oder teilweise als Ferienwohnung genutzt (Kz. 61) / kurzfristig
vermietet (Kz. 63) / an Angehörige zu Wohnzwecken vermietet (Kz. 62)“, Z. 11 Gesamtwohnfläche (Kz. 54), Z. 12
eigengenutzt/unentgeltlich überlassen (Kz. 55) und Ferienwohnung (Kz. 56). Je bebautem Grundstück eine Anlage V mit
laufender Nummer (Kommentar in #96).

## Teil A: Entnahmen aus der Erhaltungsrücklage

### A1. Eigene Kostenart „Entnahme Erhaltungsrücklage“

**Entscheidung:** eine neue Kostenart, nicht umlagefähig, steuerlich Erhaltungsaufwand. Sie steht neben „Zuführung
Erhaltungsrücklage“ (#143), mit der gleichen Begründung: Der Vordruck behandelt sie anders als die übrigen nicht
umgelegten Kosten (R3), und eine Kostenart sieht der Nutzer in jeder Liste, ein Kennzeichen nicht. Ein Feld an „Nicht
umlagefähig“ wurde verworfen: Es wäre unsichtbar, und die KI-Auswertung könnte es nicht setzen.

Verhalten, **in allem wie „Nicht umlagefähig“, außer**:

| | „Nicht umlagefähig“ | „Entnahme Erhaltungsrücklage“ (neu) |
|---|---|---|
| Abrechnung | trägt der Vermieter | gleich |
| Steuer, Aufteilung bei Eigennutzung (#163) | nach betroffenen Einheiten bzw. Fläche, Zuordnung „Betrifft (für die Steuer)“ | gleich (`showsTaxUnitField`) |
| Verbilligte Vermietung (#257) | Gewicht nach Fläche | gleich |
| Gruppe in der Steuerübersicht | „Verwaltung & Instandhaltung“ (unverändert) | **„Erhaltungsaufwand“** (neue Gruppe, vor „Verwaltung & Instandhaltung“) |
| Zahlungsdatum (`paidOn`) | angeboten | **nicht angeboten, vom Server mit 400 abgelehnt** (A3) |
| Jahr der Zahlung (`taxYear`) | „Jahr der Zahlung“ | gleiches Feld, **immer sichtbar** (auch im Kalenderzeitraum, möglich durch #478), Beschriftung „Jahr, in dem die Gemeinschaft bezahlt hat“ mit Hilfe (R-G): „Steht in der Hausgeldabrechnung dieses Jahres (Entnahmen aus der Erhaltungsrücklage). Ohne Angabe gilt das Jahr der Abrechnung.“ |
| § 35a-Lohnanteil | erlaubt | erlaubt (wie „Nicht umlagefähig“; für den Vermieter ohne Wirkung, nur durchgereicht) |
| § 82b-Verteilung (#262) | möglich (#262) | möglich, `allowsSpread` nimmt die Kostenart von Anfang an auf (#262 PR 1 liegt im Stapel nach diesem PR; Z. 57 nennt Entnahmen ausdrücklich) |
| Doppelte Positionen | lose Kostenart | lose Kostenart (`LOOSE_CATEGORIES`) |

**Neue Gruppe statt Umbenennen:** „Verwaltung & Instandhaltung“ bleibt für „Nicht umlagefähig“ wie sie ist, denn die
Prüfsumme der Steuerübersicht enthält den Gruppennamen. Ob gewöhnliche Reparaturen aus „Nicht umlagefähig“ in Z. 55
oder 76 gehören, kann Mietfuchs ohne weiteres Merkmal nicht sagen. Das ist eine Frage der Ausfüllhilfe (#194) und
bleibt dort.

`outflowShares` bekommt **keinen** Sonderfall für die Kostenart. Die Regel ergibt sich aus dem fehlenden Datum: Quelle
`stated` oder `period`, und `period` ist bei der Entnahme fachlich richtig (R4). Damit bleibt outflow.ts die einzige
Stelle für das Steuerjahr.

### A2. Wo die Kostenart gepflegt wird (alle Stellen über `isNotAllocable`)

- `shared/categories.ts`: `CATEGORIES`, `NOT_ALLOCABLE`, `matchCategory`: Text mit Rücklage **und** Entnahme oder
  „aus der/dem“ ergibt die neue Kostenart statt „Nicht umlagefähig“. Die bestehende Regel für die Zuführung bleibt
  wortgleich.
- `server/src/calc.ts`: `ANLAGE_V_GROUP['Entnahme Erhaltungsrücklage'] = 'Erhaltungsaufwand'`,
  `ANLAGE_V_GROUP_ORDER` um die Gruppe erweitert, `NOT_ALLOCABLE_CATEGORIES` ergänzt.
- `shared/costItem.ts`: `showsTaxUnitField` für beide Kostenarten. Die Prüfung des Lohnanteils bleibt nur bei der
  Zuführung.
- `shared/duplicates.ts`: `LOOSE_CATEGORIES` ergänzt.
- `shared/paidOn.ts`: `allowsPaidOn` ist für beide Rücklagen-Kostenarten `false`. Heute schließt nur das Formular die
  Zuführung aus (`showsPaidOn` in costForm.ts); die Regel wandert nach shared/, damit Server und Formular dasselbe
  sagen. **Folge in `costItemBody`** (shared/costItem.ts: `paidOn: allowsPaidOn(...) ? … : null`): Das Datum wird dort
  geleert, bevor der Server es sieht. Der Übertrag Datum → Jahr (A3) muss deshalb **vor** `costItemBody` laufen.
  `unstatedCount` zählt die Zuführung danach nicht mehr als „ohne Datum“ (kleine, gewollte Änderung einer angezeigten
  Zahl; im PR genannt, nicht im CHANGELOG).
- `server/src/extract.ts`: Liste der Kostenarten und Beschreibung für die KI. „Eine Entnahme aus der Rücklage … ist
  ‚Entnahme Erhaltungsrücklage‘“. **Das ändert den Prompt**, deshalb gehört an den PR das Label `ai-eval`
  (server/src/ai/CLAUDE.md).
- `server/src/taxReceipts.ts`: Der Ordner im Steuer-ZIP folgt der Gruppe, also ein Ordner „Erhaltungsaufwand“.
- `client/src/costForm.ts`: Kein Datumsfeld; Beschriftung des Jahres; Umstellung der Kostenart (A3).
- Lexikon (`shared/glossary.ts`): Eintrag „Erhaltungsrücklage“ um die Entnahme ergänzen (Jahr der Ausgabe durch die
  Gemeinschaft, Z. 55/56, Herstellungskosten nur über AfA, miterworbene Rücklage, Sonderumlage). „Nicht umlagefähig“
  und „Hausgeld“ verweisen darauf. Hilfe zur Eigentumswohnung in `shared/guides.ts` entsprechend. Sie siezen
  (anrede.test.ts).

### A3. Zahlungsdatum: abgelehnt, beim Umstellen kein stilles Wandern

**Entscheidung:** An der Entnahme gibt es kein Zahlungsdatum. Maßgeblich wäre das Datum, an dem die Gemeinschaft den
Handwerker bezahlt. Das kennt der Eigentümer meist nicht, und im Feld „Zahlungsdatum“ stünde erfahrungsgemäß sein
eigenes Hausgeld, also genau das falsche Datum (R1). Das Jahr genügt: Die Hausgeldabrechnung ist eine Jahresrechnung.

**Voraussetzung #478** (Durchsicht X1, R-A): Heute lehnt `requireTaxYear` (server/src/db/repository.ts) im
Kalenderzeitraum jedes Jahr der Zahlung ≠ Startjahr ab. Erst #478 lässt ein abweichendes Jahr im Kalenderzeitraum zu
(Spanne mit Rückfrage außerhalb). Ohne #478 scheiterte der Übertrag unten im Regelfall der Eigentumswohnung mit 400.
#478 liegt im Stapel deshalb vor diesem PR (Release-Plan Nr. 1).

- **Server:** Ein gesetztes `paidOn` (≠ `null`) an einer Entnahme oder Zuführung ergibt 400 mit deutscher Meldung
  (wie die übrigen Feldprüfungen; `allowsPaidOn` aus shared/paidOn.ts). Der Server leert nichts still.
- **Formular, Umstellen auf „Entnahme“:** Wer eine datierte Position auf „Entnahme Erhaltungsrücklage“ umstellt, bekommt
  das Jahr des Datums als `taxYear`, sofern es vom Jahr des Zeitraums abweicht, mit sichtbarer Zeile „Zahlungsdatum
  entfällt, die Position bleibt im Jahr X“. Weicht es nicht ab, entfällt das Datum ohne Folge. **Der Übertrag läuft im
  Formularzustand beim Wechsel der Kostenart, also vor `costItemBody`** (Durchsicht R-B): `costItemBody` leert
  `paidOn` danach ohnehin (`allowsPaidOn` = false), und das Jahr ist dann schon gesetzt. Eine Zahl wandert dadurch
  nicht.
- **Bestand, Zuführung mit Datum** (nur über die API möglich): Das Formular zeigt das Feld für die Zuführung schon
  heute nicht und schickt `null`; das nächste Speichern über das Formular leert das Datum also **still**. Das ist für
  die Zuführung unschädlich, denn sie ist keine Werbungskosten; es verschiebt nur `reserveContributionCents` (Auskunft)
  ins Jahr der Abrechnung. Ein Speichern über die API mit unverändertem Datum ergibt 400. So im PR und im Lexikon nicht
  weiter erwähnt; eine Datenanweisung gibt es nicht (Werte bleiben stehen, bis jemand speichert).
- **Bestand, Entnahme**: gibt es nicht mit Datum, denn die Kostenart ist neu.

### A4. Hinweise in der Steuerübersicht

Alle als Auskunft, keine rechnet:

1. **Gruppe „Erhaltungsaufwand“ mit Zeile**, nur für Jahre mit belegtem Vordruck (`anlageVLines(year)`, A5): „Anlage V
   {Jahr}: Zeile 55, bei teilweiser Eigennutzung Zeile 56 (Gesamtbetrag und abzugsfähiger Anteil). Nicht in die
   Zeilen 76 bis 78, die gelten ‚ohne Erhaltungsrücklage‘.“ **Die Zeilen 55/56 gelten nur für unverteilte
   Positionen** (Durchsicht X7): Ist eine Position der Gruppe nach § 82b verteilt (ab #262), steht sie im Block
   „Zu verteilender Erhaltungsaufwand“ (Zeilen 57–60 im ersten, 61–72 in den Folgejahren), und der Satz lautet für sie
   „siehe Zeilen 57 bis 72“. Für Jahre ohne belegten Vordruck ohne Nummer: „bei den Erhaltungsaufwendungen,
   einschließlich Entnahmen aus der Erhaltungsrücklage“.
2. **`reserveWithdrawalSuspects`** (neu in `TaxReport`, optional, fehlt ohne Treffer): Positionen „Nicht umlagefähig“,
   deren Beschreibung nach Entnahme aussieht (`RESERVE_PATTERN` und `RESERVE_WITHDRAWAL`, die schon in calc.ts
   stehen). Stufe Hinweis: „Stellen Sie die Kostenart ‚Entnahme Erhaltungsrücklage‘ ein; an den Beträgen ändert
   sich nichts, nur die Zeile der Anlage V.“ Hat die Position ein Zahlungsdatum, kommt ein Satz dazu: Maßgeblich sei
   das Jahr, in dem die Gemeinschaft bezahlt, nicht das der eigenen Hausgeldzahlung.
3. **Sonderumlage** (`specialLevySuspects`, optional): eine Position mit „Sonderumlage“ in der Beschreibung, unter
   „Nicht umlagefähig“ mit Zahlungsdatum oder unter „Zuführung“; **ab #262 PR 2 auch unter „Nicht umlagefähig“ mit
   gewählter Verteilung** (Durchsicht X3, beide Entwürfe nennen dasselbe Jahr). Text nach R5: Die eigene Zahlung zählt
   nicht. Zählt die Sonderumlage zur Rücklage, ist sie eine Zuführung. Hat die Gemeinschaft damit eine Maßnahme
   bezahlt, gilt der eigene Anteil laut Jahresabrechnung im Jahr der Ausgabe, erfasst als „Entnahme
   Erhaltungsrücklage“ ohne Datum. Mietfuchs stellt nichts um.
4. **Anschaffungsnahe Herstellungskosten (R7): ein gemeinsamer Hinweis `acquisitionRelated`** für das ganze Release
   (Durchsicht X6; #262 legt keinen eigenen an). Angelegt in PR 2 (braucht das Datum aus Teil B). Bedingung:
   - Datum am Objekt bekannt (`ownershipTransferOn`, ersatzweise `purchaseContractOn`): nur, wenn das Steuerjahr die
     drei Jahre nach dem Datum berührt **und** es abziehbare Positionen der Gruppe „Erhaltungsaufwand“ oder
     „Verwaltung & Instandhaltung“ oder eine Verteilung (#262) gibt.
   - Datum unbekannt: nur, wenn in diesem Jahr eine Verteilung beginnt (#262 erweitert die Bedingung in seinem PR 3).
   Text: Die 15-%-Grenze gilt, Mietfuchs kennt die Anschaffungskosten nicht, die Frist läuft ab dem Übergang von
   Besitz, Nutzen und Lasten, bitte das Datum prüfen; Verweis auf den Lexikonbegriff „Anschaffungsnahe
   Herstellungskosten“ (neu, hier angelegt; `spread82b` und „Erhaltungsrücklage“ verweisen darauf). Gerechnet in
   taxView.ts aus Bericht und Objekt; kein Feld im Bericht.
5. **Nutzungswechsel im Jahr bei einer Entnahme**: Der private Teil folgt wie bei jeder Position den Tagen
   (`taxUsage`, #259). **Auslegung:** Streng genommen zählt die Nutzung am Tag der Ausgabe (R1). Ohne Datum der
   Gemeinschaft ist die Aufteilung nach Tagen die bestmögliche. Steht schon im Hinweis `usageChangedUnits`, ein
   Halbsatz kommt dazu, wenn eine Entnahme betroffen ist.
6. **Hinweis `etwHousingMoney`** bekommt einen Satz: Entnahmen aus der Rücklage zählen abweichend im Jahr, in dem die
   Gemeinschaft sie ausgibt, also nach der Hausgeldabrechnung dieses Jahres. Die Zuführung, die in den gezahlten
   Vorschüssen steckt, ist abzuziehen.

**Herstellungskosten aus der Rücklage (R2)**: Es gibt kein eigenes Merkmal. Lexikon und Hilfe am Formular sagen: Eine
Maßnahme, die über die Erhaltung hinausgeht (etwa ein neuer Aufzug oder ein Anbau), bitte nicht als Entnahme
erfassen; sie wirkt über die Abschreibung, die Mietfuchs nicht rechnet. Begründung: ein Feld ohne Rechnung dahinter
wäre nur ein zweiter Ort für dieselbe Auskunft.

### A5. Zeilen je Jahr: eine Tabelle für das ganze Release

Neues Modul `client/src/anlageV.ts` mit `anlageVLines(year)`: **die eine Tabelle der Zeilennummern** mit Fundstelle je
Jahr (Durchsicht X5), gelesen von #96, #312 und #262. Nur Jahre, die selbst im Vordruck oder in der Anleitung
nachgesehen sind, sonst `null` („eine erfundene Zeile wäre schlimmer als keine“).

```ts
type Line = { line: number; code?: number }   // Kennzahl, wo der Vordruck eine nennt
type AnlageVLines = {
  source: string                               // Fundstelle (Vordruck/Anleitung, Fassung)
  header: { groundTaxFile: 6; acquisition?: 7; use?: 10; totalArea?: 11; selfUsedArea?: 12 }
  income: {                                    // Zeilen 13–25 (#312)
    perUnit?: [13, 14]; homes?: Line; otherRooms?: Line; relatives?: Line; allocations?: Line;
    settlement?: Line; relativesAllocations?: Line; relativesSettlement?: Line; notAgreed?: Line;
    formerYears?: Line; total?: number
  }
  maintenance: {
    direct: Line; proportional: Line                                        // 55 (Kz. 36), 56 (Kz. 37)
    spread?: { total: number; direct: number; proportional: number; sum: Line }   // 57, 58, 59, 60 (Kz. 38)
    spreadFromPriorYears?: { fromYear: number; direct: number; proportional: number; sum: Line }[]  // 61–72 (Kz. 39–42)
  }
  notAllocated: [76, 78]
}
```

- 2025: alle Felder, Quelle Vordruck 2025AnlV101 (Seiten 1 bis 4). `spreadFromPriorYears`: 2021 → 61/62/63,
  2022 → 64/65/66, 2023 → 67/68/69, 2024 → 70/71/72. `income`: 15 (Kz. 01), 18 (02), 19 (03), 20 (04), 21 (11),
  22 (05), 23 (12), 24 (13), 25 (06), 32.
- 2024: `header.groundTaxFile: 6`, die Zeilen der Werbungskosten aus der Anleitung 2024 (55–72 wie 2025, Ursprungsjahre
  2020–2023) und `income` aus Vordruck 2024 (siehe #312). Die Kopfzeilen 7, 10 bis 12 fehlen, weil der Kopf 2024
  anders zählt und die Anleitung „Zeile 10 bis 12“ nur zusammen nennt.
- 2023: nur `income` mit den Zeilen, die heute `SETTLEMENT_LINES` für 2023 belegt (Zeile 21); Zeile 25 erst, wenn
  #312 PR 3 Seite 2 gelesen hat.
- 2026 und später: `null`, bis die Jahresdurchsicht (#110) den Vordruck gelesen hat. Ein Test hält fest, dass jedes
  eingetragene Jahr eine Fundstelle trägt.

**`settlementLine(year)` liest daraus**: Die bisherige Tabelle `SETTLEMENT_LINES` in taxView.ts geht samt Fundstellen
in `anlageVLines(year).income` über; `settlementLine` bleibt mit Namen und Rückgabe bestehen und liest nur noch dort
(nichts wird umbenannt; ein Test vergleicht seine Rückgabe vor und nach dem Umzug). Das ist nicht das Zusammenführen
zur Ausfüllhilfe (#194), sondern nur eine Datenquelle; ohne sie wüchsen im selben Release zwei Jahrestabellen mit
getrennten Quellenwächtern.

### A6. Zusammenspiel

- **#478** (Wechsel des Zeitraums, Kalenderzeitraum mit Jahr der Zahlung): **Voraussetzung**, liegt im Stapel vorher
  (A3). Die Entnahme hat nie ein Datum; ihr Jahr hängt über einen Wechsel des Abrechnungszeitraums ganz an der Regel aus
  #478, dass ein angegebenes Jahr erhalten bleibt. Die Vorschau des Wechsels nennt bei der Entnahme die Beschriftung
  „Jahr, in dem die Gemeinschaft bezahlt hat“.
- **#262 (§ 82b)**: Die Verteilung ist an der Entnahme möglich (`allowsSpread`, #262 PR 1). Die erste Rate gehört ins
  Jahr aus `outflowShares`, also ins Jahr der Ausgabe durch die Gemeinschaft. Z. 57–60 im ersten Jahr, Z. 61–72 je
  Ursprungsjahr in den Folgejahren (aus `anlageVLines`). An der Zuführung ist keine Verteilung erlaubt. „Überwiegend
  Wohnzwecke“ bei einer Eigentumswohnung: an der Wohnung gemessen (in #262 E-10 entschieden, Auslegung). Der Hinweis
  zu anschaffungsnahen Herstellungskosten ist der gemeinsame `acquisitionRelated` (A4.4).
- **#312 (Einnahmen getrennt)**: berührt Teil A nicht. Teil B liefert `Tenancy.relative` (PR 2), das #312 PR 2 direkt
  danach für Z. 19, 22 und 23 liest; die Zeilennummern der Einnahmen kommen aus `anlageVLines` (A5).
- **#281**: keine Berührung.
- **#455 (Quellrechnung)**: Eine Entnahme wird nie über Zeiträume aufgeteilt; eine aufgeteilte Rechnung mit dieser
  Kostenart behandelt die Quellrechnung wie jede nicht umlagefähige.

## Teil B: Kopfangaben der Anlage V je Objekt

### B1. Was abgeleitet wird und was eingetragen werden muss

| Zeile 2025 | Angabe | Herkunft |
|---|---|---|
| 4/5 | Lage | `Property.address` (vorhanden) |
| 6 | Aktenzeichen laut Grundsteuermessbescheid | **neu** `Property.groundTaxFileNumber` |
| 7 | Kaufvertrag, Eigentumsübergang, Bauantrag, Fertigstellung | **neu**, vier Daten am Objekt |
| 8 | Veräußerung | nicht in diesem Entwurf (B4) |
| 9 | Wirtschafts-Identifikationsnummer | nicht in diesem Entwurf (B4) |
| 10 Kz. 62 | an Angehörige vermietet | **abgeleitet** aus neuem `Tenancy.relative` |
| 10 Kz. 61/63 | Ferienwohnung, kurzfristig | nicht abgeleitet; fester Satz: Mietfuchs rechnet keine Ferienwohnung, sonst Anlage V-FeWo |
| 11 | Gesamtwohnfläche | `totalAreaM2` (vorhanden; Garagen zählen mit, Hinweis aus #163 F3 bleibt) |
| 12 Kz. 55 | eigengenutzt/unentgeltlich überlassen | `selfUsedAreaM2` (vorhanden) |
| 24 | Nebenkosten nicht gesondert vereinbart | `costModels` (vorhanden) |

### B2. Datenmodell

`Property` (shared/types.ts), alle optional, `null` oder fehlend heißt „nicht eingetragen“:

```ts
groundTaxFileNumber?: string | null   // wie eingegeben; angezeigt ohne Sonderzeichen
purchaseContractOn?: string | null    // 'JJJJ-MM-TT', Notar-/Kaufvertrag
ownershipTransferOn?: string | null   // Eigentumsübergang
buildingApplicationOn?: string | null // Bauantrag/Bauanzeige/Baubeginnsanzeige
completedOn?: string | null           // Fertigstellung
```

`Tenancy.relative?: boolean | null`: Vermietung an Angehörige zu Wohnzwecken. Fehlt es, heißt das „nein“, also
das heutige Verhalten.

**Entscheidungen:**
- **Aktenzeichen als Text**, gespeichert wie eingegeben. Angezeigt wird es mit `fileNumberDigits()`: nur Ziffern und
  Buchstaben, weil der Vordruck „ohne Sonderzeichen“ verlangt. Die Formate sind je Land verschieden, eine Prüfung
  der Form wäre geraten. Höchstlänge 40 Zeichen als Schutz gegen versehentlich Eingefügtes.
- **Ein Aktenzeichen je Objekt.** Mehrere Gebäude auf verschiedenen Grundstücken in einem Objekt (Kommentar in #96)
  erkennt Mietfuchs nicht, weil die Wohnung kein Grundstück trägt. Die Hilfe am Feld sagt: „Liegen die Gebäude
  dieses Objekts auf verschiedenen Grundstücken, geben Sie je Grundstück eine eigene Anlage V ab; teilen Sie die
  Zahlen dann bitte mit Ihrem Steuerberater auf.“ Ein Grundstück je Wohnung wäre eine dritte Ebene, die #91
  ausschließt.
- **Vier Daten statt einem**: Der Vordruck fragt genau diese vier (R8). Wer kauft, füllt zwei aus, wer baut, zwei
  andere. Alle sind freiwillig. Gelesen wird nur das Übergangsdatum (ersatzweise der Kaufvertrag) für `acquisitionRelated`.
- **Kein Feld „Eigentümer“.** Die Zurechnung in Z. 86 betrifft Ehegatten bei Zusammenveranlagung und Miteigentum,
  beides bleibt draußen. Der abweichende Vermietername am Objekt gibt es schon (`landlordName`).

**Datenbank**, im Stapel **0080/0081** (Nummern beim Umstellen auf `main` mit `db:generate` neu erzeugt):
- `0080_anlage_v_kopf`: `properties` erhält `ground_tax_file_number TEXT`, `purchase_contract_on TEXT`,
  `ownership_transfer_on TEXT`, `building_application_on TEXT`, `completed_on TEXT`; `tenancies` erhält
  `relative INTEGER`.
- `0081_anlage_v_kopf_bedingungen`: Bedingungen wie bei `tight_market_*` (sie verlangen den Neubau beider Tabellen):
  Datum als `GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`, Länge des Aktenzeichens ≤ 40, `relative IS NULL OR
  relative IN (0, 1)`.
- Kein Datenschritt, alle Werte bleiben `NULL`. schema.test.ts hält Typen und Schema zusammen. Die db.json kennt die
  Felder nicht (eingefrorener Eingang unberührt). Trigger des Journals entstehen beim Öffnen von selbst.
- **Beschriftung im Verlauf** (Durchsicht X8): Jede neue Spalte braucht einen Eintrag in `FIELD_LABELS`
  (client/src/journalView.ts), sonst zeigt der Verlauf `ground_tax_file_number`: `ground_tax_file_number:
  'Aktenzeichen (Grundsteuer)'`, `purchase_contract_on: 'Kaufvertrag vom'`, `ownership_transfer_on:
  'Eigentumsübergang am'`, `building_application_on: 'Bauantrag vom'`, `completed_on: 'Fertiggestellt am'`,
  `relative: 'An Angehörige vermietet'`. Ein Wächter in journalView.test.ts verlangt für jede Spalte aus schema.ts
  eine Beschriftung oder einen Grund (angelegt in diesem PR, von #281 und #262 mitgenutzt; falls #281 ihn schon
  angelegt hat, nur erweitern).

### B3. Oberfläche

- **Stammdaten, Objekt** (`client/src/propertyForm.ts`, Stammdaten.tsx): ein aufklappbarer Abschnitt „Für die
  Steuer (Anlage V)“, zugeklappt, solange nichts eingetragen ist. Darin das Aktenzeichen mit Hilfe („steht auf dem
  Grundsteuermessbescheid“) und die vier Daten als Datumsfelder.
- **Stammdaten, Mietverhältnis**: ein Kontrollkästchen „An Angehörige vermietet (für die Steuer)“, Lexikonverweis
  auf „Verbilligte Vermietung“ (#257), denn dort liegt die eigentliche Folge.
- **Steuer, neuer Abschnitt „Kopf der Anlage V“** oberhalb der Einnahmen, auch im Druck: je Angabe die Zeile aus
  `anlageVLines(year)` (oder keine), der Wert oder „nicht eingetragen“ mit Sprung zu den Stammdaten. Z. 7 erscheint
  erst ab 2025, davor fragt der Vordruck nicht danach. Z. 10 Kz. 62 lautet „1 = Ja“, sobald ein Mietverhältnis des
  Jahres `relative` trägt, sonst „2 = Nein“. Die Zahl dazu liefert **`costModels.relativeTenancies`** (neu, **Anzahl**
  der Mietverhältnisse des Jahres mit Kennzeichen; nicht `relatives`, damit es nicht mit `received.relatives` aus
  #312 in Cent verwechselt wird, Durchsicht X11). Die Logik steht in taxView.ts (`headerRows(report, property, year)`),
  die Seite rendert nur.
- **Angehörige in den Einnahmen**: Die Beträge der Z. 19, 22 und 23 rechnet #312 PR 2, das im Stapel direkt nach
  diesem PR liegt (Lead: `Tenancy.relative` kommt mit #312 in einem Release). Zwischen beiden PRs zeigt die Seite
  das Kennzeichen nur im Kopf; einen Satz ohne Betrag und einen „Folgeschritt nach #312“ gibt es nicht.
- **Reihenfolge der Steuerseite** wie der Vordruck (Durchsicht, Abschnitt 8): Kopf → Einnahmen (13–32) →
  Werbungskosten mit Erhaltung (55–72) → übrige Werbungskosten → 87/88 → Gesamtsicht. Ein Test in Steuer.test.tsx hält
  sie fest; angelegt in PR 1 mit den vorhandenen Blöcken, jeder spätere PR des Releases ergänzt seinen.

### B4. Nicht in diesem Entwurf

- Z. 8 Veräußerung und Z. 9 W-IdNr.: Eine Veräußerung braucht mehr als eine Zeile (§ 23 EStG, Abgrenzung im Jahr,
  Rücklage geht mit über). Die W-IdNr. vergibt das BZSt erst schrittweise. Beides lässt sich leicht als Feld
  nachziehen, wenn jemand es verlangt. Das vorzeitige Ende einer Verteilung (§ 82b Abs. 2) steht als eigenes Jahr am
  Objekt (#262 PR 4), nicht als Z. 8.
- Ferienwohnung und kurzfristige Vermietung: Anlage V-FeWo, nicht Ziel von Mietfuchs.
- Wohnraum oder Nutzraum an der Einheit (Garage nicht in Z. 11): wie in #163 F3 entschieden, eigene Erweiterung.

## Teil C: Gesamtsicht über alle Objekte

**Entscheidung (Lead): im Release, als letzter PR des Stapels** (Nr. 12). Sie rechnet nichts Neues, sondern summiert
die Berichte je Objekt; deshalb kommt sie nach allem, was diese Berichte erweitert: `received` (#312) und
`deductibleCents` nach Raten (#262).

- Route `GET /api/tax/overview?year=` (installationsweit wie Belege und Backup, ohne `?property=`), Antwort je Objekt:
  Name, Art, laufende Nummer der Anlage, `hasRental`, Zufluss (`paidCents`) samt `received`-Summen (Zeilen 15/18, 19,
  20, 21, 22, 23, 25), Soll, abziehbare Werbungskosten (nach Raten und Kürzung), davon verteilt (`deferredCents`),
  privater Teil, Zuführung zur Rücklage, Überschuss Ist und Soll. Dazu die Summe. Typ `TaxOverview` nur im Server und
  Client (nicht in shared/), wie `ComputedSettlement`, denn er geht nur über die Leitung.
- **`hasRental`** (Durchsicht R-C): Mietverhältnis im Jahr **oder** Zufluss ≠ 0 **oder** abziehbare Werbungskosten
  ≠ 0. Auch bei Leerstand mit Vermietungsabsicht sind Werbungskosten abziehbar, und die Anlage V ist abzugeben.
- **Laufende Nummer**: in der Reihenfolge der Objekte, nur Objekte mit `hasRental`. Ein Objekt ohne steht neutral als
  „keine Einnahmen und keine Werbungskosten in {Jahr}“ in der Liste, **ohne Aussage über die Pflicht zur Anlage V**
  (ob bei Leerstand eine Vermietungsabsicht besteht, weiß Mietfuchs nicht).
- **Je Objekt ein Bericht**: `taxReportFor` wird je Objekt einmal gerechnet (mit `received`); die Rückgriffe der
  Verteilung (#262 E-6) nutzen `received: false` und den Zwischenspeicher je Aufruf (Durchsicht X10). Ein Test misst,
  dass die Route bei zehn Objekten mit Verteilung unter einer Sekunde bleibt (grobe Schranke, gegen Rückfälle).
- Oberfläche: Abschnitt „Alle Objekte {Jahr}“ unten auf der Steuerseite, **erst ab zwei Objekten** sichtbar (Zusage
  aus #91). Eine Zeile je Objekt mit Sprung in dessen Übersicht. Der private Anteil steht sichtbar daneben (Kommentar
  in #96 zur Kopfkarte). Der Hinweis „kein Formular, Summe nur zur Kontrolle“ steht dabei: Das Finanzamt summiert die
  Anlagen selbst.
- Fehler eines Objekts (etwa die Meldung aus `paidWhollyIn`) brechen nicht die ganze Übersicht. Die Zeile nennt den
  Fehler und zählt nicht in die Summe, mit sichtbarem Satz.

## Golden-Tests

- `tax-golden.json` **bleibt unverändert**. `taxFingerprint` (server/testing/taxGolden.ts) hasht die Einnahmen, die
  Summen, die Gruppen mit Namen, die Positionen und eine feste Liste weiterer Felder. Neu hinzu kommen nur optionale
  Felder außerhalb dieser Auswahl (`reserveWithdrawalSuspects`, `specialLevySuspects`,
  `costModels.relativeTenancies`), und `JSON.stringify` lässt fehlende Felder weg. `income` bekommt hier kein neues
  Feld (`received` aus #312 nimmt `incomeFingerprint` heraus). Der Generator (taxStock.ts) erzeugt die neue Kostenart
  nicht und wird **nicht** geändert, sonst änderten sich alle Prüfsummen.
- settlement-golden, period-golden, heating-golden: unberührt, denn in der Abrechnung verhält sich die neue Kostenart
  wie „Nicht umlagefähig“.

## Invarianten (Tests über Zufallsbestände mit festem Startwert)

- **I1 Umstellen ändert keine Zahl**: Jede Position „Nicht umlagefähig“ ohne Datum eines Zufallsbestands wird auf
  „Entnahme Erhaltungsrücklage“ gestellt. Für jedes Objekt und Jahr bleiben Brutto, privat, unentgeltlich, abziehbar,
  §35a, Überschuss Soll und Ist gleich. Nur Gruppe und Kategorie wandern, und die Summe der Gruppen bleibt.
- **I2 Die Zuführung zählt nie**: Über alle Jahre ist die Summe der abziehbaren Werbungskosten mit und ohne
  Zuführungen gleich, und `reserveContributionCents` summiert genau die Zuführungen.
- **I3 Abrechnung unberührt**: Für I1 sind Mieteranteile und Vermieteranteil jeder Abrechnung gleich.
- **I4 Gesamtsicht = Σ Einzelberichte** (PR 3; Durchsicht X9 c, R-D): für jeden Zufallsbestand mit mehreren Objekten,
  mit zufälliger Verteilung (#262) und zufälligem `relative`: jede Summe der Gesamtsicht ist die Summe der Felder der
  Berichte je Objekt, auch `received` und `deductibleCents` nach Raten.
- **X9 (d)**, Kreuz mit #262: I1 mit zusätzlich zufällig gewählter Verteilung an den umgestellten Positionen ergibt über
  alle Jahre dieselben Summen wie unverteilt (steht als Test in #262 PR 2, sobald beide da sind; im Release-Plan).
- Bestehende Invarianten (Mieteranteile + Vermieteranteil = Gesamtkosten, privater Teil über alle Jahre beim
  Zahlungsdatum) laufen unverändert.

## Vorgehen in Schritten (TDD, je ein PR)

Drei PRs im Stapel des Releases (dort Nr. 4, 5 und 12). Jeder Schritt beginnt mit dem roten Test. Vor jedem PR eine
Durchsicht mit frischem Kontext, `npm run typecheck`, CHANGELOG unter „Unveröffentlicht“ (Wortlaut im Release-Plan),
`Refs #96`.

### PR 1 (Stapel Nr. 4): Entnahme Erhaltungsrücklage (Teil A) und `anlageVLines`, Größe M

Hängt ab von: Nr. 1 (#478, `requireTaxYear` gelockert, Formular zeigt das Jahr im Kalenderzeitraum).

1. **Rot:** `server/test/categories.test.ts`: Die neue Kostenart steht in allen drei Listen (Oberfläche, KI-Schema,
   `ANLAGE_V_GROUP`). `matchCategory('Entnahme aus Erhaltungsrücklage Dachreparatur')` und `'… aus der Rücklage
   bezahlt'` ergeben die neue Kostenart, die bestehenden Fälle der Zuführung bleiben.
2. **Rot:** `server/test/calc-steuer-ruecklage.test.ts` (neu): Eine ETW mit Entnahme 1.240 € im Zeitraum 2025 steht
   in der Gruppe „Erhaltungsaufwand“ 2025 und zählt in `deductibleCents`. Daneben: eine Zuführung bleibt draußen;
   Eigennutzung über die Fläche (Zuordnung über `participantUnitIds`); `taxYear: 2026` im **Kalenderzeitraum 2025**
   legt sie nach 2026 (geht erst mit #478, vorher 400); `reserveWithdrawalSuspects` und `specialLevySuspects` mit und
   ohne Treffer, fehlend ohne Treffer.
3. **Rot:** `server/test/invariant-steuer-ruecklage.test.ts` (neu): I1 bis I3 über `taxStock` mit festem Startwert.
4. **Rot:** `server/test/api-zahlungsdatum.test.ts`: `paidOn` an Entnahme und Zuführung ergibt 400 mit Meldung, ohne
   Datum 200; Entnahme mit `taxYear` ≠ Startjahr im Kalenderzeitraum 200. `shared/paidOn.ts`-Test: `allowsPaidOn` ist
   für beide `false`.
5. **Rot:** `client/src/costForm.test.ts`: Umstellen einer datierten Position mit Jahr 2026 im Zeitraum 2025 auf
   Entnahme ergibt im Formularzustand `taxYear: 2026` und die sichtbare Zeile, **und `costItemBody` danach** schickt
   `taxYear: 2026` mit `paidOn: null` (Reihenfolge, R-B); bei gleichem Jahr kein `taxYear`. Das Jahr-Feld ist bei der
   Entnahme auch im Kalenderzeitraum sichtbar, mit Beschriftung und Hilfe (R-G). jsdom: Das Auswahlfeld zeigt die neue
   Kostenart (über die bestehenden Optionen), das Jahr-Feld zeigt das gespeicherte Jahr.
6. **Rot:** `client/src/anlageV.test.ts` (neu): `anlageVLines(2025)` und `(2024)` wie A5, `(2026)` ergibt `null`;
   jedes Jahr mit Fundstelle; `settlementLine(year)` liefert für 2023 bis 2026 genau das, was es vor dem Umzug lieferte.
   `client/src/taxView.test.ts`: A4.1 nennt 55/56 nur ohne Verteilung (mit einer nachgebildeten verteilten Position
   „siehe Zeilen 57 bis 72“); A4.6 enthält bei `etw` den Satz zur Entnahme.
7. **Rot:** `client/src/pages/Steuer.test.tsx`: Reihenfolge der vorhandenen Blöcke (Test neu, die übrigen PRs
   erweitern ihn).
8. Grün: categories.ts, calc.ts, costItem.ts, duplicates.ts, paidOn.ts, extract.ts, taxReceipts.ts, costForm.ts,
   anlageV.ts, taxView.ts, Steuer.tsx, glossary.ts (Erhaltungsrücklage), guides.ts. `outflow.test.ts` (Golden) läuft
   unverändert grün.
9. `taxReceipts.test.ts`: Ordner „Erhaltungsaufwand“ für die Entnahme.
10. Label `ai-eval` am PR (Prompt geändert).

### PR 2 (Stapel Nr. 5): Kopfangaben und `Tenancy.relative` (Teil B), Größe M

Hängt ab von: Nr. 4; Migrationen 0080/0081 nach 0078/0079 (#281, Nr. 3).

1. **Rot:** `server/test/schema.test.ts`/Migrationstest: neue Spalten, Bedingungen (ungültiges Datum, Aktenzeichen
   über 40 Zeichen, `relative` = 2 ergeben 400 über die Route mit deutschem Satz aus errors.ts). Marke des neuen
   Schrittes festhalten.
2. **Rot:** `server/test/api-objekte.test.ts`: Hin und zurück für die fünf Felder. Leeren mit `null` (Teilrumpf,
   Anwesenheit des Schlüssels). Ohne Angabe bleibt die Antwort ohne die Felder bzw. mit `null`.
3. **Rot:** Mietverhältnis mit `relative: true` über die Route; `taxReport.costModels.relativeTenancies` zählt nur
   Mietverhältnisse des Jahres (`calc-steuer-kopf.test.ts`, neu).
4. **Rot:** `client/src/propertyForm.test.ts`: Formularzustand leer, Speichern ohne Eingabe schickt nichts Neues.
   Datum in deutscher Schreibweise wird zu ISO. `fileNumberDigits` entfernt Sonderzeichen.
5. **Rot:** `client/src/taxView.test.ts`: `headerRows` für 2025 mit Zeilen, für 2024 nur Z. 6, für 2026 ohne Nummern.
   Z. 7 erst ab 2025. Kz. 62 Ja/Nein. `acquisitionRelated` (A4.4): mit Datum nur in den drei Jahren (Grenzen: Tag vor
   und nach Ablauf), ohne Datum nicht (bis #262 die Bedingung „Verteilung beginnt“ ergänzt). Lexikon „Anschaffungsnahe
   Herstellungskosten“ (glossary.test.ts).
6. **Rot:** `client/src/journalView.test.ts`: Beschriftung für jede neue Spalte (B2), Wächter über schema.ts.
7. Grün: types.ts, schema.ts (+ `db:generate`), Repository und Validierung, propertyForm.ts, Stammdaten.tsx,
   taxView.ts, Steuer.tsx, journalView.ts, glossary.ts. Backup-Rundlauf (api-backup.test.ts) mit gesetzten Feldern.
8. Golden unverändert (outflow.test.ts).

### PR 3 (Stapel Nr. 12, letzter des Releases): Gesamtsicht (Teil C), Größe S

Hängt ab von: Nr. 7 (#312 PR 3) und Nr. 11 (#262 PR 4).

1. **Rot:** neue `server/test/api-steuer-gesamt.test.ts` (über `startServerIn`, mit `NKA_DATA_DIR`, `CI=1`,
   `NKA_UPDATE_URL`): zwei Objekte, eines ohne Mietverhältnis **mit** Werbungskosten (Leerstand: `hasRental` wahr,
   bekommt eine Nummer), eines ganz ohne (neutraler Satz, keine Nummer). Die Summe entspricht der Summe der
   Einzelberichte, auch mit einer verteilten Position (#262) und einem Mietverhältnis mit `relative` (`received`).
   Ein Objekt mit Fehler zählt nicht in die Summe und trägt seine Meldung.
2. **Rot:** I4 als Zufallsinvariante (`server/test/invariant-steuer-gesamt.test.ts`).
3. **Rot:** Client-Test: Der Abschnitt fehlt bei einem Objekt und erscheint bei zwei; er steht zuletzt (Test der
   Reihenfolge erweitert).
4. Grün: Route in index.ts (Satz in journalRoutes.ts entfällt, die Route liest nur), Abschnitt in Steuer.tsx bzw.
   eigener Komponente.

## Risiken

1. **KI-Prompt**: Die neue Kostenart ändert Schema und Beschreibung in extract.ts. Ohne Prüflauf (`ai-eval`) fiele eine
   schlechtere Zuordnung nicht auf.
2. **Datum beim Umstellen**: Würde `paidOn` still geleert statt in `taxYear` übertragen, wanderte eine Position ins
   Abrechnungsjahr. Deshalb 400 am Server, Übertrag im Formularzustand vor `costItemBody`, beides mit Test.
3. **Gruppenname in der Prüfsumme**: Ein Umbenennen von „Verwaltung & Instandhaltung“ würde alle Prüfsummen mit
   solchen Positionen ändern. Deshalb eine neue Gruppe, keine Umbenennung.
4. **Nummern der Migrationen**: im Stapel 0078/0079 (#281), 0080/0081 (hier), 0082/0083 (#262). Neu erzeugt beim
   Umstellen auf `main`, nie von Hand umbenannt, nachdem ein Schritt veröffentlicht ist.
5. **Zeilennummern**: belegt sind 2024 (Werbungskosten, Z. 6, Einnahmen) und 2025 (alles). Für 2026 keine Nummer, bis
   #110 den Vordruck gelesen hat. Der Test gegen fehlende Fundstellen schützt davor, eine Nummer zu raten.
6. **Altbestände**: Wer Entnahmen als „Nicht umlagefähig“ mit dem Datum seiner Hausgeldzahlung erfasst hat, hat
   womöglich ein falsches Jahr. Mietfuchs stellt nichts um, der Hinweis A4.2 sagt es.
7. **Tag der Nutzung bei Eigennutzungswechsel** (A4.5) ist Auslegung.

## Entschieden

Vom Lead entschieden (vorher „Echte Entscheidungen“):

1. **Name der Kostenart**: „Entnahme Erhaltungsrücklage“ (Fachwert, so gespeichert).
2. **Gesamtsicht im Release**, als letzter PR (Teil C).
3. **`Tenancy.relative` in PR 2, vor #312 PR 2**; Z. 10 und Z. 19/22/23 erscheinen im selben Release, ohne
   Zwischenschritt.
4. **Datum → `taxYear` vor `costItemBody`** (R-B), mit der stillen Leerung bei der Zuführung als benannter Folge.
5. **Verteilte Entnahmen** stehen in den Zeilen 57–72, nicht 55/56 (X7).
6. **Ein Hinweis zu anschaffungsnahen Herstellungskosten**, gemeinsam mit #262 (`acquisitionRelated`, X6).
7. **Gesamtsicht neutral bei Leerstand** (R-C).
8. **`anlageVLines` ist die eine Tabelle der Zeilen** samt Block `income`; `settlementLine` liest daraus (X5).

## Quellen

- BFH, Urteil vom 14.01.2025, IX R 19/24 (Leitsatz, Rz. 5, 13, 21, 23, 24, 27): https://gesetze.co/urteile/IX_R_19-24 ;
  PDF: https://rewis.io/service/pdf/urteile/nif-14-01-2025-ix-r-1924.pdf
- BFH, Urteil vom 26.01.1988, IX R 119/83, BFHE 152, 471 (zitiert in IX R 19/24, Rz. 13; H 21.2 EStH 2024)
- FG Nürnberg, Urteil vom 12.03.2024, 1 K 866/23: https://www.gesetze-bayern.de/Content/Rtf/Y-300-Z-BECKRS-B-2024-N-21736?all=False
- FG Niedersachsen, 28.06.2005 (Sonderumlage), Bericht: https://www.deubner-steuern.de/news/steuerberatung/details/artikel/wohnungseigentuemergemeinschaft-sonderumlage-als-werbungskosten.html
  (Aktenzeichen dort nicht genannt; nicht selbst geprüft)
- BGH, Urteil vom 04.12.2009, V ZR 44/09 (Jahresabrechnung, Rücklage): https://www.anwalt24.de/urteile/bgh/2009-12-04/v-zr-44_09 ;
  BGH, Urteil vom 25.09.2020, V ZR 80/19; BGH, Urteil vom 11.04.2025, V ZR 96/24 (siehe #110; nicht unabhängig
  geprüft, nur Begründung)
- Anlage V 2025, Vordruck 2025AnlV101 (September 2025), Kopie: https://www.steuern.de/fileadmin/user_upload/Steuerformulare_2025/Anlage_V_2025_steuern-de.pdf
  (Seite 1: Z. 4–24; Seite 2: Z. 25–32; Seite 3/4: Z. 55–83), selbst gelesen am 30.10.2026
- Anleitung zur Anlage V 2024 (September 2024), Kopie: http://www.steuerhexe.de/wp-content/uploads/2025/05/Anlage-V-2024-Anleitung.pdf
  (Z. 6, 7, 9, 10–12; Erläuterungen zu Z. 33–45 miterworbene Rücklage, Z. 55–72, 73–75, 76–78; S. 7 Kürzung nur in
  87/88), selbst gelesen
- § 6 Abs. 1 Nr. 1a, § 9, § 11 Abs. 2 EStG; § 82b EStDV; § 28 WEG
- Repo: server/src/outflow.ts, server/src/calc.ts (`ANLAGE_V_GROUP`, `taxReport`, `looksLikeReserveContribution`),
  shared/categories.ts, shared/paidOn.ts, shared/costItem.ts, server/src/db/repository.ts (`requireTaxYear`),
  client/src/taxView.ts (`settlementLine`, `taxHints`), client/src/journalView.ts (`FIELD_LABELS`),
  client/src/pages/Steuer.tsx, server/testing/taxGolden.ts; Issues #96, #143, #163, #194, #262, #281, #312, #478.
