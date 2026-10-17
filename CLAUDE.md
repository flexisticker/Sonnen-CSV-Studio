# Steuer-Studio (früher Sonnen-CSV-Studio) – Projektgedächtnis

Kunde: Flexisticker (Michael), Kommunikation auf **Deutsch, Du-Form**. Gleicher Kunde wie Flex-Studio (`flexisticker/tassenanimierer`),
Arbeitsweise siehe dort: Pläne erst erklären, bei „leg los“ ohne Rückfragen bauen; am Ende kurz: was gebaut, wie bedienen, was offen;
Docker-Update in Unraid erwähnen. **Keine Zugangsdaten und keine echten Verbrauchsdaten ins Repo – das Repo ist öffentlich.**

## Zweck

Auswertung der sonnenBatterie-Exporte → Dashboard + PDF für Steuerberater/Finanzamt. Kernfall: PV-Anlage ca. 2015/2016 mit
Vorsteuerabzug gekauft, gehört zum Unternehmen → **privater Eigenverbrauch = unentgeltliche Wertabgabe, 19 % USt**
(gilt unabhängig vom Alter; Nullsteuersatz 2023 betrifft nur neue Anlagen). Firma und Haushalt am selben Zähler →
**Firmenanteil als Pauschale** (Prozent oder kWh/Jahr, Wert vom Steuerberater). Stromlieferant **EnBW** (Grün und Sicher Privatstrom,
Rechnung 02/2024–01/2025: 28,76 ct/kWh netto, Grundpreis 122,52 €/Jahr netto); Netzbetreiber **Netze BW** (Zählerstände, Einspeisevergütung).

## Daten 2025 (Beispieldatei, nicht im Repo)

Tageswerte in Wh, 353 Tage; Lücke 25.05.–05.06.2025 (12 Tage, wird geschätzt), Teiltage 01.01./30.01./06.06., Netzladung an 4 Tagen
(Kalibrierladung). Erzeugung 6.883 kWh gemessen (7.257 inkl. Schätzung), Eigenverbrauch 4.283 (4.446).

## Architektur

- `server/parse.js` CSV/XLSX → Tageswerte (Spalten-Aliase, Einheit kWh/Wh, Semikolon/Komma).
- `server/store.js` Ablage in `DATA_DIR`: `settings.json`, `files.json`, `files/<sha>.json` (Tage je Datei), `archiv/` (Originale).
  Zusammenführen: je Tag gilt der vollständigere Eintrag (größte Summe).
- `server/calc.js` `analyzeYear()`: Lücken (innerhalb = schätzen aus ≤ 7 Tagen davor/danach, Ränder = fehlend), Teiltage (< 30 % Median),
  Netzladung (geladen > erzeugt + 0,5 kWh), Eigenverbrauch (`method` feedin = P − F, battery = zusätzlich − (geladen − entladen)),
  Firmenanteil, Preis = Arbeitspreis + Grundpreis/Jahr ÷ Umlage-kWh (`baseShare` grid/total/none), Monate, Zeiträume, Jahr.
  Jahres-USt aus der Jahres-Bemessungsgrundlage (`vatPeriods` = Summe der Voranmeldungen, kann um Cent abweichen). `meterChecks()`.
- `server/report.js` PDFs (pdfkit, Helvetica/WinAnsi → **kein U+2212 „−“ und kein „→“ in PDF-Texten**, Halbgeviertstrich nehmen).
- `server/backup.js` ZIP-Sicherung (settings, files, archiv) nach `BACKUP_DIR` (Standard `IMPORT_DIR/sicherung`), nach jedem Import
  und stündlich geprüft (nur bei Änderung, je Tag eine Datei, 30 behalten); `GET /api/backup.zip`, `POST /api/restore` (sichert vorher).
- `server/watch.js` Eingangsordner (`IMPORT_DIR`), Datei erst bei gleicher Größe in zwei Durchläufen.
- `server/index.js` HTTP ohne Framework, optional Basic-Auth (`PASSWORD`), CSRF-Kopf `X-Sonnen-Studio: 1`, CSP ohne Inline-Styles
  (**keine `style="…"`-Attribute in `public/app.js`**, Klassen nutzen).
- `public/` Oberfläche ohne Build; Diagrammfarben `--series-1..4` (geprüfte Palette hell/dunkel), Tabellenansicht als Ersatz.
- Tests: `npm test` (erfundene Daten). Docker: `ghcr.io/flexisticker/sonnen-csv-studio:latest`, Action `.github/workflows/docker.yml`.

## Stand

- 1.0.0 (17.10.2026): Erstversion. Getestet mit der echten 2025er-Datei (lokal, Playwright 1280/390 px, PDFs angesehen).
  **Nicht getestet:** echte XLSX von sonnen, Unraid-Container, Zählerabgleich mit echten Netze-BW-Ständen.
- 1.1.0 (17.10.2026): Wunsch Kunde „Daten immer haben“ → automatische Sicherung + Download/Einspielen; Startwerte EnBW-Preis und
  Name Flexisticker (gelten nur, solange noch keine `settings.json` existiert). Ohne Firmenanteil ergibt 2025: 276,24 € USt.
- 1.2.0 (17.10.2026): Knopf „Datei hochladen“ in der Kopfleiste + Ziehen ins ganze Fenster (springt danach zur Übersicht/zum Jahr).
  Unraid-WebUI: Labels `net.unraid.docker.webui/icon` im Dockerfile, Vorlage `unraid/sonnen-csv-studio.xml`, Icon `public/icon.png`
  (aus icon.svg gerendert). Ein schon angelegter Container übernimmt WebUI nur über die Vorlage bzw. Advanced View → WebUI.
- 1.3.0 (17.10.2026): Jahresauswahl immer aktuelles Jahr bis 2000 (`yearsOf`, `FIRST_YEAR`), Jahre mit Daten mit ✓ (`dataYears`);
  ohne Auswahl neuestes Jahr mit Daten, sonst Vorjahr; Auswahl je Browser gemerkt (`localStorage scs-year`).
- 1.4.0 (17.10.2026): Umbenannt in **Steuer-Studio** (nur Anzeige: Titel, Kopfleiste, PDFs, Anmeldung). Bewusst unverändert: Repo
  `flexisticker/Sonnen-CSV-Studio`, Image `ghcr.io/flexisticker/sonnen-csv-studio`, Health-ID `sonnen-csv-studio`, Sicherungsnamen
  `sonnen-csv-studio-*.zip`, Unraid-Vorlage. PV-Reiter heißen jetzt PV-Übersicht/PV-Umsatzsteuer/PV-Daten (Platz für weitere Bereiche).
- Bereich **Konten** (Lexware-Finanzmanager-Export → Schuldzinsen, Kontoführung Mietkonto, Kaltmiete 380 € + 150 € NK für Wohnung 2)
  wurde geplant, aber am 17.10.2026 vom Kunden **verworfen** („wir lassen es so, wie es war“) – nicht bauen, außer er fragt erneut.
- Offen/Ideen: Netze-BW-Gutschriften (tatsächliche Vergütung) erfassen, Teiltage optional schätzen, Vorjahresvergleich.
