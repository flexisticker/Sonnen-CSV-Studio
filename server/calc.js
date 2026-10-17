// Berechnung: Tageswerte → Monate/Voranmeldungszeiträume, Eigenverbrauch, privater Anteil,
// Bemessungsgrundlage der unentgeltlichen Wertabgabe und Umsatzsteuer.
// Alle Energiewerte intern in Wh, Beträge in Euro.
import { validAt } from './settings.js'

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

const DAY = 86400000
export const toTime = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
export const fromTime = (t) => new Date(t).toISOString().slice(0, 10)
export const addDays = (d, n) => fromTime(toTime(d) + n * DAY)
export const round2 = (n) => Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-9) / 100

export function localToday() {
  // Datum in Europe/Berlin (Container setzt TZ, sonst Systemzeit)
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function daysInYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365
}

// aufeinanderfolgende Daten → [{from, to, n}]
export function ranges(dates) {
  const out = []
  for (const d of [...dates].sort()) {
    const last = out[out.length - 1]
    if (last && addDays(last.to, 1) === d) { last.to = d; last.n++ }
    else out.push({ from: d, to: d, n: 1 })
  }
  return out
}

export function periodsOf(kind) {
  if (kind === 'month') return MONTHS.map((name, i) => ({ id: `M${i + 1}`, name, months: [i] }))
  if (kind === 'year') return [{ id: 'J', name: 'Jahr', months: [...Array(12).keys()] }]
  return [0, 1, 2, 3].map((q) => ({ id: `Q${q + 1}`, name: `${q + 1}. Quartal`, months: [q * 3, q * 3 + 1, q * 3 + 2] }))
}

