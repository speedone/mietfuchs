# KI-Belegauswertung

Aus der CLAUDE.md im Wurzelordner hierher verschoben. Gilt auch für
`server/src/extract.ts`, `server/src/extractHeating.ts` und `server/src/invoiceAmounts.ts`.

**KI-Belegauswertung**: optional, gegen **Ollama** oder einen **OpenAI-kompatiblen Dienst**
(#18). Die KI macht nur Vorschläge, übernommen wird erst nach manueller Prüfung. Aufgeteilt in:
- [server/src/extract.ts](../extract.ts): das Fachliche, also Prompts, JSON-Schemas,
  Ablauf (Auswertung, zweiter Durchgang nur für Kostenarten, Belegart, Zählerstand) und
  Zeitlimits je Schritt. Die Kategorie-Enums dort und `CATEGORIES`/`matchCategory` in
  client/src/types.ts müssen zusammenpassen.
- [server/src/ai/settings.ts](settings.ts): das Datenmodell `settings.ai` mit den
  Plätzen `text` (Standard) und `images` (eigener Anbieter für Fotos und Scans), den
  Einstellungen für Fortgeschrittene, der Migration aus `ollamaUrl`/`ollamaModel`, den
  Umgebungsvariablen und der Regel, was als extern gilt (`isExternalUrl`, `consentProblem`).
- [server/src/ai/presets.ts](presets.ts): die Vorlagen (Ollama lokal, entfernt,
  Cloud, OpenAI, IONOS, Mistral, LM Studio, eigener Dienst) mit Adresse, Bedarf an einem
  Schlüssel, Feldname für die Antwortlänge, Temperatur, `json_object` und Links. Sie belegen
  nur vor, geändert werden darf alles.
- [server/src/ai/index.ts](index.ts): die Schnittstelle der Anbieter,
  `json({ prompt, images, schema, timeoutMs, signal, onProgress }) → { data, stats }`, dazu die
  Wahl des Platzes je Beleg (Bilder → `images`, falls eingerichtet) und die Durchsetzung der
  Bestätigung vor jeder Anfrage.
- [server/src/ai/openai.ts](openai.ts): Chat-Completions-Schnittstelle als
  SSE-Strom. Schickt immer eine Antwortlänge (IONOS nimmt sonst 16 Token), Temperatur 0 außer
  bei OpenAI, und JSON in Stufen: striktes Schema, Schema ohne `strict`, `json_object` mit
  Schema im Prompt (nicht bei LM Studio), nur Prompt. Lehnt ein Dienst etwas ab, probiert das
  Modul die nächste Möglichkeit und merkt sie sich je Adresse und Modell. Fehlerformate von
  OpenAI, Mistral, IONOS und Ollama werden gleich gelesen, ein Schlüssel erscheint nie in einer
  Meldung.
- [server/src/secrets.ts](../secrets.ts): API-Schlüssel je Platz in `data/secrets.json`
  (unter Unix 0600), nie in `GET /api/settings` und nicht im Backup. `NKA_AI_API_KEY` oder
  `NKA_AI_API_KEY_FILE` (Docker-Secret) haben Vorrang.
- [server/src/ai/ollama.ts](ollama.ts): Transport und Eigenheiten von Ollama.
  Streamt `/api/chat`, setzt `think: false` und einen festen Kontext (`num_ctx` 16384, sonst
  kürzt Ollama bei unter 24 GB Grafikspeicher auf 4096 Token; ein wechselnder Wert lädt das
  Modell neu). Lehnt ein Modell `think: false` ab, wie manche bei Ollama Cloud, geht die
  Anfrage einmal ohne das Feld. Prüft über `/api/show`, ob das Modell Bilder versteht und ob
  Ollama es an einen Cloud-Dienst weiterreicht (eine Minute gemerkt), und übersetzt Fehler in
  Meldungen für die Oberfläche (nicht erreichbar, nicht installiert, Schlüssel, Zeitlimit,
  abgeschnittene Antwort). Dazu Modellliste und Suche nach Ollama unter üblichen Adressen.
- [server/src/ai/http.ts](http.ts): Verbindung ohne die 300-Sekunden-Grenze von
  `fetch` (Node und Bun brechen ab, wenn so lange keine Antwort-Header kommen, Ollama schickt
  sie erst mit dem ersten Token). Unter Node über `node:http(s)`, unter Bun über `fetch` mit
  `timeout: false`. Für KI-Anfragen deshalb nicht `fetch` direkt nehmen.
- [server/src/extractHeating.ts](../extractHeating.ts) (Heizung PR 20, #103): Messdienstabrechnung
  und Lieferantenrechnung, über `POST /api/heating-plants/:id/service-statement` (nur bei `method:
  'service'`) und `…/fuel-invoice`, als derselbe Strom wie `/api/extract`; Text und Seitenbilder stellt
  `documentMaterial` aus extract.ts zusammen, für jede Belegart gleich. Je Belegart **ein** Ausgang
  (`toServiceExtraction`, `toFuelExtraction`) und kein eigener Eingang, denn dazwischen rechnet Mietfuchs
  nur Netto-Teilmengen hoch, mit derselben Prüfung `vatExplainsGap` wie #34; die beiden Felder, die Mietfuchs
  selbst setzt (`amountsAdjusted`, `amountsNetUnadjusted`), liest der Ausgang nie aus der Antwort. Die
  Abzugszeile steht oft mit typografischem Minus da und wird als Betrag gelesen. **Gespeichert wird nichts außer
  dem Beleg** (mit Objekt und Jahr aus dem Formular im Posteingang, bis er an eine Position kommt; eine
  Lieferung hat keinen Beleg), und es entsteht keine Auswertung der Belegbuchung, denn Nutzerzeilen und
  Lieferungen sind keine Rechnungspositionen. Die Seite Heizkosten zeigt den Vorschlag und schreibt über die
  bestehenden Routen, wenn der Vermieter übernimmt: die Karte „Messdienstabrechnung auslesen“
  (`client/src/serviceImport.ts`, `ServiceImportReview.tsx`) und „Rechnung mit KI auslesen“ in der Karte
  „Lieferungen“ (`client/src/fuelImport.ts`). Eine Nutzerzeile wird nur bei genau einem Treffer zugeordnet
  (Name unter den Mietverhältnissen, die den Zeitraum berühren, bei mehreren die Lage; „Leerstand“ und
  „Eigentümer“ an ihren Wörtern). Der Betrag der Heizposition ist S plus Abzugszeile (Entwurf 7.1). Die gefundene
  Abzugszeile steht als Satz neben der Frage, gewählt wird nichts vor (Entwurf 7.2); widerspricht die Antwort
  („nur ausgewiesen“, „gar nicht aufgeteilt“), warnt die Karte. Die CO₂-Angaben werden vorbelegt, nie mit leeren
  Werten überschrieben, und mit der eben angelegten Heizposition verknüpft. Kalte Blöcke einer Komplettabrechnung
  nur, wenn die Heizperiode dem Objektzeitraum gleicht (Festlegung, Leistungsprinzip; Einzelbeträge lassen sich
  nicht nach Tagen teilen). Reicht der Zeitraum über zwei Kalenderjahre, fragt die Karte je Block nach dem Jahr
  der Zahlung, wie `requireTaxYear` es verlangt. Bei der Lieferantenrechnung übernimmt das Formular den
  Preisbestandteil nach § 3 Abs. 1 Nr. 6 CO2KostAufG nur, wo der Server ihn annimmt (`bioAccepted`: Heizung
  nach § 43 Abs. 1 GModG, nicht aus dem Vorrat, nicht ab der Grenze von § 5a Abs. 3 Nr. 3), und nennt sonst den
  Grund; beim Vorrat bleiben Rechnungszeitraum und Teilmengen leer. Bei freien Schlüsseln nimmt eine Lieferung
  keinen Betrag an, dann nennt die Karte ihn als Satz. Vorbelegt wird nur, was die Karte zeigt (CO₂-Angaben
  nach `asksCo2Facts`, Bezug der kWh nur bei Gas, Heizwert nur beim Vorrat); was gelesen, aber nicht
  übernommen wird, nennt `fuelChecks` als Satz, sonst ginge ein ungesehener CO₂-Betrag in den Rumpf und
  löste eine Aufteilung aus. Den Energiegehalt einer Lieferung aus dem Vorrat übernimmt das Formular nicht,
  denn dort rechnet Mietfuchs mit verbrauchter Menge × Heizwert (§ 9 Abs. 3 HeizkostenV); der Satz dazu
  prüft Menge × Heizwert gegen den Energiegehalt (mehr als 1 % Abstand). Erneut ausgelesene Abrechnungen:
  Heizblock und kalte Blöcke mit vorhandenen Einzelbeträgen sind nicht vorgehakt, und Anlegen fragt nach.
  `PUT …/hot-water` ohne `dhwUnmeasurable` lässt die Bestätigung derselben Formel stehen.

**Rohe Antwort und Zusage: zwei Beschreibungen, eine Grenze** (#63). Die Auswertung eines Belegs
durchläuft zwei Stadien, und jedes hat seinen eigenen Typ. `RawExtraction` und `RawPosition` in
[server/src/invoiceAmounts.ts](../invoiceAmounts.ts) beschreiben die rohe Antwort des
Modells: Dort ist alles `unknown`, denn ein Modell kann statt einer Zahl auch „neunzehn“
schicken, und ein engerer Typ wäre eine Behauptung, die niemand einlöst. `Extraction` in
[shared/types.ts](../../../shared/types.ts) beschreibt, was der Browser bekommt, mit engen Typen. Was der
Server selbst rechnet (`amountsAdjusted`, `laborFromTotal`), nimmt seinen Typ von dort, damit das
Paar nicht auseinanderlaufen kann.

Überschritten wird die Grenze nur an zwei benannten Stellen in
[server/src/extract.ts](../extract.ts). `rawFromAnswer` ist der Eingang: Es nimmt dem
Modell die beiden Felder aus der Hand, die Mietfuchs selbst rechnet, und liest Beträge, die als
Text dastehen, mit `numberFromModel` (dieselbe Funktion wie beim Zählerstand, deutsche wie
technische Schreibweise, und was mehrdeutig ist, bleibt ungelesen). `toExtraction` ist der
Ausgang und die einzige Stelle, an der die Zusage entsteht. Geprüft wird dort bewusst nur, was
die Oberfläche wirklich braucht; eine vollständige Prüfung der Modellantwort gehört ausdrücklich
nicht dazu, denn die KI schlägt vor und ein Mensch prüft jede Position, bevor sie übernommen
wird. Verworfen wird nur, was niemand gebrauchen kann: Ein Betrag, der keine Zahl ist, fehlt
danach, und das leere Feld füllt der Mensch aus. Vorher stand dort ein `as Extraction`, und diese
Behauptung brach: Fehlte ein Betrag, rief die Oberfläche `toLocaleString` auf einem `undefined`
auf und zeigte statt des Vorschlags einen Fehler. Erreichbar ist das, obwohl das Schema den
Betrag verlangt, weil die Anbindung bei Ablehnung stufenweise bis auf „nur Prompt“ zurückfällt.

Dass ein Betrag fehlen darf, hat eine Folge für das Geraderücken in
[server/src/invoiceAmounts.ts](../invoiceAmounts.ts). Fehlt eine Position, liegt die
Positionssumme unter dem Rechnungsbetrag, und die Bedingung zum Hochrechnen griffe erst recht;
verteilt würde dann der ganze Rechnungsbetrag auf die übrigen Positionen. Das Ergebnis wäre das
gefährlichste, das hier entstehen kann: Die Summe passt zum Beleg, jede einzelne Position ist zu
hoch, und beim Prüfen fällt nichts auf.

Die Antwort darauf ist `vatExplainsGap`, eine Prüfung mit einem Namen: **Lässt sich der Abstand
zwischen Positionssumme und Rechnungsbetrag durch Umsatzsteuer erklären?** Gemessen wird gegen
den Regelsatz von 19 Prozent plus eine halbe Prozentstelle für Rundung, nicht gegen eine
großzügige Obergrenze, denn eine Nettorechnung hat genau diesen Abstand und keinen beliebigen.
Nach unten ist alles bis 0 möglich, weil eine Rechnung ermäßigte und steuerfreie Anteile mischen
kann, und ein Rechnungsbetrag unter der Positionssumme ist eine Abschlagszahlung, kein fehlender
Posten. Eine Obergrenze von 30 Prozent ließe bei 19 Prozent Steuer eine fehlende Position von 9
Prozent durch und bei 7 Prozent eine von 21; gegen den Regelsatz gemessen fällt bei 19 Prozent
schon ein fehlendes halbes Prozent auf. Nötig ist die Prüfung, weil das Schema den Betrag als
Pflichtzahl verlangt: Ein Modell, das ihn nicht lesen kann, schreibt eher eine 0 oder lässt die
Position weg, als eine Lücke zu lassen. Der Rest des Bandes bleibt offen: Bei 7 Prozent Steuer
kann eine fehlende Position von bis zu 10 Prozent durchgehen, weil sich der Abstand dann immer
noch wie eine Steuer liest.

Dazu muss jeder Betrag gelesen sein (`null` aus `toCents` heißt „nicht gelesen“ und ist etwas
anderes als 0: Eine Position kann laut Rechnung nichts kosten). Beides gilt für das Hochrechnen
wie für den §35a-Lohnanteil aus einem Gesamtbetrag, denn auch er gehört zur ganzen Rechnung; sonst
bekämen die vorhandenen Positionen den Anteil der fehlenden mit dazu, und weil eine Position ohne
Betrag nicht übernommen wird, stünde am Ende zu viel §35a in der Steuerübersicht. Zu streng darf
es dort aber nicht sein, denn ein ausbleibender Lohnanteil kostet denselben Nutzer dieselbe
Steuer. Hochgerechnet wird immer anteilig auf den Rechnungsbetrag und nie mit einem genannten
Steuersatz: Bei richtigem Satz kommt dasselbe heraus, bei falschem verteilt das Restverfahren die
Differenz reihum, bis hin zu einem negativen Betrag. `vatRatePercent` wird deshalb nirgends mehr
gelesen. Jede dieser Bedingungen hat einen Test, der rot wird, wenn genau sie fehlt.

PDFs öffnet der Server nicht selbst: Der Browser liest sie vor dem Hochladen mit pdf.js
([client/src/pdfIntake.ts](../../../client/src/pdfIntake.ts)) und schickt die Textebene im Feld
`pdfText` mit, bei Scans ohne brauchbare Textebene (unter 80 Zeichen) bis zu vier Seiten als
JPEG im Feld `pages`. Die Seitenbilder bleiben im Arbeitsspeicher (gemischter multer-Speicher
in index.ts) und landen nicht im Belegordner. So braucht der Server kein natives Modul:
`pdf-to-img` scheiterte in der Bun-Programmdatei, weil pdf.js dort `@napi-rs/canvas` nicht
findet (#21). Intern laufen Bilder als `{ mimeType, data }`.

`/api/extract` und `/api/intake` antworten mit `Accept: application/x-ndjson` als Strom: Header
sofort, dann Zeilen mit `progress`, `heartbeat` (alle zehn Sekunden) und zuletzt `result` oder
`error`. Grund: Firefox wartet höchstens 300 Sekunden auf Header. Ohne diesen Accept-Wert gibt
es die JSON-Antwort wie früher. Bricht der Browser ab, stoppt der Server die Anfrage an den
Anbieter und löscht den gerade hochgeladenen Beleg wieder. Den Abbruch erfährt er über
`POST /api/ai/cancel/<requestId>` (die Kennung schickt der Browser im Formularfeld `requestId`
mit, beim Schließen des Tabs per `sendBeacon`) und zusätzlich über das Schließen der
Verbindung. Die Kennung ist der verlässliche Weg, denn unter Bun 1.3 kam das Schließen nicht bei
Express an (unter Bun 1.4.2 schon), und ein Proxy kann die Verbindung zum Server offen halten.
Der Smoke-Test prüft die Kennung auf jeder Programmdatei und berichtet zusätzlich, ob das bloße
Schließen ankommt. Im Client liest
[client/src/aiRequest.ts](../../../client/src/aiRequest.ts) den Strom und kümmert sich um den Abbruch,
die Karte der Einstellungen ist [AiSettings.tsx](../../../client/src/components/AiSettings.tsx) mit der
Logik in [client/src/aiForm.ts](../../../client/src/aiForm.ts) und
[client/src/modelForm.ts](../../../client/src/modelForm.ts).

**Bestätigung externer Dienste**: Zeigt die Adresse eines Platzes aus dem Haus, oder reicht ein
lokales Ollama das Modell an einen Cloud-Dienst weiter, schickt der Server erst nach einer
Bestätigung Belege dorthin (`POST`/`DELETE /api/ai/consent`, gespeichert in `ai.consent`). Als
lokal gelten dieser Rechner, private und Link-local-Adressen, Namen ohne Punkt sowie `.local`,
`.lan`, `.home.arpa`, `.internal`, `.intern` und `fritz.box`. Was extern ist, entscheidet allein
der Server; die Oberfläche bekommt es als `aiExternal` in den Einstellungen und zeigt es auch
auf Kosten und Schnellerfassung an.

Routen: `/api/ai/presets` (Vorlagen), `/api/ai/status?slot=text|images` (Modelle des Anbieters,
bei Ollama mit Adresssuche), `PUT /api/ai/key` und `DELETE /api/ai/key/:slot`,
`POST /api/ai/consent` und `DELETE /api/ai/consent/:slot`. `/api/ollama/status` bleibt für Tabs
von vor dem Update und liefert in `models` nur Namen, die Einzelheiten in `modelDetails`. Die
Adresssuche fragt je nach Betriebsart nur Sinnvolles (Docker: Host und Compose-Dienst, sonst
dieser Rechner) und nur, wenn die eingestellte Adresse gar nicht erreichbar war.

Umgebungsvariablen (die Einstellungen zeigen betroffene Felder gesperrt, `fixedByEnv`, in die
db.json gelangen die Werte nicht): `NKA_AI_PROVIDER`, `NKA_AI_URL`, `NKA_AI_MODEL`,
`NKA_AI_API_KEY` bzw. `NKA_AI_API_KEY_FILE`, `NKA_AI_TIMEOUT`, `NKA_AI_MAX_TOKENS`,
`NKA_AI_IMAGE_EDGE`; dazu
`NKA_OLLAMA_URL`, `NKA_OLLAMA_MODEL` und `NKA_OLLAMA_NUM_CTX`, die weiter gelten, solange
Ollama der Anbieter ist. Ein ungültiger Wert verhindert den Start mit klarer Meldung. Einzige
Ausnahme vom Grundsatz, dass Werte aus der Umgebung nicht in die db.json gelangen: Die
Bestätigung merkt sich die Adresse, für die sie gilt, auch wenn diese aus der Umgebung stammt.
Sonst ließe sich später nicht prüfen, wofür sie erteilt wurde. Den Schlüssel des
Bilder-Anbieters gibt es bewusst nur in der Oberfläche, die Umgebung legt nur den Standard fest.
`NKA_OLLAMA_CANDIDATES` ersetzt die Adressen der Suche und ist für Tests gedacht. Das
Compose-Profil `ki` startet Ollama als Dienst `ollama` mit und lädt das Modell über den Dienst
`ollama-pull`.

**Modelle laden und Empfehlungen** (#33): [server/src/ai/recommendations.ts](recommendations.ts)
hält die Empfehlungsliste. Jede Version bringt eine Kopie mit (`BUILT_IN`, muss mit
[ki-modelle.json](../../../ki-modelle.json) übereinstimmen, ein Test vergleicht beide). Nachgeladen wird
die Datei aus dem Repo nur mit derselben Zustimmung wie beim Update-Hinweis
(`settings.updateCheck === 'on'`), höchstens einmal am Tag, und streng geprüft; unbekannte
Felder fallen weg, eine kaputte Datei ändert nichts. `NKA_MODELS_URL` lenkt die Abfrage auf
einen nachgebauten Server. `GET /api/ai/recommendations` liefert `{ models, updated, source }`.
`POST /api/ai/pull` lädt ein Modell über Ollamas `/api/pull` und antwortet als derselbe Strom
wie die Auswertung (Fortschritt, Lebenszeichen, Abbruch über die Kennung). Nur für ein Ollama
auf diesem Rechner oder im Heimnetz: Dienste im Internet bringen ihre Modelle mit. Vor dem
Download fragt die Oberfläche nach, denn Mietfuchs ist im Heimnetz ohne Anmeldung erreichbar.

**Größe der Seitenbilder** (#35): Ein Scan geht mit `INTAKE_EDGE` Bildpunkten an der langen
Kante an das Modell ([client/src/pdf.ts](../../../client/src/pdf.ts)), der Druck weiter mit Faktor 2 bis
`MAX_EDGE`. Der Wert stammt aus dem KI-Prüflauf, der vier Größen an denselben Belegen verglichen
hat (`--page-edge`, mehrere Werte im Workflow ergeben je Modell einen Lauf pro Größe): Bis 1200
bleibt die Trefferquote gleich, bei 1000 bricht sie bei beiden geprüften Modellen ein, und mehr
als 1200 bringt nichts, kostet aber rund 40 Prozent mehr Eingabe-Token. Dasselbe Band nutzen die
großen Dienste von sich aus: OpenAI stutzt die kurze Kante auf 768 Bildpunkte, Anthropic
rechnet oberhalb von 1568 Token herunter. Wer ein Modell mit anderem Bedarf hat, stellt
`ai.pageImageEdge` unter „Erweitert“ oder per `NKA_AI_IMAGE_EDGE` um (600 bis 2600); die
Oberfläche zeigt dazu den dpi-Wert bei A4.

**KI-Prüflauf** ([.github/workflows/ai-eval.yml](../../../.github/workflows/ai-eval.yml),
[scripts/ai-eval.mjs](../../../scripts/ai-eval.mjs)): vergleicht echte Ollama-Modelle auf GitHub-Runnern
ohne Grafikkarte an erfundenen Belegen in [scripts/ai-eval/](../../../scripts/ai-eval), je als PDF mit
Textebene, Scan und Foto. Start von Hand oder per Label `ai-eval` an einem PR. Neue
Beispielbelege nur erfunden, nie echte Rechnungen. Die Belege `metering-service`, `gas-supplier`
und `heating-oil` (`kind` in cases.json) laufen über die Routen einer Heizanlage, die der Lauf
anlegt; bewertet wird in [scripts/ai-eval/score.mjs](../../../scripts/ai-eval/score.mjs) mit gepflegter
`score.d.mts` daneben (getestet ohne Modell in `server/test/ai-eval-score.test.ts`), denn
ai-eval.mjs startet beim Laden den Lauf. Das nachgebaute Ollama
([scripts/fake-ollama.mjs](../../../scripts/fake-ollama.mjs)) beantwortet die drei Belege richtig, erkannt am
Schema; so lässt sich die Verdrahtung ohne Modell prüfen.
