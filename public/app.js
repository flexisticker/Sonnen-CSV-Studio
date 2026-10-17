// Steuer-Studio – Oberfläche (ohne Framework)
const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const fmtKwh = (wh, d = 0) => (wh / 1000).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtEur = (n) => (n ?? 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const fmtPct = (n) => (n == null ? '–' : (n * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' %')
const fmtCt = (n) => (n == null ? '–' : n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ct')
const fmtDate = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '')
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const STATE = { complete: ['vollständig', 'ok'], incomplete: ['unvollständig', 'error'], running: ['läuft noch', 'warn'], future: ['–', ''] }
const SERIES = [
  { key: 'p', label: 'Erzeugung', cls: 's1' },
  { key: 'ev', label: 'Eigenverbrauch', cls: 's2' },
  { key: 'f', label: 'Einspeisung', cls: 's3' },
  { key: 'g', label: 'Netzbezug', cls: 's4' }
]

let state = null
let year = null
try { year = +localStorage.getItem('scs-year') || null } catch {}
let dirty = false

function toast(msg) {
  const t = $('#toast')
  t.textContent = msg
  t.hidden = false
  clearTimeout(toast.t)
  toast.t = setTimeout(() => (t.hidden = true), 3500)
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'X-Sonnen-Studio': '1', ...(opts.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`)
  return data
}

async function load() {
  state = await api('/api/state' + (year ? `?year=${year}` : ''))
  year = state.year
  try { localStorage.setItem('scs-year', year) } catch {}
  render()
}

// ---------- Tabs ----------
function showTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name))
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`))
  try { localStorage.setItem('scs-tab', name) } catch {}
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)))

$('#year').addEventListener('change', (e) => { year = +e.target.value; load() })

function render() {
  const s = state
  // Jahre mit Daten mit Haken
  $('#year').innerHTML = s.years.map((y) => `<option value="${y}" ${y === s.year ? 'selected' : ''}>${y}${s.dataYears.includes(y) ? ' ✓' : ''}</option>`).join('')
  renderWarnings()
  renderTiles()
  renderChart()
  renderDaily()
  renderTax()
  renderData()
  if (!dirty) renderSettings()
  const v = s.version
  $('#foot').textContent = `Steuer-Studio ${v.version}${v.build ? ` · Build ${v.build}` : ''}${v.commit ? ` · ${v.commit}` : ''} · Rechenhilfe, keine Steuerberatung`
}

