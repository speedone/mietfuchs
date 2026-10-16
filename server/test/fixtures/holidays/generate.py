"""Erzeugt python-holidays.json, die Referenz für server/test/holidays.test.ts.

Quelle ist die Python-Bibliothek `holidays`, unabhängig von den Feiertagen im Rechtsregister
(shared/law/feiertagsgesetze.ts), mit denen Mietfuchs rechnet. Python wird nur hier gebraucht, nie zur Laufzeit und nicht für die
Tests. Aufruf und Format stehen in README.md.
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import holidays
from dateutil.easter import easter
from holidays.constants import CATHOLIC, PUBLIC

FIRST, LAST = 1995, 2100
YEARS = range(FIRST, LAST + 1)
STATES = ["BB", "BE", "BW", "BY", "HB", "HE", "HH", "MV", "NI", "NW", "RP", "SH", "SL", "SN", "ST", "TH"]

# Variante → (Unterteilung, Kategorien) in `holidays`. CATHOLIC ergänzt in Bayern Mariä
# Himmelfahrt, in Sachsen und Thüringen Fronleichnam; „Augsburg" ist Bayern mit Mariä
# Himmelfahrt und dem Friedensfest.
VARIANTS = {s: (s, (PUBLIC,)) for s in STATES}
VARIANTS |= {
    "BY:catholic": ("BY", (PUBLIC, CATHOLIC)),
    "SN:catholic": ("SN", (PUBLIC, CATHOLIC)),
    "TH:catholic": ("TH", (PUBLIC, CATHOLIC)),
    "Augsburg": ("Augsburg", (PUBLIC,)),
}


def keys_of(d: date):
    """Mögliche Schreibweisen eines Datums: fester Tag „MM-TT" oder Abstand zu Ostern „O±n"."""
    yield d.strftime("%m-%d")
    offset = (d - easter(d.year)).days
    if -50 <= offset <= 70:
        yield f"O{offset:+d}"


def resolve(key: str, year: int) -> date:
    if key.startswith("O"):
        return easter(year) + timedelta(days=int(key[1:]))
    return date(year, int(key[:2]), int(key[3:]))


def ranges(years):
    """[1995, 1996, 1997, 2017] → '1995-1997,2017'"""
    out, start, prev = [], None, None
    for y in sorted(years):
        if start is None:
            start = prev = y
        elif y == prev + 1:
            prev = y
        else:
            out.append(f"{start}-{prev}" if prev > start else f"{start}")
            start = prev = y
    out.append(f"{start}-{prev}" if prev > start else f"{start}")
    return ",".join(out)


def encode(by_year: dict[int, set[date]]) -> list[str]:
    """Kompakte, verlustfreie Schreibweise: wenige Schlüssel mit den Jahren, in denen sie gelten.
    Gierig nach Abdeckung; der Rundlauf wird unten geprüft."""
    years_of: dict[str, set[int]] = {}
    for year, days in by_year.items():
        for d in days:
            for k in keys_of(d):
                years_of.setdefault(k, set()).add(year)
    open_pairs = {(y, d) for y, days in by_year.items() for d in days}
    # Zuerst alles, was in jedem Jahr gilt. Diese Schlüssel dürfen sich überschneiden: 2008 fiel
    # Christi Himmelfahrt auf den 1. Mai, beide bleiben ohne Jahresangabe.
    chosen = [(k, ys) for k, ys in years_of.items() if ys == set(YEARS)]
    for k, _ in chosen:
        open_pairs -= {(y, resolve(k, y)) for y in YEARS}
    # Dann gierig nach Abdeckung, fester Tag vor Osterabstand. Ein Schlüssel nennt nur Jahre,
    # die noch offen sind: Fällt Christi Himmelfahrt auf den 8. Mai, erscheint das Jahr nicht
    # zusätzlich beim Berliner 8. Mai.
    rest = [k for k, ys in years_of.items() if ys != set(YEARS)]
    for k in sorted(rest, key=lambda k: (-len(years_of[k]), k.startswith("O"), k)):
        covers = {(y, resolve(k, y)) for y in years_of[k]} & open_pairs
        if not covers:
            continue
        open_pairs -= covers
        chosen.append((k, {y for y, _ in covers}))
    assert not open_pairs
    # Lesbare Reihenfolge: erst die Feiertage aller Jahre (feste Tage, dann nach Ostern), danach
    # die mit begrenzter Geltung
    chosen.sort(key=lambda c: (c[1] != set(YEARS), c[0].startswith("O"), int(c[0][1:]) if c[0].startswith("O") else 0, c[0]))
    return [k if ys == set(YEARS) else f"{k}@{ranges(ys)}" for k, ys in chosen]


def decode(tokens: list[str]) -> dict[int, set[date]]:
    out = {y: set() for y in YEARS}
    for t in tokens:
        key, _, yrs = t.partition("@")
        years = set(YEARS)
        if yrs:
            years = set()
            for part in yrs.split(","):
                a, _, b = part.partition("-")
                years |= set(range(int(a), int(b or a) + 1))
        for y in years:
            out[y].add(resolve(key, y))
    return out


def wrap(items, indent, width=96):
    """JSON-Liste über mehrere Zeilen, damit die Datei im Diff lesbar bleibt."""
    lines, line = [], ""
    for s in (json.dumps(i, ensure_ascii=False) for i in items):
        if line and len(indent) + len(line) + len(s) + 2 > width:
            lines.append(line.rstrip())
            line = ""
        line += s + ", "
    lines.append(line.rstrip(", "))
    if len(lines) == 1:
        return "[" + lines[0] + "]"
    return "[\n" + ",\n".join(indent + "  " + l.rstrip(",") for l in lines) + "\n" + indent + "]"


def dump(fixture):
    out = ["{"]
    out.append(f'  "quelle": {json.dumps(fixture["quelle"], ensure_ascii=False)},')
    out.append(f'  "jahre": {json.dumps(fixture["jahre"])},')
    out.append(f'  "ostern": {wrap(fixture["ostern"], "  ")},')
    out.append('  "varianten": {')
    names = list(fixture["varianten"])
    for i, name in enumerate(names):
        comma = "," if i < len(names) - 1 else ""
        out.append(f'    {json.dumps(name)}: {wrap(fixture["varianten"][name], "    ")}{comma}')
    out.append("  }")
    out.append("}")
    text = "\n".join(out) + "\n"
    assert json.loads(text) == fixture
    return text


def main():
    variants = {}
    for name, (subdiv, categories) in VARIANTS.items():
        cal = holidays.country_holidays("DE", subdiv=subdiv, categories=categories, years=YEARS)
        by_year = {y: set() for y in YEARS}
        for d in cal:
            by_year[d.year].add(d)
        tokens = encode(by_year)
        assert decode(tokens) == by_year, name
        variants[name] = tokens

    fixture = {
        "quelle": f"Python-Bibliothek holidays {holidays.__version__}, Ostern nach dateutil.easter; erzeugt mit generate.py",
        "jahre": [FIRST, LAST],
        "ostern": [easter(y).isoformat() for y in YEARS],
        "varianten": variants,
    }
    Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).with_name("python-holidays.json")).write_text(dump(fixture), encoding="utf-8")


if __name__ == "__main__":
    main()
