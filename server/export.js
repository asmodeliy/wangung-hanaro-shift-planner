import ExcelJS from 'exceljs'

const weekdayNames = ['일', '월', '화', '수', '목', '금', '토']
const shiftLabel = { open: '오', close: '마', full: '종', off: '휴' }
// Same palette as the on-screen grid so a printout looks like the app.
const fills = { open: 'FFD9F0E2', close: 'FFD8E8F5', full: 'FFF8E7B0' }
const inks = { open: 'FF0A6B3C', close: 'FF1D5D8A', full: 'FF6A4A00', off: 'FF8A9A90' }
const thin = { style: 'thin', color: { argb: 'FFC9D6CD' } }
const medium = { style: 'medium', color: { argb: 'FF7F9487' } }
const allBorders = { top: thin, left: thin, bottom: thin, right: thin }

function monthDays(month) {
  const [year, number] = month.split('-').map(Number)
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate()
  return Array.from({ length: count }, (_, index) => {
    const day = index + 1
    const date = `${month}-${String(day).padStart(2, '0')}`
    return { day, date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay() }
  })
}

/**
 * Build one workbook with one worksheet per month.
 * `months` is [{ month: 'YYYY-MM', employees: [{ id, name, employmentType, produceQualified, produceBackup }],
 * shifts: [{ employeeId, date, code }], holidays: [{ date, name }], restTarget }].
 * `timeRows` is [{ label, start, end }] and is printed under every sheet as a legend.
 */
