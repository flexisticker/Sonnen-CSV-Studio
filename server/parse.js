// Liest sonnen-Exporte (CSV oder XLSX) und fasst sie zu Tageswerten in Wattstunden zusammen.
// Erwartetes Format (sonnen-Portal „Statistik“):
//   timestamp,produced_energy,consumed_energy,battery_charged_energy,battery_discharged_energy,grid_feedin_energy,grid_purchase_energy
// Werte in Wh je Zeile; mehrere Zeilen je Tag (Stunde/Viertelstunde) werden aufsummiert.

export const FIELDS = ['p', 'c', 'ch', 'dis', 'f', 'g']

export const FIELD_LABELS = {
  p: 'Erzeugung',
  c: 'Hausverbrauch',
  ch: 'Batterie geladen',
  dis: 'Batterie entladen',
  f: 'Netzeinspeisung',
  g: 'Netzbezug'
}

// Spaltennamen (klein, ohne Leer-/Sonderzeichen) → Feld
const ALIASES = {
  date: ['timestamp', 'datum', 'date', 'zeit', 'zeitstempel', 'time', 'datetime'],
  p: ['producedenergy', 'production', 'produced', 'erzeugung', 'erzeugteenergie', 'pvproduktion', 'produktion', 'pvenergy'],
  c: ['consumedenergy', 'consumption', 'consumed', 'verbrauch', 'hausverbrauch', 'verbrauchteenergie'],
  ch: ['batterychargedenergy', 'batterycharged', 'batterieladung', 'batteriegeladen', 'ladung'],
  dis: ['batterydischargedenergy', 'batterydischarged', 'batterieentladung', 'batterieentladen', 'entladung'],
  f: ['gridfeedinenergy', 'gridfeedin', 'feedin', 'einspeisung', 'netzeinspeisung'],
  g: ['gridpurchaseenergy', 'gridpurchase', 'purchase', 'netzbezug', 'bezug']
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9äöü]/g, '')

function mapHeader(header) {
  const map = {}
  const units = {}
  header.forEach((h, i) => {
    const n = norm(h)
    for (const [field, names] of Object.entries(ALIASES)) {
      if (map[field] === undefined && names.includes(n)) {
        map[field] = i
        // Einheit aus dem Spaltennamen, z. B. „Erzeugung (kWh)“
        units[field] = /kwh/i.test(String(h)) ? 1000 : 1
      }
    }
  })
  return { map, units }
}

function splitCsvLine(line, sep) {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === sep) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

export function csvRows(text) {
  text = String(text).replace(/^﻿/, '')
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (!lines.length) return []
  const first = lines[0]
  const counts = [',', ';', '\t'].map((s) => [s, first.split(s).length])
  const sep = counts.sort((a, b) => b[1] - a[1])[0][0]
  return lines.map((l) => splitCsvLine(l, sep))
}

function toNumber(v) {
  if (typeof v === 'number') return v
  let s = String(v ?? '').trim()
  if (!s) return 0
  // 1.234,5 → 1234.5 ; 1234,5 → 1234.5 ; 1234.5 bleibt
  if (/,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

function toDate(v) {
  if (v instanceof Date) {
    // exceljs liefert Datumswerte als UTC-Mitternacht der angezeigten Zeit
    return v.toISOString().slice(0, 10)
  }
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

// rows = Array von Zeilen (erste = Kopf) → { days: {datum: {p,c,ch,dis,f,g}}, rows, skipped }
export function rowsToDays(rows) {
  if (!rows.length) throw new Error('Die Datei ist leer.')
  const headerIdx = rows.findIndex((r) => mapHeader(r).map.date !== undefined)
  if (headerIdx < 0) throw new Error('Keine Spalte „timestamp“/„Datum“ gefunden – ist das ein sonnen-Export?')
  const { map, units } = mapHeader(rows[headerIdx])
  const missing = FIELDS.filter((f) => map[f] === undefined)
  if (missing.length) {
    throw new Error('Spalten fehlen: ' + missing.map((f) => FIELD_LABELS[f]).join(', '))
  }
  const days = {}
  let used = 0
  let skipped = 0
  for (const r of rows.slice(headerIdx + 1)) {
    const date = toDate(r[map.date])
    if (!date) { skipped++; continue }
    const vals = {}
    let bad = false
    for (const f of FIELDS) {
      const n = toNumber(r[map[f]])
      if (Number.isNaN(n) || n < 0) bad = true
      vals[f] = Math.round((Number.isNaN(n) ? 0 : n) * units[f])
    }
    if (bad) { skipped++; continue }
    const d = (days[date] ||= { p: 0, c: 0, ch: 0, dis: 0, f: 0, g: 0, n: 0 })
    for (const f of FIELDS) d[f] += vals[f]
    d.n++
    used++
  }
  if (!used) throw new Error('Keine gültigen Zeilen gefunden.')
  return { days, rows: used, skipped }
}

export async function parseFile(name, buf) {
  if (/\.xlsx$/i.test(name)) {
    const { default: ExcelJS } = await import('exceljs')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.worksheets[0]
    if (!ws) throw new Error('Die Excel-Datei enthält kein Tabellenblatt.')
    const rows = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = row.values.slice(1).map((v) => (v && typeof v === 'object' && !(v instanceof Date) ? (v.result ?? v.text ?? '') : v))
      rows.push(vals)
    })
    return rowsToDays(rows)
  }
  if (/\.(csv|txt)$/i.test(name)) {
    let text = buf.toString('utf8')
    if (text.includes('�')) text = buf.toString('latin1')
    return rowsToDays(csvRows(text))
  }
  throw new Error('Nur CSV- oder XLSX-Dateien.')
}
