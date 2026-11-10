# Herkunft der Beispielrechnungen

Die XML-Dateien in diesem Ordner stammen unverändert aus der Testsuite der KoSIT (Koordinierungsstelle für
IT-Standards) für die XRechnung:

- Quelle: https://github.com/itplr-kosit/xrechnung-testsuite, Ordner `src/test/business-cases/standard/`
- Stand: Commit `1ce1dafffd035e5ce59a7ab0d3bf44ac14af16c9` (abgerufen am 10.11.2026)
- Lizenz: Apache License 2.0, https://www.apache.org/licenses/LICENSE-2.0

Es sind Testrechnungen mit Platzhaltern, keine echten Rechnungen. Sie prüfen, dass Mietfuchs die Felder an den Stellen
liest, an denen die Norm sie vorsieht, unabhängig vom eigenen Testbauer (server/testing/eInvoiceXml.ts).

| Datei | Warum |
| --- | --- |
| 03.01a-INVOICE_ubl.xml, 03.01a-INVOICE_uncefact.xml | Versorger-Jahresrechnung: 19 % und 7 %, Abschläge (BT-113), Lastschrift, Einheiten KWH und DAY |
| 03.06a-INVOICE_ubl.xml, 03.06a-INVOICE_uncefact.xml | negative Position, Gruppe mit negativer Bemessungsgrundlage, Einheit HUR |
| 02.03a-INVOICE_ubl.xml | Zu- und Abschläge auf Dokumentebene, zweites BT-110 in GBP, voll vorausbezahlt |
| 01.18a-INVOICE_ubl.xml | korrigierte Rechnung (384) mit Bezug auf die Vorgängerrechnung |
