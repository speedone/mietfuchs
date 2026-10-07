// Begriffslexikon (#113): Jeder Fachbegriff hat eine Erklärung, ein Beispiel mit Zahlen und die
// Antwort auf „Brauche ich das?“. Jeder Hinweis der Berechnung verweist auf mindestens einen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GLOSSARY } from '../../shared/glossary.ts'
import { NOTICE_KINDS } from '../src/calc.ts'

test('Lexikon: jeder Eintrag ist vollständig, und jedes Beispiel rechnet mit Zahlen', () => {
  const entries = Object.entries(GLOSSARY)
  assert.ok(entries.length >= 20, `nur ${entries.length} Begriffe`)
  for (const [id, t] of entries) {
    assert.ok(t.title.trim() && t.short.trim() && t.example.trim() && t.needed.trim(), id)
    assert.match(t.example, /\d/, `${id}: Beispiel ohne Zahl`)
    if ('norm' in t) assert.ok(String(t.norm).trim(), `${id}: leere Rechtsgrundlage`)
  }
  const titles = entries.map(([, t]) => t.title)
  assert.equal(new Set(titles).size, titles.length, 'doppelter Titel')
})

test('Hinweise: jeder Code verweist auf mindestens einen Begriff des Lexikons', () => {
  for (const [code, kind] of Object.entries(NOTICE_KINDS)) {
    const terms = kind?.terms ?? []
    assert.ok(terms.length > 0, `${code} ohne Begriff`)
    for (const t of terms) assert.ok(Object.hasOwn(GLOSSARY, t), `${code}: unbekannter Begriff ${t}`)
  }
})

test('Erhaltungsrücklage: eigener Begriff, und die Hilfetexte führen nicht mehr in die Werbungskosten (#143)', () => {
  const t = GLOSSARY.reserveFund
  assert.match(t.norm, /IX R 19\/24/)
  assert.match(t.short, /erst/)
  // Beispiel nachgerechnet: 3.600 € Hausgeld − 900 € Rücklage = 2.700 € sofort abziehbar.
  assert.match(t.example, /3\.600 €.*900 €.*2\.700 €/s)
  assert.equal(3600 - 900, 2700)
  // Die Hausgeldabrechnung nannte die Rücklage ohne steuerlichen Zusatz neben den abziehbaren
  // Posten; das Beispiel muss sie jetzt ausdrücklich als erst bei Verwendung abziehbar nennen.
  assert.match(GLOSSARY.homeownersStatement.example, /Rücklage[^.]*erst/)
  assert.equal(1900 + 360 + 900 + 440, 3600, 'Summe des Hausgeld-Beispiels')
  assert.match(GLOSSARY.notAllocable.needed, /Zuführung Erhaltungsrücklage/)
})

test('Gemeinschaftsabrechnung mit mehreren eigenen Wohnungen: das Lexikon empfiehlt für Heizkosten Einzelbeträge (#140, Durchsicht)', () => {
  // Laut Gemeinschaftsabrechnung verteilt Mietfuchs innerhalb der eigenen Wohnungen nach MEA oder
  // Fläche, nicht nach deren Verbrauch.
  assert.match(GLOSSARY.mea.needed, /mehrere Wohnungen/)
  assert.match(GLOSSARY.mea.needed, /Einzelbeträge/)
})

test('Hausgeld (Vorschuss): eigener Begriff, abgegrenzt von Abrechnung und Rücklage, Abfluss für die Steuer (#142)', () => {
  const t = GLOSSARY.homeownersFee
  assert.equal(t.title, 'Hausgeld (Vorschuss)')
  assert.match(t.norm, /§ 28 WEG/)
  assert.match(t.norm, /§ 11 Abs\. 2 EStG/)
  // Abgrenzung: nicht die Hausgeldabrechnung und nicht die Erhaltungsrücklage.
  assert.match(t.short + t.needed, /Hausgeldabrechnung/)
  assert.match(t.short + t.example + t.needed, /Erhaltungsrücklage/)
  // Steuerlich zählt der Abfluss.
  assert.match(t.needed, /abfließt|Abfluss/)
  // Beispiel nachgerechnet: 300 € im Monat sind 3.600 € im Jahr; davon 900 € Rücklage, 2.700 € sofort.
  assert.match(t.example, /300 €.*3\.600 €.*900 €.*2\.700 €/s)
  assert.equal(300 * 12, 3600)
  assert.equal(3600 - 900, 2700)
})

