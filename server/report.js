// PDF-Berichte (pdfkit, Standardschrift Helvetica – Umlaute und € sind enthalten)
import PDFDocument from 'pdfkit'
import { MONTHS, fmtDate, meterChecks } from './calc.js'
import { VERSION } from './version.js'

const kwh = (wh) => (wh / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const eur = (n) => (n ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const ct = (n) => (n == null ? '–' : n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ct')
const pct = (n) => (n == null ? '–' : (n * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' %')
const num = (n, d = 1) => (n == null ? '–' : Number(n).toLocaleString('de-DE', { maximumFractionDigits: d }))

const COLOR = { ink: '#1b1b1a', muted: '#62615c', line: '#d9d8d2', head: '#f1f0ec', accent: '#2a78d6', warn: '#9a5b00', err: '#b42318' }
const STATE = { complete: 'vollständig', incomplete: 'unvollständig', running: 'läuft noch', future: '–' }
const BASE_TEXT = {
  grid: 'Der Grundpreis wird anteilig auf den Jahres-Netzbezug umgelegt und dem Arbeitspreis zugeschlagen.',
  total: 'Der Grundpreis wird anteilig auf Netzbezug + Eigenverbrauch des Jahres umgelegt und dem Arbeitspreis zugeschlagen.',
  none: 'Angesetzt wird nur der Arbeitspreis (ohne Grundpreis).'
}
const METHOD = {
  feedin: 'Eigenverbrauch = Erzeugung – Netzeinspeisung (Batterieverluste zählen zum Eigenverbrauch).',
  battery: 'Eigenverbrauch = Erzeugung – Netzeinspeisung – Batterieverluste (geladen – entladen).'
}

function newDoc(title) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 60, left: 50, right: 50 }, bufferPages: true, info: { Title: title, Creator: `Sonnen-CSV-Studio ${VERSION}` } })
  doc.font('Helvetica').fillColor(COLOR.ink)
  return doc
}

function footer(doc, left) {
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i)
    const y = doc.page.height - 40
    doc.save().fontSize(7.5).fillColor(COLOR.muted)
    doc.text(left, 50, y, { width: 380, lineBreak: false, height: 10 })
    doc.text(`Seite ${i + 1} von ${range.count}`, doc.page.width - 150, y, { width: 100, align: 'right', lineBreak: false, height: 10 })
    doc.restore()
  }
}

function h1(doc, text, sub) {
  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLOR.ink).text(text)
  if (sub) doc.font('Helvetica').fontSize(9.5).fillColor(COLOR.muted).text(sub)
  doc.moveDown(0.8).fillColor(COLOR.ink)
}

function h2(doc, text) {
  ensure(doc, 60)
  doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).fillColor(COLOR.ink).text(text)
  doc.moveDown(0.3).font('Helvetica').fontSize(9)
}

function para(doc, text, opts = {}) {
  doc.font('Helvetica').fontSize(opts.size || 9).fillColor(opts.color || COLOR.ink).text(text, { width: doc.page.width - 100, ...opts })
  doc.fillColor(COLOR.ink)
}

function ensure(doc, h) {
  if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage()
}

