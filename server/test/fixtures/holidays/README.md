# Vergleichsliste: gesetzliche Feiertage je Bundesland

`python-holidays.json` enthält die gesetzlichen Feiertage aller 16 Länder und ihrer regionalen
Varianten von 1995 bis 2100, erzeugt mit der Python-Bibliothek
[holidays](https://github.com/vacanza/holidays) 0.104. Sie ist unabhängig von den Feiertagen im Rechtsregister
([shared/law/feiertagsgesetze.ts](../../../../shared/law/feiertagsgesetze.ts)), mit denen
[shared/holidays.ts](../../../../shared/holidays.ts) rechnet;
[holidays.test.ts](../../holidays.test.ts) vergleicht beide für jedes Jahr und jede Variante.

Python wird nur zum Erzeugen dieser Datei gebraucht, weder für die Tests noch zur Laufzeit.

## Varianten

| Variante | `holidays` | Mietfuchs |
|---|---|---|
| `BB` … `TH` | Land, Kategorie *public* | `holidaysOf(Jahr, Land)` |
| `BY:catholic` | `BY` mit *catholic* | Bayern plus Mariä Himmelfahrt aus `localHolidaysOf` |
| `Augsburg` | `Augsburg` | Bayern plus Mariä Himmelfahrt und Friedensfest aus `localHolidaysOf` |
| `SN:catholic` | `SN` mit *catholic* | Sachsen plus Fronleichnam aus `localHolidaysOf` |
| `TH:catholic` | `TH` mit *catholic* | Thüringen plus Fronleichnam aus `localHolidaysOf` |

Die Kategorie *catholic* ergänzt in Bayern Mariä Himmelfahrt, in Sachsen und Thüringen
Fronleichnam: die Feiertage, die nach Landesrecht nur in einem Teil der Gemeinden gelten.
Mietfuchs kennt die Gemeinde nicht und zählt sie deshalb nicht mit, sondern nennt sie als Hinweis.
Das ist die einzige gewollte Abweichung, und der Test benennt sie.

Der Zeitraum beginnt 1995; früher rechnet Mietfuchs keine Feiertage (`FIRST_YEAR`).

## Format

Je Variante eine Liste von Schlüsseln:

- `MM-TT` — fester Tag, etwa `10-03` für den Tag der Deutschen Einheit
- `O±n` — `n` Tage nach dem Ostersonntag, etwa `O-2` Karfreitag, `O+60` Fronleichnam. Die
  Osterdaten stehen unter `ostern` (nach `dateutil.easter`).
- `@…` — gilt nur in diesen Jahren, etwa `03-08@2019-2100` (Frauentag in Berlin seit 2019)
  oder `10-31@2017` (Reformationstag 2017 einmalig in allen Ländern)

Ein Schlüssel ohne `@` gilt in jedem Jahr. Die Schreibweise ist verlustfrei: `generate.py`
prüft beim Erzeugen, dass sich aus den Schlüsseln wieder genau die Tage der Bibliothek ergeben.

## Neu erzeugen

Außerhalb des Repositorys, etwa in einem temporären Ordner:

```
python3 -m venv venv
venv/bin/pip install holidays==0.104 python-dateutil==2.9.0.post0
venv/bin/python server/test/fixtures/holidays/generate.py
```

Mit diesen Fassungen entsteht die Datei byteweise gleich. Eine neue Version von `holidays` kann
Abweichungen zeigen. Dann wird nicht geraten: Maßgeblich ist das Feiertagsgesetz des Landes, und
die Entscheidung steht als Fassung mit Fundstelle im Register und im Test.

## Ergebnis des Vergleichs

Für alle 16 Länder und alle Jahre von 1995 bis 2100 stimmt das Register mit der Liste überein,
einschließlich der einmaligen Feiertage (Reformationstag 2017 in allen Ländern, in Berlin der
8. Mai 2020 und 2025 und der 17. Juni 2028). Die vier regionalen Varianten ergeben sich genau aus
Land plus Hinweisen.

Eine gemeinsame Abweichung beider vom Gesetz ist ohne Folgen: In Hessen sind alle Sonntage
gesetzliche Feiertage (§ 1 HFeiertagsG), also auch Oster- und Pfingstsonntag. Beide führen diese
nur für Brandenburg. Für Fristen nach Werktagen spielt das keine Rolle, ein Sonntag ist nie Werktag.