test('Einheit ohne Anschluss: eigener Begriff mit nachgerechnetem Beispiel (#142)', () => {
  const t = GLOSSARY.noConnection
  assert.equal(t.title, 'Einheit ohne Anschluss')
  assert.match(t.short, /Garage/)
  // 600 € Wasser nach Verbrauch, zwei Wohnungen mit 40 und 20 m³, die Garage ohne Wasser: 400 € und 200 €.
  assert.match(t.example, /600 €.*40.*20 m³.*400 €.*200 €/s)
  assert.equal(600 * 40 / 60, 400)
  assert.equal(600 * 20 / 60, 200)
})

test('Einliegerwohnung: Anlage in Mietfuchs, Folgen und ein nachgerechnetes Beispiel (#142)', () => {
  const t = GLOSSARY.granny
  assert.equal(t.title, 'Einliegerwohnung')
  assert.match(t.norm, /§ 2 HeizkostenV/)
  assert.match(t.needed, /selbstgenutzt/)
  assert.match(t.needed, /Hauptzähler/)
  assert.match(t.needed, /Eigenanteil/)
  // 120 m² eigen + 45 m² vermietet = 165 m², Grundsteuer 600 €: 45/165 = 163,64 €, der Rest 436,36 €.
  assert.match(t.example, /120 m².*45 m².*165 m².*600 €.*163,64 €.*436,36 €/s)
  assert.equal(120 + 45, 165)
  assert.equal(Math.round((60000 * 45) / 165), 16364)
  assert.equal(60000 - 16364, 43636)
})

test('Teilweise selbstgenutztes Gebäude: Rechtsgrundlage, gesonderte Aufstellung und ein nachgerechnetes Beispiel (#163)', () => {
  const t = GLOSSARY.mixedUse
  assert.equal(t.title, 'Teilweise selbstgenutztes Gebäude')
  assert.match(t.norm, /§ 12 Nr\. 1 EStG/)
  assert.match(t.norm, /IX R 26\/06/)
  assert.match(t.needed, /gesonderte[nr]? Aufstellung/)
  assert.match(t.needed, /Betrifft \(für die Steuer\)/)
  // 120 + 60 = 180 m²; Dachreparatur 1.800 € × 60/180 = 600 € abziehbar, 1.200 € privat.
  assert.match(t.example, /120 m².*60 m².*180 m².*1\.800 €.*600 €.*1\.200 €/s)
  assert.equal(120 + 60, 180)
  assert.equal(1800 * 60 / 180, 600)
  assert.equal(1800 - 600, 1200)
})

test('Zeiträume (#208): Abrechnungszeitraum, Rumpf, Leistungsprinzip und Gradtage mit nachgerechneten Beispielen', () => {
  assert.match(GLOSSARY.billingPeriod.example, /01\.05\.2025 bis 30\.04\.2026.*30\.04\.2027/s)
  assert.match(GLOSSARY.shortPeriod.example, /120 Tagen.*30\.04\.2026/s)
  // 480 € · 120/365 = 157,81 €, 480 € · 245/365 = 322,19 €
  assert.equal((48000 * 120 / 365 / 100).toFixed(2), '157.81')
  assert.equal((48000 * 245 / 365 / 100).toFixed(2), '322.19')
  assert.match(GLOSSARY.accrualPrinciple.example, /157,81 €.*322,19 €/s)
  // Januar bis April 530 Promille; 700 € / 0,53 = 1.320,75 € im Jahr, 110,06 € im Monat
  assert.match(GLOSSARY.degreeDays.example, /530 Promille.*1\.320,75 €.*110,06 €/s)
  assert.equal((70000 / 0.53 / 100).toFixed(2), '1320.75')
  assert.equal((70000 / 0.53 / 12 / 100).toFixed(2), '110.06')
  assert.match(GLOSSARY.degreeDays.norm, /§ 9b Abs\. 2 HeizkostenV/)
})

