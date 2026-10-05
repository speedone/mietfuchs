# F15 Techem-Muster mit Vorwegabzug

Beispiel A des Entwurfs (7.4). Ein Haus mit vier Wohnungen à 50 m², je ein Mieter seit 2020, eine
Gasheizung, abgerechnet von einem Messdienst im Kalenderjahr 2025. Die Kostenaufstellung nennt
„Anlieferung Brennstoff 3.540,00 €“, darunter „Abzüglich CO₂-Kosten Vermieter −87,50 €“ (250,00 € ·
35 %), und als Summe der Nutzerkosten Heizungsanlage S = 3.845,51 €. Die Summe und die CO₂-Zeilen
stammen aus dem Techem-Muster; die Aufteilung auf die vier Nutzer ist erfunden:

| Mieter | Einzelbetrag |
|---|---|
| Mieter 1 (W1) | 1.103,27 € |
| Mieter 2 (W2) | 958,64 € |
| Mieter 3 (W3) | 1.014,85 € |
| Mieter 4 (W4) | 768,75 € |
| zusammen | 3.845,51 € |

CO₂-Seite: 46,4 kg CO₂ je m², Anteil des Vermieters 35 %, CO₂-Kosten 250,00 €, davon Vermieter
87,50 €. Zahl der Nutzeinheiten 4.

## Herleitung

**Betrag der Position.** Bezahlt hat der Vermieter die Kosten vor dem Abzug: S + L = 3.845,51 € +
87,50 € = 3.933,01 € (Entwurf 7.1, #209).

**Probe** (7.3). Vorwegabzug: Betrag = S + L verlangt, 3.933,01 € = 3.933,01 €. Eingetragene
Einzelbeträge 3.845,51 € ≤ S + 4 · 2 ct. Bestanden.

**Verteilung.** Jeder Mieter trägt seinen Einzelbetrag unverändert; der Rest der Position, 87,50 €,
ist der CO₂-Anteil des Vermieters (`co2Share`). Keine selbstgenutzte Wohnung, also kein L_self.

**Steuer.** Werbungskosten 3.933,01 €, privat 0 €.

**Nachstufung** (9.2). 46,4 kg liegen in der Stufe 42 bis unter 47 kg mit 70 %. Der Messdienst nennt
35 %: Im Muster ist der Anteil nach § 9 CO2KostAufG halbiert. Mietfuchs kennt Einschränkungen nach
§ 9 erst mit PR 7 und meldet deshalb `co2.stage-mismatch` (Hinweis ohne Rechtsfolge), der § 8 und § 9
als mögliche Gründe nennt. Das ist erwartet und steht im Test.