function renderWarnings() {
  const s = state
  const out = []
  if (!s.files.length) out.push(`<div class="alert info">Noch keine Daten. Oben auf <b>Datei hochladen</b> klicken, die Datei einfach ins Fenster ziehen oder den sonnen-Export in den Eingangsordner legen.</div>`)
  if (s.settings.plant.taxSelfUse && !s.settings.prices.length) out.push(`<div class="alert error">Kein Strompreis eingetragen – ohne Preis gibt es keine Bemessungsgrundlage. <a href="#" data-go="settings">Einstellungen öffnen</a></div>`)
  for (const w of s.warnings) out.push(`<div class="alert ${w.level}">${esc(w.text)}</div>`)
  $('#warnings').innerHTML = out.join('')
  $$('#warnings [data-go]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showTab(a.dataset.go) }))
}

function renderTiles() {
  const t = state.total
  const s = state.settings
  const cov = state.coverage
  const tiles = [
    ['Erzeugung', fmtKwh(t.p) + ' kWh', cov.days ? `${cov.days} Tage${cov.est ? `, ${cov.est} geschätzt` : ''}` : 'keine Daten'],
    ['Eigenverbrauch', fmtKwh(t.ev) + ' kWh', `Quote ${fmtPct(t.evQuote)}`],
    ['Einspeisung', fmtKwh(t.f) + ' kWh', s.feedin.length ? `≈ ${fmtEur(t.feedinNet)} netto` : 'Vergütung nicht eingetragen'],
    ['Netzbezug', fmtKwh(t.g) + ' kWh', `Autarkie ${fmtPct(t.autarky)}`],
    ['Privater Eigenverbrauch', fmtKwh(t.priv) + ' kWh', `Firmenanteil ${fmtKwh(t.business)} kWh`]
  ]
  if (s.plant.taxSelfUse) tiles.push(['USt auf Eigenverbrauch', fmtEur(t.vat), `Bemessungsgrundlage ${fmtEur(t.bmg)}`, true])
  $('#tiles').innerHTML = tiles.map(([l, v, sub, strong]) => `<div class="tile ${strong ? 'strong' : ''}"><div class="label">${esc(l)}</div><div class="value">${esc(v)}</div><div class="sub">${esc(sub)}</div></div>`).join('')
}

// ---------- Diagramme ----------
function niceMax(v) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

const tip = $('#tooltip')
function showTip(html, ev) {
  tip.innerHTML = html
  tip.hidden = false
  const r = tip.getBoundingClientRect()
  let x = ev.clientX + 14
  let y = ev.clientY + 14
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14
  tip.style.left = Math.max(8, x) + 'px'
  tip.style.top = Math.max(8, y) + 'px'
}
const hideTip = () => (tip.hidden = true)

function renderChart() {
  const months = state.months
  $('#legend').innerHTML = SERIES.map((s) => `<span><i class="${s.cls}"></i>${s.label}</span>`).join('')
  const W = 900
  const H = 300
  const m = { l: 52, r: 8, t: 10, b: 26 }
  const iw = W - m.l - m.r
  const ih = H - m.t - m.b
  const max = niceMax(Math.max(...months.flatMap((mo) => SERIES.map((s) => mo[s.key] / 1000))))
  const gw = iw / 12
  const bw = Math.min(14, (gw - 10) / 4 - 2)
  const y = (v) => m.t + ih - (v / max) * ih
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monatswerte in kWh">`
  svg += '<g class="grid axis">'
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v.toLocaleString('de-DE')}</text>`
  }
  svg += '</g>'
  months.forEach((mo, i) => {
    const gx = m.l + i * gw
    svg += `<rect class="hit" data-i="${i}" x="${gx + 1}" y="${m.t}" width="${gw - 2}" height="${ih}" rx="4"/>`
    const start = gx + (gw - (bw * 4 + 2 * 3)) / 2
    SERIES.forEach((s, k) => {
      const v = mo[s.key] / 1000
      if (v <= 0) return
      const x = start + k * (bw + 2)
      const top = y(v)
      const h = m.t + ih - top
      const r = Math.min(4, h, bw / 2)
      // oben abgerundet, unten gerade auf der Grundlinie
      svg += `<path class="${s.cls}" pointer-events="none" d="M${x},${m.t + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${m.t + ih} Z"/>`
    })
    svg += `<text class="axis" x="${gx + gw / 2}" y="${H - 8}" text-anchor="middle" fill="var(--muted)" font-size="11">${MON[i]}</text>`
  })
  svg += `<line class="base" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}"/></svg>`
  const el = $('#chart')
  el.innerHTML = svg
  $$('.hit', el).forEach((r) => {
    r.addEventListener('mousemove', (ev) => {
      const mo = months[+r.dataset.i]
      showTip(`<b>${mo.name} ${state.year}</b>` + SERIES.map((s) => `<div class="row"><span><i class="${s.cls}"></i>${s.label}</span><span>${fmtKwh(mo[s.key])} kWh</span></div>`).join('') +
        (mo.estDays ? `<div class="row"><span>geschätzte Tage</span><span>${mo.estDays}</span></div>` : '') + (mo.missingDays && !mo.futureDays ? `<div class="row"><span>fehlende Tage</span><span>${mo.missingDays}</span></div>` : ''), ev)
    })
    r.addEventListener('mouseleave', hideTip)
  })
  // Tabellenansicht
  $('#chartTable').innerHTML = `<table><thead><tr><th>Monat</th>${SERIES.map((s) => `<th class="num">${s.label} kWh</th>`).join('')}<th class="num">Autarkie</th><th class="num">geschätzt</th></tr></thead><tbody>` +
    months.map((mo) => `<tr><td>${mo.name}</td>${SERIES.map((s) => `<td class="num">${fmtKwh(mo[s.key], 1)}</td>`).join('')}<td class="num">${fmtPct(mo.autarky)}</td><td class="num">${mo.estDays || ''}</td></tr>`).join('') +
    `<tr class="sum"><td>Summe</td>${SERIES.map((s) => `<td class="num">${fmtKwh(state.total[s.key], 1)}</td>`).join('')}<td class="num">${fmtPct(state.total.autarky)}</td><td class="num">${state.total.estDays || ''}</td></tr></tbody></table>`
}