test('CO₂ und Warmwasser (Heizung PR 6): Beispiele nachgerechnet, Rechtszahlen aus dem Register', () => {
  // 24.105,6 kg bei 600 m²: 40,176 kg, auf eine Nachkommastelle 40,2 (§ 5 Abs. 1 Satz 3) → 37 bis
  // unter 42 kg, Vermieter 60 % (Anlage). 600 € CO₂-Kosten: 360 € Vermieter, 240 € Mieter.
  assert.equal(Math.round((24105.6 / 600) * 10) / 10, 40.2)
  const split = GLOSSARY.co2Split
  assert.match(split.example, /24\.105,6 kg CO₂ bei 600 m² Wohnfläche: 40,2 kg je m², Stufe 37 bis unter 42 kg/)
  assert.match(split.example, /trägt 60 % der CO₂-Kosten, also 360 €, die Mieter tragen 240 €/)
  assert.match(split.example, /um 3 % kürzen/)
  assert.match(split.needed, /am oder nach dem 01\.01\.2023 beginnt/)
  assert.equal(split.norm, '§§ 5, 7 CO2KostAufG')
  assert.match(GLOSSARY.co2Stage.short, /einer von 10 Stufen/)
  assert.match(GLOSSARY.co2Stage.short, /0 % unter 12 kg bis 95 % ab 52 kg/)
  assert.match(GLOSSARY.co2Stage.example, /40,176 kg je m², gerundet 40,2: Stufe 37 bis unter 42 kg, der Vermieter trägt 60 %/)
  // 5.421 kg bei 200,6 m²: 27,0239 kg, gerundet 27,0.
  assert.equal(Math.round((5421 / 200.6) * 100) / 100, 27.02)
  assert.match(GLOSSARY.co2Area.example, /5\.421 kg CO₂ bei 200,6 m² laut Messdienst ergeben 27,02 kg je m², gerundet 27,0/)
  // Techem-Muster (Entwurf 7.2, 7.4): 3.540,00 − 87,50 = 3.452,50; 3.845,51 + 87,50 = 3.933,01.
  assert.equal(354000 - 8750, 345250)
  assert.equal(384551 + 8750, 393301)
  assert.match(GLOSSARY.co2Deducted.example, /3\.540,00 €.*87,50 €.*3\.452,50 €.*3\.845,51 €.*3\.933,01 €/s)
  // 15 % von 1.000 € (BGH VIII ZR 151/20, Entwurf R-A6).
  assert.match(GLOSSARY.hotWaterShare.example, /1\.000 €.*um 15 % kürzen, also um 150 €/s)
  assert.equal(GLOSSARY.hotWaterShare.norm, '§ 9 Abs. 2 und 3, § 9b Abs. 2, § 12 Abs. 1 Satz 1 HeizkostenV; BGH, Urteil vom 12.01.2022, VIII ZR 151/20')
})

test('Nutzeinheit (Heizung PR 6, Durchsicht M3): Beispiel mit dem Spielraum der Probe', () => {
  const t = GLOSSARY.serviceUnits
  assert.equal(4 * 2, 8)
  assert.match(t.example, /vier Nutzeinheiten.*8 ct/s)
})

test('Durchsicht M1, M4: Flächenformel mit ihrer Voraussetzung; S umfasst neben dem Brennstoff die übrigen Heizkosten', () => {
  assert.match(GLOSSARY.hotWaterShare.short, /weder die Wärmemenge noch das Volumen des verbrauchten Warmwassers gemessen werden kann/)
  assert.match(GLOSSARY.co2Deducted.example, /Zusammen mit Strom, Wartung und Messdienstkosten/i)
})

test('Gradtagszahlen (Heizung PR 7): auch für die Abgrenzung einer Versorgerrechnung', () => {
  assert.match(GLOSSARY.degreeDays.needed, /Gas-, Fernwärme- oder Stromrechnung über das Ende der Heizperiode/)
  assert.match(GLOSSARY.degreeDays.needed, /Zählerstand zum Stichtag/)
  assert.match(GLOSSARY.degreeDays.needed, /DIN 94680/)
})

test('Brennstoffvorrat (Heizung PR 8): Beispiel nachgerechnet', () => {
  // Anfangsbestand 2.000 l / 1.900 €, Lieferungen 3.000 l / 3.150 € und 2.500 l / 2.500 €,
  // Endbestand 1.800 l aus der jüngsten Lieferung: 1.800 / 2.500 × 2.500 € = 1.800 €.
  assert.equal(2000 + 3000 + 2500 - 1800, 5700)
  assert.equal((1800 / 2500) * 250000, 180000)
  assert.equal(190000 + 315000 + 250000 - 180000, 575000)
  assert.equal(315000 + 250000, 565000)
  const t = GLOSSARY.fuelStock
  assert.match(t.example, /Endbestand 1\.800 l.*1\.800 €.*5\.700 l.*5\.750 €.*5\.650 €.*100 €/s)
  assert.equal(t.norm, '§ 7 Abs. 2 HeizkostenV; BGH VIII ZR 156/11')
  assert.match(t.short, /jüngsten Lieferungen/)
  assert.match(t.needed, /Heizöl, Flüssiggas, Pellets, Holz oder Kohle/)
})

test('Fläche der CO₂-Einstufung bei Etagenheizungen (Heizung PR 9, § 5 Abs. 1 Satz 2 CO2KostAufG)', () => {
  assert.match(GLOSSARY.co2Area.short, /Etagenheizung.*Gesamtwohnfläche der vermieteten Wohnungen mit eigener Heizung \(§ 5 Abs\. 1 Satz 2 CO2KostAufG\)/s)
})