// einfache Tabelle: cols [{label, w, align}], rows [[...]], opts {bold: Set(index), zebra}
function table(doc, cols, rows, opts = {}) {
  const x0 = doc.page.margins.left
  const size = opts.size || 8.5
  const pad = 3
  const drawHead = () => {
    let x = x0
    doc.font('Helvetica-Bold').fontSize(size)
    const h = Math.max(...cols.map((c) => doc.heightOfString(c.label, { width: c.w - pad * 2 }))) + 9
    if (doc.y + h + 20 > doc.page.height - doc.page.margins.bottom) doc.addPage()
    const top = doc.y
    doc.save().rect(x0, top, cols.reduce((a, c) => a + c.w, 0), h).fill(COLOR.head).restore()
    doc.font('Helvetica-Bold').fontSize(size).fillColor(COLOR.ink)
    for (const c of cols) {
      doc.text(c.label, x + pad, top + 4.5, { width: c.w - pad * 2, align: c.align || 'left' })
      x += c.w
    }
    doc.y = top + h
  }
  drawHead()
  rows.forEach((r, ri) => {
    doc.font(opts.bold?.has(ri) ? 'Helvetica-Bold' : 'Helvetica').fontSize(size)
    const heights = r.map((v, i) => doc.heightOfString(String(v ?? ''), { width: cols[i].w - pad * 2 }))
    const h = Math.max(...heights) + pad * 2
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); drawHead() }
    const y = doc.y
    if (opts.bold?.has(ri)) doc.save().rect(x0, y, cols.reduce((a, c) => a + c.w, 0), h).fill('#f7f6f3').restore()
    let x = x0
    doc.fillColor(COLOR.ink).font(opts.bold?.has(ri) ? 'Helvetica-Bold' : 'Helvetica')
    r.forEach((v, i) => {
      doc.text(String(v ?? ''), x + pad, y + pad, { width: cols[i].w - pad * 2, align: cols[i].align || 'left' })
      x += cols[i].w
    })
    doc.moveTo(x0, y + h).lineTo(x, y + h).lineWidth(0.5).strokeColor(COLOR.line).stroke()
    doc.y = y + h
  })
  doc.x = x0
  doc.moveDown(0.5)
}

// Kennzahlen als zweispaltige Liste
function facts(doc, list) {
  const x0 = doc.page.margins.left
  for (const [k, v, strong] of list) {
    ensure(doc, 16)
    const y = doc.y
    doc.font('Helvetica').fontSize(9.5).fillColor(COLOR.muted).text(k, x0, y, { width: 300 })
    doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fillColor(COLOR.ink).text(v, x0 + 300, y, { width: 195, align: 'right' })
    doc.y = Math.max(doc.y, y + 14)
  }
  doc.x = x0
}

function plantFacts(s) {
  return [
    ['Anlage', s.plant.name || '–'],
    ['Leistung', s.plant.kwp !== '' ? `${num(s.plant.kwp, 2)} kWp` : '–'],
    ['Inbetriebnahme', fmtDate(s.plant.commissioned) || '–'],
    ['Vorsteuer beim Kauf gezogen', s.plant.inputVat ? 'ja' : 'nein'],
    ['Privater Eigenverbrauch umsatzsteuerpflichtig (§ 3 Abs. 1b UStG)', s.plant.taxSelfUse ? `ja, ${num(s.taxRate)} %` : 'nein']
  ]
}

function ownerLine(s) {
  return [s.owner.name, s.owner.taxNo ? `St.-Nr. ${s.owner.taxNo}` : ''].filter(Boolean).join(' · ')
}

function resultFacts(t, s) {
  const list = [
    ['Erzeugung', `${kwh(t.p)} kWh`],
    ['Netzeinspeisung', `${kwh(t.f)} kWh`],
    ['Eigenverbrauch', `${kwh(t.ev)} kWh`, true],
    ['davon Firmenanteil (Pauschale)', `${kwh(t.business)} kWh`],
    ['davon privat', `${kwh(t.priv)} kWh`, true]
  ]
  if (s.plant.taxSelfUse) {
    list.push(
      ['Ø Strompreis netto (Bemessungsgrundlage je kWh)', ct(t.priceCt)],
      ['Bemessungsgrundlage unentgeltliche Wertabgabe', eur(t.bmg), true],
      [`Umsatzsteuer ${num(s.taxRate)} % auf die Wertabgabe`, eur(t.vat), true]
    )
  }
  if (s.feedin.length) {
    list.push(
      ['Einspeisevergütung netto (berechnet)', eur(t.feedinNet)],
      [`Umsatzsteuer auf die Einspeisevergütung${s.feedinVat ? '' : ' (nicht erhoben)'}`, eur(t.feedinVat)]
    )
  }
  if (s.plant.taxSelfUse || s.feedin.length) list.push(['Summe für Kz. 81 (Umsätze 19 %, PV-Anteil)', eur(t.kz81), true])
  return list
}

function priceRows(s, a) {
  return s.prices.map((p) => {
    const baseCt = a.baseKwh > 0 ? (p.baseEurYear * 100) / a.baseKwh : 0
    return [fmtDate(p.from), p.supplier || '', ct(p.workCt), eur(p.baseEurYear), ct(baseCt), ct(p.workCt + baseCt), p.note || '']
  })
}

