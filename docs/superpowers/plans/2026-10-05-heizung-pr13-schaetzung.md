# Heizung PR 13: Schätzung nach § 9a HeizkostenV (#99) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fällt bei der eigenen Heizkostenabrechnung ein Gerät aus oder lässt sich ein Wert aus einem
anderen zwingenden Grund nicht mehr ablesen, schätzt der Vermieter den Verbrauch der Wohnung nach
einem der drei Wege des § 9a Abs. 1 HeizkostenV (Vorgabe: Durchschnitt des Gebäudes je m²) mit
Begründung und Bestätigung; Mietfuchs setzt den geschätzten Verbrauch an die Stelle des erfassten,
verteilt einen Topf ausschließlich nach Fläche, wenn die geschätzte Fläche 25 % der maßgeblichen
Fläche **überschreitet** (je Topf getrennt), und sagt im Dialog vorher, welcher Flächenanteil das
tatsächlich ist.

**Architecture:** Eine neue Tabelle `heating_estimates` (Entwurf 5.6) in einem erzeugten Schritt
`0032_schaetzung`. Die Rechnung bleibt in `server/src/heating.ts`: `planSelf` (PR 10) nimmt je
`Wohnung:Topf` einen geschätzten Verbrauch entgegen, der die Ablesungen dieser Wohnung in diesem Topf
ersetzt und unter ihren Nutzern wie eine Gruppe nach § 9b geteilt wird, und meldet je Topf die
geschätzte Fläche und ob sie die Grenze des § 9a Abs. 2 überschreitet; `weightsOf` setzt dann den
Anteil nach Verbrauch dieses Topfs auf 0. Eine reine Funktion `estimateProposals` rechnet die drei
Vorschläge. `computeSettlement` liest die Schätzungen aus dem Schnappschuss, rechnet die Vorperiode
für den Vorschlag „vergleichbare Zeiträume“ mit, schreibt drei Hinweise und den Ausweis
(`self.estimates`, `self.estimateOptions`, je Topf `overThreshold`). Die Seite Heizkosten bekommt die
Karte „Schätzung (§ 9a)“ mit dem Dialog.

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM
0.45 über `sqlite-proxy`, drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich
**8.7 ganz**, 3.5 Nr. 4 („§ 9a nur bei Ausfall“), 0.3 und 0.5 (R-A14, R-A22, Z-B1), 0.6 (N5), 4.3
(`hkv.estimate-threshold`), 5.1 und **5.6** (`heating_estimates`), 5.7 (`HeatingEstimate`), 5.8
(Schätzungen im Schnappschuss), 5.9 (Wiederherstellen), 8.8 („Schätzungen mit Methode“ im
Druckblock), 10.1 (`heating.estimate-unconfirmed`, `heating.estimated`, `heating.estimate-over-25`),
10.2 (`heating-estimate`), 10.3 (`heatingEstimate`), 11.4 (Seite Heizkosten), 12.2
(`heating.test.ts`: „Schätzung 40 % → Fläche; 20 % → bleibt“; R-A22), 12.4 (Client: „25-%-Warnung
vor dem Markieren“), 13 (PR 13), 14.1 (Zeile „Geräteausfall“), **15.1 Nr. 6 und 7**.

**Baut auf:** PR 1 und PR 2 (Code auf `feat/heizung`), PR 3 bis PR 12 nach ihren Plänen
`docs/superpowers/plans/2026-10-05-heizung-pr{3..12}-*.md`, maßgeblich PR 10 in der Fassung von
Commit `81828af`. Gearbeitet wird auf `feat/heizung-pr13-schaetzung`, abgezweigt von der Spitze von
PR 12; der PR wird gestapelt auf PR 12 gestellt und nach dessen Merge auf `main` umgestellt
(`git rebase --onto`).

**Wortlaut, gelesen am 05.10.2026 auf gesetze-im-internet.de** (HeizkostenV in der Fassung Art. 3
G v. 16.10.2023):

- § 9a Abs. 1: „Kann der anteilige Wärme- oder Warmwasserverbrauch von Nutzern für einen
  Abrechnungszeitraum wegen Geräteausfalls oder aus anderen zwingenden Gründen nicht ordnungsgemäß
  erfasst werden, ist er vom Gebäudeeigentümer auf der Grundlage des Verbrauchs der betroffenen Räume
  in vergleichbaren Zeiträumen oder des Verbrauchs vergleichbarer anderer Räume im jeweiligen
  Abrechnungszeitraum oder des Durchschnittsverbrauchs des Gebäudes oder der Nutzergruppe zu
  ermitteln. Der so ermittelte anteilige Verbrauch ist bei der Kostenverteilung anstelle des
  erfassten Verbrauchs zu Grunde zu legen.“
- § 9a Abs. 2: „Überschreitet die von der Verbrauchsermittlung nach Absatz 1 betroffene Wohn- oder
  Nutzfläche oder der umbaute Raum 25 vom Hundert der für die Kostenverteilung maßgeblichen gesamten
  Wohn- oder Nutzfläche oder des maßgeblichen gesamten umbauten Raumes, sind die Kosten ausschließlich
  nach den nach § 7 Absatz 1 Satz 5 und § 8 Absatz 1 für die Verteilung der übrigen Kosten zu Grunde zu
  legenden Maßstäben zu verteilen.“
- § 12 Abs. 1 Satz 1: „Soweit die Kosten der Versorgung mit Wärme oder Warmwasser entgegen den
  Vorschriften dieser Verordnung nicht verbrauchsabhängig abgerechnet werden, …“

## Global Constraints

- **Wer nichts einstellt, merkt nichts** (Entwurf 1.2 Nr. 1, 11.1): Ohne Zeile in `heating_estimates`
  ist jede Zahl, jeder Hinweis, jedes Feld der Abrechnung und `legalBasis.values` gleich dem Stand nach
  PR 12, mit genau einer Änderung: Der Text von `heating.self-incomplete` bei einem fehlenden Stand,
  einem Zählerwechsel ohne Endstand und negativem Verbrauch sagt nicht mehr „das rechnet Mietfuchs mit
  einer späteren Version“, sondern verweist auf die Schätzung. Golden F01–F17 bleiben wortgleich; keins
  hat diesen Fehler (Task 5 prüft das).
- **§ 9a nur bei Ausfall** (Entwurf 8.7, 3.5 Nr. 4; BGH VIII ZR 373/04, sekundär): Geschätzt wird nur
  ein Verbrauch, der „wegen Geräteausfalls oder aus anderen zwingenden Gründen nicht ordnungsgemäß
  erfasst“ werden kann. Verschiedene Ablesetage sind **kein** Fall des § 9a (R-A14, Z-B1); sie bleiben,
  wie PR 10 sie rechnet. Eine Wohnung **ohne** Gerät ist kein Ausfall, sondern ein Verstoß gegen die
  Ausstattungspflicht; für sie lehnt der Server eine Schätzung ab (400 mit Satz).
- **Grenze des § 9a Abs. 2 nur aus dem Register** (`hkv.estimate-threshold`, 25, „überschreitet“,
  also streng größer; R-A22): verglichen wird ganzzahlig über Produkte
  (`geschätzte Fläche · 100 > Gesamtfläche · Grenze`), nie über einen gerundeten Prozentwert.
  Maßgeblich ist die Fläche **des Topfs** (Heizung: Wohnfläche oder beheizte Fläche nach § 7 Abs. 1
  Satz 5, Warmwasser: Wohnfläche nach § 8 Abs. 1), **je Topf getrennt** (Entwurf 15.1 Nr. 6).
- **Keine Kürzung nach § 12 bei Flächenverteilung nach § 9a Abs. 2** (Entwurf 15.1 Nr. 7, offene
  Rechtsfrage): Der Hinweis sagt, dass das eine Auslegung ist.
- **Rechtswerte nur aus dem Register** (4.3, 4.7): genau ein neuer Parameter,
  `hkv.estimate-threshold`. Die Zahl 25 kommt in `CODE_PATTERN` von `law-literals.test.ts`.
- **Fassungen nie ändern** (4.4): eine neue Zeile in `law-history.test.ts`, keine geänderte.
- **Stufe hängt am Code** (#112): drei Codes, je mit genau einer Stufe in `noticeKinds` und mindestens
  einem Begriff (`heatingEstimate`).
- **Migrationen:** nur mit `npm --prefix server run db:generate -- --name schaetzung`, nie von Hand.
  Genau ein Schritt hinter `0031_hkv_bedingungen` (PR 12): `0032_schaetzung` mit der neuen Tabelle und
  ihren eigenen Bedingungen; keine bestehende Tabelle ändert sich, deshalb kein zweiter Schritt. Keine
  Datenanweisung. Die Marke kommt in `server/test/migrations.test.ts`.
- **Eingefrorener Eingang:** `server/src/legacy/{schema,write,migrate,validate}.ts` bleiben
  unverändert; `legacy/read.ts` braucht keine Änderung (das neue Feld im Schnappschuss ist optional).
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen, Commit-Nachrichten deutsch;
  Nutzertexte siezen (`anrede.test.ts`).
- **Server-Importe** tragen `.ts`; reine Typimporte als `import type`; kein `enum`, kein `namespace`,
  keine Parameter-Eigenschaften (`erasableSyntaxOnly`). Im Client endungslose Importe, nur aus
  `shared/` mit `.ts`.
- **Auswahlfelder** werden aus Optionslisten gespeist; je neuem Auswahlfeld ein jsdom-Test, dass der
  angezeigte Wert dem gespeicherten entspricht.
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port); in api.test.ts erledigt das `startServer`.
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0 (nie hinter
  `grep` prüfen). Jede Commit-Nachricht ist deutsch, nennt `Refs #99` und endet mit den
  Attribution-Zeilen der ausführenden Sitzung. Aufgaben stehen nur in den GitHub-Issues des Repos,
  nie in Beads (CLAUDE.md).

## Review Focus

1. **Der Vermieter schätzt, weil der Endstand fehlt, und findet ihn eine Woche später doch noch.**
   Er erwartet, dass der abgelesene Wert gilt. Erwartet: Die Schätzung bleibt maßgeblich, bis er sie
   entfernt (sie ist zugleich die Markierung „unbrauchbar“ aus Entwurf 8.7), und der Hinweis
   `heating.estimated` sagt in jedem Fall, dass eine Schätzung nur zulässig ist, solange sich der Wert
   nicht ablesen lässt, und dass sie zu entfernen ist, wenn der Wert doch vorliegt; nach dem Entfernen
   rechnet Mietfuchs mit dem Ablesewert. Test in Task 5.
2. **Die geschätzte Wohnung hatte einen Mieterwechsel.** Erwartet: Der geschätzte Verbrauch der ganzen
   Heizperiode wird unter den Nutzern der Wohnung geteilt wie nach § 9b Abs. 3 (Heizung nach Gradtagen
   bzw. Tagen, Warmwasser nach Tagen), der Ausweis nennt beide als „gemeinsam“, und der Hinweis sagt
   das. Test in Task 3 (C1 = 12.000 · 640/1.000 = 7.680 kWh).
3. **Vier gleich große Wohnungen, eine fällt aus** (R-A22). Erwartet: genau 25 %, **keine**
   Überschreitung, verteilt wird weiter nach Verbrauch; der Dialog sagt „genau … %, also keine
   Überschreitung“. Ist eine von vier Wohnungen größer als ein Viertel der Gesamtfläche, überschreitet
   sie allein die Grenze. Test in Task 3 und Task 6.
4. **Beheizte Fläche:** Der Topf Heizung rechnet mit der beheizten Fläche, der Topf Warmwasser mit der
   Wohnfläche; eine geschätzte Wohnung kann deshalb im einen Topf über der Grenze liegen und im anderen
   nicht. Erwartet: je Topf getrennt (15.1 Nr. 6). Test in Task 3.
5. **Ungültige Eingaben beim Speichern:** Wert negativ, Begründung leer, unbekannter Weg, Wohnung ohne
   Gerät, Wohnung nicht an der Anlage, abgeschlossene Heizperiode, Warmwasser bei einer Anlage ohne
   Warmwasser. Erwartet: je 400 (abgeschlossen 409) mit einem Satz, nichts geschrieben. Test in Task 4.