test('Eigene Heizkostenabrechnung: vier Begriffe mit nachgerechneten Beispielen (Heizung PR 10, Entwurf 10.3)', () => {
  // Beispiel A aus 8.6: Topf Heizung 5.628 €, davon 30 % Grundkosten, Wohnung mit 60 von 200 m².
  assert.match(GLOSSARY.baseCosts.example, /5\.628,00 €.*1\.688,40 €.*506,52 €/s)
  assert.equal(Math.round(562800 * 0.3), 168840)
  assert.equal(Math.round((168840 * 60) / 200), 50652)
  // 70 % = 3.939,60 €, davon 12.000 von 40.000 kWh = 1.181,88 €.
  assert.match(GLOSSARY.consumptionCosts.example, /3\.939,60 €.*12\.000 von 40\.000 kWh.*1\.181,88 €/s)
  assert.equal(Math.round(562800 * 0.7), 393960)
  assert.equal(Math.round((393960 * 12000) / 40000), 118188)
  // Wechsel zum 30.09.: 640 ‰ und 360 ‰ Gradtage, zeitanteilig 273 und 92 Tage.
  assert.match(GLOSSARY.interimReading.example, /324,17 €.*182,35 €.*378,85 €.*127,67 €/s)
  assert.equal(Math.round(50652 * 0.64), 32417)
  assert.equal(Math.round(50652 * 0.36), 18235)
  assert.equal(Math.round((50652 * 273) / 365), 37885)
  assert.equal(Math.round((50652 * 92) / 365), 12767)
  assert.match(GLOSSARY.interimReading.norm, /§ 9b HeizkostenV/)
  assert.match(GLOSSARY.interimReading.needed, /VIII ZR 19\/07/)
  assert.match(GLOSSARY.heatMeter.example, /13\.000 kWh.*12\.000 kWh/s)
  // Beide Lesarten beim gemessenen Warmwasseranteil (15.1 Nr. 9), mit beiden Werten.
  assert.match(GLOSSARY.hotWaterShare.example, /15,00 %.*16,65 %/s)
  assert.match(GLOSSARY.hotWaterShare.example, /Norm offen: VDI 2077/)
})

test('Warmwasseranteil (Heizung PR 11): Beispiel aus dem Entwurf 8.3 nachgerechnet, beide Lesarten zu Q gleichwertig', () => {
  const e = GLOSSARY.hotWaterShare.example
  assert.match(e, /Q = 2,5 · 120 · \(60 − 10\) = 15\.000 kWh/)
  assert.match(e, /mal 1,11 = 16\.650 kWh, Anteil 27,75 %/)
  assert.match(e, /32 · 200 = 6\.400 kWh, mal 1,11 = 7\.104 kWh, Anteil 11,84 %/)
  assert.match(e, /9\.000 \/ 60\.000 = 15,00 %/)
  assert.match(e, /9\.000 · 1,11 \/ 60\.000 = 16,65 %/)
  assert.match(e, /um 15 % kürzen, also um 150 €/)
  assert.match(GLOSSARY.hotWaterShare.short, /Heizwert laut Rechnung/)
  assert.match(GLOSSARY.hotWaterShare.needed, /§ 9b Abs\. 2 HeizkostenV/)
})

test('Durchsicht #240, Recht-I3: Brennwert und Heizwert mit Faktor aus dem Register und Rat zur Rechnung', () => {
  const t = GLOSSARY.gasCalorificBasis
  assert.match(t.example, /15\.000 · 1,11 = 16\.650 kWh/)
  assert.equal(t.norm, '§ 9 Abs. 2 Satz 6 Nr. 1 HeizkostenV')
  assert.match(t.needed, /steht dort „Brennwert“, wählen Sie „nach Brennwert“/)
})

test('Heizkostenverteiler (Heizung PR 12): Skalen, Faktoren 1,25 und 0,8 nachgerechnet, Stichtag, Verdunster', () => {
  const g = GLOSSARY.heatCostAllocator
  assert.match(g.short, /Einheitsskala.*Bewertungsfaktor.*in der Abrechnung stehen/s)
  assert.match(g.short, /Produktskala.*schon eingerechnet/s)
  assert.match(g.short, /Stichtag/)
  assert.match(g.example, /Einheitsskala 500, sein Bewertungsfaktor ist 1,25: das sind 625 Einheiten/)
  assert.match(g.example, /200 bei Faktor 0,8: 160 Einheiten/)
  assert.match(g.example, /785 von 7\.850 Einheiten/)
  assert.match(g.example, /ein Zehntel der Kosten nach Verbrauch, bei 2\.100 € also 210 €/)
  assert.match(g.needed, /400 bis 800 ‰ der Gradtagszahlen/)
  assert.match(g.needed, /Skala und Bewertungsfaktor/)
  assert.doesNotMatch(g.needed, /noch nicht selbst aus/)
})
