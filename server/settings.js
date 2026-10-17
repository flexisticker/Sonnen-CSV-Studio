// Einstellungen mit Startwerten. Listen mit „ab“-Datum (from) gelten jeweils bis zum nächsten Eintrag.

export function defaultSettings() {
  return {
    owner: { name: 'Flexisticker', address: '', taxNo: '' },
    plant: {
      name: 'PV-Anlage mit sonnenBatterie',
      kwp: '',
      commissioned: '',
      inputVat: true, // beim Kauf Vorsteuer gezogen
      taxSelfUse: true // privater Eigenverbrauch = unentgeltliche Wertabgabe (§ 3 Abs. 1b UStG)
    },
    taxRate: 19,
    period: 'quarter', // month | quarter | year
    method: 'feedin', // feedin = Erzeugung − Einspeisung; battery = zusätzlich ohne Batterieverluste
    estimateGaps: true,
    // { from, workCt (netto ct/kWh), baseEurYear (netto €/Jahr), supplier, note } – Startwert aus der EnBW-Rechnung 02/2024–01/2025
    prices: [{ from: '2024-01-01', supplier: 'EnBW Grün und Sicher Privatstrom', workCt: 28.76, baseEurYear: 122.52, note: 'Rechnung 02/2024 – 01/2025' }],
    baseShare: 'grid', // Grundpreis umlegen auf: grid = Netzbezug, total = Netzbezug + Eigenverbrauch, none = nicht einrechnen
    business: [{ from: '2000-01-01', mode: 'percent', value: 0, note: '' }], // Firmenanteil am Eigenverbrauch
    feedin: [], // { from, ct } Einspeisevergütung netto ct/kWh
    feedinVat: true, // Netze BW zahlt USt auf die Vergütung (Regelbesteuerung)
    meters: [], // { date, purchase, feedin, note } Zählerstände Netze BW (kWh)
    notes: '' // Hinweise für den Steuerberater
  }
}

const num = (v, d = 0) => {
  if (v === '' || v === null || v === undefined) return d
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : d
}
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '')
const text = (v, max = 300) => String(v ?? '').slice(0, max)
const byFrom = (a, b) => String(a.from).localeCompare(String(b.from))

export function normalizeSettings(s = {}) {
  const d = defaultSettings()
  const plant = { ...d.plant, ...(s.plant || {}) }
  const out = {
    owner: {
      name: text(s.owner?.name, 120),
      address: text(s.owner?.address, 300),
      taxNo: text(s.owner?.taxNo, 40)
    },
    plant: {
      name: text(plant.name, 120),
      kwp: plant.kwp === '' ? '' : num(plant.kwp, ''),
      commissioned: date(plant.commissioned),
      inputVat: !!plant.inputVat,
      taxSelfUse: !!plant.taxSelfUse
    },
    taxRate: num(s.taxRate, d.taxRate),
    period: ['month', 'quarter', 'year'].includes(s.period) ? s.period : d.period,
    method: ['feedin', 'battery'].includes(s.method) ? s.method : d.method,
    estimateGaps: s.estimateGaps === undefined ? d.estimateGaps : !!s.estimateGaps,
    prices: (Array.isArray(s.prices) ? s.prices : [])
      .map((p) => ({
        from: date(p.from),
        workCt: num(p.workCt),
        // ältere Einträge mit €/Monat übernehmen
        baseEurYear: p.baseEurYear !== undefined ? num(p.baseEurYear) : num(p.baseEurMonth) * 12,
        supplier: text(p.supplier, 80),
        note: text(p.note)
      }))
      .filter((p) => p.from)
      .sort(byFrom),
    business: (Array.isArray(s.business) ? s.business : d.business)
      .map((b) => ({
        from: date(b.from),
        mode: b.mode === 'kwh' ? 'kwh' : 'percent',
        value: Math.max(0, b.mode === 'kwh' ? num(b.value) : Math.min(100, num(b.value))),
        note: text(b.note)
      }))
      .filter((b) => b.from)
      .sort(byFrom),
    baseShare: ['grid', 'total', 'none'].includes(s.baseShare) ? s.baseShare : d.baseShare,
    feedin: (Array.isArray(s.feedin) ? s.feedin : [])
      .map((f) => ({ from: date(f.from), ct: num(f.ct) }))
      .filter((f) => f.from)
      .sort(byFrom),
    feedinVat: s.feedinVat === undefined ? d.feedinVat : !!s.feedinVat,
    meters: (Array.isArray(s.meters) ? s.meters : [])
      .map((m) => ({
        date: date(m.date),
        purchase: m.purchase === '' || m.purchase == null ? null : num(m.purchase, null),
        feedin: m.feedin === '' || m.feedin == null ? null : num(m.feedin, null),
        note: text(m.note)
      }))
      .filter((m) => m.date)
      .sort((a, b) => a.date.localeCompare(b.date)),
    notes: text(s.notes, 4000),
    updatedAt: s.updatedAt || null
  }
  return out
}

// Eintrag, der an einem Datum gilt (letzter mit from ≤ Datum)
export function validAt(list, day) {
  let hit = null
  for (const e of list) if (e.from <= day) hit = e
  return hit
}
