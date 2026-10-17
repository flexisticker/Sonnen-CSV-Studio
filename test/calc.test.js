// Tests mit erfundenen Werten (keine echten Verbrauchsdaten im Repo)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { csvRows, rowsToDays } from '../server/parse.js'
import { analyzeYear, meterChecks, addDays } from '../server/calc.js'
import { normalizeSettings } from '../server/settings.js'

const HEAD = 'timestamp,produced_energy,consumed_energy,battery_charged_energy,battery_discharged_energy,grid_feedin_energy,grid_purchase_energy'

function makeDays(from, to, fn) {
  const days = {}
  for (let d = from; d <= to; d = addDays(d, 1)) days[d] = { p: 0, c: 0, ch: 0, dis: 0, f: 0, g: 0, ...fn(d) }
  return days
}

test('CSV im sonnen-Format wird gelesen, mehrere Zeilen je Tag summiert', () => {
  const text = [HEAD, '2025-03-01T00:00:00+01:00,1000,2000,300,200,100,1200', '2025-03-01T12:00:00+01:00,500,0,0,0,0,0', '2025-03-02T00:00:00+01:00,10,20,0,0,0,10'].join('\n')
  const r = rowsToDays(csvRows(text))
  assert.equal(r.rows, 3)
  assert.deepEqual(Object.keys(r.days), ['2025-03-01', '2025-03-02'])
  assert.equal(r.days['2025-03-01'].p, 1500)
})

test('Semikolon, Dezimalkomma und kWh-Spalten', () => {
  const text = 'Datum;Erzeugung (kWh);Verbrauch (kWh);Batterieladung (kWh);Batterieentladung (kWh);Einspeisung (kWh);Netzbezug (kWh)\n01.03.2025;1,5;2;0;0;0,25;1'
  const r = rowsToDays(csvRows(text))
  assert.equal(r.days['2025-03-01'].p, 1500)
  assert.equal(r.days['2025-03-01'].f, 250)
})

test('fehlende Spalten werden gemeldet', () => {
  assert.throws(() => rowsToDays(csvRows('timestamp,produced_energy\n2025-01-01,1')), /Spalten fehlen/)
})

test('Eigenverbrauch, Firmenanteil, Bemessungsgrundlage und USt', () => {
  // 10 kWh Erzeugung, 4 kWh Einspeisung → 6 kWh Eigenverbrauch je Tag; 2 kWh Netzbezug je Tag
  const days = makeDays('2025-01-01', '2025-12-31', () => ({ p: 10000, c: 8000, f: 4000, g: 2000 }))
  const s = normalizeSettings({
    prices: [{ from: '2025-01-01', workCt: 30, baseEurYear: 73 }], // 73 € / 730 kWh Netzbezug = 10 ct
    business: [{ from: '2000-01-01', mode: 'percent', value: 25 }],
    period: 'quarter'
  })
  const a = analyzeYear(2025, days, s, '2026-06-01')
  assert.equal(a.total.ev, 6000 * 365)
  assert.equal(a.total.priv, 4500 * 365)
  // 4,5 kWh × 40 ct × 365 = 657,00 €
  assert.equal(a.total.bmg, 657)
  assert.equal(a.total.vat, round(657 * 0.19))
  assert.equal(a.periods.length, 4)
  assert.ok(a.periods.every((p) => p.state === 'complete'))
  assert.equal(Math.round(a.total.priceCt * 100) / 100, 40)
})

test('Grundpreis: nicht einrechnen bzw. auf Gesamtverbrauch umlegen', () => {
  const days = makeDays('2025-01-01', '2025-12-31', () => ({ p: 10000, c: 8000, f: 4000, g: 2000 }))
  const base = { prices: [{ from: '2025-01-01', workCt: 30, baseEurYear: 73 }] }
  assert.equal(analyzeYear(2025, days, normalizeSettings({ ...base, baseShare: 'none' }), '2026-06-01').total.bmg, 657)
  // 73 € / (730 + 2190 kWh) = 2,5 ct → 6 kWh × 32,5 ct × 365
  assert.equal(analyzeYear(2025, days, normalizeSettings({ ...base, baseShare: 'total' }), '2026-06-01').total.bmg, 711.75)
})

test('Firmenanteil als feste kWh je Jahr', () => {
  const days = makeDays('2025-01-01', '2025-12-31', () => ({ p: 10000, f: 4000, g: 1000, c: 7000 }))
  const s = normalizeSettings({ prices: [{ from: '2025-01-01', workCt: 30 }], business: [{ from: '2000-01-01', mode: 'kwh', value: 365 }] })
  const a = analyzeYear(2025, days, s, '2026-06-01')
  assert.equal(Math.round(a.total.business), 365000)
})

test('Lücken innerhalb der Daten werden geschätzt, Ränder nicht', () => {
  const days = makeDays('2025-02-01', '2025-12-31', () => ({ p: 10000, c: 8000, f: 4000, g: 2000 }))
  for (let d = '2025-05-25'; d <= '2025-06-05'; d = addDays(d, 1)) delete days[d]
  const s = normalizeSettings({ prices: [{ from: '2025-01-01', workCt: 30 }] })
  const a = analyzeYear(2025, days, s, '2026-06-01')
  assert.equal(a.coverage.est, 12)
  assert.equal(a.months[4].estDays, 7)
  assert.equal(a.months[0].missingDays, 31) // Januar fehlt ganz → nicht geschätzt
  assert.equal(a.periods[0].state, 'incomplete')
  assert.ok(a.warnings.some((w) => w.code === 'estimated'))
  assert.ok(a.warnings.some((w) => w.code === 'missing'))
  const off = analyzeYear(2025, days, normalizeSettings({ ...s, estimateGaps: false }), '2026-06-01')
  assert.ok(off.warnings.some((w) => w.code === 'gap'))
})

test('Netzladung und Teiltage werden erkannt', () => {
  const days = makeDays('2025-01-01', '2025-01-31', () => ({ p: 3000, c: 15000, ch: 1000, dis: 800, g: 12000 }))
  days['2025-01-15'].ch = 10000
  days['2025-01-20'].c = 500
  const a = analyzeYear(2025, days, normalizeSettings({}), '2025-02-10')
  assert.ok(a.warnings.find((w) => w.code === 'gridcharge').dates.includes('2025-01-15'))
  assert.ok(a.warnings.find((w) => w.code === 'partial').dates.includes('2025-01-20'))
})

test('laufender Zeitraum und fehlender Preis', () => {
  const days = makeDays('2026-01-01', '2026-10-16', () => ({ p: 5000, c: 6000, f: 1000, g: 2000 }))
  const a = analyzeYear(2026, days, normalizeSettings({ period: 'quarter' }), '2026-10-17')
  assert.equal(a.periods[3].state, 'running')
  assert.equal(a.periods[0].state, 'incomplete') // kein Preis
  assert.ok(a.warnings.some((w) => w.code === 'noprice'))
})

test('Zählerabgleich', () => {
  const days = makeDays('2025-01-01', '2025-12-31', () => ({ g: 2000, f: 1000 }))
  const s = normalizeSettings({ meters: [{ date: '2025-01-01', purchase: 1000, feedin: 500 }, { date: '2025-01-11', purchase: 1021, feedin: 510 }] })
  const [c] = meterChecks(days, s)
  assert.equal(c.days, 10)
  assert.equal(c.sonnenPurchase, 20)
  assert.equal(Math.round(c.devPurchase * 1000) / 1000, -0.048)
  assert.equal(c.devFeedin, 0)
})

function round(n) { return Math.round(n * 100) / 100 }
