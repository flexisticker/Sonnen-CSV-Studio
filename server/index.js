// Sonnen-CSV-Studio – kleiner Webserver ohne Framework
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getSettings, saveSettings, listFiles, readings, importBuffer, removeFile, DATA_DIR } from './store.js'
import { analyzeYear, meterChecks, yearsOf, localToday, fmtDate } from './calc.js'
import { yearReport, periodReport } from './report.js'
import { startWatch, scan, log as importLog, IMPORT_DIR } from './watch.js'
import { makeZip, restoreZip, autoBackup, startBackups, listBackups, BACKUP_DIR } from './backup.js'
import { VERSION, BUILD, COMMIT } from './version.js'

const PORT = Number(process.env.PORT || 8080)
const PUBLIC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public')
const USER = process.env.USERNAME_LOGIN || process.env.APP_USER || 'admin'
const PASSWORD = process.env.PASSWORD || process.env.APP_PASSWORD || ''

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }

function headers(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.statusCode = status
  res.setHeader('Content-Type', type)
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

const fail = (res, status, msg) => send(res, status, { error: msg })

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest()
  const y = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(x, y)
}

function authorized(req) {
  if (!PASSWORD) return true
  const m = String(req.headers.authorization || '').match(/^Basic (.+)$/)
  if (!m) return false
  const [u, ...p] = Buffer.from(m[1], 'base64').toString('utf8').split(':')
  return safeEqual(u, USER) && safeEqual(p.join(':'), PASSWORD)
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(Object.assign(new Error('Datei zu groß.'), { status: 413 })); req.destroy() }
      else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function analysis(year) {
  const s = getSettings()
  const days = readings()
  const today = localToday()
  const years = yearsOf(days, today)
  const y = Number(year) || years[0]
  return { s, days, years, a: analyzeYear(y, days, s, today) }
}

// CSV für Excel (Semikolon, Dezimalkomma, BOM)
function csv(rows) {
  const cell = (v) => {
    if (typeof v === 'number') return String(Math.round(v * 1000) / 1000).replace('.', ',')
    const t = String(v ?? '')
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n')
}

function exportCsv(a, kind) {
  if (kind === 'days') {
    const rows = [['Datum', 'Erzeugung kWh', 'Hausverbrauch kWh', 'Batterie geladen kWh', 'Batterie entladen kWh', 'Einspeisung kWh', 'Netzbezug kWh', 'Eigenverbrauch kWh', 'Firmenanteil kWh', 'privat kWh', 'Preis ct/kWh', 'Bemessungsgrundlage €', 'Hinweis']]
    for (const d of a.days) {
      if (d.future) continue
      if (d.gap || d.missing) { rows.push([fmtDate(d.date), '', '', '', '', '', '', '', '', '', '', '', 'keine Daten']); continue }
      rows.push([fmtDate(d.date), d.p / 1000, d.c / 1000, d.ch / 1000, d.dis / 1000, d.f / 1000, d.g / 1000, d.ev / 1000, d.business / 1000, d.priv / 1000, d.price, Math.round(d.bmg * 100) / 100,
        [d.est && 'geschätzt', d.partial && 'unvollständig?', d.gridCharge && 'Netzladung', d.noPrice && 'kein Preis'].filter(Boolean).join(', ')])
    }
    return csv(rows)
  }
  const rows = [['Monat', 'Erzeugung kWh', 'Hausverbrauch kWh', 'Batterie geladen kWh', 'Batterie entladen kWh', 'Einspeisung kWh', 'Netzbezug kWh', 'Eigenverbrauch kWh', 'Firmenanteil kWh', 'privat kWh', 'Bemessungsgrundlage €', 'USt €', 'Einspeisevergütung netto €', 'geschätzte Tage', 'fehlende Tage']]
  for (const m of a.months) rows.push([m.name, m.p / 1000, m.c / 1000, m.ch / 1000, m.dis / 1000, m.f / 1000, m.g / 1000, m.ev / 1000, m.business / 1000, m.priv / 1000, m.bmg, m.vat, m.feedinNet, m.estDays, m.missingDays])
  const t = a.total
  rows.push(['Summe', t.p / 1000, t.c / 1000, t.ch / 1000, t.dis / 1000, t.f / 1000, t.g / 1000, t.ev / 1000, t.business / 1000, t.priv / 1000, t.bmg, t.vat, t.feedinNet, t.estDays, t.missingDays])
  return csv(rows)
}

function pdfResponse(res, doc, name) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  doc.pipe(res)
  doc.end()
}