function median(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const KEYS = ['p', 'c', 'ch', 'dis', 'f', 'g']

function emptyAgg() {
  return {
    p: 0, c: 0, ch: 0, dis: 0, f: 0, g: 0,
    ev: 0, priv: 0, business: 0,
    bmgRaw: 0, feedinRaw: 0,
    days: 0, estDays: 0, partialDays: 0, gridChargeDays: 0, noPriceDays: 0, missingDays: 0, futureDays: 0
  }
}

function addTo(a, d) {
  for (const k of KEYS) a[k] += d[k]
  a.ev += d.ev
  a.priv += d.priv
  a.business += d.business
  a.bmgRaw += d.bmg
  a.feedinRaw += d.feedin
  a.days++
  if (d.est) a.estDays++
  if (d.partial) a.partialDays++
  if (d.gridCharge) a.gridChargeDays++
  if (d.noPrice) a.noPriceDays++
}

function finish(a, s) {
  const rate = s.taxRate / 100
  a.bmg = round2(a.bmgRaw)
  a.vat = s.plant.taxSelfUse ? round2(a.bmg * rate) : 0
  if (!s.plant.taxSelfUse) a.bmg = 0
  a.feedinNet = round2(a.feedinRaw)
  a.feedinVat = s.feedinVat ? round2(a.feedinNet * rate) : 0
  a.kz81 = round2(a.bmg + a.feedinNet)
  a.priceCt = a.priv > 0 ? (a.bmgRaw / (a.priv / 1000)) * 100 : null
  a.evQuote = a.p > 0 ? a.ev / a.p : null
  a.autarky = a.c > 0 ? Math.max(0, (a.c - a.g) / a.c) : null
  a.losses = a.ch - a.dis
  delete a.bmgRaw
  delete a.feedinRaw
  return a
}

// Eigenverbrauch eines Tages
function selfUse(d, method) {
  const base = Math.max(0, d.p - d.f)
  if (method === 'battery') return Math.max(0, base - Math.max(0, d.ch - d.dis))
  return base
}

/**
 * days: { 'JJJJ-MM-TT': {p,c,ch,dis,f,g,file} } aus store.readings()
 * Liefert die Auswertung eines Kalenderjahres.
 */
export function analyzeYear(year, days, s, today = localToday()) {
  const y = Number(year)
  const first = `${y}-01-01`
  const yearEnd = `${y}-12-31`
  const yesterday = addDays(today, -1)
  const last = yearEnd < yesterday ? yearEnd : yesterday
  const allDates = Object.keys(days).sort()
  const firstData = allDates[0]
  const lastData = allDates[allDates.length - 1]

  // 1) Tagesliste mit Lücken
  const list = []
  for (let d = first; d <= yearEnd; d = addDays(d, 1)) {
    if (d > last) { list.push({ date: d, future: true }); continue }
    const v = days[d]
    if (v) list.push({ date: d, ...pick(v), file: v.file })
    else if (firstData && d > firstData && d < lastData) list.push({ date: d, gap: true })
    else list.push({ date: d, missing: true })
  }

  // 2) Teiltage erkennen (Verbrauch < 30 % des Medians der Umgebung)
  const real = list.filter((x) => !x.gap && !x.missing && !x.future)
  real.forEach((x, i) => {
    const around = real.slice(Math.max(0, i - 14), i + 15).filter((o) => o !== x).map((o) => o.c)
    const m = median(around)
    if (m > 0 && x.c < 0.3 * m) x.partial = true
    if (x.ch - x.p > 500) { x.gridCharge = true; x.gridChargeWh = x.ch - x.p }
  })

  // 3) Lücken innerhalb der Daten schätzen (Mittel aus bis zu 7 Tagen davor und danach)
  const gaps = list.filter((x) => x.gap)
  if (s.estimateGaps) {
    for (const r of ranges(gaps.map((x) => x.date))) {
      const before = []
      for (let d = addDays(r.from, -1); before.length < 7 && d >= addDays(r.from, -40); d = addDays(d, -1)) {
        const v = days[d]
        if (v) before.push(v)
      }
      const after = []
      for (let d = addDays(r.to, 1); after.length < 7 && d <= addDays(r.to, 40); d = addDays(d, 1)) {
        const v = days[d]
        if (v) after.push(v)
      }
      const src = [...before, ...after]
      if (!src.length) continue
      const avg = {}
      for (const k of KEYS) avg[k] = Math.round(src.reduce((a, v) => a + v[k], 0) / src.length)
      for (const x of list) {
        if (x.gap && x.date >= r.from && x.date <= r.to) Object.assign(x, avg, { est: true, gap: false })
      }
    }
  }

  // 4) je Tag: Eigenverbrauch und Firmenanteil
  const used = list.filter((x) => !x.gap && !x.missing && !x.future)
  const diy = daysInYear(y)
  for (const x of used) {
    x.ev = selfUse(x, s.method)
    const b = validAt(s.business, x.date)
    if (!b) x.business = 0
    else if (b.mode === 'percent') x.business = x.ev * (b.value / 100)
    else x.business = Math.min(x.ev, (b.value * 1000) / diy)
    x.priv = x.ev - x.business
  }

  // 5) Preis je kWh (Arbeitspreis + umgelegter Grundpreis), Bemessungsgrundlage, Einspeisevergütung
  const gridYearKwh = used.reduce((a, x) => a + x.g, 0) / 1000
  const evYearKwh = used.reduce((a, x) => a + x.ev, 0) / 1000
  const baseKwh = s.baseShare === 'total' ? gridYearKwh + evYearKwh : s.baseShare === 'grid' ? gridYearKwh : 0
  for (const x of used) {
    const pr = validAt(s.prices, x.date)
    if (!pr) { x.noPrice = true; x.price = 0 }
    else x.price = pr.workCt + (baseKwh > 0 ? (pr.baseEurYear * 100) / baseKwh : 0)
    x.bmg = (x.priv / 1000) * (x.price / 100)
    const fi = validAt(s.feedin, x.date)
    x.feedin = fi ? (x.f / 1000) * (fi.ct / 100) : 0
  }

  // 6) Monate und Zeiträume
  const months = MONTHS.map((name, i) => ({ month: i + 1, name, ...emptyAgg() }))
  for (const x of list) {
    const m = months[+x.date.slice(5, 7) - 1]
    if (x.future) m.futureDays++
    else if (x.gap || x.missing) m.missingDays++
    else addTo(m, x)
  }
  const periods = periodsOf(s.period).map((p) => {
    const a = { id: p.id, name: p.name, months: p.months.map((i) => i + 1), ...emptyAgg() }
    for (const i of p.months) {
      const m = months[i]
      for (const k of Object.keys(emptyAgg())) a[k] += m[k]
    }
    // bmg/feedin je Monat noch unrundet → aus Tagen neu summieren
    a.bmgRaw = 0
    a.feedinRaw = 0
    for (const x of used) {
      if (p.months.includes(+x.date.slice(5, 7) - 1)) { a.bmgRaw += x.bmg; a.feedinRaw += x.feedin }
    }
    a.from = `${y}-${String(p.months[0] + 1).padStart(2, '0')}-01`
    const lm = p.months[p.months.length - 1] + 1
    a.to = addDays(lm === 12 ? `${y + 1}-01-01` : `${y}-${String(lm + 1).padStart(2, '0')}-01`, -1)
    a.state = a.futureDays > 0 ? (a.days ? 'running' : 'future') : a.missingDays || a.noPriceDays ? 'incomplete' : 'complete'
    return a
  })
  for (const m of months) {
    m.bmgRaw = used.filter((x) => +x.date.slice(5, 7) === m.month).reduce((a, x) => a + x.bmg, 0)
    m.feedinRaw = used.filter((x) => +x.date.slice(5, 7) === m.month).reduce((a, x) => a + x.feedin, 0)
    finish(m, s)
  }
  periods.forEach((p) => finish(p, s))

  // Jahr (für die USt-Jahreserklärung) aus den Tageswerten; Summe der Voranmeldungen kann um Cent abweichen
  const total = emptyAgg()
  for (const m of months) for (const k of Object.keys(emptyAgg())) total[k] += m[k]
  total.bmgRaw = used.reduce((a, x) => a + x.bmg, 0)
  total.feedinRaw = used.reduce((a, x) => a + x.feedin, 0)
  finish(total, s)
  total.vatPeriods = round2(periods.reduce((a, p) => a + p.vat, 0))

  // 7) Hinweise
  const warnings = []
  const estR = ranges(list.filter((x) => x.est).map((x) => x.date))
  const gapR = ranges(list.filter((x) => x.gap).map((x) => x.date))
  const missR = ranges(list.filter((x) => x.missing).map((x) => x.date))
  for (const r of estR) warnings.push({ level: 'warn', code: 'estimated', ...r, text: `Daten fehlen ${fmtRange(r)} (${r.n} Tage) – geschätzt aus den Tagen davor und danach.` })
  for (const r of gapR) warnings.push({ level: 'error', code: 'gap', ...r, text: `Daten fehlen ${fmtRange(r)} (${r.n} Tage) – nicht geschätzt.` })
  for (const r of missR) warnings.push({ level: 'error', code: 'missing', ...r, text: `Keine Daten ${fmtRange(r)} (${r.n} Tage) – Export für diesen Zeitraum einlesen.` })
  const partial = list.filter((x) => x.partial)
  if (partial.length) warnings.push({ level: 'warn', code: 'partial', dates: partial.map((x) => x.date), text: `Vermutlich unvollständige Tage (sehr wenig Verbrauch): ${partial.map((x) => fmtDate(x.date)).join(', ')}.` })
  const gc = list.filter((x) => x.gridCharge)
  if (gc.length) warnings.push({ level: 'info', code: 'gridcharge', dates: gc.map((x) => x.date), text: `Batterie aus dem Netz geladen (mehr geladen als erzeugt): ${gc.map((x) => fmtDate(x.date)).join(', ')}. Zählt nicht zum Eigenverbrauch.` })
  if (s.plant.taxSelfUse) {
    const np = ranges(used.filter((x) => x.noPrice).map((x) => x.date))
    for (const r of np) warnings.push({ level: 'error', code: 'noprice', ...r, text: `Kein Strompreis für ${fmtRange(r)} – in den Einstellungen unter „Strompreise“ eintragen.` })
  }

  return {
    year: y,
    today,
    days: list,
    months,
    periods,
    total,
    gridYearKwh,
    baseKwh,
    estimated: estR,
    warnings,
    coverage: { from: used[0]?.date || null, to: used[used.length - 1]?.date || null, days: used.length, est: list.filter((x) => x.est).length }
  }
}

function pick(v) {
  const o = {}
  for (const k of KEYS) o[k] = v[k]
  return o
}

export const fmtDate = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '')
export const fmtRange = (r) => (r.from === r.to ? `am ${fmtDate(r.from)}` : `vom ${fmtDate(r.from)} bis ${fmtDate(r.to)}`)

