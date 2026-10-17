// Datensicherung: alle Einstellungen, eingelesenen Werte und Originaldateien als ZIP.
// Automatisch einmal am Tag (nur wenn sich etwas geändert hat) nach BACKUP_DIR, die letzten 30 bleiben.
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { DATA_DIR, resetCache } from './store.js'
import { IMPORT_DIR } from './watch.js'
import { localToday } from './calc.js'

export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(IMPORT_DIR, 'sicherung'))
const KEEP = 30
const ALLOWED = /^(settings\.json|files\.json|files\/[a-f0-9]{64}\.json|archiv\/[^/\\]+)$/

function walk(dir, prefix = '') {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel))
    else if (ALLOWED.test(rel)) out.push(rel)
  }
  return out
}

export async function makeZip() {
  const zip = new JSZip()
  for (const rel of walk(DATA_DIR)) zip.file(rel, fs.readFileSync(path.join(DATA_DIR, rel)))
  zip.file('LIESMICH.txt', 'Sicherung von Steuer-Studio.\r\nWiederherstellen: in der Oberfläche unter Daten → „Sicherung einspielen“\r\noder den Inhalt in den Datenordner (/data) entpacken.\r\nOriginaldateien von sonnen liegen unter archiv/.\r\n')
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export async function restoreZip(buf) {
  let zip
  try { zip = await JSZip.loadAsync(buf) } catch { throw new Error('Keine gültige ZIP-Datei.') }
  const entries = Object.values(zip.files).filter((f) => !f.dir && f.name !== 'LIESMICH.txt')
  const bad = entries.filter((f) => !ALLOWED.test(f.name))
  if (!entries.some((f) => f.name === 'files.json') || bad.length) throw new Error('Das ist keine Sicherung von Steuer-Studio.')
  // vorher den aktuellen Stand sichern
  await autoBackup({ force: true, tag: 'vor-wiederherstellung' })
  for (const f of entries) {
    const target = path.join(DATA_DIR, f.name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, await f.async('nodebuffer'))
  }
  resetCache()
  return { files: entries.length }
}

function stamp() {
  let latest = 0
  for (const rel of walk(DATA_DIR)) latest = Math.max(latest, fs.statSync(path.join(DATA_DIR, rel)).mtimeMs)
  return latest
}

export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return []
  return fs.readdirSync(BACKUP_DIR)
    .filter((n) => /^sonnen-csv-studio-.+\.zip$/.test(n))
    .map((n) => ({ name: n, size: fs.statSync(path.join(BACKUP_DIR, n)).size, at: fs.statSync(path.join(BACKUP_DIR, n)).mtime.toISOString() }))
    .sort((a, b) => b.at.localeCompare(a.at))
}

export async function autoBackup({ force = false, tag = '' } = {}) {
  try {
    if (!fs.existsSync(path.join(DATA_DIR, 'files.json')) && !fs.existsSync(path.join(DATA_DIR, 'settings.json'))) return null
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    const last = listBackups().find((b) => !b.name.includes('vor-'))
    if (!force && last && new Date(last.at).getTime() >= stamp()) return null // nichts geändert
    const name = `sonnen-csv-studio-${localToday()}${tag ? '-' + tag : ''}.zip`
    fs.writeFileSync(path.join(BACKUP_DIR, name), await makeZip())
    const all = listBackups()
    for (const b of all.slice(KEEP)) fs.rmSync(path.join(BACKUP_DIR, b.name), { force: true })
    console.log(`[Sicherung] ${name}`)
    return name
  } catch (e) {
    console.error('[Sicherung] fehlgeschlagen:', e.message)
    return null
  }
}

export function startBackups() {
  setTimeout(() => autoBackup(), 60 * 1000)
  return setInterval(() => autoBackup(), 60 * 60 * 1000)
}