$('#toggleTable').addEventListener('click', (e) => {
  const on = $('#chartTable').hidden
  $('#chartTable').hidden = !on
  $('#chart').hidden = on
  $('#legend').hidden = on
  e.target.setAttribute('aria-pressed', on)
  e.target.textContent = on ? 'Diagramm' : 'Tabelle'
})

function renderDaily() {
  const days = state.days
  const W = 900
  const H = 140
  const m = { l: 52, r: 8, t: 8, b: 22 }
  const iw = W - m.l - m.r
  const ih = H - m.t - m.b
  const max = niceMax(Math.max(1, ...days.map((d) => (d.none ? 0 : d.p / 1000))))
  const bw = iw / days.length
  const y = (v) => m.t + ih - (v / max) * ih
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Erzeugung je Tag in kWh"><g class="grid axis">`
  for (const v of [0, max / 2, max]) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v.toLocaleString('de-DE')}</text>`
  svg += '</g>'
  days.forEach((d, i) => {
    const x = m.l + i * bw
    if (d.date.slice(8) === '01') svg += `<text class="axis" x="${x + 2}" y="${H - 6}" fill="var(--muted)" font-size="11">${MON[+d.date.slice(5, 7) - 1]}</text>`
    if (d.none) return
    const top = y(d.p / 1000)
    svg += d.est
      ? `<rect class="est-bar" x="${x + 0.5}" y="${top}" width="${Math.max(0.5, bw - 1)}" height="${m.t + ih - top}"/>`
      : `<rect class="s1" x="${x}" y="${top}" width="${Math.max(0.6, bw - 0.6)}" height="${m.t + ih - top}"/>`
  })
  svg += `<line class="base" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}"/><rect class="hit-all" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`
  const el = $('#daily')
  el.innerHTML = svg
  const svgEl = $('svg', el)
  $('.hit-all', el).addEventListener('mousemove', (ev) => {
    const r = svgEl.getBoundingClientRect()
    const x = ((ev.clientX - r.left) / r.width) * W
    const i = Math.min(days.length - 1, Math.max(0, Math.floor((x - m.l) / bw)))
    const d = days[i]
    if (d.none) return showTip(`<b>${fmtDate(d.date)}</b>keine Daten`, ev)
    const flags = [d.est && 'geschätzt', d.partial && 'unvollständig?', d.gridCharge && 'Netzladung'].filter(Boolean).join(', ')
    showTip(`<b>${fmtDate(d.date)}</b>` + [['Erzeugung', d.p], ['Eigenverbrauch', d.ev], ['Einspeisung', d.f], ['Netzbezug', d.g], ['Hausverbrauch', d.c]]
      .map(([l, v]) => `<div class="row"><span>${l}</span><span>${fmtKwh(v, 1)} kWh</span></div>`).join('') + (flags ? `<div class="row"><span>${flags}</span></div>` : ''), ev)
  })
  $('.hit-all', el).addEventListener('mouseleave', hideTip)
}

