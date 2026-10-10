import PDFDocument from 'pdfkit'
import { fileURLToPath } from 'node:url'

const fontPath = fileURLToPath(new URL('./fonts/NotoSansKR-Regular.ttf', import.meta.url))
const weekdayNames = ['일', '월', '화', '수', '목', '금', '토']
const shiftLabel = { open: '오', close: '마', full: '종', off: '휴' }
const shiftName = { open: '오픈', close: '마감', full: '종일', off: '휴무' }
const fills = { open: '#d9f0e2', close: '#d8e8f5', full: '#f8e7b0' }
const inks = { open: '#0a6b3c', close: '#1d5d8a', full: '#6a4a00', off: '#8a9a90' }
const palette = { ink: '#22362e', muted: '#6c7f74', line: '#9fb1a5', soft: '#f1f5f2', sun: '#ad5044', sunBg: '#fbece8', sat: '#276f9c', satBg: '#e8f1f7', green: '#075b39', greenSoft: '#e6f3ec' }
// A4 landscape expressed directly in points. The page is created landscape, never rotated, so the content is always upright.
const PAGE = { width: 841.89, height: 595.28, margin: 28 }

function monthDays(month) {
  const [year, number] = month.split('-').map(Number)
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate()
  return Array.from({ length: count }, (_, index) => {
    const day = index + 1
    const date = `${month}-${String(day).padStart(2, '0')}`
    return { day, date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay() }
  })
}

function drawText(doc, value, x, y, width, { size = 8, color = palette.ink, bold = false, align = 'center', height = null } = {}) {
  doc.font('kr').fontSize(size).fillColor(color)
  const top = height === null ? y : y + (height - size * 1.15) / 2
  if (bold) doc.strokeColor(color).lineWidth(size * 0.035)
  doc.text(String(value), x, top, { width, align, lineBreak: false, fill: true, stroke: bold })
}

function cell(doc, x, y, width, height, { fill = null, border = palette.line } = {}) {
  doc.lineWidth(0.4)
  if (fill) doc.rect(x, y, width, height).fillAndStroke(fill, border)
  else doc.rect(x, y, width, height).stroke(border)
}

function drawHeading(doc, month, subtitle) {
  const [year, number] = month.split('-').map(Number)
  drawText(doc, `왕궁농협 하나로마트 ${year}년 ${number}월 근무표`, PAGE.margin, PAGE.margin - 2, 520, { size: 17, color: palette.green, bold: true, align: 'left' })
  drawText(doc, subtitle, PAGE.width - PAGE.margin - 300, PAGE.margin + 4, 300, { size: 8.5, color: palette.muted, align: 'right' })
}

function drawLegend(doc, timeRows, y) {
  if (!timeRows.length) return
  const text = timeRows.map(item => `${item.label} ${item.start}–${item.end}`).join('   ·   ')
  drawText(doc, `근무시간   ${text}`, PAGE.margin, y, PAGE.width - PAGE.margin * 2, { size: 7.5, color: palette.muted, align: 'left' })
}

function tonesFor(day, holidays) {
  const off = day.weekday === 0 || holidays.has(day.date)
  return { color: off ? palette.sun : day.weekday === 6 ? palette.sat : palette.ink, bg: off ? palette.sunBg : day.weekday === 6 ? palette.satBg : palette.soft, weekend: off || day.weekday === 6 }
}

