# Nebenkostenabrechnung

Lokales Web-Tool für die Nebenkostenabrechnung privater Vermieter. Alle Daten bleiben auf dem
eigenen Rechner — keine Cloud, kein Konto, keine externen Dienste.

## Start

```powershell
npm install        # einmalig: installiert Server + Client
npm run dev        # startet Server (Port 3001) und Oberfläche (http://localhost:5173)
```

Tests der Berechnungs-Engine: `npm test`

## Funktionsweise

1. **Stammdaten**: Haus, alle Wohnungen (auch die selbstgenutzte — sie wird als „nicht an der
   Kostenverteilung beteiligt" markiert) und Mietverhältnisse. Personenzahl und Vorauszahlung
   werden als **Staffel** geführt („ab X gilt Y") — Geburt, Auszug einzelner Personen oder
   Vorauszahlungs-Erhöhungen brauchen kein neues Mietverhältnis.
2. **Kosten & Belege**: Rechnungen pro Abrechnungsjahr erfassen — manuell oder per
   KI-Belegauswertung. Eine Rechnung kann in mehrere Positionen mit unterschiedlichen
   Umlageschlüsseln zerlegt werden (z. B. Wasserrechnung: Grundgebühr + Verbrauch).
   Optional pro Position: **Lohnanteil nach §35a EStG** (wird dem Mieter bescheinigt).
3. **Zähler**: Zähler (Haupt- und Wohnungszähler) mit Ablesungen — Jahresablesung,
   Zwischenablesung beim Mieterwechsel (exakte Aufteilung), Zählerwechsel (Endstand alt +
   Startstand neu) mit Plausibilitätswarnung bei negativem Verbrauch.
4. **Abrechnung**: Pro Mieter die fertige Abrechnung mit Kostenaufstellung, Umlageschlüssel,
   Vorauszahlungen, Saldo, Zahlungsaufforderung (IBAN/Frist aus den Einstellungen),
   §35a-Bescheinigung und Vorschlag zur Vorauszahlungsanpassung (§560 BGB). Dazu eine
   Erinnerung an die 12-Monats-Abrechnungsfrist (§556 BGB). Über „Drucken / PDF" speichern.

### Umlageschlüssel

- **Wohnfläche** (gesetzlicher Standard nach §556a BGB)
- **Personenzahl** (personentagesgenau, inkl. Personen-Staffel)
- **Wohneinheiten**
- **Verbrauch (Zähler)** — Anteil = Verbrauch der Wohnung ÷ Summe aller Wohnungszähler;
  nur wählbar, wenn Wohnungszähler existieren
- **Direktzuordnung** an eine Wohnung

Korrekturen der tatsächlich gezahlten Vorauszahlungen (z. B. ausgefallene Zahlung) direkt
in der Abrechnung über „✎ anpassen".

Verteilt wird nur auf Wohnungen, die als „beteiligt" markiert sind. Zeiträume ohne Mieter
(Leerstand) sowie Positionen der Kategorie „Nicht umlagefähig" trägt der Vermieter. Alle
Beträge werden intern in Cent gerechnet und centgenau verteilt (Hare-Verfahren).

Die Abrechnung folgt dem **Abflussprinzip**: Eine Kostenposition gehört zu dem Jahr, dem sie
beim Erfassen zugeordnet wird (in der Regel das Zahlungsjahr).

### KI-Belegauswertung (optional)

Unter *Einstellungen* eine lokale [Ollama](https://ollama.com)-Instanz konfigurieren
(Standard: `http://localhost:11434`, Modell `qwen3.6-35b`). PDFs mit Textebene funktionieren
mit jedem Sprachmodell; fotografierte Belege benötigen ein Vision-Modell. Die KI macht nur
Vorschläge — übernommen wird erst nach manueller Prüfung.

## Daten & Backup

Alles liegt in `server/data/` (`db.json` + hochgeladene Belege in `uploads/`).
Backup = diesen Ordner kopieren.

## Produktivbetrieb ohne Dev-Server

```powershell
npm run build      # baut das Frontend nach client/dist
npm start          # Server liefert App + API auf http://localhost:3001
```