// ---------- Umsatzsteuer ----------
function renderTax() {
  const s = state.settings
  const y = state.year
  $('#yearPdf').href = `/api/report/year.pdf?year=${y}`
  $('#csvMonths').href = `/api/export/months.csv?year=${y}`
  $('#csvDays').href = `/api/export/days.csv?year=${y}`
  const info = []
  if (!s.plant.taxSelfUse) info.push('<div class="alert info">Die Umsatzsteuer auf den Eigenverbrauch ist in den Einstellungen ausgeschaltet – es werden nur Energiewerte ausgewertet.</div>')
  const b = s.business[s.business.length - 1]
  if (s.plant.taxSelfUse && b && b.value === 0) info.push('<div class="alert warn">Firmenanteil ist 0 – es wird der gesamte Eigenverbrauch als privat versteuert. Trage die mit dem Steuerberater abgestimmte Pauschale unter Einstellungen ein.</div>')
  $('#taxInfo').innerHTML = info.join('')
  const rows = state.periods.map((p) => {
    const [label, cls] = STATE[p.state]
    const pdf = p.days ? `<a class="btn small ghost" href="/api/report/period.pdf?year=${y}&p=${p.id}">PDF</a>` : ''
    return `<tr><td>${esc(p.name)}<div class="muted small">${fmtDate(p.from)} – ${fmtDate(p.to)}</div></td><td class="num">${fmtKwh(p.ev, 1)}</td><td class="num">${fmtKwh(p.business, 1)}</td><td class="num">${fmtKwh(p.priv, 1)}</td><td class="num">${fmtCt(p.priceCt)}</td><td class="num"><b>${fmtEur(p.bmg)}</b></td><td class="num"><b>${fmtEur(p.vat)}</b></td>${s.feedin.length ? `<td class="num">${fmtEur(p.feedinNet)}</td>` : ''}<td><span class="badge ${cls}">${label}</span>${p.estDays ? ` <span class="badge warn">${p.estDays} Tg. geschätzt</span>` : ''}</td><td>${pdf}</td></tr>`
  })
  const t = state.total
  rows.push(`<tr class="sum"><td>Jahr ${y}</td><td class="num">${fmtKwh(t.ev, 1)}</td><td class="num">${fmtKwh(t.business, 1)}</td><td class="num">${fmtKwh(t.priv, 1)}</td><td class="num">${fmtCt(t.priceCt)}</td><td class="num">${fmtEur(t.bmg)}</td><td class="num">${fmtEur(t.vat)}</td>${s.feedin.length ? `<td class="num">${fmtEur(t.feedinNet)}</td>` : ''}<td></td><td></td></tr>`)
  $('#periods').innerHTML = `<table><thead><tr><th>Zeitraum</th><th class="num">Eigenverbr. kWh</th><th class="num">Firma kWh</th><th class="num">privat kWh</th><th class="num">Ø Preis</th><th class="num">Bemessungsgr.</th><th class="num">USt ${s.taxRate} %</th>${s.feedin.length ? '<th class="num">Einspeisevergütung</th>' : ''}<th>Status</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>`
}

