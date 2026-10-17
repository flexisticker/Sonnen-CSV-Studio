// Eingangsordner (IMPORT_DIR) überwachen: neue CSV/XLSX werden eingelesen und nach „erledigt/“
// verschoben, fehlerhafte nach „fehler/“ (mit .txt daneben). Eine Datei wird erst genommen, wenn
// ihre Größe zwischen zwei Durchläufen gleich bleibt (Kopiervorgang abgeschlossen).
import fs from 'node:fs'
import path from 'node:path'
import { importBuffer } from './store.js'

export const IMPORT_DIR = path.resolve(process.env.IMPORT_DIR || './import')
const DONE = path.join(IMPORT_DIR, 'erledigt')
const FAIL = path.join(IMPORT_DIR, 'fehler')
const seen = new Map()
export const log = []

function note(entry) {
  log.unshift({ at: new Date().toISOString(), ...entry })
  log.length = Math.min(log.length, 30)
  console.log(`[Eingang] ${entry.name}: ${entry.text}`)
}

function moveTo(dir, file) {
  fs.mkdirSync(dir, { recursive: true })
  let target = path.join(dir, path.basename(file))
  if (fs.existsSync(target)) {
    const { name, ext } = path.parse(target)
    target = path.join(dir, `${name}-${Date.now()}${ext}`)
  }
  fs.renameSync(file, target)
  return target
}

let onImport = null

export async function scan() {
  let entries
  try {
    fs.mkdirSync(IMPORT_DIR, { recursive: true })
    entries = fs.readdirSync(IMPORT_DIR, { withFileTypes: true })
  } catch (e) {
    return
  }
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('.') || !/\.(csv|xlsx)$/i.test(e.name)) continue
    const full = path.join(IMPORT_DIR, e.name)
    let st
    try { st = fs.statSync(full) } catch { continue }
    const key = `${st.size}:${st.mtimeMs}`
    if (seen.get(full) !== key) { seen.set(full, key); continue }
    seen.delete(full)
    try {
      const res = await importBuffer(e.name, fs.readFileSync(full), 'ordner')
      moveTo(DONE, full)
      if (!res.duplicate && onImport) onImport()
      note({ name: e.name, ok: true, text: res.duplicate ? 'schon eingelesen – verschoben' : `${res.file.days} Tage eingelesen (${res.file.from} bis ${res.file.to})` })
    } catch (err) {
      try {
        const t = moveTo(FAIL, full)
        fs.writeFileSync(t + '.txt', String(err.message || err))
      } catch {}
      note({ name: e.name, ok: false, text: err.message || String(err) })
    }
  }
}

export function startWatch(intervalMs = 15000, cb = null) {
  onImport = cb
  scan()
  return setInterval(scan, intervalMs)
}
