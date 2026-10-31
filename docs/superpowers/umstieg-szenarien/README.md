# Umstiegslauf 0.13.1 → main

Praxisszenarien für den Umstieg von einer veröffentlichten Fassung auf `main`, entstanden vor 0.14.0.
Die Skripte legen mit **v0.13.1** über die HTTP-API vier Objekte an, so wie die Oberfläche sendet:

- **A, Birkenstraße 8**: Mehrfamilienhaus mit Mieterwechsel, Leerstand und Zählern, Messdienst mit CO₂,
  Abzug Betriebsstrom, Gutschrift, abgeschlossene Jahre, Zahlungen mit Rückständen.
- **B, Am Mühlbach 3**: Wechsel auf 1.7.–30.6. mit aufgeteilten Rechnungen, Beleg, § 35a und
  doppelt erfasster Rechnung.
- **C, Lerchenweg 14**: eigene Heizkostenabrechnung nach HeizkostenV.
- **D, Parkallee 21 WE 5**: vermietete Eigentumswohnung mit Hausgeldabrechnung.

Danach startet `main` auf demselben Datenordner (die Migration läuft) und in einem frischen Ordner mit dem
Backup aus 0.13.1. Jede Abrechnung, das Mietkonto, die Steuer, das Steuer-ZIP und der Verbrauch werden
verglichen; Geldfelder müssen centgenau gleich bleiben.

Jeder Serverstart setzt einen Wegwerf-Ordner (`NKA_DATA_DIR`), `CI=1` und eine geschlossene
`NKA_UPDATE_URL` (siehe `lib.mjs`). Ports 3411–3426.

## Ablauf

```bash
cd docs/superpowers/umstieg-szenarien
git worktree add v0131 v0.13.1        # Stand vorher (anderen Tag einsetzen für den nächsten Umstieg)
git worktree add main origin/main     # Stand nachher
(cd v0131 && npm install) && (cd main && npm install)
./run-upgrade.sh                      # a) anlegen und Schnappschuss, b) Umstieg, c) Backup einspielen, Vergleiche
cp -a data/main-upgrade data/d && node phase-d.mjs data/d snap/d.json   # d) neues Verhalten, auf einer Kopie
node compare-change.mjs               # derselbe Wechsel hin und zurück auf beiden Fassungen
python3 -I integrity.py data/main-upgrade/mietfuchs.sqlite
```

Ergebnisse stehen in `snap/diff-*.json` (jede Abweichung mit Pfad und Art, Geldfelder markiert). `data/`,
`snap/`, `v0131/` und `main/` sind ignoriert. Zum Schluss die Worktrees wieder entfernen
(`git worktree remove v0131 main`).

`repro.mjs [1|2|3]` enthält die Reproduktionen der Befunde vor 0.14.0 (behoben in #479 und #480). Für
den nächsten Lauf als Vorlage gedacht; nach einem neuen Release den Tag in den Worktrees anpassen und
`seed.mjs` um die neuen Funktionen ergänzen (für 0.14.0 etwa § 82b, Entnahme Erhaltungsrücklage, Zahlungen
mit bestimmtem Monat).