// ---------- Daten ----------
function renderData() {
  const s = state
  $('#importDir').textContent = s.importDir
  $('#importLog').innerHTML = s.importLog.slice(0, 8).map((l) => `<li><span class="${l.ok ? 'ok' : 'bad'}">${l.ok ? '✓' : '✗'}</span> ${esc(new Date(l.at).toLocaleString('de-DE'))} · <b>${esc(l.name)}</b>: ${esc(l.text)}</li>`).join('')
  $('#files').innerHTML = s.files.length
    ? `<table><thead><tr><th>Datei</th><th>Zeitraum</th><th class="num">Tage</th><th>eingelesen</th><th>Weg</th><th>Prüfsumme</th><th></th></tr></thead><tbody>${s.files.map((f) => `<tr><td>${esc(f.name)}</td><td>${fmtDate(f.from)} – ${fmtDate(f.to)}</td><td class="num">${f.days}</td><td>${esc(new Date(f.importedAt).toLocaleString('de-DE'))}</td><td>${f.via === 'ordner' ? 'Ordner' : 'Upload'}</td><td><code title="${esc(f.sha)}">${esc(f.sha.slice(0, 12))}…</code></td><td><button class="btn small danger" data-del="${esc(f.sha)}">Entfernen</button></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Noch keine Dateien.</p>'
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Datei aus der Auswertung nehmen? Das Original bleibt im Archiv.')) return
    await api(`/api/files/${b.dataset.del}`, { method: 'DELETE' })
    toast('Datei entfernt.')
    load()
  }))
  $('#backupDir').textContent = s.backupDir
  $('#backups').innerHTML = s.backups.length
    ? s.backups.map((b) => `<li>${esc(new Date(b.at).toLocaleString('de-DE'))} · ${esc(b.name)} · ${(b.size / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 })} KB</li>`).join('')
    : '<li class="muted">Noch keine automatische Sicherung.</li>'
  const pctTxt = (d) => (d == null ? '–' : `<span class="badge ${Math.abs(d) > 0.03 ? 'error' : 'ok'}">${fmtPct(d)}</span>`)
  const num = (n) => (n == null ? '–' : n.toLocaleString('de-DE', { maximumFractionDigits: 1 }))
  $('#meters').innerHTML = s.meters.length
    ? `<table><thead><tr><th>Zeitraum</th><th class="num">Bezug Zähler</th><th class="num">Bezug sonnen</th><th class="num">Abw.</th><th class="num">Einsp. Zähler</th><th class="num">Einsp. sonnen</th><th class="num">Abw.</th><th class="num">ohne Daten</th></tr></thead><tbody>${s.meters.map((c) => `<tr><td>${fmtDate(c.from)} – ${fmtDate(c.to)}</td><td class="num">${num(c.meterPurchase)}</td><td class="num">${num(c.sonnenPurchase)}</td><td class="num">${pctTxt(c.devPurchase)}</td><td class="num">${num(c.meterFeedin)}</td><td class="num">${num(c.sonnenFeedin)}</td><td class="num">${pctTxt(c.devFeedin)}</td><td class="num">${c.missing ? `<span class="badge warn">${c.missing} Tg.</span>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Mindestens zwei Zählerstände eintragen (Einstellungen → Zählerstände).</p>'
}

async function upload(files) {
  let lastYear = null
  for (const f of files) {
    try {
      const r = await fetch(`/api/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'X-Sonnen-Studio': '1' }, body: f })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      toast(d.duplicate ? `${f.name}: schon eingelesen` : `${f.name}: ${d.file.days} Tage eingelesen (${fmtDate(d.file.from)} – ${fmtDate(d.file.to)})`)
      lastYear = +d.file.to.slice(0, 4)
    } catch (e) {
      toast(`${f.name}: ${e.message}`)
    }
  }
  // nach dem Hochladen direkt das Ergebnis zeigen
  if (lastYear) { year = lastYear; showTab('overview') }
  load()
}
$('#topUpload').addEventListener('change', (e) => { upload([...e.target.files]); e.target.value = '' })
// Datei irgendwo ins Fenster ziehen
addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() })
addEventListener('drop', (e) => {
  if (e.target.closest?.('#drop') || !e.dataTransfer?.files?.length) return
  e.preventDefault()
  upload([...e.dataTransfer.files].filter((f) => /\.(csv|xlsx)$/i.test(f.name)))
})
const drop = $('#drop')
$('#fileInput').addEventListener('change', (e) => upload([...e.target.files]))
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over') })
drop.addEventListener('dragleave', () => drop.classList.remove('over'))
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); upload([...e.dataTransfer.files]) })
$('#restoreInput').addEventListener('change', async (e) => {
  const f = e.target.files[0]
  e.target.value = ''
  if (!f || !confirm('Sicherung einspielen? Der aktuelle Stand wird vorher automatisch gesichert.')) return
  try {
    const r = await fetch('/api/restore', { method: 'POST', headers: { 'X-Sonnen-Studio': '1' }, body: f })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error)
    dirty = false
    toast(`Sicherung eingespielt (${d.files} Dateien).`)
    load()
  } catch (err) {
    toast(err.message)
  }
})
$('#scanBtn').addEventListener('click', async (e) => {
  e.target.disabled = true
  try { await api('/api/scan', { method: 'POST' }); toast('Eingangsordner geprüft.'); await load() } catch (err) { toast(err.message) }
  e.target.disabled = false
})

// ---------- Einstellungen ----------
const LISTS = {
  prices: { title: 'Strompreise (Netzbezug, netto)', hint: 'Von der Rechnung deines Stromlieferanten: Arbeitspreis (ct/kWh) und Grundpreis (€ pro Jahr) ohne USt. Bei Preisänderung neue Zeile mit „gültig ab“.', cols: [['from', 'gültig ab', 'date'], ['supplier', 'Lieferant', 'text'], ['workCt', 'Arbeitspreis ct/kWh', 'number'], ['baseEurYear', 'Grundpreis €/Jahr', 'number'], ['note', 'Notiz', 'text']] },
  business: { title: 'Firmenanteil am Eigenverbrauch (Pauschale)', hint: 'Firma und Haushalt nutzen den Strom gemeinsam. Der Firmenanteil ist keine Wertabgabe und wird abgezogen. Prozent des Eigenverbrauchs oder feste kWh je Jahr (tageweise verteilt).', cols: [['from', 'gültig ab', 'date'], ['mode', 'Art', 'mode'], ['value', 'Wert', 'number'], ['note', 'Begründung / Absprache Steuerberater', 'text']] },
  feedin: { title: 'Einspeisevergütung (optional)', hint: 'Netto-Vergütung je kWh laut EEG/Netze BW – nur für die Übersicht und Kz. 81.', cols: [['from', 'gültig ab', 'date'], ['ct', 'ct/kWh netto', 'number']] },
  meters: { title: 'Zählerstände Netze BW (optional)', hint: 'Stand am Morgen des Ablesetags in kWh. Dient dem Abgleich mit den sonnen-Messwerten (Daten → Abgleich).', cols: [['date', 'Datum', 'date'], ['purchase', 'Bezug kWh', 'number'], ['feedin', 'Einspeisung kWh', 'number'], ['note', 'Notiz', 'text']] }
}
let draft = null