export async function buildScheduleWorkbook({ months, timeRows = [], layout = 'table' }) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '왕궁농협 하나로마트 근무표'
  workbook.created = new Date()
  for (const data of months) (layout === 'calendar' ? addCalendarSheet : addMonthSheet)(workbook, data, timeRows)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function addMonthSheet(workbook, { month, employees, shifts, holidays = [], restTarget = null }, timeRows) {
  const [year, number] = month.split('-').map(Number)
  const days = monthDays(month)
  const holidaySet = new Map(holidays.map(item => [item.date, item.name]))
  const cellOf = new Map(shifts.map(shift => [`${shift.employeeId}:${shift.date}`, shift.code]))
  const firstDayColumn = 3
  const lastDayColumn = firstDayColumn + days.length - 1
  const totalColumns = ['휴무', '오픈', '마감']
  const lastColumn = lastDayColumn + totalColumns.length

  const sheet = workbook.addWorksheet(`${year}년 ${number}월`, {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: '&C왕궁농협 하나로마트 근무표 · &P / &N' },
  })
  sheet.getColumn(1).width = 12
  sheet.getColumn(2).width = 8
  for (let column = firstDayColumn; column <= lastDayColumn; column++) sheet.getColumn(column).width = 4.2
  for (let column = lastDayColumn + 1; column <= lastColumn; column++) sheet.getColumn(column).width = 6

  sheet.mergeCells(1, 1, 1, lastColumn)
  const title = sheet.getCell(1, 1)
  title.value = `왕궁농협 하나로마트 ${year}년 ${number}월 근무표`
  title.font = { name: 'Malgun Gothic', size: 18, bold: true, color: { argb: 'FF075B39' } }
  title.alignment = { vertical: 'middle', horizontal: 'left' }
  sheet.getRow(1).height = 32

  sheet.mergeCells(2, 1, 2, lastColumn)
  const subtitle = sheet.getCell(2, 1)
  subtitle.value = `오 오픈 · 마 마감 · 종 종일 · 휴 휴무${restTarget === null ? '' : `   |   직원별 기준 휴무 ${restTarget}일`}`
  subtitle.font = { name: 'Malgun Gothic', size: 10, color: { argb: 'FF6C7F74' } }
  sheet.getRow(2).height = 18

  // Header: rows 3 (day number) and 4 (weekday).
  const headerFont = { name: 'Malgun Gothic', size: 10, bold: true, color: { argb: 'FF22362E' } }
  for (const [column, label] of [[1, '직원'], [2, '구분']]) {
    sheet.mergeCells(3, column, 4, column)
    const cell = sheet.getCell(3, column)
    cell.value = label
    cell.font = headerFont
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F2' } }
    cell.border = allBorders
  }
  days.forEach((day, index) => {
    const column = firstDayColumn + index
    const weekend = day.weekday === 0 || holidaySet.has(day.date)
    const saturday = day.weekday === 6
    const color = weekend ? 'FFAD5044' : saturday ? 'FF276F9C' : 'FF22362E'
    const top = sheet.getCell(3, column)
    top.value = day.day
    const bottom = sheet.getCell(4, column)
    bottom.value = weekdayNames[day.weekday]
    for (const cell of [top, bottom]) {
      cell.font = { ...headerFont, color: { argb: color }, size: cell === top ? 10 : 9 }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: weekend ? 'FFFBECE8' : saturday ? 'FFE8F1F7' : 'FFF1F5F2' } }
      cell.border = { ...allBorders, left: day.weekday === 1 ? medium : thin }
    }
    if (holidaySet.has(day.date)) top.note = holidaySet.get(day.date)
  })
  totalColumns.forEach((label, index) => {
    const column = lastDayColumn + 1 + index
    sheet.mergeCells(3, column, 4, column)
    const cell = sheet.getCell(3, column)
    cell.value = label
    cell.font = headerFont
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F3EC' } }
    cell.border = allBorders
  })

  // Body.
  const withShifts = new Set(shifts.map(shift => shift.employeeId))
  const rows = employees.filter(employee => employee.active !== false || withShifts.has(employee.id))
  rows.forEach((employee, rowIndex) => {
    const rowNumber = 5 + rowIndex
    const row = sheet.getRow(rowNumber)
    row.height = 24
    const name = row.getCell(1)
    name.value = employee.name + (employee.produceQualified ? ' (농산)' : employee.produceBackup ? ' (농산 대직)' : '')
    name.font = { name: 'Malgun Gothic', size: 11, bold: true }
    name.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    name.border = allBorders
    const kind = row.getCell(2)
    kind.value = employee.employmentType === '계약직' ? '계약직' : '일반직'
    kind.font = { name: 'Malgun Gothic', size: 9, color: { argb: 'FF6C7F74' } }
    kind.alignment = { vertical: 'middle', horizontal: 'center' }
    kind.border = allBorders
    const counts = { off: 0, open: 0, close: 0 }
    days.forEach((day, index) => {
      const cell = row.getCell(firstDayColumn + index)
      const code = cellOf.get(`${employee.id}:${day.date}`)
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      cell.border = { ...allBorders, left: day.weekday === 1 ? medium : thin }
      const offDay = day.weekday === 0 || day.weekday === 6 || holidaySet.has(day.date)
      if (code) {
        cell.value = shiftLabel[code]
        cell.font = { name: 'Malgun Gothic', size: 10, bold: code !== 'off', color: { argb: inks[code] } }
        if (fills[code]) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fills[code] } }
        else if (offDay) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F8F6' } }
        if (code === 'off') counts.off++
        if (code === 'open' || code === 'full') counts.open++
        if (code === 'close' || code === 'full') counts.close++
      } else if (offDay) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F8F6' } }
    })
    for (const [index, key] of ['off', 'open', 'close'].entries()) {
      const cell = row.getCell(lastDayColumn + 1 + index)
      cell.value = counts[key]
      cell.font = { name: 'Malgun Gothic', size: 10, bold: key === 'off' }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      cell.border = allBorders
      if (key === 'off' && restTarget !== null && counts.off !== restTarget) cell.font = { ...cell.font, color: { argb: 'FFAD5044' } }
    }
  })

  // Daily headcount.
  const countRow = sheet.getRow(5 + rows.length)
  countRow.height = 20
  sheet.mergeCells(5 + rows.length, 1, 5 + rows.length, 2)
  const countLabel = countRow.getCell(1)
  countLabel.value = '출근 인원'
  countLabel.font = { name: 'Malgun Gothic', size: 10, bold: true }
  countLabel.alignment = { vertical: 'middle', horizontal: 'center' }
  countLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F3EC' } }
  countLabel.border = allBorders
  days.forEach((day, index) => {
    const cell = countRow.getCell(firstDayColumn + index)
    const working = rows.filter(employee => ['open', 'close', 'full'].includes(cellOf.get(`${employee.id}:${day.date}`))).length
    cell.value = working
    cell.font = { name: 'Malgun Gothic', size: 10, bold: true }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F3EC' } }
    cell.border = { ...allBorders, left: day.weekday === 1 ? medium : thin }
  })

  // Legend with working hours.
  let legendRow = 7 + rows.length
  if (timeRows.length) {
    sheet.mergeCells(legendRow, 1, legendRow, lastColumn)
    const heading = sheet.getCell(legendRow, 1)
    heading.value = '근무시간'
    heading.font = { name: 'Malgun Gothic', size: 10, bold: true, color: { argb: 'FF075B39' } }
    legendRow++
    for (const item of timeRows) {
      sheet.mergeCells(legendRow, 1, legendRow, lastColumn)
      const cell = sheet.getCell(legendRow, 1)
      cell.value = `${item.label}  ${item.start} – ${item.end}`
      cell.font = { name: 'Malgun Gothic', size: 9, color: { argb: 'FF44554B' } }
      legendRow++
    }
  }
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(lastColumn).letter}${Math.max(legendRow - 1, 5 + rows.length)}`
}


const calendarNames = { open: '오픈', close: '마감', full: '종일', off: '휴무' }

/** Calendar layout: seven columns, one row per week, each day lists who opens, closes, works all day and rests. */
function addCalendarSheet(workbook, { month, employees, shifts, holidays = [], restTarget = null }, timeRows) {
  const [year, number] = month.split('-').map(Number)
  const days = monthDays(month)
  const holidaySet = new Map(holidays.map(item => [item.date, item.name]))
  const nameOf = new Map(employees.map(employee => [employee.id, employee.name]))
  const order = new Map(employees.map((employee, index) => [employee.id, index]))
  const byDate = new Map()
  for (const shift of shifts) {
    if (!nameOf.has(shift.employeeId)) continue
    const entry = byDate.get(shift.date) ?? { open: [], close: [], full: [], off: [] }
    entry[shift.code]?.push(shift.employeeId)
    byDate.set(shift.date, entry)
  }
  const sheet = workbook.addWorksheet(`${year}년 ${number}월 달력`, {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  })
  for (let column = 1; column <= 7; column++) sheet.getColumn(column).width = 22
  sheet.mergeCells(1, 1, 1, 7)
  const title = sheet.getCell(1, 1)
  title.value = `왕궁농협 하나로마트 ${year}년 ${number}월 근무표`
  title.font = { name: 'Malgun Gothic', size: 18, bold: true, color: { argb: 'FF075B39' } }
  title.alignment = { vertical: 'middle' }
  sheet.getRow(1).height = 32
  sheet.mergeCells(2, 1, 2, 7)
  const subtitle = sheet.getCell(2, 1)
  subtitle.value = restTarget === null ? '' : `직원별 기준 휴무 ${restTarget}일`
  subtitle.font = { name: 'Malgun Gothic', size: 10, color: { argb: 'FF6C7F74' } }

  weekdayNames.forEach((label, index) => {
    const cell = sheet.getCell(3, index + 1)
    cell.value = label
    cell.font = { name: 'Malgun Gothic', size: 11, bold: true, color: { argb: index === 0 ? 'FFAD5044' : index === 6 ? 'FF276F9C' : 'FF22362E' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index === 0 ? 'FFFBECE8' : index === 6 ? 'FFE8F1F7' : 'FFF1F5F2' } }
    cell.border = allBorders
  })
  const weekCount = Math.ceil((days[0].weekday + days.length) / 7)
  for (let week = 0; week < weekCount; week++) sheet.getRow(4 + week).height = 96
  for (let column = 1; column <= 7; column++) for (let week = 0; week < weekCount; week++) {
    const cell = sheet.getCell(4 + week, column)
    cell.border = allBorders
    cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true }
  }
  days.forEach((day, index) => {
    const slot = days[0].weekday + index
    const cell = sheet.getCell(4 + Math.floor(slot / 7), (slot % 7) + 1)
    const off = day.weekday === 0 || holidaySet.has(day.date)
    const tone = off ? 'FFAD5044' : day.weekday === 6 ? 'FF276F9C' : 'FF22362E'
    const entry = byDate.get(day.date)
    const richText = [{ text: `${day.day}`, font: { name: 'Malgun Gothic', size: 12, bold: true, color: { argb: tone } } }]
    if (holidaySet.has(day.date)) richText.push({ text: `  ${holidaySet.get(day.date)}`, font: { name: 'Malgun Gothic', size: 8, color: { argb: 'FFAD5044' } } })
    if (entry) for (const code of ['open', 'close', 'full', 'off']) {
      const ids = [...entry[code]].sort((a, b) => order.get(a) - order.get(b))
      if (!ids.length) continue
      richText.push({ text: `\n${calendarNames[code]}  `, font: { name: 'Malgun Gothic', size: 9, bold: true, color: { argb: inks[code] } } })
      richText.push({ text: ids.map(id => nameOf.get(id)).join(' '), font: { name: 'Malgun Gothic', size: 9, color: { argb: code === 'off' ? 'FF6C7F74' : 'FF22362E' } } })
    }
    cell.value = { richText }
    if (day.weekday === 0 || day.weekday === 6 || holidaySet.has(day.date)) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFBFA' } }
  })
  let row = 5 + weekCount
  for (const item of timeRows) {
    sheet.mergeCells(row, 1, row, 7)
    const cell = sheet.getCell(row, 1)
    cell.value = `${item.label}  ${item.start} – ${item.end}`
    cell.font = { name: 'Malgun Gothic', size: 9, color: { argb: 'FF44554B' } }
    row++
  }
}
