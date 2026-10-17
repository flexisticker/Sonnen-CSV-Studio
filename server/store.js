// Ablage im Datenordner (DATA_DIR):
//   settings.json        Einstellungen
//   files.json           eingelesene Dateien (Name, SHA-256, Zeitraum, …)
//   files/<sha>.json     Tageswerte je Datei
//   archiv/<sha>-<name>  Originaldatei (unverändert)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { parseFile, FIELDS } from './parse.js'
import { defaultSettings, normalizeSettings } from './settings.js'

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data')
const FILES_DIR = path.join(DATA_DIR, 'files')
const ARCHIVE_DIR = path.join(DATA_DIR, 'archiv')
for (const d of [DATA_DIR, FILES_DIR, ARCHIVE_DIR]) fs.mkdirSync(d, { recursive: true })

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, data) {
  const full = path.join(DATA_DIR, file)
  const tmp = full + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1))
  fs.renameSync(tmp, full)
}

export function getSettings() {
  return normalizeSettings(readJson('settings.json', defaultSettings()))
}

export function saveSettings(s) {
  const clean = normalizeSettings(s)
  clean.updatedAt = new Date().toISOString()
  writeJson('settings.json', clean)
  return clean
}

export function listFiles() {
  return readJson('files.json', [])
}

let merged = null

// Alle Dateien zusammenführen. Gibt es einen Tag in mehreren Dateien, gilt der vollständigere
// (größere Summe aller Werte) – so ersetzt ein späterer Export einen am selben Tag gezogenen Teiltag.
export function readings() {
  if (merged) return merged
  const days = {}
  for (const f of listFiles()) {
    const data = readJson(`files/${f.sha}.json`, null)
    if (!data) continue
    for (const [date, v] of Object.entries(data.days)) {
      const sum = FIELDS.reduce((a, k) => a + v[k], 0)
      const cur = days[date]
      if (!cur || sum > cur.sum) days[date] = { ...v, sum, file: f.sha }
    }
  }
  merged = days
  return days
}

export async function importBuffer(name, buf, via = 'upload') {
  const safe = path.basename(String(name || 'export.csv')).replace(/[^\w.\- äöüÄÖÜß()]/g, '_').slice(0, 120)
  const sha = crypto.createHash('sha256').update(buf).digest('hex')
  const files = listFiles()
  const known = files.find((f) => f.sha === sha)
  if (known) return { duplicate: true, file: known }
  const parsed = await parseFile(safe, buf)
  const dates = Object.keys(parsed.days).sort()
  const before = readings()
  const replaced = dates.filter((d) => before[d]).length
  fs.writeFileSync(path.join(ARCHIVE_DIR, `${sha.slice(0, 16)}-${safe}`), buf)
  writeJson(`files/${sha}.json`, { days: parsed.days })
  const entry = {
    sha,
    name: safe,
    size: buf.length,
    via,
    importedAt: new Date().toISOString(),
    from: dates[0],
    to: dates[dates.length - 1],
    days: dates.length,
    rows: parsed.rows,
    skipped: parsed.skipped,
    overlap: replaced
  }
  files.push(entry)
  writeJson('files.json', files)
  merged = null
  return { file: entry }
}

export function removeFile(sha) {
  const files = listFiles()
  const f = files.find((x) => x.sha === sha)
  if (!f) return false
  writeJson('files.json', files.filter((x) => x.sha !== sha))
  fs.rmSync(path.join(FILES_DIR, `${sha}.json`), { force: true })
  // Original bleibt im Archiv (Nachvollziehbarkeit), wird nur nicht mehr ausgewertet
  merged = null
  return true
}