function drawTablePage(doc, data, timeRows) {
  const { month, employees, shifts, holidays = [], restTarget = null } = data
  const days = monthDays(month)
  const holidaySet = new Map(holidays.map(item => [item.date, item.name]))
  const cells = new Map(shifts.map(shift => [`${shift.employeeId}:${shift.date}`, shift.code]))
  const withShifts = new Set(shifts.map(shift => shift.employeeId))
  const rows = employees.filter(employee => employee.active !== false || withShifts.has(employee.id))
  drawHeading(doc, month, `오 오픈 · 마 마감 · 종 종일 · 휴 휴무${restTarget === null ? '' : `   |   직원별 기준 휴무 ${restTarget}일`}`)

  const left = PAGE.margin
  const top = PAGE.margin + 28
  const nameW = 66, kindW = 38, totalW = 25
  const dayW = (PAGE.width - PAGE.margin * 2 - nameW - kindW - totalW * 3) / days.length
  const headH = 15
  const available = PAGE.height - PAGE.margin - top - 30 - headH * 2
  const rowH = Math.max(14, Math.min(38, available / (rows.length + 1)))

  // Header
  cell(doc, left, top, nameW, headH * 2, { fill: palette.soft }); drawText(doc, '직원', left, top, nameW, { size: 9, bold: true, height: headH * 2 })
  cell(doc, left + nameW, top, kindW, headH * 2, { fill: palette.soft }); drawText(doc, '구분', left + nameW, top, kindW, { size: 8, height: headH * 2 })
  days.forEach((day, index) => {
    const x = left + nameW + kindW + index * dayW
    const tone = tonesFor(day, holidaySet)
    cell(doc, x, top, dayW, headH, { fill: tone.bg }); drawText(doc, day.day, x, top, dayW, { size: 8, color: tone.color, bold: true, height: headH })
    cell(doc, x, top + headH, dayW, headH, { fill: tone.bg }); drawText(doc, weekdayNames[day.weekday], x, top + headH, dayW, { size: 7, color: tone.color, height: headH })
  })
  const totalsX = left + nameW + kindW + days.length * dayW
  ;['휴무', '오픈', '마감'].forEach((label, index) => {
    cell(doc, totalsX + index * totalW, top, totalW, headH * 2, { fill: palette.greenSoft })
    drawText(doc, label, totalsX + index * totalW, top, totalW, { size: 8, bold: true, height: headH * 2 })
  })

  // Body
  rows.forEach((employee, rowIndex) => {
    const y = top + headH * 2 + rowIndex * rowH
    cell(doc, left, y, nameW, rowH)
    drawText(doc, employee.name, left + 5, y, nameW - 6, { size: 9, bold: true, align: 'left', height: rowH })
    cell(doc, left + nameW, y, kindW, rowH)
    drawText(doc, employee.employmentType === '계약직' ? '계약직' : '일반직', left + nameW, y, kindW, { size: 7, color: palette.muted, height: rowH })
    const counts = { off: 0, open: 0, close: 0 }
    days.forEach((day, index) => {
      const x = left + nameW + kindW + index * dayW
      const code = cells.get(`${employee.id}:${day.date}`)
      const tone = tonesFor(day, holidaySet)
      cell(doc, x, y, dayW, rowH, { fill: code && fills[code] ? fills[code] : tone.weekend ? '#f6f8f6' : null })
      if (day.weekday === 1) doc.lineWidth(1.1).moveTo(x, y).lineTo(x, y + rowH).stroke('#5f7367')
      if (code) drawText(doc, shiftLabel[code], x, y, dayW, { size: 8.5, color: inks[code], bold: code !== 'off', height: rowH })
      if (code === 'off') counts.off++
      if (code === 'open' || code === 'full') counts.open++
      if (code === 'close' || code === 'full') counts.close++
    })
    ;['off', 'open', 'close'].forEach((key, index) => {
      const x = totalsX + index * totalW
      cell(doc, x, y, totalW, rowH)
      const warn = key === 'off' && restTarget !== null && counts.off !== restTarget
      drawText(doc, counts[key], x, y, totalW, { size: 8.5, color: warn ? palette.sun : palette.ink, bold: key === 'off', height: rowH })
    })
  })

  // Daily headcount
  const countY = top + headH * 2 + rows.length * rowH
  cell(doc, left, countY, nameW + kindW, rowH, { fill: palette.greenSoft })
  drawText(doc, '출근 인원', left, countY, nameW + kindW, { size: 8.5, bold: true, height: rowH })
  days.forEach((day, index) => {
    const x = left + nameW + kindW + index * dayW
    const working = rows.filter(employee => ['open', 'close', 'full'].includes(cells.get(`${employee.id}:${day.date}`))).length
    cell(doc, x, countY, dayW, rowH, { fill: palette.greenSoft })
    drawText(doc, working, x, countY, dayW, { size: 8.5, bold: true, height: rowH })
  })
  drawLegend(doc, timeRows, countY + rowH + 10)
}