async function api(req, res, url) {
  const p = url.pathname
  const write = req.method !== 'GET' && req.method !== 'HEAD'
  if (write && req.headers['x-sonnen-studio'] !== '1') return fail(res, 403, 'Anfrage abgelehnt.')

  if (p === '/api/health') return send(res, 200, { ok: true, app: 'sonnen-csv-studio', version: VERSION })

  if (p === '/api/state' && req.method === 'GET') {
    const { s, days, years, a } = analysis(url.searchParams.get('year'))
    const slim = a.days.map((d) => (d.future || d.gap || d.missing ? { date: d.date, none: true } : { date: d.date, p: d.p, c: d.c, f: d.f, g: d.g, ev: d.ev, est: !!d.est, partial: !!d.partial, gridCharge: !!d.gridCharge }))
    return send(res, 200, {
      version: { version: VERSION, build: BUILD, commit: COMMIT },
      settings: s,
      years,
      year: a.year,
      today: a.today,
      months: a.months,
      periods: a.periods,
      total: a.total,
      gridYearKwh: a.gridYearKwh,
      coverage: a.coverage,
      warnings: a.warnings,
      days: slim,
      meters: meterChecks(days, s),
      files: listFiles().slice().reverse(),
      importDir: IMPORT_DIR,
      backupDir: BACKUP_DIR,
      backups: listBackups().slice(0, 5),
      importLog
    })
  }

  if (p === '/api/settings' && req.method === 'PUT') {
    const body = await readBody(req, 1 << 20)
    let data
    try { data = JSON.parse(body.toString('utf8')) } catch { return fail(res, 400, 'Ungültige Daten.') }
    return send(res, 200, saveSettings(data))
  }

  if (p === '/api/upload' && req.method === 'POST') {
    const name = url.searchParams.get('name') || 'export.csv'
    if (!/\.(csv|xlsx)$/i.test(name)) return fail(res, 400, 'Nur CSV- oder XLSX-Dateien.')
    const buf = await readBody(req, 30 << 20)
    try {
      const r = await importBuffer(name, buf, 'upload')
      if (!r.duplicate) autoBackup({ force: true })
      return send(res, 200, r)
    } catch (e) {
      return fail(res, 400, e.message)
    }
  }

  if (p === '/api/scan' && req.method === 'POST') {
    await scan()
    await new Promise((r) => setTimeout(r, 1200))
    await scan()
    return send(res, 200, { ok: true, log: importLog })
  }

  if (p === '/api/backup.zip' && req.method === 'GET') {
    res.setHeader('Content-Disposition', `attachment; filename="sonnen-csv-studio-${localToday()}.zip"`)
    return send(res, 200, await makeZip(), 'application/zip')
  }
  if (p === '/api/restore' && req.method === 'POST') {
    const buf = await readBody(req, 200 << 20)
    try {
      return send(res, 200, await restoreZip(buf))
    } catch (e) {
      return fail(res, 400, e.message)
    }
  }

  let m = p.match(/^\/api\/files\/([a-f0-9]{64})$/)
  if (m && req.method === 'DELETE') return removeFile(m[1]) ? send(res, 200, { ok: true }) : fail(res, 404, 'Datei nicht gefunden.')

  if (p === '/api/report/year.pdf') {
    const { s, days, a } = analysis(url.searchParams.get('year'))
    return pdfResponse(res, yearReport(a, s, listFiles(), days), `PV-Jahresbericht-${a.year}.pdf`)
  }
  if (p === '/api/report/period.pdf') {
    const { s, a } = analysis(url.searchParams.get('year'))
    const id = String(url.searchParams.get('p') || '')
    if (!a.periods.some((x) => x.id === id)) return fail(res, 400, 'Zeitraum unbekannt.')
    return pdfResponse(res, periodReport(a, s, id), `PV-Voranmeldung-${a.year}-${id}.pdf`)
  }
  m = p.match(/^\/api\/export\/(days|months)\.csv$/)
  if (m) {
    const { a } = analysis(url.searchParams.get('year'))
    res.setHeader('Content-Disposition', `attachment; filename="PV-${m[1] === 'days' ? 'Tage' : 'Monate'}-${a.year}.csv"`)
    return send(res, 200, exportCsv(a, m[1]), 'text/csv; charset=utf-8')
  }
  return fail(res, 404, 'Nicht gefunden.')
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  const full = path.resolve(PUBLIC, rel)
  if (!full.startsWith(PUBLIC + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return fail(res, 404, 'Nicht gefunden.')
  res.setHeader('Content-Type', TYPES[path.extname(full)] || 'application/octet-stream')
  res.setHeader('Cache-Control', 'no-cache')
  fs.createReadStream(full).pipe(res)
}

const server = http.createServer(async (req, res) => {
  headers(res)
  let url
  try { url = new URL(req.url, 'http://localhost') } catch { return fail(res, 400, 'Ungültige Adresse.') }
  if (url.pathname !== '/api/health' && !authorized(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Sonnen-CSV-Studio", charset="UTF-8"')
    return fail(res, 401, 'Anmeldung erforderlich.')
  }
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url)
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Nicht erlaubt.')
    return serveStatic(res, url.pathname)
  } catch (e) {
    console.error(e)
    if (!res.headersSent) fail(res, e.status || 500, e.status ? e.message : 'Interner Fehler.')
    else res.end()
  }
})

server.listen(PORT, () => {
  console.log(`Sonnen-CSV-Studio ${VERSION} auf Port ${PORT} · Daten ${DATA_DIR} · Eingang ${IMPORT_DIR} · Sicherung ${BACKUP_DIR}${PASSWORD ? ' · Passwortschutz an' : ''}`)
  startWatch(Number(process.env.SCAN_SECONDS || 15) * 1000, () => autoBackup({ force: true }))
  startBackups()
})
