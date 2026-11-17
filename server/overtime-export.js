import ExcelJS from 'exceljs'

const edge = { style: 'thin', color: { argb: 'FF333333' } }
const border = { top: edge, bottom: edge, left: edge, right: edge }
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/

export function groupOvertime({ from, to, overtime, employeeId }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('기간 형식이 올바르지 않습니다.')
  if (employeeId !== undefined && !Number.isInteger(employeeId)) throw new Error('직원 선택 값이 올바르지 않습니다.')
  if (!Array.isArray(overtime) || !overtime.length || overtime.length > 500) throw new Error('시간외 근무 기록을 찾지 못했습니다.')
  const records = employeeId === undefined ? overtime : overtime.filter(r => r.employeeId === employeeId)
  if (!records.length) throw new Error('선택한 직원의 시간외 근무 기록을 찾지 못했습니다.')
  const groups = new Map()
  for (const r of records) {
    if (!r || !Number.isInteger(r.employeeId) || typeof r.employeeName !== 'string' || !r.employeeName || r.employeeName.length > 80 || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !Number.isInteger(r.minutes) || r.minutes < 1 || r.minutes > 1440 || (r.expectedEnd != null && !timePattern.test(r.expectedEnd)) || (r.actualEnd != null && !timePattern.test(r.actualEnd))) throw new Error('시간외 근무 기록에 잘못된 값이 있습니다.')
    const key = `${r.employeeId}:${r.date.slice(0, 7)}`
    if (!groups.has(key)) groups.set(key, { id: r.employeeId, name: r.employeeName, month: r.date.slice(0, 7), records: [] })
    const group = groups.get(key)
    if (group.name !== r.employeeName) throw new Error('직원 번호에 서로 다른 이름이 지정되어 있습니다.')
    group.records.push(r)
  }
  return [...groups.values()].sort((a,b) => a.name.localeCompare(b.name, 'ko') || a.month.localeCompare(b.month))
}

export async function createOvertimeWorkbook(input) {
  const groups = groupOvertime(input)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '왕궁농협 하나로마트'
  const used = new Set()
  for (const group of groups) {
    const base = `${group.name} ${group.month}`.replace(/[\\/*?:\[\]]/g, ' ').slice(0, 31)
    let name = base, n = 2
    while (used.has(name)) { const suffix = ` (${n++})`; name = base.slice(0, 31 - suffix.length) + suffix }
    used.add(name)
    const sheet = workbook.addWorksheet(name, { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .2, right: .2, top: .35, bottom: .35, header: .15, footer: .15 } } })
    sheet.columns = [8, 18, 10, 7, 7, 7, 7, 7, 10, 9, 7, 7, 7, 7, 7, 12].map(width => ({ width }))
    sheet.mergeCells('A1:P1'); sheet.getCell('A1').value = '시간외(휴일)근무 명령부'
    sheet.getCell('A1').font = { name: '한양견고딕', size: 16, bold: true }; sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }; sheet.getRow(1).height = 32
    sheet.mergeCells('A3:D3'); sheet.getCell('A3').value = `( ${Number(group.month.slice(5))} )월`
    sheet.mergeCells('J3:L3'); sheet.getCell('J3').value = '직'
    sheet.mergeCells('M3:P3'); sheet.getCell('M3').value = `성명    ${group.name}`
    for (const [range, value] of [['A5:A6','일자'],['B5:B6','업무내용'],['C5:C6','예상근무\n시간'],['D5:H5','사 전 결 재'],['I5:I6','실제근무\n시간'],['J5:J6','시간수'],['K5:O5','사 후 확 인'],['P5:P6','비고']]) { sheet.mergeCells(range); sheet.getCell(range.split(':')[0]).value = value }
    for (const start of [4,11]) ['본 인','과장','상 무','상임\n이사','사무\n소장'].forEach((v,i) => { sheet.getCell(6,start+i).value = v })
    for (let row = 5; row <= 6; row++) { sheet.getRow(row).height = 25; for (let col = 1; col <= 16; col++) { const c = sheet.getCell(row,col); c.border = border; c.font = { name: '바탕', size: 9, bold: true }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true } } }
    group.records.sort((a,b) => a.date.localeCompare(b.date))
    const count = Math.max(11, group.records.length)
    for (let i = 0; i < count; i++) {
      const row = sheet.getRow(7+i), r = group.records[i]; row.height = 24
      if (r) { row.getCell(1).value = Number(r.date.slice(8)); row.getCell(3).value = r.expectedEnd ?? ''; row.getCell(9).value = r.actualEnd ?? ''; row.getCell(10).value = r.minutes / 60; row.getCell(10).numFmt = '0.00' }
      for (let col = 1; col <= 16; col++) { const c = row.getCell(col); c.border = border; c.font = { name: '바탕', size: 9 }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true } }
    }
    const total = 7 + count
    sheet.mergeCells(`A${total}:H${total}`); sheet.mergeCells(`I${total}:P${total}`)
    sheet.getCell(`A${total}`).value = '총 시간 수'
    sheet.getCell(`I${total}`).value = { formula: `SUM(J7:J${total-1})`, result: group.records.reduce((sum,r) => sum + r.minutes, 0)/60 }
    sheet.getCell(`I${total}`).numFmt = '0.00"시간"'
    for (let col = 1; col <= 16; col++) { const c=sheet.getCell(total,col); c.border=border; c.alignment={horizontal:'center',vertical:'middle'} }
    sheet.getRow(total).height = 24
    sheet.pageSetup.printArea = `A1:P${total}`; sheet.pageSetup.horizontalCentered = true
  }
  return workbook
}
