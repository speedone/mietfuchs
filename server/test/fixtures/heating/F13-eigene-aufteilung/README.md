# F13 Mai–April mit eigener Aufteilung

Wie F12: vier vermietete Einheiten, Objekt von Mai bis April, Heizperiode 01.05.2025–30.04.2026, die
Position „Heizung und Warmwasser“ mit den vier Einzelbeträgen aus `../F12-messdienst-mai-april/betraege.json`
(zusammen 4.276,51 €; Nutzer 1 echt, Nutzer 2 bis 4 synthetisch, siehe dort), Antwort „gar nicht
aufgeteilt“. Dazu die Gasrechnung als Lieferung an der
Heizanlage: 15.03.2025–14.03.2026, 29.886 kWh, 3.117,47 €, CO₂-Kosten 600,00 €, „vom Messdienst
angesetzt“. Fläche der Einstufung: 200,6 m², wie die Wohnfläche laut Abrechnung (Entwurf 15.1 Nr. 1).

**Die kg sind erfunden.** Die Rechnung nennt den Ausstoß; bis er abgeschrieben ist (Gegenprüfung
E.10), stehen zwei Werte nahe der Grenze 27,0 da, die das Kippen festhalten. Wer den echten Wert
einträgt, ersetzt die Varianten durch ihn und rechnet Stufe und L hier neu.

## Herleitung

**Anteil der Rechnung an der Heizperiode.** Nach der Gradtagszahlentabelle (§ 9 Abs. 2 HeizkostenV,
Tabelle aus dem Register) entfallen auf 01.05.2025–14.03.2026 848,71 ‰ der Gradtage der Heizperiode.
Die Lücke 15.03.–30.04.2026 hat 47 Tage und 151,29 ‰ (gerundet 151,3 ‰); dafür gibt es die Warnung
`fuel.uncovered`. Eine Schätzung schlägt Mietfuchs beim Messdienst nicht vor: Seine Beträge stehen
fest.

**E umgerechnet** (§ 5 Abs. 1 Satz 5 CO2KostAufG, Entwurf 3.3): E_H = E · 848,71 ‰ / 848,71 ‰ = E. Eine
einzige Rechnung, die die Heizperiode zu 848,71 ‰ abdeckt, ergibt umgerechnet ihren eigenen Ausstoß.

**C ganz** (G-A3, Entwurf 7.6): Der Messdienst hat die Rechnung als Anlieferung voll verteilt, die
Mieter haben sie ganz bezahlt; C = 600,00 €, nicht 600,00 € · 848,71 ‰ = 509,23 €.

**Variante A:** E = 5.404,16 kg. 5.404,16 / 200,6 = 26,9400 → gerundet 26,9 (§ 5 Abs. 1 Satz 3) →
Stufe 22 bis unter 27: Vermieter 30 %. L = 600,00 € · 30 % = **180,00 €**.

**Variante B:** E = 5.406,17 kg. 5.406,17 / 200,6 = 26,9500 → gerundet 27,0 → Stufe 27 bis unter 32:
Vermieter 40 %. L = 600,00 € · 40 % = **240,00 €**. Die erste Fassung hätte 600,00 € · 0,84871 · 40 %
= 203,69 € gerechnet; den Mietern fehlten 36,31 €.

**Abzug je Mieter** (Entwurf 9.4): r_i = L · Einzelbetrag_i / 4.276,51 €. Gerundet wird R = round(Σ r_i)
= L als eine Verteilung nach dem größten Rest; jeder Abzug liegt deshalb weniger als einen Cent neben
r_i, und die vier ergeben zusammen genau L. Der Vermieter trägt L als `co2Share`.

**Hinweise.** `co2.service-unsplit` entfällt; stattdessen `co2.service-unsplit-healed` („bis zu 3 %“,
Entwurf 15.1 Nr. 3) und `co2.share-approximated` (der Messdienst weist den Brennstoffanteil je Nutzer
nicht aus).
