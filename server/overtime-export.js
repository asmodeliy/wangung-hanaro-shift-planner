import ExcelJS from 'exceljs'

const columns = [
  { header: '일자', key: 'date', width: 13 },
  { header: '업무 내용', key: 'work', width: 24 },
  { header: '예상 종료 시간', key: 'expectedEnd', width: 11 },
  { header: '예상 근무 시간', key: 'estimated', width: 11 },
  { header: '본인', key: 'self', width: 8 },
  { header: '계원', key: 'clerk', width: 8 },
  { header: '책임자', key: 'manager', width: 8 },
  { header: '사무소장', key: 'director', width: 9 },
  { header: '시간수', key: 'confirmedHours', width: 9 },
  { header: '책임자', key: 'confirmer', width: 9 },
  { header: '비고', key: 'notes', width: 15 },
]

const border = { style: 'thin', color: { argb: 'FF333333' } }
const invalidSheetCharacters = new Set(['\\', '/', '*', '?', ':', '[', ']'])

function uniqueSheetName(name, used) {
  const base = name.split('').map(character => invalidSheetCharacters.has(character) ? ' ' : character).join('').trim().slice(0, 31) || '직원'
  let candidate = base
  let index = 2
  while (used.has(candidate)) {
    const suffix = ` (${index++})`
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`
  }
  used.add(candidate)
  return candidate
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return hours ? `${hours}시간 ${String(remainder).padStart(2, '0')}분` : `${remainder}분`
}

export async function createOvertimeWorkbook({ from, to, overtime }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('기간 형식이 올바르지 않습니다.')
  if (!Array.isArray(overtime) || overtime.length < 1 || overtime.length > 500) throw new Error('시간외 근무 기록을 찾지 못했습니다.')

  const workbook = new ExcelJS.Workbook()
  workbook.creator = '왕궁농협 하나로마트 근태 모니터링'
  workbook.subject = '근태 비교 결과 시간외 근무 기록부'
  workbook.created = new Date()
  const byEmployee = new Map()
  for (const record of overtime) {
    if (!record || !Number.isInteger(record.employeeId) || !record.employeeName || record.employeeName.length > 80
      || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !Number.isInteger(record.minutes) || record.minutes < 1 || record.minutes > 1440
      || (record.expectedEnd !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(record.expectedEnd))) throw new Error('시간외 근무 기록에 잘못된 값이 있습니다.')
    if (!byEmployee.has(record.employeeId)) byEmployee.set(record.employeeId, { name: record.employeeName, records: [] })
    const employee = byEmployee.get(record.employeeId)
    if (employee.name !== record.employeeName) throw new Error('직원 번호에 서로 다른 이름이 지정되어 있습니다.')
    employee.records.push(record)
  }

  const usedNames = new Set()
  for (const employee of [...byEmployee.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'))) {
    const sheet = workbook.addWorksheet(uniqueSheetName(employee.name, usedNames), {
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.2, right: 0.2, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 } },
      properties: { defaultRowHeight: 22 },
      views: [{ state: 'frozen', ySplit: 6 }],
    })
    sheet.columns = columns.map(({ key, width }) => ({ key, width }))
    sheet.mergeCells('A1:K1')
    sheet.getCell('A1').value = '시간외 근무 기록부'
    sheet.getCell('A1').font = { name: '맑은 고딕', size: 16, bold: true }
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getRow(1).height = 32

    sheet.mergeCells('G2:H2')
    sheet.mergeCells('I2:K2')
    sheet.getCell('G2').value = '직 명'
    sheet.mergeCells('G3:H3')
    sheet.mergeCells('I3:K3')
    sheet.getCell('G3').value = '성 명'
    sheet.getCell('I3').value = employee.name
    for (const address of ['G2', 'I2', 'G3', 'I3']) {
      const cell = sheet.getCell(address)
      cell.border = { top: border, left: border, bottom: border, right: border }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.font = { name: '맑은 고딕', size: 10, bold: address[0] === 'G' }
    }
    sheet.getRow(2).height = 22
    sheet.getRow(3).height = 22

    for (const [address, value] of [['A5', '일자'], ['B5', '업무 내용'], ['C5', '예상\n종료 시간'], ['D5', '예상\n근무 시간'], ['E5', '사전결재'], ['I5', '사후확인'], ['K5', '비고']]) sheet.getCell(address).value = value
    sheet.mergeCells('A5:A6')
    sheet.mergeCells('B5:B6')
    sheet.mergeCells('C5:C6')
    sheet.mergeCells('D5:D6')
    sheet.mergeCells('E5:H5')
    sheet.mergeCells('I5:J5')
    sheet.mergeCells('K5:K6')
    for (const [column, value] of ['본인', '계원', '책임자', '사무소장', '시간수', '책임자'].entries()) sheet.getCell(6, column + 5).value = value
    for (let rowNumber = 5; rowNumber <= 6; rowNumber++) {
      const row = sheet.getRow(rowNumber)
      row.height = rowNumber === 5 ? 26 : 28
      row.eachCell({ includeEmpty: true }, cell => {
        cell.font = { name: '맑은 고딕', size: 9, bold: true }
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E7E7' } }
        cell.border = { top: border, left: border, bottom: border, right: border }
      })
    }

    employee.records.sort((a, b) => a.date.localeCompare(b.date))
    for (const record of employee.records) {
      const row = sheet.addRow([record.date, '', record.expectedEnd ?? '', formatDuration(record.minutes), '', '', '', '', formatDuration(record.minutes), '', ''])
      row.height = 24
      row.eachCell({ includeEmpty: true }, cell => {
        cell.font = { name: '맑은 고딕', size: 9 }
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
        cell.border = { top: border, left: border, bottom: border, right: border }
      })
      row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
    }
    sheet.autoFilter = { from: 'A5', to: `K${5 + employee.records.length}` }
    sheet.pageSetup.printArea = `A1:K${6 + employee.records.length}`
    sheet.pageSetup.horizontalCentered = true
  }
  return workbook
}