export function yearReport(a, s, files, allDays) {
  const doc = newDoc(`PV-Jahresbericht ${a.year}`)
  const t = a.total
  h1(doc, `Photovoltaik – Jahresbericht ${a.year}`, [ownerLine(s), `erstellt am ${fmtDate(a.today)}`].filter(Boolean).join(' · '))

  h2(doc, 'Anlage')
  facts(doc, plantFacts(s))

  h2(doc, 'Ergebnis des Jahres')
  facts(doc, resultFacts(t, s))
  if (a.coverage.est) para(doc, `Enthält ${a.coverage.est} geschätzte Tage (siehe Datenqualität).`, { color: COLOR.warn })

  h2(doc, 'Voranmeldungszeiträume')
  const pc = [
    { label: 'Zeitraum', w: 62 }, { label: 'Eigenverbr. kWh', w: 62, align: 'right' }, { label: 'Firma kWh', w: 50, align: 'right' },
    { label: 'privat kWh', w: 52, align: 'right' }, { label: 'Ø Preis', w: 50, align: 'right' }, { label: 'Bemessungsgr.', w: 74, align: 'right' },
    { label: 'USt', w: 52, align: 'right' }, { label: 'Status', w: 93 }
  ]
  const prow = a.periods.map((p) => [p.name, kwh(p.ev), kwh(p.business), kwh(p.priv), ct(p.priceCt), eur(p.bmg), eur(p.vat), STATE[p.state] + (p.estDays ? `, ${p.estDays} Tg. geschätzt` : '')])
  prow.push(['Jahr', kwh(t.ev), kwh(t.business), kwh(t.priv), ct(t.priceCt), eur(t.bmg), eur(t.vat), ''])
  table(doc, pc, prow, { bold: new Set([prow.length - 1]) })

  h2(doc, 'Monatswerte (kWh)')
  const mc = [
    { label: 'Monat', w: 59 }, { label: 'Erzeugung', w: 54, align: 'right' }, { label: 'Verbrauch', w: 54, align: 'right' },
    { label: 'Einspeisung', w: 60, align: 'right' }, { label: 'Netzbezug', w: 54, align: 'right' }, { label: 'Batt. geladen', w: 54, align: 'right' },
    { label: 'Batt. entladen', w: 56, align: 'right' }, { label: 'Eigenverbr.', w: 54, align: 'right' }, { label: 'geschätzt', w: 50, align: 'right' }
  ]
  const mrow = a.months.map((m) => [m.name, kwh(m.p), kwh(m.c), kwh(m.f), kwh(m.g), kwh(m.ch), kwh(m.dis), kwh(m.ev), m.estDays ? `${m.estDays} Tg.` : ''])
  mrow.push(['Summe', kwh(t.p), kwh(t.c), kwh(t.f), kwh(t.g), kwh(t.ch), kwh(t.dis), kwh(t.ev), a.coverage.est ? `${a.coverage.est} Tg.` : ''])
  table(doc, mc, mrow, { bold: new Set([mrow.length - 1]) })
  para(doc, `Eigenverbrauchsquote ${pct(t.evQuote)} · Autarkie ${pct(t.autarky)} · Batterieverluste ${kwh(t.losses)} kWh`, { color: COLOR.muted })

  h2(doc, 'Berechnungsgrundlagen')
  para(doc, METHOD[s.method])
  para(doc, 'Bemessungsgrundlage der unentgeltlichen Wertabgabe ist der Einkaufspreis für Strom vom Versorger (netto), vgl. § 10 Abs. 4 Nr. 1 UStG. ' + BASE_TEXT[s.baseShare])
  doc.moveDown(0.3)
  if (s.prices.length) {
    para(doc, `Strompreise netto${a.baseKwh ? ` (Grundpreis umgelegt auf ${num(a.baseKwh, 0)} kWh)` : ''}:`, { size: 9 })
    table(doc, [
      { label: 'gültig ab', w: 58 }, { label: 'Lieferant', w: 82 }, { label: 'Arbeitspreis', w: 60, align: 'right' }, { label: 'Grundpreis/Jahr', w: 72, align: 'right' },
      { label: 'Grundpr. je kWh', w: 66, align: 'right' }, { label: 'gesamt je kWh', w: 62, align: 'right' }, { label: 'Notiz', w: 95 }
    ], priceRows(s, a))
  } else para(doc, 'Kein Strompreis eingetragen.', { color: COLOR.err })
  para(doc, 'Firmenanteil am Eigenverbrauch (Pauschale):', { size: 9 })
  table(doc, [{ label: 'gültig ab', w: 70 }, { label: 'Pauschale', w: 120 }, { label: 'Begründung / Absprache', w: 305 }],
    s.business.map((b) => [fmtDate(b.from), b.mode === 'percent' ? `${num(b.value)} % des Eigenverbrauchs` : `${num(b.value, 0)} kWh je Jahr`, b.note || '']))
  if (s.feedin.length) {
    para(doc, 'Einspeisevergütung (netto):', { size: 9 })
    table(doc, [{ label: 'gültig ab', w: 70 }, { label: 'Vergütung', w: 120 }], s.feedin.map((f) => [fmtDate(f.from), ct(f.ct) + '/kWh']))
  }

  h2(doc, 'Datenqualität')
  para(doc, `Messwerte aus dem sonnen-Speicher (Tageswerte, nicht geeicht). Ausgewertet: ${a.coverage.days} Tage ${a.coverage.from ? `vom ${fmtDate(a.coverage.from)} bis ${fmtDate(a.coverage.to)}` : ''}.`)
  if (!a.warnings.length) para(doc, 'Keine Auffälligkeiten.')
  for (const w of a.warnings) {
    ensure(doc, 20)
    para(doc, '• ' + w.text, { color: w.level === 'error' ? COLOR.err : w.level === 'warn' ? COLOR.warn : COLOR.ink })
  }
  const checks = meterChecks(allDays, s).filter((c) => c.to > `${a.year}-01-01` && c.from <= `${a.year}-12-31`)
  if (checks.length) {
    doc.moveDown(0.3)
    para(doc, 'Abgleich mit den Zählerständen (Netze BW):', { size: 9 })
    table(doc, [
      { label: 'Zeitraum', w: 120 }, { label: 'Bezug Zähler', w: 62, align: 'right' }, { label: 'Bezug sonnen', w: 62, align: 'right' }, { label: 'Abw.', w: 44, align: 'right' },
      { label: 'Einsp. Zähler', w: 62, align: 'right' }, { label: 'Einsp. sonnen', w: 62, align: 'right' }, { label: 'Abw.', w: 44, align: 'right' }, { label: 'fehlt', w: 39, align: 'right' }
    ], checks.map((c) => [`${fmtDate(c.from)} – ${fmtDate(c.to)}`, num(c.meterPurchase), num(c.sonnenPurchase), pct(c.devPurchase), num(c.meterFeedin), num(c.sonnenFeedin), pct(c.devFeedin), c.missing ? `${c.missing} Tg.` : '']))
  }

  h2(doc, 'Eingelesene Dateien')
  const used = files.filter((f) => f.to >= `${a.year}-01-01` && f.from <= `${a.year}-12-31`)
  table(doc, [{ label: 'Datei', w: 130 }, { label: 'Zeitraum', w: 110 }, { label: 'eingelesen', w: 60 }, { label: 'SHA-256 (Prüfsumme der Originaldatei)', w: 195 }],
    used.map((f) => [f.name, `${fmtDate(f.from)} – ${fmtDate(f.to)}`, fmtDate(f.importedAt.slice(0, 10)), f.sha]), { size: 7.5 })

  h2(doc, 'Hinweise und Fragen an den Steuerberater')
  const q = [
    'Firmenanteil: Ist die eingetragene Pauschale für die gemeinsame Nutzung von Firma und Haushalt so abgestimmt?',
    'Bemessungsgrundlage: Einkaufspreis des Stromlieferanten inkl. Grundpreis – passt die Umlage auf den Jahres-Netzbezug?',
    'Geschätzte Tage: Sind die Schätzungen aus den Nachbartagen für die fehlenden Zeiträume in Ordnung?',
    'Entnahme der Anlage aus dem Unternehmen (BMF-Schreiben vom 27.02.2023): Wäre das sinnvoll? Danach fiele keine Umsatzsteuer mehr auf den privaten Eigenverbrauch an.'
  ]
  q.forEach((t2) => para(doc, '• ' + t2))
  if (s.notes) { doc.moveDown(0.3); para(doc, s.notes) }
  doc.moveDown(0.6)
  para(doc, 'Dieser Bericht ist eine Rechenhilfe und keine Steuerberatung. Maßgeblich sind die Festlegungen des Steuerberaters.', { size: 8, color: COLOR.muted })

  footer(doc, `PV-Jahresbericht ${a.year} · Sonnen-CSV-Studio ${VERSION}`)
  return doc
}

