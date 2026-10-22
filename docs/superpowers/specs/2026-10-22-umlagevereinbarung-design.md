# Umlagevereinbarung je Mietverhältnis (#258)

## Ziel

Betriebskosten trägt der Mieter nur, soweit es vereinbart ist (§ 556 Abs. 1 Satz 1 BGB). Ältere
Verträge legen oft nicht alle Kostenarten um. Mietfuchs weiß heute nicht, was im Vertrag steht; wer
eine nicht vereinbarte Art abbilden will, nimmt den Mieter bei jeder Position aus den Teilnehmern
(#94). Das ist umständlich, fällt nicht auf, wenn es vergessen wird, und **verschiebt den Anteil auf
die übrigen Mieter**, weil die Wohnung dann aus der Gesamtmenge des Schlüssels fällt. Genau das ist
falsch: Den Anteil an einer nicht vereinbarten Art trägt der Vermieter.

**Wer nichts erfasst, merkt nichts**: Ohne Angabe gilt wie heute „alle Arten“, die Golden-Tests
bleiben centgenau grün.

## Rechtslage

Jede Aussage mit Fundstelle; Randnummern nach den gelesenen Volltexten.

1. **Pauschalverweis genügt.** „Der Mieter trägt die Betriebskosten“ umfasst, auch im Formularvertrag,
   alle Kosten des § 556 Abs. 1 Satz 2 BGB und der BetrKV; ein Katalog oder Verweis ist nicht nötig
   (BGH, Urteil vom 10.02.2016, VIII ZR 137/15, Leitsatz, Rn. 11–21). Bei dynamischem Verweis sind
   später neu aufgenommene Arten mit umfasst (ebd., Rn. 17; Folgerung, wahrscheinlich).
2. **Eine Aufzählung gilt abschließend.** „Folgende Betriebskosten“ mit Liste erfasst nur die
   genannten (BGH, Urteil vom 10.10.2007, VIII ZR 279/06, Rn. 19 f.).
3. **„Sonstige Betriebskosten“ (§ 2 Nr. 17 BetrKV) nur bei konkreter Benennung**, auch beim
   Pauschalverweis (BGH, Urteil vom 07.04.2004, VIII ZR 167/03, Leitsatz b, Rn. 19 f.; VIII ZR 137/15,
   Rn. 12; BGH, Urteil vom 14.02.2007, VIII ZR 123/06, Leitsatz).
4. **Keine stillschweigende Erweiterung durch bloßes Abrechnen und Zahlen** (VIII ZR 279/06,
   Rn. 22 f.). Anders, wenn der Vermieter die neue Umlage ankündigt, entsprechend abrechnet und der
   Mieter zahlt: dann Änderung **ab einem bestimmten Zeitpunkt** (BGH, Urteil vom 09.07.2014,
   VIII ZR 36/14, Rn. 19 f.).
5. **Eine vereinbarte Art, die erst später anfällt, darf umgelegt werden, sobald sie anfällt**
   (VIII ZR 167/03, Rn. 21 f.: Hauswart), mit Mehrbelastungsklausel auch neu entstandene Kosten einer
   genannten Art (BGH, Urteil vom 27.09.2006, VIII ZR 80/06), begrenzt durch die Wirtschaftlichkeit.
6. **Einseitige Umstellung** auf Verbrauch oder Verursachung nach § 556a Abs. 2 BGB: in Textform,
   „nur vor Beginn eines Abrechnungszeitraums“; war die Art in der Miete enthalten, ist die Miete
   herabzusetzen.
7. **Den Anteil an nicht vereinbarten Arten trägt der Vermieter.** Eine ausdrückliche Entscheidung
   dazu gibt es nicht; es folgt daraus, dass jeder Mieter nur aus seinem Vertrag schuldet, und aus der
   Leerstandsrechtsprechung: Den Schlüssel so zu ändern, dass andere Mieter den Anteil tragen, geht
   nicht (BGH, Urteil vom 31.05.2006, VIII ZR 159/05, schon in `shared/law/practice.ts`).
   **Auslegung von Mietfuchs**, wird als solche genannt.
8. **Weglassen genügt formell.** Als Gesamtkosten reicht der auf die Mieter umgelegte Betrag, auch
   wenn er um nicht umlagefähige Anteile bereinigt ist (BGH, Urteil vom 19.01.2016, VIII ZR 93/15,
   Leitsätze 1 und 2, Rn. 8). Ein Vermerk „nicht vereinbart, trägt der Vermieter“ ist unschädlich.
9. **Einwendungsfrist**: Wer eine nicht vereinbarte Art nicht binnen zwölf Monaten rügt, verliert den
   Einwand; es ist ein inhaltlicher Fehler (VIII ZR 279/06, Leitsatz). Mietfuchs nennt das nie als
   Freibrief.
10. **Heizung und Warmwasser**: § 2 HeizkostenV geht vertraglichen Bestimmungen vor (außer im Haus mit
    höchstens zwei Wohnungen, von denen der Vermieter eine bewohnt). Eine Warmmiete wird als
    Kaltmiete mit verbrauchsabhängiger Abrechnung behandelt, der Heizanteil aus der Miete
    herausgerechnet und als Vorauszahlung angesetzt (BGH, Urteil vom 19.07.2006, VIII ZR 212/05,
    Leitsatz a, Rn. 13 f., 18, 25). Eine **zusätzliche** Zahlungspflicht neben unveränderter Miete
    schafft die Verordnung nicht (Folgerung, wahrscheinlich; ausdrückliche Fundstelle fehlt, vor der
    Umsetzung in der Kommentarliteratur zu § 2 HeizkostenV prüfen).

**Folge für das Modell**: Eine Vereinbarung kann sich mitten im Mietverhältnis ändern (Nachtrag,
Nr. 4, Nr. 6, Nr. 5). Eine **Staffel mit „gilt ab“** ist rechtlich begründet.

## Entscheidungen

### 1. Datenmodell: Staffel am Mietverhältnis

```ts
type AllocationAgreement = {
  from: string                 // 'JJJJ-MM-TT', erste Stufe = Einzug
  scope: 'all' | 'listed'      // „die Betriebskosten“ (Pauschalverweis) oder Aufzählung
  categories: string[]         // nur bei 'listed': die umgelegten Arten aus CATEGORIES (ohne NOT_ALLOCABLE)
  namedOther: string[]         // benannte „sonstige“ Kosten (Dachrinnenreinigung, Prüfung der Elektroanlage …)
}
Tenancy.allocationAgreements?: AllocationAgreement[]   // fehlt = nicht erfasst = wie heute
```

- **Fehlt die Staffel**, gilt wie bisher jede Art, auch „Sonstige“. Kein stiller Wechsel für
  Bestandsdaten (siehe 6).
- **„Sonstige Betriebskosten“ zählt nur mit Benennung**, bei `all` wie bei `listed` (Rechtslage 3).
  Ohne Eintrag in `namedOther` ist die Art nicht vereinbart.
- Die **gesetzliche** Umlagefähigkeit (Kabel bis 30.06.2024 und nur vor 01.12.2021, `NOT_ALLOCABLE`)
  bleibt im Rechtsregister und wird mit der Vereinbarung geschnitten, nicht in ihr gepflegt.
- Eigene Tabelle `allocation_agreements` (Mietverhältnis, ab, Umfang) mit Kindtabelle der Arten und
  benannten sonstigen Kosten, Migrationsschritt mit Datenregel, Backup und Validator wie die übrigen
  Staffeln. Gilt nur bei `costModel = 'settlement'`; bei Pauschale und Inklusivmiete trägt der
  Vermieter ohnehin (`flatRate`, `inclusive`).

### 2. Berechnung: der Mieteranteil geht an den Vermieter, nie an andere Mieter

- Die Wohnung **bleibt** in der Gesamtmenge des Schlüssels; verteilt wird wie heute. Danach wird der
  Anteil des Mieters an einer Position, soweit die Art an den Tagen des Zeitraums nicht vereinbart ist,
  dem Vermieter zugeschlagen: neuer `LandlordReason` **`notAgreed`**, im Rechenweg und in der
  Vermieterübersicht mit eigenem Satz.
- **Ändert sich die Vereinbarung im Zeitraum**, zählt der Anteil nach Tagen (vereinbarte Tage ÷ Tage
  des Mietverhältnisses im Zeitraum), wie die Monatsregel und die Personenstaffel. Bei Zählern ist das
  eine Näherung; ein Hinweis nennt sie, eine Zwischenablesung am Stichtag ist dafür nicht vorgesehen.
- **Invariante** im Zufallstest: Mieteranteile + Vermieteranteil = Gesamtkosten, und die Anteile der
  übrigen Mieter ändern sich nicht, wenn bei einem Mieter eine Art abgewählt wird.
- Steuer: unverändert Werbungskosten in voller Höhe; nur die Erstattung durch den Mieter entfällt.

### 3. Heizung und Warmwasser: nicht still abwählbar

Die Art „Heizung und Warmwasser“ ist bei `listed` wählbar, aber:

- Gilt der Vorrang des § 2 HeizkostenV (alles außer Zweifamilienhaus mit selbst bewohnter Wohnung),
  wird sie **trotzdem** verbrauchsabhängig verteilt, und ein Hinweis der Stufe `warning` sagt: „Die
  Heizkostenverordnung gilt auch ohne Vereinbarung. Rechnen Sie den Heizanteil aus der Miete heraus und
  setzen Sie ihn als Vorauszahlung an (BGH VIII ZR 212/05).“ Das ist derselbe Weg wie beim
  `heatingModel` `inclusive` (Regel `heating-flat-rate`); der Hinweis verweist dorthin, statt einen
  zweiten Weg zu bauen.
- Nur im Zweifamilienhaus mit selbst bewohnter Wohnung heißt „nicht vereinbart“: trägt der Vermieter.

### 4. Hinweise

| Code | Stufe | Wann |
|---|---|---|
| `allocation.not-agreed` | `hint` | Eine Position einer Art, die bei einem Mieter nicht vereinbart ist: „… trägt der Vermieter (§ 556 Abs. 1 BGB)“, mit Betrag. |
| `allocation.other-unnamed` | `warning` | „Sonstige Betriebskosten“ gebucht, beim Mieter aber nichts benannt (Rechtslage 3); bei erfasster Vereinbarung trägt der Vermieter, bei nicht erfasster bleibt es wie bisher und der Hinweis rät, die Vereinbarung zu erfassen. |
| `allocation.other-unmatched` | `hint` | Eine Position „Sonstige“, deren Bezeichnung zu keiner benannten Art des Mieters passt (Abgleich ohne Groß-/Kleinschreibung, Teilwort). Nur Hinweis, keine Rechnung. |
| `allocation.heating-ordinance` | `warning` | Heizung abgewählt, § 2 HeizkostenV gilt (Entscheidung 3). |
| `allocation.estimate-by-days` | `hint` | Vereinbarung ändert sich im Zeitraum bei verbrauchsabhängigem Schlüssel (Näherung nach Tagen). |

Jeder Code trägt den Begriff `allocationAgreement` im Lexikon (Erklärung, Beispiel mit Zahlen,
Rechtsgrundlage, „Brauche ich das?“).

### 5. Oberfläche

Im Seitenfenster des Mietverhältnisses unter „Weitere Angaben“ ein Abschnitt **„Umgelegte
Betriebskosten (laut Mietvertrag)“**:

- Auswahl „nicht erfasst (alle wie bisher)“ · „„Der Mieter trägt die Betriebskosten“ (Verweis auf die
  Betriebskostenverordnung)“ · „Einzelne Kostenarten aufgezählt“.
- Bei der Aufzählung Häkchen je umlagefähiger Art (15), vorbelegt mit allen.
- Darunter „Benannte sonstige Kosten“ als Zeilen („+ weitere sonstige Kosten“), mit Beispielen im Hinweis.
- „+ Änderung ab Datum …“ für eine weitere Stufe (Nachtrag, angekündigte Änderung, § 556a Abs. 2 BGB),
  wie bei der Personenstaffel.
- In der Liste der Mietverhältnisse ein knappes Kennzeichen, wenn nicht alle Arten umgelegt werden.

### 6. Bestandsdaten und Umstieg

- Kein Eintrag → Verhalten wie heute, Golden-Tests unverändert.
- Einmaliger Hinweis im Cockpit, solange ein Mietverhältnis „Sonstige Betriebskosten“ abgerechnet
  bekommt und keine Vereinbarung erfasst ist: die Vereinbarung zu erfassen.

## Nicht dabei

- Vereinbarung je Einzelposition innerhalb einer Art.
- Automatische Ableitung der Vereinbarung aus einem hochgeladenen Mietvertrag.
- Zwischenablesung am Stichtag einer Änderung.

## Umsetzung

Ein PR mit Migration, Berechnung, Hinweisen, Lexikon, Formular und Tests; Label `full-check`,
Integrationsdurchsicht unter dem Blickwinkel Geld (Invariante, Golden-Tests, Steuer) und Daten
(Migration, Backup, Umstieg).