---

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/law/heizkostenv.ts`, `shared/law/params.ts`, `shared/law/rules.ts`, `shared/glossary.ts` | `hkv.estimate-threshold`, Regel `heating-estimate`, Begriff `heatingEstimate` | 1 |
| `shared/types.ts`, `shared/heating.ts` | `EstimatePart`, `EstimateMethod`, `HeatingEstimate`, `EstimateProposal`, `ComparableUnit`, `SelfEstimateView`, `SelfEstimateOption`; Felder an `SelfPotView`, `SelfUserView`, `SelfHeatingStatement`; `POT_OF_PART`, `PART_OF_POT` | 2 |
| `server/src/db/schema.ts`, `server/drizzle/0032_schaetzung.sql`, `meta/*` (erzeugt) | Tabelle `heating_estimates` | 2 |
| `server/src/db/read.ts`, `server/src/snapshot.ts`, `server/src/db/repository.ts` | lesen, Schnappschuss, `crossPropertyViolations` | 2 |
| `server/src/heating.ts` | `planSelf` mit Schätzungen und Grenze, `weightsOf`, `estimateProposals`, `estimateDeviceType` | 3 |
| `server/src/db/heatingEstimates.ts` (neu), `server/src/index.ts` | speichern, entfernen, Routen | 4 |
| `server/src/calc.ts` | Schätzungen in den Plan, Vorperiode, Hinweise, Rechenweg, Ausweis | 5 |
| `client/src/estimateForm.ts` (neu), `client/src/components/EstimateCard.tsx` (neu), `client/src/components/SelfHeatingCards.tsx`, `client/src/heatingSelfView.ts`, `client/src/notices.ts` | Karte und Dialog, Ausweis, Ampel | 6 |
| `CHANGELOG.md`, `CLAUDE.md` | Doku | 7 |
| Tests: `law-schaetzung.test.ts` (neu), `law.test.ts`, `law-history.test.ts`, `law-literals.test.ts`, `glossary.test.ts`, `rules.test.ts`, `schema.test.ts`, `migrations.test.ts`, `heating.test.ts`, `db-schaetzung.test.ts` (neu), `api.test.ts`, `calc-schaetzung.test.ts` (neu), `client/src/estimateForm.test.ts` (neu), `client/src/components/EstimateCard.test.tsx` (neu), `client/src/heatingSelfView.test.ts` | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

Namen genau so; wer einen davon in PR 1 bis PR 12 anders umgesetzt hat, zieht ihn hier nach, bevor
Task 1 beginnt.

| Herkunft | Name | Gestalt |
|---|---|---|
| PR 1 `shared/law/register.ts` | `LawParam<T, M>` mit `describe`, `Source`, `law(param, ctx, log)`, `valueAt`, `onlyVersion`, `createLawLog`, `LAW_AS_OF`, `dayBefore`, `dayAfter`, `germanDate` | Code |
| PR 1 `shared/law/heizkostenv.ts` | `ENACTED`, `checked(cite, url)` (beide dateiintern), `hkvConsumptionShare` | Code |
| PR 1 Tests | `law.test.ts` (Objekt `modules`), `law-history.test.ts` (`SHIPPED`), `law-literals.test.ts` (`ENGINE_FILES`, `CODE_PATTERN`, `ALLOWED`) | Code |
| PR 2 | `PeriodKey`, `periodKey`, `periodDays`, `previousPeriod`, `periodLabel` (`shared/period.ts`) | Code |
| PR 4 | `heatingPeriods`, `heatingPlants`, `units`, `exactly`, `oneOf`, `notNegative` (schema.ts); `HeatingError(status, message)`, `raw`, `has`, `oneOfOrUndefined` (repository.ts); `servesUnit` (`shared/heatingPeriod.ts`, PR 5) | Plan PR 4, 5 |
| PR 6, PR 8 | `HeatingStatement`, `HeatingPeriodView`; `server/src/db/heatingPeriodContext.ts` mit `plantContext`, `heatingPeriodOf`, `heatingPeriodClosed`, `ensureHeatingPeriod`, `closedText`; Seite `client/src/pages/Heizkosten.tsx` | Plan PR 6, 8 |
| PR 10 `server/src/heating.ts` | `SelfUnit`, `SelfInput`, `SelfUser`, `SelfUserPot`, `SelfUserPlan`, `SelfUnitPlan`, `SelfProblem`, `SelfPlan`, `SelfWeights`, `POT_METER`, `planSelf`, `weightsOf`, `usersOf`; in `planSelf` die Helfer `metersOf`, `areaOf`, `splitOf`, `heatAreaOf`, `startBoundary`, `readingAt`, `offAt`, `potHasMeters`, `totals` | Plan PR 10 Task 3 |
| PR 10 `server/src/calc.ts` | `SelfPlantPlan` (mit `input`, Task 9), `selfPlans`, `SelfBlock`, `POT_NAME`, `POT_UNIT`, `selfProblemText`, `selfSteps`, `selfStatementOf`, `potCostOf`, `cutOf`, `nameOf`; im Block des Plans `plant`, `rules`, `prev`, `next`, `servedIds`, `table`, `input`, `plan`, `blocked`, `where` | Plan PR 10 Task 8, 9 |
| PR 10 `shared/types.ts` | `SelfPot`, `SelfPotView`, `SelfUserView`, `SelfUnitView`, `SelfHeatingStatement`, `CaptureMethod`, `HotWater` | Plan PR 10 Task 2 |
| PR 10 Client | `client/src/heatingSelfView.ts` (`potLines`, `userLine`), `client/src/components/SelfHeatingCards.tsx` (Props `{ plant, view, self, onChanged }`), `client/src/notices.ts` (`INFORMATIONAL`) | Plan PR 10 Task 13 |
| PR 10 Tests | `server/test/heating.test.ts` mit `UNITS`, `TENANCIES`, `METERS`, `READINGS`, `r`, `input`, `without`, `userOf`, `near`, `table`, `offRule`; `server/test/schema.test.ts` mit `freshDb`, `rejects`, `einWohnung` | Plan PR 10 Task 2, 3 |
| PR 11, PR 12 | Test-Helfer `server/testing/selfHeating.ts` mit `selfSnapshot(o?)` (Beispiel A, Anlage `hp`, Heizperiode `'2025-01'`, Wohnungen `a`, `b`, `c`, Mietverhältnisse wie in PR 10 `beispielA`); `HeatingServiceValue`, `heatingServiceValues` | Plan PR 11 B8, PR 12 C6 |

**Naht zu PR 12.** PR 12 lässt die Verbrauchswerte der Raumwärme je nach Erfassung aus
Wärmezählern, Heizkostenverteilern oder Werten eines Ablesedienstes entstehen. Dieser Plan setzt an
der Stelle an, an der `planSelf` (PR 10) je Wohnung und Topf die Geräte nimmt (`metersOf(unit.id, p)`).
Hat PR 12 diese Stelle anders gebaut (etwa über `heatDevicesOf`), gilt dieselbe Regel dort: **Für eine
geschätzte Wohnung in einem Topf zählt kein Gerät und keine Ablesung; der geschätzte Wert tritt an die
Stelle.** Vor Task 3 gleicht die ausführende Sitzung das mit dem Code von PR 12 ab und nennt jede
Anpassung in der PR-Beschreibung.

## Abweichungen vom Entwurf und Festlegungen dieses Plans

Jede steht im Task an ihrer Stelle und kommt in die PR-Beschreibung, damit die Durchsicht sie
entscheidet.

1. **Werte der Spalte `part` sind `heat` und `water`** (Entwurf 5.6), während die Rechnung von PR 10
   die Töpfe `heating` und `water` nennt. Die Zuordnung steht einmal in `shared/heating.ts`
   (`POT_OF_PART`, `PART_OF_POT`). Keine Abweichung in der Sache, nur die Naht benannt.
2. **Eine Schätzung gilt für die ganze Heizperiode einer Wohnung in einem Topf** (Primärschlüssel nach
   Entwurf 5.6 ohne Nutzer). Hat die Wohnung in der Heizperiode mehrere Nutzer, wird der geschätzte
   Wert unter ihnen geteilt wie eine Gruppe nach § 9b Abs. 3: Heizung nach Gradtagen bzw. Tagen
   (`change_split`), Warmwasser nach Tagen. **Festlegung ohne Quelle:** § 9a spricht vom Verbrauch „von
   Nutzern“, regelt aber nicht, wie ein für eine Wohnung geschätzter Verbrauch auf mehrere Nutzer geht;
   § 9b Abs. 2 und 3 ist die einzige Teilungsregel der Verordnung für diesen Fall. Der Hinweis sagt es.
3. **Die Schätzung ist zugleich die Markierung „unbrauchbar“** (Entwurf 8.7: „vom Vermieter als
   unbrauchbar markiert“). Es gibt dafür kein eigenes Feld: Liegt eine Schätzung vor, zählen die
   Ablesungen dieser Wohnung in diesem Topf nicht, auch wenn sie vollständig sind (Review Focus 1).
4. **Keine Schätzung für eine Wohnung ohne Gerät.** Der Entwurf zählt in 8.7 die Fälle auf und nennt den
   fehlenden Zähler nicht; § 9a setzt ein Gerät voraus, das ausfällt („Geräteausfall“). Der Server
   lehnt eine Schätzung ab, wenn die Wohnung bei Wärmezählern keinen Wärmezähler, bei
   Heizkostenverteilern keinen Heizkostenverteiler bzw. beim Warmwasser keinen Warmwasserzähler hat
   (`estimateDeviceType`). Bei Werten eines Ablesedienstes gibt es keine Geräte in Mietfuchs; dort wird
   nicht geprüft. Der Fehler `heating.self-incomplete` mit Grund `noMeter` bleibt deshalb ohne Verweis
   auf die Schätzung.
5. **Vorschlag „vergleichbare Zeiträume“ = derselbe Topf derselben Wohnung in der vorigen
   Heizperiode, nur wenn sie gleich viele Tage hat.** Mietfuchs rechnet die Vorperiode dafür neu
   (`planSelf` über ihre Ablesungen, ohne deren Schätzungen). Eine Umrechnung auf eine andere Länge
   (etwa nach Gradtagen) wäre eine Festlegung ohne Quelle; dann gibt es keinen Vorschlag, der Vermieter
   kann den Wert selbst eintragen.
6. **Vorschlag „vergleichbare andere Räume“ = Verbrauch einer anderen Wohnung derselben Anlage im
   selben Zeitraum, je m² auf die Fläche der betroffenen Wohnung umgerechnet**, mit der Fläche des
   Topfs (beheizte Fläche nur beim Topf Heizung, wenn eingestellt). **Festlegung ohne Quelle:** § 9a
   sagt „vergleichbare andere Räume“, nicht wie verglichen wird; die Umrechnung je m² ist die
   Vergleichsgröße, die der Entwurf auch für den Durchschnitt nennt („Durchschnitt des Gebäudes je m²“).
   Welche Wohnung vergleichbar ist, wählt der Vermieter.
7. **Vorschlag „Durchschnittsverbrauch des Gebäudes“** (Vorgabe, Entwurf 8.7) = Summe des erfassten
   Verbrauchs aller übrigen Wohnungen der Anlage ohne Schätzung und ohne Fehler im Topf, geteilt durch
   ihre Fläche des Topfs, mal der Fläche der betroffenen Wohnung. Die „Nutzergruppe“ (§ 5 Abs. 7,
   Vorerfassung) rechnet Mietfuchs nicht (Entwurf 16).
8. **Der Wert ist änderbar.** Die Vorschläge belegen ihn vor; gespeichert werden Wert, Weg, Begründung
   und Bestätigung (Entwurf 5.6). Eine unbestätigte Schätzung wird verteilt, mit der Warnung
   `heating.estimate-unconfirmed` (Entwurf 8.7).
9. **Hinweistext zur Grenze bei ungleich großen Wohnungen** (Auftrag zu N5): Der Satz des Entwurfs
   („In kleinen Häusern überschreitet oft schon eine Wohnung 25 %; bei vier gleich großen Wohnungen sind
   es genau 25 %, also keine Überschreitung.“) wird so gefasst, dass er auch bei verschieden großen
   Wohnungen stimmt: Maßgeblich ist die Fläche, nicht die Zahl der Wohnungen; eine Wohnung mit mehr als
   der Grenze an Fläche überschreitet sie allein, mehrere kleinere können es zusammen. Der Dialog
   rechnet den tatsächlichen Anteil aus (N5). Die Zahl kommt aus dem Register.
10. **`25` kommt in `CODE_PATTERN` des Wächters** (`law-literals.test.ts`): Die Zahl steht ab dieser PR
    im Register; ohne den Eintrag fiele eine `25` im Code der Berechnung nicht auf.

---

### Task 1: Rechtsregister, Regel und Lexikon

**Files:**
- Modify: `shared/law/heizkostenv.ts`, `shared/law/params.ts`, `shared/law/rules.ts`, `shared/glossary.ts`
- Test: `server/test/law-schaetzung.test.ts` (neu); Modify: `server/test/law.test.ts`, `server/test/law-history.test.ts`, `server/test/law-literals.test.ts`, `server/test/glossary.test.ts`, `server/test/rules.test.ts` (nur falls dort eine vollständige Liste der Codes steht)

**Interfaces:**
- Consumes: `LawParam`, `law`, `createLawLog`, `onlyVersion`, `valueAt`, `LAW_AS_OF` (PR 1); in `heizkostenv.ts` `ENACTED`, `checked`.
- Produces:
  - `hkvEstimateThreshold: LawParam<number, 'periodStart'>` (`'hkv.estimate-threshold'`, 25, `describe: (v) => \`überschreitet ${v} %\``)
  - Regel `heating-estimate` in `RULES`
  - `TermId` + `'heatingEstimate'`

- [ ] **Step 1: Write the failing tests**

`server/test/law-schaetzung.test.ts`:

```ts
// Rechtsregister für die Schätzung nach § 9a HeizkostenV (Heizung PR 13, Entwurf 4.3, 8.7, 10.2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hkvEstimateThreshold } from '../../shared/law/heizkostenv.ts'
import { LAW_PARAMS } from '../../shared/law/params.ts'
import { createLawLog, law, onlyVersion } from '../../shared/law/register.ts'
import { RULES, ruleCoverage } from '../../shared/law/rules.ts'

test('§ 9a Abs. 2 HeizkostenV: Grenze 25 % der Fläche, „überschreitet“, nach dem Beginn des Zeitraums', () => {
  const log = createLawLog()
  assert.equal(law(hkvEstimateThreshold, { period: { from: '2025-01-01', to: '2025-12-31' } }, log), 25)
  assert.deepEqual(log.values.map((v) => [v.id, v.text]), [['hkv.estimate-threshold', 'überschreitet 25 %']])
  assert.equal(hkvEstimateThreshold.norm, '§ 9a Abs. 2 HeizkostenV')
  const v = onlyVersion(hkvEstimateThreshold)
  assert.equal(v.source.checked, 'checked')
  assert.equal(v.source.url, 'https://www.gesetze-im-internet.de/heizkostenv/__9a.html')
  assert.ok(LAW_PARAMS.some((p) => p.id === 'hkv.estimate-threshold'))
})

test('Regel heating-estimate: § 9a, die drei Wege und die Grenze aus dem Register', () => {
  const rule = RULES.find((r) => r.code === 'heating-estimate') ?? assert.fail('Regel fehlt')
  assert.match(rule.norm, /§ 9a HeizkostenV/)
  assert.match(rule.norm, /VIII ZR 373\/04/)
  assert.match(rule.summary, /Geräteausfalls oder aus einem anderen zwingenden Grund/)
  assert.match(rule.summary, /vergleichbaren Zeiträumen.*vergleichbarer anderer Räume.*Durchschnittsverbrauch des Gebäudes/s)
  assert.match(rule.summary, /mehr als 25 %/)
  assert.equal(ruleCoverage('heating-estimate', '2025-01-01', '2025-12-31'), 'full')
})
```

In `server/test/law-history.test.ts` am Ende von `SHIPPED` (hinter den Zeilen von PR 12):

```ts
  // 0.11.0 (Heizung PR 13, #99)
  'hkv.estimate-threshold|||25',
```

In `server/test/law.test.ts` im Test „Register: jede Konstante vom Typ LawParam in shared/law/ steht in
LAW_PARAMS“ das Objekt `modules` um `hkvEstimateThreshold` ergänzen und den Namen in den Import aus
`'../../shared/law/heizkostenv.ts'` aufnehmen.

In `server/test/law-literals.test.ts` die Zeile `CODE_PATTERN` ersetzen durch (Abweichung 10):

```ts
const CODE_PATTERN = /(?<![\w.])(15|25|50|70|19|16|2021|2024|2027)(?![\w.])/g
```

und im Kommentar darüber die Liste der Zahlen um `25` (`hkv.estimate-threshold`, Heizung PR 13)
ergänzen.

An `server/test/glossary.test.ts` anhängen:

```ts
test('Schätzung nach § 9a (Heizung PR 13): Beispiel mit Durchschnitt je m² und der Grenze, nachgerechnet', () => {
  const g = GLOSSARY.heatingEstimate
  // Übrige Wohnungen 28.000 kWh auf 140 m² = 200 kWh je m²; 60 m² × 200 = 12.000 kWh.
  assert.equal(28000 / 140, 200)
  assert.equal(60 * 200, 12000)
  assert.match(g.example, /28\.000 kWh auf 140 m².*200 kWh je m².*12\.000 kWh/s)
  // 60 von 200 m² = 30 %, mehr als die Grenze: nur nach Fläche.
  assert.match(g.example, /60 von 200 m², also 30 %.*mehr als 25 %.*nur nach der Fläche/s)
  assert.match(g.needed, /vier gleich großen Wohnungen.*genau 25 %.*keine Überschreitung/s)
  assert.match(g.needed, /verschieden groß.*Fläche/s)
  assert.match(g.norm, /§ 9a HeizkostenV/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/law-schaetzung.test.ts test/law-history.test.ts test/law.test.ts test/glossary.test.ts`
Expected: FAIL; `law-schaetzung.test.ts` mit `does not provide an export named 'hkvEstimateThreshold'`,
`law-history.test.ts` mit „ausgelieferte Fassung geändert oder entfernt: hkv.estimate-threshold…“,
`glossary.test.ts` mit `Cannot read properties of undefined (reading 'example')`.

- [ ] **Step 3: Parameter (`shared/law/heizkostenv.ts`)**

Ans Dateiende:

```ts
// § 9a Abs. 2 HeizkostenV (Heizung PR 13): Überschreitet die von der Schätzung betroffene Wohn- oder
// Nutzfläche 25 vom Hundert der für die Kostenverteilung maßgeblichen gesamten Fläche, sind die
// Kosten ausschließlich nach der Fläche zu verteilen. „Überschreitet“: genau 25 % ist keine
// Überschreitung (R-A22). Geprüft wird je Topf (Entwurf 15.1 Nr. 6).
export const hkvEstimateThreshold: LawParam<number, 'periodStart'> = {
  id: 'hkv.estimate-threshold',
  title: 'Grenze der geschätzten Fläche',
  norm: '§ 9a Abs. 2 HeizkostenV',
  timing: 'periodStart',
  versions: [{
    value: 25,
    source: checked('§ 9a Abs. 2 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__9a.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `überschreitet ${v} %`,
}
```

- [ ] **Step 4: In die Liste (`shared/law/params.ts`)**

Den Import aus `'./heizkostenv.ts'` um `hkvEstimateThreshold` ergänzen und in `LAW_PARAMS` alphabetisch
nach Kennung einreihen (hinter `hkvDegreeDays`, vor `hkvHeatPumpCapture`; haben PR 3 bis PR 12 anders
eingereiht, gilt deren Reihenfolge).

- [ ] **Step 5: Regel (`shared/law/rules.ts`)**

`hkvEstimateThreshold` in den Import aus `'./heizkostenv.ts'` aufnehmen; hinter den Konstanten von PR 10:

```ts
const estimateThreshold = valueAt(hkvEstimateThreshold, LAW_AS_OF)
```

Ans Ende von `RULES` (vor `]`):

```ts
  // Heizung PR 13 (#99, Entwurf 10.2): Schätzung bei Geräteausfall. Wortlaut gelesen am 05.10.2026 auf
  // gesetze-im-internet.de.
  {
    code: 'heating-estimate',
    title: 'Schätzung bei Geräteausfall',
    norm: '§ 9a HeizkostenV; BGH, Urteil vom 16.11.2005, VIII ZR 373/04',
    summary:
      'Kann der Verbrauch eines Nutzers wegen Geräteausfalls oder aus einem anderen zwingenden Grund nicht ordnungsgemäß erfasst werden, ermittelt ihn der Gebäudeeigentümer: aus dem Verbrauch der betroffenen Räume in vergleichbaren Zeiträumen, aus dem Verbrauch vergleichbarer anderer Räume im selben Abrechnungszeitraum oder aus dem Durchschnittsverbrauch des Gebäudes oder der Nutzergruppe. ' +
      'Zwingend ist ein Grund erst, wenn sich der Fehler nicht mehr beheben lässt. ' +
      `Betrifft die Schätzung mehr als ${estimateThreshold} % der für die Verteilung maßgeblichen Fläche, werden die Kosten ausschließlich nach der Fläche verteilt.`,
  },
```

(„mehr als“ gibt „überschreitet“ wieder; der Test prüft genau diesen Wortlaut.)

- [ ] **Step 6: Lexikon (`shared/glossary.ts`)**

`hkvEstimateThreshold` in den Import aus `'./law/heizkostenv.ts'` aufnehmen; bei den Konstanten oben:

```ts
const ESTIMATE_THRESHOLD = valueAt(hkvEstimateThreshold, LAW_AS_OF)
```

Hinter dem Eintrag `heatMeter` (PR 10):

```ts
  // Heizung PR 13 (#99, Entwurf 10.3): Schätzung nach § 9a. Die Zahlen des Beispiels sind Beispielzahlen.
  heatingEstimate: {
    title: 'Schätzung bei Geräteausfall',
    short: 'Fällt ein Zähler oder Heizkostenverteiler aus oder lässt sich ein Wert aus einem anderen zwingenden Grund nicht mehr ablesen, wird der Verbrauch dieser Wohnung geschätzt: aus ihrem Verbrauch in einem vergleichbaren Zeitraum, aus dem Verbrauch einer vergleichbaren Wohnung oder aus dem Durchschnitt des Hauses.',
    example:
      'Der Wärmezähler einer Wohnung mit 60 m² fällt aus. Die übrigen Wohnungen verbrauchen zusammen 28.000 kWh auf 140 m², das sind 200 kWh je m²: geschätzt werden 60 × 200 = 12.000 kWh. ' +
      `Die Wohnung hat 60 von 200 m², also 30 % der Fläche. Das ist mehr als ${ESTIMATE_THRESHOLD} %, und die Heizkosten werden deshalb in diesem Jahr nur nach der Fläche verteilt.`,
    norm: '§ 9a HeizkostenV',
    needed:
      'Nur, wenn sich ein Wert nicht mehr ablesen lässt. Ist ein Wert nur einige Tage neben dem Stichtag abgelesen, gilt er, wie er ist; das ist kein Grund zu schätzen. ' +
      `Maßgeblich für die Grenze von ${ESTIMATE_THRESHOLD} % ist die Fläche der geschätzten Wohnungen, nicht ihre Zahl: Bei vier gleich großen Wohnungen hat jede genau ${ESTIMATE_THRESHOLD} %, das ist keine Überschreitung. ` +
      `Sind die Wohnungen verschieden groß, zählt die Fläche: Eine Wohnung mit mehr als ${ESTIMATE_THRESHOLD} % der Fläche überschreitet die Grenze allein, und mehrere kleinere können es zusammen. Geprüft wird für Heizung und Warmwasser getrennt.`,
  },
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix server test -- test/law-schaetzung.test.ts test/law-history.test.ts test/law.test.ts test/law-literals.test.ts test/glossary.test.ts test/rules.test.ts test/law-wording.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS. Meldet `law-literals.test.ts` eine `25` im Code einer Datei aus `CODE_FILES`, ist das
ein Befund: Ist es die Grenze des § 9a, kommt sie aus dem Register; ist es keine Rechtszahl, kommt sie
mit Grund in `ALLOWED`.

- [ ] **Step 8: Commit**

```bash
git add shared/law shared/glossary.ts server/test/law-schaetzung.test.ts server/test/law-history.test.ts server/test/law.test.ts server/test/law-literals.test.ts server/test/glossary.test.ts server/test/rules.test.ts
git commit -m "Schätzung nach § 9a: Grenze der geschätzten Fläche im Rechtsregister, Regel und Lexikon

Refs #99"
```

---

### Task 2: Datenmodell und Migration 0032

**Files:**
- Modify: `shared/types.ts`, `shared/heating.ts`, `server/src/db/schema.ts`, `server/src/db/read.ts`, `server/src/snapshot.ts`, `server/src/db/repository.ts`
- Create (erzeugt): `server/drizzle/0032_schaetzung.sql`, `server/drizzle/meta/0032_snapshot.json`; Modify (erzeugt): `server/drizzle/meta/_journal.json`
- Test: `server/test/schema.test.ts`, `server/test/migrations.test.ts`, `server/test/db-schaetzung.test.ts` (neu)

**Interfaces:**
- Consumes: `heatingPeriods`, `heatingPlants`, `units`, `exactly`, `oneOf`, `notNegative` (PR 4); `PeriodKey`; `SelfPot`, `SelfPotView`, `SelfUserView`, `SelfHeatingStatement` (PR 10).
- Produces:
  - `shared/types.ts`: `type EstimatePart = 'heat' | 'water'`; `type EstimateMethod = 'previousPeriod' | 'comparableUnit' | 'buildingAverage'`; `type HeatingEstimate = { plantId: string; period: PeriodKey; unitId: string; part: EstimatePart; value: number; method: EstimateMethod; reason: string; confirmed: boolean }`; `type EstimateProposal = { method: EstimateMethod; value: number | null; perM2: number | null; why: 'ok' | 'noPrevious' | 'lengthDiffers' | 'noMeasured' }`; `type ComparableUnit = { unitId: string; unitName: string; perM2: number; value: number }`; `type SelfEstimateView = { unitId: string; unitName: string; part: EstimatePart; value: number; method: EstimateMethod; reason: string; confirmed: boolean; users: number }`; `type SelfEstimateOption = { unitId: string; unitName: string; part: EstimatePart; areaM2: number; why: 'noReading' | 'replacement' | 'negative' | null; boundary: string | null; estimated: boolean; proposals: EstimateProposal[]; comparable: ComparableUnit[] }`; `SelfPotView.overThreshold: boolean`, `SelfPotView.estimatedAreaM2: number`; `SelfUserView.heatingEstimated?: boolean`, `SelfUserView.waterEstimated?: boolean`; `SelfHeatingStatement.estimates: SelfEstimateView[]`, `SelfHeatingStatement.estimateOptions: SelfEstimateOption[]`, `SelfHeatingStatement.threshold: number | null`
  - `shared/heating.ts`: `POT_OF_PART: Record<EstimatePart, SelfPot>`, `PART_OF_POT: Record<SelfPot, EstimatePart>`
  - schema.ts: `ESTIMATE_PARTS`, `ESTIMATE_METHODS`, `heatingEstimates`
  - read.ts: `readHeatingEstimates(db: Database): Promise<HeatingEstimate[]>`, `Stock.heatingEstimates`
  - snapshot.ts: `Snapshot.heatingEstimates?: HeatingEstimate[]`, `SnapshotSource.heatingEstimates?: HeatingEstimate[]`
  - repository.ts: `crossPropertyViolations` findet Schätzungen an Wohnungen fremder Objekte

- [ ] **Step 1: Write the failing tests**

(a) `server/test/schema.test.ts`: den Typimport aus `'../../shared/types.ts'` um `HeatingEstimate`
ergänzen; hinter den Zeilen von PR 12:

```ts
// --- Schätzung nach § 9a (Heizung PR 13) ---
type _Estimates = Assert<Matches<typeof schema.heatingEstimates.$inferSelect, Omit<HeatingEstimate, 'plantId' | 'period'> & { heatingPeriodId: string }>>
```

Im Test „Migration lässt sich anwenden und legt alle Tabellen an“ `'heating_estimates',` alphabetisch
einreihen (vor `'heating_periods'`). Ans Ende anhängen:

```ts
// ---------- Schätzung nach § 9a (Heizung PR 13) ----------

test('Schätzung: Wert ab 0, Begründung Pflicht, bekannter Weg und Teil, eine Zeile je Wohnung und Topf, fällt mit der Wohnung', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    connection.exec("INSERT INTO heating_plants (id, property_id, energy) VALUES ('hp1', 'objekt-1', 'gas')")
    connection.exec("INSERT INTO heating_periods (id, plant_id, period) VALUES ('h1', 'hp1', '2025-01')")
    const insert = (values: string) => rejects(connection, `INSERT INTO heating_estimates (heating_period_id, unit_id, part, value, method, reason, confirmed) VALUES (${values})`)
    assert.equal(insert("'h1', 'u1', 'heat', 12000, 'buildingAverage', 'Zähler defekt', 1"), null)
    assert.ok(insert("'h1', 'u1', 'heat', 11000, 'buildingAverage', 'Zähler defekt', 1"), 'dieselbe Wohnung und derselbe Topf zweimal')
    assert.ok(insert("'h1', 'u1', 'water', -1, 'buildingAverage', 'Zähler defekt', 0"), 'negativer Wert')
    assert.ok(insert("'h1', 'u1', 'water', 30, 'buildingAverage', '  ', 0"), 'ohne Begründung')
    assert.ok(insert("'h1', 'u1', 'water', 30, 'schaetzen', 'Zähler defekt', 0"), 'unbekannter Weg')
    assert.ok(insert("'h1', 'u1', 'heating', 30, 'buildingAverage', 'Zähler defekt', 0"), 'unbekannter Teil')
    assert.deepEqual(connection.rows('SELECT confirmed FROM heating_estimates'), [[1]])
    connection.exec("DELETE FROM units WHERE id = 'u1'")
    assert.equal(Number(connection.rows('SELECT count(*) FROM heating_estimates')[0]?.[0]), 0)
  } finally {
    cleanup()
  }
})
```

(`einWohnung` legt die Wohnung `u1` im Objekt `objekt-1` an; so steht es in schema.test.ts seit PR 10.)

(b) `server/test/db-schaetzung.test.ts` (neu):

```ts
// Schätzungen nach § 9a in der Datenbank (Heizung PR 13): lesen, Schnappschuss, Objektgrenze.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity, createProperty, crossPropertyViolations } from '../src/db/repository.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { ensureHeatingPeriod } from '../src/db/heatingPeriodContext.ts'
import { heatingEstimates } from '../src/db/schema.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-schaetzung-'))
  const opened = await openDatabase({ dataDir })
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const status = (code: number, text: RegExp) => (e: unknown) =>
  e instanceof Error && 'status' in e && (e as { status: unknown }).status === code && text.test(e.message)

async function haus(opened: Opened): Promise<void> {
  await opened.write(async (db) => {
    for (const [u, area] of [['a', 60], ['b', 80], ['c', 60]] as const) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: true })
    }
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
  })
}
async function schaetzungDirekt(opened: Opened, unitId: string): Promise<void> {
  await opened.write(async (db) => {
    const heatingPeriodId = await ensureHeatingPeriod(db, 'hp', periodKey('2025-01'))
    await db.insert(heatingEstimates).values({ heatingPeriodId, unitId, part: 'heat', value: 12000, method: 'buildingAverage', reason: 'Zähler defekt', confirmed: true })
  })
}

test('Schätzungen werden mit Anlage und Heizperiode gelesen und stehen im Schnappschuss des Objekts', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await schaetzungDirekt(opened, 'c')
    const stock = await opened.read(readStock)
    assert.deepEqual(stock.heatingEstimates, [
      { plantId: 'hp', period: '2025-01', unitId: 'c', part: 'heat', value: 12000, method: 'buildingAverage', reason: 'Zähler defekt', confirmed: true },
    ])
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    assert.deepEqual(snapshotFor(stock, 'objekt-1', p).heatingEstimates?.map((e) => e.unitId), ['c'])
  })
})

test('Ohne Schätzung bleibt der Schnappschuss Feld für Feld, wie er war', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    assert.equal('heatingEstimates' in snapshotFor(await opened.read(readStock), 'objekt-1', p), false)
  })
})

test('Wiederherstellen: eine Schätzung an einer Wohnung eines anderen Objekts wird gefunden', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write(async (db) => {
      await createProperty(db, 'objekt-2', { name: 'Nebenhaus' })
      await createEntity(db, 'units', 'n', { propertyId: 'objekt-2', name: 'N', areaM2: 40, participates: true })
    })
    await schaetzungDirekt(opened, 'n')
    const befunde = await opened.read(crossPropertyViolations)
    assert.ok(befunde.some((b) => /Schätzung.*„N“.*anderen Objekts/.test(b)), befunde.join('\n'))
  })
})

void status
```

(`status` braucht Task 4; die Zeile `void status` hält den Übersetzer bis dahin ruhig und fällt in Task 4
weg.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run typecheck`
Expected: FAIL mit `Property 'heatingEstimates' does not exist` in schema.test.ts und
db-schaetzung.test.ts.

- [ ] **Step 3: Typen (`shared/types.ts`, `shared/heating.ts`)**

`shared/types.ts`, ans Dateiende:

```ts
// ---------- Schätzung nach § 9a HeizkostenV (Heizung PR 13, Entwurf 5.6, 8.7) ----------

// Topf der Schätzung in der Schreibweise der Tabelle (Entwurf 5.6); die Rechnung nennt die Töpfe
// `heating` und `water` (shared/heating.ts ordnet zu).
export type EstimatePart = 'heat' | 'water'
// Die drei Wege des § 9a Abs. 1: Verbrauch der betroffenen Räume in vergleichbaren Zeiträumen,
// vergleichbarer anderer Räume im selben Zeitraum, Durchschnittsverbrauch des Gebäudes.
export type EstimateMethod = 'previousPeriod' | 'comparableUnit' | 'buildingAverage'
// Eine Schätzung: der Verbrauch einer Wohnung in einem Topf für die ganze Heizperiode, in der Einheit
// der Erfassung (kWh, m³ oder Einheiten). Begründung ist Pflicht; `confirmed` heißt, der Vermieter hat
// bestätigt, dass sich der Wert nicht mehr ablesen ließ.
export type HeatingEstimate = {
  plantId: string
  period: PeriodKey
  unitId: string
  part: EstimatePart
  value: number
  method: EstimateMethod
  reason: string
  confirmed: boolean
}
// Ein Vorschlag je Weg. `value` null mit Grund: keine Vorperiode, andere Länge, kein erfasster
// Verbrauch der übrigen Wohnungen.
export type EstimateProposal = { method: EstimateMethod; value: number | null; perM2: number | null; why: 'ok' | 'noPrevious' | 'lengthDiffers' | 'noMeasured' }
export type ComparableUnit = { unitId: string; unitName: string; perM2: number; value: number }
// Im Ausweis (Entwurf 8.8: „Schätzungen mit Methode“). `users`: Zahl der Nutzer der Wohnung in der
// Heizperiode; mehr als einer heißt, der Wert ist wie nach § 9b Abs. 3 geteilt (Abweichung 2 des Plans).
export type SelfEstimateView = { unitId: string; unitName: string; part: EstimatePart; value: number; method: EstimateMethod; reason: string; confirmed: boolean; users: number }
// Für den Dialog der Seite Heizkosten: je Wohnung und Topf mit Gerät, was fehlt (`why`, null heißt:
// nichts, eine Schätzung wäre die Markierung „unbrauchbar“), die Fläche des Topfs und die Vorschläge.
export type SelfEstimateOption = {
  unitId: string
  unitName: string
  part: EstimatePart
  areaM2: number
  why: 'noReading' | 'replacement' | 'negative' | null
  boundary: string | null
  estimated: boolean
  proposals: EstimateProposal[]
  comparable: ComparableUnit[]
}
```

In `SelfPotView` (PR 10) als letzte Felder:

```ts
  // Schätzung (Heizung PR 13): geschätzte Fläche des Topfs und ob sie die Grenze des § 9a Abs. 2
  // überschreitet; dann ist `consumptionPct` 0 und der Topf nur nach Fläche verteilt.
  overThreshold: boolean
  estimatedAreaM2: number
```

In `SelfUserView` (PR 10) als letzte Felder:

```ts
  // Der Verbrauch dieses Nutzers beruht auf einer Schätzung nach § 9a (Heizung PR 13).
  heatingEstimated?: boolean
  waterEstimated?: boolean
```

In `SelfHeatingStatement` (PR 10) als letzte Felder:

```ts
  // Schätzungen nach § 9a (Heizung PR 13) und die Grenze des § 9a Abs. 2 (null, wenn nicht gefragt).
  estimates: SelfEstimateView[]
  estimateOptions: SelfEstimateOption[]
  threshold: number | null
```

`shared/heating.ts`, den Typimport um `EstimatePart, SelfPot` ergänzen und ans Dateiende:

```ts
// Die Töpfe der Schätzung (Heizung PR 13): `heat`/`water` in der Tabelle (Entwurf 5.6),
// `heating`/`water` in der Rechnung (server/src/heating.ts).
export const POT_OF_PART: Record<EstimatePart, SelfPot> = { heat: 'heating', water: 'water' }
export const PART_OF_POT: Record<SelfPot, EstimatePart> = { heating: 'heat', water: 'water' }
```

- [ ] **Step 4: Schema (`server/src/db/schema.ts`)**

Den Typimport aus `'../../../shared/types.ts'` um `EstimateMethod, EstimatePart` ergänzen. Hinter der
Tabelle `heatingServiceValues` (PR 12):

```ts
// ---------- Schätzung nach § 9a HeizkostenV (Heizung PR 13, Entwurf 5.6) ----------

export const ESTIMATE_PARTS = exactly<EstimatePart>()(['heat', 'water'] as const)
export const ESTIMATE_METHODS = exactly<EstimateMethod>()(['previousPeriod', 'comparableUnit', 'buildingAverage'] as const)

// Eine Zeile je Heizperiode, Wohnung und Topf: der geschätzte Verbrauch, der Weg des § 9a Abs. 1 und
// die Begründung (Pflicht). Fällt mit der Heizperiode und mit der Wohnung.
export const heatingEstimates = sqliteTable(
  'heating_estimates',
  {
    heatingPeriodId: text('heating_period_id')
      .notNull()
      .references(() => heatingPeriods.id, { onDelete: 'cascade' }),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    part: text('part', { enum: ESTIMATE_PARTS }).notNull(),
    value: real('value').notNull(),
    method: text('method', { enum: ESTIMATE_METHODS }).notNull(),
    reason: text('reason').notNull(),
    confirmed: integer('confirmed', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.heatingPeriodId, t.unitId, t.part] }),
    oneOf('heating_estimates_part_known', 'part', ESTIMATE_PARTS),
    oneOf('heating_estimates_method_known', 'method', ESTIMATE_METHODS),
    notNegative('heating_estimates_value_not_negative', 'value'),
    check('heating_estimates_reason_given', sql.raw(`length(trim("reason")) > 0`)),
  ],
)
```

Run: `npm --prefix server run db:generate -- --name schaetzung`

Expected: `server/drizzle/0032_schaetzung.sql` mit genau einem `CREATE TABLE \`heating_estimates\`` samt
Primärschlüssel, beiden Fremdschlüsseln (`ON DELETE cascade`) und den vier Bedingungen. **Kein**
`__new_`, kein `ALTER TABLE`. Heißt die Datei nicht `0032_…`, ist ein Schritt von PR 11 oder PR 12 nicht
auf diesem Zweig: Datei, Journal-Eintrag und Momentaufnahme löschen, Zweig prüfen, neu erzeugen.

- [ ] **Step 5: Marke eintragen**

Run:

```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag.includes('schaetzung')) console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```

In `server/test/migrations.test.ts` in `VEROEFFENTLICHT` hinter `'0031_hkv_bedingungen'` (PR 12) die
ausgegebene Zeile einfügen, darüber:

```ts
  // Heizung PR 13. Wird ein Schritt von PR 12 vor dem Push neu erzeugt, wird dieser Schritt neu erzeugt
  // und die Marke hier ersetzt.
```

- [ ] **Step 6: Lesen und Schnappschuss (`server/src/db/read.ts`, `server/src/snapshot.ts`)**

`read.ts`: `heatingEstimates` in den Import aus `'./schema.ts'`, `HeatingEstimate` in den Typimport.
Hinter `readHeatingServiceValues` (PR 12):

```ts
// Schätzungen nach § 9a (Heizung PR 13), mit Anlage und Heizperiode aus der Zeile der Heizperiode.
export async function readHeatingEstimates(db: Database): Promise<HeatingEstimate[]> {
  const rows = await db
    .select({
      plantId: heatingPeriods.plantId,
      period: heatingPeriods.period,
      unitId: heatingEstimates.unitId,
      part: heatingEstimates.part,
      value: heatingEstimates.value,
      method: heatingEstimates.method,
      reason: heatingEstimates.reason,
      confirmed: heatingEstimates.confirmed,
    })
    .from(heatingEstimates)
    .innerJoin(heatingPeriods, eq(heatingEstimates.heatingPeriodId, heatingPeriods.id))
    .orderBy(heatingPeriods.plantId, heatingPeriods.period, heatingEstimates.unitId, heatingEstimates.part)
  return rows.map((r) => ({ ...r }))
}
```

`Stock` bekommt `heatingEstimates: HeatingEstimate[]`, `readStock` die Zeile
`    heatingEstimates: await readHeatingEstimates(db),` hinter `heatingServiceValues` (PR 12). (`eq` und
`heatingPeriods` sind in read.ts seit PR 6 importiert; sonst ergänzen.)

`snapshot.ts`: `HeatingEstimate` in den Typimport. `Snapshot` bekommt hinter `heatingServiceValues`
(PR 12):

```ts
  // Schätzungen nach § 9a (Heizung PR 13): Wohnungen des Objekts.
  heatingEstimates?: HeatingEstimate[]
```

`SnapshotSource` bekommt `heatingEstimates?: HeatingEstimate[]`. In `snapshotFor` vor dem `return`:

```ts
  const estimates = (source.heatingEstimates ?? []).filter((e) => units.some((u) => u.id === e.unitId))
```

und im zurückgegebenen Objekt hinter den Feldern von PR 12:

```ts
    // Nur, wenn es Schätzungen gibt: Ein Schnappschuss ohne sie bleibt Feld für Feld, wie er war.
    ...(estimates.length > 0 ? { heatingEstimates: estimates } : {}),
```

(`units` ist die auf das Objekt eingegrenzte Liste der Wohnungen, wie PR 10 sie für `interimGaps`
benutzt; heißt sie anders, gilt deren Name. Baut `heatingSnapshotFor` (PR 5) sein Ergebnis nicht aus
`snapshotFor`, bekommt es dieselben zwei Zeilen.)

- [ ] **Step 7: Objektgrenze (`server/src/db/repository.ts`)**

`heatingEstimates` in den Import aus `'./schema.ts'`. In `crossPropertyViolations` vor `return befunde`
(hinter dem Block von PR 12):

```ts
  // Schätzungen nach § 9a gehören zu einer Wohnung im Objekt ihrer Heizanlage (Heizung PR 13).
  const schaetzungen = await db
    .select({ unitName: units.name })
    .from(heatingEstimates)
    .innerJoin(heatingPeriods, eq(heatingEstimates.heatingPeriodId, heatingPeriods.id))
    .innerJoin(heatingPlants, eq(heatingPeriods.plantId, heatingPlants.id))
    .innerJoin(units, eq(heatingEstimates.unitId, units.id))
    .where(ne(heatingPlants.propertyId, units.propertyId))
  for (const s of schaetzungen) befunde.push(`Eine Schätzung nach § 9a gehört zur Wohnung „${s.unitName}“ eines anderen Objekts als ihre Heizanlage.`)
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix server test -- test/schema.test.ts test/migrations.test.ts test/db-schaetzung.test.ts test/db-golden.test.ts test/db-changeover.test.ts test/db-backup.test.ts && npm run typecheck`
Expected: PASS. Der Übersetzer verlangt die neuen Pflichtfelder von `SelfPotView` und
`SelfHeatingStatement` in `selfStatementOf` (calc.ts) und in Testdaten des Clients; bis Task 5 und 6
stehen dort `overThreshold: false, estimatedAreaM2: 0` bzw. `estimates: [], estimateOptions: [],
threshold: null`, mit dem Kommentar „Heizung PR 13, gefüllt in Task 5“.

- [ ] **Step 9: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts shared/heating.ts server/src/db server/drizzle server/src/snapshot.ts server/src/calc.ts client/src server/test/schema.test.ts server/test/migrations.test.ts server/test/db-schaetzung.test.ts
git commit -m "Schätzung nach § 9a: Tabelle heating_estimates, lesen, Schnappschuss, Objektgrenze

Ein erzeugter Schritt 0032_schaetzung; keine bestehende Tabelle ändert sich.

Refs #99"
```

---

### Task 3: Reine Rechnung: Schätzung im Plan, Grenze je Topf, Vorschläge (`server/src/heating.ts`)

**Files:**
- Modify: `server/src/heating.ts`
- Test: `server/test/heating.test.ts`

**Interfaces:**
- Consumes (Task 2; PR 10): `SelfInput`, `SelfPlan`, `SelfUnitPlan`, `planSelf`, `weightsOf`, `POT_METER`; `CaptureMethod`, `EstimatePart`, `EstimateProposal`, `ComparableUnit`, `MeterType`, `SelfPot`.
- Produces (`server/src/heating.ts`):
  - `SelfInput.estimates?: ReadonlyMap<string, number>` (Schlüssel `` `${unitId}:${pot}` ``), `SelfInput.estimateThreshold?: () => number`
  - `SelfPlan['totals'][pot]` + `estimatedArea: number`, `overThreshold: boolean`
  - `SelfUnitPlan` + `estimated: Record<SelfPot, boolean>`, `measured: Record<SelfPot, boolean>`
  - `estimateKey(unitId: string, pot: SelfPot): string`
  - `estimateProposals(plan: SelfPlan, prev: SelfPlan | null, sameLength: boolean, unitId: string, pot: SelfPot): { proposals: EstimateProposal[]; comparable: ComparableUnit[] }`
  - `estimateDeviceType(capture: CaptureMethod | null, part: EstimatePart): MeterType | null`
  - `weightsOf` setzt bei `overThreshold` den Anteil nach Verbrauch dieses Topfs auf 0

- [ ] **Step 1: Write the failing tests**

Den Import aus `'../src/heating.ts'` in `server/test/heating.test.ts` um `estimateDeviceType,
estimateKey, estimateProposals` ergänzen. Anhängen:

```ts
// ---------- Schätzung nach § 9a (Heizung PR 13, Entwurf 8.7, 12.2) ----------

// Vier Wohnungen mit Wärmezählern, ohne Warmwasser. `end` je Wohnung der Stand am 31.12.2025; null heißt:
// der Stand fehlt (Gerät ausgefallen).
function vier(areas: readonly number[], end: readonly (number | null)[], over: Partial<SelfInput> = {}): SelfInput {
  const ids = areas.map((_, i) => i)
  return input({
    hotWater: 'none',
    units: ids.map((i) => ({ id: `d${i}`, name: `D${i}`, areaM2: areas[i] ?? 0, heatedAreaM2: null, role: 'rented' as const })),
    tenancies: ids.map((i) => ({ id: `T${i}`, unitId: `d${i}`, tenantName: `Mieter ${i}`, start: '2020-01-01', end: null })),
    meters: ids.map((i) => ({ id: `w${i}`, name: `Wärme D${i}`, unitId: `d${i}`, type: 'waerme' as const })),
    readings: ids.flatMap((i) => {
      const e = end[i]
      return [r(`w${i}`, '2024-12-31', 0), ...(e === null || e === undefined ? [] : [r(`w${i}`, '2025-12-31', e)])]
    }),
    ...over,
  })
}
const est = (entries: [string, number][]) => new Map(entries)
const withLimit = (calls?: { n: number }) => () => {
  if (calls) calls.n += 1
  return onlyVersion(hkvEstimateThreshold).value
}

test('§ 9a: ohne Schätzung ist ein fehlender Endstand ein Fehler, mit Schätzung tritt sie an die Stelle', () => {
  const ohne = planSelf(vier([40, 40, 40, 80], [null, 5000, 7000, 14000]))
  assert.deepEqual(ohne.problems.map((p) => (p.kind === 'missing' ? [p.unitId, p.reason] : p.kind)), [['d0', 'noReading']])
  const mit = planSelf(vier([40, 40, 40, 80], [null, 5000, 7000, 14000], { estimates: est([[estimateKey('d0', 'heating'), 6500]]), estimateThreshold: withLimit() }))
  assert.deepEqual(mit.problems, [])
  assert.equal(userOf(mit, 'T0').pots.heating.value, 6500)
  assert.equal(mit.totals.heating.consumption, 32500)
  assert.deepEqual([mit.totals.heating.estimatedArea, mit.totals.heating.overThreshold], [40, false])
  const unit = mit.units.find((u) => u.unit.id === 'd0') ?? assert.fail('d0')
  assert.deepEqual([unit.estimated.heating, unit.measured.heating], [true, false])
  // Keine Ablesung der geschätzten Wohnung erscheint im Ausweis.
  assert.deepEqual(unit.readings, [])
})

test('12.2: Schätzung für 20 % der Fläche → nach Verbrauch; für 40 % → nur nach Fläche (§ 9a Abs. 2)', () => {
  const klein = planSelf(vier([40, 40, 40, 80], [null, 5000, 7000, 14000], { estimates: est([[estimateKey('d0', 'heating'), 6500]]), estimateThreshold: withLimit() }))
  near(weightsOf(klein, { heating: 70, water: 70 }, null).get('T0')?.heating ?? 0, 0.3 * (40 / 200) + 0.7 * (6500 / 32500), 'T0 nach Verbrauch')
  const gross = planSelf(vier([40, 40, 40, 80], [6000, 5000, 7000, null], { estimates: est([[estimateKey('d3', 'heating'), 12000]]), estimateThreshold: withLimit() }))
  assert.deepEqual([gross.totals.heating.estimatedArea, gross.totals.heating.overThreshold], [80, true])
  const w = weightsOf(gross, { heating: 70, water: 70 }, null)
  near(w.get('T3')?.heating ?? 0, 80 / 200, 'T3 nur nach Fläche')
  near(w.get('T0')?.heating ?? 0, 40 / 200, 'T0 nur nach Fläche')
})

test('R-A22: vier gleich große Wohnungen, eine geschätzt: genau 25 %, keine Überschreitung', () => {
  const plan = planSelf(vier([50, 50, 50, 50], [null, 5000, 7000, 6000], { estimates: est([[estimateKey('d0', 'heating'), 6000]]), estimateThreshold: withLimit() }))
  assert.deepEqual([plan.totals.heating.estimatedArea, plan.totals.heating.overThreshold], [50, false])
  // Zwei geschätzte Wohnungen: 50 %, überschritten.
  const zwei = planSelf(vier([50, 50, 50, 50], [null, null, 7000, 6000], { estimates: est([[estimateKey('d0', 'heating'), 6000], [estimateKey('d1', 'heating'), 6000]]), estimateThreshold: withLimit() }))
  assert.equal(zwei.totals.heating.overThreshold, true)
})

test('Die Grenze wird nur gefragt, wenn es eine Schätzung gibt (Rechtsstand)', () => {
  const calls = { n: 0 }
  planSelf(vier([50, 50, 50, 50], [6000, 5000, 7000, 6000], { estimateThreshold: withLimit(calls) }))
  assert.equal(calls.n, 0)
  planSelf(vier([50, 50, 50, 50], [null, 5000, 7000, 6000], { estimates: est([[estimateKey('d0', 'heating'), 6000]]), estimateThreshold: withLimit(calls) }))
  assert.equal(calls.n, 1)
})

test('Review Focus 4: je Topf getrennt; beheizte Fläche zählt nur beim Topf Heizung (15.1 Nr. 6)', () => {
  // C hat 60 m² Wohnfläche, aber nur 20 m² beheizte Fläche: Heizung 20 von 160 m² = 12,5 %; Warmwasser
  // 60 von 200 m² = 30 %.
  const units = UNITS.map((u) => (u.id === 'c' ? { ...u, heatedAreaM2: 20 } : u))
  const plan = planSelf(input({
    units, areaBasisHeat: 'heatedArea',
    readings: READINGS.filter((x) => !(x.date === '2025-12-31' && (x.meterId === 'wc' || x.meterId === 'xc'))),
    estimates: est([[estimateKey('c', 'heating'), 12000], [estimateKey('c', 'water'), 50]]),
    estimateThreshold: withLimit(),
  }))
  assert.deepEqual(plan.problems, [])
  assert.deepEqual([plan.totals.heating.estimatedArea, plan.totals.heating.area, plan.totals.heating.overThreshold], [20, 160, false])
  assert.deepEqual([plan.totals.water.estimatedArea, plan.totals.water.area, plan.totals.water.overThreshold], [60, 200, true])
})

test('Review Focus 2: Schätzung in einer Wohnung mit Mieterwechsel wird wie nach § 9b Abs. 3 geteilt', () => {
  const plan = planSelf(input({
    readings: READINGS.filter((x) => !(x.meterId === 'wc' && x.date === '2025-12-31')),
    estimates: est([[estimateKey('c', 'heating'), 12000]]),
    estimateThreshold: withLimit(),
  }))
  assert.deepEqual(plan.problems, [])
  // Heizung nach Gradtagen: C1 640 ‰ (Januar bis September), C2 360 ‰.
  near(userOf(plan, 'C1').pots.heating.value ?? -1, 12000 * 0.64, 'C1')
  near(userOf(plan, 'C2').pots.heating.value ?? -1, 12000 * 0.36, 'C2')
  assert.deepEqual([userOf(plan, 'C1').pots.heating.group, userOf(plan, 'C2').pots.heating.group], [true, true])
  // Warmwasser bleibt gemessen.
  assert.deepEqual([userOf(plan, 'C1').pots.water.value, userOf(plan, 'C2').pots.water.value], [38, 12])
  // 60 von 200 m² = 30 %: Topf Heizung nur nach Fläche.
  assert.equal(plan.totals.heating.overThreshold, true)
})

test('Vorschläge: Durchschnitt des Gebäudes je m², vergleichbare Wohnungen je m², Vorperiode nur bei gleicher Länge', () => {
  const ohneEnde = READINGS.filter((x) => !(x.meterId === 'wc' && x.date === '2025-12-31'))
  const plan = planSelf(input({ readings: ohneEnde }))
  const { proposals, comparable } = estimateProposals(plan, null, true, 'c', 'heating')
  // A 12.000 kWh auf 60 m², B 16.000 auf 80 m²: 28.000 / 140 = 200 kWh je m²; C 60 m² → 12.000.
  assert.deepEqual(proposals.find((p) => p.method === 'buildingAverage'), { method: 'buildingAverage', value: 12000, perM2: 200, why: 'ok' })
  assert.deepEqual(proposals.find((p) => p.method === 'previousPeriod'), { method: 'previousPeriod', value: null, perM2: null, why: 'noPrevious' })
  assert.deepEqual(comparable, [{ unitId: 'a', unitName: 'A', perM2: 200, value: 12000 }, { unitId: 'b', unitName: 'B', perM2: 200, value: 12000 }])
  assert.deepEqual(proposals.find((p) => p.method === 'comparableUnit'), { method: 'comparableUnit', value: null, perM2: null, why: 'ok' })
  // Vorperiode 2024 mit Ständen der Wohnung C am 31.12.2023 und 31.12.2024: 500 kWh.
  const vorher = planSelf(input({ h: { from: '2024-01-01', to: '2024-12-31' }, neighbors: { before: '2022-12-31', after: '2025-12-31' }, readings: [...READINGS, r('wc', '2023-12-31', 0)] }))
  assert.deepEqual(estimateProposals(plan, vorher, true, 'c', 'heating').proposals.find((p) => p.method === 'previousPeriod'), { method: 'previousPeriod', value: 500, perM2: null, why: 'ok' })
  assert.deepEqual(estimateProposals(plan, vorher, false, 'c', 'heating').proposals.find((p) => p.method === 'previousPeriod'), { method: 'previousPeriod', value: null, perM2: null, why: 'lengthDiffers' })
})

test('Gerät, das geschätzt werden kann: je Erfassung und Topf', () => {
  assert.equal(estimateDeviceType('heatMeter', 'heat'), 'waerme')
  assert.equal(estimateDeviceType(null, 'heat'), 'waerme')
  assert.equal(estimateDeviceType('hca', 'heat'), 'hkv')
  assert.equal(estimateDeviceType('serviceValues', 'heat'), null)
  assert.equal(estimateDeviceType('heatMeter', 'water'), 'warmwasser')
  assert.equal(estimateDeviceType('serviceValues', 'water'), null)
})
```

Den Import aus `'../../shared/law/heizkostenv.ts'` um `hkvEstimateThreshold` ergänzen und `SelfInput`
im Typimport aus `'../src/heating.ts'` führen (seit PR 10 da).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/heating.test.ts`
Expected: FAIL mit `does not provide an export named 'estimateDeviceType'`.

- [ ] **Step 3: Eingabe, Typen und Helfer (`server/src/heating.ts`)**

Den Typimport aus `'../../shared/types.ts'` um `CaptureMethod, ComparableUnit, EstimatePart,
EstimateProposal` ergänzen. In `SelfInput` als letzte Felder:

```ts
  // Geschätzte Verbräuche nach § 9a (Heizung PR 13) je `estimateKey(unitId, pot)`: der Verbrauch der
  // Wohnung in diesem Topf für die ganze Heizperiode. Er tritt an die Stelle der Ablesungen dieser
  // Wohnung in diesem Topf (§ 9a Abs. 1 Satz 2) und wird unter ihren Nutzern wie eine Gruppe nach
  // § 9b Abs. 3 geteilt (Abweichung 2 des Plans).
  estimates?: ReadonlyMap<string, number>
  // Die Grenze des § 9a Abs. 2 in Prozent; nur gefragt, wenn es eine Schätzung gibt, damit sie nur dann
  // im Rechtsstand der Abrechnung steht.
  estimateThreshold?: () => number
```

`SelfUnitPlan` bekommt als letzte Felder:

```ts
  // Schätzung (Heizung PR 13): geschätzt, und ob der Verbrauch ohne Fehler erfasst ist (für die
  // Vorschläge der Schätzung anderer Wohnungen).
  estimated: Record<SelfPot, boolean>
  measured: Record<SelfPot, boolean>
```

`SelfPlan['totals']` wird:

```ts
  // `estimatedArea`: Fläche des Topfs mit geschätztem Verbrauch; `overThreshold`: sie überschreitet die
  // Grenze des § 9a Abs. 2, der Topf wird ausschließlich nach Fläche verteilt (Heizung PR 13).
  totals: Record<SelfPot, { area: number; consumption: number; measured: boolean; estimatedArea: number; overThreshold: boolean }>
```

Vor `planSelf`:

```ts
// Schlüssel einer Schätzung in `SelfInput.estimates` (Heizung PR 13).
export const estimateKey = (unitId: string, pot: SelfPot): string => `${unitId}:${pot}`
```

- [ ] **Step 4: Der Plan mit Schätzungen (`server/src/heating.ts`, `planSelf`)**

Die Änderungen in `planSelf` (Fassung PR 10 Task 3; hat PR 12 die Geräte anders gebildet, gilt die
„Naht zu PR 12“ oben):

(a) Hinter `const metersOf = …`:

```ts
  // Schätzung (Heizung PR 13): Für eine geschätzte Wohnung in einem Topf zählt kein Gerät und keine
  // Ablesung; das gilt auch für vollständige Ablesungen (die Schätzung ist die Markierung „unbrauchbar“,
  // Abweichung 3 des Plans).
  const estimateOf = (unitId: string, p: SelfPot): number | undefined => input.estimates?.get(estimateKey(unitId, p))
  const liveMetersOf = (unitId: string, p: SelfPot) => (estimateOf(unitId, p) === undefined ? metersOf(unitId, p) : [])
```

(b) Die Erzeugung von `totals` ersetzen durch:

```ts
  const totals = Object.fromEntries(pots.map((p) => [p, {
    area: input.units.reduce((a, u) => a + areaOf(p, u), 0), consumption: 0, measured: false, estimatedArea: 0, overThreshold: false,
  }])) as SelfPlan['totals']
```

(c) In der Schleife `for (const p of pots) { for (const m of metersOf(unit.id, p)) { … } }`, die
`readingAt` füllt und `sameDay` prüft, `metersOf(unit.id, p)` durch `liveMetersOf(unit.id, p)`
ersetzen. Ebenso in der Bestimmung von `offAt`
(`const dates = pots.flatMap((p) => metersOf(unit.id, p)).map(…)`), in `bounds`
(`const all = pots.flatMap((p) => metersOf(unit.id, p)).map(…)`), in `missingPots` (beide Zweige) und in
`readings` (`pots.flatMap((p) => metersOf(unit.id, p).flatMap(…))`).

(d) In der Schleife `for (const p of pots) { const meters = metersOf(unit.id, p) … }` als erste
Anweisungen des Rumpfs, vor `const meters = …`:

```ts
      const estimated = estimateOf(unit.id, p)
      if (estimated !== undefined) {
        // § 9a Abs. 1 Satz 2: der geschätzte Verbrauch anstelle des erfassten. Mehrere Nutzer teilen ihn
        // wie eine Gruppe nach § 9b Abs. 3 (Abweichung 2 des Plans).
        consumption[p] += estimated
        const splitSum = users.reduce((a, u) => a + splitOf(p, u), 0)
        for (const u of users) {
          u.pots[p].value = users.length === 1 ? estimated : splitSum > 0 ? (estimated * splitOf(p, u)) / splitSum : 0
          u.pots[p].group = users.length > 1
        }
        continue
      }
```

(e) Die Rückgabe der Wohnung `return { unit, heatArea: heatAreaOf(unit), users, boundaries: bounds, readings, consumption }`
ersetzen durch:

```ts
    const estimatedPots = { heating: estimateOf(unit.id, 'heating') !== undefined, water: estimateOf(unit.id, 'water') !== undefined }
    const measuredPots = Object.fromEntries((['heating', 'water'] as const).map((p) => [p,
      pots.includes(p) && !estimatedPots[p] && metersOf(unit.id, p).length > 0 &&
      !problems.some((x) => x.kind === 'missing' && x.unitId === unit.id && x.pot === p),
    ])) as Record<SelfPot, boolean>
    return { unit, heatArea: heatAreaOf(unit), users, boundaries: bounds, readings, consumption, estimated: estimatedPots, measured: measuredPots }
```

(f) In der Schleife „Summe des Verbrauchs je Topf, dann die Bruchteile“ hinter
`totals[p].measured = potHasMeters[p] && totals[p].consumption > 0`:

```ts
    // § 9a Abs. 2 (Heizung PR 13): Überschreitet die geschätzte Fläche die Grenze der für die Verteilung
    // maßgeblichen Fläche dieses Topfs, wird er ausschließlich nach Fläche verteilt. „Überschreitet“:
    // streng größer, verglichen über Produkte, nie über einen gerundeten Anteil.
    totals[p].estimatedArea = units.filter((u) => u.estimated[p]).reduce((a, u) => a + areaOf(p, u.unit), 0)
    if (totals[p].estimatedArea > 0) {
      const limit = input.estimateThreshold?.()
      totals[p].overThreshold = limit !== undefined && totals[p].estimatedArea * 100 > totals[p].area * limit
    }
```

Ein Topf ohne einen einzigen Zähler (`potHasMeters` falsch) bleibt „nicht erfasst“, auch wenn eine
Wohnung geschätzt ist; dafür gibt es keine Schätzung (Task 4 lehnt sie ab).

- [ ] **Step 5: Gewichte (`server/src/heating.ts`, `weightsOf`)**

Die Zeile `const share = plan.totals[p].measured ? shares[p] / 100 : 0` ersetzen durch:

```ts
        // Nicht erfasst oder nach § 9a Abs. 2 nur nach Fläche (Heizung PR 13): kein Anteil nach Verbrauch.
        const share = plan.totals[p].measured && !plan.totals[p].overThreshold ? shares[p] / 100 : 0
```

und im Kommentar über `weightsOf` ergänzen: „bei `overThreshold` ebenso nur der Grundanteil (§ 9a Abs. 2)“.

- [ ] **Step 6: Vorschläge und Gerät (`server/src/heating.ts`)**

Ans Dateiende:

```ts
// ---------- Schätzung nach § 9a: Vorschläge (Heizung PR 13, Entwurf 8.7) ----------

// Die Fläche einer Wohnung im Topf: beheizte Fläche nur beim Topf Heizung, wenn eingestellt (§ 7 Abs. 1
// Satz 5), sonst Wohnfläche (§ 8 Abs. 1).
const potAreaOf = (u: SelfUnitPlan, p: SelfPot): number => (p === 'heating' ? u.heatArea : u.unit.areaM2 || 0)

// Die drei Wege des § 9a Abs. 1 als Vorschläge für eine Wohnung und einen Topf.
// - Durchschnitt des Gebäudes (Vorgabe): Summe des erfassten Verbrauchs der übrigen Wohnungen ohne
//   Schätzung und ohne Fehler durch ihre Fläche, mal der Fläche der Wohnung (Abweichung 7).
// - Vergleichbare andere Räume: dieselbe Rechnung für eine einzelne Wohnung; welche vergleichbar ist,
//   wählt der Vermieter, deshalb ohne eigenen Wert und mit der Liste `comparable` (Abweichung 6).
// - Vergleichbare Zeiträume: derselbe Topf derselben Wohnung in der vorigen Heizperiode, nur bei
//   gleicher Länge (Abweichung 5).
export function estimateProposals(plan: SelfPlan, prev: SelfPlan | null, sameLength: boolean, unitId: string, pot: SelfPot): { proposals: EstimateProposal[]; comparable: ComparableUnit[] } {
  const target = plan.units.find((u) => u.unit.id === unitId)
  const area = target ? potAreaOf(target, pot) : 0
  const others = plan.units.filter((u) => u.unit.id !== unitId && u.measured[pot] && potAreaOf(u, pot) > 0)
  const comparable: ComparableUnit[] = others.map((u) => {
    const perM2 = u.consumption[pot] / potAreaOf(u, pot)
    return { unitId: u.unit.id, unitName: u.unit.name, perM2, value: perM2 * area }
  })
  const sumArea = others.reduce((a, u) => a + potAreaOf(u, pot), 0)
  const sumUse = others.reduce((a, u) => a + u.consumption[pot], 0)
  const average: EstimateProposal = sumArea > 0
    ? { method: 'buildingAverage', value: (sumUse / sumArea) * area, perM2: sumUse / sumArea, why: 'ok' }
    : { method: 'buildingAverage', value: null, perM2: null, why: 'noMeasured' }
  const before = prev?.units.find((u) => u.unit.id === unitId)
  const previous: EstimateProposal = !before || !before.measured[pot]
    ? { method: 'previousPeriod', value: null, perM2: null, why: 'noPrevious' }
    : !sameLength
      ? { method: 'previousPeriod', value: null, perM2: null, why: 'lengthDiffers' }
      : { method: 'previousPeriod', value: before.consumption[pot], perM2: null, why: 'ok' }
  const byUnit: EstimateProposal = { method: 'comparableUnit', value: null, perM2: null, why: comparable.length > 0 ? 'ok' : 'noMeasured' }
  return { proposals: [average, previous, byUnit], comparable }
}

// Welches Gerät eine Wohnung für eine Schätzung haben muss (Abweichung 4 des Plans): § 9a setzt ein
// Gerät voraus, das ausfällt. `null`: Mietfuchs kennt die Geräte nicht (Werte eines Ablesedienstes,
// PR 12) und prüft nicht.
export function estimateDeviceType(capture: CaptureMethod | null, part: EstimatePart): MeterType | null {
  if (part === 'water') return capture === 'serviceValues' ? null : 'warmwasser'
  if (capture === 'hca') return 'hkv'
  if (capture === 'serviceValues') return null
  return 'waerme'
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix server test -- test/heating.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS. Alle Tests von PR 10 bis PR 12 in heating.test.ts bleiben grün: Ohne `estimates` gibt
`liveMetersOf` dieselben Geräte wie `metersOf`, und `overThreshold` bleibt falsch.

- [ ] **Step 8: Commit**

```bash
git add server/src/heating.ts server/test/heating.test.ts
git commit -m "Schätzung nach § 9a in der Rechnung: geschätzter Verbrauch statt Ablesung, Grenze je Topf, drei Vorschläge

Bei mehr als 25 % geschätzter Fläche eines Topfs nur nach Fläche (§ 9a Abs. 2), genau 25 % bleibt
nach Verbrauch (R-A22). Mehrere Nutzer einer geschätzten Wohnung teilen wie nach § 9b Abs. 3.

Refs #99"
```

---

### Task 4: Speichern, entfernen, Routen

**Files:**
- Create: `server/src/db/heatingEstimates.ts`
- Modify: `server/src/index.ts`
- Test: `server/test/db-schaetzung.test.ts`, `server/test/api.test.ts`

**Interfaces:**
- Consumes (Task 2, 3; PR 4–8, 10): `heatingEstimates`, `ESTIMATE_METHODS`, `ESTIMATE_PARTS`; `estimateDeviceType`; `plantContext`, `heatingPeriodOf`, `heatingPeriodClosed`, `ensureHeatingPeriod`, `closedText` (`./heatingPeriodContext.ts`); `servesUnit`; `readUnits`, `readMeters`; `HeatingError`, `raw`, `oneOfOrUndefined`; in index.ts `writeData`, `bodyObject`.
- Produces:
  - `saveEstimate(db: Database, plantId: string, period: string, unitId: string, part: string, body: unknown): Promise<HeatingEstimate | null>` (`null`: Anlage gibt es nicht)
  - `removeEstimate(db: Database, plantId: string, period: string, unitId: string, part: string): Promise<boolean | null>`
  - `PUT /api/heating-plants/:id/periods/:period/estimates/:unitId/:part` mit Rumpf `{ value, method, reason, confirmed }` → 200 `HeatingEstimate`; 400; 404; 409
  - `DELETE /api/heating-plants/:id/periods/:period/estimates/:unitId/:part` → 200 `{ ok: true; removed: boolean }`; 404

- [ ] **Step 1: Write the failing tests**

(a) `server/test/db-schaetzung.test.ts`: die Zeile `void status` streichen; Importe ergänzen:

```ts
import { removeEstimate, saveEstimate } from '../src/db/heatingEstimates.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { closeSettlement } from '../src/db/repository.ts'
```

und anhängen:

```ts
let ids = 0
const newId = () => `m-${++ids}`
// Wie `haus`, dazu Mieter und die eigene Abrechnung mit Wärme- und Warmwasserzählern (Einrichtung, PR 10).
async function eigeneAbrechnung(opened: Opened): Promise<void> {
  await haus(opened)
  await opened.write(async (db) => {
    for (const u of ['a', 'b', 'c']) await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, start: '2020-01-01' })
    await setUpSelf(db, 'hp', {
      period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false,
    }, '2026-02-01', newId)
  })
}
const GUT = { value: 12000, method: 'buildingAverage', reason: 'Wärmezähler defekt, Ersatz erst im Januar', confirmed: true }

test('Schätzung speichern, ändern und entfernen', async () => {
  await withDatabase(async (opened) => {
    await eigeneAbrechnung(opened)
    const e = await opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'heat', GUT))
    assert.deepEqual(e, { plantId: 'hp', period: '2025-01', unitId: 'c', part: 'heat', value: 12000, method: 'buildingAverage', reason: 'Wärmezähler defekt, Ersatz erst im Januar', confirmed: true })
    await opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'heat', { ...GUT, value: 11500, confirmed: false }))
    assert.deepEqual((await opened.read(readStock)).heatingEstimates.map((x) => [x.value, x.confirmed]), [[11500, false]])
    assert.equal(await opened.write((db) => removeEstimate(db, 'hp', '2025-01', 'c', 'heat')), true)
    assert.equal(await opened.write((db) => removeEstimate(db, 'hp', '2025-01', 'c', 'heat')), false)
    assert.equal(await opened.write((db) => saveEstimate(db, 'gibt-es-nicht', '2025-01', 'c', 'heat', GUT)), null)
  })
})

test('Review Focus 5: jede ungültige Eingabe mit einem Satz, nichts geschrieben', async () => {
  await withDatabase(async (opened) => {
    await eigeneAbrechnung(opened)
    const save = (unitId: string, part: string, body: Record<string, unknown>) => opened.write((db) => saveEstimate(db, 'hp', '2025-01', unitId, part, body))
    await assert.rejects(save('c', 'heat', { ...GUT, value: -1 }), status(400, /Zahl ab 0/))
    await assert.rejects(save('c', 'heat', { ...GUT, value: '12000' }), status(400, /Zahl ab 0/))
    await assert.rejects(save('c', 'heat', { ...GUT, reason: '  ' }), status(400, /Begründung/))
    await assert.rejects(save('c', 'heat', { ...GUT, method: 'raten' }), status(400, /drei Wege/))
    await assert.rejects(save('c', 'gas', GUT), status(400, /Heizung oder das Warmwasser/))
    await assert.rejects(save('zz', 'heat', GUT), status(400, /gibt es in diesem Objekt nicht/))
    assert.deepEqual((await opened.read(readStock)).heatingEstimates, [])
  })
})

test('Schätzung nur bei eigener Abrechnung, nur mit Gerät, nur an angeschlossener Wohnung, abgeschlossen gesperrt', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await assert.rejects(opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'heat', GUT)), status(400, /eigenen Heizkostenabrechnung/))
  })
  await withDatabase(async (opened) => {
    await eigeneAbrechnung(opened)
    // Ohne Wärmezähler an der Wohnung gibt es nichts, was ausgefallen sein könnte (Abweichung 4).
    const stock = await opened.read(readStock)
    const zaehler = stock.meters.find((m) => m.unitId === 'c' && m.type === 'waerme') ?? assert.fail('kein Wärmezähler C')
    await opened.write((db) => db.run(sql`DELETE FROM meters WHERE id = ${zaehler.id}`))
    await assert.rejects(opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'heat', GUT)), status(400, /keinen Wärmezähler.*Ausstattungspflicht/s))
    await opened.write((db) => closeSettlement(db, { id: 'abschluss', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01T10:00:00.000Z', sentAt: null, settlement: {} }))
    await assert.rejects(opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'a', 'heat', GUT)), status(409, /abgeschlossen/))
  })
})
```

(`sql` aus `'drizzle-orm'` importieren. Löscht `db.run` in dieser Fassung von drizzle nicht, gilt
`db.delete(meters).where(eq(meters.id, zaehler.id))` mit `meters` aus `'../src/db/schema.ts'`.)

(b) `server/test/api.test.ts`, hinter dem Test von PR 10 „Eigene Heizkostenabrechnung über die Routen“:

```ts
test('Schätzung nach § 9a über die Routen (Heizung PR 13)', async () => {
  const s = await startServer()
  const send = (method: string, url: string, body?: unknown) =>
    fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  try {
    const unit = await s.api<{ id: string }>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('POST', '/api/heating-plants', { energy: 'gas', method: 'manual' }))
    const setup = { period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false }
    assert.equal((await send('PUT', `/api/heating-plants/${plant.id}/self`, setup)).status, 200)
    const url = `/api/heating-plants/${plant.id}/periods/2025-01/estimates/${unit.id}/heat`
    const ok = await send('PUT', url, { value: 9000, method: 'buildingAverage', reason: 'Zähler defekt', confirmed: true })
    assert.equal(ok.status, 200)
    assert.equal((await jsonOf<HeatingEstimate>(ok)).value, 9000)
    const leer = await send('PUT', url, { value: 9000, method: 'buildingAverage', reason: '', confirmed: true })
    assert.equal(leer.status, 400)
    assert.match(await errorFrom(leer), /Begründung/)
    assert.deepEqual(await jsonOf<{ ok: boolean; removed: boolean }>(await send('DELETE', url)), { ok: true, removed: true })
    assert.equal((await send('PUT', `/api/heating-plants/gibt-es-nicht/periods/2025-01/estimates/${unit.id}/heat`, { value: 1, method: 'buildingAverage', reason: 'x', confirmed: true })).status, 404)
  } finally {
    s.stop()
  }
})
```

(`HeatingEstimate` in den Typimport aus `'../../shared/types.ts'`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-schaetzung.test.ts test/api.test.ts`
Expected: FAIL; `ERR_MODULE_NOT_FOUND` für `src/db/heatingEstimates.ts`, die Route antwortet 404.

- [ ] **Step 3: Speichern (`server/src/db/heatingEstimates.ts`, neu)**

```ts
// Schätzungen nach § 9a HeizkostenV (Heizung PR 13, Entwurf 5.6, 8.7): je Heizperiode, Wohnung und Topf
// der geschätzte Verbrauch mit Weg, Begründung und Bestätigung. Geschätzt wird nur bei eigener
// Heizkostenabrechnung; beim Messdienst schätzt dieser.
import { and, eq } from 'drizzle-orm'
import { servesUnit } from '../../../shared/heatingPeriod.ts'
import type { EstimatePart, HeatingEstimate } from '../../../shared/types.ts'
import { estimateDeviceType } from '../heating.ts'
import type { Database } from './client.ts'
import { closedText, ensureHeatingPeriod, heatingPeriodClosed, heatingPeriodOf, plantContext } from './heatingPeriodContext.ts'
import { readMeters, readUnits } from './read.ts'
import { HeatingError, oneOfOrUndefined, raw } from './repository.ts'
import { ESTIMATE_METHODS, ESTIMATE_PARTS, heatingEstimates, heatingPeriods } from './schema.ts'

const DEVICE_NAME = { waerme: 'keinen Wärmezähler', hkv: 'keinen Heizkostenverteiler', warmwasser: 'keinen Warmwasserzähler' } as const

function partOf(text: string): EstimatePart {
  const part = oneOfOrUndefined(ESTIMATE_PARTS, text)
  if (part === undefined) throw new HeatingError(400, 'Geschätzt wird der Verbrauch für die Heizung oder das Warmwasser.')
  return part
}

// `null`, wenn es die Anlage nicht gibt; die Route macht daraus ihre 404.
export async function saveEstimate(db: Database, plantId: string, period: string, unitId: string, partText: string, body: unknown): Promise<HeatingEstimate | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  if (ctx.plant.method !== 'self') {
    throw new HeatingError(400, 'Geschätzt nach § 9a HeizkostenV wird hier nur bei einer eigenen Heizkostenabrechnung. Rechnet ein Messdienst oder die Gemeinschaft ab, schätzt dieser; übernehmen Sie seine Beträge.')
  }
  const part = partOf(partText)
  if (part === 'water' && ctx.plant.hotWater === 'none') throw new HeatingError(400, 'Diese Heizanlage bereitet kein Warmwasser; geschätzt werden kann nur der Verbrauch für die Heizung.')
  const h = heatingPeriodOf(ctx, period)
  const unit = (await readUnits(db)).find((u) => u.id === unitId && u.propertyId === ctx.plant.propertyId)
  if (!unit) throw new HeatingError(400, 'Diese Wohnung gibt es in diesem Objekt nicht (mehr). Bitte laden Sie die Seite neu; gespeichert wurde nichts.')
  if (!servesUnit(ctx.plant, unit)) throw new HeatingError(400, `Die Wohnung „${unit.name}“ hängt nicht an dieser Heizanlage.`)
  // § 9a setzt ein Gerät voraus, das ausfällt (Abweichung 4 des Plans).
  const device = estimateDeviceType(ctx.plant.capture, part)
  if (device !== null && !(await readMeters(db)).some((m) => m.unitId === unit.id && m.type === device)) {
    throw new HeatingError(400,
      `„${unit.name}“ hat ${DEVICE_NAME[device]}. Geschätzt wird nach § 9a HeizkostenV der Verbrauch eines Geräts, das ausgefallen ist; eine Wohnung ohne Gerät ist ein Fall der Ausstattungspflicht (§§ 4, 5 HeizkostenV). Legen Sie den Zähler an und tragen Sie die Stände ein.`)
  }
  const value = raw(body, 'value')
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new HeatingError(400, 'Der geschätzte Verbrauch ist eine Zahl ab 0.')
  const method = oneOfOrUndefined(ESTIMATE_METHODS, raw(body, 'method'))
  if (method === undefined) throw new HeatingError(400, 'Bitte wählen Sie einen der drei Wege des § 9a Abs. 1 HeizkostenV: vergleichbarer Zeitraum, vergleichbare Wohnung oder Durchschnitt des Gebäudes.')
  const reasonText = raw(body, 'reason')
  const reason = typeof reasonText === 'string' ? reasonText.trim() : ''
  if (reason === '') throw new HeatingError(400, 'Bitte nennen Sie die Begründung, warum der Verbrauch nicht erfasst werden konnte (etwa „Wärmezähler defekt“).')
  const confirmed = raw(body, 'confirmed') === true
  await db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    const heatingPeriodId = await ensureHeatingPeriod(tx, plantId, h.key)
    await tx.delete(heatingEstimates).where(and(eq(heatingEstimates.heatingPeriodId, heatingPeriodId), eq(heatingEstimates.unitId, unit.id), eq(heatingEstimates.part, part)))
    await tx.insert(heatingEstimates).values({ heatingPeriodId, unitId: unit.id, part, value, method, reason, confirmed })
  })
  return { plantId, period: h.key, unitId: unit.id, part, value, method, reason, confirmed }
}

// `null`, wenn es die Anlage nicht gibt; sonst, ob etwas entfernt wurde.
export async function removeEstimate(db: Database, plantId: string, period: string, unitId: string, partText: string): Promise<boolean | null> {
  const ctx = await plantContext(db, plantId)
  if (!ctx) return null
  const part = partOf(partText)
  const h = heatingPeriodOf(ctx, period)
  return db.transaction(async (tx) => {
    if (await heatingPeriodClosed(tx, ctx, h)) throw new HeatingError(409, closedText(h))
    const [row] = await tx.select({ id: heatingPeriods.id }).from(heatingPeriods).where(and(eq(heatingPeriods.plantId, plantId), eq(heatingPeriods.period, h.key)))
    if (!row) return false
    const where = and(eq(heatingEstimates.heatingPeriodId, row.id), eq(heatingEstimates.unitId, unitId), eq(heatingEstimates.part, part))
    const before = await tx.select({ unitId: heatingEstimates.unitId }).from(heatingEstimates).where(where)
    if (before.length === 0) return false
    await tx.delete(heatingEstimates).where(where)
    return true
  })
}
```

(`Database` kommt aus `'./client.ts'` wie in db/heatingSelf.ts (PR 10); steht es dort anders, gilt
derselbe Pfad wie dort. Gibt `db.transaction` in dieser Fassung keinen Wert zurück, wird `removed` in
einer Variablen außerhalb gesetzt und danach zurückgegeben.)

- [ ] **Step 4: Routen (`server/src/index.ts`)**

Import `import { removeEstimate, saveEstimate } from './db/heatingEstimates.ts'`. Hinter den Routen von
PR 10 („Eigene Heizkostenabrechnung“):

```ts
// Schätzung nach § 9a (Heizung PR 13): je Heizperiode, Wohnung und Topf (`heat`, `water`).
app.put('/api/heating-plants/:id/periods/:period/estimates/:unitId/:part', async (req, res) => {
  const result = await writeData((db) => saveEstimate(db, req.params.id, req.params.period, req.params.unitId, req.params.part, bodyObject(req)))
  if (!result) return res.status(404).json({ error: 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
  res.json(result)
})
app.delete('/api/heating-plants/:id/periods/:period/estimates/:unitId/:part', async (req, res) => {
  const removed = await writeData((db) => removeEstimate(db, req.params.id, req.params.period, req.params.unitId, req.params.part))
  if (removed === null) return res.status(404).json({ error: 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
  res.json({ ok: true, removed })
})
```

`HeatingError` (400, 409) läuft über die Fehlerbehandlung von index.ts (PR 4).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-schaetzung.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/heatingEstimates.ts server/src/index.ts server/test/db-schaetzung.test.ts server/test/api.test.ts
git commit -m "Schätzung nach § 9a speichern und entfernen, mit Prüfung je Eingabe

Nur bei eigener Abrechnung, nur für eine Wohnung mit Gerät an der Anlage, Begründung Pflicht,
abgeschlossene Heizperioden gesperrt.

Refs #99"
```

---

### Task 5: Berechnung: Schätzungen, Grenze, Hinweise, Rechenweg, Ausweis

**Files:**
- Modify: `server/src/calc.ts`
- Test: `server/test/calc-schaetzung.test.ts` (neu)

**Interfaces:**
- Consumes (Task 1–3; PR 10 Task 8, 9): `hkvEstimateThreshold`; `estimateKey`, `estimateProposals`, `planSelf`, `SelfPlan`; `POT_OF_PART`, `PART_OF_POT`; `Snapshot.heatingEstimates`; in `computeSettlement` `selfPlans`, `SelfPlantPlan`, `input`, `plan`, `plant`, `rules`, `prev`, `period`, `servedIds`, `blocked`, `selfProblemText`, `selfSteps`, `selfStatementOf`, `POT_NAME`, `POT_UNIT`, `label`, `lawPeriod`, `lawLog`, `warn`, `fmtNum`, `fmtPercent`, `fmtDay`; `previousPeriod`, `periodDays`, `dayBefore`, `createLawLog`.
- Produces:
  - `SelfPlantPlan` + `estimates: HeatingEstimate[]`, `prev: SelfPlan | null`, `prevSameLength: boolean`
  - Codes `heating.estimate-unconfirmed` (warning), `heating.estimated` (hint), `heating.estimate-over-25` (hint)
  - `SelfHeatingStatement.estimates`, `.estimateOptions`, `.threshold`; `SelfPotView.overThreshold`, `.estimatedAreaM2`; `SelfUserView.heatingEstimated`, `.waterEstimated`

- [ ] **Step 1: Write the failing test**

`server/test/calc-schaetzung.test.ts`:

```ts
// Schätzung nach § 9a in der Abrechnung (Heizung PR 13): Beispiel A (Entwurf 8.6), der Endstand des
// Wärmezählers C fehlt. C hat 60 von 200 m², also 30 %: Der Topf Heizung geht nach Fläche (§ 9a Abs. 2),
// der Topf Warmwasser bleibt nach Verbrauch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import type { Snapshot } from '../src/snapshot.ts'
import type { HeatingEstimate, MeterType } from '../../shared/types.ts'
import { selfSnapshot } from '../testing/selfHeating.ts'

const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)
const textOf = (s: ComputedSettlement, code: string) => s.notices.find((n) => n.code === code)?.text ?? assert.fail(`kein Hinweis ${code}: ${codes(s).join(', ')}`)
const meterOf = (s: Snapshot, unitId: string, type: MeterType) =>
  s.meters.find((m) => m.unitId === unitId && m.type === type && (m.heatingPlantId ?? null) === null) ?? assert.fail(`kein Zähler ${unitId} ${type}`)
const tenancyOf = (s: Snapshot, unitId: string, endsAt: string | null) =>
  s.tenancies.find((t) => t.unitId === unitId && t.end === endsAt)?.id ?? assert.fail(`kein Mietverhältnis ${unitId}`)
const plantIdOf = (s: Snapshot) => s.heatingPlants?.[0]?.id ?? assert.fail('keine Anlage')
const itemOf = (s: Snapshot, part: string, target: string) => s.costItems.find((c) => c.heatingPart === part && c.heatingTarget === target) ?? assert.fail(`keine Position ${part}/${target}`)
const shareOf = (s: ComputedSettlement, tenancyId: string, itemId: string) =>
  s.statements.find((st) => st.tenancyId === tenancyId)?.rows.find((r) => r.costItemId === itemId)?.shareCents ?? assert.fail(`keine Zeile ${itemId}`)

function ohneEndeC(s: Snapshot): Snapshot {
  const wc = meterOf(s, 'c', 'waerme')
  return { ...s, readings: s.readings.filter((r) => !(r.meterId === wc.id && r.date === '2025-12-31')) }
}
function mitSchaetzung(s: Snapshot, over: Partial<HeatingEstimate> = {}): Snapshot {
  return { ...s, heatingEstimates: [{ plantId: plantIdOf(s), period: s.period.key, unitId: 'c', part: 'heat', value: 12000, method: 'buildingAverage', reason: 'Wärmezähler defekt', confirmed: true, ...over }] }
}

test('Ohne Schätzung: Fehler mit Verweis auf die Schätzung, statt „spätere Version“', () => {
  const s = computeSettlement(ohneEndeC(selfSnapshot()))
  const text = textOf(s, 'heating.self-incomplete')
  assert.match(text, /schätzen Sie den Verbrauch auf der Seite Heizkosten/)
  assert.doesNotMatch(text, /späteren Version/)
})

test('Mit Schätzung: verteilt, Topf Heizung nur nach Fläche (30 % > 25 %), Warmwasser unverändert, keine Kürzung', () => {
  const base = selfSnapshot()
  const snap = mitSchaetzung(ohneEndeC(base))
  const s = computeSettlement(snap)
  assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  const ids = { A: tenancyOf(snap, 'a', null), B: tenancyOf(snap, 'b', null), C1: tenancyOf(snap, 'c', '2025-09-30'), C2: tenancyOf(snap, 'c', null) }
  // Miete Wärmezähler (nur Heizung, 120 €) nach Fläche und Gradtagen: 60/200, 80/200, 60/200 · 640 ‰, 60/200 · 360 ‰.
  const wz = itemOf(snap, 'metering', 'heating')
  assert.deepEqual([ids.A, ids.B, ids.C1, ids.C2].map((t) => shareOf(s, t, wz.id)), [3600, 4800, 2304, 1296])
  // Miete Warmwasserzähler (nur Warmwasser) wie ohne Schätzung.
  const wwz = itemOf(snap, 'metering', 'water')
  const ohne = computeSettlement(base)
  assert.deepEqual([ids.A, ids.B, ids.C1, ids.C2].map((t) => shareOf(s, t, wwz.id)), [ids.A, ids.B, ids.C1, ids.C2].map((t) => shareOf(ohne, t, wwz.id)))
  assert.match(textOf(s, 'heating.estimate-over-25'), /60 von 200 m² \(30 %\).*überschreitet 25 %.*ausschließlich nach Fläche.*§ 9a Abs\. 2.*Auslegung/s)
  assert.ok(!codes(s).includes('heating.no-consumption'), 'keine Kürzung nach § 12 Abs. 1 Satz 1 (15.1 Nr. 7)')
  assert.match(textOf(s, 'heating.estimated'), /C.*12\.000 kWh.*Durchschnitt.*Wärmezähler defekt.*Gradtagen/s)
  const self = s.heating?.find((h) => h.self)?.self ?? assert.fail('kein Ausweis')
  const heating = self.pots.find((p) => p.pot === 'heating') ?? assert.fail('Topf Heizung')
  assert.deepEqual([heating.overThreshold, heating.estimatedAreaM2, heating.consumptionPct], [true, 60, 0])
  assert.equal(self.threshold, 25)
  assert.deepEqual(self.estimates.map((e) => [e.unitId, e.part, e.value, e.users]), [['c', 'heat', 12000, 2]])
  assert.ok(s.legalBasis.values?.some((v) => v.id === 'hkv.estimate-threshold'))
})

test('Unbestätigt: Warnung statt Hinweis', () => {
  const s = computeSettlement(mitSchaetzung(ohneEndeC(selfSnapshot()), { confirmed: false }))
  assert.match(textOf(s, 'heating.estimate-unconfirmed'), /nicht bestätigt.*Geräteausfalls oder aus einem anderen zwingenden Grund.*VIII ZR 373\/04/s)
  assert.ok(!codes(s).includes('heating.estimated'))
  assert.equal(s.notices.find((n) => n.code === 'heating.estimate-unconfirmed')?.level, 'warning')
})

test('Review Focus 1: Die Schätzung gilt auch neben einer vollständigen Ablesung; der Hinweis sagt, wann sie zu entfernen ist', () => {
  const s = computeSettlement(mitSchaetzung(selfSnapshot(), { value: 10000 }))
  assert.match(textOf(s, 'heating.estimated'), /Lässt sich der Wert doch ablesen, entfernen Sie die Schätzung/)
  const self = s.heating?.find((h) => h.self)?.self ?? assert.fail('kein Ausweis')
  const c1 = self.units.find((u) => u.unitId === 'c')?.users[0] ?? assert.fail('C1')
  assert.equal(c1.heatingEstimated, true)
  assert.equal(c1.heatingConsumption, 6400)
})

test('Ohne Schätzung kein Wert der Grenze im Rechtsstand und keine neuen Felder mit Inhalt', () => {
  const s = computeSettlement(selfSnapshot())
  assert.ok(!s.legalBasis.values?.some((v) => v.id === 'hkv.estimate-threshold'))
  const self = s.heating?.find((h) => h.self)?.self ?? assert.fail('kein Ausweis')
  assert.deepEqual([self.estimates, self.threshold], [[], null])
  assert.ok(self.pots.every((p) => !p.overThreshold && p.estimatedAreaM2 === 0))
})

test('Optionen für den Dialog: fehlender Endstand bei C mit Vorschlag Durchschnitt 12.000 kWh', () => {
  const s = computeSettlement(ohneEndeC(selfSnapshot()))
  const self = s.heating?.find((h) => h.self)?.self ?? assert.fail('kein Ausweis')
  const option = self.estimateOptions.find((o) => o.unitId === 'c' && o.part === 'heat') ?? assert.fail('keine Option C')
  assert.deepEqual([option.why, option.boundary, option.areaM2, option.estimated], ['noReading', '2025-12-31', 60, false])
  assert.deepEqual(option.proposals.find((p) => p.method === 'buildingAverage')?.value, 12000)
  assert.deepEqual(option.comparable.map((c) => [c.unitId, c.value]), [['a', 12000], ['b', 12000]])
  const a = self.estimateOptions.find((o) => o.unitId === 'a' && o.part === 'heat') ?? assert.fail('keine Option A')
  assert.equal(a.why, null)
})
```

(`selfSnapshot()` ist Beispiel A aus `server/testing/selfHeating.ts` (PR 11 B8, PR 12 C6): Mieter A, B, C1
bis 30.09.2025, C2 ab 01.10.2025, Wärme- und Warmwasserzähler je Wohnung, Stände am 31.12.2024 und
31.12.2025, bei C auch am 30.09.2025. Review Focus 1 prüft, dass die Schätzung von 10.000 kWh auch neben
vollständigen Ablesungen gilt: C1 trägt 10.000 · 640 ‰ = 6.400 kWh statt der abgelesenen 7.200 kWh. Hat
der Helfer andere Namen, gelten seine.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-schaetzung.test.ts`
Expected: FAIL; der Text von `heating.self-incomplete` nennt die spätere Version, `heatingEstimates` wird
nicht gelesen, die Codes fehlen.

- [ ] **Step 3: Codes und Importe (`server/src/calc.ts`)**

Importe ergänzen: `hkvEstimateThreshold` in den aus `'../../shared/law/heizkostenv.ts'`;
`estimateKey, estimateProposals` in den aus `'./heating.ts'`; `POT_OF_PART, PART_OF_POT` in den aus
`'../../shared/heating.ts'`; `createLawLog` in den aus `'../../shared/law/register.ts'`;
`HeatingEstimate, SelfEstimateOption, SelfEstimateView` in den Typimport aus `'../../shared/types.ts'`.

In `noticeKinds` hinter den Codes von PR 12:

```ts
  // Heizung PR 13 (#99, Entwurf 8.7, 10.1): Schätzung nach § 9a.
  'heating.estimate-unconfirmed': { level: 'warning', title: 'Schätzung nicht bestätigt', rule: 'heating-estimate', terms: ['heatingEstimate'] },
  'heating.estimated': { level: 'hint', title: 'Verbrauch geschätzt', rule: 'heating-estimate', terms: ['heatingEstimate'] },
  'heating.estimate-over-25': { level: 'hint', title: 'Geschätzte Fläche über der Grenze: nur nach Fläche', rule: 'heating-estimate', terms: ['heatingEstimate', 'baseCosts'] },
```

- [ ] **Step 4: Schätzungen in den Plan (`server/src/calc.ts`, Block des Plans von PR 10)**

`type SelfPlantPlan` bekommt als letzte Felder:

```ts
    // Schätzung nach § 9a (Heizung PR 13): die Schätzungen der Anlage in dieser Heizperiode und die
    // Vorperiode für den Vorschlag „vergleichbare Zeiträume“ (neu gerechnet, ohne ihre Schätzungen).
    estimates: HeatingEstimate[]
    prev: SelfPlan | null
    prevSameLength: boolean
```

Im Block des Plans vor `const input: SelfInput = {`:

```ts
    // Schätzungen nach § 9a (Heizung PR 13): nur angeschlossene Wohnungen, nur Töpfe der Anlage.
    const estimates = (snapshot.heatingEstimates ?? []).filter((e) => e.plantId === plant.id && e.period === period.key && servedIds.has(e.unitId) && (hotWater !== 'none' || e.part === 'heat'))
```

Im Objekt `input` als letzte Felder:

```ts
      estimates: new Map(estimates.map((e): [string, number] => [estimateKey(e.unitId, POT_OF_PART[e.part]), e.value])),
      estimateThreshold: () => law(hkvEstimateThreshold, { period: lawPeriod }, lawLog),
```

Hinter `const plan = planSelf(input)`:

```ts
    // Die Vorperiode für den Vorschlag „vergleichbare Zeiträume“ (§ 9a Abs. 1, Abweichung 5 des Plans):
    // ihre Ablesungen, ohne Schätzungen, ohne Nachbarwechsel. Die Warngrenze der Ablesung fragt sie in
    // einem eigenen Protokoll, damit sie nicht im Rechtsstand dieser Abrechnung steht.
    const before = previousPeriod(rules, prev)
    const prevPlan = planSelf({
      ...input,
      h: { from: prev.from, to: prev.to },
      neighbors: { before: dayBefore(before.from), after: period.to },
      outerChanges: undefined,
      opening: undefined,
      estimates: undefined,
      estimateThreshold: undefined,
      offRule: () => law(practiceReadingOffWarning, { period: lawPeriod }, createLawLog()),
    })
```

Im Objekt von `selfPlans.set(plant.id, { … })` als letzte Felder:

```ts
      estimates,
      prev: prevPlan,
      prevSameLength: periodDays(prev) === periodDays(period),
```

(`prev` ist die vorige Heizperiode aus dem Block von PR 10 (`previousPeriod(rules, period)`); `hotWater`
steht dort seit PR 10.)

Den Text der Fehler aus dem Plan (PR 10, Zeile `for (const p of plan.problems) blocked.push(…)`) ersetzen
durch:

```ts
    // § 9a (Heizung PR 13): Lässt sich ein Wert nicht mehr ablesen, wird geschätzt; nicht bei einer
    // Wohnung ohne Gerät (Ausstattungspflicht) und nicht bei zwei Ständen am selben Tag (welcher stimmt,
    // weiß nur der Vermieter).
    const ESTIMABLE = ['noReading', 'replacement', 'negative']
    for (const p of plan.problems) {
      blocked.push({
        code: 'heating.self-incomplete',
        text: `${selfProblemText(p, plant.areaBasisHeat ?? 'area')}${p.kind === 'missing' && ESTIMABLE.includes(p.reason)
          ? ' Lässt sich der Wert nicht mehr ablesen, weil das Gerät ausgefallen ist oder ein anderer zwingender Grund vorliegt, schätzen Sie den Verbrauch auf der Seite Heizkosten unter „Schätzung (§ 9a)“.'
          : ''}`,
      })
    }
```

- [ ] **Step 5: Rechenweg (`server/src/calc.ts`, `selfSteps`)**

In `selfSteps` (PR 10 Task 8) die Zeilen von `const v = u.pots[p].value` bis zum Schritt „Anteil nach
Verbrauch“ ersetzen durch:

```ts
      const v = u.pots[p].value
      const estimatedHere = unit.estimated[p]
      if (total.overThreshold) {
        // § 9a Abs. 2 (Heizung PR 13): der Topf ausschließlich nach Fläche.
        steps.push({ label: `Verbrauchskosten ${POT_NAME[p]}`, value: `geschätzt für ${fmtNum(total.estimatedArea)} von ${fmtNum(total.area)} m², mehr als die Grenze: nur nach Fläche verteilt (§ 9a Abs. 2 HeizkostenV)`, term: 'heatingEstimate' })
      } else {
        steps.push(total.measured && v !== null
          ? {
            label: `Verbrauchskosten ${POT_NAME[p]}`,
            value: `${fmtNum(Math.round(v * 1000) / 1000)} von ${fmtNum(Math.round(total.consumption * 1000) / 1000)} ${POT_UNIT[p]}` +
              `${estimatedHere ? ' (geschätzt nach § 9a HeizkostenV)' : ''}` +
              `${u.pots[p].group ? (estimatedHere ? ', auf die Nutzer der Wohnung nach § 9b Abs. 3 HeizkostenV geteilt' : ' (ohne Zwischenablesung nach § 9b Abs. 3 HeizkostenV geteilt)') : ''}`,
            term: estimatedHere ? 'heatingEstimate' : 'consumptionCosts',
          }
          : { label: `Verbrauchskosten ${POT_NAME[p]}`, value: 'kein Verbrauch erfasst, nur nach Fläche verteilt', term: 'consumptionCosts' })
      }
      steps.push({ label: `Anteil nach Verbrauch ${POT_NAME[p]}`, value: `${fmtNum(total.measured && !total.overThreshold ? sp.shares[p] ?? 0 : 0)} %`, term: 'consumptionCosts' })
```

(`unit` ist in `selfSteps` die Wohnung des Nutzers, `total` der Topf; so heißen sie in PR 10.)

- [ ] **Step 6: Ausweis (`server/src/calc.ts`, `selfStatementOf`)**

Vor `selfStatementOf`:

```ts
  // Für den Dialog der Schätzung (Heizung PR 13): je Wohnung und Topf mit Gerät oder Schätzung, was fehlt,
  // und die Vorschläge der drei Wege.
  const estimateOptionsOf = (sp: SelfPlantPlan): SelfEstimateOption[] => sp.plan.units.flatMap((u) => sp.plan.pots.flatMap((p): SelfEstimateOption[] => {
    if (!u.estimated[p] && !u.readings.some((x) => x.pot === p)) return []
    const problem = sp.plan.problems.find((x) => x.kind === 'missing' && x.unitId === u.unit.id && x.pot === p && ['noReading', 'replacement', 'negative'].includes(x.reason))
    const why = problem && problem.kind === 'missing' && (problem.reason === 'noReading' || problem.reason === 'replacement' || problem.reason === 'negative') ? problem.reason : null
    const { proposals, comparable } = estimateProposals(sp.plan, sp.prev, sp.prevSameLength, u.unit.id, p)
    return [{
      unitId: u.unit.id, unitName: u.unit.name, part: PART_OF_POT[p], areaM2: p === 'heating' ? u.heatArea : u.unit.areaM2,
      why, boundary: problem && problem.kind === 'missing' ? problem.boundary : null, estimated: u.estimated[p], proposals, comparable,
    }]
  }))
```

In `selfStatementOf` im Objekt eines Topfs (`pots: sp.plan.pots.map((p): SelfPotView => { … })`) die Zeile
`const pct = t.measured && sp.shares ? (sp.shares[p] ?? 0) : 0` ersetzen durch

```ts
        const pct = t.measured && !t.overThreshold && sp.shares ? (sp.shares[p] ?? 0) : 0
```

und im zurückgegebenen Objekt `consumptionCentsPerUnit` sowie die beiden neuen Felder:

```ts
          consumptionCentsPerUnit: t.measured && !t.overThreshold && t.consumption > 0 ? (cost[p] * pct / 100) / t.consumption : null,
          overThreshold: t.overThreshold,
          estimatedAreaM2: t.estimatedArea,
```

Im Objekt eines Nutzers (`users: u.users.map((x): SelfUserView => { … })`) als letzte Felder:

```ts
            heatingEstimated: u.estimated.heating,
            waterEstimated: u.estimated.water,
```

Im zurückgegebenen Objekt von `selfStatementOf` die Felder aus Task 2 Step 8 ersetzen durch:

```ts
      estimates: sp.estimates.map((e): SelfEstimateView => {
        const u = sp.plan.units.find((x) => x.unit.id === e.unitId)
        return { unitId: e.unitId, unitName: u?.unit.name ?? e.unitId, part: e.part, value: e.value, method: e.method, reason: e.reason, confirmed: e.confirmed, users: u?.users.length ?? 0 }
      }),
      estimateOptions: estimateOptionsOf(sp),
      threshold: sp.estimates.length > 0 ? law(hkvEstimateThreshold, { period: lawPeriod }, lawLog) : null,
```

- [ ] **Step 7: Hinweise (`server/src/calc.ts`)**

Direkt vor der Schleife der Hinweise der eigenen Abrechnung (PR 10 Task 9 Step 8,
`for (const sp of selfPlans.values()) { if (sp.weights === null || !sp.shares) continue … }`), damit die
Schätzungen auch bei einer nicht verteilbaren Anlage genannt werden:

```ts
  // ---------- Schätzung nach § 9a (Heizung PR 13, Entwurf 8.7, 10.1) ----------
  const METHOD_TEXT: Record<HeatingEstimate['method'], string> = {
    previousPeriod: 'dem Verbrauch derselben Wohnung in einem vergleichbaren Zeitraum',
    comparableUnit: 'dem Verbrauch einer vergleichbaren Wohnung in diesem Zeitraum',
    buildingAverage: 'dem Durchschnitt des Gebäudes je m²',
  }
  for (const sp of selfPlans.values()) {
    const plant = sp.plant
    const where = `${plant.name ? `Heizanlage „${plant.name}“` : 'Heizanlage'}, Heizperiode ${label}`
    const subject: NoticeSubject = { kind: 'heatingCosts', id: plant.id }
    for (const e of sp.estimates) {
      const pot = POT_OF_PART[e.part]
      const unit = sp.plan.units.find((u) => u.unit.id === e.unitId)
      if (!unit) continue
      const head = `${where}: Der Verbrauch ${pot === 'heating' ? 'für die Heizung' : 'für das Warmwasser'} von ${unit.unit.name} ist nach § 9a HeizkostenV geschätzt: ${fmtNum(Math.round(e.value * 1000) / 1000)} ${POT_UNIT[pot]} nach ${METHOD_TEXT[e.method]} (Begründung: ${e.reason}).`
      const split = unit.users.length > 1
        ? ` In dieser Wohnung haben ${unit.users.length} Nutzer gewohnt; der geschätzte Verbrauch ist unter ihnen ${pot === 'heating' ? 'nach Gradtagen bzw. Tagen' : 'nach Tagen'} geteilt wie nach § 9b Abs. 3 HeizkostenV.`
        : ''
      if (!e.confirmed) {
        warn('heating.estimate-unconfirmed',
          `${head}${split} Die Schätzung ist noch nicht bestätigt. Geschätzt werden darf nur, wenn der Verbrauch wegen Geräteausfalls oder aus einem anderen zwingenden Grund nicht ordnungsgemäß erfasst werden kann (§ 9a Abs. 1 HeizkostenV); zwingend ist ein Grund erst, wenn sich der Fehler nicht mehr beheben lässt (BGH VIII ZR 373/04). ` +
            'Bestätigen Sie die Schätzung auf der Seite Heizkosten, oder tragen Sie die Ablesung nach und entfernen die Schätzung.',
          subject)
      } else {
        warn('heating.estimated',
          `${head}${split} Lässt sich der Wert doch ablesen, entfernen Sie die Schätzung; geschätzt werden darf nur, solange sich der Fehler nicht beheben lässt (BGH VIII ZR 373/04).`,
          subject)
      }
    }
    // § 9a Abs. 2: je Topf (Entwurf 15.1 Nr. 6). Keine Kürzung nach § 12 (15.1 Nr. 7, Auslegung).
    for (const p of sp.plan.pots) {
      const t = sp.plan.totals[p]
      if (!t.overThreshold) continue
      const limit = law(hkvEstimateThreshold, { period: lawPeriod }, lawLog)
      warn('heating.estimate-over-25',
        `${where}: Geschätzt ist der Verbrauch ${p === 'heating' ? 'für die Heizung' : 'für das Warmwasser'} für ${fmtNum(t.estimatedArea)} von ${fmtNum(t.area)} m² (${fmtPercent((t.estimatedArea * 100) / t.area)} %). ` +
          `Das ${hkvEstimateThreshold.describe(limit)} der für die Verteilung maßgeblichen Fläche; die Kosten ${p === 'heating' ? 'der Heizung' : 'des Warmwassers'} werden deshalb ausschließlich nach Fläche verteilt (§ 9a Abs. 2 HeizkostenV). ` +
          'Einen Kürzungsbetrag nach § 12 HeizkostenV nennt Mietfuchs dafür nicht: Die Verteilung nach Fläche schreibt hier die Verordnung selbst vor, und § 12 Abs. 1 Satz 1 betrifft eine Abrechnung „entgegen den Vorschriften dieser Verordnung“. Das ist eine Auslegung; entschieden ist es nicht.',
        subject)
    }
  }
```

(`NoticeSubject` steht im Typimport von calc.ts seit #112; `fmtPercent` liefert die Zahl ohne „%“, wie in
PR 10. `hkvEstimateThreshold.describe(25)` ergibt „überschreitet 25 %“.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-schaetzung.test.ts test/calc-heizkosten.test.ts test/calc-hkv.test.ts test/heating.test.ts test/glossary.test.ts test/law-literals.test.ts test/anrede.test.ts test/calc.test.ts test/settlement-golden.test.ts test/heating-golden.test.ts test/calc-wortlaut.test.ts && npm run typecheck`
Expected: PASS (calc-schaetzung.test.ts: 6 Tests). Der Test von PR 10 „Review Focus 4: fehlt ein Stand
am Ende der Heizperiode …“ prüft `/Wärme C.*31\.12\.2025.*§ 9a/s`; der neue Text nennt „Schätzung
(§ 9a)“ und bleibt damit grün.

- [ ] **Step 9: Golden unverändert prüfen**

Run: `npm --prefix server test -- test/settlement-golden.test.ts test/db-golden.test.ts test/heating-golden.test.ts`
Expected: PASS ohne geänderte Erwartung. Ändert sich ein Golden, ist das ein Befund (kein Golden hat
eine Schätzung oder einen fehlenden Stand).

- [ ] **Step 10: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/calc.ts server/test/calc-schaetzung.test.ts
git commit -m "Schätzung nach § 9a in der Abrechnung: Hinweise, Rechenweg, Ausweis und Vorschläge

Beispiel A mit ausgefallenem Wärmezähler in C: 30 % der Fläche, der Topf Heizung nach Fläche,
Warmwasser unverändert, kein Kürzungsbetrag (Auslegung, 15.1 Nr. 7).

Refs #99"
```

---

### Task 6: Oberfläche: Karte „Schätzung (§ 9a)“ mit Dialog, Ausweis, Ampel

**Files:**
- Create: `client/src/estimateForm.ts`, `client/src/estimateForm.test.ts`, `client/src/components/EstimateCard.tsx`, `client/src/components/EstimateCard.test.tsx`
- Modify: `client/src/components/SelfHeatingCards.tsx`, `client/src/heatingSelfView.ts`, `client/src/heatingSelfView.test.ts`, `client/src/notices.ts`

**Interfaces:**
- Consumes (Task 1, 2, 4; PR 10 Task 13): `hkvEstimateThreshold`, `valueAt`; `EstimateMethod`, `EstimatePart`, `SelfEstimateOption`, `SelfEstimateView`, `SelfPotView`, `SelfHeatingStatement`, `HeatingPlant`, `HeatingPeriodView`; Routen `PUT`/`DELETE …/estimates/:unitId/:part`; `api`, `errorText` (`client/src/api.ts`); `useToast`, `Term`; `potLines`, `userLine`.
- Produces:
  - `estimateForm.ts`: `METHOD_OPTIONS`, `EstimateForm`, `parseAmount(text): number | null`, `proposalValue(option, method, comparableUnitId): number | null`, `emptyEstimate(option, existing?)`, `thresholdLines(pot, option, threshold): string[]`, `estimateBody(form): { body } | { error }`, `WHY_TEXT`
  - `EstimateCard({ plant, view, self, onChanged })`

- [ ] **Step 1: Write the failing tests**

`client/src/estimateForm.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { emptyEstimate, estimateBody, parseAmount, proposalValue, thresholdLines } from './estimateForm'
import type { SelfEstimateOption, SelfPotView } from './types'

const option = (over: Partial<SelfEstimateOption> = {}): SelfEstimateOption => ({
  unitId: 'c', unitName: 'C', part: 'heat', areaM2: 60, why: 'noReading', boundary: '2025-12-31', estimated: false,
  proposals: [
    { method: 'buildingAverage', value: 12000, perM2: 200, why: 'ok' },
    { method: 'previousPeriod', value: null, perM2: null, why: 'noPrevious' },
    { method: 'comparableUnit', value: null, perM2: null, why: 'ok' },
  ],
  comparable: [{ unitId: 'a', unitName: 'A', perM2: 210, value: 12600 }],
  ...over,
})
const pot = (areaM2: number, estimatedAreaM2 = 0): SelfPotView => ({
  pot: 'heating', costCents: 0, consumptionPct: 70, byAreaOnly: false, areaM2, consumption: 0, consumptionUnit: 'kWh',
  baseCentsPerM2: 0, consumptionCentsPerUnit: null, overThreshold: false, estimatedAreaM2,
})

describe('Dialog der Schätzung (Heizung PR 13, Entwurf 8.7)', () => {
  it('Vorgabe ist der Durchschnitt des Gebäudes, vorbelegt mit dem Vorschlag', () => {
    expect(emptyEstimate(option())).toEqual({ method: 'buildingAverage', comparableUnitId: '', value: '12000', reason: '', confirmed: false })
  })
  it('vergleichbare Wohnung: der Wert der gewählten Wohnung; Vorperiode ohne Wert', () => {
    expect(proposalValue(option(), 'comparableUnit', 'a')).toBe(12600)
    expect(proposalValue(option(), 'comparableUnit', '')).toBeNull()
    expect(proposalValue(option(), 'previousPeriod', '')).toBeNull()
  })
  it('Zahlen in deutscher und technischer Schreibweise', () => {
    expect(parseAmount('12.000')).toBe(12000)
    expect(parseAmount('12000,5')).toBe(12000.5)
    expect(parseAmount('12.5')).toBe(12.5)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('zwölf')).toBeNull()
  })
  it('Begründung Pflicht, Wert ab 0', () => {
    expect(estimateBody({ method: 'buildingAverage', comparableUnitId: '', value: '12000', reason: ' ', confirmed: true })).toEqual({ error: expect.stringMatching(/Begründung/) })
    expect(estimateBody({ method: 'buildingAverage', comparableUnitId: '', value: '-1', reason: 'defekt', confirmed: true })).toEqual({ error: expect.stringMatching(/Zahl ab 0/) })
    expect(estimateBody({ method: 'buildingAverage', comparableUnitId: '', value: '12.000', reason: ' defekt ', confirmed: true })).toEqual({ body: { value: 12000, method: 'buildingAverage', reason: 'defekt', confirmed: true } })
  })
})

describe('Grenze des § 9a Abs. 2 vor dem Speichern (N5, Abweichung 9)', () => {
  it('rechnet den tatsächlichen Flächenanteil aus', () => {
    const lines = thresholdLines(pot(200), option(), 25)
    expect(lines[0]).toBe('Maßgeblich ist die Fläche der Wohnungen mit geschätztem Verbrauch, nicht ihre Zahl: mit dieser Schätzung 60 von 200 m², also 30 %.')
    expect(lines[1]).toMatch(/überschreitet 25 %.*ausschließlich nach Fläche.*§ 9a Abs\. 2/)
  })
  it('vier gleich große Wohnungen: genau 25 %, keine Überschreitung', () => {
    const lines = thresholdLines(pot(200), option({ areaM2: 50 }), 25)
    expect(lines[1]).toBe('Das sind genau 25 %, also keine Überschreitung; die Kosten werden weiter nach Verbrauch verteilt.')
  })
  it('kleine Wohnung darunter; schon geschätzte Fläche zählt mit', () => {
    expect(thresholdLines(pot(200), option({ areaM2: 40 }), 25)[1]).toBe('Das liegt unter 25 %; die Kosten werden weiter nach Verbrauch verteilt.')
    expect(thresholdLines(pot(200, 40), option({ areaM2: 40 }), 25)[0]).toMatch(/80 von 200 m², also 40 %/)
    expect(thresholdLines(pot(200, 60), option({ estimated: true }), 25)[0]).toMatch(/60 von 200 m², also 30 %/)
  })
  it('der Satz zu ungleich großen Wohnungen stimmt für jede Größe', () => {
    const last = thresholdLines(pot(200), option(), 25).at(-1) ?? ''
    expect(last).toMatch(/Bei vier gleich großen Wohnungen hat jede genau 25 %/)
    expect(last).toMatch(/Eine Wohnung mit mehr als 25 % der Fläche überschreitet die Grenze allein, und mehrere kleinere können es zusammen/)
  })
})
```

`client/src/components/EstimateCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import EstimateCard from './EstimateCard'
import type { HeatingPeriodView, HeatingPlant, SelfHeatingStatement } from '../types'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const self = {
  ok: false, heatPump: null, changeSplit: 'degreeDays', areaBasisHeat: 'area', hotWater: 'none', alpha: null, shares: null,
  pots: [{ pot: 'heating', costCents: 0, consumptionPct: 70, byAreaOnly: false, areaM2: 200, consumption: 28000, consumptionUnit: 'kWh', baseCentsPerM2: 0, consumptionCentsPerUnit: null, overThreshold: false, estimatedAreaM2: 0 }],
  units: [], threshold: null,
  estimates: [{ unitId: 'a', unitName: 'A', part: 'heat', value: 9000, method: 'previousPeriod', reason: 'Zähler defekt', confirmed: true, users: 1 }],
  estimateOptions: [
    { unitId: 'a', unitName: 'A', part: 'heat', areaM2: 60, why: null, boundary: null, estimated: true, proposals: [{ method: 'buildingAverage', value: 9500, perM2: 158.33, why: 'ok' }], comparable: [] },
    { unitId: 'c', unitName: 'C', part: 'heat', areaM2: 60, why: 'noReading', boundary: '2025-12-31', estimated: false, proposals: [{ method: 'buildingAverage', value: 12000, perM2: 200, why: 'ok' }], comparable: [] },
  ],
} as unknown as SelfHeatingStatement
const plant = { id: 'hp', method: 'self', hotWater: 'none' } as HeatingPlant
const view = { period: '2025-01', label: '2025', from: '2025-01-01' } as HeatingPeriodView

test('die Auswahl des Wegs zeigt den gespeicherten Weg', () => {
  render(<EstimateCard plant={plant} view={view} self={self} onChanged={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Schätzung von A ändern' }))
  expect((screen.getByLabelText('Weg nach § 9a Abs. 1') as HTMLSelectElement).value).toBe('previousPeriod')
})

test('fehlender Endstand: Dialog mit Vorschlag und Flächenanteil, Speichern geht an den Server', async () => {
  const calls: [string, string | undefined, string | undefined][] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    calls.push([String(url), init?.method, typeof init?.body === 'string' ? init.body : undefined])
    return new Response(JSON.stringify({}), { status: 200 })
  })
  const onChanged = vi.fn()
  render(<EstimateCard plant={plant} view={view} self={self} onChanged={onChanged} />)
  expect(screen.getByText(/C, Heizung: Stand fehlt zum 31\.12\.2025/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'C schätzen' }))
  expect((screen.getByLabelText('Geschätzter Verbrauch') as HTMLInputElement).value).toBe('12000')
  expect(screen.getByText(/60 von 200 m², also 30 %/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Begründung'), { target: { value: 'Wärmezähler defekt' } })
  fireEvent.click(screen.getByLabelText(/Der Wert ließ sich nicht mehr ablesen/))
  fireEvent.click(screen.getByRole('button', { name: 'Schätzung speichern' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(calls).toEqual([['/api/heating-plants/hp/periods/2025-01/estimates/c/heat', 'PUT', JSON.stringify({ value: 12000, method: 'buildingAverage', reason: 'Wärmezähler defekt', confirmed: true })]])
})
```

An `client/src/heatingSelfView.test.ts` anhängen:

```ts
describe('Ausweis mit Schätzung (Heizung PR 13)', () => {
  it('Topf über der Grenze: nur nach Fläche, mit Satz zu § 9a Abs. 2', () => {
    const lines = potLines({ pot: 'heating', costCents: 562800, consumptionPct: 0, byAreaOnly: false, areaM2: 200, consumption: 40000, consumptionUnit: 'kWh', baseCentsPerM2: 2814, consumptionCentsPerUnit: null, overThreshold: true, estimatedAreaM2: 60 })
    expect(lines).toContain('Geschätzt ist der Verbrauch für 60 von 200 m²; das überschreitet die Grenze des § 9a Abs. 2 HeizkostenV, deshalb nur nach Fläche verteilt.')
  })
  it('Nutzer mit geschätztem Verbrauch', () => {
    const u = { key: 'C1', role: 'tenancy' as const, tenancyId: 'C1', label: 'Mieter C1', from: '2025-01-01', to: '2025-09-30', days: 273, degreeDayPermille: 640, heatingConsumption: 7680, waterConsumption: null, heatingGroup: true, waterGroup: false, heatingCents: 0, waterCents: 0, heatingCo2Cents: 0, waterCo2Cents: 0, heatingEstimated: true }
    expect(userLine(u, { pots: [] })).toContain('Heizung 7.680 kWh (geschätzt nach § 9a, gemeinsam nach § 9b Abs. 3)')
  })
})
```

In den Testdaten von heatingSelfView.test.ts (PR 10, `self.pots`) bekommen beide Töpfe
`overThreshold: false, estimatedAreaM2: 0`, und `self` die Felder `estimates: [], estimateOptions: [],
threshold: null`, falls der Übersetzer sie verlangt.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- estimateForm EstimateCard heatingSelfView`
Expected: FAIL; `estimateForm` und `EstimateCard` fehlen, `potLines` kennt `overThreshold` nicht.

- [ ] **Step 3: Logik (`client/src/estimateForm.ts`)**

```ts
// Dialog der Schätzung nach § 9a HeizkostenV (Heizung PR 13, Entwurf 8.7, N5), ohne DOM prüfbar. Was der
// Server prüft, prüft er weiter; hier stehen die Sätze vorher und der Flächenanteil, der über die Grenze
// des § 9a Abs. 2 entscheidet.
import type { EstimateMethod, SelfEstimateOption, SelfPotView } from './types'

export const METHOD_OPTIONS: { value: EstimateMethod; label: string }[] = [
  { value: 'buildingAverage', label: 'Durchschnittsverbrauch des Gebäudes je m² (Vorgabe)' },
  { value: 'previousPeriod', label: 'Verbrauch derselben Wohnung in der vorigen Heizperiode' },
  { value: 'comparableUnit', label: 'Verbrauch einer vergleichbaren Wohnung in dieser Heizperiode, je m² umgerechnet' },
]
export const WHY_TEXT: Record<NonNullable<SelfEstimateOption['why']>, string> = {
  noReading: 'Stand fehlt',
  replacement: 'Endstand des alten Geräts beim Zählerwechsel fehlt',
  negative: 'Zähler zeigt weniger als vorher',
}

export type EstimateForm = { method: EstimateMethod; comparableUnitId: string; value: string; reason: string; confirmed: boolean }

// Eine Zahl in deutscher („12.000“, „12.000,5“) oder technischer Schreibweise („12000.5“). Ein Punkt
// ohne Komma ist nur dann ein Tausenderpunkt, wenn danach Dreiergruppen folgen.
export function parseAmount(text: string): number | null {
  const t = text.trim()
  if (t === '') return null
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t
  const n = Number(normalized)
  return Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(normalized) ? n : null
}

export function proposalValue(option: SelfEstimateOption, method: EstimateMethod, comparableUnitId: string): number | null {
  if (method === 'comparableUnit') return option.comparable.find((c) => c.unitId === comparableUnitId)?.value ?? null
  return option.proposals.find((p) => p.method === method)?.value ?? null
}

const round = (n: number): string => String(Math.round(n * 1000) / 1000)

export function emptyEstimate(option: SelfEstimateOption, existing?: { value: number; method: EstimateMethod; reason: string; confirmed: boolean }): EstimateForm {
  if (existing) return { method: existing.method, comparableUnitId: '', value: round(existing.value), reason: existing.reason, confirmed: existing.confirmed }
  const v = proposalValue(option, 'buildingAverage', '')
  return { method: 'buildingAverage', comparableUnitId: '', value: v === null ? '' : round(v), reason: '', confirmed: false }
}

const pct = (n: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: 1 })
const m2 = (n: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })

// Der tatsächliche Flächenanteil mit dieser Schätzung und was daraus folgt (§ 9a Abs. 2,
// „überschreitet“: streng größer). Der letzte Satz stimmt bei gleich und verschieden großen Wohnungen
// (Abweichung 9 des Plans).
export function thresholdLines(pot: SelfPotView, option: SelfEstimateOption, threshold: number): string[] {
  const estimated = pot.estimatedAreaM2 + (option.estimated ? 0 : option.areaM2)
  const share = pot.areaM2 > 0 ? (estimated * 100) / pot.areaM2 : 0
  const verdict = estimated * 100 > pot.areaM2 * threshold
    ? `Das überschreitet ${threshold} %: Die Kosten ${pot.pot === 'heating' ? 'der Heizung' : 'des Warmwassers'} werden dann ausschließlich nach Fläche verteilt (§ 9a Abs. 2 HeizkostenV).`
    : estimated * 100 === pot.areaM2 * threshold
      ? `Das sind genau ${threshold} %, also keine Überschreitung; die Kosten werden weiter nach Verbrauch verteilt.`
      : `Das liegt unter ${threshold} %; die Kosten werden weiter nach Verbrauch verteilt.`
  return [
    `Maßgeblich ist die Fläche der Wohnungen mit geschätztem Verbrauch, nicht ihre Zahl: mit dieser Schätzung ${m2(estimated)} von ${m2(pot.areaM2)} m², also ${pct(share)} %.`,
    verdict,
    `Bei vier gleich großen Wohnungen hat jede genau ${threshold} % und überschreitet die Grenze nicht. Eine Wohnung mit mehr als ${threshold} % der Fläche überschreitet die Grenze allein, und mehrere kleinere können es zusammen.`,
  ]
}

export function estimateBody(form: EstimateForm): { body: { value: number; method: EstimateMethod; reason: string; confirmed: boolean } } | { error: string } {
  const value = parseAmount(form.value)
  if (value === null || value < 0) return { error: 'Der geschätzte Verbrauch ist eine Zahl ab 0.' }
  const reason = form.reason.trim()
  if (reason === '') return { error: 'Bitte nennen Sie die Begründung, warum der Verbrauch nicht erfasst werden konnte (etwa „Wärmezähler defekt“).' }
  return { body: { value, method: form.method, reason, confirmed: form.confirmed } }
}
```

- [ ] **Step 4: Karte (`client/src/components/EstimateCard.tsx`)**

```tsx
import { useState } from 'react'
import type { EstimateMethod, HeatingPeriodView, HeatingPlant, SelfEstimateOption, SelfHeatingStatement } from '../types'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { emptyEstimate, estimateBody, METHOD_OPTIONS, proposalValue, thresholdLines, WHY_TEXT, type EstimateForm } from '../estimateForm'
import { hkvEstimateThreshold } from '../../../shared/law/heizkostenv.ts'
import { valueAt } from '../../../shared/law/register.ts'

const POT_TEXT = { heat: 'Heizung', water: 'Warmwasser' } as const
const POT_OF = { heat: 'heating', water: 'water' } as const

// Schätzung nach § 9a (Heizung PR 13): je Wohnung und Topf, was fehlt, die gespeicherten Schätzungen und
// der Dialog mit den Vorschlägen und dem Flächenanteil vor dem Speichern (N5).
export default function EstimateCard({ plant, view, self, onChanged }: {
  plant: HeatingPlant; view: HeatingPeriodView; self: SelfHeatingStatement; onChanged: () => void
}) {
  const toast = useToast()
  const [open, setOpen] = useState<SelfEstimateOption | null>(null)
  const [form, setForm] = useState<EstimateForm | null>(null)
  const [error, setError] = useState('')
  const threshold = valueAt(hkvEstimateThreshold, view.from)
  const url = (o: SelfEstimateOption) => `/api/heating-plants/${plant.id}/periods/${view.period}/estimates/${o.unitId}/${o.part}`
  const existingOf = (o: SelfEstimateOption) => self.estimates.find((e) => e.unitId === o.unitId && e.part === o.part)

  function start(o: SelfEstimateOption) {
    setOpen(o)
    setForm(emptyEstimate(o, existingOf(o)))
    setError('')
  }
  function choose(method: EstimateMethod, comparableUnitId: string) {
    if (!open || !form) return
    const v = proposalValue(open, method, comparableUnitId)
    setForm({ ...form, method, comparableUnitId, value: v === null ? form.value : String(Math.round(v * 1000) / 1000) })
  }
  async function save() {
    if (!open || !form) return
    const result = estimateBody(form)
    if ('error' in result) return setError(result.error)
    try {
      await api(url(open), { method: 'PUT', body: JSON.stringify(result.body) })
      toast('Schätzung gespeichert.')
      setOpen(null)
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }
  async function remove(o: SelfEstimateOption) {
    try {
      await api(url(o), { method: 'DELETE' })
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const needs = self.estimateOptions.filter((o) => o.why !== null || o.estimated)
  const pot = open ? self.pots.find((p) => p.pot === POT_OF[open.part]) : undefined
  return (
    <div className="card no-print">
      <h3><Term id="heatingEstimate">Schätzung (§ 9a)</Term></h3>
      <p className="muted">
        Geschätzt werden darf nur, wenn sich ein Wert nicht mehr ablesen lässt: das Gerät ist ausgefallen, oder ein anderer zwingender Grund liegt vor. Liegt eine Ablesung einige Tage neben dem Stichtag, gilt sie, wie sie ist.
      </p>
      {error && <div className="error">{error}</div>}
      {needs.length === 0 && <p>Keine Werte fehlen.</p>}
      <ul>
        {needs.map((o) => {
          const e = existingOf(o)
          return (
            <li key={`${o.unitId}:${o.part}`}>
              {o.unitName}, {POT_TEXT[o.part]}: {e
                ? `geschätzt ${e.value.toLocaleString('de-DE')} (${e.confirmed ? 'bestätigt' : 'nicht bestätigt'})`
                : `${o.why ? WHY_TEXT[o.why] : ''}${o.boundary ? ` zum ${o.boundary.slice(8, 10)}.${o.boundary.slice(5, 7)}.${o.boundary.slice(0, 4)}` : ''}`}
              {' '}
              {e
                ? <>
                  <button className="btn ghost" onClick={() => start(o)} aria-label={`Schätzung von ${o.unitName} ändern`}>Ändern</button>
                  <button className="btn ghost" onClick={() => remove(o)}>Entfernen</button>
                </>
                : <button className="btn ghost" onClick={() => start(o)} aria-label={`${o.unitName} schätzen`}>Schätzen</button>}
            </li>
          )
        })}
      </ul>
      <p className="muted">Ist ein Gerät defekt, obwohl alle Stände eingetragen sind, schätzen Sie über die Liste der Wohnungen darunter.</p>
      <ul>
        {self.estimateOptions.filter((o) => o.why === null && !o.estimated).map((o) => (
          <li key={`frei-${o.unitId}:${o.part}`}>
            {o.unitName}, {POT_TEXT[o.part]} <button className="btn ghost" onClick={() => start(o)} aria-label={`${o.unitName} schätzen`}>Schätzen</button>
          </li>
        ))}
      </ul>
      {open && form && (
        <div className="card">
          <h4>{open.unitName}, {POT_TEXT[open.part]}</h4>
          {pot && thresholdLines(pot, open, threshold).map((l) => <p key={l}>{l}</p>)}
          <label className="field">Weg nach § 9a Abs. 1
            <select value={form.method} onChange={(ev) => choose(ev.target.value as EstimateMethod, form.comparableUnitId)}>
              {METHOD_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          {form.method === 'comparableUnit' && (
            <label className="field">Vergleichbare Wohnung
              <select value={form.comparableUnitId} onChange={(ev) => choose('comparableUnit', ev.target.value)}>
                <option value="">Bitte wählen</option>
                {open.comparable.map((c) => <option key={c.unitId} value={c.unitId}>{c.unitName}</option>)}
              </select>
            </label>
          )}
          <label className="field">Geschätzter Verbrauch<input inputMode="decimal" value={form.value} onChange={(ev) => setForm({ ...form, value: ev.target.value })} /></label>
          <label className="field">Begründung<input value={form.reason} onChange={(ev) => setForm({ ...form, reason: ev.target.value })} /></label>
          <label className="check">
            <input type="checkbox" checked={form.confirmed} onChange={(ev) => setForm({ ...form, confirmed: ev.target.checked })} />
            Der Wert ließ sich nicht mehr ablesen (Geräteausfall oder anderer zwingender Grund, § 9a Abs. 1 HeizkostenV).
          </label>
          <div className="row">
            <button className="btn" onClick={save}>Schätzung speichern</button>
            <button className="btn ghost" onClick={() => setOpen(null)}>Abbrechen</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

(Ein Vorschlag ohne Wert belegt nichts vor; der Vermieter trägt dann selbst ein. Ist im Dialog die
vergleichbare Wohnung noch nicht gewählt, bleibt der bisherige Wert stehen.)

- [ ] **Step 5: Einbinden und Ausweis (`SelfHeatingCards.tsx`, `heatingSelfView.ts`)**

`client/src/components/SelfHeatingCards.tsx`: Import `import EstimateCard from './EstimateCard'`; direkt
hinter der Karte „Ablesungen“:

```tsx
      {self && <EstimateCard plant={plant} view={view} self={self} onChanged={onChanged} />}
```

`client/src/heatingSelfView.ts`, in `potLines` die Zeile
`if (p.byAreaOnly) lines.push('Kein Verbrauch erfasst: nur nach Fläche verteilt.')` ersetzen durch:

```ts
  if (p.overThreshold) lines.push(`Geschätzt ist der Verbrauch für ${num(p.estimatedAreaM2)} von ${num(p.areaM2)} m²; das überschreitet die Grenze des § 9a Abs. 2 HeizkostenV, deshalb nur nach Fläche verteilt.`)
  else if (p.byAreaOnly) lines.push('Kein Verbrauch erfasst: nur nach Fläche verteilt.')
```

In `userLine` die beiden Ausdrücke für den Verbrauch so fassen, dass eine Schätzung und die Gruppe in
einer Klammer stehen:

```ts
  const note = (estimated: boolean | undefined, group: boolean) =>
    estimated ? ` (geschätzt nach § 9a${group ? ', gemeinsam nach § 9b Abs. 3' : ''})` : group ? ' (gemeinsam nach § 9b Abs. 3)' : ''
  const parts = [`Heizung ${u.heatingConsumption === null ? 'nicht erfasst' : `${num(u.heatingConsumption)} kWh${note(u.heatingEstimated, u.heatingGroup)}`}, ${net(u.heatingCents, u.heatingCo2Cents)}`]
  if (self.pots.some((p) => p.pot === 'water')) {
    parts.push(`Warmwasser ${u.waterConsumption === null ? 'nicht erfasst' : `${num(u.waterConsumption)} m³${note(u.waterEstimated, u.waterGroup)}`}, ${net(u.waterCents, u.waterCo2Cents)}`)
  }
```

(Hat PR 12 die Einheit „kWh“ in `userLine` durch die Einheit des Topfs ersetzt, bleibt dessen Einheit; nur
die Klammer ändert sich.)

`client/src/notices.ts`: `'heating.estimated'` in `INFORMATIONAL` aufnehmen (Entwurf 10.1: „hint (färbt
nicht)“). `heating.estimate-over-25` und `heating.estimate-unconfirmed` färben nach ihrer Stufe.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix client test -- estimateForm EstimateCard heatingSelfView SelfHeatingCards notices && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/estimateForm.ts client/src/estimateForm.test.ts client/src/components/EstimateCard.tsx client/src/components/EstimateCard.test.tsx client/src/components/SelfHeatingCards.tsx client/src/heatingSelfView.ts client/src/heatingSelfView.test.ts client/src/notices.ts
git commit -m "Seite Heizkosten: Schätzung nach § 9a mit Vorschlägen und dem Flächenanteil vor dem Speichern

Der Dialog rechnet den tatsächlichen Anteil an der Fläche des Topfs aus und sagt, ob er die Grenze
überschreitet; der Satz zu gleich und verschieden großen Wohnungen stimmt für jede Größe.

Refs #99"
```

---

### Task 7: CHANGELOG, CLAUDE.md, Gesamtprüfung

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: CHANGELOG (`CHANGELOG.md`, Abschnitt „Unveröffentlicht“)**

Unter „Hinzugefügt“:

```markdown
- Eigene Heizkostenabrechnung: Fällt ein Zähler aus oder lässt sich ein Wert nicht mehr ablesen,
  schätzen Sie den Verbrauch der Wohnung auf der Seite Heizkosten nach einem der drei Wege des § 9a
  HeizkostenV (vorbelegt: Durchschnitt des Gebäudes je m²), mit Begründung und Bestätigung. Betrifft
  die Schätzung mehr als 25 % der Fläche, verteilt Mietfuchs die Kosten dieses Topfs nur nach Fläche;
  der Dialog nennt den Flächenanteil vorher. ([#99](https://github.com/speedone/mietfuchs/issues/99))
```

Unter „Geändert“:

```markdown
- Der Fehler „Heizkostenabrechnung unvollständig“ bei einem fehlenden Stand, einem Zählerwechsel ohne
  Endstand oder negativem Verbrauch verweist jetzt auf die Schätzung statt auf eine spätere Version.
  ([#99](https://github.com/speedone/mietfuchs/issues/99))
```

- [ ] **Step 2: CLAUDE.md**

Im Abschnitt der Berechnungs-Engine hinter dem Absatz zur eigenen Heizkostenabrechnung (PR 10), als
eigener Absatz:

```markdown
- **Schätzung nach § 9a** (Heizung PR 13): Tabelle `heating_estimates` (Heizperiode, Wohnung, Topf
  `heat`/`water`, Wert, Weg, Begründung Pflicht, Bestätigung). Eine Schätzung ersetzt in `planSelf`
  die Ablesungen dieser Wohnung in diesem Topf, auch vollständige (sie ist die Markierung
  „unbrauchbar“); mehrere Nutzer der Wohnung teilen sie wie nach § 9b Abs. 3. Überschreitet die
  geschätzte Fläche eines Topfs die Grenze `hkv.estimate-threshold` (streng größer, über Produkte
  verglichen, je Topf, Heizung mit der Fläche nach § 7 Abs. 1 Satz 5), wird der Topf nur nach Fläche
  verteilt, ohne Kürzungsbetrag (Auslegung, Entwurf 15.1 Nr. 7). Keine Schätzung für eine Wohnung ohne
  Gerät (Ausstattungspflicht) und nie wegen verschiedener Ablesetage. Die Vorschläge
  (`estimateProposals`) rechnen die Vorperiode neu, nur bei gleicher Länge.
```

- [ ] **Step 3: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS, Exit-Status 0.

Run: `node scripts/umstieg-praxislauf.mjs`
Expected: alle Fälle bestanden (die neue Tabelle ist leer; Backup und Wiederherstellen nehmen sie über
`VACUUM INTO` mit).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "Doku: Schätzung nach § 9a in CHANGELOG und CLAUDE.md

Refs #99"
```

- [ ] **Step 5: Durchsicht mit frischem Kontext vor dem PR** (CLAUDE.md): Befunde mit einem Test
  beheben, der vorher rot war; PR mit `Refs #99`, gestapelt auf PR 12, Abweichungen 1 bis 10 in der
  Beschreibung.

---

## Selbstprüfung

**Abdeckung des Entwurfs:**

| Anforderung | Task |
|---|---|
| 8.7 „Wann“: Gerät defekt, Wert fehlt zu Beginn oder Ende, Zählerwechsel ohne Endstand, negativer Verbrauch, als unbrauchbar markiert; nicht: verschiedene Ablesetage | 3 (Plan), 5 (Text nur bei `noReading`, `replacement`, `negative`), Abweichung 3 und 4 |
| 8.7 drei Wege, Vorgabe Durchschnitt je m², Methode und Begründung gespeichert | 2, 3, 4, 6 |
| 8.7 Bestätigung: unbestätigt warning, bestätigt hint | 5 |
| 8.7 Schwelle „überschreitet 25 %“, je Topf, keine Kürzung nach § 12 | 1, 3, 5 |
| 8.7 Text der Oberfläche mit tatsächlichem Anteil (N5), richtig bei ungleich großen Wohnungen | 6 (`thresholdLines`), 1 (Lexikon) |
| 5.6 `heating_estimates` mit PK `(heating_period_id, unit_id, part)` | 2 |
| 5.8 Schätzungen im Schnappschuss; 5.9 Wiederherstellen | 2 |
| 8.8 Schätzungen mit Methode im Ausweis | 5 (`estimates`), 6 (`potLines`, `userLine`) |
| 10.1 drei Codes, 10.2 Regel, 10.3 Begriff | 1, 5 |
| 12.2 „40 % → Fläche; 20 % → bleibt“, R-A22 | 3 |
| 12.4 Client: 25-%-Warnung vor dem Markieren | 6 |
| 14.1 Geräteausfall | alle |
| 15.1 Nr. 6, 7 | 3, 5 |

**Platzhalter:** keine „TBD“, „später“ nur als Hinweis auf andere PRs; jeder Code-Schritt mit Code.

**Namen:** `estimateKey`, `estimateProposals`, `estimateDeviceType`, `POT_OF_PART`, `PART_OF_POT`,
`heatingEstimates`, `readHeatingEstimates`, `saveEstimate`, `removeEstimate`, `thresholdLines`,
`estimateBody`, `emptyEstimate`, `proposalValue`, `parseAmount` sind in Task 2 bis 6 durchgehend gleich;
`SelfPlan['totals'][pot].estimatedArea` und `.overThreshold` in Task 3 eingeführt und in Task 5 und 6
gelesen; `SelfPotView.overThreshold`, `.estimatedAreaM2` in Task 2 und 5.

**Review Focus:** jede der fünf Zeilen hat ihren Test (Task 3, 4, 5, 6).

**Nicht in diesem Plan:** § 6a, § 11, § 2, § 10 und der Hinweis zu § 7 Abs. 1 Satz 2 (PR 14); die
monatliche Verbrauchsinformation (PR 14, PR 22); Vorerfassung nach Nutzergruppen (§ 5 Abs. 7, #218).
