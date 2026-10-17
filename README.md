# Sonnen-CSV-Studio

Wertet die Statistik-Exporte einer **sonnenBatterie** (CSV oder XLSX) aus. Du legst die Datei in einen Ordner, das Programm zeigt
ein **Dashboard** und erstellt **PDF-Berichte für Steuerberater und Finanzamt**, vor allem für die **Umsatzsteuer auf den privat
verbrauchten Solarstrom** (unentgeltliche Wertabgabe, § 3 Abs. 1b UStG).

> Rechenhilfe, keine Steuerberatung. Die Einstellungen (Firmenanteil, Umlage des Grundpreises, Schätzungen) bitte mit dem
> Steuerberater abstimmen.

## Was es kann

- **Eingangsordner:** neue CSV/XLSX werden automatisch eingelesen und nach `erledigt/` verschoben (fehlerhafte nach `fehler/`, mit Grund als `.txt`).
  Alternativ per Drag & Drop in der Oberfläche. Doppelte Dateien werden erkannt, überlappende Zeiträume nicht doppelt gezählt.
- **Dashboard:** Erzeugung, Eigenverbrauch, Einspeisung, Netzbezug, Autarkie, Eigenverbrauchsquote, Umsatzsteuer; Monatsdiagramm
  (mit Tabellenansicht) und Tagesverlauf.
- **Umsatzsteuer:** je Voranmeldungszeitraum (Monat/Quartal/Jahr) und für das Jahr:
  Eigenverbrauch → minus Firmenanteil (Pauschale) → privater Eigenverbrauch × Strompreis netto = Bemessungsgrundlage → USt 19 %.
- **Strompreis:** Arbeitspreis (ct/kWh netto) + Grundpreis (€/Jahr netto) von der Rechnung des Stromlieferanten, mit „gültig ab“.
  Der Grundpreis wird wahlweise auf den Netzbezug oder auf Netzbezug + Eigenverbrauch umgelegt oder weggelassen.
- **Datenqualität:** fehlende Tage werden erkannt; Lücken innerhalb der Daten werden aus den Nachbartagen geschätzt und gekennzeichnet.
  Teiltage (Ausfall) und Laden der Batterie aus dem Netz werden gemeldet. Abgleich mit Zählerständen (Netze BW).
- **Daten bleiben:** alles Eingelesene wird dauerhaft gespeichert (Originale im Archiv), Ergebnisse jederzeit für jedes Jahr abrufbar.
  Nach jedem Import und täglich bei Änderungen eine ZIP-Sicherung nach `/import/sicherung` (letzte 30), dazu Download/Einspielen in der Oberfläche.
- **Berichte:** Jahresbericht (PDF), Voranmeldung je Zeitraum (PDF), CSV-Export (Monate/Tage, für Excel).
  Im Jahresbericht stehen Methode, Preise, Pauschale, Schätzungen, Zählerabgleich und die SHA-256-Prüfsummen der eingelesenen Dateien.

## Dateiformat (sonnen-Portal → Statistik → Export)

```
timestamp,produced_energy,consumed_energy,battery_charged_energy,battery_discharged_energy,grid_feedin_energy,grid_purchase_energy
2025-01-03T00:00:00+01:00,5643,15842,2361,1678,159,11025
```

Werte in Wattstunden, eine Zeile je Tag (Stunden-/Viertelstundenwerte werden je Tag addiert). Deutsche Spaltennamen,
Semikolon und Dezimalkomma werden ebenfalls erkannt; Spalten mit „(kWh)“ werden umgerechnet.

## Installation auf Unraid

Das Image wird bei jedem Push auf `main` von GitHub gebaut: `ghcr.io/flexisticker/sonnen-csv-studio:latest`.

Docker → **Add Container**:

| Feld | Wert |
|---|---|
| Name | `sonnen-csv-studio` |
| Repository | `ghcr.io/flexisticker/sonnen-csv-studio:latest` |
| Network Type | Bridge |
| Port | Host `8095` → Container `8080` |
| Pfad `/data` | `/mnt/user/appdata/sonnen-csv-studio` (Einstellungen, eingelesene Werte, Archiv der Originale) |
| Pfad `/import` | `/mnt/user/flexisticker/pv-eingang` (hierhin die sonnen-Exporte legen) |
| Variable `PASSWORD` | optional: Passwort für die Anmeldung (Benutzer `admin`, änderbar mit `APP_USER`) |
| Variable `TZ` | `Europe/Berlin` (Standard) |
| Variable `BACKUP_DIR` | optional, Standard `/import/sicherung` (liegt damit auf dem Array und ist im Explorer sichtbar) |

Danach im Browser `http://<unraid-ip>:8095/` öffnen. Der Eingangsordner ist im Windows-Explorer z. B. unter
`\\PowerServer\flexisticker\pv-eingang` erreichbar.

Ist das Paket auf ghcr.io privat, muss Unraid angemeldet sein (`docker login ghcr.io` mit einem Token `read:packages`).
**Updates:** Docker → „Check for Updates“ → „apply update“. Die Daten in `/data` bleiben erhalten.

Wie alles im Heimnetz: nicht ohne Passwort/Zugriffsliste ins Internet freigeben.

## Erste Einrichtung

1. **Einstellungen → Anlage:** Inbetriebnahme, Vorsteuer beim Kauf gezogen, „Privaten Eigenverbrauch der Umsatzsteuer unterwerfen“.
2. **Strompreise:** von der Rechnung des Lieferanten. Startwert ist EnBW ab 01.01.2024 (28,76 ct/kWh, 122,52 €/Jahr, netto) – bei Preisänderung neue Zeile.
3. **Firmenanteil:** die mit dem Steuerberater abgestimmte Pauschale (% des Eigenverbrauchs oder feste kWh je Jahr).
4. **Voranmeldung:** monatlich / vierteljährlich.
5. Optional: Einspeisevergütung, Zählerstände von Netze BW.
6. sonnen-Export in den Eingangsordner legen → Dashboard → Umsatzsteuer → PDF.

## Entwicklung

```
npm install
npm test
DATA_DIR=./data IMPORT_DIR=./import PORT=8095 npm start
```

Node 22, keine Build-Stufe: `server/` (Node, ohne Framework; `pdfkit` für PDFs, `exceljs` für XLSX) und `public/` (HTML/CSS/JS, Diagramme als SVG).
Alle schreibenden API-Aufrufe brauchen den Kopf `X-Sonnen-Studio: 1`.