/**
 * Abgleich mit den Zählerständen von Netze BW: Differenz zweier Ablesungen gegen die Summe der
 * sonnen-Werte dazwischen (Ablesung = Stand zu Beginn des Tages).
 */
export function meterChecks(days, s) {
  const out = []
  const ms = s.meters
  for (let i = 1; i < ms.length; i++) {
    const a = ms[i - 1]
    const b = ms[i]
    let g = 0
    let f = 0
    let missing = 0
    let n = 0
    for (let d = a.date; d < b.date; d = addDays(d, 1)) {
      n++
      const v = days[d]
      if (!v) { missing++; continue }
      g += v.g
      f += v.f
    }
    const row = { from: a.date, to: b.date, days: n, missing }
    if (a.purchase != null && b.purchase != null) {
      row.meterPurchase = b.purchase - a.purchase
      row.sonnenPurchase = g / 1000
      row.devPurchase = row.meterPurchase ? (row.sonnenPurchase - row.meterPurchase) / row.meterPurchase : null
    }
    if (a.feedin != null && b.feedin != null) {
      row.meterFeedin = b.feedin - a.feedin
      row.sonnenFeedin = f / 1000
      row.devFeedin = row.meterFeedin ? (row.sonnenFeedin - row.meterFeedin) / row.meterFeedin : null
    }
    out.push(row)
  }
  return out
}

export function yearsOf(days, today = localToday()) {
  const ys = new Set(Object.keys(days).map((d) => +d.slice(0, 4)))
  if (!ys.size) ys.add(+today.slice(0, 4))
  return [...ys].sort((a, b) => b - a)
}
