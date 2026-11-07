# Mietfuchs entwickeln

Wie du mitmachst (Ablauf, Konventionen, Änderungen an der Berechnung), steht in
[CONTRIBUTING.md](../CONTRIBUTING.md), Architektur und Fallstricke in [CLAUDE.md](../CLAUDE.md).

## Aus dem Quellcode starten

Dafür braucht es **Node 24.15 oder neuer**. Server und Oberfläche sind in TypeScript
geschrieben, und der Server wird nicht gebaut: Node führt die Dateien unmittelbar aus und
streift die Typen dabei ab. Das gilt erst ab dieser Version als stabil. Wer Mietfuchs als
Programm für Windows und macOS, als Programmdatei, als Linux-Paket oder im Docker-Image nutzt,
braucht kein Node, dort ist die Laufzeit schon dabei.

```powershell
npm install        # einmalig: installiert Server + Client
npm run dev        # startet Server (Port 3001) und Oberfläche (http://localhost:5173)
```

`npm run dev` lauscht nur auf diesem Rechner (`NKA_HOST=127.0.0.1` aus `server/dev.env`), deshalb
fragt Mietfuchs dabei nicht nach einem Passwort. Eine gesetzte Variable geht der Datei vor: Mit
`NKA_HOST=0.0.0.0` probierst du die Anmeldung aus, der Einrichtungscode steht dann in der Konsole und
in `server/data/einrichtungscode.txt`.

Tests der Berechnungs-Engine: `npm test`. Typen prüfen: `npm run typecheck`. Wer für eine Prüfung
selbst einen Server startet, setzt neben `NKA_DATA_DIR`, `CI=1` und `NKA_UPDATE_URL` auch
`NKA_HOST=127.0.0.1`, sonst verlangt der frische Datenordner ein Passwort. `startServerIn` und
`startServerRaw` in `server/testing/api.ts` tun das schon; ein Test, der das Netz oder die Anmeldung
prüft, setzt `NKA_HOST: '0.0.0.0'` (und bei Bedarf `NKA_AUTH`) und meldet sich mit `signIn` an
(Passwort über den Einrichtungscode festlegen, danach ein `fetch` mit Cookie).
Die Bildschirmfotos in [docs/screenshots](screenshots) erzeugt `npm run screenshots` neu (einmalig vorher
`npx playwright install chromium`).

Das Programmfenster für Windows und macOS (Electron) liegt in `desktop/`, einem eigenen Paket, das
`npm install` nicht mitinstalliert:

```powershell
npm --prefix desktop install   # einmalig
npm run build                  # die Oberfläche, die das Fenster zeigt (client/dist)
npm run desktop                # Fenster mit dem Server aus dem Quellcode, Daten in server/data
```

Electron lädt seine Programmdatei beim ersten `npm run desktop`.

Eigenständige Binaries selbst bauen (benötigt [Bun](https://bun.com)): `npm run package` →
legt die Dateien für alle Plattformen in `dist-bin/` ab.

## Produktivbetrieb ohne Dev-Server

```powershell
npm run build      # baut das Frontend nach client/dist
npm start          # Server liefert App + API auf http://localhost:3001
```

`npm start` lauscht ohne `NKA_HOST` auf allen Adressen und fragt deshalb bei einem neuen Datenordner
nach einem Passwort; der Einrichtungscode steht in der Konsole und in `einrichtungscode.txt` im
Datenordner. Alles zur Anmeldung (`NKA_AUTH`, Proxy, Zurücksetzen) steht in
[Installation](installation.md#linux-installationspaket-mit-startmenü-eintrag) und
[Docker](docker.md#zuerst-sicherheit).