function drawCalendarPage(doc, data, timeRows) {
  const { month, employees, shifts, holidays = [], restTarget = null } = data
  const days = monthDays(month)
  const holidaySet = new Map(holidays.map(item => [item.date, item.name]))
  const byDate = new Map()
  const order = new Map(employees.map((employee, index) => [employee.id, index]))
  const nameOf = new Map(employees.map(employee => [employee.id, employee.name]))
  for (const shift of shifts) {
    if (!nameOf.has(shift.employeeId)) continue
    const entry = byDate.get(shift.date) ?? { open: [], close: [], full: [], off: [] }
    entry[shift.code]?.push(shift.employeeId)
    byDate.set(shift.date, entry)
  }
  drawHeading(doc, month, `직원별 기준 휴무 ${restTarget ?? '-'}일 · 오픈 / 마감 / 종일 / 휴무`)

  const left = PAGE.margin
  const top = PAGE.margin + 30
  const weekCount = Math.ceil((days[0].weekday + days.length) / 7)
  const headH = 16
  const bodyH = PAGE.height - PAGE.margin - top - headH - 20
  const cellW = (PAGE.width - PAGE.margin * 2) / 7
  const cellH = bodyH / weekCount
  weekdayNames.forEach((label, index) => {
    const x = left + index * cellW
    const tone = index === 0 ? { color: palette.sun, bg: palette.sunBg } : index === 6 ? { color: palette.sat, bg: palette.satBg } : { color: palette.ink, bg: palette.soft }
    cell(doc, x, top, cellW, headH, { fill: tone.bg })
    drawText(doc, label, x, top, cellW, { size: 9, color: tone.color, bold: true, height: headH })
  })
  days.forEach((day, index) => {
    const slot = days[0].weekday + index
    const x = left + (slot % 7) * cellW
    const y = top + headH + Math.floor(slot / 7) * cellH
    const tone = tonesFor(day, holidaySet)
    cell(doc, x, y, cellW, cellH, { fill: tone.weekend ? '#fbfcfb' : null })
    drawText(doc, day.day, x + 4, y + 3, 24, { size: 10, color: tone.color, bold: true, align: 'left' })
    if (holidaySet.has(day.date)) drawText(doc, holidaySet.get(day.date), x + 22, y + 5, cellW - 26, { size: 6.5, color: palette.sun, align: 'right' })
    const entry = byDate.get(day.date)
    if (!entry) return
    let cursor = y + 17
    for (const code of ['open', 'close', 'full', 'off']) {
      const ids = [...entry[code]].sort((a, b) => order.get(a) - order.get(b))
      if (!ids.length) continue
      const names = ids.map(id => nameOf.get(id)).join(' ')
      const width = cellW - 34
      doc.font('kr').fontSize(7.2)
      const height = Math.max(10, doc.heightOfString(names, { width }))
      if (cursor + height > y + cellH - 2) break
      doc.roundedRect(x + 4, cursor + 0.5, 22, 9, 2).fill(fills[code] ?? '#eef1ee')
      drawText(doc, shiftName[code], x + 4, cursor + 1.2, 22, { size: 6.3, color: inks[code], bold: true })
      doc.font('kr').fontSize(7.2).fillColor(code === 'off' ? palette.muted : palette.ink).text(names, x + 29, cursor + 1, { width, lineGap: 0.5 })
      cursor += height + 3
    }
  })
  drawLegend(doc, timeRows, PAGE.height - PAGE.margin - 8)
}

/**
 * Landscape A4 PDF, one page per month. `layout` is 'table' (employee x day grid) or 'calendar'.
 * Pages are created with landscape dimensions directly, so table and calendar are always upright.
 */
export function buildSchedulePdf({ months, layout = 'table', timeRows = [] }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: false, info: { Title: '왕궁농협 하나로마트 근무표', Author: '왕궁농협 하나로마트' } })
    const chunks = []
    doc.on('data', chunk => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    try {
      doc.registerFont('kr', fontPath)
      for (const data of months) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 })
        if (layout === 'calendar') drawCalendarPage(doc, data, timeRows)
        else drawTablePage(doc, data, timeRows)
      }
      doc.end()
    } catch (error) { reject(error) }
  })
}