function cell(list, i, [key, , type], v) {
  const a = `data-list="${list}" data-i="${i}" data-key="${key}"`
  if (type === 'mode') return `<select ${a}><option value="percent" ${v === 'percent' ? 'selected' : ''}>% des Eigenverbrauchs</option><option value="kwh" ${v === 'kwh' ? 'selected' : ''}>kWh je Jahr</option></select>`
  return `<input ${a} type="${type === 'number' ? 'text' : type}" ${type === 'number' ? 'inputmode="decimal"' : ''} value="${esc(v ?? '')}">`
}

function listHtml(name) {
  const L = LISTS[name]
  const rows = draft[name]
  return `<div class="card"><div class="card-head"><h2>${L.title}</h2><button type="button" class="btn small ghost" data-add="${name}">+ Zeile</button></div><p class="hint">${L.hint}</p>
    ${rows.length ? `<div class="table-wrap"><table class="list-table"><thead><tr>${L.cols.map((c) => `<th>${c[1]}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map((r, i) => `<tr>${L.cols.map((c) => `<td>${cell(name, i, c, r[c[0]])}</td>`).join('')}<td><button type="button" class="btn small danger" data-rm="${name}" data-i="${i}" aria-label="Zeile löschen">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Noch kein Eintrag.</p>'}</div>`
}

function renderSettings() {
  const s = state.settings
  draft = JSON.parse(JSON.stringify(s))
  drawSettings()
}

function drawSettings() {
  const s = draft
  const f = $('#settingsForm')
  f.innerHTML = `
  <div class="card"><h2>Anlage</h2><div class="grid2">
    <label class="f">Bezeichnung<input data-k="plant.name" value="${esc(s.plant.name)}"></label>
    <label class="f">Leistung (kWp)<input data-k="plant.kwp" inputmode="decimal" value="${esc(s.plant.kwp)}"></label>
    <label class="f">Inbetriebnahme<input type="date" data-k="plant.commissioned" value="${esc(s.plant.commissioned)}"></label>
  </div>
  <label class="chk"><input type="checkbox" data-k="plant.inputVat" ${s.plant.inputVat ? 'checked' : ''}> Beim Kauf Vorsteuer gezogen</label>
  <label class="chk"><input type="checkbox" data-k="plant.taxSelfUse" ${s.plant.taxSelfUse ? 'checked' : ''}> Privaten Eigenverbrauch der Umsatzsteuer unterwerfen (unentgeltliche Wertabgabe, § 3 Abs. 1b UStG)</label>
  <p class="hint">Gilt für Anlagen, die mit Vorsteuerabzug gekauft wurden und zum Unternehmen gehören – unabhängig vom Alter der Anlage. Ausschalten, wenn die Anlage entnommen wurde oder du Kleinunternehmer bist.</p></div>

  <div class="card"><h2>Umsatzsteuer & Berechnung</h2><div class="grid2">
    <label class="f">Voranmeldung<select data-k="period"><option value="month" ${s.period === 'month' ? 'selected' : ''}>monatlich</option><option value="quarter" ${s.period === 'quarter' ? 'selected' : ''}>vierteljährlich</option><option value="year" ${s.period === 'year' ? 'selected' : ''}>jährlich</option></select></label>
    <label class="f">Steuersatz (%)<input data-k="taxRate" inputmode="decimal" value="${esc(s.taxRate)}"></label>
    <label class="f">Grundpreis einrechnen<select data-k="baseShare"><option value="grid" ${s.baseShare === 'grid' ? 'selected' : ''}>umgelegt auf den Netzbezug</option><option value="total" ${s.baseShare === 'total' ? 'selected' : ''}>umgelegt auf Netzbezug + Eigenverbrauch</option><option value="none" ${s.baseShare === 'none' ? 'selected' : ''}>nicht einrechnen (nur Arbeitspreis)</option></select></label>
    <label class="f">Eigenverbrauch berechnen<select data-k="method"><option value="feedin" ${s.method === 'feedin' ? 'selected' : ''}>Erzeugung − Einspeisung (üblich)</option><option value="battery" ${s.method === 'battery' ? 'selected' : ''}>… zusätzlich ohne Batterieverluste</option></select></label>
  </div>
  <label class="chk"><input type="checkbox" data-k="estimateGaps" ${s.estimateGaps ? 'checked' : ''}> Fehlende Tage schätzen (Mittel aus bis zu 7 Tagen davor und danach, im Bericht gekennzeichnet)</label>
  <label class="chk"><input type="checkbox" data-k="feedinVat" ${s.feedinVat ? 'checked' : ''}> Netze BW zahlt Umsatzsteuer auf die Einspeisevergütung (Regelbesteuerung)</label></div>

  ${listHtml('prices')}
  ${listHtml('business')}
  ${listHtml('feedin')}
  ${listHtml('meters')}

  <div class="card"><h2>Für den Bericht</h2><div class="grid2">
    <label class="f">Name / Firma<input data-k="owner.name" value="${esc(s.owner.name)}"></label>
    <label class="f">Steuernummer<input data-k="owner.taxNo" value="${esc(s.owner.taxNo)}"></label>
  </div>
  <label class="f mt">Hinweise für den Steuerberater (erscheinen im Jahresbericht)<textarea data-k="notes">${esc(s.notes)}</textarea></label></div>

  <div class="savebar"><span class="muted small" id="saveState">${dirty ? 'Ungespeicherte Änderungen' : ''}</span><button type="button" class="btn ghost" id="resetBtn" ${dirty ? '' : 'disabled'}>Verwerfen</button><button type="submit" class="btn" id="saveBtn">Speichern</button></div>`
}

function setPath(obj, path, v) {
  const parts = path.split('.')
  let o = obj
  while (parts.length > 1) o = o[parts.shift()]
  o[parts[0]] = v
}

function markDirty() {
  dirty = true
  $('#saveState').textContent = 'Ungespeicherte Änderungen'
  $('#resetBtn').disabled = false
}

$('#settingsForm').addEventListener('input', (e) => {
  const el = e.target
  if (el.dataset.k) setPath(draft, el.dataset.k, el.type === 'checkbox' ? el.checked : el.value)
  else if (el.dataset.list) draft[el.dataset.list][+el.dataset.i][el.dataset.key] = el.value
  else return
  markDirty()
})
$('#settingsForm').addEventListener('change', (e) => e.target.dispatchEvent(new Event('input', { bubbles: true })))
$('#settingsForm').addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]')
  const rm = e.target.closest('[data-rm]')
  if (add) {
    const name = add.dataset.add
    const today = state.today
    const row = name === 'meters' ? { date: today, purchase: '', feedin: '', note: '' } : name === 'business' ? { from: `${state.year}-01-01`, mode: 'percent', value: '', note: '' } : { from: `${state.year}-01-01` }
    draft[name].push(row)
    markDirty()
    drawSettings()
  } else if (rm) {
    draft[rm.dataset.rm].splice(+rm.dataset.i, 1)
    markDirty()
    drawSettings()
  } else if (e.target.id === 'resetBtn') {
    dirty = false
    renderSettings()
  }
})
$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
    dirty = false
    toast('Einstellungen gespeichert.')
    await load()
  } catch (err) {
    toast(err.message)
  }
})
addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault() })

// ---------- Start ----------
try { const t = localStorage.getItem('scs-tab'); if (t) showTab(t) } catch {}
load().catch((e) => toast(e.message))
setInterval(() => { if (!dirty && document.visibilityState === 'visible') load().catch(() => {}) }, 60000)
