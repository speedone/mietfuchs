# Spezifikation: Eigene Heizkostenabrechnung nach HeizkostenV (#99)

- **Fassung:** erster Entwurf vom 05.10.2026, zur Freigabe.
- **Codestand:** `main` mit v0.10.1 (eine Rundungsregel aus #202: `distributeCents`, `landlordRecipients` in calc.ts).
- **Rechtsstand:** HeizkostenV in der Fassung von Art. 3 G v. 16.10.2023 (BGBl. 2023 I Nr. 280). §§ 1 bis 12 am 04.10.2026 auf gesetze-im-internet.de im Wortlaut gelesen (Fundstellen in 2.10).
- **Vorgabe des Nutzers:** 0.11.0 soll Heizung **vollständig** abdecken, also alle gängigen Lagen privater Vermieter. Die Einschränkung „nur Wärmemengenzähler“ aus dem Issue ist neu zu prüfen.
- **Baut auf:** CO₂-Spezifikation (Zweig `feat/co2-kostenaufteilung`, Abschnitte 4, 5.2, 12, 15), Marktvergleich vom 04.10.2026 (mibakus und NebenkostenFix nur als Ideen, beide GPL-3, kein Code), #208 (Abrechnungszeitraum je Objekt, parallel spezifiziert).

---

## 0. Die Entscheidungen auf einen Blick

| # | Frage | Entscheidung | Abschnitt |
|---|---|---|---|
| 1 | Nur Wärmemengenzähler? | **Nein.** Unterstützt werden Wärmemengenzähler, Warmwasserzähler, **selbst abgelesene elektronische Heizkostenverteiler** (mit Bewertungsfaktor je Gerät) und **Verbrauchswerte eines Ablesedienstes** je Wohnung. **Nicht** selbst abgelesen werden Verdunster; ihre Werte kommen über den Ablesedienst. Gemischte Ausstattung in einer Anlage (Vorerfassung, § 5 Abs. 7) bleibt beim Messdienst. | 3 |
| 2 | Wo hängen die Heizkosten? | An einer **Heizanlage** je Objekt (Stammdaten), nicht an der Kostenart. Kostenpositionen werden der Anlage zugeordnet und tragen ihren **Teil** (Brennstoff, Betrieb, Messdienst) und ihr **Ziel** (Heizung und Warmwasser, nur Heizung, nur Warmwasser). Das ist der Topf, den die CO₂-Spezifikation für #99 angekündigt hat. | 4, 6 |
| 3 | Wie wird gerundet? | Die Anlage liefert je Empfänger einen **exakten Gewichtsvektor**; jede Kostenposition wird damit **einmal** nach #202 verteilt. Mieter, Leerstand, Eigennutzung, Pauschale bleiben die bekannten Empfänger. | 6.6 |
| 4 | Nutzerwechsel | **Zwischenablesung** ist Regelfall (§ 9b Abs. 1, 2). Grundkosten Heizung nach **Gradtagszahlen** (Vorgabe) oder zeitanteilig, Warmwasser zeitanteilig. Ohne Zwischenablesung werden die **gesamten Kosten der Wohnung** so geteilt (§ 9b Abs. 3). Lineare Interpolation eines Wärmestands gibt es nicht. | 6.4 |
| 5 | Öl, Flüssiggas, Pellets | **Bestandsrechnung**, Verbrauch statt Lieferung (§ 7 Abs. 2; BGH VIII ZR 156/11). Die Lieferrechnungen bleiben Kostenpositionen in voller Höhe (Steuer unverändert); die Bewegung des Vorrats steht als eigene Zeile beim Vermieter (`fuelCarry`). Ohne Bestand wird die Anlage nicht verteilt (Fehler), denn das heilt keine Kürzung. | 6.2 |
| 6 | Warmwasseranteil | Wärmezähler (Regel). Formeln des § 9 Abs. 2 nur als Ausnahme mit **beziffertem Kürzungsrecht von 15 %** (BGH VIII ZR 151/20), es sei denn, der Vermieter bestätigt den unzumutbaren Aufwand. Damit ist #211 erledigt. | 6.3 |
| 7 | Grund-/Verbrauchsanteil | Je Anlage und Jahr, getrennt für Heizung und Warmwasser, **Voreinstellung 70 %**. 70 % ist immer zulässig und in den Fällen des § 7 Abs. 1 S. 2 Pflicht. Über 70 % nur mit Vereinbarung (§ 10). | 6.5 |
| 8 | Schätzung | § 9a mit Vorschlag (Durchschnitt des Gebäudes je m²) und der **25-%-Schwelle**. Im kleinen Haus kippt schon ein ausgefallenes Gerät die ganze Anlage auf Fläche; das sagt die Oberfläche vorher. | 6.7 |
| 9 | Pflichtangaben § 6a Abs. 3 | Fester Druckblock. Was Mietfuchs weiß, füllt es selbst (Energieträger, Messkosten, Kontaktadressen, Vergleich); zwei Angaben fragt es ab (Steuern und Abgaben, Klimafaktoren). Fehlt etwas: 3 % beziffert. | 8 |
| 10 | Monatliche Verbrauchsinformation § 6a Abs. 1, 2 | Hinweis wie bisher; ein Ausdruck aus eingetragenen Monatswerten als **letzte, entbehrliche PR**. | 8.4, 14 |
| 11 | Zweifamilienhaus | Neue Objektart **„Zweifamilienhaus“** (aus #180). Die Ausnahme des § 2 bleibt an Tatsachen gebunden (≤ 2 Wohnungen, eine selbst bewohnt); neu ist der Schalter **„abweichende Verteilung vereinbart“** an der Anlage. | 7.4 |
| 12 | Wer nichts tut | merkt nichts. Ohne Heizanlage rechnet jede Heizposition wie heute, die Hinweise aus #140 bleiben. Kein automatischer Umbau bestehender Jahre. | 1, 10 |

---

## 1. Ziel in einfachen Worten

Wer keinen Messdienst hat und die Heizkosten selbst abrechnet, soll das mit Mietfuchs **rechtssicher** tun können. Mietfuchs teilt die Kosten der Heizung so auf, wie die Heizkostenverordnung es verlangt:

1. Erst wird getrennt, was die Heizung und was das Warmwasser gekostet hat.
2. Dann wird jeder Teil zur Hälfte bis zu drei Zehnteln nach Wohnfläche verteilt (Grundkosten) und der Rest nach dem gemessenen Verbrauch (Verbrauchskosten).
3. Zieht jemand im Jahr aus, wird zum Auszugstag abgelesen; die Grundkosten werden nach der Jahreszeit geteilt, weil im Winter mehr geheizt wird als im Sommer.
4. Auf dem Ausdruck steht alles, was die Verordnung vorschreibt, und ein Rechenweg, den der Mieter nachrechnen kann.

**Für wen:** private Vermieter mit 2 bis etwa 10 Wohnungen und einer gemeinsamen Heizung (Gas, Öl, Flüssiggas, Pellets, Fernwärme, Wärmepumpe), die selbst ablesen: Wärmemengenzähler, Warmwasserzähler oder elektronische Heizkostenverteiler. Der Marktvergleich zeigt, dass objego genau diese Gruppe bedient, aber eng (nur Gas, nur Kalenderjahr, keine Mischung); mibakus und NebenkostenFix rechnen breiter.

**Für wen nicht:** Wer einen Messdienst hat, bleibt beim Schlüssel „Einzelbeträge je Mieter“ (#94, #101); daran ändert sich nichts. Die Anleitung fragt zuerst „Wer erstellt Ihre Heizkostenabrechnung?“ und führt jeden auf seinen Weg (9.4).

**Die Zusage aus #91:** Ohne Heizanlage ändert sich keine Zahl. Die Golden-Tests bleiben centgenau grün.

---

## 2. Rechtslage mit Fundstellen

Alle Zitate aus der HeizkostenV sind am 04.10.2026 auf gesetze-im-internet.de gelesen. Was Festlegung von Mietfuchs ist und nicht im Wortlaut steht, steht in Abschnitt 13.

### 2.1 Anwendungsbereich (§§ 1–3, 11)

- **§ 1 Abs. 1:** zentrale Heizungs- und Warmwasseranlagen sowie gewerbliche Wärmelieferung (Fernwärme, Contracting).
- **§ 1 Abs. 2 Nr. 3:** Bei der vermieteten Eigentumswohnung steht der Wohnungseigentümer dem Mieter gegenüber wie ein Gebäudeeigentümer. Das ist der Fall `condo`; dort liefert in der Regel die Gemeinschaft die Heizkostenabrechnung (Schlüssel `external` oder `amounts`), eine eigene Anlage braucht es nicht.
- **§ 2:** „Außer bei Gebäuden mit nicht mehr als zwei Wohnungen, von denen eine der Vermieter selbst bewohnt, gehen die Vorschriften dieser Verordnung rechtsgeschäftlichen Bestimmungen vor.“ Die Reichweite (Geltung oder nur Vorrang) ist offen, siehe #85 und 13.8.
- **§ 11 Abs. 1:** Ausnahmen für die Wärme, unter anderem
  - Nr. 1 a: Heizwärmebedarf unter 15 kWh/(m²·a) (Passivhaus),
  - Nr. 1 b: Erfassung nur mit unverhältnismäßig hohen Kosten (nicht in zehn Jahren erwirtschaftet),
  - Nr. 1 c: vor dem 01.07.1981 bezugsfertig und Verbrauch nicht beeinflussbar,
  - Nr. 2: Heime,
  - Nr. 3: überwiegend Wärmerückgewinnung, Solar, KWK oder Abwärme ohne Erfassung,
  - Nr. 5: Befreiung durch die Landesbehörde.
- **§ 11 Abs. 2:** Für das Warmwasser gilt das entsprechend.

### 2.2 Erfassung (§§ 4, 5)

- **§ 4 Abs. 1, 2:** Der Gebäudeeigentümer hat den anteiligen Verbrauch zu erfassen und die Räume auszustatten.
- **§ 4 Abs. 3:** Gemeinschaftsräume sind ausgenommen, außer solche mit hohem Verbrauch (Schwimmbad, Sauna).
- **§ 5 Abs. 1 S. 1:** „Zur Erfassung des anteiligen Wärmeverbrauchs sind **Wärmezähler oder Heizkostenverteiler**, zur Erfassung des anteiligen Warmwasserverbrauchs **Warmwasserzähler** zu verwenden.“ Beide Geräte sind also gleichrangig zugelassen. Die Verordnung unterscheidet nicht danach, wer abliest.
- **§ 5 Abs. 1 S. 2:** Nur Geräte, deren Eignung bestätigt ist, soweit nicht das Eichrecht gilt.
- **§ 5 Abs. 2, 3:** Fernablesbarkeit für Geräte ab 01.12.2021, Nachrüstung bis 31.12.2026.
- **§ 5 Abs. 7:** Werden die Nutzer einer Anlage **nicht mit gleichen Ausstattungen** erfasst, ist zuerst nach Gruppen **vorzuerfassen**.

### 2.3 Verteilung (§§ 6–8, 10)

- **§ 6 Abs. 1 S. 1:** Verteilung „auf der Grundlage der Verbrauchserfassung nach Maßgabe der §§ 7 bis 9“.
- **§ 6 Abs. 1 S. 2:** Das Ableseergebnis bei nicht fernablesbaren Geräten soll in der Regel binnen eines Monats mitgeteilt werden.
- **§ 6 Abs. 4:** Die Wahl der Maßstäbe bleibt dem Gebäudeeigentümer; ändern darf er sie nur für künftige Zeiträume aus den genannten Gründen und nur zum Beginn eines Abrechnungszeitraums. Die Prüfung dazu gibt es schon (`keyChangeText`, #141).
- **§ 7 Abs. 1 S. 1:** Heizung mindestens 50, höchstens 70 % nach erfasstem Wärmeverbrauch.
- **§ 7 Abs. 1 S. 2:** **Zwingend 70 %** in Gebäuden, die die Wärmeschutzverordnung 1994 nicht erfüllen, mit Öl- oder Gasheizung, deren freiliegende Leitungen überwiegend gedämmt sind.
- **§ 7 Abs. 1 S. 3, 4:** Bei überwiegend ungedämmten Leitungen darf der Verbrauch nach anerkannten Regeln der Technik bestimmt werden (Rohrwärme, VDI 2077). Nicht-Ziel (12).
- **§ 7 Abs. 1 S. 5:** Der Rest nach Wohn- oder Nutzfläche oder umbautem Raum, auch nur der beheizten Räume.
- **§ 7 Abs. 2:** Kosten des Betriebs: „die Kosten des zur Wärmeerzeugung verbrauchten Stroms und der **verbrauchten** Brennstoffe und ihrer Lieferung, die Kosten des Betriebsstromes, die Kosten der Bedienung, Überwachung und Pflege der Anlage, der regelmäßigen Prüfung ihrer Betriebsbereitschaft und Betriebssicherheit einschließlich der Einstellung durch eine Fachkraft, der Reinigung der Anlage und des Betriebsraumes, die Kosten der Messungen nach dem Bundes-Immissionsschutzgesetz, die Kosten der Anmietung … einer Ausstattung zur Verbrauchserfassung sowie die Kosten der Verwendung … einschließlich der Kosten der Eichung sowie der Kosten der Berechnung, Aufteilung und Abrechnungs- und Verbrauchsinformationen gemäß § 6a.“
- **§ 7 Abs. 3, 4:** Wärmelieferung: Entgelt plus Kosten der Hausanlage; Abs. 1 S. 1 und 3 bis 5 gelten entsprechend, **S. 2 (zwingend 70 %) nicht**.
- **§ 8 Abs. 1:** Warmwasser 50 bis 70 % nach erfasstem Warmwasserverbrauch, Rest nach Fläche (kein umbauter Raum).
- **§ 8 Abs. 2:** Zu den Warmwasserkosten gehören die Kosten der Wasserversorgung, **„soweit sie nicht gesondert abgerechnet werden“**, und die Kosten der Wassererwärmung entsprechend § 7 Abs. 2.
- **§ 10:** Vereinbarungen über **mehr als 70 %** bleiben unberührt.

### 2.4 Verbundene Anlagen (§ 9)

- **Abs. 1 S. 1–4:** Einheitlich entstandene Kosten sind aufzuteilen, bei Kesseln nach dem **Brennstoff- oder Energieverbrauch**, bei Wärmepumpen und Wärmelieferung nach dem **Wärmeverbrauch**. Kosten, die nicht einheitlich entstanden sind, werden dem jeweiligen Teil hinzugerechnet. Die Heizung ist der Rest nach Abzug des Warmwassers.
- **Abs. 1 S. 5:** Bei Anlagen, die nicht ausschließlich durch Kessel, Wärmepumpe oder Lieferung versorgt werden (etwa Gas plus Solarthermie), dürfen anerkannte Regeln der Technik verwendet werden.
- **Abs. 2 S. 1:** „Die auf die zentrale Warmwasserversorgungsanlage entfallende Wärmemenge (Q) ist mit einem **Wärmezähler zu messen**.“
- **Abs. 2 S. 2, 3:** Nur bei **unzumutbar hohem Aufwand**: Q = 2,5 × V × (t_w − 10) in kWh/a, V in m³ gemessen, t_w gemessen oder geschätzt.
- **Abs. 2 S. 4, 5:** Wenn „in Ausnahmefällen“ weder Q noch V messbar sind: Q = 32 × A_Wohn.
- **Abs. 2 S. 6:** Die so bestimmte Wärmemenge ist bei brennwertbezogener Abrechnung von Erdgas **× 1,11**, bei Wärmelieferung **÷ 1,15** und bei einer monovalenten Wärmepumpe **× 0,30** zu nehmen. Der Wortlaut bezieht das nur auf die **Formelwerte**, nicht auf eine gemessene Wärmemenge.
- **Abs. 3:** Brennstoffverbrauch des Warmwassers B = Q / H_i. H_i laut Rechnung, sonst die Tabelle (Heizöl EL 10 kWh/l, Erdgas H 10 kWh/m³, Erdgas L 9, Flüssiggas 13 kWh/kg, Holzpellets 5 kWh/kg, Brennholz 4,1, Hackschnitzel 650 kWh/SRm …). „Soweit die Abrechnung über Kilowattstunden-Werte erfolgt, ist eine Umrechnung in Brennstoffverbrauch nicht erforderlich.“
- **Abs. 4:** Die Teile werden nach § 7 Abs. 1 und § 8 Abs. 1 verteilt.

### 2.5 Schätzung (§ 9a)

- **Abs. 1:** Kann der Verbrauch „wegen Geräteausfalls oder aus anderen zwingenden Gründen nicht ordnungsgemäß erfasst werden“, ermittelt ihn der Gebäudeeigentümer aus dem Verbrauch der Räume in vergleichbaren Zeiträumen, vergleichbarer anderer Räume im Zeitraum oder dem Durchschnitt des Gebäudes oder der Nutzergruppe.
- **Abs. 2:** Überschreitet die betroffene Fläche **25 %** der maßgeblichen Gesamtfläche, sind die Kosten **ausschließlich** nach den Flächenmaßstäben zu verteilen.

### 2.6 Nutzerwechsel (§ 9b)

- **Abs. 1:** Zwischenablesung ist Pflicht.
- **Abs. 2:** Verbrauchskosten nach der Zwischenablesung; die übrigen Wärmekosten **nach Gradtagszahlen oder zeitanteilig**, die übrigen Warmwasserkosten zeitanteilig.
- **Abs. 3:** Ist die Zwischenablesung nicht möglich oder technisch zu ungenau, sind die **gesamten Kosten** nach den Maßstäben des Abs. 2 für die übrigen Kosten aufzuteilen.
- **Abs. 4:** Abweichende Vereinbarungen bleiben unberührt.
- **Gradtagszahlen** (verbreitete Tabelle, Promille je Monat, Summe 1.000): Jan 170, Feb 150, Mär 130, Apr 80, Mai 40, Jun–Aug zusammen 40, Sep 30, Okt 80, Nov 120, Dez 160. Tagesgenau: Monatswert ÷ Tage des Monats, Juni bis August 40 ÷ 92 ([ista, Gradtagszahlentabelle](https://www.ista.com/de/kontakt-service/fachwissen/gradtagszahlentabelle/); ebenso [Berliner Mieterverein, Info 73](https://www.berliner-mieterverein.de/recht/infoblaetter/info-73-heizkostenabrechnung-worauf-achten-beim-mieterwechsel-zwischenablesung-und-gradtagszahlentabelle.htm)). Die Tabelle gilt laut ista für die Grundkosten der Wärme, nicht für Warmwasser.

### 2.7 Informationspflichten (§ 6a)

- **Abs. 1, 2:** Bei fernablesbaren Geräten ab 2022 **monatlich** Verbrauchsinformationen mit kWh des Monats, Vergleich mit Vormonat und Vorjahresmonat und mit einem Durchschnittsnutzer.
- **Abs. 3:** Beruht die Abrechnung auf Verbrauch oder HKV-Werten, sind mit der Abrechnung zugänglich zu machen:
  1. a) Anteil der Energieträger, bei Fernwärme auch Treibhausgasemissionen und Primärenergiefaktor; b) erhobene Steuern, Abgaben und Zölle; c) Entgelte für Geräte einschließlich Eichung, Ablesung und Abrechnung,
  2. Kontaktinformationen von Verbraucherorganisationen, Energieagenturen o. ä.,
  3. bei einem **Verbrauchervertrag** nach § 310 Abs. 3 BGB die Information zur Streitbeilegung,
  4. Vergleich mit einem normierten oder durch Vergleichstests ermittelten **Durchschnittsnutzer** derselben Kategorie,
  5. Vergleich des **witterungsbereinigten** Verbrauchs mit dem Vorjahr **in grafischer Form** (Wärme witterungsbereinigt, Warmwasser nicht).
- **Abs. 5:** Abrechnungen, die nicht auf Verbrauch beruhen, brauchen nur Nr. 2 und 3.

### 2.8 Kürzung (§ 12)

- **Abs. 1 S. 1:** Nicht verbrauchsabhängig entgegen der Verordnung → **15 %** auf den nicht verbrauchsabhängig abgerechneten Anteil.
- **Abs. 1 S. 2, 3:** Fehlende Fernablesbarkeit oder fehlende/unvollständige Informationen nach § 6a → **3 %**.
- **Abs. 1 S. 4:** Gilt nicht zwischen Wohnungseigentümer und Gemeinschaft.
- **Abs. 3:** Wärmepumpen: Erfassung bis 30.09.2025 nachzurüsten; bei Bruttowarmmiete Durchschnittskosten 2022–2024 je Nutzeinheit nach Fläche zu bestimmen.
- Ob sich Kürzungen addieren, sagt der Wortlaut nicht; Mietfuchs nennt jede einzeln (wie CO₂-Spezifikation 11.6).

### 2.9 Rechtsprechung (nur mit belegter Fundstelle)

- **BGH, Urteil vom 01.02.2012, VIII ZR 156/11:** Heizkosten dürfen nicht nach dem Abflussprinzip (bezahlte Rechnungen des Jahres) abgerechnet werden, sondern nur nach den **im Zeitraum verbrauchten** Brennstoffen. Der Fehler lässt sich **nicht** über die Kürzung nach § 12 ausgleichen ([Berliner Mieterverein](https://www.berliner-mieterverein.de/recht/bgh/bgh1203.htm), [Otto Schmidt](https://www.otto-schmidt.de/news//abrechnung-nach-dem-abflussprinzip-im-anwendungsbereich-der-heizkostenv-nicht-zulassig-2012-02-01.html)). Grundlage von Entscheidung 5.
- **BGH, Urteil vom 12.01.2022, VIII ZR 151/20:** Fehlt der nach § 9 Abs. 2 S. 1 vorgeschriebene Wärmezähler für das Warmwasser, ist die Abrechnung insoweit nicht verbrauchsabhängig; der Mieter darf um **15 %** kürzen, auch wenn die Wohnungen HKV und Warmwasserzähler haben ([VDIV](https://vdiv.de/aktuelles/urteile/details/fehlender-waermezaehler-fuer-warmwasseranteil), [Berliner Mieterverein](https://www.berliner-mieterverein.de/recht/bgh/heiz-und-warmwasserkostenabrechnung.htm)). Grundlage von Entscheidung 6.
- **BGH, Urteil vom 14.11.2007, VIII ZR 19/07:** Kosten der Zwischenablesung beim Auszug (Nutzerwechselgebühr) sind **keine Betriebskosten**, sondern Verwaltungskosten des Vermieters, sofern nichts anderes vereinbart ist ([iww](https://www.iww.de/mk/archiv/mieterwechsel-zwischenablesekosten-sind-keine-betriebskosten-f17309), [bmgev](https://bmgev.de/mietrecht/urteile/kosten-der-verbrauchserfassung-zwischenablesung-bei-mieterwechsel)). Folge: Teil „Messdienst“ mit dem Hinweis, dass eine Nutzerwechselgebühr in „Nicht umlagefähig“ gehört.
- **BGH, Urteil vom 19.07.2006, VIII ZR 212/05:** Warmmiete außerhalb des § 2 (steht schon in `rules.ts`, Regel `heating-flat-rate`).
- **BGH VIII ZR 159/05:** Leerstand trägt der Vermieter (steht schon in CLAUDE.md, #177).

### 2.10 Fundstellen Gesetz

HeizkostenV: [§ 1](https://www.gesetze-im-internet.de/heizkostenv/__1.html), [§ 2](https://www.gesetze-im-internet.de/heizkostenv/__2.html), [§ 4](https://www.gesetze-im-internet.de/heizkostenv/__4.html), [§ 5](https://www.gesetze-im-internet.de/heizkostenv/__5.html), [§ 6](https://www.gesetze-im-internet.de/heizkostenv/__6.html), [§ 6a](https://www.gesetze-im-internet.de/heizkostenv/__6a.html), [§ 7](https://www.gesetze-im-internet.de/heizkostenv/__7.html), [§ 8](https://www.gesetze-im-internet.de/heizkostenv/__8.html), [§ 9](https://www.gesetze-im-internet.de/heizkostenv/__9.html), [§ 9a](https://www.gesetze-im-internet.de/heizkostenv/__9a.html), [§ 9b](https://www.gesetze-im-internet.de/heizkostenv/__9b.html), [§ 10](https://www.gesetze-im-internet.de/heizkostenv/__10.html), [§ 11](https://www.gesetze-im-internet.de/heizkostenv/__11.html), [§ 12](https://www.gesetze-im-internet.de/heizkostenv/__12.html).

---

## 3. Messgeräte: was Mietfuchs selbst abrechnet

### 3.1 Die Frage

#85 und #99 haben Heizkostenverteiler (HKV) ausgeschlossen, weil „Bewertungsfaktoren nur beim Messdienst liegen“. Die Vorgabe „vollständig“ verlangt, das neu zu prüfen. Drei Gerätearten sind zu unterscheiden:

| Gerät | Was es anzeigt | Selbst ablesbar? | Was fehlt dem Vermieter? |
|---|---|---|---|
| **Wärmemengenzähler** | kWh, geeicht | ja | nichts |
| **Elektronischer HKV, Produktskala** | Verbrauchseinheiten, Heizkörperleistung und Ankopplung schon eingerechnet; der „Ablesewert entspricht dann dem abzurechnenden Wert“ | ja, Anzeige am Gerät; Stichtagswert gespeichert | nichts außer der Gewissheit, dass alle Geräte der Anlage dieselbe Skala haben |
| **Elektronischer HKV, Einheitsskala** | Rohwert; „der abgelesene Verbrauchswert wird mit einem **Bewertungsfaktor** multipliziert“ | ja | der Bewertungsfaktor je Heizkörper (aus dem Montageprotokoll oder vom Lieferanten der Geräte) |
| **Verdunster** | Füllstand an einer Skala, jährlicher Ampullentausch, Kaltverdunstungsvorgabe | praktisch nein | Skala, Vorgabe, Ampullentausch: Sache des Ablesedienstes |

Belege: [Haufe, HeizKV § 5.3 Verdunster](https://www.haufe.de/id/beitrag/heizkv-ausstattung-zur-verbrauchserfassung-53-heizkostenverteiler-nach-dem-verdunstungsprinzip-HI14901065.html) (Einheits- und Produktskala, Bewertungsfaktor), [Berliner Mieterverein, Erfassungsgeräte](https://www.berliner-mieterverein.de/?p=1250): Bei der Einheitsskala muss der Umrechnungsfaktor **in der Abrechnung genannt werden**, sonst ist sie nicht nachvollziehbar.

### 3.2 Entscheidung

**Unterstützt:**

1. **Wärmemengenzähler** je Wohnung (kWh). Der Regelfall des Issues.
2. **Warmwasserzähler** je Wohnung (m³). Neuer Zählertyp `warmwasser`.
3. **Elektronische HKV, selbst abgelesen.** Neuer Zählertyp `hkv`, ein Zähler je Heizkörper, mit **Skala** (`product` | `unit`) und **Bewertungsfaktor** (bei `unit` Pflicht, bei `product` fest 1). Zusätzlich die **Bauart** an der Anlage, denn alle Geräte einer Anlage müssen gleich sein (§ 5 Abs. 7).
4. **Verbrauchswerte eines Ablesedienstes** je Wohnung und Nutzungszeitraum (bewertete Einheiten oder kWh), ohne Gerätedaten. Damit sind Verdunster und Funk-HKV abgedeckt, die ein Dienst abliest, ohne abzurechnen, und jeder Fall, in dem der Vermieter nur einen Ablesebeleg hat.

**Nicht unterstützt:**

- **Verdunster selbst ablesen.** Die Auswertung hängt an Skala, Kaltverdunstungsvorgabe und Ampullentausch; ein Laie kann das nicht prüfbar leisten. Die Oberfläche bietet stattdessen Weg 4 an.
- **Gemischte Ausstattung in einer Anlage** (etwa Wärmezähler in zwei Wohnungen, HKV in den übrigen). Das verlangt eine Vorerfassung nach Gruppen mit eigenem Gruppenzähler (§ 5 Abs. 7). Im kleinen Haus selten; Mietfuchs meldet `heating.mixed-capture` (Fehler) und verweist auf den Messdienst.
- **Rohrwärme** (§ 7 Abs. 1 S. 3, 4, VDI 2077).

**Warum das rechtssicher machbar ist:** Die Verordnung lässt beide Gerätearten gleichrangig zu und schreibt nicht vor, wer abliest. Rechenweg und Ausweis sind bei HKV dieselben wie bei Wärmezählern, nur in Einheiten statt kWh. Das Risiko liegt allein bei falschen Bewertungsfaktoren, und das ist ein Risiko der Eingabe, das Mietfuchs durch Pflichtfeld, Plausibilitätsprüfung und den Ausweis je Gerät sichtbar macht (der Mieter kann jeden Faktor nachprüfen). Ein Konkurrent (objego) tut dasselbe. **Nicht** zusichern kann Mietfuchs die Eignung der Geräte (§ 5 Abs. 1 S. 2); das sagt das Lexikon.

### 3.3 Folgen für die Ablesung

- **Elektronische HKV setzen sich am Stichtag zurück** und speichern den Stichtagswert. Erfasst wird das wie ein Zählerwechsel: Ablesung am Stichtag mit `replacement: true`, `oldEndValue` = Stichtagswert, `value` = 0. Die Oberfläche fragt nur „Stichtagswert“ und „aktueller Wert“; die Mechanik aus `meterSegments` bleibt.
- **Der Gerätestichtag muss der Beginn des Abrechnungszeitraums sein.** Weicht er ab, `heating.device-cutoff` (Warnung).
- **Wärmemengenzähler und Warmwasserzähler** laufen durch und werden wie heute abgelesen.

---

## 4. Die Heizanlage als Konzept

### 4.1 Warum eine eigene Sache

Die Kosten einer Heizung entstehen am **Gerät im Keller**, nicht an einer Kostenart. Der Topf für § 9 (Heizung gegen Warmwasser), für § 7 (Grund gegen Verbrauch) und für das CO₂KostAufG (Einstufung, Abzug) ist derselbe: alle Kosten dieser Anlage. NebenkostenFix hat denselben Schnitt (`heizung.py`: die Anlage trägt Rechnungen, Verbrauchsanteil, Warmwassertrennung und CO₂). Die CO₂-Spezifikation sagt in 4.2 und 15 ausdrücklich: „eine eigene Anlagen-Entität kommt erst mit #99“. Diese Spezifikation liefert sie.

### 4.2 Was eine Anlage weiß (dauerhaft, Stammdaten)

- Name (ab der zweiten Anlage nötig, „Vorderhaus“),
- **Energie:** `gas | oil | lpg | pellets | wood | districtHeating | heatPump | electric | other`. Gleiche Werte wie `properties.heating_energy` aus der CO₂-Spezifikation (dort `biomass` für Holz und Pellets; hier getrennt, weil der Heizwert verschieden ist, siehe 13.12),
- **Warmwasser:** `combined` (über dieselbe Anlage, § 9) | `separate` (eigene zentrale Warmwasseranlage) | `none` (dezentral, etwa Durchlauferhitzer je Wohnung),
- **Erfassung Wärme:** `heatMeter | hca | serviceValues`,
- **Bauart der HKV** (Freitext, für den Ausweis),
- **Flächenmaßstab:** `area` (Wohnfläche) | `heatedArea` (beheizte Fläche, je Wohnung eintragbar); umbauter Raum nicht (12),
- **Nutzerwechsel Heizung:** `degreeDays` (Vorgabe) | `time`,
- **versorgte Einheiten** (Vorgabe: alle Wohnungen des Objekts; Garage ohne Anschluss bleibt draußen),
- **Ausnahme § 11** (`none` Vorgabe | `lowDemand | disproportionate | pre1981 | renewable | authority`),
- **§ 2 vereinbart:** ob im selbstbewohnten Zweifamilienhaus eine abweichende Verteilung vereinbart ist, und welche (`area` | `fixedPercent` | `consumption`).

### 4.3 Was je Abrechnungszeitraum dazukommt

- Zeitraum (gleich dem der Abrechnung des Objekts, siehe 11),
- Verbrauchsanteil Heizung und Warmwasser in Prozent (Vorgabe 70/70),
- § 7 Abs. 1 S. 2 trifft zu (ja/nein/unbekannt),
- Vereinbarung über 70 % (§ 10),
- **Warmwasseranteil:** Methode und Eingangswerte (6.3),
- **Brennstoffbestand** (Öl, Flüssiggas, Pellets, Holz): Anfangs- und Endbestand (6.2),
- **Angaben nach § 6a Abs. 3**, die Mietfuchs nicht selbst kennt (8),
- Schätzungen nach § 9a (6.7).

### 4.4 Kostenpositionen an der Anlage

Eine Kostenposition der Kostenart „Heizung und Warmwasser“ kann einer Anlage zugeordnet werden. Dann gilt:

- **Schlüssel `heatingSystem`** („nach Heizkostenverordnung“), neuer Wert von `CostKey`. Die übrigen Schlüsselfelder bleiben leer.
- **Teil** (`heatingPart`): `fuel` (Brennstoff, Fernwärme-Entgelt, Wärmepumpenstrom) | `operating` (Betriebsstrom, Wartung, Reinigung, Immissionsmessung, Bedienung) | `metering` (Gerätemiete, Eichung, Ablesung, Abrechnung).
- **Ziel** (`heatingTarget`): `both` (einheitlich entstanden, Vorgabe) | `heating` | `water`. Beispiel: Miete der Wärmezähler `heating`, Miete der Warmwasserzähler `water`.
- **Brennstoffangaben** (nur bei `fuel`): Menge mit Einheit (l, kg, m³, kWh, SRm), Energie in kWh, Rechnungszeitraum, Anteil im Abrechnungszeitraum (‰, Vorschlag 6.2). Hier docken die CO₂-Felder an (kg CO₂, CO₂-Kosten; 7.6).

Die **Kostenart Schornsteinfeger** bleibt eine eigene Kostenart. Die Immissionsmessung gehört aber nach § 7 Abs. 2 zur Heizung; die Anleitung sagt, sie in der Heizanlage zu erfassen, die übrige Kehrung als Schornsteinfeger. Das löst den Befund aus dem Marktvergleich 3.3 ohne Umbau.

**Nutzerwechselgebühr** ist kein Teil der Anlage (BGH VIII ZR 19/07). Erkennt die KI oder die Beschreibung „Nutzerwechsel“ oder „Zwischenablesung“, schlägt das Formular „Nicht umlagefähig“ vor.

---

## 5. Datenmodell

Migrationen erzeugt mit `npm --prefix server run db:generate`. Nummern nach der CO₂-Arbeit (0014) und #208; hier `00NN` genannt. Keine Datenanweisung, der eingefrorene Eingang bleibt unberührt.

### 5.1 `heating_systems`

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | text PK | |
| `property_id` | text, `RESTRICT` | |
| `name` | text, Vorgabe `''` | |
| `energy` | enum wie 4.2 | Pflicht |
| `hot_water` | `'combined' \| 'separate' \| 'none'` | Vorgabe `combined` |
| `capture` | `'heatMeter' \| 'hca' \| 'serviceValues'` | Vorgabe `heatMeter` |
| `hca_model` | text, nullbar | Bauart |
| `area_basis` | `'area' \| 'heatedArea'` | Vorgabe `area` |
| `change_split` | `'degreeDays' \| 'time'` | Vorgabe `degreeDays` |
| `exemption` | `'none' \| 'lowDemand' \| 'disproportionate' \| 'pre1981' \| 'renewable' \| 'authority'` | Vorgabe `none` |
| `agreed_otherwise` | `null \| 'area' \| 'fixedPercent' \| 'consumption'` | § 2 |

### 5.2 `heating_system_units`

Primärschlüssel `(system_id, unit_id)`, beide `CASCADE`. Spalte `heated_area_m2` real, nullbar, > 0. Ohne Zeilen versorgt die Anlage alle Einheiten des Objekts, die Wohnungen sind (`isDwelling`) und keinen Eintrag `noConnection: 'waerme'` haben. Hat ein Objekt zwei Anlagen, müssen beide Zeilen haben und sich ausschließen (400, wie CO₂ F9). `sameProperty` prüft die Einheit.

### 5.3 `heating_periods`

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | text PK | |
| `system_id` | `CASCADE` | |
| `year` | integer | Mietfuchs-Jahr; mit #208 der Abrechnungszeitraum des Objekts |
| `period_from`, `period_to` | text, Pflicht | Zeitraum (11) |
| `heat_consumption_pct`, `water_consumption_pct` | integer 50–100, Vorgabe 70 | über 70 nur mit `above_70_agreed` |
| `above_70_agreed` | boolean | § 10 |
| `insulation_rule` | `'applies' \| 'notApplies' \| 'unknown'` | § 7 Abs. 1 S. 2; `applies` zwingt 70 |
| `dhw_method` | `'heatMeter' \| 'volumeFormula' \| 'areaFormula'` | nur bei `combined` |
| `dhw_heat_kwh` | real, nullbar | Q gemessen, sonst aus den Zählern mit Rolle `dhwHeat` |
| `total_heat_kwh` | real, nullbar | Wärme gesamt (Wärmepumpe, Fernwärme, Anlage mit Gesamtzähler) |
| `dhw_volume_m3` | real, nullbar | V; leer = Summe der Warmwasserzähler |
| `dhw_temp_c` | real, Vorgabe 60 | t_w |
| `heating_value` | real, nullbar | H_i laut Rechnung, sonst Tabelle |
| `gas_basis` | `'hs' \| 'hi'` | Vorgabe `hs` (kWh nach Brennwert) |
| `dhw_unmeasurable` | boolean | Vermieter bestätigt den unzumutbaren Aufwand (§ 9 Abs. 2 S. 2) |
| `stock_unit` | `'l' \| 'kg' \| 'srm'`, nullbar | |
| `opening_quantity`, `opening_cost_cents` | nullbar | Anfangsbestand mit Wert (vorbelegt aus dem Vorjahr) |
| `closing_quantity` | nullbar | Endbestand |
| `info_taxes_text` | text, nullbar | § 6a Abs. 3 Nr. 1 b |
| `info_district_ghg`, `info_district_pef` | nullbar | Fernwärme, Nr. 1 a |
| `climate_factor`, `climate_factor_prev` | real, nullbar | Nr. 5 (DWD-Klimafaktor je PLZ) |
| `consumer_contract` | boolean, Vorgabe false | Nr. 3 |

Eindeutig je `(system_id, year)`. Die Bestandsfelder sind dieselben, die die CO₂-Spezifikation in `co2_statements` vorsieht; sie stehen **einmal**, hier (7.6).

### 5.4 `heating_estimates` (§ 9a)

Primärschlüssel `(period_id, unit_id, part)`, `part` `'heat' | 'water'`. Spalten: `value` (kWh, Einheiten oder m³), `method` (`'previousPeriod' | 'comparableUnit' | 'buildingAverage'`), `reason` (Text, Pflicht), `confirmed` boolean. Ohne Zeile gilt der gemessene Wert.

### 5.5 `heating_service_values` (Erfassung `serviceValues`)

Primärschlüssel `(period_id, unit_id, from)`. Spalten `to`, `heat_value`, `water_value` (nullbar). Je Wohnung eine Zeile je Nutzungszeitraum, wie auf dem Ablesebeleg.

### 5.6 Änderungen an bestehenden Tabellen

- `cost_items`: `heating_system_id` (nullbar, `RESTRICT`), `heating_part`, `heating_target`, Bedingung „alle drei gesetzt genau dann, wenn `key = 'heatingSystem'`“.
- `cost_item_fuel` (neu, 1:1 zu `cost_items`, `CASCADE`): `quantity`, `quantity_unit`, `energy_kwh`, `invoice_from`, `invoice_to`, `share_permille` (0–1000, Vorgabe 1000), `delivered_at`. Die CO₂-Spalten `emissions_kg` und `co2_cost_cents` kommen mit der CO₂-Arbeit hinzu (7.6).
- `meters`: Typen `warmwasser` und `hkv` dazu; `rating_factor` (real, nullbar, > 0), `hca_scale` (`'product' | 'unit'`, nullbar), `heating_role` (`'dhwHeat' | 'totalHeat'`, nullbar: Wärmezähler am Warmwasserbereiter bzw. am Erzeuger, beide ohne Wohnung), `remote_readable` (boolean, nullbar; zugleich #214).
- `properties.kind`: Wert `zfh` dazu (7.4).

`text({ enum })` bindet nur den Übersetzer, deshalb stehen alle Aufzählungen auch als Bedingung im SQL (CLAUDE.md, Prüfbedingungen). Die Erweiterung der Bedingungen an `meters.type`, `cost_items.meter_type`, `cost_items.key` und `properties.kind` erzeugt drizzle-kit als Neubau der Tabelle; der Praxislauf und die Migrationsprüfung auf einer Datenbank von 0.10.1 gehören deshalb zur Durchsicht dieser PR.

### 5.7 Gemeinsames Modell (`shared/types.ts`)

- `MeterType` um `'warmwasser' | 'hkv'`; `CostKey` um `'heatingSystem'`; `PropertyKind` um `'zfh'`.
- `HeatingSystem`, `HeatingPeriod`, `HeatingEstimate`, `HeatingServiceValue`, `HeatingPart`, `HeatingTarget`, `CostItemFuel`.
- `LandlordReason` um `'fuelCarry'` (6.2).
- `Settlement.heating?: HeatingStatement[]` je Anlage (Eingangswerte, α samt Methode, Kosten je Topf, Preise je Einheit, Werte je Wohnung und Nutzer samt Ablesungen und Faktoren, Gradtagsanteile, Schätzungen, Angaben nach § 6a). Optional, weil frühere Abrechnungen es nicht kennen; friert beim Abschluss ein.
- `schema.test.ts` hält Schema und Typen zusammen.

### 5.8 Schnappschuss

`snapshot.ts` bekommt die Anlagen des Objekts, den Zeitraum des Jahres samt Schätzungen und Ablesedienstwerten und **die Brennstoffpositionen des Vor- und des Folgejahres derselben Anlage**, denn eine Gasrechnung von März bis März reicht in zwei Zeiträume (6.2). Die Begründung gehört als Kommentar an die Stelle, wie bei den Ablesungen: Wer dort nach Jahr filtert, bekommt eine stille Falschrechnung. Der Endbestand des Vorjahres kommt für die Vorbelegung dazu.

---

## 6. Berechnung

Neue Datei `server/src/heating.ts` mit reinen Funktionen; Einbau in `computeSettlement` über die Empfänger aus #202. Die Bezeichnungen: Anlage S, Zeitraum P, versorgte Wohnungen U, Fläche a_u (Wohn- oder beheizte Fläche).

### 6.1 Ablauf

1. **Kosten der Anlage einsammeln** (Positionen mit `heating_system_id = S` im Jahr, Brennstoff mit Abgrenzung nach 6.2).
2. **Warmwasseranteil α** bestimmen (6.3).
3. **Töpfe bilden:** K_H = (1 − α) · K_both + K_heating, K_W = α · K_both + K_water.
4. **Je Wohnung** Grund- und Verbrauchsanteil (6.5), mit Schätzungen (6.7).
5. **Je Wohnung auf Nutzer** (Mietverhältnisse, Leerstand, Eigennutzung) nach § 9b (6.4).
6. **Gewichte je Empfänger** für die drei Ziele `both`, `heating`, `water`; jede Position wird damit einmal verteilt (6.6).

### 6.2 Brennstoffkosten: Verbrauch statt Lieferung

**Gas, Fernwärme, Wärmepumpenstrom (Rechnung mit Zeitraum):** Jede Rechnung trägt `share_permille`, den Anteil, der in P fällt. Der Rest gehört in den Nachbarzeitraum. **Vorschlag nach Gradtagszahlen** über den Rechnungszeitraum, weil der Brennstoff überwiegend im Winter verbraucht wird; überschreibbar. Beispiel: Gasrechnung 15.03.2025–14.03.2026, Zeitraum 2025: Gradtagsanteil 621,3 ‰ (tagesgenau wären es 800 ‰). Deckt die Rechnung P genau ab (der Normalfall), ist der Anteil 1000 ‰ und nichts weiter zu tun.

**Öl, Flüssiggas, Pellets, Holz (Vorrat):** Bestandsrechnung wie in der CO₂-Spezifikation 5.2, und zwar **eine** für beide:

- Anfangsbestand Q₀ mit Wert €₀ (vorbelegt aus dem bewerteten Endbestand des Vorjahres),
- Lieferungen i (Positionen mit Teil `fuel` und Menge),
- Endbestand Q₁, bewertet zu den **jüngsten** Lieferungen (verbraucht wird das Älteste zuerst; Idee aus mibakus, kein Code),
- verbrauchte Kosten = €₀ + Σ Lieferungen − €₁.

**Wie das in die Abrechnung kommt, ohne Steuer und Summen zu verbiegen:** Die Lieferrechnungen bleiben Kostenpositionen **in voller Höhe** in ihrem Jahr. So stimmen Steuerübersicht (bezahlte Rechnungen, wie heute) und Belegarchiv. Die Differenz zum Verbrauch steht als **zwei Zeilen je Anlage**, die sich über alle Empfänger zu null aufheben:

- „Brennstoff aus Vorrat“ (+€₀ bzw. + Anteil früherer Rechnungen): mit den Gewichten des Ziels `both` auf die Empfänger verteilt, beim Vermieter als Gegenzeile −€₀ mit Grund `fuelCarry`.
- „Brennstoff im Vorrat“ (−€₁ bzw. − Anteil, der in den nächsten Zeitraum gehört): verteilt, beim Vermieter +€₁ mit Grund `fuelCarry`.

Daraus folgt: Σ aller Zeilen = Σ Kostenpositionen (Invariante bleibt), die Mieter zahlen genau den Verbrauch, und `fuelCarry` ist **die eine Stelle, an der eine Vermieterzeile bei widerspruchsfreien Daten das Vorzeichen wechseln darf** (Vorrat aus dem Vorjahr). Das steht als Ausnahme am Kommentar von `landlordRecipients`. In der Steuer ist `fuelCarry` weder Eigenanteil noch Werbungskosten, sondern zeitliche Verschiebung; `splitForTax` lässt die beiden Zeilen außen vor.

**Beispiel Heizöl (Werte der CO₂-Spezifikation 5.2, Preise ergänzt):**

| Posten | Menge | Wert |
|---|---|---|
| Anfangsbestand (aus 2024) | 2.000 l | 1.900,00 € |
| Lieferung 15.03.2025 | 3.000 l | 3.150,00 € |
| Lieferung 10.10.2025 | 2.500 l | 2.500,00 € |
| Endbestand 31.12.2025 | 1.800 l | aus der Lieferung vom 10.10.: 1.800,00 € |

Verbrauch 5.700 l, Kosten 1.900 + 3.150 + 2.500 − 1.800 = **5.750,00 €**. Bezahlt (Steuer 2025): 5.650,00 €. Die Mieter tragen 5.750 € zu ihren Anteilen; beim Vermieter steht `fuelCarry` −1.900 + 1.800 = −100 €. Nach Lieferungen wären es 5.650 € gewesen, im Jahr ohne Lieferung 0 €.

**Ohne Bestand** bei einer Vorratsenergie: `heating.fuel-stock-missing` (Fehler). Die Positionen der Anlage werden **nicht** verteilt (Grund `noBasis`), denn eine Abrechnung nach Lieferungen ist materiell falsch und keine Kürzung heilt sie (BGH VIII ZR 156/11). Der Text sagt, was einzutragen ist, auch für den häufigen Fall „Tank jedes Jahr zum Jahresende voll“: dann gleiche Menge am Anfang und Ende, der Wert folgt den Lieferungen.

### 6.3 Warmwasseranteil α (§ 9)

Nur bei `hot_water = combined`. Bei `separate` gibt es keine Aufteilung: Positionen mit Ziel `both` sind dann ein Eingabefehler (`heating.target-invalid`), die Anlage verteilt alles Heizungs- und Warmwasserbezogene nach seinem Ziel.

| Methode | Q (Wärme des Warmwassers) | Vergleichsgröße | Ergebnis α |
|---|---|---|---|
| `heatMeter` (Regel) | gemessen (Zähler mit Rolle `dhwHeat` oder `dhw_heat_kwh`) | Kessel: Energie des verbrauchten Brennstoffs in kWh (aus den Rechnungen bzw. Bestand × H_i); Wärmepumpe und Fernwärme: gemessene Gesamtwärme | α = Q / E bzw. Q / Q_gesamt |
| `volumeFormula` | 2,5 × V × (t_w − 10) | wie oben | Formelwert × 1,11 (Gas, kWh nach Brennwert) ÷ 1,15 (Wärmelieferung) × 0,30 (monovalente Wärmepumpe, Vergleich mit Strom in kWh) |
| `areaFormula` | 32 × A_Wohn (mit Warmwasser versorgte Fläche) | wie oben | wie oben |

- Bei Brennstoff in Litern oder Kilogramm ohne kWh: B = Q / H_i, α = B / B_gesamt (§ 9 Abs. 3). H_i laut Rechnung, sonst Tabelle.
- Gemessenes Q wird **nicht** mit 1,11 multipliziert (Wortlaut, 13.7).
- **Gas plus Solarthermie oder Wärmepumpe plus Heizstab** (§ 9 Abs. 1 S. 5): nur `heatMeter` mit gemessener Gesamtwärme (α = Q / Q_gesamt). Die Formeln sind dann gesperrt.
- **Prüfungen:** α ≤ 0 oder ≥ 1 → `heating.dhw-share-invalid` (Fehler, Anlage nicht verteilt). α unter 5 % oder über 50 % → `heating.dhw-share-implausible` (Hinweis mit den Eingangswerten).
- **Formel ohne Bestätigung** → `heating.dhw-not-metered` (Warnung) mit **15 %** je Mieter auf seine Heiz- und Warmwasserkosten (BGH VIII ZR 151/20). Mit `dhw_unmeasurable` wird es ein Hinweis ohne Betrag mit der Bitte, die Gründe aufzubewahren. `areaFormula` setzt zusätzlich voraus, dass auch V nicht gemessen ist; gibt es Warmwasserzähler, ist sie gesperrt.

**Beispiel (Erdgas, 60.000 kWh Hₛ, 200 m², 120 m³ Warmwasser):** gemessen 9.000 kWh → α = 15,0 %. Mit der Volumenformel: 2,5 × 120 × 50 = 15.000 kWh × 1,11 = 16.650 kWh → 27,75 %. Mit der Flächenformel: 32 × 200 = 6.400 × 1,11 = 7.104 kWh → 11,84 %. Die Spanne zeigt, warum die Verordnung den Zähler verlangt.

### 6.4 Nutzerwechsel (§ 9b)

Zuerst wird je **Wohnung** gerechnet, dann innerhalb der Wohnung auf die **Nutzer**. Nutzer sind die Mietverhältnisse, die Zeiten ohne Mietverhältnis (Leerstand, Vermieter) und bei selbstgenutzten Wohnungen die Eigennutzung.

- **Verbrauchskosten:** nach dem Verbrauch zwischen den Ablesungen am Ein- und Auszugstag (Zwischenablesung).
- **Grundkosten Heizung:** nach Gradtagszahlen (Vorgabe) oder Tagen, je nach `change_split`.
- **Grundkosten Warmwasser:** nach Tagen.
- **Ohne Zwischenablesung** (§ 9b Abs. 3): Die **gesamten** Heizkosten der Wohnung werden nach Gradtagen (bzw. Tagen) geteilt, die gesamten Warmwasserkosten nach Tagen. Technisch ist das dasselbe wie ein Wärmestand am Wechseltag, der nach Gradtagen fortgeschrieben wird, und ein Warmwasserstand, der nach Tagen fortgeschrieben wird; so wird es auch gebaut (eine Funktion `readingAt(meter, date, weight)`), aber der Rechenweg nennt es beim Namen: „keine Zwischenablesung, aufgeteilt nach § 9b Abs. 3“. Hinweis `heating.no-interim-reading`.
- **Was „am Wechseltag“ heißt:** Eine Ablesung am Auszugstag oder am Tag davor oder danach gilt als Zwischenablesung. Liegt sie weiter weg, wird sie nach Gradtagen fortgeschrieben und der Hinweis nennt den Abstand (13.1).
- **Gradtagsanteil** eines Zeitraums [d₁, d₂]: Σ der Tageswerte (Monatspromille ÷ Tage des Monats, Juni bis August 40 ÷ 92) geteilt durch dieselbe Summe über P. Über ein ganzes Kalenderjahr ist der Nenner 1.000; bei einem anderen Zeitraum (#208) ebenfalls, solange er zwölf Monate umfasst. Die Tabelle steht **einmal** in `shared/heating.ts` (`DEGREE_DAY_PERMILLE`), mit Fundstelle.

**Beispiel (Wechsel zum 30.09.):** Januar bis September 640 ‰, Oktober bis Dezember 360 ‰. Zeitanteilig wären es 273 zu 92 Tage, also 74,8 % zu 25,2 %. Wer am 1. Oktober einzieht, trägt 36 % der Grundkosten und nicht ein Viertel; der Befund aus #85 ist damit behoben.

**Leerstand:** Zeiten ohne Mietverhältnis tragen ihre Grundkosten (nach Gradtagen) und den gemessenen Verbrauch; Empfänger `vacancy`. Eine Wohnung, die das ganze Jahr leer steht, trägt ihre Grundkosten und ihren Verbrauch (oft fast null) als Leerstand. Das ist die Regel der Verordnung (die leere Wohnung ist Nutzeinheit) und entspricht BGH VIII ZR 159/05.

**Eigennutzung, Pauschale, Inklusivmiete, außerhalb der Abrechnungseinheit:** wie heute (`selfUse`, `flatRate`, `inclusive`, `outsideUnit`), nur mit dem Anteil aus der Anlage.

### 6.5 Grund- und Verbrauchskosten (§§ 7, 8)

Je Topf T ∈ {H, W} mit Verbrauchsanteil p_T:

- Grundkosten: K_T · (1 − p_T) · a_u / Σ a,
- Verbrauchskosten: K_T · p_T · v_u / Σ v, mit v_u = Wärme in kWh, HKV-Einheiten × Bewertungsfaktor (über alle Geräte der Wohnung) bzw. Warmwasser in m³.

Regeln für p:

- Vorgabe 70. Zulässig 50 bis 70. Über 70 bis 100 nur mit `above_70_agreed` (§ 10).
- `insulation_rule = applies` (Öl oder Gas, Wärmeschutz unter 1994, Leitungen überwiegend gedämmt) zwingt p_H = 70. Wählt jemand bei Öl oder Gas weniger als 70, fragt die Oberfläche danach; „unbekannt“ ergibt den Hinweis `heating.insulation-rule-unknown`. Bei Wärmelieferung gilt S. 2 nicht (§ 7 Abs. 3).
- Ist Σ v = 0 (niemand hat verbraucht oder alle Werte fehlen): Fehler `heating.no-consumption`, und dieser Topf wird **nur nach Fläche** verteilt, mit der 15-%-Warnung `heating.not-by-consumption` (wie #140). Unterstützen und warnen statt verweigern.

### 6.6 Gewichte und Rundung (#202)

Aus 6.3 bis 6.5 entsteht je Empfänger r ein exakter Anteil an jedem der drei Ziele:

- g_r(heating) = Anteil an K_H je Euro,
- g_r(water) = Anteil an K_W je Euro,
- g_r(both) = (1 − α) · g_r(heating) + α · g_r(water).

Jede Position der Anlage mit Betrag A und Ziel z bekommt die rohen Werte A · g_r(z) und wird mit `distributeCents` **einmal** verteilt. Der §35a-Lohnanteil der Wartung läuft mit `distributeLaborCents` mit denselben Gewichten. Damit gelten alle Zusagen aus #202 unverändert: Summe centgenau, jede Zeile höchstens 1 ct neben ihrem exakten Wert, Gleichstand nach Kennung. Die Zeilen der Mieter in der Abrechnung bleiben je Position; die Heizkostenabrechnung (9.2) zeigt die Töpfe und Preise.

### 6.7 Schätzung (§ 9a) und die 25-%-Schwelle

- **Wann:** Eine Wohnung hat für einen Topf keinen verwendbaren Wert im Zeitraum: Gerät ohne Ablesung zu Beginn oder Ende (mehr als 14 Tage neben dem Stichtag, 13.1), Zählerwechsel ohne Endstand, negativer Verbrauch, ausdrücklich als ausgefallen markiert.
- **Vorschlag:** Durchschnitt des Gebäudes je m² × Fläche (immer berechenbar); wahlweise Vorjahreswert der Wohnung oder eine vergleichbare Wohnung je m². Gespeichert wird der Wert mit Methode und Begründung (Pflicht).
- **Unbestätigt** rechnet Mietfuchs mit dem Vorschlag und warnt (`heating.estimate-unconfirmed`), denn die Ermittlung ist Sache des Gebäudeeigentümers. Bestätigt: Hinweis `heating.estimated` mit Methode im Ausweis.
- **Schwelle:** Σ Fläche der geschätzten Wohnungen > 25 % der Fläche des Topfs → dieser Topf **ausschließlich nach Fläche** (p_T = 0), Hinweis `heating.estimate-over-25`. Nach dem Wortlaut ist das eine Verteilung nach der Verordnung, also **keine** Kürzung nach § 12 (13.10).
- **Was ein Laie wissen muss:** Im Haus mit drei oder vier Wohnungen ist **jede** Wohnung mehr als 25 % der Fläche. Fällt dort ein einziges Gerät aus, wird der ganze Topf nach Fläche verteilt. Die Oberfläche sagt das, bevor jemand „ausgefallen“ markiert, und das Lexikon nennt das Zahlenbeispiel (6.8 B).

### 6.8 Nachgerechnete Beispiele

**A: Erdgas, drei Wohnungen, Wärme- und Warmwasserzähler, Mieterwechsel in C zum 30.09.2025.**

Kosten (alle Kostenart „Heizung und Warmwasser“, Anlage „Haus“):

| Position | Teil | Ziel | Betrag |
|---|---|---|---|
| Erdgas 01.01.–31.12.2025, 60.000 kWh Hₛ | fuel | both | 6.000,00 € |
| Betriebsstrom | operating | both | 180,00 € |
| Wartung | operating | both | 240,00 € |
| Immissionsmessung | operating | both | 60,00 € |
| Miete Wärmezähler | metering | heating | 120,00 € |
| Miete Warmwasserzähler | metering | water | 60,00 € |
| **Summe** | | | **6.660,00 €** |

- Warmwasser gemessen 9.000 kWh → α = 15 %. Einheitlich 6.480 € → Warmwasser 972 + 60 = **1.032,00 €**, Heizung 5.508 + 120 = **5.628,00 €**.
- 70/30: Heizung Verbrauch 3.939,60 €, Grund 1.688,40 €; Warmwasser Verbrauch 722,40 €, Grund 309,60 €.
- Flächen A 60, B 80, C 60 m²; Wärme A 12.000, B 16.000, C 12.000 kWh; Warmwasser A 30, B 40, C 50 m³.

| Wohnung | Grund Heizung | Grund WW | Verbrauch Heizung | Verbrauch WW | Summe exakt |
|---|---|---|---|---|---|
| A | 506,52 | 92,88 | 1.181,88 | 180,60 | 1.961,88 |
| B | 675,36 | 123,84 | 1.575,84 | 240,80 | 2.615,84 |
| C | 506,52 | 92,88 | 1.181,88 | 301,00 | 2.082,28 |

C mit Zwischenablesung am 30.09.: Wärme 7.200 / 4.800 kWh, Warmwasser 38 / 12 m³.

| Nutzer | Grund Heizung (Gradtage 640/360 ‰) | Grund WW (273/92 Tage) | Verbrauch Heizung | Verbrauch WW | Summe exakt |
|---|---|---|---|---|---|
| C1 (bis 30.09.) | 324,1728 | 69,4692 | 709,1280 | 228,7600 | 1.331,5300 |
| C2 (ab 01.10.) | 182,3472 | 23,4108 | 472,7520 | 72,2400 | 750,7500 |

Je Position nach #202 verteilt (in €):

| Position | A | B | C1 | C2 |
|---|---|---|---|---|
| Erdgas | 1.768,50 | 2.358,00 | 1.196,44 | 677,06 |
| Betriebsstrom | 53,06 | 70,74 | 35,89 | 20,31 |
| Wartung | 70,74 | 94,32 | 47,86 | 27,08 |
| Immissionsmessung | 17,69 | 23,58 | 11,96 | 6,77 |
| Miete Wärmezähler | 36,00 | 48,00 | 22,03 | 13,97 |
| Miete Warmwasserzähler | 15,90 | 21,20 | 17,34 | 5,56 |
| **Summe** | **1.961,89** | **2.615,84** | **1.331,52** | **750,75** |

Σ = 6.660,00 €. A liegt 1 ct über seinem exakten Gesamtwert (zwei Positionen enden auf ,5 ct, der Gleichstand geht nach Kennung an A), C1 1 ct darunter. Das ist die Regel aus #202 (je Position höchstens 1 ct) und kein Fehler. Gegenproben für den Test: Grundkosten Heizung C1 zeitanteilig wären 378,85 € statt 324,17 €; ohne Zwischenablesung (§ 9b Abs. 3) trüge C1 1.375,18 €.

**B: Ein Gerät fällt aus.** Im Beispiel A fällt der Wärmezähler von B aus. Vorschlag: Durchschnitt 24.000 kWh / 120 m² × 80 m² = 16.000 kWh. B hat 80 von 200 m² = **40 %** > 25 % → der Topf Heizung (5.628,00 €) wird **nur nach Fläche** verteilt: A 1.688,40 €, B 2.251,20 €, C 1.688,40 € (C dann nach Gradtagen 1.080,58 / 607,82 €). Der Topf Warmwasser bleibt nach Verbrauch, denn der Warmwasserzähler von B läuft. Mit fünf Wohnungen à 40 m² wäre eine ausgefallene Wohnung 20 % und die Schätzung bliebe.

**C: Heizöl mit Vorrat** wie in 6.2; Verteilung wie A mit verbrauchten 5.750 € statt 6.000 € Gas; `fuelCarry` −100 €.

**D: Gasrechnung über den Jahreswechsel** (15.03.2025–14.03.2026, 6.500 €, Zeitraum 2025): Vorschlag 621,3 ‰ = 4.038,39 € in 2025; 2.461,61 € gehören nach 2026 und stehen 2025 als `fuelCarry` beim Vermieter, 2026 als „Brennstoff aus früherer Rechnung“.

---

## 7. Zusammenspiel

### 7.1 Mit den bestehenden Hinweisen (#140)

- Positionen mit `heatingSystem` zählen als **nach Verbrauch verteilt** (`heatingByConsumption`), solange die Anlage nicht nach 6.5 oder 6.7 auf Fläche fällt. Dann meldet die Anlage selbst.
- `heating.consumption-share` (50–70 %) entfällt für Anlagenpositionen: Der Anteil ist eine Eingabe und wird beim Speichern geprüft.
- `heating.remote-reading` bekommt mit `remote_readable` am Zähler seinen Betrag (#214); das ist ein kleiner Zusatz in PR 6.

### 7.2 Pauschale und Warmmiete

Wie heute: Der Anteil des Mietverhältnisses fällt dem Vermieter zu (`flatRate`, `inclusive`), die Warnung `heating.flat-rate` bleibt. **Neu:** Weil Mietfuchs den Heizkostenanteil jetzt kennt, nennt die Warnung ihn („nach der Verordnung entfielen auf Sie 1.331,52 €“). Den Rechenweg nach BGH VIII ZR 212/05 (Heizanteil der Warmmiete als Vorauszahlung) baut Mietfuchs nicht nach, das bleibt offen wie in #109.

### 7.3 Eigennutzung und Einliegerwohnung

Die selbstgenutzte Wohnung ist Nutzeinheit wie jede andere und wird abgelesen; ihr Anteil ist `selfUse` und in der Steuer privat (#163). Bei einer Einliegerwohnung mit Zwischenzähler ist das der häufigste Fall überhaupt.

### 7.4 Zweifamilienhaus mit Eigennutzung (§ 2, § 11)

- **Objektart „Zweifamilienhaus“** (`zfh`) kommt dazu, wie in #180 vermerkt. Sie ist eine Beschreibung für Oberfläche und Anleitung. **Die Ausnahme des § 2 hängt weiter an den Tatsachen** (`mayAgreeOtherwise`: höchstens zwei Wohnungen, eine selbst bewohnt). Widersprechen sich Art und Tatsachen (drei Wohnungen angelegt), Hinweis `property.kind-mismatch`.
- **„Abweichende Verteilung vereinbart“** an der Anlage (`agreed_otherwise`) ist nur wählbar, wenn `mayAgreeOtherwise` gilt. Dann rechnet die Anlage nach Fläche, mit festem Prozentsatz der Mietwohnung oder nach Verbrauch mit freiem Anteil, und es gibt keinen Hinweis nach § 12. Ohne Vereinbarung gilt die Verordnung auch dort (13.8).
- **§ 11:** Gewählte Ausnahme → Verteilung nach Fläche ohne § 12-Hinweis, dafür `heating.exemption` (Hinweis: Nachweis aufbewahren). Die CO₂-Arbeit liest denselben Wert für § 2 Abs. 7 CO2KostAufG.

### 7.5 Vermietete Eigentumswohnung

Keine eigene Anlage: Die Gemeinschaft liefert die Heizkostenabrechnung (§ 1 Abs. 2 Nr. 3, § 3). Die Anlage ist für Objekte der Art `etw` nicht anlegbar; die Anleitung `condo` sagt das.

### 7.6 CO₂-Kostenaufteilung (#97)

Die CO₂-Spezifikation sieht einen Datensatz je **Heizanlage** und Jahr vor und rechnet den Abzug je Mieter aus dessen exakten Anteilen am Topf (r_t = ‰ · C · x_t / A). Mit dieser Spezifikation wird daraus:

- `co2_statements.heating_system_id` (nullbar). Ist sie gesetzt, ist der **Topf die Anlage** (alle Positionen mit `heatingSystem` und dieser Anlage) und x_t die Summe der exakten Anteile aus 6.6. Ohne Anlage gilt die Regel der CO₂-Spezifikation (Kostenart). Kein Datenschritt nötig.
- **Bestand und Lieferungen stehen einmal.** Die Bestandsfelder liegen in `heating_periods`, die Lieferzeilen sind die Brennstoffpositionen mit `cost_item_fuel`; dort kommen `emissions_kg` und `co2_cost_cents` hinzu. Für die CO₂-Spezifikation heißt das: Ihre PR 3 (Öl) und PR 4 (mehrere Anlagen) bauen auf PR 1 und 2 dieser Spezifikation auf und legen keine eigenen Tabellen `co2_deliveries` und `co2_statement_units` an. Ihre PR 1 (Messdienst) ist davon unabhängig. Wer zuerst landet, ist für die Rechnung gleich; abzustimmen ist nur die Reihenfolge der Migrationen.
- **Anteil einer Rechnung im Zeitraum:** ein Wert je Rechnung (`share_permille`) für Brennstoffkosten und CO₂. Der Vorschlag ist hier Gradtag-gewichtet (6.2), in der CO₂-Spezifikation (F7) tagesgenau. **Vorschlag:** beide nach Gradtagen, weil kg und Euro derselben Rechnung im selben Verhältnis anfallen. Die Entscheidung ist mit der CO₂-Durchsicht zu treffen (13.2).
- **Abzug als eigene Zeile** (CO₂ 5.3) bleibt unverändert und kommt **nach** der Verteilung der Anlage; die 15- und 3-%-Beträge rechnen auf den Stand nach dem Abzug (CO₂ 5.6).
- `fuelCarry` beeinflusst den CO₂-Abzug nicht: C ist der CO₂-Preis des **verbrauchten** Brennstoffs, also aus derselben Bestandsrechnung.

### 7.7 Wasserkosten und Warmwasserzähler (§ 8 Abs. 2)

Wasser und Abwasser werden in Mietfuchs gesondert abgerechnet (Kostenart „Wasser/Abwasser“, Schlüssel nach Zählern). Damit gehören die Wasserkosten **nicht** in den Warmwassertopf; die Anlage nimmt keine Position der Kostenart Wasser auf. Damit das stimmt, muss der Wasserschlüssel den Warmwasserverbrauch mitzählen: **Beim Schlüssel „nach Verbrauch“ mit Zählertyp Kaltwasser zählen Warmwasserzähler mit.** Heute gibt es keine Zähler dieses Typs, also ändert sich keine Zahl. Ohne diese Regel landete das Warmwasservolumen im Rest des Hauptzählers (#116) beim Vermieter, sobald jemand seine Warmwasserzähler richtig als `warmwasser` anlegt. Test dazu in PR 0.

### 7.8 Steuer

- Werbungskosten: die Kostenpositionen wie bisher (bezahlte Rechnungen).
- Eigenanteil: die `selfUse`-Anteile der Anlagenpositionen, exakt aus 6.6.
- `fuelCarry` bleibt außen vor (6.2).
- Kein Eingriff in `taxReport` außer der Ausnahme für `fuelCarry`.

### 7.9 Mietkonto, Regression, Abschluss

- Mietkonto unberührt.
- Regression des Umstiegs: Die db.json kennt keine Anlage; beide Seiten rechnen ohne.
- Abgeschlossene Abrechnungen bleiben eingefroren, `Settlement.heating` friert mit; `deviation` zeigt nachträgliche Änderungen.

---

## 8. Pflichtangaben und Informationen (§ 6a)

### 8.1 Druckblock „Angaben nach § 6a Abs. 3 HeizkostenV“

Je Anlage und Mieter, auf dem Ausdruck, nicht `no-print`:

| Nr. | Inhalt | Woher |
|---|---|---|
| 1 a | „Eingesetzte Energieträger: Erdgas 100 %“; bei Fernwärme Treibhausgasemissionen und Primärenergiefaktor | Energie der Anlage; Fernwärmewerte abgefragt |
| 1 b | erhobene Steuern, Abgaben, Zölle | abgefragt (Text oder Beträge von der Versorgerrechnung: Energiesteuer, CO₂-Preis, Umsatzsteuer) |
| 1 c | Entgelte für Geräte, Eichung, Ablesung, Abrechnung | **automatisch**: Σ der Positionen mit Teil `metering` |
| 2 | Kontaktadressen | fester Text mit Verbraucherzentrale Energieberatung und Deutscher Energie-Agentur (Adressen bei der Umsetzung prüfen, 13.3) |
| 3 | Streitbeilegung | nur bei `consumer_contract`; Vorgabe nein, weil ein privater Vermieter in der Regel kein Unternehmer ist (13.11) |
| 4 | Vergleich mit Durchschnittsnutzer | **automatisch**: Verbrauch je m² der Wohnung gegen den Durchschnitt des Gebäudes (13.4) |
| 5 | witterungsbereinigter Vorjahresvergleich, grafisch | **automatisch** aus dem Vorjahreszeitraum, Wärme × Klimafaktor (DWD je Postleitzahl, abgefragt), Warmwasser unbereinigt; zwei Balken im Ausdruck |

- Fehlen 1 b oder 5 (etwa im ersten Jahr kein Vorjahr), Hinweis `heating.info-incomplete` mit **3 %** je Mieter (§ 12 Abs. 1 S. 3). Im ersten Jahr der Anlage sagt der Text, dass ein Vorjahresvergleich mangels Vorjahr entfällt, und beziffert nichts (13.5).
- Bei Verteilung nur nach Fläche (6.5, 6.7, 7.4) genügen Nr. 2 und 3 (§ 6a Abs. 5).

### 8.2 Ausweis der Bewertungsfaktoren

Bei HKV listet der Ausdruck je Gerät: Raum oder Bezeichnung, Ablesewert, Faktor, Einheiten. Ohne Faktor bei Einheitsskala: `heating.hca-factor-missing` (Fehler; die Wohnung zählt als nicht erfasst und geht in 6.7).

### 8.3 Mitteilung des Ableseergebnisses (§ 6 Abs. 1 S. 2)

Ein Ausdruck „Ableseergebnis“ je Wohnung aus den Ablesungen des Stichtags, auf der Zählerseite. Klein, in PR 1.

### 8.4 Monatliche Verbrauchsinformation (§ 6a Abs. 1, 2)

Sie betrifft nur fernablesbare Geräte, und wer solche hat, hat in der Regel einen Messdienst oder ein Funksystem mit eigener Ausgabe. Mietfuchs:

- **sofort:** der Hinweis `heating.remote-reading` wie bisher, mit Betrag über `remote_readable` (#214),
- **letzte PR (entbehrlich für 0.11.0):** „Verbrauchsinformation drucken“ je Mieter und Monat aus eingetragenen Monatsständen: Verbrauch des Monats, Vormonat, Vorjahresmonat, Gebäudedurchschnitt je m². Bei HKV ist der Verbrauch kein kWh-Wert; die Verordnung verlangt kWh (Abs. 2 Nr. 1). Offen (13.6).

---

## 9. Oberfläche

Die Logik liegt wie üblich ohne DOM prüfbar in `client/src/heatingForm.ts`; Auswahlfelder über Optionslisten (jsdom-Test „angezeigter Wert = gespeicherter Wert“).

### 9.1 Einstieg: „Wer erstellt Ihre Heizkostenabrechnung?“

Die Frage steht in den Stammdaten des Objekts unter „Heizung“ (dort steht auch der Energieträger aus der CO₂-Arbeit):

1. **Ein Messdienst** (Techem, ista …) → Anleitung `meteringService`, Schlüssel „Einzelbeträge“. Keine Anlage.
2. **Ich selbst, mit Zählern oder Heizkostenverteilern** → Assistent „Heizanlage einrichten“.
3. **Niemand, die Heizkosten werden nach Fläche verteilt** → Satz zu § 12 (15 %) und, bei Zweifamilienhaus mit Eigennutzung, zur Vereinbarung nach § 2.
4. **Jeder Mieter hat eine eigene Heizung** (Etagenheizung) → Satz: keine Heizkostenabrechnung; bei Vertrag auf den Vermieter Direktzuordnung, CO₂ siehe dort.

### 9.2 Assistent „Heizanlage einrichten“ (fünf Fragen, alles mit Vorgabe)

1. **Womit heizen Sie?** (Energie) — Vorgabe aus dem Objekt.
2. **Wird das Warmwasser über dieselbe Heizung erwärmt?** ja (Vorgabe) / eigene Anlage / jede Wohnung selbst.
3. **Wie wird der Verbrauch in den Wohnungen erfasst?** Wärmemengenzähler (Vorgabe) / elektronische Heizkostenverteiler / Werte von einem Ablesedienst / Verdunster (→ Satz: „Lassen Sie diese von einem Ablesedienst auswerten und tragen Sie die Werte ein“) / gemischt (→ Satz zum Messdienst).
4. **Welche Wohnungen hängen an dieser Heizung?** Vorgabe: alle Wohnungen.
5. **Gibt es einen Wärmezähler für das Warmwasser am Speicher?** ja (Vorgabe) / nein (→ Erklärung § 9 Abs. 2 mit dem 15-%-Satz, Auswahl der Formel, Bestätigung des unzumutbaren Aufwands nur mit Erklärung, was das heißt).

Danach legt der Assistent die fehlenden Zähler an (je Wohnung Wärme bzw. HKV je Heizkörper mit Skala und Faktor, je Wohnung Warmwasser, am Speicher Warmwasserwärme) und zeigt die Zählerseite.

**„Aus {Vorjahr} übernehmen“** kopiert die Einstellungen des Zeitraums (Anteile, Methode, t_w, Heizwert, Klimafaktor des Vorjahres als Vorjahreswert), nie Beträge; der Endbestand wird Anfangsbestand.

### 9.3 Seite „Heizkosten {Jahr}“

Erscheint in der Seitenleiste unter der Arbeitsphase „Erfassen“, sobald es eine Anlage gibt. Vier Karten:

1. **Kosten der Anlage:** Liste der zugeordneten Positionen mit Teil und Ziel; „+ Position“ öffnet das gewohnte Kostenformular mit vorbelegter Kostenart, Anlage und Teil. Brennstoff mit Menge, kWh und Rechnungszeitraum; bei Vorrat die Bestandszeilen mit Vorschau „verbraucht: 5.700 l = 5.750,00 €“.
2. **Warmwasser:** Methode, Werte, Vorschau α mit Rechenweg.
3. **Ablesungen:** Ampel je Wohnung: Stichtag Beginn, Stichtag Ende, Zwischenablesungen bei jedem Wechsel; fehlende Werte mit „Schätzen …“ (Dialog mit Vorschlag, Methode, Begründung und dem 25-%-Satz).
4. **Verteilung (Vorschau):** je Wohnung und Nutzer die vier Bausteine wie in 6.8, mit Preisen je m², kWh/Einheit und m³.

Darunter „Weitere Angaben“ (zugeklappt): Verbrauchsanteile, § 7 Abs. 1 S. 2, § 10, § 6a-Angaben, Ausnahmen.

### 9.4 An anderen Stellen

- **Kostenformular:** Bei Kostenart „Heizung und Warmwasser“ und vorhandener Anlage ist „Teil der Heizanlage“ vorausgewählt. Die bisherigen Schlüssel bleiben wählbar.
- **Mieterwechsel** (`POST /api/tenancies/:id/change`, #150): Die Zwischenablesungen fragen auch Wärme-, Warmwasserzähler und HKV der Wohnung ab, mit dem Satz, dass die Kosten der Zwischenablesung nicht umlagefähig sind.
- **Zählerseite:** Typen Warmwasser und HKV; bei HKV Skala, Faktor und der Stichtagswert.
- **Abrechnung:** je Mieter die Zeilen wie bisher (Schlüssel „nach Heizkostenverordnung“, `basisText` „siehe Heizkostenabrechnung“), dahinter je Anlage der **Druckblock „Heizkostenabrechnung“**: Kosten der Anlage einzeln, Brennstoff mit Bestand oder Abgrenzung, Aufteilung Heizung/Warmwasser mit Methode, Grund- und Verbrauchskosten mit Gesamteinheiten und Preis je Einheit, die eigenen Werte samt Ablesungen und Faktoren, beim Wechsel die Gradtagsanteile, Schätzungen mit Methode, die § 6a-Angaben, der CO₂-Block (CO₂-Spezifikation 6.2). Der Rechenweg (#114) je Zeile nennt den Anteil der Position aus den vier Bausteinen.
- **Cockpit:** Die Ampel liest die neuen Hinweise; `heating.estimated` und `heating.no-interim-reading` färben nicht (`INFORMATIONAL`).
- **Anleitungen** (`shared/guides.ts`): neue Anleitung „Heizkosten selbst abrechnen“ mit Beispiel A (guides.test.ts rechnet nach); `multiFamily`, `granny` und `meteringService` verweisen darauf; `condo` sagt, dass die Gemeinschaft abrechnet.

---

## 10. Hinweise, Regeln, Lexikon

### 10.1 Hinweis-Codes (`noticeKinds`)

| Code | Stufe | Wann | Betrag |
|---|---|---|---|
| `heating.fuel-stock-missing` | error | Vorratsenergie ohne Anfangs- oder Endbestand; Anlage nicht verteilt | – |
| `heating.stock-invalid` | error | Endbestand > Anfang + Lieferungen | – |
| `heating.dhw-share-invalid` | error | α ≤ 0 oder ≥ 1, oder Eingangswerte fehlen | – |
| `heating.mixed-capture` | error | Wohnungen einer Anlage mit verschiedenen Gerätearten | – |
| `heating.hca-factor-missing` | error | HKV mit Einheitsskala ohne Faktor | – |
| `heating.target-invalid` | error | Ziel `both` bei getrenntem Warmwasser | – |
| `heating.no-consumption` | warning | Σ Verbrauch eines Topfs 0; nach Fläche verteilt | 15 % je Mieter |
| `heating.dhw-not-metered` | warning | Formel ohne Bestätigung | 15 % je Mieter (BGH VIII ZR 151/20) |
| `heating.estimate-unconfirmed` | warning | Schätzvorschlag ohne Bestätigung | – |
| `heating.estimate-over-25` | hint | > 25 % geschätzt, Topf nach Fläche | – |
| `heating.info-incomplete` | warning | § 6a Abs. 3 Nr. 1 b oder 5 fehlt | 3 % je Mieter |
| `heating.device-cutoff` | warning | HKV-Stichtag ≠ Beginn des Zeitraums | – |
| `heating.insulation-rule-unknown` | hint | Öl/Gas, Anteil < 70, S. 2 unbekannt | – |
| `heating.dhw-share-implausible` | hint | α < 5 % oder > 50 % | – |
| `heating.no-interim-reading` | hint | Wechsel ohne Zwischenablesung, § 9b Abs. 3 | – |
| `heating.reading-off-date` | hint | Ablesung mehr als einen Tag neben Stichtag oder Wechsel, fortgeschrieben | – |
| `heating.estimated` | hint | bestätigte Schätzung | – |
| `heating.exemption` | hint | Ausnahme nach § 11 gewählt | – |
| `heating.change-fee` | hint | Position mit „Nutzerwechsel“ in der Anlage | – |
| `property.kind-mismatch` | hint | Art „Zweifamilienhaus“, aber mehr als zwei Wohnungen | – |

`NoticeSubject.kind` bekommt `'heatingSystem'`; „Hier beheben →“ führt auf die Seite Heizkosten.

### 10.2 Regelverzeichnis (`rules.ts`, `RULES_AS_OF` auf den Tag der Durchsicht)

| code | Norm |
|---|---|
| `heating-own-settlement` | §§ 6, 7, 8 HeizkostenV |
| `heating-dhw-split` | § 9 HeizkostenV; BGH VIII ZR 151/20 |
| `heating-estimate` | § 9a HeizkostenV |
| `heating-tenant-change` | § 9b HeizkostenV; BGH VIII ZR 19/07 |
| `heating-consumed-fuel` | § 7 Abs. 2 HeizkostenV; BGH VIII ZR 156/11 |
| `heating-info` | § 6a Abs. 3, 5; § 12 Abs. 1 S. 3 HeizkostenV |

Die bestehenden `heating-consumption`, `heating-flat-rate`, `heating-remote-reading` bleiben.

### 10.3 Lexikon (`shared/glossary.ts`)

Neu, jeweils mit Beispiel mit Zahlen und „Brauche ich das?“:

- `heatingSystem` „Heizanlage“,
- `baseCosts` „Grundkosten“, `consumptionCosts` „Verbrauchskosten“ (Beispiel A),
- `hotWaterShare` „Warmwasseranteil“ (die drei Werte 15 / 27,75 / 11,84 %),
- `degreeDays` „Gradtagszahlen“ (640/360 gegen 75/25),
- `interimReading` „Zwischenablesung“ (mit BGH VIII ZR 19/07: Kosten trägt der Vermieter),
- `heatMeter` „Wärmemengenzähler“, `heatCostAllocator` „Heizkostenverteiler und Bewertungsfaktor“ (Einheits- und Produktskala, warum Verdunster nicht),
- `heatingEstimate` „Schätzung bei Geräteausfall“ (die 25-%-Falle im kleinen Haus),
- `fuelStock` „Brennstoffvorrat“ (Beispiel C),
- `billingInfo` „Angaben nach § 6a“, `climateFactor` „Klimafaktor“.

---

## 11. Abrechnungszeitraum (#208)

- **Der Zeitraum der Anlage ist der Abrechnungszeitraum des Objekts.** Einen eigenen Heizzeitraum neben dem der übrigen Betriebskosten gibt es nicht. Begründung: Die Anlage rechnet mit denselben Mietverhältnissen, Vorauszahlungen und Leerständen; zwei Zeiträume wären zwei Abrechnungen. Die offene Rechtsfrage aus CO₂ 11.14 (abweichender Heizzeitraum ohne Vereinbarung) bleibt damit bei #208.
- **Bis #208 umgesetzt ist**, gilt das Kalenderjahr; `period_from`/`period_to` stehen trotzdem in der Tabelle und werden auf den 01.01./31.12. gesetzt.
- **Was #208 dazu liefern muss:** den Zeitraum je Objekt und Jahr. Gradtagsanteile, Stichtage, Abgrenzung der Rechnungen und Bestände rechnen hier bereits über `period_from`/`period_to` und nicht über das Jahr; daran ändert #208 nichts.
- **Rumpfzeitraum** (Wechsel des Zeitraums, Erstbezug): Der Gradtagsnenner ist die Summe über den Rumpf, nicht 1.000. Die Anteile 50–70 % gelten unverändert.

---

## 12. Nicht-Ziele

- **Vorerfassung nach Nutzergruppen** (§ 5 Abs. 7, § 6 Abs. 2) und damit gemischte Ausstattung in einer Anlage. Fehler mit Verweis auf den Messdienst.
- **Verdunster selbst auswerten.** Nur über Werte eines Ablesedienstes.
- **Rohrwärme** (§ 7 Abs. 1 S. 3, 4, VDI 2077).
- **Umbauter Raum** als Maßstab.
- **Gemeinschaftsräume mit hohem Verbrauch** (§ 4 Abs. 3 S. 2, § 6 Abs. 3), etwa Sauna.
- **Andere Regeln der Technik für Mischanlagen** (§ 9 Abs. 1 S. 5) außer der gemessenen Gesamtwärme.
- **Wärmelieferung mit unmittelbarer Abrechnung des Lieferers** (§ 1 Abs. 3), Contracting-Fragen nach § 556c BGB (#213).
- **Bruttowarmmiete nach § 12 Abs. 3** (Durchschnittskosten 2022–2024 bei Wärmepumpen): nur Lexikonsatz.
- **ARGE/bved-Datenaustausch**, Import von Funkdaten.
- **Automatische Umstellung** bestehender Jahre (Heizposition „nach Verbrauch“ plus „nach Fläche“) auf eine Anlage: Sie würde Zahlen abgeschlossener oder versandter Abrechnungen verschieben. Der Assistent bietet die Übernahme für ein **offenes** Jahr an, mit Vorschau der Abweichung.
- **Rechtsberatung zur Eignung der Geräte** (§ 5 Abs. 1 S. 2) und zur Richtigkeit von Bewertungsfaktoren.

---

## 13. Offene Fragen und Festlegungen

Jede mit der Regel, nach der Mietfuchs bis zur Klärung verfährt.

1. **Was gilt als Ablesung „am Stichtag“?** Die Verordnung sagt es nicht. **Regel:** ± 1 Tag gilt als Stichtag; bis 14 Tage wird nach Gradtagen (Wärme) bzw. Tagen (Warmwasser) fortgeschrieben, mit Hinweis; darüber zählt der Wert als nicht ordnungsgemäß erfasst (§ 9a). Festlegung von Mietfuchs, ab 2027 durch fernablesbare Geräte meist gegenstandslos.
2. **Abgrenzung einer Versorgerrechnung über den Zeitraumwechsel.** Nicht geregelt. **Regel:** Vorschlag nach Gradtagen, überschreibbar; Abstimmung mit CO₂ F7 (7.6).
3. **Kontaktadressen nach § 6a Abs. 3 Nr. 2.** **Regel:** fester Text, bei der Umsetzung auf Aktualität prüfen; Teil der jährlichen Durchsicht (#110).
4. **„Durchschnittsnutzer“ (§ 6a Abs. 3 Nr. 4).** Ob der Durchschnitt des eigenen Hauses „durch Vergleichstests ermittelt“ ist, ist nicht geklärt; Messdienste nutzen eigene Statistiken. **Regel:** Hausdurchschnitt je m², ausdrücklich so benannt.
5. **Witterungsbereinigung (§ 6a Abs. 3 S. 3).** Die Bekanntmachung der Vereinfachungen im Bundesanzeiger habe ich nicht im Wortlaut gefunden. Der DWD veröffentlicht Klimafaktoren je Postleitzahl. **Regel:** Klimafaktor abfragen, Wärme damit bereinigen, Fundstelle bei der Umsetzung nachtragen. Im ersten Jahr kein Vorjahr, kein Betrag.
6. **kWh bei HKV in der Monatsinformation (§ 6a Abs. 2 Nr. 1).** **Regel:** Einheiten mit Erklärung; nur in der entbehrlichen PR 7.
7. **Gemessenes Q und Brennwert.** Der Faktor 1,11 steht nur bei den Formelwerten. **Regel:** Wortlaut; gemessenes Q wird gegen die kWh der Rechnung gestellt.
8. **Reichweite des § 2** (aus #85). **Regel:** ohne ausdrückliche Vereinbarung gilt die Verordnung; der Schalter heißt deshalb „vereinbart“.
9. **Addieren sich Kürzungen?** **Regel:** einzeln nennen (CO₂ 11.6).
10. **§ 12 nach § 9a Abs. 2.** Die Flächenverteilung nach § 9a Abs. 2 ist eine Verteilung „nach der Verordnung“. **Regel:** kein Kürzungsbetrag, nur Hinweis.
11. **Verbrauchervertrag (§ 6a Abs. 3 Nr. 3).** Ein privater Vermieter handelt in der Regel nicht als Unternehmer. **Regel:** Vorgabe aus, abschaltbar.
12. **Holz und Pellets in der CO₂-Spezifikation** (`biomass`): hier getrennt (Heizwert). **Regel:** `biomass` der CO₂-Spalte bleibt; die Anlage führt `pellets` und `wood`, und die CO₂-Arbeit liest beide als `biomass`.
13. **Formel 0,30 bei Wärmepumpen.** Der Wortlaut sagt nicht, gegen welche Größe der Formelwert gestellt wird. **Regel:** gegen den Strom in kWh (Energieverbrauch), Lexikon sagt es so.
14. **Selbst abgelesene HKV vor Gericht.** Bestreitet der Mieter Werte oder Faktoren, trägt der Vermieter die Beweislast. **Regel:** Ausweis je Gerät, Lexikon rät zu Fotos der Anzeige am Stichtag.
15. **25 % je Topf oder für beide?** § 9a Abs. 2 nennt beide Flächenmaßstäbe (§ 7 Abs. 1 S. 5 und § 8 Abs. 1) in einem Satz. **Regel:** je Topf getrennt, denn Wärme- und Warmwasserzähler fallen unabhängig aus und die betroffene Fläche ist je Erfassung verschieden; das Lexikon sagt es so.

---

## 14. PR-Aufteilung und Aufwand

Gestapelt auf `main`, jede PR mit Durchsicht, der Stapel mit Integrationsdurchsicht (Geld und Daten), Praxislauf und `full-check`. Alle mit `Refs #99`; PR 3 zusätzlich `Refs #211`, PR 6 `Refs #214`, PR 0 `Refs #180`.

| PR | Inhalt | Schätzung |
|---|---|---|
| **0: Vorarbeiten** | Zählertypen `warmwasser` und `hkv` (Schema, Oberfläche, `meterTypeOptions`); Wasserschlüssel zählt Warmwasserzähler mit (7.7) samt Test; Objektart `zfh` mit `property.kind-mismatch`. Unabhängig, kann sofort. | 1–1,5 Tage |
| **1: Anlage und Kernrechnung** | Tabellen 5.1–5.3, `cost_items`-Spalten, `cost_item_fuel` (ohne Bestand), Schnappschuss, Routen (`GET/PUT /api/heating/:year?property=`, `POST …/preview`), `heating.ts` mit α gemessen, Töpfen, 70/30, Nutzerwechsel mit Zwischenablesung und Gradtagen, § 9b Abs. 3, Leerstand, Eigennutzung, Pauschale; Gewichte und #202; Abgrenzung von Rechnungen (`fuelCarry`). Assistent, Seite Heizkosten, Druckblock Heizkostenabrechnung, Ableseergebnis. Hinweise der Gruppe error und `no-consumption`, `no-interim-reading`, `reading-off-date`. Lexikon, Regeln, Anleitung. Tests 15.1–15.3 für Beispiel A und D. | 7–9 Tage |
| **2: Vorrat** | Bestandsrechnung (gemeinsam mit CO₂ 5.2), Vorbelegung aus dem Vorjahr, `fuel-stock-missing`, `stock-invalid`. Beispiel C. | 2 Tage |
| **3: Warmwasser ohne Wärmezähler** | Formeln, Faktoren, Heizwerttabelle, `dhw-not-metered` (15 %), `dhw-share-implausible`; schließt #211. | 1,5 Tage |
| **4: Heizkostenverteiler und Ablesedienst** | HKV mit Skala und Faktor, Stichtagswert, `device-cutoff`, `hca-factor-missing`, `mixed-capture`; Erfassung `serviceValues` (5.5). | 2–3 Tage |
| **5: Schätzung** | `heating_estimates`, Vorschläge, Dialog, 25-%-Schwelle, Beispiel B. | 2 Tage |
| **6: Pflichtangaben und Ausnahmen** | Druckblock § 6a Abs. 3, Klimafaktor, Vergleich, `info-incomplete`; § 11, § 2-Vereinbarung, § 7 Abs. 1 S. 2, § 10; `remote_readable` mit Betrag (#214). | 2–3 Tage |
| **7: CO₂-Anbindung** | `co2_statements.heating_system_id`, Topf = Anlage, gemeinsamer Anteil je Rechnung. Fällt weg, wenn CO₂ PR 3/4 schon darauf gebaut sind. | 1 Tag |
| **8: Monatliche Verbrauchsinformation** (entbehrlich für 0.11.0) | Ausdruck aus Monatswerten (8.4). | 1,5 Tage |

**Summe:** etwa 18–23 Arbeitstage ohne PR 8. Zusammen mit der CO₂-Arbeit (13,5–17,5 Tage) ist 0.11.0 damit das größte Release bisher. **Wenn gekürzt werden muss:** PR 0–3 und 6 decken Gas, Öl, Fernwärme und Wärmepumpe mit Wärme- und Warmwasserzählern rechtssicher ab; PR 4 (HKV) und PR 5 (Schätzung) sind die nächstwichtigen, PR 8 kann warten.

---

## 15. Tests

### 15.1 Engine (`server/test/heating.test.ts`)

- **Beispiel A** centgenau (Tabelle 6.8), dazu die exakten Werte je Baustein und die Gegenproben (zeitanteilig, ohne Zwischenablesung).
- **Gradtage:** 01.01.–30.09. = 640 ‰; Juni allein 40 × 30/92; Schaltjahr: Februar 150 ÷ 29 je Tag, Jahressumme 1.000; Rumpfzeitraum normiert.
- **Wechsel ± 1 Tag** gilt als Zwischenablesung; 10 Tage → Fortschreibung mit Hinweis; 20 Tage → § 9a.
- **α:** gemessen 15 %; Volumenformel 27,75 %; Flächenformel 11,84 %; Öl in Litern über H_i = 10; Wärmepumpe × 0,30; Fernwärme ÷ 1,15; α ≥ 1 → Fehler; Formel gesperrt bei Mischanlage.
- **Anteile:** 70 Vorgabe; 50 zulässig; 75 ohne § 10 → 400 beim Speichern; `insulation_rule = applies` erzwingt 70; Wärmelieferung ohne S. 2.
- **Vorrat:** Beispiel C; Jahr ohne Lieferung; Endbestand zu groß; ohne Bestand → nichts verteilt; Wert des Endbestands nach jüngsten Lieferungen.
- **Abgrenzung:** Beispiel D in beiden Jahren; Summe beider Jahre = Rechnungsbetrag.
- **Schätzung:** Beispiel B (40 % → Fläche); fünf Wohnungen (20 % → Schätzung bleibt); unbestätigt → Warnung.
- **HKV:** Produktskala; Einheitsskala mit Faktoren 0,8 und 1,25 an zwei Heizkörpern einer Wohnung; Stichtagsrücksetzung über `replacement`; fehlender Faktor → Wohnung nicht erfasst.
- **Leerstand** drei Monate zwischen zwei Mietern: Grundkosten nach Gradtagen beim Vermieter, Verbrauch laut Ablesung.
- **Eigennutzung** (Einliegerwohnung): `selfUse` exakt, Steuer privat.
- **Pauschale:** Anteil beim Vermieter, `heating.flat-rate` nennt den Betrag.
- **Zweifamilienhaus** mit Vereinbarung nach Fläche: kein § 12-Hinweis; ohne Vereinbarung wie Mehrfamilienhaus.

### 15.2 Invarianten (`calc.test.ts`, Zufallsbestände)

Der Generator aus #202 wird um Anlagen erweitert (alle Energien, Erfassungsarten, Methoden, Wechsel mit und ohne Zwischenablesung, Leerstand, Eigennutzung, Pauschale, Schätzungen, Vorrat, Abgrenzung). Zu prüfen:

- Σ aller Zeilen = Σ Kostenpositionen (mit `fuelCarry`).
- Σ der beiden `fuelCarry`-Gegenzeilen + Σ ihrer verteilten Zeilen = 0 je Anlage.
- Je Position: jede Zeile ≤ 1 ct neben dem exakten Wert (#202).
- Kein Mieteranteil negativ bei positiven Kosten und nicht negativem Verbrauch.
- Grund + Verbrauch je Topf = Topf; Heizung + Warmwasser = Σ Positionen der Anlage.
- **Wechsel neutral:** Die Summe der Nutzer einer Wohnung ist unabhängig davon, ob und wann gewechselt wird.
- **Keine lineare Interpolation:** Ein Test, der für Wärme bei fehlender Zwischenablesung den Gradtagsanteil verlangt und am linearen Wert rot würde.
- Ohne Anlage sind alle Zahlen identisch zum Stand vor der Funktion; Golden F01–F11 unverändert.
- Zwei Objekte und zwei Anlagen in einem Objekt rechnen unabhängig.

### 15.3 API, Schema, Client

- `api.test.ts`: CRUD und Vorschau; `?property=`; Einheit eines fremden Objekts → 400; überlappende Anlagen → 400; Anlage bei `etw` → 400; unbekanntes Feld verworfen; 503 ohne Datenbank; Abschluss friert `heating` ein, `deviation` zeigt Änderungen; Mieterwechsel mit Zwischenablesung der Heizungszähler in einer Transaktion.
- Schema und Migration: `schema.test.ts`, Migrationsmarken, Neubau der Tabellen auf einer Datenbank von 0.10.1 (Praxislauf), `db-golden`, `db-changeover`.
- `glossary.test.ts`, `guides.test.ts` (Beispiel A), `anrede.test.ts`, `categories.test.ts`.
- Client: `heatingForm.test.ts` (Vorgaben, gesperrte Formeln, 25-%-Warnung vor dem Markieren, Übernahme ohne Beträge), jsdom für die neuen Auswahlfelder, `notices.test.ts` (Ampel).
- Smoke-Test: `PUT /api/heating/2025` und Lesen der Abrechnung.

---

## 16. Abdeckung Heizung nach dieser Spezifikation

Fortschreibung von Abschnitt 15 der CO₂-Spezifikation, nur die Zeilen, die sich ändern.

| Lage | Nach dieser Spezifikation | Danach fehlt |
|---|---|---|
| Selbstabrechnung mit Wärmemengenzählern | vollständig (PR 1–3, 5, 6) | – |
| Selbstabrechnung mit elektronischen HKV | vollständig, mit Bewertungsfaktor je Gerät (PR 4) | Eignungsnachweis der Geräte liegt beim Vermieter |
| Verdunster | über Werte eines Ablesedienstes (PR 4) | Selbstauswertung (Nicht-Ziel) |
| Gemischte Ausstattung | Fehler mit Verweis auf den Messdienst | Vorerfassung (Nicht-Ziel) |
| Warmwasser ohne Wärmezähler | Formeln mit beziffertem Kürzungsrecht (PR 3, #211) | – |
| Öl, Flüssiggas, Pellets, Holz | Verbrauch nach Bestand, Lieferungen in der Steuer unverändert (PR 2) | – |
| Gasrechnung über den Zeitraumwechsel | Abgrenzung nach Gradtagen (PR 1) | – |
| Wärmepumpe | Strom als Brennstoff, α über Wärmezähler oder Formel × 0,30 | § 12 Abs. 3 nur als Lexikonsatz |
| Fernwärme | Entgelt als Brennstoff, α über Wärmezähler oder ÷ 1,15 | Contracting (#213) |
| Mieterwechsel | Zwischenablesung, Gradtage, § 9b Abs. 3 | – |
| Geräteausfall | § 9a mit 25 %-Schwelle (PR 5) | – |
| Pflichtangaben § 6a Abs. 3 | Druckblock, 3 % beziffert (PR 6) | Fundstelle der Vereinfachungen (13.5) |
| Monatliche Verbrauchsinformation | Hinweis; Ausdruck in PR 8 | Funkdatenimport (Nicht-Ziel) |
| Zweifamilienhaus mit Eigennutzung | Objektart, Vereinbarung nach § 2 (PR 0, 6) | Rechtsfrage 13.8 |
| Einliegerwohnung mit Zwischenzählern | Eigenanteil exakt, Steuer privat | – |
| Mehrere Heizungen in einem Objekt | mehrere Anlagen mit eigenen Wohnungen | – |
| Messdienst | unverändert über Einzelbeträge (#94, #97, #103) | – |
| Abweichender Abrechnungszeitraum | Anlage rechnet über `period_from/to` | #208 |