export function periodReport(a, s, periodId) {
  const p = a.periods.find((x) => x.id === periodId)
  if (!p) throw new Error('Zeitraum unbekannt.')
  const title = `${p.name} ${a.year}`
  const doc = newDoc(`PV – Umsatzsteuer-Voranmeldung ${title}`)
  h1(doc, `Umsatzsteuer-Voranmeldung ${title}`, [`Photovoltaik · ${fmtDate(p.from)} bis ${fmtDate(p.to)}`, ownerLine(s), `erstellt am ${fmtDate(a.today)}`].filter(Boolean).join(' · '))
  if (p.state !== 'complete') {
    para(doc, `Achtung: Zeitraum ${STATE[p.state]}${p.missingDays ? ` – ${p.missingDays} Tage ohne Daten` : ''}${p.noPriceDays ? ` – ${p.noPriceDays} Tage ohne Strompreis` : ''}.`, { color: COLOR.err })
    doc.moveDown(0.4)
  }

  h2(doc, 'Werte für die Voranmeldung')
  facts(doc, resultFacts(p, s))
  doc.moveDown(0.4)
  para(doc, 'In ELSTER gehört die Bemessungsgrundlage der Wertabgabe (und ggf. die Einspeisevergütung) zu den steuerpflichtigen Umsätzen zum Steuersatz von 19 % (Kz. 81) – zusammen mit den übrigen Umsätzen des Unternehmens.', { color: COLOR.muted })

  h2(doc, 'Monate im Zeitraum')
  const rows = p.months.map((mi) => {
    const m = a.months[mi - 1]
    return [MONTHS[mi - 1], kwh(m.p), kwh(m.f), kwh(m.ev), kwh(m.business), kwh(m.priv), eur(m.bmg), m.estDays ? `${m.estDays} Tg.` : '']
  })
  rows.push(['Summe', kwh(p.p), kwh(p.f), kwh(p.ev), kwh(p.business), kwh(p.priv), eur(p.bmg), p.estDays ? `${p.estDays} Tg.` : ''])
  table(doc, [
    { label: 'Monat', w: 70 }, { label: 'Erzeugung', w: 60, align: 'right' }, { label: 'Einspeisung', w: 62, align: 'right' }, { label: 'Eigenverbr.', w: 62, align: 'right' },
    { label: 'Firma', w: 55, align: 'right' }, { label: 'privat', w: 60, align: 'right' }, { label: 'Bemessungsgr.', w: 72, align: 'right' }, { label: 'geschätzt', w: 54, align: 'right' }
  ], rows, { bold: new Set([rows.length - 1]) })
  para(doc, METHOD[s.method], { color: COLOR.muted })

  const inP = a.warnings.filter((w) => (w.from && w.to >= p.from && w.from <= p.to) || (w.dates && w.dates.some((d) => d >= p.from && d <= p.to)))
  if (inP.length) {
    h2(doc, 'Hinweise')
    inP.forEach((w) => para(doc, '• ' + w.text, { color: w.level === 'error' ? COLOR.err : w.level === 'warn' ? COLOR.warn : COLOR.ink }))
  }
  doc.moveDown(0.6)
  para(doc, 'Rechenhilfe, keine Steuerberatung. Messwerte aus dem sonnen-Speicher (nicht geeicht).', { size: 8, color: COLOR.muted })
  footer(doc, `PV-Voranmeldung ${title} · Sonnen-CSV-Studio ${VERSION}`)
  return doc
}
